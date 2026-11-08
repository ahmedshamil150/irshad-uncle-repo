/* ============================================================
   zakat.js - money given out as zakat
   -----------------------------------------------------------
   Simple list + form, same pattern as expenses.
   PROVIDES: loadZakat, renderZakat, openZakatForm, saveZakat
   ============================================================ */

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
