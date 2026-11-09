/* ============================================================
   loans.js - money we gave out (personal loans)
   -----------------------------------------------------------
   List with returned/late state, optional installment schedule of returns,
   and the loan detail sheet (schedule + recorded returns).
   PROVIDES: loadLoans, renderLoans, setLoanReturned, openLoanForm, saveLoan,
     openLoanDetail
   ============================================================ */

/* ============ personal loans (money we gave out) ============ */

/* Pull every loan plus its schedule and returns from the DB, then rebuild the list. */
async function loadLoans() {
  busy(true);
  try {
    /* fetch loans, installment schedules and recorded returns together (one query each) */
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

    /* index returns by loan, and schedule rows by loan (sorted by installment no) */
    const pay = {};
    for (const p of pR.data || []) if (p.loan_id) pay[p.loan_id] = (pay[p.loan_id] || 0) + num(p.amount);
    const instMap = {};
    for (const s of iR.data || []) (instMap[s.loan_id] ||= []).push(s);
    for (const k of Object.keys(instMap)) instMap[k].sort((a, b) => a.installment_no - b.installment_no);

    /* per loan: what came back, what's left, installments settled, and if any is overdue */
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

/* Redraw the loans screen: person suggestions, summary cards and the row list. */
function renderLoans() {
    const rows = state.loanRows;
    const today = todayISO();

    /* unique people already lent to — powers the search box suggestions */
    $("#loan-names").innerHTML = [...new Set(rows.map((r) => r.person))]
      .map((n) => `<option value="${esc(n)}"></option>`)
      .join("");

    /* split into still-out vs returned, and flag anything past due (or with an overdue installment) */
    const open = rows.filter((r) => !r.returned_at);
    const back = rows.filter((r) => r.returned_at);
    const late = open.filter((r) => (r.due_date && r.due_date < today) || r.overdueInst);
    /* "still to get back" = what is actually left of each loan, part by part included */
    const outTotal = open.reduce((s, r) => s + Math.max(r.left, 0), 0);
    const allTotal = rows.reduce((s, r) => s + num(r.amount), 0);
    const lateTotal = late.reduce((s, r) => s + Math.max(r.left, 0), 0);

    /* three summary cards: still to get back, past the due date, total given */
    $("#loan-summary").innerHTML = `
      <div class="stat tone-red"><div class="stat-label">Still to get back</div><div class="stat-value">${money(outTotal)}</div><div class="stat-sub">${open.length} loan${open.length === 1 ? "" : "s"} out</div></div>
      <div class="stat tone-amber"><div class="stat-label">Past the due date</div><div class="stat-value">${late.length}</div><div class="stat-sub">${money(lateTotal)} late</div></div>
      <div class="stat tone-brand"><div class="stat-label">Given out (all)</div><div class="stat-value">${money(allTotal)}</div><div class="stat-sub">${back.length} returned</div></div>`;

    /* search box + ⚙ filters decide which rows are actually shown */
    const q = state.loanSearch.toLowerCase();
    const searched = rows.filter((r) => !q || (r.person || "").toLowerCase().includes(q));
    const shown = applyListFilters("loans", searched, rows);

    /* what may THIS user do here (see core.js): Returned/Edit need write
       access, ✕ needs the flow's delete tick; the detail sheet stays
       viewable by readers, only its action buttons disappear */
    const canWrite = can("loans", "write");
    const canDel = canDelete("loans");

    /* build the rows: badges, dates, money left and each row's buttons */
    $("#loan-list").innerHTML = shown.length
      ? shown
          .map((r) => {
            /* per row: returned? late? does it have an installment schedule? */
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
            ${canWrite || canDel ? `<div class="row-actions">
              ${canWrite ? (isBack
                ? `<button type="button" class="btn btn-sm btn-ghost" data-act="undo">↩ Not back yet</button>`
                : `<button type="button" class="btn btn-sm btn-primary" data-act="back">✓ Returned</button>`) : ""}
              ${canWrite ? `<button type="button" class="btn btn-sm btn-ghost" data-act="edit">Edit</button>` : ""}
              ${canDel ? `<button type="button" class="btn btn-sm btn-ghost" data-act="del">✕</button>` : ""}
            </div>` : ""}
          </div>`;
          })
          .join("")
      : `<div class="empty">${listFiltersActive("loans") ? "No loans match these filters." : "No loans yet."}</div>`;

    /* wire each row: action buttons (returned / edit / delete) and clicking the row itself */
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
        /* installment loans open their detail sheet (readers may look);
           plain loans jump to the edit form — writers only */
        else if (r.instCount > 0) openLoanDetail(r.id);
        else if (canWrite) openLoanForm(r);
      });
    });
}

/* Flip a loan between "returned" and "still to get back" (sets/clears returned_at). */
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

/* Open the loan form: blank for a new loan, or filled in to edit an existing one. */
async function openLoanForm(r = null) {
  try {
    /* start clean, then fill in the loan's values (defaults when adding new) */
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

/* Show/hide the installment fields based on the checkbox, and refresh the preview. */
function syncLoanForm() {
  const inst = $("#loan-installment").checked;
  $("#loan-inst-fields").hidden = !inst;
  if (inst) renderLoanInstPreview();
}

/* Preview the return schedule: how much × how many, plus first/last due date. */
function renderLoanInstPreview() {
  const total = amt($("#loan-amount").value);
  const count = Math.max(1, Math.min(120, parseInt($("#loan-inst-count").value, 10) || 0));   /* clamp to 1..120; blank/junk becomes 1 */
  const first = $("#loan-inst-first").value;
  const el = $("#loan-inst-preview");

  /* nothing to show until there's an amount and a first due date */
  if (total <= 0) { el.innerHTML = "Enter the amount above to see the schedule."; return; }
  if (!first) { el.innerHTML = "Pick a first due date to see the schedule."; return; }

  /* the whole loan comes back — nothing is paid up front */
  const rows = buildSchedule(total, count, first);
  const per = rows[0]?.amount || 0;
  el.innerHTML = `
    <div class="inst-line"><span>${count} × ${money(per)}</span><span>${money(total)} to get back</span></div>
    <div class="inst-line"><span>First due ${fmtDate(rows[0].due)}</span><span>Last due ${fmtDate(rows[rows.length - 1].due)}</span></div>`;
}

/* Validate the form, then save the loan (insert or update) and rebuild its schedule. */
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

  /* the row we'll write to personal_loans (the id only decides update vs insert) */
  const payload = {
    loan_date: $("#loan-date").value || todayISO(),
    person,
    amount: round2(amountN),
    due_date: $("#loan-due").value || null,
    notes: $("#loan-notes").value.trim() || null,
  };
  /* validate before touching the database: who, how much, and a sane schedule */
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

  /* save: insert a new loan or update the existing row, then rebuild the schedule */
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

/* Load one loan with its schedule and returns, fill and open the detail sheet. */
async function openLoanDetail(id) {
  busy(true);
  try {
    /* loan row, its installment schedule and every recorded return — one query each */
    const [lR, iR, pR] = await Promise.all([
      sb.from("personal_loans").select("*").eq("id", id).single(),
      sb.from("loan_installments").select("*").eq("loan_id", id).order("installment_no"),
      sb.from("payments").select("*").eq("loan_id", id).order("paid_at"),
    ]);
    if (lR.error) throw lR.error;
    const loan = lR.data;
    const inst = iR.data || [];
    const pays = pR.data || [];

    /* money received = sum of all returns; left = amount given minus that */
    const received = pays.reduce((s, p) => s + num(p.amount), 0);
    const left = round2(num(loan.amount) - received);
    const today = todayISO();

    /* installment statuses: returns allocate FIFO over the schedule */
    let unpaidBefore = 0, nextDue = null, overdueInst = false;   /* unpaidBefore walks the schedule; nextDue = first unpaid due date */
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

    /* late = past its "Back by" date or holding an overdue installment, and not yet returned */
    const isLate = !loan.returned_at && ((loan.due_date && loan.due_date < today) || overdueInst);

    /* what may THIS user do with this loan (see core.js): + Record return,
       the Returned toggle and Edit need write access, Delete and the ✕ on
       each return need the flow's delete tick */
    const canWrite = can("loans", "write");
    const canDel = canDelete("loans");

    /* one line per recorded return with a delete button (or a "none yet" note) */
    const paysHtml = pays.length
      ? pays
          .map(
            (p) => `<div class="pay-item">
            <div class="pi-main"><b>${money(p.amount)}</b> <span class="badge badge-${p.method}">${p.method}</span>
              <div class="pi-sub">${fmtDate(p.paid_at)}${p.notes ? " · " + esc(p.notes) : ""}</div>
            </div>
            ${canDel ? `<button type="button" class="icon-del" data-delpay="${p.id}" title="Delete return">✕</button>` : ""}
          </div>`
          )
          .join("")
      : `<div class="empty" style="padding:16px">No returns recorded yet.</div>`;

    /* build the sheet: title + badges, dates, totals, action buttons, schedule, returns */
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

      ${canWrite || canDel ? `<div class="detail-actions">
        ${canWrite ? `<button type="button" class="btn btn-primary btn-sm" id="loan-detail-return-btn">+ Record return</button>
        ${loan.returned_at
          ? `<button type="button" class="btn btn-ghost btn-sm" id="loan-detail-back-btn">↩ Not back yet</button>`
          : `<button type="button" class="btn btn-ghost btn-sm" id="loan-detail-back-btn">✓ Returned</button>`}
        <button type="button" class="btn btn-ghost btn-sm" id="loan-detail-edit-btn">Edit</button>` : ""}
        ${canDel ? `<button type="button" class="btn btn-danger btn-sm" id="loan-detail-del-btn">Delete</button>` : ""}
      </div>` : ""}

      ${inst.length ? `<div class="section-label">Installment schedule</div>${instHtml}` : ""}
      <div class="section-label">Returns received</div>
      ${paysHtml}`;

    /* wire the sheet's buttons: record a return, toggle returned, edit, delete */
    if (canWrite) {
      $("#loan-detail-return-btn").onclick = () => {
        if (left <= 0.009) return toast("The full amount is already back.", true);
        openPaymentModal("loan", loan.id, `${loan.person} — still to get back ${money(left)}`, left);
      };
      $("#loan-detail-back-btn").onclick = async () => {
        await setLoanReturned(loan, !loan.returned_at);
        openLoanDetail(loan.id).catch(() => {});
      };
      $("#loan-detail-edit-btn").onclick = () => openLoanForm(loan);
    }
    if (canDel)
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
    /* the ✕ on each recorded return deletes just that return (after confirmation) */
    if (canDel)
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
