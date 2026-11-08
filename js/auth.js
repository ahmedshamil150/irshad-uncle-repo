/* ============================================================
   auth.js - login screen and session
   -----------------------------------------------------------
   Decides whether you see the login screen or the app,
   and starts the whole app with boot().
   PROVIDES: user, boot, handleSession, login
   ============================================================ */

/* ============ auth ============ */
let user = null;

async function boot() {
  bindEvents();
  const { data } = await sb.auth.getSession();
  handleSession(data.session);
  sb.auth.onAuthStateChange((_e, s) => handleSession(s));
}

function handleSession(s) {
  user = s?.user || null;
  if (user) {
    $("#login-screen").hidden = true;
    $("#app").hidden = false;
    $("#header-user").textContent = user.email || "";
    switchView(state.view, true);
    loadSalesmen().catch((e) =>
      toast("Salesmen list unavailable — run the new schema.sql in Supabase.", true)
    );
  } else {
    $("#app").hidden = true;
    $("#login-screen").hidden = false;
    $("#login-password").value = "";
  }
}

async function login(e) {
  e.preventDefault();
  const errEl = $("#login-error");
  errEl.hidden = true;
  $("#login-btn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $("#login-email").value.trim(),
    password: $("#login-password").value,
  });
  $("#login-btn").disabled = false;
  if (error) {
    errEl.textContent =
      error.message === "Invalid login credentials"
        ? "Invalid email or password."
        : error.message;
    errEl.hidden = false;
  }
}
