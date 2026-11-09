/* ============================================================
   auth.js - login screen and session
   -----------------------------------------------------------
   Decides whether you see the login screen or the app,
   and starts the whole app with boot().
   Also loads the signed-in user's permissions (app_users) so the
   UI only shows the flows they were granted.
   PROVIDES: user, boot, handleSession, loadMe, login
   ============================================================ */

/* ============ auth ============ */
let user = null;

// Start the app: wire the UI, restore any saved session, then react to future logins/logouts.
async function boot() {
  bindEvents();   // hook up every button, form and search box first
  // Is there a session saved from the last visit?
  const { data } = await sb.auth.getSession();
  handleSession(data.session);
  // Supabase fires this on every login/logout, so the screen stays in sync.
  sb.auth.onAuthStateChange((_e, s) => handleSession(s));
}

/* Reads this user's row from app_users into state.me (see core.js for the
   shape). Two special cases:
   - no row → the account exists but has not been granted anything yet;
   - query fails (schema.sql not re-run yet) → fall back to full access so
     an old single-user deployment keeps working exactly as before. */
async function loadMe() {
  try {
    const { data, error } = await sb
      .from("app_users")
      .select("is_admin, perms")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      state.me = { is_admin: !!data.is_admin, perms: data.perms || { flows: {} } };
    } else {
      state.me = { is_admin: false, perms: { flows: {} } };
      toast("This account has no access yet — ask the admin to grant it.");
    }
  } catch {
    state.me = { full: true, is_admin: true };   // pre-multi-user database
    toast("Permissions not active yet — run the new schema.sql in Supabase.", true);
  }
}

// Logged in → show the app shell, load their permissions, then draw a screen
// they are allowed to see; logged out → show the login screen.
async function handleSession(s) {
  user = s?.user || null;
  if (user) {
    $("#login-screen").hidden = true;
    $("#app").hidden = false;
    $("#header-user").textContent = user.email || "";
    await loadMe();          // know what they may see BEFORE showing anything
    applyAccess();           // hide forbidden tabs / toolbar buttons
    switchView(state.view, true);   // lands on an allowed screen (see navigation.js)
    loadSalesmen().catch((e) =>
      toast("Salesmen list unavailable — run the new schema.sql in Supabase.", true)
    );
  } else {
    state.me = null;         // next login starts with fresh permissions
    state.view = "dashboard";
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
