/* ============================================================
   sales.js - sales list, sale detail, salesmen and the New Sale form
   -----------------------------------------------------------
   The biggest screen: list + ⚙ filters + search, the detail sheet,
   the salesman manager, and the sale form with its installment schedule.
   PROVIDES: loadSales, filterSales, renderSales, applyQuickRange, openSaleDetail,
     loadSalesmen, openSalesmenModal, saveSalesman, openSaleForm,
     syncSaleForm, buildSchedule, renderInstPreview, saveSale
   ============================================================ */

/* ============ sales ============ */
/* Load every sale plus all its payments, then redraw the list */
async function loadSales() {
  busy(true);
  try {
    /* fetch sales and payments together so the balances are ready below */
    const [sR, pR] = await Promise.all([
      sb.from("sales").select("*").order("sale_date", { ascending: false }).order("created_at", { ascending: false }),
      sb.from("payments").select("sale_id,amount"),
    ]);
    if (sR.error) throw sR.error;
    if (pR.error) throw pR.error;
    state.sales = sR.data || [];
    /* total paid so far, per sale id — saleOutstanding() reads this map */
    const pay = {};
    for (const p of pR.data || []) if (p.sale_id) pay[p.sale_id] = (pay[p.sale_id] || 0) + num(p.amount);
    state.salesPay = pay;

    /* refresh the customer-name suggestions from every sale we have */
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

/* What is still owed on one sale: total minus everything already paid for it */
function saleOutstanding(r) {
  return round2(
    num(r.total_amount) - num(r.cash_amount) - num(r.bank_amount) - num(r.adjustment_amount) - num(r.loan_amount) - (state.salesPay[r.id] || 0)
  );
}

/* ---- sales filters ---- */
/* How many of the filter fields are actually filled in */
function activeFilterCount() {
  const f = state.f;
  return ["source", "salesman", "kind", "status", "from", "to", "min", "max"]
    .filter((k) => String(f[k] || "").trim() !== "").length;   /* blank or whitespace-only doesn't count */
}

/* true when a search term or any filter is set */
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
