/* ============================================================
   main.js - wires every button to its code, then starts the app
   -----------------------------------------------------------
   bindEvents() maps the HTML (buttons, search boxes, forms, ⚙ panels)
   to the functions in the other files. boot() at the bottom is the
   entry point - this file must load LAST.
   PROVIDES: bindEvents, boot call
   ============================================================ */

/* ============ events ============ */

/* Attaches every listener; the groups below are labelled by screen/feature. */
function bindEvents() {
  /* login screen + logout button */
  $("#login-form").addEventListener("submit", login);
  $("#logout-btn").addEventListener("click", async () => {
    await sb.auth.signOut();
    toast("Signed out");
  });

  /* top tabs and the bottom nav both switch screens */
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
  /* custom from/to dates reload the dashboard straight away */
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
  /* helper: one ⚙ filter input writes into state.f and re-renders the sales list */
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

  /* quick-range buttons inside the sales ⚙ panel */
  $("#sf-quick").addEventListener("click", (e) => {
    const b = e.target.closest(".seg");
    if (b) applyQuickRange(b.dataset.range);
  });

  /* reset every sales filter + the search box */
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
  ["sale-total", "sale-cash", "sale-bank", "sale-adjustment", "sale-loan", "sale-source", "sale-installment", "inst-count", "inst-first"].forEach(
    (id) => $("#" + id).addEventListener("input", syncSaleForm)
  );
  $("#sale-installment").addEventListener("change", syncSaleForm);
  $("#sale-source").addEventListener("change", syncSaleForm);

  /* item lines — the sale form and the purchase form share one procedure */
  for (const scope of Object.keys(PICKERS)) {
    const p = PICKERS[scope];
    $(p.add).addEventListener("click", () => {
      const row = itemRow();
      $(p.list).appendChild(row);
      row.querySelector("input").focus();
    });
    $(p.list).addEventListener("click", (e) => {
      const del = e.target.closest(".item-del");
      if (del) { del.closest(".item-row").remove(); syncItemChecks(scope); }
    });
    $(p.list).addEventListener("input", () => syncItemChecks(scope));   /* typing "Printer" by hand ticks its box */
    $(p.list).addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.classList.contains("item-input")) {
        e.preventDefault();
        const row = itemRow();
        $(p.list).appendChild(row);
        row.querySelector("input").focus();
      }
    });

    /* machine dropdown → adds a line, then resets so the same type can be picked again */
    $(p.machine).addEventListener("change", (e) => {
      if (!e.target.value) return;
      addNewItem(e.target.value, scope);
      e.target.value = "";
    });

    /* printer / probes → tick adds a line, untick removes that exact line */
    $(p.checks).addEventListener("change", (e) => {
      const cb = e.target.closest("input[type=checkbox]");
      if (!cb) return;
      if (cb.checked) addNewItem(cb.value, scope);
      else removeItemRow(cb.value, scope);
      syncItemChecks(scope);
    });
  }

  /* money fields: focus selects everything, blur turns 5l into 500000 */
  document.addEventListener("focusin", (e) => {
    if (e.target.matches?.(".amt")) e.target.select();   /* select-all so typing replaces the old amount */
  });
  document.addEventListener("focusout", (e) => {
    const el = e.target;
    if (!el.matches?.(".amt")) return;
    const raw = el.value.trim();
    if (!raw) return;
    const n = parseAmount(raw);
    if (Number.isNaN(n)) return toast(AMOUNT_HINT, true);   /* not a number → warn, leave the text as typed */
    el.value = String(n);
  });

  /* loans */
  $("#new-loan-btn").addEventListener("click", () => openLoanForm());
  $("#loan-form").addEventListener("submit", saveLoan);
  $("#loan-search").addEventListener("input", (e) => {
    state.loanSearch = e.target.value;
    renderLoans();
  });
  /* installment return schedule: amount + tick + months + first due date */
  ["loan-amount", "loan-inst-count", "loan-inst-first"].forEach(
    (id) => $("#" + id).addEventListener("input", syncLoanForm)
  );
  $("#loan-installment").addEventListener("change", syncLoanForm);

  /* expenses */
  $("#new-expense-btn").addEventListener("click", () => openExpenseForm());
  $("#expense-form").addEventListener("submit", saveExpense);
  $("#expense-search").addEventListener("input", (e) => {
    state.expSearch = e.target.value;
    renderExpenses();
  });

  /* purchases */
  $("#new-purchase-btn").addEventListener("click", () => openPurchaseForm());
  $("#purchase-form").addEventListener("submit", savePurchase);
  /* batch ↔ local keeps whatever was already written: picker lines join into
     one statement, and a statement comes back as the first item row */
  $$("#purchase-mode input").forEach((radio) =>
    radio.addEventListener("change", () => {
      if (radio.value === "local") {
        renderItems($("#purchase-statement").value.trim(), "purchase");
      } else {
        const items = itemValues("purchase");
        if (items.length) $("#purchase-statement").value = items.join(" · ");
      }
      syncPurchaseMode();
    })
  );
  $("#purchase-search").addEventListener("input", (e) => {
    state.purchaseSearch = e.target.value;
    renderPurchases();
  });
  /* payment (cash/bank) + installment schedule fields */
  ["purchase-amount", "purchase-cash", "purchase-bank", "purchase-inst-count", "purchase-inst-first"].forEach(
    (id) => $("#" + id).addEventListener("input", syncPurchaseForm)
  );
  $("#purchase-installment").addEventListener("change", syncPurchaseForm);

  /* zakat */
  $("#new-zakat-btn").addEventListener("click", () => openZakatForm());
  $("#zakat-form").addEventListener("submit", saveZakat);
  $("#zakat-search").addEventListener("input", (e) => {
    state.zakatSearch = e.target.value;
    renderZakat();
  });

  /* payables / payment forms */
  $("#new-payable-btn").addEventListener("click", () => openPayableForm());
  $("#payable-form").addEventListener("submit", savePayable);
  $("#payment-form").addEventListener("submit", savePayment);

  /* receivables search (list is already in memory — no refetch per keystroke) */
  $("#receivable-search").addEventListener("input", (e) => {
    state.recSearch = e.target.value;
    renderReceivables();
  });

  /* payables search */
  $("#payable-search").addEventListener("input", (e) => {
    state.paySearch = e.target.value;
    renderPayables();
  });

  /* ⚙ Filters panels on the other tabs — sales wires its own above */
  Object.keys(LIST_TABS).forEach((tab) => {
    const cfg = LIST_TABS[tab], p = cfg.prefix;
    /* ⚙ button shows/hides this tab's filter panel */
    $("#" + cfg.btn).addEventListener("click", () => {
      const panel = $("#" + cfg.panel);
      panel.hidden = !panel.hidden;
      $("#" + cfg.btn).setAttribute("aria-expanded", String(!panel.hidden));
    });
    /* one helper per filter field: write into that tab's filter object and re-render */
    const bind = (key, ev) =>
      $("#" + p + "-" + key).addEventListener(ev, (e) => {
        listF(tab)[key] = e.target.value;
        if (key === "from" || key === "to")
          $$("#" + p + "-quick .seg").forEach((b) => b.classList.toggle("active", b.dataset.range === "custom"));
        cfg.render();
      });
    /* dates react to both: picking fires "change", typing fires "input" */
    ["from", "to"].forEach((key) => ["change", "input"].forEach((ev) => bind(key, ev)));
    bind("min", "input");
    bind("max", "input");
    /* tab-specific extra filter (only some tabs have one) */
    if (cfg.extra)
      $("#" + p + "-extra").addEventListener("change", (e) => {
        listF(tab).extra = e.target.value;
        cfg.render();
      });
    /* quick-range buttons for this tab */
    $("#" + p + "-quick").addEventListener("click", (e) => {
      const b = e.target.closest(".seg");
      if (b) listQuickRange(tab, b.dataset.range);
    });
    /* ⚙ panel clear button for this tab */
    $("#" + cfg.clear).addEventListener("click", () => clearListFilters(tab));
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

/* ============ start ============ */

/* Everything is bound now — start the app. Must stay as the last line:
   main.js loads after every other file, so all the functions it calls exist. */
boot();
