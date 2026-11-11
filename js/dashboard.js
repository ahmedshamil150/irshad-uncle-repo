/* ============================================================
   dashboard.js - the first screen: totals for a chosen date range
   -----------------------------------------------------------
   Loads sales/purchases/zakat/payments for the selected range and
   draws the summary cards.
   PROVIDES: applyRange, loadDashboard, rangeLabel
   ============================================================ */

/* ============ dashboard ============ */
// Narrows a Supabase query to the range picked in the toolbar (month / year / custom from-to).
function applyRange(q, col) {
  if (state.range === "month") return q.gte(col, monthStartISO());
  if (state.range === "year") return q.gte(col, yearStartISO());
  if (state.range === "custom") {
    // Custom range: apply whichever end dates were filled in - either side can be left open.
    if (state.from) q = q.gte(col, state.from);
    if (state.to) q = q.lte(col, state.to);
  }
  return q;
}

// Loads everything the summary cards need for the current range and draws them.
async function loadDashboard() {
  busy(true);
  try {
    // Fetch everything in parallel. Only sales/zakat/purchases/cash-ins are limited to the chosen dates;
    // payments and payables are read for all time so every balance stays complete.
    const [salesR, lightR, paysR, payablesR, zakatR, purchR, purchOwedR, cashInR] = await Promise.all([
      applyRange(sb.from("sales").select("*"), "sale_date"),
      sb.from("sales").select("id,total_amount,cash_amount,bank_amount,adjustment_amount,loan_amount"),
      sb.from("payments").select("sale_id,payable_id,purchase_id,amount"),
      sb.from("payables").select("amount"),
      applyRange(sb.from("zakat").select("amount"), "entry_date"),
      applyRange(sb.from("purchases").select("amount"), "entry_date"),
      /* unpaid purchase balances — same money the To pay tab lists (all-time, like payables) */
      sb.from("purchases").select("id,amount,cash_amount,bank_amount"),
      /* cash received from people — feeds the Total credit card */
      applyRange(sb.from("cash_ins").select("amount"), "entry_date"),
    ]);
    const errs = [salesR, lightR, paysR, payablesR, zakatR, purchR, purchOwedR, cashInR].find((r) => r.error);
    if (errs) throw errs.error;

    const sales = salesR.data || [];
    const light = lightR.data || [];
    const pays = paysR.data || [];
    const payables = payablesR.data || [];
    const zakatRows = zakatR.data || [];
    const purchRows = purchR.data || [];
    const purchOwed = purchOwedR.data || [];
    const cashInRows = cashInR.data || [];

    // Add up the sales in the range, broken down by how each one was paid for.
    const totalSale = sales.reduce((s, r) => s + num(r.total_amount), 0);
    const cash = sales.reduce((s, r) => s + num(r.cash_amount), 0);
    const bank = sales.reduce((s, r) => s + num(r.bank_amount), 0);
    const adjustment = sales.reduce((s, r) => s + num(r.adjustment_amount), 0);
    const loan = sales.reduce((s, r) => s + num(r.loan_amount), 0);

    // Bucket every recorded payment by the thing it paid off, so a balance is one lookup by id.
    const paidForSale = {};
    const paidForPayable = {};
    const paidForPurchase = {};
    for (const p of pays) {
      if (p.sale_id) paidForSale[p.sale_id] = (paidForSale[p.sale_id] || 0) + num(p.amount);
      if (p.payable_id) paidForPayable[p.payable_id] = (paidForPayable[p.payable_id] || 0) + num(p.amount);
      if (p.purchase_id) paidForPurchase[p.purchase_id] = (paidForPurchase[p.purchase_id] || 0) + num(p.amount);
    }
    // "To receive": a sale counts only when cash + bank + adjustment + loan + payments still
    // don't cover the total - the leftover is what that customer still owes us.
    let recv = 0, recvCount = 0;
    for (const r of light) {
      const due = num(r.total_amount) - num(r.cash_amount) - num(r.bank_amount) - num(r.adjustment_amount) - num(r.loan_amount); // ... owed before counting payments
      const saleId = r.id;
      const bal = due - (paidForSale[saleId] || 0);
      if (bal > 0.009) { recv += bal; recvCount++; }
    }
    // light select needs ids for per-sale balance
    // Owed to dealers overall: all owe entries, minus the payments already made against them.
    const payableTotal = payables.reduce((s, r) => s + num(r.amount), 0);
    const payablePaid = pays.filter((p) => p.payable_id).reduce((s, p) => s + num(p.amount), 0);
    /* purchases still owing (cash + bank + payments haven't covered the total) */
    const purchaseOwed = purchOwed.reduce((s, r) => {
      const bal = num(r.amount) - num(r.cash_amount) - num(r.bank_amount) - (paidForPurchase[r.id] || 0);
      return s + (bal > 0.009 ? bal : 0);
    }, 0);

    // Assemble the summary cards shown at the top (Adjustment appears only when there is one).
    // Every card carries the flow(s) it is built from, so each user only sees
    // the numbers they are allowed to read (see core.js can / canAny — the
    // flow lists here mirror the read rules in schema.sql).
    const cards = [
      { flows: ["sales"], label: "Total sale", value: money(totalSale), tone: "brand", sub: rangeLabel() },
      /* Total credit = sale money + cash received from people (only the parts
         this user may read are added up — see core.js can) */
      { flows: ["sales", "cashin"], label: "Total credit",
        value: money((can("sales", "read") ? totalSale : 0) + (can("cashin", "read") ? cashInRows.reduce((s, r) => s + num(r.amount), 0) : 0)),
        tone: "green", sub: rangeLabel() },
      { flows: ["sales"], label: "Cash", value: money(cash), tone: "green" },
      { flows: ["sales"], label: "Bank", value: money(bank), tone: "brand" },
      ...(adjustment > 0 ? [{ flows: ["sales"], label: "Adjustment", value: money(adjustment), tone: "brand", sub: "Old machines taken in trade" }] : []),
      { flows: ["zakat"], label: "Zakat", value: money(zakatRows.reduce((s, r) => s + num(r.amount), 0)), tone: "violet",
        sub: `${zakatRows.length} entr${zakatRows.length === 1 ? "y" : "ies"} in this period` },
      { flows: ["purchases"], label: "Purchases", value: money(purchRows.reduce((s, r) => s + num(r.amount), 0)), tone: "amber",
        sub: `${purchRows.length} purchase${purchRows.length === 1 ? "" : "s"} in this period` },
    ];
    /* loan is no longer an option on the sale form — only show it while old sales still carry one */
    if (loan > 0) cards.push({ flows: ["sales"], label: "Loan", value: money(loan), tone: "violet" });
    cards.push(
      { flows: ["sales", "receivables"], label: "To receive (total)", value: money(recv), tone: "red", sub: `${recvCount} sale${recvCount === 1 ? "" : "s"} still to pay` },
      { flows: ["payables", "purchases"], label: "To pay (total)", value: money(payableTotal - payablePaid + purchaseOwed), tone: "amber", sub: "To dealers & suppliers" }
    );
    // Turn the allowed cards into HTML and draw them (none allowed → say so).
    const shownCards = cards.filter((c) => canAny(c.flows, "read"));
    $("#dash-cards").innerHTML = shownCards.length
      ? shownCards
          .map(
            (c) => `<div class="stat tone-${c.tone}">
          <div class="stat-label">${esc(c.label)}</div>
          <div class="stat-value">${c.value}</div>
          ${c.sub ? `<div class="stat-sub">${esc(c.sub)}</div>` : ""}
        </div>`
          )
          .join("")
      : '<div class="empty">No data to show — no flows are shared with this account.</div>';

    /* the two widgets below are built from sales only, so they disappear
       (whole .card) for anyone who may not read sales */
    const seeSales = can("sales", "read");
    $("#source-split").closest(".card").hidden = !seeSales;
    $("#recent-sales").closest(".card").hidden = !seeSales;

    if (seeSales) {
    /* source split */
    const src = { office: 0, dealer: 0, salesman: 0, reference: 0 };
    for (const r of sales) src[r.source] = (src[r.source] || 0) + num(r.total_amount);
    const max = Math.max(...Object.values(src), 1); // ... the 1 keeps the bars at 0% when a source has no sales
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
      .sort((a, b) => (b.sale_date || "").localeCompare(a.sale_date || "")) // ... newest first (plain string compare on YYYY-MM-DD dates)
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

    // Clicking a recent sale switches to the Sales tab and opens that sale's detail.
    $$("#recent-sales .mini-row").forEach((el) =>
      el.addEventListener("click", () => { switchView("sales"); setTimeout(() => openSaleDetail(el.dataset.sale), 250); })
    );
    } /* end if (seeSales) */
  } finally {
    busy(false);
  }
}

// Human-readable name of the current range, shown under the Total sale card.
function rangeLabel() {
  if (state.range === "month") return "This month";
  if (state.range === "year") return "This year";
  if (state.range === "custom")
    return (state.from ? fmtDate(state.from) : "Start") + " – " + (state.to ? fmtDate(state.to) : "Today");
  return "All time";
}
