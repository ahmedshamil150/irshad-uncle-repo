/* ============ client & helpers ============ */
if (!window.ENV?.SUPABASE_URL || !window.ENV?.SUPABASE_ANON_KEY) {
  document.body.innerHTML =
    '<div style="padding:30px;font-family:sans-serif;max-width:640px;margin:auto">' +
    "<h2>Configuration missing</h2><p><code>config.js</code> was not loaded. " +
    "Run <code>npm start</code> (or <code>npm run build</code>) and open the <code>dist/</code> folder — " +
    "do not serve the project root directly.</p></div>";
  throw new Error("config.js missing");
}
if (!window.supabase?.createClient) {
  document.body.innerHTML =
    '<div style="padding:30px;font-family:sans-serif;max-width:640px;margin:auto">' +
    "<h2>Library failed to load</h2><p><code>vendor/supabase.js</code> is missing or blocked.</p></div>";
  throw new Error("supabase lib missing");
}

const sb = window.supabase.createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) =>
  "Rs " + new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(Math.round(num(n)));
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
/* office / dealer / salesman → Office / Dealer / Salesman */
const srcName = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

/* ---------- friendly money entry: "5l", "50k", "2million", "5,00,000" → number ---------- */
const AMOUNT_UNITS = {
  million: 1e6, m: 1e6,   /* 1 million = 10 lac */
  l: 1e5,         /* lac */
  k: 1e3,         /* thousand */
};
/* Returns a number, or NaN when the text cannot be read as an amount. */
function parseAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? "").toLowerCase();
  if (!s.trim()) return 0;
  s = s.replace(/₨|pkr|rupees/g, "").replace(/\brs\b/g, "").replace(/[,']/g, "");
  let rest = s, total = 0, found = false;
  const re = /(\d+(?:\.\d+)?|\.\d+)\s*([a-z]+)?/g;
  let m;
  while ((m = re.exec(s))) {
    let mult = 1;
    if (m[2]) {
      const unit = m[2].replace(/s$/, "");   /* millions → million */
      if (!(unit in AMOUNT_UNITS)) return NaN;
      mult = AMOUNT_UNITS[unit];
    }
    total += parseFloat(m[1]) * mult;
    found = true;
    rest = rest.replace(m[0], " ");
  }
  if (!found || rest.replace(/[\s.]+/g, "")) return NaN;
  return round2(total);
}
/* Safe read for live previews (garbage shows as 0, save-time validation catches it). */
const amt = (v) => { const n = parseAmount(v); return Number.isNaN(n) ? 0 : n; };
const AMOUNT_HINT = "Couldn't read that amount — try 500000, 5l, 50k or 2million.";

/* several item lines are stored as one newline-separated text column */
const itemsText = (s) =>
  String(s || "").split("\n").map((x) => x.trim()).filter(Boolean).join(" · ");
const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => isoOf(new Date());
const monthStartISO = () => { const d = new Date(); return isoOf(new Date(d.getFullYear(), d.getMonth(), 1)); };
const yearStartISO = () => { const d = new Date(); return isoOf(new Date(d.getFullYear(), 0, 1)); };
const addMonths = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(y, m - 1 + n, 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return isoOf(new Date(base.getFullYear(), base.getMonth(), Math.min(d, last)));
};

let toastTimer;
function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", isErr);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}
const busy = (on) => ($("#busy").hidden = !on);

/* A phone's Back button closes the open sheet instead of leaving the app. */
let modalBackArmed = false;

function openModal(id) {
  closeModals(true);
  const el = $("#" + id);
  el.hidden = false;
  document.body.style.overflow = "hidden";
  const body = el.querySelector(".modal-body");
  if (body) body.scrollTop = 0;              /* reopened sheets start at the top */
  if (!modalBackArmed) {
    modalBackArmed = true;
    history.pushState({ modal: id }, "");
  }
}
function closeModals(keepLock = false) {
  $$(".modal").forEach((m) => (m.hidden = true));
  if (!keepLock) {
    document.body.style.overflow = "";
    if (modalBackArmed) {
      modalBackArmed = false;
      history.back();
    }
  }
}
window.addEventListener("popstate", () => {
  modalBackArmed = false;
  closeModals();   /* modalBackArmed is already false, so no history.back() loop —
                      this path restores body scrolling too */
});

/* closing payment modal returns you to the sale/loan detail it was opened from */
function dismissModals() {
  const open = $$(".modal").find((m) => !m.hidden);
  closeModals();
  if (open?.id === "modal-payment" && state.returnTo === "modal-sale-detail" && state.returnSaleId) {
    openSaleDetail(state.returnSaleId).catch(() => {});
  }
  if (open?.id === "modal-payment" && state.returnTo === "modal-loan-detail" && state.returnLoanId) {
    openLoanDetail(state.returnLoanId).catch(() => {});
  }
}

/* confirm dialog */
let confirmCb = null;
function askConfirm(title, text, cb) {
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  confirmCb = cb;
  openModal("modal-confirm");
}

/* ============ auth ============ */
let user = null;

async function boot() {
  bindEvents();
  const { data } = await sb.auth.getSession();
  handleSession(data.session);
  sb.auth.onAuthStateChange((_e, s) => handleSession(s));
}

function handleSession(s) {
  user = s?.user || null;
  if (user) {
    $("#login-screen").hidden = true;
    $("#app").hidden = false;
    $("#header-user").textContent = user.email || "";
    switchView(state.view, true);
    loadSalesmen().catch((e) =>
      toast("Salesmen list unavailable — run the new schema.sql in Supabase.", true)
    );
  } else {
    $("#app").hidden = true;
    $("#login-screen").hidden = false;
    $("#login-password").value = "";
  }
}

async function login(e) {
  e.preventDefault();
  const errEl = $("#login-error");
  errEl.hidden = true;
  $("#login-btn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $("#login-email").value.trim(),
    password: $("#login-password").value,
  });
  $("#login-btn").disabled = false;
  if (error) {
    errEl.textContent =
      error.message === "Invalid login credentials"
        ? "Invalid email or password."
        : error.message;
    errEl.hidden = false;
  }
}

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

const loaders = {
  dashboard: loadDashboard,
  sales: loadSales,
  purchases: loadPurchases,
  loans: loadLoans,
  expenses: loadExpenses,
  zakat: loadZakat,
  receivables: loadReceivables,
  payables: loadPayables,
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

/* ============ sales ============ */
async function loadSales() {
  busy(true);
  try {
    const [sR, pR] = await Promise.all([
      sb.from("sales").select("*").order("sale_date", { ascending: false }).order("created_at", { ascending: false }),
      sb.from("payments").select("sale_id,amount"),
    ]);
    if (sR.error) throw sR.error;
    if (pR.error) throw pR.error;
    state.sales = sR.data || [];
    const pay = {};
    for (const p of pR.data || []) if (p.sale_id) pay[p.sale_id] = (pay[p.sale_id] || 0) + num(p.amount);
    state.salesPay = pay;

    $("#customer-names").innerHTML = [
      ...new Set(state.sales.map((r) => r.customer_name)),
    ]
      .map((n) => `<option value="${esc(n)}"></option>`)
      .join("");

    renderSales();
  } finally {
    busy(false);
  }
}

function saleOutstanding(r) {
  return round2(
    num(r.total_amount) - num(r.cash_amount) - num(r.bank_amount) - num(r.adjustment_amount) - num(r.loan_amount) - (state.salesPay[r.id] || 0)
  );
}

/* ---- sales filters ---- */
function activeFilterCount() {
  const f = state.f;
  return ["source", "salesman", "kind", "status", "from", "to", "min", "max"]
    .filter((k) => String(f[k] || "").trim() !== "").length;
}
const filtersActive = () => state.search.trim() !== "" || activeFilterCount() > 0;

function filterSales() {
  const f = state.f;
  const q = state.search.trim().toLowerCase();
  const sm = f.salesman.trim().toLowerCase();
  const minRaw = parseAmount(f.min);
  const maxRaw = parseAmount(f.max);
  const min = !f.min.trim() || Number.isNaN(minRaw) ? null : minRaw;
  const max = !f.max.trim() || Number.isNaN(maxRaw) ? null : maxRaw;

  if (f.from && f.to && f.from > f.to) return [];   /* nothing can match a backwards range */

  return state.sales.filter((r) => {
    if (q && !(r.customer_name || "").toLowerCase().includes(q)) return false;
    if (f.source && r.source !== f.source) return false;
    if (sm && !(r.salesman_name || "").toLowerCase().includes(sm)) return false;
    if (f.kind === "inst" && !r.is_installment) return false;
    if (f.kind === "once" && r.is_installment) return false;
    if (f.status) {
      const bal = saleOutstanding(r);
      if (f.status === "paid" ? bal > 0.009 : bal <= 0.009) return false;
    }
    if (f.from && r.sale_date < f.from) return false;   /* ISO dates compare in order */
    if (f.to && r.sale_date > f.to) return false;
    const t = num(r.total_amount);
    if (min !== null && t < min) return false;
    if (max !== null && t > max) return false;
    return true;
  });
}

function renderSales() {
  const f = state.f;
  const rows = filterSales();
  const active = filtersActive();
  const nFilters = activeFilterCount();

  const badge = $("#sales-filter-count");
  badge.hidden = nFilters === 0;
  badge.textContent = String(nFilters);
  $("#sales-filter-btn").classList.toggle("is-on", nFilters > 0);

  const total = rows.reduce((s, r) => s + num(r.total_amount), 0);
  const due = rows.reduce((s, r) => s + Math.max(saleOutstanding(r), 0), 0);
  const info = $("#sales-list-info");
  info.hidden = false;
  info.innerHTML = active
    ? `Showing <b>${rows.length}</b> of ${state.sales.length} sales · ${money(total)} total · ${money(due)} to receive`
    : `${state.sales.length} sales · ${money(total)} total · ${money(due)} to receive`;

  const hint = $("#sales-filter-hint");
  hint.classList.toggle("warn", !!(f.from && f.to && f.from > f.to));
  hint.textContent =
    f.from && f.to && f.from > f.to
      ? "⚠ The “From” date is after the “To” date — nothing can match."
      : `${rows.length} of ${state.sales.length} sales match`;

  $("#sales-list").innerHTML = rows.length
    ? rows
        .map((r) => {
          const bal = saleOutstanding(r);
          return `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(r.customer_name)}
                <span class="badge badge-${r.source}">${esc(srcName(r.source))}</span>
                ${r.is_installment ? '<span class="badge badge-pending">Installment</span>' : ""}
              </div>
              <div class="row-sub">${fmtDate(r.sale_date)}${r.item_description ? " · " + esc(itemsText(r.item_description)) : ""}${num(r.adjustment_amount) > 0 ? " · Adj " + money(r.adjustment_amount) + (r.adjustment_method ? " (" + r.adjustment_method + ")" : "") + (r.adjustment_item ? " · " + esc(r.adjustment_item) : "") : ""}</div>
            </div>
            <div class="row-right">
              <div class="row-amount">${money(r.total_amount)}</div>
              <div class="row-bal ${bal > 0.009 ? "bal-due" : "bal-ok"}">${bal > 0.009 ? money(bal) + " left" : "Paid in full"}</div>
            </div>
          </div>`;
        })
        .join("")
    : `<div class="empty">${
        active
          ? "No sales match these filters."
          : "No sales yet."
      }</div>`;

  $$("#sales-list .row").forEach((el) =>
    el.addEventListener("click", () => openSaleDetail(el.dataset.id))
  );
}

/* one-tap date ranges for the filter panel */
function applyQuickRange(range) {
  const f = state.f;
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
  } else if (range === "custom") { $("#sf-from").focus(); return; }

  f.quick = range;
  $("#sf-from").value = f.from;
  $("#sf-to").value = f.to;
  $$("#sf-quick .seg").forEach((b) => b.classList.toggle("active", b.dataset.range === range));
  renderSales();
}

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

/* ============ sale detail ============ */
async function openSaleDetail(id) {
  busy(true);
  try {
    const [sR, iR, pR] = await Promise.all([
      sb.from("sales").select("*").eq("id", id).single(),
      sb.from("installments").select("*").eq("sale_id", id).order("installment_no"),
      sb.from("payments").select("*").eq("sale_id", id).order("paid_at"),
    ]);
    if (sR.error) throw sR.error;
    const sale = sR.data;
    const inst = iR.data || [];
    const pays = pR.data || [];

    const paidAtSale = num(sale.cash_amount) + num(sale.bank_amount) + num(sale.adjustment_amount) + num(sale.loan_amount);
    const received = pays.reduce((s, p) => s + num(p.amount), 0);
    const outstanding = round2(num(sale.total_amount) - paidAtSale - received);

    /* installment statuses: payments allocate FIFO over schedule */
    let unpaidBefore = 0;
    const instHtml = inst
      .map((row) => {
        const amount = num(row.amount);
        const allocated = Math.min(Math.max(received - unpaidBefore, 0), amount);
        unpaidBefore += amount;
        const short = round2(amount - allocated);
        let status = "paid";
        if (short > 0.009) {
          if (row.due_date < todayISO()) status = "overdue";
          else status = allocated > 0 ? "partial" : "pending";
        }
        return `<div class="inst-row ${status === "overdue" ? "is-overdue" : status === "paid" ? "is-paid" : ""}">
          <span class="inst-no">#${row.installment_no}</span>
          <span class="inst-due">${fmtDate(row.due_date)}</span>
          <span class="inst-amt">${money(amount)}</span>
          <span class="badge badge-${status}">${status}</span>
        </div>`;
      })
      .join("");

    const paysHtml = pays.length
      ? pays
          .map(
            (p) => `<div class="pay-item">
            <div class="pi-main"><b>${money(p.amount)}</b> <span class="badge badge-${p.method}">${p.method}</span>
              <div class="pi-sub">${fmtDate(p.paid_at)}${p.notes ? " · " + esc(p.notes) : ""}</div>
            </div>
            <button type="button" class="icon-del" data-delpay="${p.id}" title="Delete payment">✕</button>
          </div>`
          )
          .join("")
      : `<div class="empty" style="padding:16px">No payments recorded yet.</div>`;

    $("#sale-detail-body").innerHTML = `
      <div class="row-title" style="font-size:18px">${esc(sale.customer_name)}
        <span class="badge badge-${sale.source}">${esc(srcName(sale.source))}</span>
      </div>
      <div class="row-sub" style="margin-bottom:12px">${fmtDate(sale.sale_date)}${sale.item_description ? " · " + esc(itemsText(sale.item_description)) : ""}${sale.dealer_name ? " · Dealer: " + esc(sale.dealer_name) : ""}${sale.salesman_name ? " · " + esc(sale.salesman_name) : ""}${sale.reference_name ? " · Ref: " + esc(sale.reference_name) : ""}</div>

      <div class="detail-grid">
        <div class="stat tone-brand"><div class="stat-label">Total sale</div><div class="stat-value">${money(sale.total_amount)}</div></div>
        <div class="stat tone-green"><div class="stat-label">Paid upfront</div><div class="stat-value">${money(paidAtSale)}</div>
          <div class="stat-sub">Cash ${money(sale.cash_amount)} · Bank ${money(sale.bank_amount)}${num(sale.adjustment_amount) > 0 ? ` · Adjustment ${money(sale.adjustment_amount)}${sale.adjustment_method ? ` (${sale.adjustment_method})` : ""}${sale.adjustment_item ? ` · ${esc(sale.adjustment_item)}` : ""}` : ""}${num(sale.loan_amount) > 0 ? ` · Loan ${money(sale.loan_amount)}` : ""}</div></div>
        <div class="stat tone-violet"><div class="stat-label">Payments received</div><div class="stat-value">${money(received)}</div></div>
        <div class="stat ${outstanding > 0.009 ? "tone-red" : "tone-green"}"><div class="stat-label">Left to receive</div>
          <div class="stat-value">${money(Math.max(outstanding, 0))}</div></div>
      </div>

      ${sale.notes ? `<div class="section-label">Notes</div><p class="row-sub" style="margin:0">${esc(sale.notes)}</p>` : ""}

      <div class="detail-actions">
        <button type="button" class="btn btn-primary btn-sm" id="detail-pay-btn">+ Add payment</button>
        <button type="button" class="btn btn-ghost btn-sm" id="detail-edit-btn">Edit</button>
        <button type="button" class="btn btn-danger btn-sm" id="detail-del-btn">Delete</button>
      </div>

      ${inst.length ? `<div class="section-label">Installment schedule</div>${instHtml}` : ""}
      <div class="section-label">Payments</div>
      ${paysHtml}`;

    $("#detail-pay-btn").onclick = () => {
      if (outstanding <= 0.009) return toast("This sale is already fully paid.", true);
      openPaymentModal("sale", sale.id, `${sale.customer_name} — still to receive ${money(outstanding)}`, outstanding);
    };
    $("#detail-edit-btn").onclick = () => openSaleForm(sale);
    $("#detail-del-btn").onclick = () =>
      askConfirm("Delete sale?", `Delete the sale for ${sale.customer_name} (${money(sale.total_amount)})? Its installments and payments will also be removed.`, async () => {
        busy(true);
        const { error } = await sb.from("sales").delete().eq("id", sale.id);
        busy(false);
        if (error) return toast(error.message, true);
        closeModals();
        toast("Sale deleted");
        loadSales();
      });
    $$("#sale-detail-body [data-delpay]").forEach((b) =>
      b.addEventListener("click", () =>
        askConfirm("Delete payment?", "This payment will be removed and the amounts updated.", async () => {
          busy(true);
          const { error } = await sb.from("payments").delete().eq("id", b.dataset.delpay);
          busy(false);
          if (error) return toast(error.message, true);
          toast("Payment deleted");
          openSaleDetail(sale.id);
          loadSales();
        })
      )
    );

    openModal("modal-sale-detail");
  } finally {
    busy(false);
  }
}

/* ============ salesmen ============ */
async function loadSalesmen() {
  const { data, error } = await sb.from("salesmen").select("*").order("name");
  if (error) throw error;
  state.salesmen = data || [];
  $("#salesman-names").innerHTML = state.salesmen
    .map((s) => `<option value="${esc(s.name)}"></option>`)
    .join("");
  syncRefNames();
  if (!$("#modal-salesmen").hidden) renderSalesmenList();
}

/* suggestions for the reference name: our saved salesmen (a referrer is often one) */
function syncRefNames() {
  $("#ref-names").innerHTML = state.salesmen
    .map((s) => `<option value="${esc(s.name)}"></option>`)
    .join("");
}

/* suggestions for the dealer name: dealers used on past sales */
function syncDealerNames() {
  const names = [...new Set((state.sales || []).map((s) => s.dealer_name).filter(Boolean))];
  $("#dealer-names").innerHTML = names
    .map((n) => `<option value="${esc(n)}"></option>`)
    .join("");
}

function renderSalesmenList() {
  $("#salesman-list").innerHTML = state.salesmen.length
    ? state.salesmen
        .map(
          (s) => `<div class="row" data-id="${s.id}">
            <div class="row-main"><div class="row-title">${esc(s.name)}</div></div>
            <button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>
          </div>`
        )
        .join("")
    : `<div class="empty">No salesmen yet. Add one above.</div>`;

  $$("#salesman-list .row").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (!e.target.closest('[data-act="del"]')) {
        const saleOpen = !$("#modal-sale").hidden;
        if (saleOpen) {
          $("#sale-salesman").value = el.querySelector(".row-title").textContent;
          closeModals();
        }
        return;
      }
      const s = state.salesmen.find((x) => x.id === el.dataset.id);
      if (!s) return;
      askConfirm("Delete salesman?", `Delete ${s.name}? Sales already recorded keep this name.`, async () => {
        busy(true);
        const { error } = await sb.from("salesmen").delete().eq("id", s.id);
        busy(false);
        if (error) return toast(error.message, true);
        toast("Salesman deleted");
        loadSalesmen().catch((x) => toast(x.message, true));
      });
    });
  });
}

async function saveSalesman(e) {
  e.preventDefault();
  const errEl = $("#salesman-form-error");
  errEl.hidden = true;
  const name = $("#salesman-name").value.trim();
  if (!name) return;

  busy(true);
  const { error } = await sb.from("salesmen").insert({ name });
  busy(false);
  if (error) {
    if (error.code === "23505") {
      errEl.textContent = "That salesman already exists.";
      errEl.hidden = false;
      return;
    }
    return toast(error.message, true);
  }
  toast("Salesman added");
  $("#salesman-name").value = "";
  $("#salesman-name").focus();
  await loadSalesmen();
}

function openSalesmenModal() {
  $("#salesman-name").value = "";
  $("#salesman-form-error").hidden = true;
  renderSalesmenList();
  openModal("modal-salesmen");
}

/* ============ sale form ============ */
function openSaleForm(sale = null) {
  $("#sale-form").reset();
  $("#sale-form-error").hidden = true;
  $("#sale-id").value = sale?.id || "";
  $("#sale-modal-title").textContent = sale ? "Edit sale" : "New sale";
  $("#sale-date").value = sale?.sale_date || todayISO();
  $("#sale-source").value = sale?.source || "office";
  $("#sale-salesman").value = sale?.salesman_name || "";
  $("#sale-dealer").value = sale?.dealer_name || "";
  $("#sale-reference").value = sale?.reference_name || "";
  syncRefNames();
  syncDealerNames();
  $("#sale-customer").value = sale?.customer_name || "";
  renderItems(sale?.item_description);
  $("#sale-total").value = sale ? num(sale.total_amount) : "";
  $("#sale-cash").value = sale && num(sale.cash_amount) ? num(sale.cash_amount) : "";
  $("#sale-bank").value = sale && num(sale.bank_amount) ? num(sale.bank_amount) : "";
  $("#sale-adjustment").value = sale && num(sale.adjustment_amount) ? num(sale.adjustment_amount) : "";
  $("#sale-adjustment-method").value = sale?.adjustment_method || "";
  $("#sale-adjustment-item").value = sale?.adjustment_item || "";
  $("#sale-loan").value = sale ? num(sale.loan_amount) : 0;
  $("#sale-installment").checked = !!sale?.is_installment;
  $("#sale-notes").value = sale?.notes || "";
  $("#inst-count").value = 12;
  $("#inst-first").value = todayISO();

  /* editing an installment sale: load ITS schedule (count + first due date),
     not the defaults — otherwise saving would silently rebuild it as 12 × today */
  if (sale?.is_installment && sale.id) {
    const editingId = sale.id;
    sb.from("installments").select("due_date").eq("sale_id", editingId).order("installment_no", { ascending: true })
      .then(({ data, error }) => {
        if (error || !data || !data.length) return;
        if ($("#sale-id").value !== editingId || $("#modal-sale").hidden) return;   /* modal closed or switched */
        $("#inst-count").value = String(Math.min(120, Math.max(1, data.length)));
        $("#inst-first").value = data[0].due_date;
        syncSaleForm();
      });
  }

  /* open the optional sections only when there is something to show */
  const paidAlready = amt($("#sale-cash").value) + amt($("#sale-bank").value) + amt($("#sale-adjustment").value) + amt($("#sale-loan").value);
  $("#sale-pay-disclose").open = paidAlready > 0;
  $("#sale-more-disclose").open = !!sale && sale.is_installment;   /* notes live with the sale now, not in here */

  syncSaleForm();
  openModal("modal-sale");
}

/* ---- item lines (one per machine/item) ---- */
/* The sale form and the purchase form share one picker procedure;
   each form just points at its own elements. */
const PICKERS = {
  sale:     { list: "#sale-items",         checks: "#item-checks",          machine: "#machine-picker",          add: "#add-item-btn" },
  purchase: { list: "#purchase-items",     checks: "#purchase-item-checks", machine: "#purchase-machine-picker", add: "#add-purchase-item-btn" },
};

function itemRow(value = "") {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML =
    '<input type="text" class="item-input" placeholder="e.g. Ultrasound machine XYZ" />' +
    '<button type="button" class="item-del" title="Remove item" aria-label="Remove item">✕</button>';
  row.querySelector("input").value = value;
  return row;
}
function renderItems(stored, scope = "sale") {
  const box = $(PICKERS[scope].list);
  box.innerHTML = "";
  const list = String(stored || "").split("\n").map((x) => x.trim()).filter(Boolean);
  (list.length ? list : [""]).forEach((v) => box.appendChild(itemRow(v)));
  syncItemChecks(scope);
}
const itemValues = (scope = "sale") =>
  $$(PICKERS[scope].list + " .item-input").map((i) => i.value.trim()).filter(Boolean);

/* ---- machine dropdown + printer/probe checkboxes ---- */
/* A picked machine or ticked box becomes one line in the item list;
   unticking removes that exact line, and lines typed by hand tick the boxes back. */
function addNewItem(value, scope = "sale") {
  const v = String(value || "").trim();
  if (!v) return;
  const empty = $$(PICKERS[scope].list + " .item-input").find((i) => !i.value.trim());
  if (empty) empty.value = v;
  else $(PICKERS[scope].list).appendChild(itemRow(v));
}
function removeItemRow(value, scope = "sale") {
  const want = String(value || "").trim().toLowerCase();
  const hit = $$(PICKERS[scope].list + " .item-input").find((i) => i.value.trim().toLowerCase() === want);
  if (hit) hit.closest(".item-row").remove();
}
function syncItemChecks(scope = "sale") {
  const have = itemValues(scope).map((v) => v.toLowerCase());
  $$(PICKERS[scope].checks + " input").forEach((cb) => { cb.checked = have.includes(cb.value.toLowerCase()); });
}

function syncSaleForm() {
  const src = $("#sale-source").value;
  $("#dealer-field").hidden = src !== "dealer";
  $("#salesman-field").hidden = src !== "salesman";
  $("#reference-field").hidden = src !== "reference";

  const total = amt($("#sale-total").value);
  const paid = amt($("#sale-cash").value) + amt($("#sale-bank").value) + amt($("#sale-adjustment").value) + amt($("#sale-loan").value);
  const adj = amt($("#sale-adjustment").value);
  $("#adjustment-extra").hidden = adj <= 0;   /* tag + item name only apply to a real adjustment */
  const due = round2(total - paid);
  $("#sale-paid-summary").innerHTML =
    total <= 0
      ? `Enter the total above — what is paid and what is left shows here.`
      : `Paid now: <b>${money(paid)}</b>` +
        (adj > 0 ? ` (incl. <b>${money(adj)} adjustment</b>)` : "") +
        ` &nbsp;·&nbsp; Left to pay: <b>${money(Math.max(due, 0))}</b>` +
        (paid > total + 0.009 ? `<br><span style="color:var(--red)">The paid amount is more than the total — fix it before saving.</span>` : "");

  const inst = $("#sale-installment").checked;
  $("#installment-fields").hidden = !inst;
  if (inst) renderInstPreview();
}

function buildSchedule(financed, count, firstDue) {
  const per = Math.floor((financed / count) * 100) / 100;
  const rows = [];
  let remaining = round2(financed);
  for (let i = 1; i <= count; i++) {
    const rowAmt = i === count ? round2(remaining) : per;
    if (rowAmt <= 0) break;
    rows.push({ no: i, due: addMonths(firstDue, i - 1), amount: rowAmt });
    remaining = round2(remaining - rowAmt);
  }
  return rows;
}

function renderInstPreview() {
  const total = amt($("#sale-total").value);
  const paid = amt($("#sale-cash").value) + amt($("#sale-bank").value) + amt($("#sale-adjustment").value) + amt($("#sale-loan").value);
  const financed = round2(total - paid);
  const count = Math.max(1, Math.min(120, parseInt($("#inst-count").value, 10) || 0));
  const first = $("#inst-first").value;
  const el = $("#inst-preview");

  if (financed <= 0) { el.innerHTML = "Everything is already paid, so there is nothing left to split into installments."; return; }
  if (!first) { el.innerHTML = "Pick a first due date to see the schedule."; return; }

  const rows = buildSchedule(financed, count, first);
  const per = rows[0]?.amount || 0;
  el.innerHTML = `
    <div class="inst-line"><span>${count} × ${money(per)}</span><span>${money(financed)} financed</span></div>
    <div class="inst-line"><span>First due ${fmtDate(rows[0].due)}</span><span>Last due ${fmtDate(rows[rows.length - 1].due)}</span></div>`;
}

async function saveSale(e) {
  e.preventDefault();
  const errEl = $("#sale-form-error");
  errEl.hidden = true;
  const id = $("#sale-id").value;
  const source = $("#sale-source").value;
  const customer = $("#sale-customer").value.trim();
  const refName = $("#sale-reference").value.trim();
  const totalRaw = $("#sale-total").value.trim();
  const totalN = parseAmount(totalRaw);
  const cashN = parseAmount($("#sale-cash").value);
  const bankN = parseAmount($("#sale-bank").value);
  const adjN = parseAmount($("#sale-adjustment").value);
  const loanN = parseAmount($("#sale-loan").value);
  const isInst = $("#sale-installment").checked;
  const count = parseInt($("#inst-count").value, 10) || 0;
  const first = $("#inst-first").value;

  const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };
  if (!customer) return fail("Please enter the customer name.");
  if (!totalRaw) return fail("Enter the total sale amount.");
  if ([totalN, cashN, bankN, adjN, loanN].some(Number.isNaN)) return fail(AMOUNT_HINT);
  const total = round2(totalN);
  const cash = round2(cashN);
  const bank = round2(bankN);
  const adjustment = round2(adjN);
  const loan = round2(loanN);
  const financed = round2(total - cash - bank - adjustment - loan);
  if (total <= 0) return fail("Enter the total sale amount.");
  if (cash + bank + adjustment + loan > total + 0.009) return fail("The paid amount can't be more than the total sale.");
  if (source === "salesman" && !$("#sale-salesman").value.trim()) return fail("Please enter the salesman name.");
  if (source === "reference" && !refName) return fail("Please enter the reference name.");
  if (isInst) {
    if (financed <= 0) return fail("For installments, leave some amount unpaid (total minus paid).");
    if (count < 1 || count > 120) return fail("Enter between 1 and 120 installments.");
    if (!first) return fail("Pick the first due date.");
  }

  const payload = {
    sale_date: $("#sale-date").value || todayISO(),
    customer_name: customer,
    source,
    salesman_name: source === "salesman" ? $("#sale-salesman").value.trim() : null,
    dealer_name: source === "dealer" ? $("#sale-dealer").value.trim() || null : null,
    reference_name: source === "reference" ? refName : null,
    item_description: itemValues().join("\n") || null,
    total_amount: total,
    cash_amount: cash,
    bank_amount: bank,
    adjustment_amount: adjustment,
    adjustment_method: adjustment > 0 ? ($("#sale-adjustment-method").value || null) : null,
    adjustment_item: adjustment > 0 ? ($("#sale-adjustment-item").value.trim() || null) : null,
    loan_amount: loan,
    is_installment: isInst,
    notes: $("#sale-notes").value.trim() || null,
  };

  busy(true);
  try {
    let saleId = id;
    if (id) {
      const { error } = await sb.from("sales").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from("sales").insert(payload).select("id").single();
      if (error) throw error;
      saleId = data.id;
    }

    /* The schedule always follows what the form says — even when payments exist.
       Payment allocation and "overdue" are computed live from these rows, so they
       stay correct after a rebuild. Editing also clears a stale schedule when
       installments are unchecked. */
    if (id) {
      const { error: delErr } = await sb.from("installments").delete().eq("sale_id", saleId);
      if (delErr) throw delErr;
    }
    if (isInst) {
      const rows = buildSchedule(financed, count, first).map((r) => ({
        sale_id: saleId, installment_no: r.no, due_date: r.due, amount: r.amount,
      }));
      if (rows.length) {
        const { error } = await sb.from("installments").insert(rows);
        if (error) throw error;
      }
    }

    closeModals();
    toast(id ? "Sale updated" : "Sale added");
    if (state.view === "sales") loadSales();
    else if (state.view === "receivables") loadReceivables();
    else if (state.view === "dashboard") loadDashboard();
  } catch (err) {
    fail(err.message);
  } finally {
    busy(false);
  }
}

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

/* ============ payables ============ */
async function loadPayables() {
  busy(true);
  try {
    const [bR, pR, puR] = await Promise.all([
      sb.from("payables").select("*").order("entry_date", { ascending: false }),
      sb.from("payments").select("payable_id,purchase_id,amount"),
      sb.from("purchases").select("*").order("entry_date", { ascending: false }),
    ]);
    if (bR.error) throw bR.error;
    if (pR.error) throw pR.error;
    if (puR.error) throw puR.error;
    const pay = {}, payP = {};
    for (const p of pR.data || []) {
      if (p.payable_id) pay[p.payable_id] = (pay[p.payable_id] || 0) + num(p.amount);
      if (p.purchase_id) payP[p.purchase_id] = (payP[p.purchase_id] || 0) + num(p.amount);
    }

    /* what we owe on purchases joins the list — only the still-unpaid part,
       tagged so the row can open the purchase instead of the owe form */
    const owedPurchases = (puR.data || [])
      .map((r) => ({
        ...r,
        isPurchase: true,
        party: r.supplier || oneLine(r.title),
        bal: round2(num(r.amount) - num(r.cash_amount) - num(r.bank_amount) - (payP[r.id] || 0)),
      }))
      .filter((r) => r.bal > 0.009);

    state.payRows = [
      ...(bR.data || []).map((r) => ({ ...r, bal: round2(num(r.amount) - (pay[r.id] || 0)) })),
      ...owedPurchases,
    ].sort((a, b) => String(b.entry_date || "").localeCompare(String(a.entry_date || "")));
    renderPayables();
  } finally {
    busy(false);
  }
}

function renderPayables() {
  const all = state.payRows || [];
  const q = state.paySearch.toLowerCase();
  const searched = all.filter(
    (r) =>
      !q ||
      (r.party || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q) ||
      (r.title || "").toLowerCase().includes(q)
  );
  const rows = applyListFilters("payables", searched, all);

  $("#payable-list").innerHTML = rows.length
    ? rows
        .map((r) => `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(r.party)}${r.isPurchase ? ' <span class="badge badge-partial">Purchase</span>' : ""}</div>
              <div class="row-sub">${fmtDate(r.entry_date)}${r.isPurchase && r.supplier ? " · " + esc(oneLine(r.title)) : ""}${r.notes ? " · " + esc(r.notes) : ""}</div>
            </div>
            <div class="row-right">
              <div class="row-amount">${money(r.amount)}</div>
              <div class="row-bal ${r.bal > 0.009 ? "bal-due" : "bal-ok"}">${r.bal > 0.009 ? money(r.bal) + " left" : "Paid"}</div>
            </div>
            <div class="row-actions">
              ${r.bal > 0.009 ? `<button type="button" class="btn btn-sm btn-primary" data-act="pay">+ Pay</button>` : ""}
              <button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>
              <button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>
            </div>
          </div>`)
        .join("")
    : `<div class="empty">${
        all.length === 0 || !listFiltersActive("payables")
          ? "Nothing to pay yet."
          : "Nothing matches these filters."
      }</div>`;

  $$("#payable-list .row").forEach((el) => {
      const r = rows.find((x) => x.id === el.dataset.id);
      el.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        const target = r.isPurchase ? "purchase" : "payable";
        if (act === "pay") openPaymentModal(target, r.id, `${r.party} — still to pay ${money(r.bal)}`, r.bal);
        else if (act === "edit") r.isPurchase ? openPurchaseForm(r) : openPayableForm(r);
        else if (act === "del")
          askConfirm(
            r.isPurchase ? "Delete this purchase?" : "Delete this entry?",
            r.isPurchase
              ? `Delete ${oneLine(r.title)} (${money(r.amount)})? Its schedule and payments will be removed too.`
              : `Delete ${r.party} (${money(r.amount)})? Payments recorded against it will be removed too.`,
            async () => {
              busy(true);
              const { error } = await sb.from(r.isPurchase ? "purchases" : "payables").delete().eq("id", r.id);
              busy(false);
              if (error) return toast(error.message, true);
              toast(r.isPurchase ? "Purchase deleted" : "Entry deleted");
              if (r.isPurchase && state.view === "purchases") loadPurchases();
              loadPayables();
            });
        else if (r.bal > 0.009) openPaymentModal(target, r.id, `${r.party} — still to pay ${money(r.bal)}`, r.bal);
        else if (r.isPurchase) openPurchaseForm(r);
        else openPayableForm(r);
      });
    });
}

function openPayableForm(r = null) {
  $("#payable-form").reset();
  $("#payable-form-error").hidden = true;
  $("#payable-id").value = r?.id || "";
  $("#payable-modal-title").textContent = r ? "Edit what you owe" : "Add what you owe";
  $("#payable-date").value = r?.entry_date || todayISO();
  $("#payable-amount").value = r ? num(r.amount) : "";
  $("#payable-party").value = r?.party || "";
  $("#payable-notes").value = r?.notes || "";
  openModal("modal-payable");
}

async function savePayable(e) {
  e.preventDefault();
  const errEl = $("#payable-form-error");
  errEl.hidden = true;
  const id = $("#payable-id").value;
  const amountN = parseAmount($("#payable-amount").value);
  const payload = {
    entry_date: $("#payable-date").value || todayISO(),
    party: $("#payable-party").value.trim(),
    amount: round2(amountN),
    notes: $("#payable-notes").value.trim() || null,
  };
  if (Number.isNaN(amountN)) { errEl.textContent = AMOUNT_HINT; errEl.hidden = false; return; }
  if (!payload.party) { errEl.textContent = "Please enter who you owe (dealer / supplier name)."; errEl.hidden = false; return; }
  if (payload.amount <= 0) { errEl.textContent = "Enter the amount you owe."; errEl.hidden = false; return; }

  busy(true);
  try {
    const { error } = id
      ? await sb.from("payables").update(payload).eq("id", id)
      : await sb.from("payables").insert(payload);
    if (error) throw error;
    closeModals();
    toast(id ? "Entry updated" : "Entry added");
    loadPayables();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    busy(false);
  }
}

/* ============ personal loans (money we gave out) ============ */
async function loadLoans() {
  busy(true);
  try {
    const [lR, iR, pR] = await Promise.all([
      sb.from("personal_loans").select("*")
        .order("loan_date", { ascending: false })
        .order("created_at", { ascending: false }),
      sb.from("loan_installments").select("loan_id,installment_no,due_date,amount"),
      sb.from("payments").select("loan_id,amount"),
    ]);
    if (lR.error) throw lR.error;
    if (iR.error) throw iR.error;
    if (pR.error) throw pR.error;

    const pay = {};
    for (const p of pR.data || []) if (p.loan_id) pay[p.loan_id] = (pay[p.loan_id] || 0) + num(p.amount);
    const instMap = {};
    for (const s of iR.data || []) (instMap[s.loan_id] ||= []).push(s);
    for (const k of Object.keys(instMap)) instMap[k].sort((a, b) => a.installment_no - b.installment_no);

    const today = todayISO();
    state.loanRows = (lR.data || []).map((r) => {
      const received = round2(pay[r.id] || 0);
      const sched = instMap[r.id] || [];
      /* payments allocate FIFO over the schedule — same rule as sales */
      let unpaidBefore = 0, instPaid = 0, overdueInst = false;
      for (const s of sched) {
        const a = num(s.amount);
        const allocated = Math.min(Math.max(received - unpaidBefore, 0), a);
        unpaidBefore += a;
        if (a - allocated <= 0.009) instPaid++;
        else if (s.due_date < today) overdueInst = true;
      }
      return {
        ...r,
        received,
        left: round2(num(r.amount) - received),
        instCount: sched.length,
        instPaid,
        overdueInst,
      };
    });
    renderLoans();
  } finally {
    busy(false);
  }
}

function renderLoans() {
    const rows = state.loanRows;
    const today = todayISO();

    $("#loan-names").innerHTML = [...new Set(rows.map((r) => r.person))]
      .map((n) => `<option value="${esc(n)}"></option>`)
      .join("");

    const open = rows.filter((r) => !r.returned_at);
    const back = rows.filter((r) => r.returned_at);
    const late = open.filter((r) => (r.due_date && r.due_date < today) || r.overdueInst);
    /* "still to get back" = what is actually left of each loan, part by part included */
    const outTotal = open.reduce((s, r) => s + Math.max(r.left, 0), 0);
    const allTotal = rows.reduce((s, r) => s + num(r.amount), 0);
    const lateTotal = late.reduce((s, r) => s + Math.max(r.left, 0), 0);

    $("#loan-summary").innerHTML = `
      <div class="stat tone-red"><div class="stat-label">Still to get back</div><div class="stat-value">${money(outTotal)}</div><div class="stat-sub">${open.length} loan${open.length === 1 ? "" : "s"} out</div></div>
      <div class="stat tone-amber"><div class="stat-label">Past the due date</div><div class="stat-value">${late.length}</div><div class="stat-sub">${money(lateTotal)} late</div></div>
      <div class="stat tone-brand"><div class="stat-label">Given out (all)</div><div class="stat-value">${money(allTotal)}</div><div class="stat-sub">${back.length} returned</div></div>`;

    const q = state.loanSearch.toLowerCase();
    const searched = rows.filter((r) => !q || (r.person || "").toLowerCase().includes(q));
    const shown = applyListFilters("loans", searched, rows);

    $("#loan-list").innerHTML = shown.length
      ? shown
          .map((r) => {
            const isBack = !!r.returned_at;
            const isLate = !isBack && ((r.due_date && r.due_date < today) || r.overdueInst);
            const hasInst = r.instCount > 0;
            return `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(r.person)}
                ${isBack ? '<span class="badge badge-paid">Returned</span>' : isLate ? '<span class="badge badge-overdue">Late</span>' : ""}
              </div>
              <div class="row-sub">Given ${fmtDate(r.loan_date)}${r.due_date ? " · Back by " + fmtDate(r.due_date) : ""}${hasInst ? ` · ${r.instCount} installments` : ""}${isBack ? " · Back on " + fmtDate(String(r.returned_at).slice(0, 10)) : ""}${r.notes ? " · " + esc(r.notes) : ""}</div>
            </div>
            <div class="row-right">
              ${isBack || !hasInst
                ? `<div class="row-amount ${isBack ? "" : "bal-due"}">${money(r.amount)}</div>
                   <div class="row-bal" style="color:var(--muted)">${isBack ? "returned" : "to get back"}</div>`
                : `<div class="row-amount ${r.left > 0.009 ? "bal-due" : ""}">${money(Math.max(r.left, 0))}</div>
                   <div class="row-bal" style="color:var(--muted)">left · ${r.instPaid}/${r.instCount} back</div>`}
            </div>
            <div class="row-actions">
              ${isBack
                ? `<button type="button" class="btn btn-sm btn-ghost" data-act="undo">↩ Not back yet</button>`
                : `<button type="button" class="btn btn-sm btn-primary" data-act="back">✓ Returned</button>`}
              <button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>
              <button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>
            </div>
          </div>`;
          })
          .join("")
      : `<div class="empty">${listFiltersActive("loans") ? "No loans match these filters." : "No loans yet."}</div>`;

    $$("#loan-list .row").forEach((el) => {
      const r = rows.find((x) => x.id === el.dataset.id);
      el.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "back") setLoanReturned(r, true);
        else if (act === "undo") setLoanReturned(r, false);
        else if (act === "edit") openLoanForm(r);
        else if (act === "del")
          askConfirm("Delete this loan?", `Delete the ${money(r.amount)} loan to ${r.person}?${r.instCount ? " Its schedule and returns will also be removed." : ""}`, async () => {
            busy(true);
            const { error } = await sb.from("personal_loans").delete().eq("id", r.id);
            busy(false);
            if (error) return toast(error.message, true);
            toast("Loan deleted");
            loadLoans();
          });
        /* installment loans open their detail sheet (schedule + returns);
           plain loans still jump straight to the edit form */
        else if (r.instCount > 0) openLoanDetail(r.id);
        else openLoanForm(r);
      });
    });
}

async function setLoanReturned(r, returned) {
  busy(true);
  const { error } = await sb
    .from("personal_loans")
    .update({ returned_at: returned ? new Date().toISOString() : null })
    .eq("id", r.id);
  busy(false);
  if (error) return toast(error.message, true);
  toast(returned ? "Marked as returned" : "Back on the list to get back");
  loadLoans();
}

async function openLoanForm(r = null) {
  try {
    $("#loan-form").reset();
    $("#loan-form-error").hidden = true;
    $("#loan-id").value = r?.id || "";
    $("#loan-modal-title").textContent = r ? "Edit loan" : "New loan";
    $("#loan-date").value = r?.loan_date || todayISO();
    $("#loan-person").value = r?.person || "";
    $("#loan-amount").value = r ? num(r.amount) : "";
    $("#loan-due").value = r?.due_date || "";
    $("#loan-notes").value = r?.notes || "";
    $("#loan-installment").checked = false;
    $("#loan-inst-count").value = "12";
    $("#loan-inst-first").value = "";
    if (r) {
      /* restore the saved schedule: months + first due date */
      const { data: sched, error } = await sb
        .from("loan_installments").select("*").eq("loan_id", r.id).order("installment_no");
      if (error) throw error;
      if (sched?.length) {
        $("#loan-installment").checked = true;
        $("#loan-inst-count").value = String(sched.length);
        $("#loan-inst-first").value = sched[0].due_date;
      }
    }
    syncLoanForm();
    openModal("modal-loan");
  } catch (err) {
    toast(err.message, true);
  }
}

function syncLoanForm() {
  const inst = $("#loan-installment").checked;
  $("#loan-inst-fields").hidden = !inst;
  if (inst) renderLoanInstPreview();
}

function renderLoanInstPreview() {
  const total = amt($("#loan-amount").value);
  const count = Math.max(1, Math.min(120, parseInt($("#loan-inst-count").value, 10) || 0));
  const first = $("#loan-inst-first").value;
  const el = $("#loan-inst-preview");

  if (total <= 0) { el.innerHTML = "Enter the amount above to see the schedule."; return; }
  if (!first) { el.innerHTML = "Pick a first due date to see the schedule."; return; }

  /* the whole loan comes back — nothing is paid up front */
  const rows = buildSchedule(total, count, first);
  const per = rows[0]?.amount || 0;
  el.innerHTML = `
    <div class="inst-line"><span>${count} × ${money(per)}</span><span>${money(total)} to get back</span></div>
    <div class="inst-line"><span>First due ${fmtDate(rows[0].due)}</span><span>Last due ${fmtDate(rows[rows.length - 1].due)}</span></div>`;
}

async function saveLoan(e) {
  e.preventDefault();
  const errEl = $("#loan-form-error");
  errEl.hidden = true;
  const id = $("#loan-id").value;
  const person = $("#loan-person").value.trim();
  const amountN = parseAmount($("#loan-amount").value);
  const isInst = $("#loan-installment").checked;
  const count = parseInt($("#loan-inst-count").value, 10) || 0;
  const first = $("#loan-inst-first").value;
  const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };

  const payload = {
    loan_date: $("#loan-date").value || todayISO(),
    person,
    amount: round2(amountN),
    due_date: $("#loan-due").value || null,
    notes: $("#loan-notes").value.trim() || null,
  };
  if (!person) return fail("Please enter who you gave the money to.");
  if (Number.isNaN(amountN)) return fail(AMOUNT_HINT);
  if (payload.amount <= 0) return fail("Enter how much you gave.");
  if (isInst) {
    if (count < 1 || count > 120) return fail("Enter between 1 and 120 installments.");
    if (!first) return fail("Pick the first due date.");
  }

  /* schedule of returns; when "Back by" is empty it becomes the last due date */
  let schedule = [];
  if (isInst) {
    schedule = buildSchedule(payload.amount, count, first);
    if (!payload.due_date) payload.due_date = schedule[schedule.length - 1].due;
  }
  if (payload.due_date && payload.due_date < payload.loan_date) return fail("“Back by” is before the day the money was given.");

  busy(true);
  try {
    let loanId = id;
    if (id) {
      const { error } = await sb.from("personal_loans").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from("personal_loans").insert(payload).select("id").single();
      if (error) throw error;
      loanId = data.id;
    }

    /* the schedule always follows what the form says (same rebuild rule as sales) */
    if (id) {
      const { error: delErr } = await sb.from("loan_installments").delete().eq("loan_id", loanId);
      if (delErr) throw delErr;
    }
    if (schedule.length) {
      const rows = schedule.map((r) => ({
        loan_id: loanId, installment_no: r.no, due_date: r.due, amount: r.amount,
      }));
      const { error } = await sb.from("loan_installments").insert(rows);
      if (error) throw error;
    }

    closeModals();
    toast(id ? "Loan updated" : "Loan added");
    loadLoans();
  } catch (err) {
    fail(err.message);
  } finally {
    busy(false);
  }
}

/* ============ loan detail (installment loans: schedule + returns) ============ */
async function openLoanDetail(id) {
  busy(true);
  try {
    const [lR, iR, pR] = await Promise.all([
      sb.from("personal_loans").select("*").eq("id", id).single(),
      sb.from("loan_installments").select("*").eq("loan_id", id).order("installment_no"),
      sb.from("payments").select("*").eq("loan_id", id).order("paid_at"),
    ]);
    if (lR.error) throw lR.error;
    const loan = lR.data;
    const inst = iR.data || [];
    const pays = pR.data || [];

    const received = pays.reduce((s, p) => s + num(p.amount), 0);
    const left = round2(num(loan.amount) - received);
    const today = todayISO();

    /* installment statuses: returns allocate FIFO over the schedule */
    let unpaidBefore = 0, nextDue = null, overdueInst = false;
    const instHtml = inst
      .map((row) => {
        const amount = num(row.amount);
        const allocated = Math.min(Math.max(received - unpaidBefore, 0), amount);
        unpaidBefore += amount;
        const short = round2(amount - allocated);
        let status = "paid";
        if (short > 0.009) {
          if (nextDue === null) nextDue = row.due_date;
          if (row.due_date < today) { status = "overdue"; overdueInst = true; }
          else status = allocated > 0 ? "partial" : "pending";
        }
        return `<div class="inst-row ${status === "overdue" ? "is-overdue" : status === "paid" ? "is-paid" : ""}">
          <span class="inst-no">#${row.installment_no}</span>
          <span class="inst-due">${fmtDate(row.due_date)}</span>
          <span class="inst-amt">${money(amount)}</span>
          <span class="badge badge-${status}">${status}</span>
        </div>`;
      })
      .join("");

    const isLate = !loan.returned_at && ((loan.due_date && loan.due_date < today) || overdueInst);

    const paysHtml = pays.length
      ? pays
          .map(
            (p) => `<div class="pay-item">
            <div class="pi-main"><b>${money(p.amount)}</b> <span class="badge badge-${p.method}">${p.method}</span>
              <div class="pi-sub">${fmtDate(p.paid_at)}${p.notes ? " · " + esc(p.notes) : ""}</div>
            </div>
            <button type="button" class="icon-del" data-delpay="${p.id}" title="Delete return">✕</button>
          </div>`
          )
          .join("")
      : `<div class="empty" style="padding:16px">No returns recorded yet.</div>`;

    $("#loan-detail-body").innerHTML = `
      <div class="row-title" style="font-size:18px">${esc(loan.person)}
        ${loan.returned_at ? '<span class="badge badge-paid">Returned</span>' : isLate ? '<span class="badge badge-overdue">Late</span>' : inst.length ? '<span class="badge badge-pending">Installments</span>' : ""}
      </div>
      <div class="row-sub" style="margin-bottom:12px">Given ${fmtDate(loan.loan_date)}${loan.due_date ? " · Back by " + fmtDate(loan.due_date) : ""}${loan.notes ? " · " + esc(loan.notes) : ""}</div>

      <div class="detail-grid">
        <div class="stat tone-brand"><div class="stat-label">Given</div><div class="stat-value">${money(loan.amount)}</div></div>
        <div class="stat tone-violet"><div class="stat-label">Received back</div><div class="stat-value">${money(received)}</div>
          <div class="stat-sub">${pays.length} return${pays.length === 1 ? "" : "s"}</div></div>
        <div class="stat ${left > 0.009 ? "tone-red" : "tone-green"}"><div class="stat-label">Left to get back</div>
          <div class="stat-value">${money(Math.max(left, 0))}</div></div>
        <div class="stat ${nextDue && nextDue < today ? "tone-red" : "tone-amber"}"><div class="stat-label">Next due</div>
          <div class="stat-value">${nextDue ? fmtDate(nextDue) : left > 0.009 ? "—" : "All in"}</div>
          ${nextDue || left > 0.009 ? "" : `<div class="stat-sub">every installment received</div>`}</div>
      </div>

      <div class="detail-actions">
        <button type="button" class="btn btn-primary btn-sm" id="loan-detail-return-btn">+ Record return</button>
        ${loan.returned_at
          ? `<button type="button" class="btn btn-ghost btn-sm" id="loan-detail-back-btn">↩ Not back yet</button>`
          : `<button type="button" class="btn btn-ghost btn-sm" id="loan-detail-back-btn">✓ Returned</button>`}
        <button type="button" class="btn btn-ghost btn-sm" id="loan-detail-edit-btn">Edit</button>
        <button type="button" class="btn btn-danger btn-sm" id="loan-detail-del-btn">Delete</button>
      </div>

      ${inst.length ? `<div class="section-label">Installment schedule</div>${instHtml}` : ""}
      <div class="section-label">Returns received</div>
      ${paysHtml}`;

    $("#loan-detail-return-btn").onclick = () => {
      if (left <= 0.009) return toast("The full amount is already back.", true);
      openPaymentModal("loan", loan.id, `${loan.person} — still to get back ${money(left)}`, left);
    };
    $("#loan-detail-back-btn").onclick = async () => {
      await setLoanReturned(loan, !loan.returned_at);
      openLoanDetail(loan.id).catch(() => {});
    };
    $("#loan-detail-edit-btn").onclick = () => openLoanForm(loan);
    $("#loan-detail-del-btn").onclick = () =>
      askConfirm("Delete loan?", `Delete the ${money(loan.amount)} loan to ${loan.person}? Its schedule and returns will also be removed.`, async () => {
        busy(true);
        const { error } = await sb.from("personal_loans").delete().eq("id", loan.id);
        busy(false);
        if (error) return toast(error.message, true);
        closeModals();
        toast("Loan deleted");
        loadLoans();
      });
    $$("#loan-detail-body [data-delpay]").forEach((b) =>
      b.addEventListener("click", () =>
        askConfirm("Delete return?", "This return will be removed and the amounts updated.", async () => {
          busy(true);
          const { error } = await sb.from("payments").delete().eq("id", b.dataset.delpay);
          busy(false);
          if (error) return toast(error.message, true);
          toast("Return deleted");
          openLoanDetail(loan.id);
          loadLoans();
        })
      )
    );

    openModal("modal-loan-detail");
  } finally {
    busy(false);
  }
}

/* ============ expenses (money we spent) ============ */
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

function renderExpenses() {
  const rows = state.expenseRows;
  const today = todayISO();
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const inMonth = rows.filter((r) => String(r.entry_date).startsWith(month));
  const inYear = rows.filter((r) => String(r.entry_date).startsWith(year));
  const sum = (list) => list.reduce((s, r) => s + num(r.amount), 0);

  $("#expense-summary").innerHTML = `
    <div class="stat tone-amber"><div class="stat-label">This month</div><div class="stat-value">${money(sum(inMonth))}</div><div class="stat-sub">${inMonth.length} expense${inMonth.length === 1 ? "" : "s"}</div></div>
    <div class="stat tone-brand"><div class="stat-label">This year</div><div class="stat-value">${money(sum(inYear))}</div><div class="stat-sub">${inYear.length} expense${inYear.length === 1 ? "" : "s"}</div></div>
    <div class="stat tone-red"><div class="stat-label">All time</div><div class="stat-value">${money(sum(rows))}</div><div class="stat-sub">${rows.length} recorded</div></div>`;

  const q = state.expSearch.toLowerCase();
  const searched = rows.filter(
    (r) =>
      !q ||
      (r.title || "").toLowerCase().includes(q) ||
      (r.payee || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q)
  );
  const shown = applyListFilters("expenses", searched, rows);

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
            <div class="row-actions">
              <button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>
              <button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>
            </div>
          </div>`
        )
        .join("")
    : `<div class="empty">${
        listFiltersActive("expenses") ? "No expenses match these filters." : "No expenses yet."
      }</div>`;

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
      else openExpenseForm(r);
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

/* ============ purchases (things we bought) ============ */
/* item lines are stored newline-joined in title — one line per item, like a sale */
const oneLine = (s) => String(s || "").replace(/\s*\n\s*/g, " · ");

async function loadPurchases() {
  busy(true);
  try {
    const [pR, payR, iR] = await Promise.all([
      sb.from("purchases").select("*")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false }),
      sb.from("payments").select("purchase_id,amount"),
      sb.from("purchase_installments").select("purchase_id,installment_no,due_date,amount"),
    ]);
    if (pR.error) throw pR.error;
    if (payR.error) throw payR.error;
    if (iR.error) throw iR.error;

    const pay = {};
    for (const p of payR.data || []) if (p.purchase_id) pay[p.purchase_id] = (pay[p.purchase_id] || 0) + num(p.amount);
    const instMap = {};
    for (const s of iR.data || []) (instMap[s.purchase_id] ||= []).push(s);
    for (const k of Object.keys(instMap)) instMap[k].sort((a, b) => a.installment_no - b.installment_no);

    const today = todayISO();
    state.purchaseRows = (pR.data || []).map((r) => {
      const paid = round2(pay[r.id] || 0);
      const bal = round2(num(r.amount) - num(r.cash_amount) - num(r.bank_amount) - paid);
      /* schedule status: payments allocate FIFO over the rows, like sales */
      const sched = instMap[r.id] || [];
      let unpaidBefore = 0, instPaid = 0, overdueInst = false;
      for (const s of sched) {
        const a = num(s.amount);
        const allocated = Math.min(Math.max(paid - unpaidBefore, 0), a);
        unpaidBefore += a;
        if (a - allocated <= 0.009) instPaid++;
        else if (s.due_date < today) overdueInst = true;
      }
      const status = !sched.length ? null
        : bal <= 0.009 ? "paid"
        : overdueInst ? "overdue"
        : paid > 0 ? "partial"
        : "pending";
      return { ...r, bal, paid, instCount: sched.length, instPaid, status };
    });
    renderPurchases();
  } finally {
    busy(false);
  }
}

function renderPurchases() {
  const rows = state.purchaseRows;
  const today = todayISO();
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const inMonth = rows.filter((r) => String(r.entry_date).startsWith(month));
  const inYear = rows.filter((r) => String(r.entry_date).startsWith(year));
  const sum = (list) => list.reduce((s, r) => s + num(r.amount), 0);

  $("#purchase-summary").innerHTML = `
    <div class="stat tone-amber"><div class="stat-label">This month</div><div class="stat-value">${money(sum(inMonth))}</div><div class="stat-sub">${inMonth.length} purchase${inMonth.length === 1 ? "" : "s"}</div></div>
    <div class="stat tone-brand"><div class="stat-label">This year</div><div class="stat-value">${money(sum(inYear))}</div><div class="stat-sub">${inYear.length} purchase${inYear.length === 1 ? "" : "s"}</div></div>
    <div class="stat tone-red"><div class="stat-label">All time</div><div class="stat-value">${money(sum(rows))}</div><div class="stat-sub">${rows.length} recorded</div></div>`;

  const q = state.purchaseSearch.toLowerCase();
  const searched = rows.filter(
    (r) =>
      !q ||
      (r.title || "").toLowerCase().includes(q) ||
      (r.supplier || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q)
  );
  const shown = applyListFilters("purchases", searched, rows);

  $("#purchase-list").innerHTML = shown.length
    ? shown
        .map(
          (r) => `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(oneLine(r.title))}${r.status ? `<span class="badge badge-${r.status}">${r.status}</span>` : ""}</div>
              <div class="row-sub">${fmtDate(r.entry_date)}${r.supplier ? " · " + esc(r.supplier) : ""}${r.instCount ? ` · ${r.instPaid}/${r.instCount} installments paid` : ""}${r.notes ? " · " + esc(r.notes) : ""}</div>
            </div>
            <div class="row-right">
              <div class="row-amount ${r.bal > 0.009 ? "bal-due" : ""}">${money(r.amount)}</div>
              <div class="row-bal" style="color:var(--muted)">${r.bal > 0.009 ? money(r.bal) + " left" : "bought"}</div>
            </div>
            <div class="row-actions">
              ${r.bal > 0.009 ? `<button type="button" class="btn btn-sm btn-primary" data-act="pay">+ Pay</button>` : ""}
              <button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>
              <button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>
            </div>
          </div>`
        )
        .join("")
    : `<div class="empty">${
        listFiltersActive("purchases") ? "No purchases match these filters." : "No purchases yet."
      }</div>`;

  $$("#purchase-list .row").forEach((el) => {
    const r = rows.find((x) => x.id === el.dataset.id);
    el.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "pay") openPaymentModal("purchase", r.id, `${oneLine(r.title)} — still to pay ${money(r.bal)}`, r.bal);
      else if (act === "edit") openPurchaseForm(r);
      else if (act === "del")
        askConfirm("Delete this purchase?", `Delete ${oneLine(r.title)} (${money(r.amount)})?`, async () => {
          busy(true);
          const { error } = await sb.from("purchases").delete().eq("id", r.id);
          busy(false);
          if (error) return toast(error.message, true);
          toast("Purchase deleted");
          loadPurchases();
        });
      else openPurchaseForm(r);
    });
  });
}

/* ---- batch vs local: ask first, then show the matching input ----
   batch  = one statement line ("5 machines, 20 probes, 3 printers")
   local  = the item picker (machine dropdown + tick-boxes, one line each) */
function syncPurchaseMode() {
  const checked = $$("#purchase-mode input").find((x) => x.checked);
  const mode = checked ? checked.value : "";
  $("#purchase-statement-field").hidden = mode !== "batch";
  $("#purchase-picker-area").hidden = mode !== "local";
  $$("#purchase-mode .mode-opt").forEach((opt) =>
    opt.classList.toggle("is-on", opt.querySelector("input").checked)
  );
}

async function openPurchaseForm(r = null) {
  $("#purchase-form").reset();
  $("#purchase-form-error").hidden = true;
  $("#purchase-id").value = r?.id || "";
  $("#purchase-modal-title").textContent = r ? "Edit purchase" : "New purchase";
  $("#purchase-date").value = r?.entry_date || todayISO();
  /* a new purchase asks first (no mode selected); editing restores the stored one
     (legacy rows have no mode → batch, which matches how they were written) */
  const mode = r ? (r.mode === "local" ? "local" : "batch") : "";
  $$("#purchase-mode input").forEach((x) => { x.checked = x.value === mode; });
  renderItems(mode === "local" ? r?.title : "", "purchase");
  $("#purchase-statement").value = mode === "batch" ? String(r.title || "").replace(/\s*\n\s*/g, " ") : "";
  $("#purchase-supplier").value = r?.supplier || "";
  $("#purchase-amount").value = r ? num(r.amount) : "";
  /* how it was paid + the installment schedule, restored for editing */
  $("#purchase-cash").value = r && num(r.cash_amount) > 0 ? num(r.cash_amount) : "";
  $("#purchase-bank").value = r && num(r.bank_amount) > 0 ? num(r.bank_amount) : "";
  $("#purchase-installment").checked = false;
  $("#purchase-inst-count").value = "12";
  $("#purchase-inst-first").value = "";
  if (r) {
    const { data: sched, error } = await sb
      .from("purchase_installments").select("*").eq("purchase_id", r.id).order("installment_no");
    if (error) throw error;
    if (sched?.length) {
      $("#purchase-installment").checked = true;
      $("#purchase-inst-count").value = String(sched.length);
      $("#purchase-inst-first").value = sched[0].due_date;
    }
  }
  $("#purchase-notes").value = r?.notes || "";
  syncPurchaseMode();
  syncPurchaseForm();
  openModal("modal-purchase");
}

function syncPurchaseForm() {
  const total = amt($("#purchase-amount").value);
  const paid = amt($("#purchase-cash").value) + amt($("#purchase-bank").value);
  const due = round2(total - paid);
  $("#purchase-paid-summary").innerHTML =
    total <= 0
      ? `Enter the amount above — what is paid and what is left shows here.`
      : `Paid now: <b>${money(paid)}</b>` +
        ` &nbsp;·&nbsp; Left to pay: <b>${money(Math.max(due, 0))}</b>` +
        (paid > total + 0.009 ? `<br><span style="color:var(--red)">The paid amount is more than the total — fix it before saving.</span>` : "");

  const inst = $("#purchase-installment").checked;
  $("#purchase-inst-fields").hidden = !inst;
  if (inst) renderPurchaseInstPreview();
}

function renderPurchaseInstPreview() {
  const total = amt($("#purchase-amount").value);
  const paid = amt($("#purchase-cash").value) + amt($("#purchase-bank").value);
  const financed = round2(total - paid);
  const count = Math.max(1, Math.min(120, parseInt($("#purchase-inst-count").value, 10) || 0));
  const first = $("#purchase-inst-first").value;
  const el = $("#purchase-inst-preview");

  if (financed <= 0) { el.innerHTML = "Everything is already paid, so there is nothing left to split into installments."; return; }
  if (!first) { el.innerHTML = "Pick a first due date to see the schedule."; return; }

  const rows = buildSchedule(financed, count, first);
  const per = rows[0]?.amount || 0;
  el.innerHTML = `
    <div class="inst-line"><span>${count} × ${money(per)}</span><span>${money(financed)} financed</span></div>
    <div class="inst-line"><span>First due ${fmtDate(rows[0].due)}</span><span>Last due ${fmtDate(rows[rows.length - 1].due)}</span></div>`;
}

async function savePurchase(e) {
  e.preventDefault();
  const errEl = $("#purchase-form-error");
  errEl.hidden = true;
  const id = $("#purchase-id").value;
  const modeEl = $$("#purchase-mode input").find((x) => x.checked);
  const mode = modeEl ? modeEl.value : "";
  const amountN = parseAmount($("#purchase-amount").value);
  const cashN = parseAmount($("#purchase-cash").value);
  const bankN = parseAmount($("#purchase-bank").value);
  const isInst = $("#purchase-installment").checked;
  const count = parseInt($("#purchase-inst-count").value, 10) || 0;
  const first = $("#purchase-inst-first").value;
  const items = mode === "batch"
    ? [$("#purchase-statement").value.trim()].filter(Boolean)
    : itemValues("purchase");

  const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };
  if (!mode) return fail("First choose whether this is a batch purchase or a local purchase.");
  if (!items.length) return fail(mode === "batch" ? "Please write what was bought as one statement — how many machines, probes, etc." : "Please enter what was bought — pick a machine, tick the boxes, or add a line.");
  if ([amountN, cashN, bankN].some(Number.isNaN)) return fail(AMOUNT_HINT);

  const total = round2(amountN);
  const cash = round2(cashN);
  const bank = round2(bankN);
  const financed = round2(total - cash - bank);
  if (total <= 0) return fail("Enter how much was paid for it.");
  if (cash + bank > total + 0.009) return fail("The paid amount can't be more than the total purchase.");
  if (isInst) {
    if (financed <= 0) return fail("For installments, leave some amount unpaid (total minus paid).");
    if (count < 1 || count > 120) return fail("Enter between 1 and 120 installments.");
    if (!first) return fail("Pick the first due date.");
  } else if (financed > 0.009) {
    return fail(`${money(financed)} of the total is still uncovered — enter the rest as cash/bank or tick installments below.`);
  }

  const payload = {
    entry_date: $("#purchase-date").value || todayISO(),
    title: items.join("\n"),
    supplier: $("#purchase-supplier").value.trim() || null,
    amount: total,
    cash_amount: cash,
    bank_amount: bank,
    notes: $("#purchase-notes").value.trim() || null,
    mode,
  };

  busy(true);
  try {
    let purchaseId = id;
    if (id) {
      const { error } = await sb.from("purchases").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from("purchases").insert(payload).select("id").single();
      if (error) throw error;
      purchaseId = data.id;
    }

    /* schedule always follows the form — rebuild on edit like sales */
    if (id) {
      const { error: delErr } = await sb.from("purchase_installments").delete().eq("purchase_id", purchaseId);
      if (delErr) throw delErr;
    }
    if (isInst) {
      const rows = buildSchedule(financed, count, first).map((r) => ({
        purchase_id: purchaseId, installment_no: r.no, due_date: r.due, amount: r.amount,
      }));
      if (rows.length) {
        const { error } = await sb.from("purchase_installments").insert(rows);
        if (error) throw error;
      }
    }

    closeModals();
    toast(id ? "Purchase updated" : "Purchase added");
    if (state.view === "payables") loadPayables();
    loadPurchases();
  } catch (err) {
    fail(err.message);
  } finally {
    busy(false);
  }
}

/* ============ zakat (money given out as zakat) ============ */
async function loadZakat() {
  busy(true);
  try {
    const { data, error } = await sb
      .from("zakat")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    state.zakatRows = data || [];
    renderZakat();
  } finally {
    busy(false);
  }
}

function renderZakat() {
  const rows = state.zakatRows;
  const today = todayISO();
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const inMonth = rows.filter((r) => String(r.entry_date).startsWith(month));
  const inYear = rows.filter((r) => String(r.entry_date).startsWith(year));
  const sum = (list) => list.reduce((s, r) => s + num(r.amount), 0);

  $("#zakat-summary").innerHTML = `
    <div class="stat tone-amber"><div class="stat-label">This month</div><div class="stat-value">${money(sum(inMonth))}</div><div class="stat-sub">${inMonth.length} entr${inMonth.length === 1 ? "y" : "ies"}</div></div>
    <div class="stat tone-brand"><div class="stat-label">This year</div><div class="stat-value">${money(sum(inYear))}</div><div class="stat-sub">${inYear.length} entr${inYear.length === 1 ? "y" : "ies"}</div></div>
    <div class="stat tone-violet"><div class="stat-label">All time</div><div class="stat-value">${money(sum(rows))}</div><div class="stat-sub">${rows.length} recorded</div></div>`;

  const q = state.zakatSearch.toLowerCase();
  const searched = rows.filter((r) => !q || (r.notes || "").toLowerCase().includes(q));
  const shown = applyListFilters("zakat", searched, rows);

  $("#zakat-list").innerHTML = shown.length
    ? shown
        .map(
          (r) => `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${r.notes ? esc(r.notes) : "Zakat"}</div>
              <div class="row-sub">${fmtDate(r.entry_date)}</div>
            </div>
            <div class="row-right">
              <div class="row-amount bal-due">${money(r.amount)}</div>
              <div class="row-bal" style="color:var(--muted)">given</div>
            </div>
            <div class="row-actions">
              <button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>
              <button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>
            </div>
          </div>`
        )
        .join("")
    : `<div class="empty">${
        listFiltersActive("zakat") ? "No zakat entries match these filters." : "No zakat entries yet."
      }</div>`;

  $$("#zakat-list .row").forEach((el) => {
    const r = rows.find((x) => x.id === el.dataset.id);
    el.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "edit") openZakatForm(r);
      else if (act === "del")
        askConfirm("Delete this zakat?", `Delete ${money(r.amount)} from ${fmtDate(r.entry_date)}?`, async () => {
          busy(true);
          const { error } = await sb.from("zakat").delete().eq("id", r.id);
          busy(false);
          if (error) return toast(error.message, true);
          toast("Zakat entry deleted");
          loadZakat();
        });
      else openZakatForm(r);
    });
  });
}

function openZakatForm(r = null) {
  $("#zakat-form").reset();
  $("#zakat-form-error").hidden = true;
  $("#zakat-id").value = r?.id || "";
  $("#zakat-modal-title").textContent = r ? "Edit zakat" : "New zakat";
  $("#zakat-date").value = r?.entry_date || todayISO();
  $("#zakat-amount").value = r ? num(r.amount) : "";
  $("#zakat-notes").value = r?.notes || "";
  openModal("modal-zakat");
}

async function saveZakat(e) {
  e.preventDefault();
  const errEl = $("#zakat-form-error");
  errEl.hidden = true;
  const id = $("#zakat-id").value;
  const amountN = parseAmount($("#zakat-amount").value);
  const payload = {
    entry_date: $("#zakat-date").value || todayISO(),
    amount: round2(amountN),
    notes: $("#zakat-notes").value.trim() || null,
  };
  if (Number.isNaN(amountN)) { errEl.textContent = AMOUNT_HINT; errEl.hidden = false; return; }
  if (payload.amount <= 0) { errEl.textContent = "Enter how much zakat was given."; errEl.hidden = false; return; }

  busy(true);
  try {
    const { error } = id
      ? await sb.from("zakat").update(payload).eq("id", id)
      : await sb.from("zakat").insert(payload);
    if (error) throw error;
    closeModals();
    toast(id ? "Zakat updated" : "Zakat added");
    loadZakat();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    busy(false);
  }
}

/* ============ payments ============ */
function openPaymentModal(type, id, context, max) {
  state.returnTo = $$(".modal").find((m) => !m.hidden)?.id || null;
  state.returnSaleId = type === "sale" ? id : null;
  state.returnLoanId = type === "loan" ? id : null;
  $("#payment-form").reset();
  $("#payment-form-error").hidden = true;
  $("#pay-target-type").value = type;
  $("#pay-target-id").value = id;
  $("#pay-context").textContent = context;
  $("#pay-date").value = todayISO();
  state.payMax = max;
  const full = round2(num(max));
  /* pre-fill the whole remaining balance: if he paid everything, just pick cash/bank and Save */
  $("#pay-amount").value = full > 0 ? String(full) : "";
  $("#pay-amount").placeholder = "Up to " + money(max);
  openModal("modal-payment");
}

async function savePayment(e) {
  e.preventDefault();
  const errEl = $("#payment-form-error");
  errEl.hidden = true;
  const type = $("#pay-target-type").value;
  const id = $("#pay-target-id").value;
  const amountN = parseAmount($("#pay-amount").value);
  const max = round2(num(state.payMax));

  if (Number.isNaN(amountN)) { errEl.textContent = AMOUNT_HINT; errEl.hidden = false; return; }
  const amount = round2(amountN);
  if (amount <= 0) { errEl.textContent = "Enter how much was paid."; errEl.hidden = false; return; }
  if (amount > max + 0.009) { errEl.textContent = `That is more than the remaining ${money(max)}.`; errEl.hidden = false; return; }

  const payload = {
    paid_at: $("#pay-date").value || todayISO(),
    amount,
    method: $("#pay-method").value,
    notes: $("#pay-notes").value.trim() || null,
    sale_id: type === "sale" ? id : null,
    payable_id: type === "payable" ? id : null,
    purchase_id: type === "purchase" ? id : null,
    loan_id: type === "loan" ? id : null,
  };

  busy(true);
  try {
    const { error } = await sb.from("payments").insert(payload);
    if (error) throw error;
    closeModals();
    const left = round2(max - amount);
    if (left > 0.009) toast("Payment added");
    else if (type === "sale") toast("Fully paid ✓ — nothing left to receive");
    else if (type === "loan") toast("Fully received ✓ — nothing left to get back");
    else toast("Fully paid ✓ — nothing left to pay");

    /* a loan whose last installment came back is marked Returned by itself */
    if (type === "loan" && left <= 0.009) {
      const { error: rErr } = await sb
        .from("personal_loans")
        .update({ returned_at: new Date().toISOString() })
        .eq("id", id)
        .is("returned_at", null);
      if (rErr) toast(rErr.message, true);
    }

    if (type === "sale") {
      openSaleDetail(id);
      if (state.view === "sales") loadSales();
      else if (state.view === "receivables") loadReceivables();
    } else if (type === "loan") {
      openLoanDetail(id);
      loadLoans();
    } else if (type === "purchase") {
      if (state.view === "payables") loadPayables();
      loadPurchases();
    } else {
      loadPayables();
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    busy(false);
  }
}

/* ============ events ============ */
function bindEvents() {
  $("#login-form").addEventListener("submit", login);
  $("#logout-btn").addEventListener("click", async () => {
    await sb.auth.signOut();
    toast("Signed out");
  });

  $$(".tab, .bnav").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view))
  );

  /* dashboard range */
  $$("#range-seg .seg").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#range-seg .seg").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.range = b.dataset.range;
      if (state.range === "custom") {
        $("#custom-range").hidden = false;
        if (!state.from) { state.from = monthStartISO(); $("#range-from").value = state.from; }
        if (!state.to) { state.to = todayISO(); $("#range-to").value = state.to; }
      } else {
        $("#custom-range").hidden = true;
      }
      loadDashboard().catch((e) => toast(e.message, true));
    })
  );
  $("#range-from").addEventListener("change", (e) => { state.from = e.target.value; loadDashboard().catch((x) => toast(x.message, true)); });
  $("#range-to").addEventListener("change", (e) => { state.to = e.target.value; loadDashboard().catch((x) => toast(x.message, true)); });

  /* sales toolbar */
  $("#new-sale-btn").addEventListener("click", () => openSaleForm());
  $("#manage-salesmen-btn").addEventListener("click", () => openSalesmenModal());
  $("#salesman-form").addEventListener("submit", saveSalesman);
  $("#add-salesman-btn").addEventListener("click", async () => {
    const name = $("#sale-salesman").value.trim();
    if (!name) return toast("Type a salesman name first.", true);
    busy(true);
    const { error } = await sb.from("salesmen").insert({ name });
    busy(false);
    if (error && error.code !== "23505") return toast(error.message, true);
    if (error) return toast("That salesman already exists.", true);
    toast("Salesman added");
    await loadSalesmen().catch((x) => toast(x.message, true));
  });
  $("#sales-search").addEventListener("input", (e) => { state.search = e.target.value; renderSales(); });

  /* ⚙ Filters panel */
  $("#sales-filter-btn").addEventListener("click", () => {
    const panel = $("#sales-filters");
    panel.hidden = !panel.hidden;
    $("#sales-filter-btn").setAttribute("aria-expanded", String(!panel.hidden));
  });
  const bindFilter = (id, key, ev) => {
    $("#" + id).addEventListener(ev, (e) => {
      state.f[key] = e.target.value;
      if (key === "from" || key === "to") {
        state.f.quick = "custom";
        $$("#sf-quick .seg").forEach((b) => b.classList.toggle("active", b.dataset.range === "custom"));
      }
      renderSales();
    });
  };
  bindFilter("sf-source", "source", "change");
  bindFilter("sf-salesman", "salesman", "input");
  bindFilter("sf-kind", "kind", "change");
  bindFilter("sf-status", "status", "change");
  bindFilter("sf-from", "from", "change");
  bindFilter("sf-to", "to", "change");
  bindFilter("sf-min", "min", "input");
  bindFilter("sf-max", "max", "input");

  $("#sf-quick").addEventListener("click", (e) => {
    const b = e.target.closest(".seg");
    if (b) applyQuickRange(b.dataset.range);
  });

  $("#sales-filter-clear").addEventListener("click", () => {
    state.f = { source: "", salesman: "", kind: "", status: "", from: "", to: "", min: "", max: "", quick: "all" };
    state.search = "";
    $("#sales-search").value = "";
    ["sf-source", "sf-salesman", "sf-kind", "sf-status", "sf-from", "sf-to", "sf-min", "sf-max"]
      .forEach((id) => { $("#" + id).value = ""; });
    $$("#sf-quick .seg").forEach((b) => b.classList.toggle("active", b.dataset.range === "all"));
    renderSales();
    toast("Filters cleared");
  });

  /* sale form */
  $("#sale-form").addEventListener("submit", saveSale);
  ["sale-total", "sale-cash", "sale-bank", "sale-adjustment", "sale-loan", "sale-source", "sale-installment", "inst-count", "inst-first"].forEach(
    (id) => $("#" + id).addEventListener("input", syncSaleForm)
  );
  $("#sale-installment").addEventListener("change", syncSaleForm);
  $("#sale-source").addEventListener("change", syncSaleForm);

  /* item lines — the sale form and the purchase form share one procedure */
  for (const scope of Object.keys(PICKERS)) {
    const p = PICKERS[scope];
    $(p.add).addEventListener("click", () => {
      const row = itemRow();
      $(p.list).appendChild(row);
      row.querySelector("input").focus();
    });
    $(p.list).addEventListener("click", (e) => {
      const del = e.target.closest(".item-del");
      if (del) { del.closest(".item-row").remove(); syncItemChecks(scope); }
    });
    $(p.list).addEventListener("input", () => syncItemChecks(scope));   /* typing "Printer" by hand ticks its box */
    $(p.list).addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.classList.contains("item-input")) {
        e.preventDefault();
        const row = itemRow();
        $(p.list).appendChild(row);
        row.querySelector("input").focus();
      }
    });

    /* machine dropdown → adds a line, then resets so the same type can be picked again */
    $(p.machine).addEventListener("change", (e) => {
      if (!e.target.value) return;
      addNewItem(e.target.value, scope);
      e.target.value = "";
    });

    /* printer / probes → tick adds a line, untick removes that exact line */
    $(p.checks).addEventListener("change", (e) => {
      const cb = e.target.closest("input[type=checkbox]");
      if (!cb) return;
      if (cb.checked) addNewItem(cb.value, scope);
      else removeItemRow(cb.value, scope);
      syncItemChecks(scope);
    });
  }

  /* money fields: focus selects everything, blur turns 5l into 500000 */
  document.addEventListener("focusin", (e) => {
    if (e.target.matches?.(".amt")) e.target.select();
  });
  document.addEventListener("focusout", (e) => {
    const el = e.target;
    if (!el.matches?.(".amt")) return;
    const raw = el.value.trim();
    if (!raw) return;
    const n = parseAmount(raw);
    if (Number.isNaN(n)) return toast(AMOUNT_HINT, true);
    el.value = String(n);
  });

  /* loans */
  $("#new-loan-btn").addEventListener("click", () => openLoanForm());
  $("#loan-form").addEventListener("submit", saveLoan);
  $("#loan-search").addEventListener("input", (e) => {
    state.loanSearch = e.target.value;
    renderLoans();
  });
  /* installment return schedule: amount + tick + months + first due date */
  ["loan-amount", "loan-inst-count", "loan-inst-first"].forEach(
    (id) => $("#" + id).addEventListener("input", syncLoanForm)
  );
  $("#loan-installment").addEventListener("change", syncLoanForm);

  /* expenses */
  $("#new-expense-btn").addEventListener("click", () => openExpenseForm());
  $("#expense-form").addEventListener("submit", saveExpense);
  $("#expense-search").addEventListener("input", (e) => {
    state.expSearch = e.target.value;
    renderExpenses();
  });

  /* purchases */
  $("#new-purchase-btn").addEventListener("click", () => openPurchaseForm());
  $("#purchase-form").addEventListener("submit", savePurchase);
  /* batch ↔ local keeps whatever was already written: picker lines join into
     one statement, and a statement comes back as the first item row */
  $$("#purchase-mode input").forEach((radio) =>
    radio.addEventListener("change", () => {
      if (radio.value === "local") {
        renderItems($("#purchase-statement").value.trim(), "purchase");
      } else {
        const items = itemValues("purchase");
        if (items.length) $("#purchase-statement").value = items.join(" · ");
      }
      syncPurchaseMode();
    })
  );
  $("#purchase-search").addEventListener("input", (e) => {
    state.purchaseSearch = e.target.value;
    renderPurchases();
  });
  /* payment (cash/bank) + installment schedule fields */
  ["purchase-amount", "purchase-cash", "purchase-bank", "purchase-inst-count", "purchase-inst-first"].forEach(
    (id) => $("#" + id).addEventListener("input", syncPurchaseForm)
  );
  $("#purchase-installment").addEventListener("change", syncPurchaseForm);

  /* zakat */
  $("#new-zakat-btn").addEventListener("click", () => openZakatForm());
  $("#zakat-form").addEventListener("submit", saveZakat);
  $("#zakat-search").addEventListener("input", (e) => {
    state.zakatSearch = e.target.value;
    renderZakat();
  });

  /* payables / payment forms */
  $("#new-payable-btn").addEventListener("click", () => openPayableForm());
  $("#payable-form").addEventListener("submit", savePayable);
  $("#payment-form").addEventListener("submit", savePayment);

  /* receivables search (list is already in memory — no refetch per keystroke) */
  $("#receivable-search").addEventListener("input", (e) => {
    state.recSearch = e.target.value;
    renderReceivables();
  });

  /* payables search */
  $("#payable-search").addEventListener("input", (e) => {
    state.paySearch = e.target.value;
    renderPayables();
  });

  /* ⚙ Filters panels on the other tabs — sales wires its own above */
  Object.keys(LIST_TABS).forEach((tab) => {
    const cfg = LIST_TABS[tab], p = cfg.prefix;
    $("#" + cfg.btn).addEventListener("click", () => {
      const panel = $("#" + cfg.panel);
      panel.hidden = !panel.hidden;
      $("#" + cfg.btn).setAttribute("aria-expanded", String(!panel.hidden));
    });
    const bind = (key, ev) =>
      $("#" + p + "-" + key).addEventListener(ev, (e) => {
        listF(tab)[key] = e.target.value;
        if (key === "from" || key === "to")
          $$("#" + p + "-quick .seg").forEach((b) => b.classList.toggle("active", b.dataset.range === "custom"));
        cfg.render();
      });
    /* dates react to both: picking fires "change", typing fires "input" */
    ["from", "to"].forEach((key) => ["change", "input"].forEach((ev) => bind(key, ev)));
    bind("min", "input");
    bind("max", "input");
    if (cfg.extra)
      $("#" + p + "-extra").addEventListener("change", (e) => {
        listF(tab).extra = e.target.value;
        cfg.render();
      });
    $("#" + p + "-quick").addEventListener("click", (e) => {
      const b = e.target.closest(".seg");
      if (b) listQuickRange(tab, b.dataset.range);
    });
    $("#" + cfg.clear).addEventListener("click", () => clearListFilters(tab));
  });

  /* modal close */
  document.addEventListener("click", (e) => {
    if (e.target.matches("[data-close]")) dismissModals();
    if (e.target.classList.contains("modal")) dismissModals();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dismissModals();
  });

  /* confirm */
  $("#confirm-yes").addEventListener("click", async () => {
    const cb = confirmCb;
    confirmCb = null;
    closeModals();
    if (cb) await cb();
  });
}

boot();
