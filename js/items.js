/* ============================================================
   items.js - the item picker shared by the Sale and Purchase forms
   -----------------------------------------------------------
   One line per machine/item: the machine dropdown, printer/probe tick-boxes
   and free-form lines all feed this same code - each form just points at
   its own elements through PICKERS.
   PROVIDES: PICKERS, itemRow, renderItems, itemValues, addNewItem, removeItemRow,
     syncItemChecks
   ============================================================ */

/* ---- item lines (one per machine/item) ---- */
/* The sale form and the purchase form share one picker procedure;
   each form just points at its own elements. */
const PICKERS = {
  sale:     { list: "#sale-items",         checks: "#item-checks",          machine: "#machine-picker",          add: "#add-item-btn" },
  purchase: { list: "#purchase-items",     checks: "#purchase-item-checks", machine: "#purchase-machine-picker", add: "#add-purchase-item-btn" },
};

function itemRow(value = "") {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML =
    '<input type="text" class="item-input" placeholder="e.g. Ultrasound machine XYZ" />' +
    '<button type="button" class="item-del" title="Remove item" aria-label="Remove item">✕</button>';
  row.querySelector("input").value = value;
  return row;
}
function renderItems(stored, scope = "sale") {
  const box = $(PICKERS[scope].list);
  box.innerHTML = "";
  const list = String(stored || "").split("\n").map((x) => x.trim()).filter(Boolean);
  (list.length ? list : [""]).forEach((v) => box.appendChild(itemRow(v)));
  syncItemChecks(scope);
}
const itemValues = (scope = "sale") =>
  $$(PICKERS[scope].list + " .item-input").map((i) => i.value.trim()).filter(Boolean);

/* ---- machine dropdown + printer/probe checkboxes ---- */
/* A picked machine or ticked box becomes one line in the item list;
   unticking removes that exact line, and lines typed by hand tick the boxes back. */
function addNewItem(value, scope = "sale") {
  const v = String(value || "").trim();
  if (!v) return;
  const empty = $$(PICKERS[scope].list + " .item-input").find((i) => !i.value.trim());
  if (empty) empty.value = v;
  else $(PICKERS[scope].list).appendChild(itemRow(v));
}
function removeItemRow(value, scope = "sale") {
  const want = String(value || "").trim().toLowerCase();
  const hit = $$(PICKERS[scope].list + " .item-input").find((i) => i.value.trim().toLowerCase() === want);
  if (hit) hit.closest(".item-row").remove();
}
function syncItemChecks(scope = "sale") {
  const have = itemValues(scope).map((v) => v.toLowerCase());
  $$(PICKERS[scope].checks + " input").forEach((cb) => { cb.checked = have.includes(cb.value.toLowerCase()); });
}
