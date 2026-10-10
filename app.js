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
  search: "",
  source: "",
  recSearch: "",
  returnTo: null,
  returnSaleId: null,
};

const loaders = {
  dashboard: loadDashboard,
  sales: loadSales,
  receivables: loadReceivables,
  payables: loadPayables,
  ledger: loadLedger,
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
    const [salesR, ledgerR, lightR, paysR, payablesR] = await Promise.all([
      applyRange(sb.from("sales").select("*"), "sale_date"),
      applyRange(sb.from("ledger_entries").select("*"), "entry_date"),
      sb.from("sales").select("id,total_amount,cash_amount,bank_amount,loan_amount"),
      sb.from("payments").select("sale_id,payable_id,amount"),
      sb.from("payables").select("amount"),
    ]);
    const errs = [salesR, ledgerR, lightR, paysR, payablesR].find((r) => r.error);
    if (errs) throw errs.error;

    const sales = salesR.data || [];
    const ledger = ledgerR.data || [];
    const light = lightR.data || [];
    const pays = paysR.data || [];
    const payables = payablesR.data || [];

    const totalSale = sales.reduce((s, r) => s + num(r.total_amount), 0);
    const cash = sales.reduce((s, r) => s + num(r.cash_amount), 0);
    const bank = sales.reduce((s, r) => s + num(r.bank_amount), 0);
    const loan = sales.reduce((s, r) => s + num(r.loan_amount), 0);
    const debit = ledger.reduce((s, r) => s + num(r.debit), 0);
    const credit = ledger.reduce((s, r) => s + num(r.credit), 0);

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
      { label: "Loan", value: money(loan), tone: "violet" },
      { label: "Debit", value: money(debit), tone: "violet" },
      { label: "Credit", value: money(credit), tone: "green" },
      { label: "Dues (Lena Hai)", value: money(recv), tone: "red", sub: recvCount + " sale(s) with balance" },
      { label: "Dues (Dena Hai)", value: money(payableTotal - payablePaid), tone: "amber" },
    ];
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
          <div class="src-head"><span>${k[0].toUpperCase() + k.slice(1)} sale</span><b>${money(src[k])}</b></div>
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
            <div><div>${esc(r.customer_name)}</div><div class="mini-sub">${fmtDate(r.sale_date)} · ${esc(r.source)}</div></div>
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

function renderSales() {
  const q = state.search.toLowerCase();
  const rows = state.sales.filter(
    (r) =>
      (!q || (r.customer_name || "").toLowerCase().includes(q)) &&
      (!state.source || r.source === state.source)
  );
  $("#sales-list").innerHTML = rows.length
    ? rows
        .map((r) => {
          const bal = saleOutstanding(r);
          return `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(r.customer_name)}
                <span class="badge badge-${r.source}">${esc(r.source)}</span>
                ${r.is_installment ? '<span class="badge badge-pending">Installment</span>' : ""}
              </div>
              <div class="row-sub">${fmtDate(r.sale_date)}${r.item_description ? " · " + esc(r.item_description) : ""}</div>
            </div>
            <div class="row-right">
              <div class="row-amount">${money(r.total_amount)}</div>
              <div class="row-bal ${bal > 0.009 ? "bal-due" : "bal-ok"}">${bal > 0.009 ? money(bal) + " due" : "Settled"}</div>
            </div>
          </div>`;
        })
        .join("")
    : `<div class="empty">No sales found. Tap “+ New sale” to add one.</div>`;

  $$("#sales-list .row").forEach((el) =>
    el.addEventListener("click", () => openSaleDetail(el.dataset.id))
  );
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
        <span class="badge badge-${sale.source}">${esc(sale.source)}</span>
      </div>
      <div class="row-sub" style="margin-bottom:12px">${fmtDate(sale.sale_date)}${sale.item_description ? " · " + esc(sale.item_description) : ""}${sale.salesman_name ? " · " + esc(sale.salesman_name) : ""}</div>

      <div class="detail-grid">
        <div class="stat tone-brand"><div class="stat-label">Total sale</div><div class="stat-value">${money(sale.total_amount)}</div></div>
        <div class="stat tone-green"><div class="stat-label">Paid at sale</div><div class="stat-value">${money(paidAtSale)}</div>
          <div class="stat-sub">Cash ${money(sale.cash_amount)} · Bank ${money(sale.bank_amount)} · Loan ${money(sale.loan_amount)}</div></div>
        <div class="stat tone-violet"><div class="stat-label">Payments received</div><div class="stat-value">${money(received)}</div></div>
        <div class="stat ${outstanding > 0.009 ? "tone-red" : "tone-green"}"><div class="stat-label">Balance due</div>
          <div class="stat-value">${money(Math.max(outstanding, 0))}</div></div>
      </div>

      ${sale.notes ? `<div class="section-label">Notes</div><p class="row-sub" style="margin:0">${esc(sale.notes)}</p>` : ""}

      <div class="detail-actions">
        <button type="button" class="btn btn-primary btn-sm" id="detail-pay-btn">+ Record payment</button>
        <button type="button" class="btn btn-ghost btn-sm" id="detail-edit-btn">Edit</button>
        <button type="button" class="btn btn-danger btn-sm" id="detail-del-btn">Delete</button>
      </div>

      ${inst.length ? `<div class="section-label">Installment schedule</div>${instHtml}` : ""}
      <div class="section-label">Payments</div>
      ${paysHtml}`;

    $("#detail-pay-btn").onclick = () => {
      if (outstanding <= 0.009) return toast("This sale is fully settled.", true);
      openPaymentModal("sale", sale.id, `${sale.customer_name} — balance ${money(outstanding)}`, outstanding);
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
        askConfirm("Delete payment?", "This payment will be removed and the balance recalculated.", async () => {
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
  $("#sale-item").value = sale?.item_description || "";
  $("#sale-total").value = sale ? num(sale.total_amount) : "";
  $("#sale-cash").value = sale ? num(sale.cash_amount) : 0;
  $("#sale-bank").value = sale ? num(sale.bank_amount) : 0;
  $("#sale-loan").value = sale ? num(sale.loan_amount) : 0;
  $("#sale-installment").checked = !!sale?.is_installment;
  $("#sale-notes").value = sale?.notes || "";
  $("#inst-count").value = 12;
  $("#inst-first").value = todayISO();
  syncSaleForm();
  openModal("modal-sale");
}

function syncSaleForm() {
  const src = $("#sale-source").value;
  $("#salesman-field").hidden = src !== "salesman";

  const total = num($("#sale-total").value);
  const paid = num($("#sale-cash").value) + num($("#sale-bank").value) + num($("#sale-loan").value);
  const due = round2(total - paid);
  $("#sale-paid-summary").innerHTML =
    `Paid now: <b>${money(paid)}</b><br>On account: <b>${money(Math.max(due, 0))}</b>` +
    (paid > total + 0.009 ? `<br><span style="color:var(--red)">Paid exceeds total!</span>` : "");

  const inst = $("#sale-installment").checked;
  $("#installment-fields").hidden = !inst;
  if (inst) renderInstPreview();
}

function buildSchedule(financed, count, firstDue) {
  const per = Math.floor((financed / count) * 100) / 100;
  const rows = [];
  let remaining = round2(financed);
  for (let i = 1; i <= count; i++) {
    const amt = i === count ? round2(remaining) : per;
    if (amt <= 0) break;
    rows.push({ no: i, due: addMonths(firstDue, i - 1), amount: amt });
    remaining = round2(remaining - amt);
  }
  return rows;
}

function renderInstPreview() {
  const total = num($("#sale-total").value);
  const paid = num($("#sale-cash").value) + num($("#sale-bank").value) + num($("#sale-loan").value);
  const financed = round2(total - paid);
  const count = Math.max(1, Math.min(120, parseInt($("#inst-count").value, 10) || 0));
  const first = $("#inst-first").value;
  const el = $("#inst-preview");

  if (financed <= 0) { el.innerHTML = "Nothing left to finance — reduce the paid amount or uncheck installments."; return; }
  if (!first) { el.innerHTML = "Choose a first due date to preview the schedule."; return; }

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
  const total = round2(num($("#sale-total").value));
  const cash = round2(num($("#sale-cash").value));
  const bank = round2(num($("#sale-bank").value));
  const loan = round2(num($("#sale-loan").value));
  const isInst = $("#sale-installment").checked;
  const count = parseInt($("#inst-count").value, 10) || 0;
  const first = $("#inst-first").value;
  const financed = round2(total - cash - bank - loan);

  const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };
  if (!customer) return fail("Customer name is required.");
  if (total <= 0) return fail("Total sale must be greater than 0.");
  if (cash + bank + loan > total + 0.009) return fail("Paid amount cannot exceed the total sale.");
  if (source === "salesman" && !$("#sale-salesman").value.trim()) return fail("Salesman name is required.");
  if (isInst) {
    if (financed <= 0) return fail("Installment sale needs an unpaid balance (total minus paid).");
    if (count < 1 || count > 120) return fail("Number of installments must be between 1 and 120.");
    if (!first) return fail("First due date is required.");
  }

  const payload = {
    sale_date: $("#sale-date").value || todayISO(),
    customer_name: customer,
    source,
    salesman_name: source === "salesman" ? $("#sale-salesman").value.trim() : null,
    item_description: $("#sale-item").value.trim() || null,
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
        toast("Sale saved — existing installments kept (payments already recorded).");
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
      <div class="stat tone-red"><div class="stat-label">Total dues (lena hai)</div><div class="stat-value">${money(total)}</div></div>
      <div class="stat tone-amber"><div class="stat-label">Overdue sales</div><div class="stat-value">${open.filter((r) => overdueIds.has(r.id)).length}</div><div class="stat-sub">${money(overdue)} outstanding</div></div>
      <div class="stat tone-brand"><div class="stat-label">Sales with dues</div><div class="stat-value">${open.length}</div></div>`;

    const q = state.recSearch.toLowerCase();
    const rows = open.filter((r) => !q || (r.customer_name || "").toLowerCase().includes(q));

    $("#receivable-list").innerHTML = rows.length
      ? rows
          .map((r) => `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(r.customer_name)}
                <span class="badge badge-${r.source}">${esc(r.source)}</span>
                ${overdueIds.has(r.id) ? '<span class="badge badge-overdue">Overdue</span>' : ""}
              </div>
              <div class="row-sub">Sold ${fmtDate(r.sale_date)} · Total ${money(r.total_amount)}</div>
            </div>
            <div class="row-right">
              <div class="row-amount bal-due">${money(r.bal)}</div>
              <div class="row-bal" style="color:var(--muted)">due</div>
            </div>
          </div>`)
          .join("")
      : `<div class="empty">No pending dues (lena hai) — everything is settled.</div>`;

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
              <div class="row-bal ${r.bal > 0.009 ? "bal-due" : "bal-ok"}">${r.bal > 0.009 ? money(r.bal) + " due" : "Paid"}</div>
            </div>
            <div class="row-actions">
              ${r.bal > 0.009 ? `<button type="button" class="btn btn-sm btn-primary" data-act="pay">+ Pay</button>` : ""}
              <button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>
              <button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>
            </div>
          </div>`)
          .join("")
      : `<div class="empty">No dues (dena hai) yet. Add what you owe dealers/suppliers.</div>`;

    $$("#payable-list .row").forEach((el) => {
      const r = rows.find((x) => x.id === el.dataset.id);
      el.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "pay") openPaymentModal("payable", r.id, `${r.party} — balance ${money(r.bal)}`, r.bal);
        else if (act === "edit") openPayableForm(r);
        else if (act === "del")
          askConfirm("Delete dues?", `Delete ${r.party} (${money(r.amount)})? Its payments will also be removed.`, async () => {
            busy(true);
            const { error } = await sb.from("payables").delete().eq("id", r.id);
            busy(false);
            if (error) return toast(error.message, true);
            toast("Dues deleted");
            loadPayables();
          });
        else if (r.bal > 0.009) openPaymentModal("payable", r.id, `${r.party} — balance ${money(r.bal)}`, r.bal);
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
  $("#payable-modal-title").textContent = r ? "Edit dues" : "Add dues (dena hai)";
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
  const payload = {
    entry_date: $("#payable-date").value || todayISO(),
    party: $("#payable-party").value.trim(),
    amount: round2(num($("#payable-amount").value)),
    notes: $("#payable-notes").value.trim() || null,
  };
  if (!payload.party) { errEl.textContent = "Party name is required."; errEl.hidden = false; return; }
  if (payload.amount <= 0) { errEl.textContent = "Amount must be greater than 0."; errEl.hidden = false; return; }

  busy(true);
  try {
    const { error } = id
      ? await sb.from("payables").update(payload).eq("id", id)
      : await sb.from("payables").insert(payload);
    if (error) throw error;
    closeModals();
    toast(id ? "Dues updated" : "Dues added");
    loadPayables();
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
  $("#pay-amount").max = max;
  $("#pay-amount").placeholder = "Up to " + money(max);
  openModal("modal-payment");
}

async function savePayment(e) {
  e.preventDefault();
  const errEl = $("#payment-form-error");
  errEl.hidden = true;
  const type = $("#pay-target-type").value;
  const id = $("#pay-target-id").value;
  const amount = round2(num($("#pay-amount").value));
  const max = round2(num($("#pay-amount").max));

  if (amount <= 0) { errEl.textContent = "Amount must be greater than 0."; errEl.hidden = false; return; }
  if (amount > max + 0.009) { errEl.textContent = `Amount cannot exceed the outstanding balance of ${money(max)}.`; errEl.hidden = false; return; }

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
    toast("Payment recorded");
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

/* ============ ledger ============ */
let ledgerRows = [];

async function loadLedger() {
  busy(true);
  try {
    const { data, error } = await sb.from("ledger_entries").select("*").order("entry_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error;
    ledgerRows = data || [];

    const dr = ledgerRows.reduce((s, r) => s + num(r.debit), 0);
    const cr = ledgerRows.reduce((s, r) => s + num(r.credit), 0);
    $("#ledger-totals").innerHTML = `
      <span class="lt dr">Dr ${money(dr)}</span>
      <span class="lt cr">Cr ${money(cr)}</span>
      <span class="lt">Net ${money(cr - dr)}</span>`;

    $("#ledger-list").innerHTML = ledgerRows.length
      ? ledgerRows
          .map((r) => `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(r.particulars)}</div>
              <div class="row-sub">${fmtDate(r.entry_date)}${r.notes ? " · " + esc(r.notes) : ""}</div>
            </div>
            <div class="row-right">
              ${num(r.debit) > 0 ? `<div class="row-amount" style="color:var(--violet)">Dr ${money(r.debit)}</div>` : ""}
              ${num(r.credit) > 0 ? `<div class="row-amount" style="color:var(--green)">Cr ${money(r.credit)}</div>` : ""}
            </div>
            <div class="row-actions">
              <button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>
              <button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>
            </div>
          </div>`)
          .join("")
      : `<div class="empty">No entries yet.</div>`;

    $$("#ledger-list .row").forEach((el) => {
      const r = ledgerRows.find((x) => x.id === el.dataset.id);
      el.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "del")
          askConfirm("Delete entry?", `Delete “${r.particulars}”?`, async () => {
            busy(true);
            const { error } = await sb.from("ledger_entries").delete().eq("id", r.id);
            busy(false);
            if (error) return toast(error.message, true);
            toast("Entry deleted");
            loadLedger();
          });
        else openLedgerForm(r);
      });
    });
  } finally {
    busy(false);
  }
}

function openLedgerForm(r = null) {
  $("#ledger-form").reset();
  $("#ledger-form-error").hidden = true;
  $("#ledger-id").value = r?.id || "";
  $("#ledger-modal-title").textContent = r ? "Edit entry" : "New entry";
  $("#ledger-date").value = r?.entry_date || todayISO();
  $("#ledger-particulars").value = r?.particulars || "";
  $("#ledger-debit").value = r ? num(r.debit) : 0;
  $("#ledger-credit").value = r ? num(r.credit) : 0;
  $("#ledger-notes").value = r?.notes || "";
  openModal("modal-ledger");
}

async function saveLedger(e) {
  e.preventDefault();
  const errEl = $("#ledger-form-error");
  errEl.hidden = true;
  const id = $("#ledger-id").value;
  const payload = {
    entry_date: $("#ledger-date").value || todayISO(),
    particulars: $("#ledger-particulars").value.trim(),
    debit: round2(num($("#ledger-debit").value)),
    credit: round2(num($("#ledger-credit").value)),
    notes: $("#ledger-notes").value.trim() || null,
  };
  if (!payload.particulars) { errEl.textContent = "Details are required."; errEl.hidden = false; return; }
  if (payload.debit <= 0 && payload.credit <= 0) { errEl.textContent = "Enter a debit or credit amount."; errEl.hidden = false; return; }
  if (payload.debit > 0 && payload.credit > 0) { errEl.textContent = "Enter either debit OR credit, not both."; errEl.hidden = false; return; }

  busy(true);
  try {
    const { error } = id
      ? await sb.from("ledger_entries").update(payload).eq("id", id)
      : await sb.from("ledger_entries").insert(payload);
    if (error) throw error;
    closeModals();
    toast(id ? "Entry updated" : "Entry added");
    loadLedger();
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
  $("#sales-search").addEventListener("input", (e) => { state.search = e.target.value; renderSales(); });
  $("#sales-source-filter").addEventListener("change", (e) => { state.source = e.target.value; renderSales(); });

  /* sale form */
  $("#sale-form").addEventListener("submit", saveSale);
  ["sale-total", "sale-cash", "sale-bank", "sale-loan", "sale-source", "sale-installment", "inst-count", "inst-first"].forEach(
    (id) => $("#" + id).addEventListener("input", syncSaleForm)
  );
  $("#sale-installment").addEventListener("change", syncSaleForm);
  $("#sale-source").addEventListener("change", syncSaleForm);

  /* payables / ledger / payment forms */
  $("#new-payable-btn").addEventListener("click", () => openPayableForm());
  $("#payable-form").addEventListener("submit", savePayable);
  $("#new-ledger-btn").addEventListener("click", () => openLedgerForm());
  $("#ledger-form").addEventListener("submit", saveLedger);
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
