/* ============================================================
   payments.js - the payment sheet (used by every tab that takes money)
   -----------------------------------------------------------
   One modal for every target: sale, owe entry, purchase, loan, and the
   COMBINED blocks (purchase-group / sale-group — same day + same person
   the user chose to combine), which split one payment across their
   members oldest-first so every individual balance stays right.
   A loan that receives its last rupee is marked Returned automatically.
   The sheet also lists the payment HISTORY of its target (newest first);
   when nothing is left to pay it opens in history-only mode.
   PROVIDES: openPaymentModal, savePayment, renderPayHistory
   ============================================================ */

/* ============ payments ============ */
// Prepares and opens the shared payment sheet for whichever target is receiving money.
// Group targets pass their member ids as `ids` (history + splitting need them).
async function openPaymentModal(type, id, context, max, ids = null) {
  // Remember which modal opened this one, so we can go back to it after saving.
  state.returnTo = $$(".modal").find((m) => !m.hidden)?.id || null;
  state.returnSaleId = type === "sale" ? id : null;
  state.returnLoanId = type === "loan" ? id : null;
  state.payIds = ids;
  // Start from a clean form: today's date, no errors, and the target (type + id) stored in hidden fields.
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

  /* nothing left to pay → the entry fields hide and the sheet becomes a
     read-only history of what has already been paid */
  const viewOnly = full <= 0.009;
  $("#payment-fields").hidden = viewOnly;
  $("#pay-save-btn").hidden = viewOnly;

  // Load every payment recorded against this target (newest first) so the
  // history at the bottom of the sheet is ready the moment it opens. A
  // combined block pulls the history of ALL its members together.
  const col = type === "sale" || type === "sale-group" ? "sale_id"
            : type === "payable" ? "payable_id"
            : type === "purchase" || type === "purchase-group" ? "purchase_id" : "loan_id";
  busy(true);
  try {
    const isGroup = (type === "purchase-group" || type === "sale-group") && ids?.length;
    let q = sb.from("payments").select("*");
    q = isGroup ? q.in(col, ids) : q.eq(col, id);
    const { data, error } = await q
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    renderPayHistory(data || []);
  } catch (err) {
    renderPayHistory([]);
    toast(err.message, true);
  } finally {
    busy(false);
  }
  openModal("modal-payment");
}

// Draws the payment history lines: amount + method badge, then the date,
// who handed the money over and any notes underneath.
function renderPayHistory(pays) {
  const total = pays.reduce((s, p) => s + num(p.amount), 0);
  $("#pay-history-label").textContent = pays.length
    ? `History — paid so far ${money(total)}`
    : "History";
  $("#pay-history").innerHTML = pays.length
    ? pays
        .map(
          (p) => `<div class="pay-item">
            <div class="pi-main"><b>${money(p.amount)}</b> <span class="badge badge-${p.method}">${p.method}</span>
              <div class="pi-sub">${fmtDate(p.paid_at)}${p.payer ? " · given by " + esc(p.payer) : ""}${p.notes ? " · " + esc(p.notes) : ""}</div>
            </div>
          </div>`
        )
        .join("")
    : `<div class="empty" style="padding:12px">No payments recorded yet.</div>`;
}

async function savePayment(e) {
  e.preventDefault();
  const errEl = $("#payment-form-error");
  errEl.hidden = true;
  const type = $("#pay-target-type").value;
  const id = $("#pay-target-id").value;
  const amountN = parseAmount($("#pay-amount").value);
  const max = round2(num(state.payMax));
  /* history-only mode (nothing left to pay): Enter must not try to save */
  if (max <= 0.009) { closeModals(); return; }

  // Validate the amount: it must be a real number, above zero, and no more than what is still due.
  if (Number.isNaN(amountN)) { errEl.textContent = AMOUNT_HINT; errEl.hidden = false; return; }
  const amount = round2(amountN);
  if (amount <= 0) { errEl.textContent = "Enter how much was paid."; errEl.hidden = false; return; }
  if (amount > max + 0.009) { errEl.textContent = `That is more than the remaining ${money(max)}.`; errEl.hidden = false; return; }

  /* a COMBINED block pays across all of its entries — split the amount over
     them (oldest first) instead of writing one row */
  if (type === "purchase-group" || type === "sale-group") {
    return saveGroupPayment(type, amount, errEl);
  }

  // Build the row to insert: exactly one of the *_id columns is filled in, the others stay null.
  const payload = {
    paid_at: $("#pay-date").value || todayISO(),
    amount,
    method: $("#pay-method").value,
    payer: $("#pay-payer").value.trim() || null,
    notes: $("#pay-notes").value.trim() || null,
    sale_id: type === "sale" ? id : null,
    payable_id: type === "payable" ? id : null,
    purchase_id: type === "purchase" ? id : null,
    loan_id: type === "loan" ? id : null,
  };

  busy(true);
  try {
    // Save the payment - if this fails we jump to catch and the sheet stays open with the error.
    const { error } = await sb.from("payments").insert(payload);
    if (error) throw error;
    closeModals();
    // Work out what is still owed/receivable and toast a message that matches the situation.
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
        .is("returned_at", null); // ... only stamp it once, never overwrite an existing Returned date
      if (rErr) toast(rErr.message, true);
    }

    // Refresh whichever screen the user came from, so the new payment shows up right away.
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
    // Database errors are shown inside the sheet instead of closing it.
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    busy(false);
  }
}

/* A payment against a COMBINED block (purchase-group / sale-group): split the
   amount across its members, OLDEST FIRST, never past one member's own
   remaining balance — so the total gets paid down while every individual row
   stays correct. One insert, so the split is all-or-nothing. */
async function saveGroupPayment(type, amount, errEl) {
  const isPurchase = type === "purchase-group";
  const table = isPurchase ? "purchases" : "sales";
  const col = isPurchase ? "purchase_id" : "sale_id";
  const ids = state.payIds || [];
  busy(true);
  try {
    // Fresh member balances + everything already paid against them (the list
    // may have moved on since the sheet opened).
    const [mR, pR] = await Promise.all([
      sb.from(table)
        .select(isPurchase ? "id, amount, cash_amount, bank_amount"
                           : "id, total_amount, cash_amount, bank_amount, adjustment_amount, loan_amount")
        .in("id", ids)
        .order("created_at", { ascending: true }),          // oldest first
      sb.from("payments").select(`${col}, amount`).in(col, ids),
    ]);
    if (mR.error) throw mR.error;
    if (pR.error) throw pR.error;
    const paid = {};
    for (const p of pR.data || []) if (p[col]) paid[p[col]] = (paid[p[col]] || 0) + num(p.amount);

    const left = (mR.data || []).map((m) => {
      const remain = isPurchase
        ? num(m.amount) - num(m.cash_amount) - num(m.bank_amount) - (paid[m.id] || 0)
        : num(m.total_amount) - num(m.cash_amount) - num(m.bank_amount)
          - num(m.adjustment_amount) - num(m.loan_amount) - (paid[m.id] || 0);
      return { id: m.id, left: round2(Math.max(remain, 0)) };
    });
    const freshMax = round2(left.reduce((s, m) => s + m.left, 0));
    if (amount > freshMax + 0.009) {
      errEl.textContent = `That is more than the remaining ${money(freshMax)}.`;
      errEl.hidden = false;
      return;
    }

    // Fill each member in turn; whatever is still left moves to the next.
    let rest = amount;
    const rows = [];
    for (const m of left) {
      if (rest <= 0.009) break;
      const take = round2(Math.min(m.left, rest));
      if (take <= 0) continue;
      rows.push({
        paid_at: $("#pay-date").value || todayISO(),
        amount: take,
        method: $("#pay-method").value,
        payer: $("#pay-payer").value.trim() || null,
        notes: $("#pay-notes").value.trim() || null,
        sale_id: isPurchase ? null : m.id,
        purchase_id: isPurchase ? m.id : null,
        payable_id: null,
        loan_id: null,
      });
      rest = round2(rest - take);
    }
    if (!rows.length) return;
    const { error } = await sb.from("payments").insert(rows);
    if (error) throw error;

    closeModals();
    const after = round2(freshMax - amount);
    if (after > 0.009) toast("Payment added");
    else if (isPurchase) toast("Fully paid ✓ — nothing left to pay");
    else toast("Fully paid ✓ — nothing left to receive");

    // Refresh the screen the block lives on.
    if (isPurchase) {
      if (state.view === "payables") loadPayables();
      loadPurchases();
    } else {
      if (state.view === "sales") loadSales();
      else if (state.view === "receivables") loadReceivables();
      else if (state.view === "dashboard") loadDashboard();
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    busy(false);
  }
}
