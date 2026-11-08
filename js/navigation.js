/* ============================================================
   navigation.js - which tab is open + the shared state object
   -----------------------------------------------------------
   state is THE one object every file reads and writes (loaded rows,
   search boxes, filter values). switchView() shows a tab and loads its data.
   PROVIDES: state, loaders, switchView
   ============================================================ */

/* ============ navigation ============ */
const state = {
  view: "dashboard",
  range: "month",
  from: null,
  to: null,
  sales: [],
  salesPay: {},
  salesmen: [],
  search: "",
  /* sales filters (⚙ Filters panel) */
  f: {
    source: "", salesman: "", kind: "", status: "",
    from: "", to: "", min: "", max: "", quick: "all",
  },
  recSearch: "",
  loanSearch: "",
  loanRows: [],
  expSearch: "",
  expenseRows: [],
  purchaseSearch: "",
  purchaseRows: [],
  zakatSearch: "",
  zakatRows: [],
  paySearch: "",
  payRows: [],
  recOpen: [],
  recOverdue: new Set(),
  /* ⚙ filter panels on the other list tabs (sales keeps state.f above) */
  lf: {},
  payMax: 0,
  returnTo: null,
  returnSaleId: null,
  returnLoanId: null,
};

/* view name -> the function that loads it (wrapped in arrows so this file
   can load before the screens exist - everything is called at runtime) */
const loaders = {
  dashboard: () => loadDashboard(),
  sales: () => loadSales(),
  purchases: () => loadPurchases(),
  loans: () => loadLoans(),
  expenses: () => loadExpenses(),
  zakat: () => loadZakat(),
  receivables: () => loadReceivables(),
  payables: () => loadPayables(),
};

function switchView(view, force = false) {
  if (!force && state.view === view) return;
  state.view = view;
  $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $$(".bnav").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  closeModals();
  loaders[view]().catch((e) => toast(e.message, true));
}
