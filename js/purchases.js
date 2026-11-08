/* ============================================================
   purchases.js - things we bought (batch or local)
   -----------------------------------------------------------
   Purchase list with paid/remaining balance and status badge,
   plus the purchase form (cash/bank/installments).
   PROVIDES: loadPurchases, renderPurchases, syncPurchaseMode, openPurchaseForm,
     syncPurchaseForm, renderPurchaseInstPreview, savePurchase
   ============================================================ */

/* ============ purchases (things we bought) ============ */

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
