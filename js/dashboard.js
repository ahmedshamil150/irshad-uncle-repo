/* ============================================================
   dashboard.js - the first screen: totals for a chosen date range
   -----------------------------------------------------------
   Loads sales/purchases/zakat/payments for the selected range and
   draws the summary cards.
   PROVIDES: applyRange, loadDashboard, rangeLabel
   ============================================================ */

/* ============ dashboard ============ */
function applyRange(q, col) {
  if (state.range === "month") return q.gte(col, monthStartISO());
  if (state.range === "year") return q.gte(col, yearStartISO());
  if (state.range === "custom") {
    if (state.from) q = q.gte(col, state.from);
    if (state.to) q = q.lte(col, state.to);
  }
  return q;
}

async function loadDashboard() {
  busy(true);
  try {
    const [salesR, lightR, paysR, payablesR, zakatR, purchR, purchOwedR] = await Promise.all([
      applyRange(sb.from("sales").select("*"), "sale_date"),
      sb.from("sales").select("id,total_amount,cash_amount,bank_amount,adjustment_amount,loan_amount"),
      sb.from("payments").select("sale_id,payable_id,purchase_id,amount"),
      sb.from("payables").select("amount"),
      applyRange(sb.from("zakat").select("amount"), "entry_date"),
      applyRange(sb.from("purchases").select("amount"), "entry_date"),
      /* unpaid purchase balances — same money the To pay tab lists (all-time, like payables) */
      sb.from("purchases").select("id,amount,cash_amount,bank_amount"),
    ]);
    const errs = [salesR, lightR, paysR, payablesR, zakatR, purchR, purchOwedR].find((r) => r.error);
    if (errs) throw errs.error;

    const sales = salesR.data || [];
    const light = lightR.data || [];
    const pays = paysR.data || [];
    const payables = payablesR.data || [];
    const zakatRows = zakatR.data || [];
    const purchRows = purchR.data || [];
    const purchOwed = purchOwedR.data || [];

    const totalSale = sales.reduce((s, r) => s + num(r.total_amount), 0);
    const cash = sales.reduce((s, r) => s + num(r.cash_amount), 0);
    const bank = sales.reduce((s, r) => s + num(r.bank_amount), 0);
    const adjustment = sales.reduce((s, r) => s + num(r.adjustment_amount), 0);
    const loan = sales.reduce((s, r) => s + num(r.loan_amount), 0);

    const paidForSale = {};
    const paidForPayable = {};
    const paidForPurchase = {};
    for (const p of pays) {
      if (p.sale_id) paidForSale[p.sale_id] = (paidForSale[p.sale_id] || 0) + num(p.amount);
      if (p.payable_id) paidForPayable[p.payable_id] = (paidForPayable[p.payable_id] || 0) + num(p.amount);
      if (p.purchase_id) paidForPurchase[p.purchase_id] = (paidForPurchase[p.purchase_id] || 0) + num(p.amount);
    }
    let recv = 0, recvCount = 0;
    for (const r of light) {
      const due = num(r.total_amount) - num(r.cash_amount) - num(r.bank_amount) - num(r.adjustment_amount) - num(r.loan_amount);
      const saleId = r.id;
      const bal = due - (paidForSale[saleId] || 0);
      if (bal > 0.009) { recv += bal; recvCount++; }
    }
    // light select needs ids for per-sale balance
    const payableTotal = payables.reduce((s, r) => s + num(r.amount), 0);
    const payablePaid = pays.filter((p) => p.payable_id).reduce((s, p) => s + num(p.amount), 0);
    /* purchases still owing (cash + bank + payments haven't covered the total) */
    const purchaseOwed = purchOwed.reduce((s, r) => {
      const bal = num(r.amount) - num(r.cash_amount) - num(r.bank_amount) - (paidForPurchase[r.id] || 0);
      return s + (bal > 0.009 ? bal : 0);
    }, 0);

    const cards = [
      { label: "Total sale", value: money(totalSale), tone: "brand", sub: rangeLabel() },
      { label: "Cash", value: money(cash), tone: "green" },
      { label: "Bank", value: money(bank), tone: "brand" },
      ...(adjustment > 0 ? [{ label: "Adjustment", value: money(adjustment), tone: "brand", sub: "Old machines taken in trade" }] : []),
      { label: "Zakat", value: money(zakatRows.reduce((s, r) => s + num(r.amount), 0)), tone: "violet",
        sub: `${zakatRows.length} entr${zakatRows.length === 1 ? "y" : "ies"} in this period` },
      { label: "Purchases", value: money(purchRows.reduce((s, r) => s + num(r.amount), 0)), tone: "amber",
        sub: `${purchRows.length} purchase${purchRows.length === 1 ? "" : "s"} in this period` },
    ];
    /* loan is no longer an option on the sale form — only show it while old sales still carry one */
    if (loan > 0) cards.push({ label: "Loan", value: money(loan), tone: "violet" });
    cards.push(
      { label: "To receive (total)", value: money(recv), tone: "red", sub: `${recvCount} sale${recvCount === 1 ? "" : "s"} still to pay` },
      { label: "To pay (total)", value: money(payableTotal - payablePaid + purchaseOwed), tone: "amber", sub: "To dealers & suppliers" }
    );
    $("#dash-cards").innerHTML = cards
      .map(
        (c) => `<div class="stat tone-${c.tone}">
          <div class="stat-label">${esc(c.label)}</div>
          <div class="stat-value">${c.value}</div>
          ${c.sub ? `<div class="stat-sub">${esc(c.sub)}</div>` : ""}
        </div>`
      )
      .join("");

    /* source split */
    const src = { office: 0, dealer: 0, salesman: 0, reference: 0 };
    for (const r of sales) src[r.source] = (src[r.source] || 0) + num(r.total_amount);
    const max = Math.max(...Object.values(src), 1);
    $("#source-split").innerHTML = ["office", "dealer", "salesman", "reference"]
      .map(
        (k) => `<div class="src-row" data-src="${k}">
          <div class="src-head"><span>${srcName(k)} sale</span><b>${money(src[k])}</b></div>
          <div class="src-track"><div class="src-fill" style="width:${Math.round((src[k] / max) * 100)}%"></div></div>
        </div>`
      )
      .join("");

    /* recent */
    const recent = [...sales]
      .sort((a, b) => (b.sale_date || "").localeCompare(a.sale_date || ""))
      .slice(0, 5);
    $("#recent-sales").innerHTML = recent.length
      ? recent
          .map(
            (r) => `<div class="mini-row" data-sale="${r.id}">
            <div><div>${esc(r.customer_name)}</div><div class="mini-sub">${fmtDate(r.sale_date)} · ${esc(srcName(r.source))}</div></div>
            <b>${money(r.total_amount)}</b>
          </div>`
          )
          .join("")
      : `<div class="empty">No sales in this period.</div>`;

    $$("#recent-sales .mini-row").forEach((el) =>
      el.addEventListener("click", () => { switchView("sales"); setTimeout(() => openSaleDetail(el.dataset.sale), 250); })
    );
  } finally {
    busy(false);
  }
}

function rangeLabel() {
  if (state.range === "month") return "This month";
  if (state.range === "year") return "This year";
  if (state.range === "custom")
    return (state.from ? fmtDate(state.from) : "Start") + " – " + (state.to ? fmtDate(state.to) : "Today");
  return "All time";
}
