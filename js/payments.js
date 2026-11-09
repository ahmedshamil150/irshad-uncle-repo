/* ============================================================
   payments.js - the payment sheet (used by every tab that takes money)
   -----------------------------------------------------------
   One modal for all four targets: sale, owe entry, purchase, loan.
   A loan that receives its last rupee is marked Returned automatically.
   PROVIDES: openPaymentModal, savePayment
   ============================================================ */

/* ============ payments ============ */
// Prepares and opens the shared payment sheet for whichever target is receiving money.
function openPaymentModal(type, id, context, max) {
  // Remember which modal opened this one, so we can go back to it after saving.
  state.returnTo = $$(".modal").find((m) => !m.hidden)?.id || null;
  state.returnSaleId = type === "sale" ? id : null;
  state.returnLoanId = type === "loan" ? id : null;
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

  // Validate the amount: it must be a real number, above zero, and no more than what is still due.
  if (Number.isNaN(amountN)) { errEl.textContent = AMOUNT_HINT; errEl.hidden = false; return; }
  const amount = round2(amountN);
  if (amount <= 0) { errEl.textContent = "Enter how much was paid."; errEl.hidden = false; return; }
  if (amount > max + 0.009) { errEl.textContent = `That is more than the remaining ${money(max)}.`; errEl.hidden = false; return; }

  // Build the row to insert: exactly one of the *_id columns is filled in, the others stay null.
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
