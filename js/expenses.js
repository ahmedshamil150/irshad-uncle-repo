/* ============================================================
   expenses.js - money we gave out, and the spends inside it
   -----------------------------------------------------------
   The expenses screen is an ENVELOPE system:
   - a TOP-LEVEL expense is a card of money handed to someone
     ("30k to Rauf"); its CHILDREN (parent_id set) are the spends
     recorded inside that card ("3k milkman"), so everyone can
     follow where the money went: given / spent / left.
   - Summary totals and the ⚙ filters count CARDS only, so a
     spend is never counted twice (once inside its card, once on
     its own).
   - The search box matches a card OR any spend inside it; the
     matching spends are drawn expanded under their card.
   - A row may only be changed by whoever created it (admins and
     the legacy full user change anything) — the expenses RLS
     policies in schema.sql enforce the same rule server-side.
   PROVIDES: loadExpenses, renderExpenses, openExpenseDetail,
             confirmDeleteExpense, openExpenseForm, saveExpense
   ============================================================ */

/* ============ envelope helpers ============ */

/* Split the loaded rows into cards (no parent) and their spends,
   newest spend first — the same order as the main list. */
function expenseTree() {
  const parents = [];
  const kids = new Map();
  for (const r of state.expenseRows) {
    if (r.parent_id) {
      if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
      kids.get(r.parent_id).push(r);
    } else parents.push(r);
  }
  kids.forEach((list) =>
    list.sort(
      (a, b) =>
        String(b.entry_date).localeCompare(String(a.entry_date)) ||
        String(b.created_at).localeCompare(String(a.created_at))
    )
  );
  return { parents, kids };
}

/* Flow write access AND the row must be our own — the admin (or the
   pre-multi-user { full: true } fallback) edits everything. */
function canEditRow(r) {
  if (!can("expenses", "write")) return false;
  if (state.me?.full || state.me?.is_admin) return true;
  return !!user && r.created_by === user.id;
}
/* Same for the ✕: the flow's delete tick plus ownership. */
function canDelRow(r) {
  if (!canDelete("expenses")) return false;
  if (state.me?.full || state.me?.is_admin) return true;
  return !!user && r.created_by === user.id;
}

/* ============ loading ============ */

/* Pull every expense (cards AND their spends, newest first), then redraw */
async function loadExpenses() {
  busy(true);
  try {
    const { data, error } = await sb
      .from("expenses")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    state.expenseRows = data || [];
    /* past payees (from cards and from the spends inside them) pop up as
       suggestions in the "Paid to" field */
    $("#expense-payees").innerHTML = [...new Set(state.expenseRows.map((r) => r.payee).filter(Boolean))]
      .map((n) => `<option value="${esc(n)}"></option>`)
      .join("");
    renderExpenses();
    /* an open detail sheet follows the fresh data (and closes itself if
       its card no longer exists) */
    if (state.expDetailId && !$("#modal-expense-detail").hidden) openExpenseDetail(state.expDetailId);
  } finally {
    busy(false);
  }
}

/* ============ list ============ */

/* Redraw the summary cards, run search + filters, then list the cards */
function renderExpenses() {
  const { parents, kids } = expenseTree();
  const today = todayISO();
  /* today split into "YYYY-MM" and "YYYY" prefixes used to group rows below */
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  /* summaries count the CARDS only — every rupee is already inside one */
  const inMonth = parents.filter((r) => String(r.entry_date).startsWith(month));
  const inYear = parents.filter((r) => String(r.entry_date).startsWith(year));
  const sum = (list) => list.reduce((s, r) => s + num(r.amount), 0);

  $("#expense-summary").innerHTML = `
    <div class="stat tone-amber"><div class="stat-label">This month</div><div class="stat-value">${money(sum(inMonth))}</div><div class="stat-sub">${inMonth.length} expense${inMonth.length === 1 ? "" : "s"}</div></div>
    <div class="stat tone-brand"><div class="stat-label">This year</div><div class="stat-value">${money(sum(inYear))}</div><div class="stat-sub">${inYear.length} expense${inYear.length === 1 ? "" : "s"}</div></div>
    <div class="stat tone-red"><div class="stat-label">All time</div><div class="stat-value">${money(sum(parents))}</div><div class="stat-sub">${parents.length} recorded</div></div>`;

  const q = state.expSearch.toLowerCase();
  /* one text match over title, paid-to and notes (ignoring case) */
  const hit = (r) =>
    !q ||
    (r.title || "").toLowerCase().includes(q) ||
    (r.payee || "").toLowerCase().includes(q) ||
    (r.notes || "").toLowerCase().includes(q);
  /* the box matches a card itself OR any spend inside it, so searching a
     spend's payee still finds the card it came from ... */
  const searched = parents.filter((p) => hit(p) || (kids.get(p.id) || []).some(hit));
  /* ... then the shared ⚙ filter panel narrows the CARDS further */
  const shown = applyListFilters("expenses", searched, parents);

  /* what may THIS user do here (see core.js): Edit/✕ also need the row to
     be their own — see canEditRow / canDelRow above */
  const hasActions = (r) => canEditRow(r) || canDelRow(r);

  const actions = (r) =>
    hasActions(r)
      ? `<div class="row-actions">
          ${canEditRow(r) ? `<button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>` : ""}
          ${canDelRow(r) ? `<button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>` : ""}
        </div>`
      : "";

  /* one card per top-level expense (spends that matched the search are
     drawn right below their card), or an empty-state message */
  $("#expense-list").innerHTML = shown.length
    ? shown
        .map((p) => {
          const inside = kids.get(p.id) || [];
          const spent = inside.reduce((s, c) => s + num(c.amount), 0);
          const left = round2(num(p.amount) - spent);
          const hasKids = inside.length > 0;
          /* the balance line: "left Rs X" colored green (or red when the
             card is overspent); childless cards read "spent" as before */
          const balCls = hasKids ? (left < 0 ? "bal-due" : "bal-ok") : "";
          const balStyle = hasKids ? "" : "color:var(--muted)";
          /* only spends that matched the text are revealed, and only
             while a search is running */
          const expanded = q ? inside.filter(hit) : [];
          return `<div class="row" data-id="${p.id}">
            <div class="row-main">
              <div class="row-title">${esc(p.title)}</div>
              <div class="row-sub">${fmtDate(p.entry_date)}${p.payee ? " · Paid to: " + esc(p.payee) : ""}${hasKids ? ` · ${inside.length} spend${inside.length === 1 ? "" : "s"}` : ""}${p.notes ? " · " + esc(p.notes) : ""}</div>
            </div>
            <div class="row-right">
              <div class="row-amount">${money(p.amount)}</div>
              <div class="row-bal ${balCls}" style="${balStyle}">${hasKids ? "left " + money(left) : "spent"}</div>
            </div>
            ${actions(p)}
          </div>${expanded
            .map(
              (c) => `<div class="row row-child" data-id="${c.id}" data-parent="${p.id}">
              <div class="row-main">
                <div class="row-title">${esc(c.title)}</div>
                <div class="row-sub">${fmtDate(c.entry_date)}${c.payee ? " · " + esc(c.payee) : ""}${c.notes ? " · " + esc(c.notes) : ""}</div>
              </div>
              <div class="row-right"><div class="row-amount">${money(c.amount)}</div></div>
              ${actions(c)}
            </div>`
            )
            .join("")}`;
        })
        .join("")
    : `<div class="empty">${
        listFiltersActive("expenses") ? "No expenses match these filters." : "No expenses yet."
      }</div>`;

  /* wire every row: Edit / ✕ buttons, or a plain tap — which opens the
     detail sheet (a matched spend opens its card's sheet) */
  $$("#expense-list .row").forEach((el) => {
    const r = state.expenseRows.find((x) => x.id === el.dataset.id);
    el.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "edit") openExpenseForm(r);
      else if (act === "del") confirmDeleteExpense(r);
      else openExpenseDetail(el.dataset.parent || el.dataset.id);
    });
  });
}

/* ============ detail sheet ============ */

/* Open the card: given / spent / left strip, every spend recorded inside
   it, and the buttons THIS user is allowed (add always needs write;
   edit/delete of the card itself also need to own it). */
function openExpenseDetail(id) {
  const p = state.expenseRows.find((x) => x.id === id);
  if (!p) {
    /* the card is gone (deleted elsewhere) — leave the sheet */
    state.expDetailId = null;
    return closeModals();
  }
  state.expDetailId = id;

  const inside = expenseTree().kids.get(p.id) || [];
  const spent = inside.reduce((s, c) => s + num(c.amount), 0);
  const left = round2(num(p.amount) - spent);
  const canWrite = can("expenses", "write");

  const kidsHtml = inside.length
    ? inside
        .map((c) => {
          const ed = canEditRow(c), dl = canDelRow(c);
          return `<div class="pay-item">
            <div class="pi-main"><b>${money(c.amount)}</b> ${esc(c.title)}
              <div class="pi-sub">${fmtDate(c.entry_date)}${c.payee ? " · " + esc(c.payee) : ""}${c.notes ? " · " + esc(c.notes) : ""}</div>
            </div>
            ${ed || dl ? `<div class="pi-actions">
              ${ed ? `<button type="button" class="btn btn-sm btn-ghost" data-editchild="${c.id}">Edit</button>` : ""}
              ${dl ? `<button type="button" class="icon-del" data-delchild="${c.id}" title="Delete spend">✕</button>` : ""}
            </div>` : ""}
          </div>`;
        })
        .join("")
    : `<div class="empty" style="padding:16px">No spends recorded inside yet.</div>`;

  const showActions = canWrite || canEditRow(p) || canDelRow(p);
  $("#expense-detail-body").innerHTML = `
    <div class="row-title" style="font-size:18px">${esc(p.title)}</div>
    <div class="row-sub" style="margin-bottom:12px">${fmtDate(p.entry_date)}${p.payee ? " · Paid to: " + esc(p.payee) : ""}${p.notes ? " · " + esc(p.notes) : ""}</div>

    <div class="detail-grid cols-3">
      <div class="stat tone-brand"><div class="stat-label">Given</div><div class="stat-value">${money(p.amount)}</div></div>
      <div class="stat tone-amber"><div class="stat-label">Spent</div><div class="stat-value">${money(spent)}</div><div class="stat-sub">${inside.length} spend${inside.length === 1 ? "" : "s"}</div></div>
      ${left < 0
        ? `<div class="stat tone-red"><div class="stat-label">Overspent</div><div class="stat-value">${money(-left)}</div></div>`
        : `<div class="stat tone-green"><div class="stat-label">Left</div><div class="stat-value">${money(left)}</div></div>`}
    </div>

    ${showActions ? `<div class="detail-actions">
      ${canWrite ? `<button type="button" class="btn btn-primary btn-sm" id="ed-add-btn">+ Add spend</button>` : ""}
      ${canEditRow(p) ? `<button type="button" class="btn btn-ghost btn-sm" id="ed-edit-btn">Edit</button>` : ""}
      ${canDelRow(p) ? `<button type="button" class="btn btn-danger btn-sm" id="ed-del-btn">Delete</button>` : ""}
    </div>` : ""}

    <div class="section-label">Spends inside</div>
    ${kidsHtml}`;

  if (canWrite)
    $("#ed-add-btn").onclick = () => openExpenseForm(null, p);
  if (canEditRow(p))
    $("#ed-edit-btn").onclick = () => openExpenseForm(p);
  if (canDelRow(p))
    $("#ed-del-btn").onclick = () => confirmDeleteExpense(p);
  $$("#expense-detail-body [data-editchild]").forEach(
    (b) => (b.onclick = () => openExpenseForm(state.expenseRows.find((x) => x.id === b.dataset.editchild)))
  );
  $$("#expense-detail-body [data-delchild]").forEach(
    (b) => (b.onclick = () => confirmDeleteExpense(state.expenseRows.find((x) => x.id === b.dataset.delchild)))
  );

  openModal("modal-expense-detail");
}

/* ============ delete ============ */

/* One confirm dialog for cards and spends. Deleting a card also removes
   every spend recorded inside it (on delete cascade), so the wording
   says so. */
function confirmDeleteExpense(r) {
  const fromDetail = !$("#modal-expense-detail").hidden;  /* remembered: the confirm sheet closes everything */
  const isCard = !r.parent_id;
  const n = isCard ? state.expenseRows.filter((x) => x.parent_id === r.id).length : 0;
  askConfirm(
    isCard ? "Delete this expense card?" : "Delete this spend?",
    isCard
      ? `Delete ${r.title} (${money(r.amount)})?${n ? ` Its ${n} recorded spend${n === 1 ? "" : "s"} will also be removed.` : ""}`
      : `Delete ${r.title} (${money(r.amount)})?`,
    async () => {
      busy(true);
      const { error } = await sb.from("expenses").delete().eq("id", r.id);
      busy(false);
      if (error) return toast(error.message, true);
      if (isCard) state.expDetailId = null;
      toast(isCard ? "Expense card deleted" : "Spend deleted");
      await loadExpenses();
      /* a spend deleted FROM the sheet returns to that sheet, now fresh */
      if (!isCard && fromDetail && state.expDetailId) openExpenseDetail(state.expDetailId);
    }
  );
}

/* ============ add / edit form ============ */

/* `r` edits an existing row; `parent` (when adding) tucks the new row
   under that card as a spend. */
function openExpenseForm(r = null, parent = null) {
  $("#expense-form").reset();
  $("#expense-form-error").hidden = true;
  $("#expense-id").value = r?.id || "";
  /* remember which sheet to return to when Cancel/✕ is pressed */
  state.returnTo = $$(".modal").find((m) => !m.hidden)?.id || null;
  const card = r?.parent_id
    ? state.expenseRows.find((x) => x.id === r.parent_id)
    : parent;
  $("#expense-parent").value = r?.parent_id || parent?.id || "";
  $("#expense-modal-title").textContent = r
    ? r.parent_id ? "Edit spend" : "Edit expense"
    : card
      ? `Add spend under “${card.title.length > 24 ? card.title.slice(0, 23) + "…" : card.title}”`
      : "New expense";
  $("#expense-date").value = r?.entry_date || todayISO();
  $("#expense-payee").value = r?.payee || "";
  $("#expense-title").value = r?.title || "";
  $("#expense-amount").value = r ? num(r.amount) : "";
  $("#expense-notes").value = r?.notes || "";
  openModal("modal-expense");
}

async function saveExpense(e) {
  e.preventDefault();
  const errEl = $("#expense-form-error");
  errEl.hidden = true;
  const id = $("#expense-id").value;
  const amountN = parseAmount($("#expense-amount").value);
  const payload = {
    entry_date: $("#expense-date").value || todayISO(),
    payee: $("#expense-payee").value.trim(),
    title: $("#expense-title").value.trim(),
    amount: round2(amountN),
    notes: $("#expense-notes").value.trim() || null,
    /* empty string → null: a plain card has no parent, a spend does */
    parent_id: $("#expense-parent").value || null,
  };
  if (!payload.payee) { errEl.textContent = "Please enter who the money was given to (Paid to)."; errEl.hidden = false; return; }
  if (!payload.title) { errEl.textContent = "Please enter what the expense was for."; errEl.hidden = false; return; }
  if (Number.isNaN(amountN)) { errEl.textContent = AMOUNT_HINT; errEl.hidden = false; return; }
  if (payload.amount <= 0) { errEl.textContent = "Enter how much was spent."; errEl.hidden = false; return; }

  /* saving from inside a card's sheet should land back on that sheet */
  const backToDetail = state.returnTo === "modal-expense-detail" && !!state.expDetailId;
  busy(true);
  try {
    const { error } = id
      ? await sb.from("expenses").update(payload).eq("id", id)
      : await sb.from("expenses").insert(payload);
    if (error) throw error;
    /* returning to an open detail sheet: skip closeModals() — it would push
       a history "back" whose popstate lands AFTER the sheet reopens and
       closes it again; openExpenseDetail() switches sheets in place */
    if (!backToDetail) closeModals();
    toast(id ? "Expense updated" : payload.parent_id ? "Spend added" : "Expense added");
    await loadExpenses();
    if (backToDetail) openExpenseDetail(state.expDetailId);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    busy(false);
  }
}
