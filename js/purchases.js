/* ============================================================
   purchases.js - things we bought (batch or local)
   -----------------------------------------------------------
   Purchase list with paid/remaining balance and status badge,
   plus the purchase form (cash/bank/installments).
   PROVIDES: loadPurchases, renderPurchases, syncPurchaseMode, openPurchaseForm,
     syncPurchaseForm, renderPurchaseInstPreview, savePurchase
   ============================================================ */

/* ============ purchases (things we bought) ============ */

// Fetch every purchase together with its payments and installments, then
// work out each row's balance and status badge.
async function loadPurchases() {
  busy(true);
  try {
    // One round trip per table: purchases, all payments, all installment rows.
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

    // Group payments and installments by purchase id, so each purchase can
    // be scored below with a simple lookup instead of re-scanning the tables.
    const pay = {}, payCount = {};
    for (const p of payR.data || []) if (p.purchase_id) {
      pay[p.purchase_id] = (pay[p.purchase_id] || 0) + num(p.amount);
      payCount[p.purchase_id] = (payCount[p.purchase_id] || 0) + 1;
    }
    const instMap = {};
    for (const s of iR.data || []) (instMap[s.purchase_id] ||= []).push(s);
    for (const k of Object.keys(instMap)) instMap[k].sort((a, b) => a.installment_no - b.installment_no);

    const today = todayISO();
    // Per purchase: how much was paid, how much is still owed, and the badge.
    state.purchaseRows = (pR.data || []).map((r) => {
      const paid = round2(pay[r.id] || 0);
      const count = payCount[r.id] || 0;
      // Remaining = total price minus what was covered up front (cash + bank) minus later payments.
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
      // Badge: balance cleared → paid; a late installment (or a past due date
      // on a purchase with no schedule) → overdue; money already moved →
      // partial; otherwise pending. A purchase with no schedule at all still
      // gets its badge — that is how an "unknown plan" row is marked.
      const covered = num(r.cash_amount) + num(r.bank_amount) + paid;
      const status = bal <= 0.009 ? "paid"
        : sched.length ? (overdueInst ? "overdue" : paid > 0 ? "partial" : "pending")
        : r.due_date && r.due_date < today ? "overdue"
        : covered > 0.009 ? "partial"
        : "pending";
      return { ...r, bal, paid, payCount: count, instCount: sched.length, instPaid, status };
    });
    renderPurchases();
  } finally {
    busy(false);
  }
}

// Rebuild the summary cards, the filtered purchase list, and the buttons on each row.
function renderPurchases() {
  const rows = state.purchaseRows;
  const today = todayISO();
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const inMonth = rows.filter((r) => String(r.entry_date).startsWith(month));
  const inYear = rows.filter((r) => String(r.entry_date).startsWith(year));
  const sum = (list) => list.reduce((s, r) => s + num(r.amount), 0);

  // Summary cards: totals and counts for this month, this year, and all time.
  $("#purchase-summary").innerHTML = `
    <div class="stat tone-amber"><div class="stat-label">This month</div><div class="stat-value">${money(sum(inMonth))}</div><div class="stat-sub">${inMonth.length} purchase${inMonth.length === 1 ? "" : "s"}</div></div>
    <div class="stat tone-brand"><div class="stat-label">This year</div><div class="stat-value">${money(sum(inYear))}</div><div class="stat-sub">${inYear.length} purchase${inYear.length === 1 ? "" : "s"}</div></div>
    <div class="stat tone-red"><div class="stat-label">All time</div><div class="stat-value">${money(sum(rows))}</div><div class="stat-sub">${rows.length} recorded</div></div>`;

  // Narrow the rows by the search box (title, supplier, notes), then by the
  // saved list filters (date range, etc.).
  const q = state.purchaseSearch.toLowerCase();
  const searched = rows.filter(
    (r) =>
      !q ||
      (r.title || "").toLowerCase().includes(q) ||
      (r.supplier || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q)
  );
  const shown = applyListFilters("purchases", searched, rows);

  // What may THIS user do here (see core.js): + Pay and Edit need write
  // access, ✕ needs the flow's delete tick, and a plain tap opens the
  // edit form only when they can actually change something.
  const canWrite = can("purchases", "write");
  const canDel = canDelete("purchases");

  // One HTML row per purchase: title + status badge, date/supplier/installment
  // progress, amount + balance, then the action buttons (or an empty message).
  $("#purchase-list").innerHTML = shown.length
    ? shown
        .map(
          (r) => `<div class="row" data-id="${r.id}">
            <div class="row-main">
              <div class="row-title">${esc(oneLine(r.title))}${r.status ? `<span class="badge badge-${r.status}">${r.status}</span>` : ""}</div>
              <div class="row-sub">${fmtDate(r.entry_date)}${r.supplier ? " · " + esc(r.supplier) : ""}${r.instCount ? ` · ${r.instPaid}/${r.instCount} installments paid` : ""}${r.due_date ? ` · due ${fmtDate(r.due_date)}` : ""}${r.payCount ? ` · ${r.payCount} payment${r.payCount === 1 ? "" : "s"}` : ""}${r.notes ? " · " + esc(r.notes) : ""}</div>
            </div>
            <div class="row-right">
              <div class="row-amount ${r.bal > 0.009 ? "bal-due" : ""}">${money(r.amount)}</div>
              <div class="row-bal" style="color:var(--muted)">${r.bal > 0.009 ? money(r.bal) + " left" : "bought"}</div>
            </div>
            ${canWrite || canDel ? `<div class="row-actions">
              ${canWrite && r.bal > 0.009 ? `<button type="button" class="btn btn-sm btn-primary" data-act="pay">+ Pay</button>` : ""}
              ${canWrite && r.bal <= 0.009 && r.payCount > 0 ? `<button type="button" class="btn btn-sm btn-ghost" data-act="hist">History</button>` : ""}
              ${canWrite ? `<button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>` : ""}
              ${canDel ? `<button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>` : ""}
            </div>` : ""}
          </div>`
        )
        .join("")
    : `<div class="empty">${
        listFiltersActive("purchases") ? "No purchases match these filters." : "No purchases yet."
      }</div>`;

  // Wire each row's buttons: pay the remaining balance, open the edit form,
  // or delete after confirmation (clicking elsewhere on the row edits too).
  $$("#purchase-list .row").forEach((el) => {
    const r = rows.find((x) => x.id === el.dataset.id);
    el.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "pay") openPaymentModal("purchase", r.id, `${oneLine(r.title)} — still to pay ${money(r.bal)}`, r.bal);
      /* fully paid with payments behind it → the sheet opens history-only */
      else if (act === "hist") openPaymentModal("purchase", r.id, `${oneLine(r.title)} — paid in full`, 0);
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
      else if (canWrite) openPurchaseForm(r);   /* read-only rows don't open the form */
    });
  });
}

/* ---- batch vs local: ask first, then show the matching input ----
   batch  = one statement line ("5 machines, 20 probes, 3 printers")
   local  = the item picker (machine dropdown + tick-boxes, one line each) */
function syncPurchaseMode() {
  const checked = $$("#purchase-mode input").find((x) => x.checked);
  const mode = checked ? checked.value : "";
  // Show only the input that matches the chosen mode: the batch statement box
  // or the local item picker (and never both).
  $("#purchase-statement-field").hidden = mode !== "batch";
  $("#purchase-picker-area").hidden = mode !== "local";
  $$("#purchase-mode .mode-opt").forEach((opt) =>
    opt.classList.toggle("is-on", opt.querySelector("input").checked)
  );
}

/* ===== purchase form ===== */

// Open the modal: blank for a new purchase, or pre-filled when editing an existing one.
async function openPurchaseForm(r = null) {
  // Start from a clean form and reset the error line.
  $("#purchase-form").reset();
  $("#purchase-form-error").hidden = true;
  $("#purchase-id").value = r?.id || "";
  $("#purchase-modal-title").textContent = r ? "Edit purchase" : "New purchase";
  $("#purchase-date").value = r?.entry_date || todayISO();
  /* a new purchase asks first (no mode selected); editing restores the stored one
     (legacy rows have no mode → batch, which matches how they were written) */
  const mode = r ? (r.mode === "local" ? "local" : "batch") : "";
  $$("#purchase-mode input").forEach((x) => { x.checked = x.value === mode; });
  // Fill in what was bought: the item picker for local mode, or the free-text
  // statement (newlines flattened to spaces) for batch mode.
  renderItems(mode === "local" ? r?.title : "", "purchase");
  $("#purchase-statement").value = mode === "batch" ? String(r.title || "").replace(/\s*\n\s*/g, " ") : "";
  $("#purchase-supplier").value = r?.supplier || "";
  $("#purchase-amount").value = r ? num(r.amount) : "";
  /* how it was paid + the installment schedule, restored for editing */
  $("#purchase-cash").value = r && num(r.cash_amount) > 0 ? num(r.cash_amount) : "";
  $("#purchase-bank").value = r && num(r.bank_amount) > 0 ? num(r.bank_amount) : "";
  $("#purchase-due").value = r?.due_date || "";
  // Installment defaults for a fresh form: off, 12 parts, no first due date.
  $("#purchase-installment").checked = false;
  $("#purchase-inst-count").value = "12";
  $("#purchase-inst-first").value = "";
  // When editing, bring the stored schedule back so the fields match what was saved.
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
  // Apply the chosen mode, refresh the "paid / left to pay" summary, show the modal.
  syncPurchaseMode();
  syncPurchaseForm();
  openModal("modal-purchase");
}

// Keep the "paid now / left to pay" summary and the installment fields in
// step with whatever is typed into the form.
function syncPurchaseForm() {
  // Recompute paid vs left from the total, cash and bank boxes, and warn if
  // the money paid up front overshoots the total.
  const total = amt($("#purchase-amount").value);
  const paid = amt($("#purchase-cash").value) + amt($("#purchase-bank").value);
  const due = round2(total - paid);
  const inst = $("#purchase-installment").checked;
  $("#purchase-paid-summary").innerHTML =
    total <= 0
      ? `Enter the amount above — what is paid and what is left shows here.`
      : `Paid now: <b>${money(paid)}</b>` +
        ` &nbsp;·&nbsp; Left to pay: <b>${money(Math.max(due, 0))}</b>` +
        /* with no schedule the balance simply stays "left" — say so, so it is
           clear the purchase can be saved without knowing the plan yet */
        (due > 0.009 && !inst
          ? `<br><span style="color:var(--muted)">Save it as it is — the left-over stays marked, and each payment is recorded later with + Pay.</span>`
          : "") +
        (paid > total + 0.009 ? `<br><span style="color:var(--red)">The paid amount is more than the total — fix it before saving.</span>` : "");

  // Show or hide the installment fields, and preview the schedule when they are on.
  $("#purchase-inst-fields").hidden = !inst;
  if (inst) renderPurchaseInstPreview();
}

/* ===== installment schedule preview ===== */

// Show how the unpaid balance would be split: count × amount, plus the first
// and last due dates, so the user can sanity-check it before saving.
function renderPurchaseInstPreview() {
  // Only the unpaid part gets split into installments (total minus cash and bank).
  const total = amt($("#purchase-amount").value);
  const paid = amt($("#purchase-cash").value) + amt($("#purchase-bank").value);
  const financed = round2(total - paid);
  // Clamp the count to 1..120 (blank/garbage input counts as 0 → clamped to 1).
  const count = Math.max(1, Math.min(120, parseInt($("#purchase-inst-count").value, 10) || 0));
  const first = $("#purchase-inst-first").value;
  const el = $("#purchase-inst-preview");

  // Nothing to preview yet if it's fully paid or no first due date is chosen.
  if (financed <= 0) { el.innerHTML = "Everything is already paid, so there is nothing left to split into installments."; return; }
  if (!first) { el.innerHTML = "Pick a first due date to see the schedule."; return; }

  // Build the real schedule, then summarise it: per-installment amount and
  // the first/last due dates.
  const rows = buildSchedule(financed, count, first);
  const per = rows[0]?.amount || 0;
  el.innerHTML = `
    <div class="inst-line"><span>${count} × ${money(per)}</span><span>${money(financed)} financed</span></div>
    <div class="inst-line"><span>First due ${fmtDate(rows[0].due)}</span><span>Last due ${fmtDate(rows[rows.length - 1].due)}</span></div>`;
}

/* ===== save purchase ===== */

// Validate the form, then save the purchase row (new or edit) and its
// installment schedule to the database.
async function savePurchase(e) {
  e.preventDefault();
  // Clear the previous error message, then read everything off the form:
  // mode, amounts, installment settings and the item list.
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

  // Helper that shows a message in the form; each check below stops through it.
  const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };
  // Check everything before touching the database: a mode was chosen, there is
  // something to save, and the money fields are real numbers.
  if (!mode) return fail("First choose whether this is a batch purchase or a local purchase.");
  if (!items.length) return fail(mode === "batch" ? "Please write what was bought as one statement — how many machines, probes, etc." : "Please enter what was bought — pick a machine, tick the boxes, or add a line.");
  if ([amountN, cashN, bankN].some(Number.isNaN)) return fail(AMOUNT_HINT);

  // Round the money and work out how much is left to finance (total − cash − bank).
  const total = round2(amountN);
  const cash = round2(cashN);
  const bank = round2(bankN);
  const financed = round2(total - cash - bank);
  if (total <= 0) return fail("Enter how much was paid for it.");
  if (cash + bank > total + 0.009) return fail("The paid amount can't be more than the total purchase.");
  // Installments need something left unpaid to spread out; WITHOUT them the
  // leftover is fine too — it simply stays "left to pay" (marked on the row
  // and settled later, payment by payment, from the To pay tab).
  if (isInst) {
    if (financed <= 0) return fail("For installments, leave some amount unpaid (total minus paid).");
    if (count < 1 || count > 120) return fail("Enter between 1 and 120 installments.");
    if (!first) return fail("Pick the first due date.");
  }

  // The row we save: items joined into one title, money rounded, mode stored.
  const payload = {
    entry_date: $("#purchase-date").value || todayISO(),
    title: items.join("\n"),
    supplier: $("#purchase-supplier").value.trim() || null,
    amount: total,
    cash_amount: cash,
    bank_amount: bank,
    due_date: $("#purchase-due").value || null,
    notes: $("#purchase-notes").value.trim() || null,
    mode,
  };

  busy(true);
  try {
    // Update the existing row, or insert a new one and keep its id for the schedule.
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
    // Write the new schedule rows (installment number, due date, amount).
    if (isInst) {
      const rows = buildSchedule(financed, count, first).map((r) => ({
        purchase_id: purchaseId, installment_no: r.no, due_date: r.due, amount: r.amount,
      }));
      if (rows.length) {
        const { error } = await sb.from("purchase_installments").insert(rows);
        if (error) throw error;
      }
    }

    // Done: close the modal and refresh this list (and payables if that screen is open).
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
