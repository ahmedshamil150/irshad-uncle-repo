/* ============================================================
   navigation.js - which tab is open + the shared state object
   -----------------------------------------------------------
   state is THE one object every file reads and writes (loaded rows,
   search boxes, filter values). switchView() shows a tab and loads its data.
   Also holds the access layer: state.me (who is logged in and what they
   may touch) + applyAccess() which hides forbidden tabs and buttons.
   PROVIDES: state, loaders, switchView, applyAccess, allowedView
   ============================================================ */

/* ============ navigation ============ */
const state = {
  view: "dashboard",
  /* this user's permissions from app_users — loaded by loadMe() in auth.js
     right after login ({ is_admin, perms }); null until then = no access */
  me: null,
  range: "month",   // dashboard date range: "month" | "year" | "custom"
  from: null,
  to: null,
  sales: [],
  salesPay: {},   // sale id → total paid so far (subtracted from the balance due)
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
  /* the supplier card picked on the Purchases summary row (null = all) */
  purchaseSupplier: null,
  zakatSearch: "",
  zakatRows: [],
  cashinSearch: "",
  cashInRows: [],
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
  /* the expense card whose detail sheet was last open (the form can return
     to it — see dismissModals in core.js) */
  expDetailId: null,
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
  cashin: () => loadCashIn(),
  receivables: () => loadReceivables(),
  payables: () => loadPayables(),
};

/* The first screen this user is allowed to read — a blocked switchView()
   silently lands here instead of showing a screen they may not see. */
function allowedView() {
  return FLOW_LIST.find((f) => can(f, "read")) || "dashboard";
}

/* Toolbar buttons that only make sense with write access, grouped by flow.
   Row-level buttons (Edit / ✕ / Pay) are gated inside each screen's renderer. */
const WRITE_BTNS = {
  sales:      ["#new-sale-btn", "#manage-salesmen-btn"],
  purchases:  ["#new-purchase-btn"],
  loans:      ["#new-loan-btn"],
  expenses:   ["#new-expense-btn"],
  zakat:      ["#new-zakat-btn"],
  cashin:     ["#new-cashin-btn"],
  payables:   ["#new-payable-btn"],
};

/* Shows/hides the tabs, the toolbar action buttons and the admin-only Users
   button to match the permissions in state.me. Runs once per login, right
   after loadMe() has filled state.me (auth.js). */
function applyAccess() {
  /* tabs + bottom nav: only flows the user may read stay visible */
  $$(".tab, .bnav").forEach((t) => (t.hidden = !can(t.dataset.view, "read")));
  /* "+ New ..." / "Salesmen" buttons: only with write access on that flow */
  for (const [flow, sels] of Object.entries(WRITE_BTNS)) {
    sels.forEach((s) => {
      const el = $(s);
      if (el) el.hidden = !can(flow, "write");
    });
  }
  /* the Users button in the header is for admins alone */
  $("#users-btn").hidden = !state.me?.is_admin;
}

function switchView(view, force = false) {
  if (!force && state.view === view) return;
  /* no access to that screen? quietly go to the first allowed one instead */
  if (!can(view, "read")) view = allowedView();
  state.view = view;
  $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $$(".bnav").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  closeModals();
  loaders[view]().catch((e) => toast(e.message, true));
}
