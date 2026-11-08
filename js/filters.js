/* ============================================================
   filters.js - the shared ⚙ Filters engine
   -----------------------------------------------------------
   Every list tab (purchases, loans, expenses, zakat, to receive, to pay)
   wires its ⚙ filter panel through this one config table.
   Sales has its own filter block inside sales.js.
   PROVIDES: LIST_TABS, listF, listFilterCount, listFiltersActive,
     applyListFilters, listQuickRange, clearListFilters
   ============================================================ */

/* ---- ⚙ Filters for the other list tabs: purchases, loans, expenses,
   zakat, receivables and payables all share this one engine ---- */
const LIST_TABS = {
  purchases: {
    prefix: "pf", searchKey: "purchaseSearch", searchId: "purchase-search",
    btn: "purchase-filter-btn", panel: "purchase-filters", badge: "purchase-filter-count",
    hint: "purchase-filter-hint", clear: "purchase-filter-clear", info: "purchase-list-info",
    date: (r) => r.entry_date, amount: (r) => num(r.amount),
    extra: (r, v) => (r.mode || "batch") === v,      /* batch / local */
    render: () => renderPurchases(),
  },
  loans: {
    prefix: "lf", searchKey: "loanSearch", searchId: "loan-search",
    btn: "loan-filter-btn", panel: "loan-filters", badge: "loan-filter-count",
    hint: "loan-filter-hint", clear: "loan-filter-clear", info: "loan-list-info",
    date: (r) => r.loan_date, amount: (r) => num(r.amount),
    extra: (r, v) =>
      v === "back" ? !!r.returned_at
      : v === "late" ? !r.returned_at && ((r.due_date && r.due_date < todayISO()) || r.overdueInst)
      : !r.returned_at,
    render: () => renderLoans(),
  },
  expenses: {
    prefix: "ef", searchKey: "expSearch", searchId: "expense-search",
    btn: "expense-filter-btn", panel: "expense-filters", badge: "expense-filter-count",
    hint: "expense-filter-hint", clear: "expense-filter-clear", info: "expense-list-info",
    date: (r) => r.entry_date, amount: (r) => num(r.amount),
    render: () => renderExpenses(),
  },
  zakat: {
    prefix: "zf", searchKey: "zakatSearch", searchId: "zakat-search",
    btn: "zakat-filter-btn", panel: "zakat-filters", badge: "zakat-filter-count",
    hint: "zakat-filter-hint", clear: "zakat-filter-clear", info: "zakat-list-info",
    date: (r) => r.entry_date, amount: (r) => num(r.amount),
    render: () => renderZakat(),
  },
  receivables: {
    prefix: "rf", searchKey: "recSearch", searchId: "receivable-search",
    btn: "receivable-filter-btn", panel: "receivable-filters", badge: "receivable-filter-count",
    hint: "receivable-filter-hint", clear: "receivable-filter-clear", info: "receivable-list-info",
    date: (r) => r.sale_date, amount: (r) => num(r.bal),
    extra: (r, v) => (v === "overdue" ? state.recOverdue.has(r.id) : !state.recOverdue.has(r.id)),
    render: () => renderReceivables(),
  },
  payables: {
    prefix: "pb", searchKey: "paySearch", searchId: "payable-search",
    btn: "payable-filter-btn", panel: "payable-filters", badge: "payable-filter-count",
    hint: "payable-filter-hint", clear: "payable-filter-clear", info: "payable-list-info",
    date: (r) => r.entry_date, amount: (r) => num(r.amount),
    extra: (r, v) =>
      v === "paid" ? r.bal <= 0.009
      : v === "part" ? r.bal > 0.009 && r.bal < num(r.amount) - 0.009
      : r.bal > 0.009,
    render: () => renderPayables(),
  },
};

const listF = (tab) => (state.lf[tab] ||= { from: "", to: "", min: "", max: "", extra: "" });

function listFilterCount(tab) {
  const f = listF(tab);
  return ["from", "to", "min", "max", "extra"].filter((k) => String(f[k] || "").trim() !== "").length;
}
const listFiltersActive = (tab) =>
  String(state[LIST_TABS[tab].searchKey] || "").trim() !== "" || listFilterCount(tab) > 0;

/* narrows `searched` to what the panel allows and keeps the badge, hint and
   "showing" line in step — summary cards stay on the full totals */
function applyListFilters(tab, searched, all) {
  const cfg = LIST_TABS[tab], f = listF(tab);
  const minRaw = parseAmount(f.min), maxRaw = parseAmount(f.max);
  const min = !f.min.trim() || Number.isNaN(minRaw) ? null : minRaw;
  const max = !f.max.trim() || Number.isNaN(maxRaw) ? null : maxRaw;
  const backwards = !!(f.from && f.to && f.from > f.to);

  const shown = backwards ? [] : searched.filter((r) => {
    const d = cfg.date(r) || "";
    if (f.from && d < f.from) return false;      /* ISO dates compare in order */
    if (f.to && d > f.to) return false;
    const a = cfg.amount(r);
    if (min !== null && a < min) return false;
    if (max !== null && a > max) return false;
    if (f.extra && cfg.extra && !cfg.extra(r, f.extra)) return false;
    return true;
  });

  const n = listFilterCount(tab);
  const badge = $("#" + cfg.badge);
  badge.hidden = n === 0;
  badge.textContent = String(n);
  $("#" + cfg.btn).classList.toggle("is-on", n > 0);

  const hint = $("#" + cfg.hint);
  hint.classList.toggle("warn", backwards);
  hint.textContent = backwards
    ? "⚠ The “From” date is after the “To” date — nothing can match."
    : `${shown.length} of ${all.length} match`;

  const info = $("#" + cfg.info);
  const active = listFiltersActive(tab);
  info.hidden = !active;
  if (active) {
    info.innerHTML =
      `Showing <b>${shown.length}</b> of ${all.length} · ` +
      `${money(shown.reduce((s, r) => s + cfg.amount(r), 0))} total`;
  }
  return shown;
}

/* one-tap date ranges — same choices as the sales panel */
function listQuickRange(tab, range) {
  const cfg = LIST_TABS[tab], p = cfg.prefix, f = listF(tab);
  const t = todayISO();
  if (range === "all") { f.from = ""; f.to = ""; }
  else if (range === "today") { f.from = t; f.to = t; }
  else if (range === "yesterday") {
    const d = new Date(); d.setDate(d.getDate() - 1);
    f.from = f.to = isoOf(d);
  } else if (range === "week") {
    const d = new Date();
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);   /* Monday of this week */
    f.from = isoOf(d); f.to = t;
  } else if (range === "month") { f.from = monthStartISO(); f.to = t; }
  else if (range === "lastmonth") {
    const d = new Date();
    f.from = isoOf(new Date(d.getFullYear(), d.getMonth() - 1, 1));
    f.to = isoOf(new Date(d.getFullYear(), d.getMonth(), 0));   /* last day of previous month */
  } else if (range === "custom") { $("#" + p + "-from").focus(); return; }

  $("#" + p + "-from").value = f.from;
  $("#" + p + "-to").value = f.to;
  $$("#" + p + "-quick .seg").forEach((b) => b.classList.toggle("active", b.dataset.range === range));
  cfg.render();
}

function clearListFilters(tab) {
  const cfg = LIST_TABS[tab], p = cfg.prefix;
  state.lf[tab] = { from: "", to: "", min: "", max: "", extra: "" };
  state[cfg.searchKey] = "";
  $("#" + cfg.searchId).value = "";
  [p + "-from", p + "-to", p + "-min", p + "-max", p + "-extra"]
    .forEach((id) => { const el = $("#" + id); if (el) el.value = ""; });
  $$("#" + p + "-quick .seg").forEach((b) => b.classList.toggle("active", b.dataset.range === "all"));
  cfg.render();
  toast("Filters cleared");
}
