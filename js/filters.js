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
/* Each entry names the elements that belong to the tab (button, panel, search box,
   badge, hint, info line), how to read one row's date and amount, an optional
   "extra" rule for status-style filtering, and how to redraw the list */
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
    /* extra choices: back = already returned, late = not returned and past its
       due date (or with an overdue instalment), anything else = still open */
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
  cashin: {
    prefix: "cf", searchKey: "cashinSearch", searchId: "cashin-search",
    btn: "cashin-filter-btn", panel: "cashin-filters", badge: "cashin-filter-count",
    hint: "cashin-filter-hint", clear: "cashin-filter-clear", info: "cashin-list-info",
    date: (r) => r.entry_date, amount: (r) => num(r.amount),
    render: () => renderCashIn(),
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
    /* balance buckets: paid = nothing left, part = some but not all of the
       amount, overdue = past its due date with money still owing, anything
       else = still owed (0.009 absorbs rounding dust) */
    extra: (r, v) =>
      v === "overdue" ? !!r.due_date && r.due_date < todayISO() && r.bal > 0.009
      : v === "paid" ? r.bal <= 0.009
      : v === "part" ? r.bal > 0.009 && r.bal < num(r.amount) - 0.009
      : r.bal > 0.009,
    render: () => renderPayables(),
  },
};

/* Get this tab's filter values (from/to dates, min/max amount, extra choice);
   an empty set is created the first time the tab is used */
const listF = (tab) => (state.lf[tab] ||= { from: "", to: "", min: "", max: "", extra: "" });

/* How many filter fields are filled in — this is the number on the ⚙ badge */
function listFilterCount(tab) {
  const f = listF(tab);
  return ["from", "to", "min", "max", "extra"].filter((k) => String(f[k] || "").trim() !== "").length;
}
/* True when the search box or any filter field holds something */
const listFiltersActive = (tab) =>
  String(state[LIST_TABS[tab].searchKey] || "").trim() !== "" || listFilterCount(tab) > 0;

/* narrows `searched` to what the panel allows and keeps the badge, hint and
   "showing" line in step — summary cards stay on the full totals */
function applyListFilters(tab, searched, all) {
  const cfg = LIST_TABS[tab], f = listF(tab);
  /* min/max arrive as text; blank or unparseable means "no limit" (null) */
  const minRaw = parseAmount(f.min), maxRaw = parseAmount(f.max);
  const min = !f.min.trim() || Number.isNaN(minRaw) ? null : minRaw;
  const max = !f.max.trim() || Number.isNaN(maxRaw) ? null : maxRaw;
  /* a "From" date after the "To" date can never match — flag it below */
  const backwards = !!(f.from && f.to && f.from > f.to);

  /* keep only rows inside the date range, amount range and this tab's extra rule */
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

  /* number of active filters drives the ⚙ badge and the button highlight */
  const n = listFilterCount(tab);
  const badge = $("#" + cfg.badge);
  badge.hidden = n === 0;
  badge.textContent = String(n);
  $("#" + cfg.btn).classList.toggle("is-on", n > 0);

  /* the hint warns about reversed dates, otherwise it shows "X of Y match" */
  const hint = $("#" + cfg.hint);
  hint.classList.toggle("warn", backwards);
  hint.textContent = backwards
    ? "⚠ The “From” date is after the “To” date — nothing can match."
    : `${shown.length} of ${all.length} match`;

  /* the "Showing X of Y · total" line — only shown once a search/filter is on */
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
  /* turn the tapped button into a From/To range on the tab's filter object */
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
  /* custom = no range to fill in here; just put the cursor in the From box */
  } else if (range === "custom") { $("#" + p + "-from").focus(); return; }

  /* copy the range into the From/To boxes, highlight the tapped button, redraw */
  $("#" + p + "-from").value = f.from;
  $("#" + p + "-to").value = f.to;
  $$("#" + p + "-quick .seg").forEach((b) => b.classList.toggle("active", b.dataset.range === range));
  cfg.render();
}

/* Reset every filter control for this tab (dates, amounts, extra, search)
   back to "show everything", then redraw the list */
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
