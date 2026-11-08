/* ============================================================
   receivables.js - To receive: money customers still owe
   -----------------------------------------------------------
   Joins every unpaid sale installment with its payments and
   lists what is due (the + Pay button opens the payment sheet).
   PROVIDES: loadReceivables, renderReceivables
   ============================================================ */

/* ============ receivables ============ */
async function loadReceivables() {
  busy(true);
  try {
    const [sR, pR, iR] = await Promise.all([
      sb.from("sales").select("*").order("sale_date", { ascending: true }),
      sb.from("payments").select("sale_id,amount"),
      sb.from("installments").select("sale_id,due_date").lt("due_date", todayISO()),
    ]);
    if (sR.error) throw sR.error;
    if (pR.error) throw pR.error;
    const pay = {};
    for (const p of pR.data || []) if (p.sale_id) pay[p.sale_id] = (pay[p.sale_id] || 0) + num(p.amount);

    state.recOverdue = new Set((iR.data || []).map((r) => r.sale_id));
    state.recOpen = sR.data
      .map((r) => ({ ...r, bal: round2(num(r.total_amount) - num(r.cash_amount) - num(r.bank_amount) - num(r.adjustment_amount) - num(r.loan_amount) - (pay[r.id] || 0)) }))
      .filter((r) => r.bal > 0.009);
    renderReceivables();
  } finally {
    busy(false);
  }
}

function renderReceivables() {
  const open = state.recOpen || [];
  const overdueIds = state.recOverdue || new Set();

  const total = open.reduce((s, r) => s + r.bal, 0);
  const overdue = open.filter((r) => overdueIds.has(r.id)).reduce((s, r) => s + r.bal, 0);

  $("#receivable-summary").innerHTML = `
      <div class="stat tone-red"><div class="stat-label">Total to receive</div><div class="stat-value">${money(total)}</div></div>
      <div class="stat tone-amber"><div class="stat-label">Overdue sales</div><div class="stat-value">${open.filter((r) => overdueIds.has(r.id)).length}</div><div class="stat-sub">${money(overdue)} late</div></div>
      <div class="stat tone-brand"><div class="stat-label">Sales with balance</div><div class="stat-value">${open.length}</div></div>`;

  const q = state.recSearch.toLowerCase();
  const searched = open.filter((r) => !q || (r.customer_name || "").toLowerCase().includes(q));
  const rows = applyListFilters("receivables", searched, open);

  $("#receivable-list").innerHTML = rows.length
    ? rows
        .map((r) => `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(r.customer_name)}
                <span class="badge badge-${r.source}">${esc(srcName(r.source))}</span>
                ${overdueIds.has(r.id) ? '<span class="badge badge-overdue">Overdue</span>' : ""}
              </div>
              <div class="row-sub">Sold ${fmtDate(r.sale_date)} · Total ${money(r.total_amount)}</div>
            </div>
            <div class="row-right">
              <div class="row-amount bal-due">${money(r.bal)}</div>
              <div class="row-bal" style="color:var(--muted)">left</div>
            </div>
            <div class="row-actions">
              <button type="button" class="btn btn-sm btn-primary" data-act="pay">✓ Paid all</button>
            </div>
          </div>`)
        .join("")
    : `<div class="empty">${
        open.length === 0
          ? "Nothing to receive — every sale is fully paid."
          : listFiltersActive("receivables") ? "Nothing matches these filters." : "Nothing to receive."
      }</div>`;

  $$("#receivable-list .row").forEach((el) => {
    const r = rows.find((x) => x.id === el.dataset.id);
    el.addEventListener("click", (e) => {
      if (e.target.closest('[data-act="pay"]'))
        openPaymentModal("sale", r.id, `${r.customer_name} — still to receive ${money(r.bal)}`, r.bal);
      else openSaleDetail(el.dataset.id);
    });
  });
}
