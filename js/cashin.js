/* ============================================================
   cashin.js - cash received from people
   -----------------------------------------------------------
   Money people hand over (for machine repairs or anything else).
   Simple list + form, same pattern as zakat.
   PROVIDES: loadCashIn, renderCashIn, openCashInForm, saveCashIn
   ============================================================ */

/* ============ cash in (money received from people) ============ */
/* Pull every cash-in row from the database (newest first), then redraw */
async function loadCashIn() {
  busy(true);
  try {
    const { data, error } = await sb
      .from("cash_ins")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    state.cashInRows = data || [];
    renderCashIn();
  } finally {
    busy(false);
  }
}

/* Redraw the summary cards, run search + filters, then list the rows */
function renderCashIn() {
  const rows = state.cashInRows;
  const today = todayISO();
  /* today split into "YYYY-MM" and "YYYY" prefixes used to group rows below */
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  /* rows grouped by the current month / year feed the summary cards */
  const inMonth = rows.filter((r) => String(r.entry_date).startsWith(month));
  const inYear = rows.filter((r) => String(r.entry_date).startsWith(year));
  const sum = (list) => list.reduce((s, r) => s + num(r.amount), 0);

  $("#cashin-summary").innerHTML = `
    <div class="stat tone-green"><div class="stat-label">This month</div><div class="stat-value">${money(sum(inMonth))}</div><div class="stat-sub">${inMonth.length} entr${inMonth.length === 1 ? "y" : "ies"}</div></div>
    <div class="stat tone-brand"><div class="stat-label">This year</div><div class="stat-value">${money(sum(inYear))}</div><div class="stat-sub">${inYear.length} entr${inYear.length === 1 ? "y" : "ies"}</div></div>
    <div class="stat tone-violet"><div class="stat-label">All time</div><div class="stat-value">${money(sum(rows))}</div><div class="stat-sub">${rows.length} received</div></div>`;

  const q = state.cashinSearch.toLowerCase();
  /* first the search box narrows by who it came from, why and the notes ... */
  const searched = rows.filter(
    (r) =>
      !q ||
      (r.from_name || "").toLowerCase().includes(q) ||
      (r.reason || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q)
  );
  /* ... then the shared ⚙ filter panel narrows that result further */
  const shown = applyListFilters("cashin", searched, rows);

  /* what may THIS user do here (see core.js): Edit needs write access,
     ✕ needs the flow's delete tick, a plain tap opens the form only
     when they can actually change something */
  const canWrite = can("cashin", "write");
  const canDel = canDelete("cashin");

  /* one row per entry, or an empty-state message if nothing matched */
  $("#cashin-list").innerHTML = shown.length
    ? shown
        .map(
          (r) => `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(r.from_name)}${r.reason ? ` · ${esc(r.reason)}` : ""}</div>
              <div class="row-sub">${fmtDate(r.entry_date)}${r.notes ? ` · ${esc(r.notes)}` : ""}</div>
            </div>
            <div class="row-right">
              <div class="row-amount bal-due">${money(r.amount)}</div>
              <div class="row-bal" style="color:var(--muted)">received</div>
            </div>
            ${canWrite || canDel ? `<div class="row-actions">
              ${canWrite ? `<button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>` : ""}
              ${canDel ? `<button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>` : ""}
            </div>` : ""}
          </div>`
        )
        .join("")
    : `<div class="empty">${
        listFiltersActive("cashin") ? "No cash-in entries match these filters." : "No cash in recorded yet."
      }</div>`;

  /* wire each row: Edit / ✕ buttons, or a plain click on the row opens the form */
  $$("#cashin-list .row").forEach((el) => {
    const r = rows.find((x) => x.id === el.dataset.id);
    el.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;   // which button was hit (null = plain row click)
      if (act === "edit") openCashInForm(r);
      else if (act === "del")
        askConfirm("Delete this cash-in entry?", `Delete ${money(r.amount)} received from ${r.from_name} on ${fmtDate(r.entry_date)}?`, async () => {
          busy(true);
          const { error } = await sb.from("cash_ins").delete().eq("id", r.id);
          busy(false);
          if (error) return toast(error.message, true);
          toast("Cash-in entry deleted");
          loadCashIn();
        });
      else if (canWrite) openCashInForm(r);   /* read-only rows don't open the form */
    });
  });
}

function openCashInForm(r = null) {
  $("#cashin-form").reset();
  $("#cashin-form-error").hidden = true;
  $("#cashin-id").value = r?.id || "";
  $("#cashin-modal-title").textContent = r ? "Edit cash in" : "New cash in";
  $("#cashin-date").value = r?.entry_date || todayISO();
  $("#cashin-from").value = r?.from_name || "";
  $("#cashin-amount").value = r ? num(r.amount) : "";
  $("#cashin-reason").value = r?.reason || "";
  $("#cashin-notes").value = r?.notes || "";
  openModal("modal-cashin");
}

async function saveCashIn(e) {
  e.preventDefault();
  const errEl = $("#cashin-form-error");
  errEl.hidden = true;
  const id = $("#cashin-id").value;
  const amountN = parseAmount($("#cashin-amount").value);
  const fromName = $("#cashin-from").value.trim();
  const payload = {
    entry_date: $("#cashin-date").value || todayISO(),
    from_name: fromName,
    amount: round2(amountN),
    reason: $("#cashin-reason").value.trim() || null,
    notes: $("#cashin-notes").value.trim() || null,
  };
  if (!fromName) { errEl.textContent = "Enter who the cash came from."; errEl.hidden = false; return; }
  if (Number.isNaN(amountN)) { errEl.textContent = AMOUNT_HINT; errEl.hidden = false; return; }
  if (payload.amount <= 0) { errEl.textContent = "Enter how much cash was received."; errEl.hidden = false; return; }

  busy(true);
  try {
    const { error } = id
      ? await sb.from("cash_ins").update(payload).eq("id", id)
      : await sb.from("cash_ins").insert(payload);
    if (error) throw error;
    closeModals();
    toast(id ? "Cash-in entry updated" : "Cash in recorded");
    loadCashIn();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    busy(false);
  }
}
