/* ============================================================
   core.js - foundation: database client + small helpers
   -----------------------------------------------------------
   Loads first; every other file may use what is defined here.
   Read this file first when you want to know what a helper does.
   PROVIDES: sb (Supabase client), $ / $$ (DOM lookup), esc, num, round2, money,
     fmtDate, date helpers, parseAmount ("5l" / "50k" / "2million"),
     oneLine, itemsText, toast, busy, openModal, closeModals, askConfirm,
     FLOW_LIST, can, canDelete, canAny (per-user access checks)
   ============================================================ */

/* ============ client & helpers ============ */
// Fail fast with a readable page when config.js was never loaded.
if (!window.ENV?.SUPABASE_URL || !window.ENV?.SUPABASE_ANON_KEY) {
  document.body.innerHTML =
    '<div style="padding:30px;font-family:sans-serif;max-width:640px;margin:auto">' +
    "<h2>Configuration missing</h2><p><code>config.js</code> was not loaded. " +
    "Run <code>npm start</code> (or <code>npm run build</code>) and open the <code>dist/</code> folder — " +
    "do not serve the project root directly.</p></div>";
  throw new Error("config.js missing");
}
// Fail fast too if the bundled Supabase library is missing or blocked.
if (!window.supabase?.createClient) {
  document.body.innerHTML =
    '<div style="padding:30px;font-family:sans-serif;max-width:640px;margin:auto">' +
    "<h2>Library failed to load</h2><p><code>vendor/supabase.js</code> is missing or blocked.</p></div>";
  throw new Error("supabase lib missing");
}

const sb = window.supabase.createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) =>
  "Rs " + new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(Math.round(num(n)));
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
/* office / dealer / salesman → Office / Dealer / Salesman */
const srcName = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

/* ---------- friendly money entry: "5l", "50k", "2million", "5,00,000" → number ---------- */
const AMOUNT_UNITS = {
  million: 1e6, m: 1e6,   /* 1 million = 10 lac */
  l: 1e5,         /* lac */
  k: 1e3,         /* thousand */
};
/* Returns a number, or NaN when the text cannot be read as an amount. */
function parseAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? "").toLowerCase();
  if (!s.trim()) return 0;
  s = s.replace(/₨|pkr|rupees/g, "").replace(/\brs\b/g, "").replace(/[,']/g, "");
  let rest = s, total = 0, found = false;
  const re = /(\d+(?:\.\d+)?|\.\d+)\s*([a-z]+)?/g;
  let m;
  while ((m = re.exec(s))) {
    let mult = 1;
    if (m[2]) {
      const unit = m[2].replace(/s$/, "");   /* millions → million */
      if (!(unit in AMOUNT_UNITS)) return NaN;
      mult = AMOUNT_UNITS[unit];
    }
    total += parseFloat(m[1]) * mult;
    found = true;
    rest = rest.replace(m[0], " ");
  }
  if (!found || rest.replace(/[\s.]+/g, "")) return NaN;
  return round2(total);
}
/* Safe read for live previews (garbage shows as 0, save-time validation catches it). */
const amt = (v) => { const n = parseAmount(v); return Number.isNaN(n) ? 0 : n; };
const AMOUNT_HINT = "Couldn't read that amount — try 500000, 5l, 50k or 2million.";

/* several item lines are stored as one newline-separated text column */
const itemsText = (s) =>
  String(s || "").split("\n").map((x) => x.trim()).filter(Boolean).join(" · ");
const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => isoOf(new Date());
const monthStartISO = () => { const d = new Date(); return isoOf(new Date(d.getFullYear(), d.getMonth(), 1)); };
const yearStartISO = () => { const d = new Date(); return isoOf(new Date(d.getFullYear(), 0, 1)); };
const addMonths = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(y, m - 1 + n, 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return isoOf(new Date(base.getFullYear(), base.getMonth(), Math.min(d, last)));
};

let toastTimer;
function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", isErr);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}
const busy = (on) => ($("#busy").hidden = !on);

/* A phone's Back button closes the open sheet instead of leaving the app. */
let modalBackArmed = false;

function openModal(id) {
  closeModals(true);
  const el = $("#" + id);
  el.hidden = false;
  document.body.style.overflow = "hidden";
  const body = el.querySelector(".modal-body");
  if (body) body.scrollTop = 0;              /* reopened sheets start at the top */
  if (!modalBackArmed) {
    modalBackArmed = true;
    history.pushState({ modal: id }, "");
  }
}
function closeModals(keepLock = false) {
  $$(".modal").forEach((m) => (m.hidden = true));
  if (!keepLock) {
    document.body.style.overflow = "";
    if (modalBackArmed) {
      modalBackArmed = false;
      history.back();
    }
  }
}
window.addEventListener("popstate", () => {
  modalBackArmed = false;
  closeModals();   /* modalBackArmed is already false, so no history.back() loop —
                      this path restores body scrolling too */
});

/* closing payment modal returns you to the sale/loan detail it was opened from */
function dismissModals() {
  const open = $$(".modal").find((m) => !m.hidden);
  closeModals();
  if (open?.id === "modal-payment" && state.returnTo === "modal-sale-detail" && state.returnSaleId) {
    openSaleDetail(state.returnSaleId).catch(() => {});
  }
  if (open?.id === "modal-payment" && state.returnTo === "modal-loan-detail" && state.returnLoanId) {
    openLoanDetail(state.returnLoanId).catch(() => {});
  }
}

/* confirm dialog */
let confirmCb = null;
function askConfirm(title, text, cb) {
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  confirmCb = cb;
  openModal("modal-confirm");
}


/* item lines are stored newline-joined in title — one line per item, like a sale */
const oneLine = (s) => String(s || "").replace(/\s*\n\s*/g, " · ");

/* ============ per-flow permissions (what THIS user may see and do) ============
   The admin hands out access per flow (screen) from the Users modal; auth.js
   loads the result into state.me right after login:

     state.me = { is_admin, perms: { flows: { <flow>: { access, delete } } } }
       access : "none" (tab hidden) | "read" (look/search) | "write" (add+edit)
       delete : true = may remove entries in that flow

   A missing flow counts as "none". An admin — or the pre-multi-user fallback
   { full: true } used when schema.sql hasn't been re-run — can do everything. */

/* Every grantable screen, in the order the app shows them. The Users modal
   builds its permission rows from this list (dashboard has no rows to delete,
   so it never gets a "delete" tick). */
const FLOW_LIST = ["dashboard", "sales", "receivables", "payables", "loans",
                   "expenses", "purchases", "zakat"];

/* May this user do `need` ("read" or "write") on `flow`?
   "read" is satisfied by read OR write access; "write" needs write access. */
function can(flow, need) {
  if (!state.me) return false;                       /* not loaded yet → deny */
  if (state.me.full || state.me.is_admin) return true; /* admin / legacy single user */
  const access = state.me.perms?.flows?.[flow]?.access || "none";
  return need === "write" ? access === "write"
                          : access === "read" || access === "write";
}

/* May this user remove entries in `flow`? Needs the flow's "delete" tick on
   top of at least read access (mirrors the `delete` policies in schema.sql).
   Admins (and the legacy full-access fallback) can delete everything. */
function canDelete(flow) {
  if (!can(flow, "read")) return false;
  if (state.me.full || state.me.is_admin) return true;
  return !!state.me.perms?.flows?.[flow]?.delete;
}

/* True when ANY of the listed flows allows `need` — for shared actions such
   as recording a payment, which several screens are allowed to write. */
function canAny(flows, need) {
  return flows.some((f) => can(f, need));
}
