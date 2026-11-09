/* ============================================================
   payables.js - To pay: what we owe dealers and suppliers
   -----------------------------------------------------------
   Owe entries plus any purchase still owing money, in one list.
   PROVIDES: loadPayables, renderPayables, openPayableForm, savePayable
   ============================================================ */

/* ============ payables ============ */
// Loads owe entries plus still-unpaid purchases, works out each balance, and draws the list.
async function loadPayables() {
  busy(true);
  try {
    // All three queries at once: owe entries, every payment recorded, and purchases
    // (payments and purchases are needed to calculate how much of each is still unpaid).
    const [bR, pR, puR] = await Promise.all([
      sb.from("payables").select("*").order("entry_date", { ascending: false }),
      sb.from("payments").select("payable_id,purchase_id,amount"),
      sb.from("purchases").select("*").order("entry_date", { ascending: false }),
    ]);
    if (bR.error) throw bR.error;
    if (pR.error) throw pR.error;
    if (puR.error) throw puR.error;
    // Running totals keyed by id - how much has been paid against each owe entry and each purchase.
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
        bal: round2(num(r.amount) - num(r.cash_amount) - num(r.bank_amount) - (payP[r.id] || 0)), // ... money still missing: total minus cash, bank and payments so far
      }))
      .filter((r) => r.bal > 0.009);

    // Merge both kinds of rows into one list, newest entry first, then draw it.
    state.payRows = [
      ...(bR.data || []).map((r) => ({ ...r, bal: round2(num(r.amount) - (pay[r.id] || 0)) })),
      ...owedPurchases,
    ].sort((a, b) => String(b.entry_date || "").localeCompare(String(a.entry_date || "")));
    renderPayables();
  } finally {
    busy(false);
  }
}

// Draws the list, applies the search/filters, and wires up each row's Pay/Edit/Delete buttons.
function renderPayables() {
  const all = state.payRows || [];
  // Search matches the party name, the notes, or the purchase title.
  const q = state.paySearch.toLowerCase();
  const searched = all.filter(
    (r) =>
      !q ||
      (r.party || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q) ||
      (r.title || "").toLowerCase().includes(q)
  );
  const rows = applyListFilters("payables", searched, all);

  // Render each row: amount, balance left (or "Paid"), and its action buttons.
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

  // Wire up the row buttons: purchases open the purchase form, owe entries open the owe form.
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
        // Clicking the row itself (not a button): pay when money is still due, otherwise open the form.
        else if (r.bal > 0.009) openPaymentModal(target, r.id, `${r.party} — still to pay ${money(r.bal)}`, r.bal);
        else if (r.isPurchase) openPurchaseForm(r);
        else openPayableForm(r);
      });
    });
}

// Opens the owe-entry form - blank for a new entry, filled in when editing an existing one.
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

// Validates the owe-entry form, then inserts a new entry or updates an existing one.
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
  // Three checks: the amount is a number, a party is named, and the amount is above zero.
  if (Number.isNaN(amountN)) { errEl.textContent = AMOUNT_HINT; errEl.hidden = false; return; }
  if (!payload.party) { errEl.textContent = "Please enter who you owe (dealer / supplier name)."; errEl.hidden = false; return; }
  if (payload.amount <= 0) { errEl.textContent = "Enter the amount you owe."; errEl.hidden = false; return; }

  busy(true);
  try {
    // Update when we arrived with an id (edit mode), otherwise insert a brand-new entry.
    const { error } = id
      ? await sb.from("payables").update(payload).eq("id", id)
      : await sb.from("payables").insert(payload);
    if (error) throw error;
    closeModals();
    toast(id ? "Entry updated" : "Entry added");
    loadPayables();
  } catch (err) {
    // Database errors are shown inside the form instead of closing it.
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    busy(false);
  }
}
