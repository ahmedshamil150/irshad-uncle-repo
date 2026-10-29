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

/* ---------- friendly money entry: "5lac", "50hazar", "2cr", "5,00,000" → number ---------- */
const AMOUNT_UNITS = {
  crore: 1e7, cr: 1e7,
  lakh: 1e5, lac: 1e5, lak: 1e5, l: 1e5,
  hazar: 1e3, hajar: 1e3, hazaar: 1e3, hazzar: 1e3, thousand: 1e3, k: 1e3,
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
      const unit = m[2].replace(/s$/, "");   /* lacs → lac, crores → crore, lakhs → lakh */
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
const AMOUNT_HINT = "Couldn't read that amount — try 500000, 5lac, 50hazar or 2cr.";

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

function openModal(id) {
  closeModals(true);
  $("#" + id).hidden = false;
  document.body.style.overflow = "hidden";
}
function closeModals(keepLock = false) {
  $$(".modal").forEach((m) => (m.hidden = true));
  if (!keepLock) document.body.style.overflow = "";
}

/* closing payment modal returns you to the sale detail it was opened from */
function dismissModals() {
  const open = $$(".modal").find((m) => !m.hidden);
  closeModals();
  if (open?.id === "modal-payment" && state.returnTo === "modal-sale-detail" && state.returnSaleId) {
    openSaleDetail(state.returnSaleId).catch(() => {});
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
  payMax: 0,
  returnTo: null,
  returnSaleId: null,
};

const loaders = {
  dashboard: loadDashboard,
  sales: loadSales,
  loans: loadLoans,
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
    const [salesR, lightR, paysR, payablesR] = await Promise.all([
      applyRange(sb.from("sales").select("*"), "sale_date"),
      sb.from("sales").select("id,total_amount,cash_amount,bank_amount,loan_amount"),
      sb.from("payments").select("sale_id,payable_id,amount"),
      sb.from("payables").select("amount"),
    ]);
    const errs = [salesR, lightR, paysR, payablesR].find((r) => r.error);
    if (errs) throw errs.error;

    const sales = salesR.data || [];
    const light = lightR.data || [];
    const pays = paysR.data || [];
    const payables = payablesR.data || [];

    const totalSale = sales.reduce((s, r) => s + num(r.total_amount), 0);
    const cash = sales.reduce((s, r) => s + num(r.cash_amount), 0);
    const bank = sales.reduce((s, r) => s + num(r.bank_amount), 0);
    const loan = sales.reduce((s, r) => s + num(r.loan_amount), 0);

    const paidForSale = {};
    const paidForPayable = {};
    for (const p of pays) {
      if (p.sale_id) paidForSale[p.sale_id] = (paidForSale[p.sale_id] || 0) + num(p.amount);
      if (p.payable_id) paidForPayable[p.payable_id] = (paidForPayable[p.payable_id] || 0) + num(p.amount);
    }
    let recv = 0, recvCount = 0;
    for (const r of light) {
      const due = num(r.total_amount) - num(r.cash_amount) - num(r.bank_amount) - num(r.loan_amount);
      const saleId = r.id;
      const bal = due - (paidForSale[saleId] || 0);
      if (bal > 0.009) { recv += bal; recvCount++; }
    }
    // light select needs ids for per-sale balance
    const payableTotal = payables.reduce((s, r) => s + num(r.amount), 0);
    const payablePaid = pays.filter((p) => p.payable_id).reduce((s, p) => s + num(p.amount), 0);

    const cards = [
      { label: "Total sale", value: money(totalSale), tone: "brand", sub: rangeLabel() },
      { label: "Cash", value: money(cash), tone: "green" },
      { label: "Bank", value: money(bank), tone: "brand" },
    ];
    /* loan is no longer an option on the sale form — only show it while old sales still carry one */
    if (loan > 0) cards.push({ label: "Loan", value: money(loan), tone: "violet" });
    cards.push(
      { label: "To receive (total)", value: money(recv), tone: "red", sub: `${recvCount} sale${recvCount === 1 ? "" : "s"} still to pay` },
      { label: "To pay (total)", value: money(payableTotal - payablePaid), tone: "amber", sub: "To dealers & suppliers" }
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
    const src = { office: 0, dealer: 0, salesman: 0 };
    for (const r of sales) src[r.source] = (src[r.source] || 0) + num(r.total_amount);
    const max = Math.max(...Object.values(src), 1);
    $("#source-split").innerHTML = ["office", "dealer", "salesman"]
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
    num(r.total_amount) - num(r.cash_amount) - num(r.bank_amount) - num(r.loan_amount) - (state.salesPay[r.id] || 0)
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
              <div class="row-sub">${fmtDate(r.sale_date)}${r.item_description ? " · " + esc(itemsText(r.item_description)) : ""}</div>
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
          ? "No sales match these filters. Tap “Clear all filters” to start again."
          : "No sales found. Tap “+ New sale” to add one."
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

    const paidAtSale = num(sale.cash_amount) + num(sale.bank_amount) + num(sale.loan_amount);
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
      <div class="row-sub" style="margin-bottom:12px">${fmtDate(sale.sale_date)}${sale.item_description ? " · " + esc(itemsText(sale.item_description)) : ""}${sale.salesman_name ? " · " + esc(sale.salesman_name) : ""}</div>

      <div class="detail-grid">
        <div class="stat tone-brand"><div class="stat-label">Total sale</div><div class="stat-value">${money(sale.total_amount)}</div></div>
        <div class="stat tone-green"><div class="stat-label">Paid upfront</div><div class="stat-value">${money(paidAtSale)}</div>
          <div class="stat-sub">Cash ${money(sale.cash_amount)} · Bank ${money(sale.bank_amount)} · Loan ${money(sale.loan_amount)}</div></div>
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
  if (!$("#modal-salesmen").hidden) renderSalesmenList();
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
  $("#sale-customer").value = sale?.customer_name || "";
  renderItems(sale?.item_description);
  $("#sale-total").value = sale ? num(sale.total_amount) : "";
  $("#sale-cash").value = sale && num(sale.cash_amount) ? num(sale.cash_amount) : "";
  $("#sale-bank").value = sale && num(sale.bank_amount) ? num(sale.bank_amount) : "";
  $("#sale-loan").value = sale ? num(sale.loan_amount) : 0;
  $("#sale-installment").checked = !!sale?.is_installment;
  $("#sale-notes").value = sale?.notes || "";
  $("#inst-count").value = 12;
  $("#inst-first").value = todayISO();

  /* open the optional sections only when there is something to show */
  const paidAlready = amt($("#sale-cash").value) + amt($("#sale-bank").value) + amt($("#sale-loan").value);
  $("#sale-pay-disclose").open = paidAlready > 0;
  $("#sale-more-disclose").open = !!sale && (sale.is_installment || !!sale.notes);

  syncSaleForm();
  openModal("modal-sale");
}

/* ---- item lines (one per machine/item) ---- */
function itemRow(value = "") {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML =
    '<input type="text" class="item-input" placeholder="e.g. Ultrasound machine XYZ" />' +
    '<button type="button" class="item-del" title="Remove item" aria-label="Remove item">✕</button>';
  row.querySelector("input").value = value;
  return row;
}
function renderItems(stored) {
  const box = $("#sale-items");
  box.innerHTML = "";
  const list = String(stored || "").split("\n").map((x) => x.trim()).filter(Boolean);
  (list.length ? list : [""]).forEach((v) => box.appendChild(itemRow(v)));
}
const itemValues = () =>
  $$("#sale-items .item-input").map((i) => i.value.trim()).filter(Boolean);

function syncSaleForm() {
  const src = $("#sale-source").value;
  $("#salesman-field").hidden = src !== "salesman";

  const total = amt($("#sale-total").value);
  const paid = amt($("#sale-cash").value) + amt($("#sale-bank").value) + amt($("#sale-loan").value);
  const due = round2(total - paid);
  $("#sale-paid-summary").innerHTML =
    total <= 0
      ? `Enter the total above — what is paid and what is left shows here.`
      : `Paid now: <b>${money(paid)}</b> &nbsp;·&nbsp; Left to pay: <b>${money(Math.max(due, 0))}</b>` +
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
  const paid = amt($("#sale-cash").value) + amt($("#sale-bank").value) + amt($("#sale-loan").value);
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
  const totalRaw = $("#sale-total").value.trim();
  const totalN = parseAmount(totalRaw);
  const cashN = parseAmount($("#sale-cash").value);
  const bankN = parseAmount($("#sale-bank").value);
  const loanN = parseAmount($("#sale-loan").value);
  const isInst = $("#sale-installment").checked;
  const count = parseInt($("#inst-count").value, 10) || 0;
  const first = $("#inst-first").value;

  const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };
  if (!customer) return fail("Please enter the customer name.");
  if (!totalRaw) return fail("Enter the total sale amount.");
  if ([totalN, cashN, bankN, loanN].some(Number.isNaN)) return fail(AMOUNT_HINT);
  const total = round2(totalN);
  const cash = round2(cashN);
  const bank = round2(bankN);
  const loan = round2(loanN);
  const financed = round2(total - cash - bank - loan);
  if (total <= 0) return fail("Enter the total sale amount.");
  if (cash + bank + loan > total + 0.009) return fail("The paid amount can't be more than the total sale.");
  if (source === "salesman" && !$("#sale-salesman").value.trim()) return fail("Please enter the salesman name.");
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
    item_description: itemValues().join("\n") || null,
    total_amount: total,
    cash_amount: cash,
    bank_amount: bank,
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

    if (isInst) {
      const [pR, iR] = await Promise.all([
        sb.from("payments").select("id").eq("sale_id", saleId).limit(1),
        sb.from("installments").select("id").eq("sale_id", saleId).limit(1),
      ]);
      if (pR.error) throw pR.error;
      const hasPayments = (pR.data || []).length > 0;
      const hasSchedule = !(iR.error) && (iR.data || []).length > 0;

      if (!hasPayments) {
        const { error: delErr } = await sb.from("installments").delete().eq("sale_id", saleId);
        if (delErr) throw delErr;
        const rows = buildSchedule(financed, count, first).map((r) => ({
          sale_id: saleId, installment_no: r.no, due_date: r.due, amount: r.amount,
        }));
        if (rows.length) {
          const { error } = await sb.from("installments").insert(rows);
          if (error) throw error;
        }
      } else if (hasSchedule) {
        toast("Sale saved. Existing installments kept because payments are already recorded.");
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

    const overdueIds = new Set((iR.data || []).map((r) => r.sale_id));
    const open = sR.data
      .map((r) => ({ ...r, bal: round2(num(r.total_amount) - num(r.cash_amount) - num(r.bank_amount) - num(r.loan_amount) - (pay[r.id] || 0)) }))
      .filter((r) => r.bal > 0.009);

    const total = open.reduce((s, r) => s + r.bal, 0);
    const overdue = open.filter((r) => overdueIds.has(r.id)).reduce((s, r) => s + r.bal, 0);

    $("#receivable-summary").innerHTML = `
      <div class="stat tone-red"><div class="stat-label">Total to receive</div><div class="stat-value">${money(total)}</div></div>
      <div class="stat tone-amber"><div class="stat-label">Overdue sales</div><div class="stat-value">${open.filter((r) => overdueIds.has(r.id)).length}</div><div class="stat-sub">${money(overdue)} late</div></div>
      <div class="stat tone-brand"><div class="stat-label">Sales with balance</div><div class="stat-value">${open.length}</div></div>`;

    const q = state.recSearch.toLowerCase();
    const rows = open.filter((r) => !q || (r.customer_name || "").toLowerCase().includes(q));

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
          </div>`)
          .join("")
      : `<div class="empty">Nothing to receive — every sale is fully paid.</div>`;

    $$("#receivable-list .row").forEach((el) =>
      el.addEventListener("click", () => openSaleDetail(el.dataset.id))
    );
  } finally {
    busy(false);
  }
}

/* ============ payables ============ */
async function loadPayables() {
  busy(true);
  try {
    const [bR, pR] = await Promise.all([
      sb.from("payables").select("*").order("entry_date", { ascending: false }),
      sb.from("payments").select("payable_id,amount,paid_at,method"),
    ]);
    if (bR.error) throw bR.error;
    if (pR.error) throw pR.error;
    const pay = {};
    for (const p of pR.data || []) if (p.payable_id) pay[p.payable_id] = (pay[p.payable_id] || 0) + num(p.amount);

    const rows = (bR.data || []).map((r) => ({ ...r, bal: round2(num(r.amount) - (pay[r.id] || 0)) }));

    $("#payable-list").innerHTML = rows.length
      ? rows
          .map((r) => `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(r.party)}</div>
              <div class="row-sub">${fmtDate(r.entry_date)}${r.notes ? " · " + esc(r.notes) : ""}</div>
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
      : `<div class="empty">Nothing to pay yet. Add what you owe a dealer or supplier.</div>`;

    $$("#payable-list .row").forEach((el) => {
      const r = rows.find((x) => x.id === el.dataset.id);
      el.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "pay") openPaymentModal("payable", r.id, `${r.party} — still to pay ${money(r.bal)}`, r.bal);
        else if (act === "edit") openPayableForm(r);
        else if (act === "del")
          askConfirm("Delete this entry?", `Delete ${r.party} (${money(r.amount)})? Payments recorded against it will be removed too.`, async () => {
            busy(true);
            const { error } = await sb.from("payables").delete().eq("id", r.id);
            busy(false);
            if (error) return toast(error.message, true);
            toast("Entry deleted");
            loadPayables();
          });
        else if (r.bal > 0.009) openPaymentModal("payable", r.id, `${r.party} — still to pay ${money(r.bal)}`, r.bal);
        else openPayableForm(r);
      });
    });
  } finally {
    busy(false);
  }
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
    const { data, error } = await sb
      .from("personal_loans")
      .select("*")
      .order("loan_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    state.loanRows = data || [];
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
    const late = open.filter((r) => r.due_date && r.due_date < today);
    const outTotal = open.reduce((s, r) => s + num(r.amount), 0);
    const allTotal = rows.reduce((s, r) => s + num(r.amount), 0);
    const lateTotal = late.reduce((s, r) => s + num(r.amount), 0);

    $("#loan-summary").innerHTML = `
      <div class="stat tone-red"><div class="stat-label">Still to get back</div><div class="stat-value">${money(outTotal)}</div><div class="stat-sub">${open.length} loan${open.length === 1 ? "" : "s"} out</div></div>
      <div class="stat tone-amber"><div class="stat-label">Past the due date</div><div class="stat-value">${late.length}</div><div class="stat-sub">${money(lateTotal)} late</div></div>
      <div class="stat tone-brand"><div class="stat-label">Given out (all)</div><div class="stat-value">${money(allTotal)}</div><div class="stat-sub">${back.length} returned</div></div>`;

    const q = state.loanSearch.toLowerCase();
    const shown = rows.filter((r) => !q || (r.person || "").toLowerCase().includes(q));

    $("#loan-list").innerHTML = shown.length
      ? shown
          .map((r) => {
            const isBack = !!r.returned_at;
            const isLate = !isBack && r.due_date && r.due_date < today;
            return `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(r.person)}
                ${isBack ? '<span class="badge badge-paid">Returned</span>' : isLate ? '<span class="badge badge-overdue">Late</span>' : ""}
              </div>
              <div class="row-sub">Given ${fmtDate(r.loan_date)}${r.due_date ? " · Back by " + fmtDate(r.due_date) : ""}${isBack ? " · Back on " + fmtDate(String(r.returned_at).slice(0, 10)) : ""}${r.notes ? " · " + esc(r.notes) : ""}</div>
            </div>
            <div class="row-right">
              <div class="row-amount ${isBack ? "" : "bal-due"}">${money(r.amount)}</div>
              <div class="row-bal" style="color:var(--muted)">${isBack ? "returned" : "to get back"}</div>
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
      : `<div class="empty">${q ? "No matching name." : "No loans recorded yet. Tap “+ New loan” when you give money to someone."}</div>`;

    $$("#loan-list .row").forEach((el) => {
      const r = rows.find((x) => x.id === el.dataset.id);
      el.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "back") setLoanReturned(r, true);
        else if (act === "undo") setLoanReturned(r, false);
        else if (act === "edit") openLoanForm(r);
        else if (act === "del")
          askConfirm("Delete this loan?", `Delete the ${money(r.amount)} loan to ${r.person}?`, async () => {
            busy(true);
            const { error } = await sb.from("personal_loans").delete().eq("id", r.id);
            busy(false);
            if (error) return toast(error.message, true);
            toast("Loan deleted");
            loadLoans();
          });
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

function openLoanForm(r = null) {
  $("#loan-form").reset();
  $("#loan-form-error").hidden = true;
  $("#loan-id").value = r?.id || "";
  $("#loan-modal-title").textContent = r ? "Edit loan" : "New loan";
  $("#loan-date").value = r?.loan_date || todayISO();
  $("#loan-person").value = r?.person || "";
  $("#loan-amount").value = r ? num(r.amount) : "";
  $("#loan-due").value = r?.due_date || "";
  $("#loan-notes").value = r?.notes || "";
  openModal("modal-loan");
}

async function saveLoan(e) {
  e.preventDefault();
  const errEl = $("#loan-form-error");
  errEl.hidden = true;
  const id = $("#loan-id").value;
  const person = $("#loan-person").value.trim();
  const amountN = parseAmount($("#loan-amount").value);
  const payload = {
    loan_date: $("#loan-date").value || todayISO(),
    person,
    amount: round2(amountN),
    due_date: $("#loan-due").value || null,
    notes: $("#loan-notes").value.trim() || null,
  };
  if (!person) { errEl.textContent = "Please enter who you gave the money to."; errEl.hidden = false; return; }
  if (Number.isNaN(amountN)) { errEl.textContent = AMOUNT_HINT; errEl.hidden = false; return; }
  if (payload.amount <= 0) { errEl.textContent = "Enter how much you gave."; errEl.hidden = false; return; }
  if (payload.due_date && payload.due_date < payload.loan_date) { errEl.textContent = "“Back by” is before the day the money was given."; errEl.hidden = false; return; }

  busy(true);
  try {
    const { error } = id
      ? await sb.from("personal_loans").update(payload).eq("id", id)
      : await sb.from("personal_loans").insert(payload);
    if (error) throw error;
    closeModals();
    toast(id ? "Loan updated" : "Loan added");
    loadLoans();
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
  $("#payment-form").reset();
  $("#payment-form-error").hidden = true;
  $("#pay-target-type").value = type;
  $("#pay-target-id").value = id;
  $("#pay-context").textContent = context;
  $("#pay-date").value = todayISO();
  state.payMax = max;
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
  };

  busy(true);
  try {
    const { error } = await sb.from("payments").insert(payload);
    if (error) throw error;
    closeModals();
    toast("Payment added");
    if (type === "sale") {
      openSaleDetail(id);
      if (state.view === "sales") loadSales();
      else if (state.view === "receivables") loadReceivables();
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
  ["sale-total", "sale-cash", "sale-bank", "sale-loan", "sale-source", "sale-installment", "inst-count", "inst-first"].forEach(
    (id) => $("#" + id).addEventListener("input", syncSaleForm)
  );
  $("#sale-installment").addEventListener("change", syncSaleForm);
  $("#sale-source").addEventListener("change", syncSaleForm);

  /* item lines */
  $("#add-item-btn").addEventListener("click", () => {
    const row = itemRow();
    $("#sale-items").appendChild(row);
    row.querySelector("input").focus();
  });
  $("#sale-items").addEventListener("click", (e) => {
    const del = e.target.closest(".item-del");
    if (del) del.closest(".item-row").remove();
  });
  $("#sale-items").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("item-input")) {
      e.preventDefault();
      const row = itemRow();
      $("#sale-items").appendChild(row);
      row.querySelector("input").focus();
    }
  });

  /* money fields: focus selects everything, blur turns 5lac into 500000 */
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

  /* payables / payment forms */
  $("#new-payable-btn").addEventListener("click", () => openPayableForm());
  $("#payable-form").addEventListener("submit", savePayable);
  $("#payment-form").addEventListener("submit", savePayment);

  /* receivables search */
  $("#receivable-search").addEventListener("input", (e) => {
    state.recSearch = e.target.value;
    loadReceivables().catch((x) => toast(x.message, true));
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
