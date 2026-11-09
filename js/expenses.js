/* ============================================================
   expenses.js - money we spent (rent, salary, bills...)
   -----------------------------------------------------------
   Each expense records Paid to (who got the money) and what it was for.
   PROVIDES: loadExpenses, renderExpenses, openExpenseForm, saveExpense
   ============================================================ */

/* ============ expenses (money we spent) ============ */
/* Pull every expense from the database (newest first), then redraw */
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
    /* past payees pop up as suggestions in the "Paid to" field */
    $("#expense-payees").innerHTML = [...new Set(state.expenseRows.map((r) => r.payee).filter(Boolean))]
      .map((n) => `<option value="${esc(n)}"></option>`)
      .join("");
    renderExpenses();
  } finally {
    busy(false);
  }
}

/* Redraw the summary cards, run search + filters, then list the rows */
function renderExpenses() {
  const rows = state.expenseRows;
  const today = todayISO();
  /* today split into "YYYY-MM" and "YYYY" prefixes used to group rows below */
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  /* rows grouped by the current month / year feed the summary cards */
  const inMonth = rows.filter((r) => String(r.entry_date).startsWith(month));
  const inYear = rows.filter((r) => String(r.entry_date).startsWith(year));
  const sum = (list) => list.reduce((s, r) => s + num(r.amount), 0);

  $("#expense-summary").innerHTML = `
    <div class="stat tone-amber"><div class="stat-label">This month</div><div class="stat-value">${money(sum(inMonth))}</div><div class="stat-sub">${inMonth.length} expense${inMonth.length === 1 ? "" : "s"}</div></div>
    <div class="stat tone-brand"><div class="stat-label">This year</div><div class="stat-value">${money(sum(inYear))}</div><div class="stat-sub">${inYear.length} expense${inYear.length === 1 ? "" : "s"}</div></div>
    <div class="stat tone-red"><div class="stat-label">All time</div><div class="stat-value">${money(sum(rows))}</div><div class="stat-sub">${rows.length} recorded</div></div>`;

  const q = state.expSearch.toLowerCase();
  /* the search box matches title, paid-to and notes (ignoring case) ... */
  const searched = rows.filter(
    (r) =>
      !q ||
      (r.title || "").toLowerCase().includes(q) ||
      (r.payee || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q)
  );
  /* ... then the shared ⚙ filter panel narrows that result further */
  const shown = applyListFilters("expenses", searched, rows);

  /* what may THIS user do here (see core.js): Edit needs write access,
     ✕ needs the flow's delete tick, and a plain tap opens the form
     only when they can actually change something */
  const canWrite = can("expenses", "write");
  const canDel = canDelete("expenses");

  /* one row per expense, or an empty-state message if nothing matched */
  $("#expense-list").innerHTML = shown.length
    ? shown
        .map(
          (r) => `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(r.title)}</div>
              <div class="row-sub">${fmtDate(r.entry_date)}${r.payee ? " · Paid to: " + esc(r.payee) : ""}${r.notes ? " · " + esc(r.notes) : ""}</div>
            </div>
            <div class="row-right">
              <div class="row-amount bal-due">${money(r.amount)}</div>
              <div class="row-bal" style="color:var(--muted)">spent</div>
            </div>
            ${canWrite || canDel ? `<div class="row-actions">
              ${canWrite ? `<button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>` : ""}
              ${canDel ? `<button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>` : ""}
            </div>` : ""}
          </div>`
        )
        .join("")
    : `<div class="empty">${
        listFiltersActive("expenses") ? "No expenses match these filters." : "No expenses yet."
      }</div>`;

  /* wire each row: Edit / ✕ buttons, or a plain click on the row opens the form */
  $$("#expense-list .row").forEach((el) => {
    const r = rows.find((x) => x.id === el.dataset.id);
    el.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "edit") openExpenseForm(r);
      else if (act === "del")
        askConfirm("Delete this expense?", `Delete ${r.title} (${money(r.amount)})?`, async () => {
          busy(true);
          const { error } = await sb.from("expenses").delete().eq("id", r.id);
          busy(false);
          if (error) return toast(error.message, true);
          toast("Expense deleted");
          loadExpenses();
        });
      else if (canWrite) openExpenseForm(r);   /* read-only rows don't open the form */
    });
  });
}

function openExpenseForm(r = null) {
  $("#expense-form").reset();
  $("#expense-form-error").hidden = true;
  $("#expense-id").value = r?.id || "";
  $("#expense-modal-title").textContent = r ? "Edit expense" : "New expense";
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
  };
  if (!payload.payee) { errEl.textContent = "Please enter who the money was given to (Paid to)."; errEl.hidden = false; return; }
  if (!payload.title) { errEl.textContent = "Please enter what the expense was for."; errEl.hidden = false; return; }
  if (Number.isNaN(amountN)) { errEl.textContent = AMOUNT_HINT; errEl.hidden = false; return; }
  if (payload.amount <= 0) { errEl.textContent = "Enter how much was spent."; errEl.hidden = false; return; }

  busy(true);
  try {
    const { error } = id
      ? await sb.from("expenses").update(payload).eq("id", id)
      : await sb.from("expenses").insert(payload);
    if (error) throw error;
    closeModals();
    toast(id ? "Expense updated" : "Expense added");
    loadExpenses();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    busy(false);
  }
}
