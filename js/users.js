/* ============================================================
   users.js - admin sheet: people + their per-flow access
   -----------------------------------------------------------
   Two panes inside #modal-users: the list of everyone who can sign
   in, and the add/edit form where the admin picks, per flow (screen),
   whether the person gets No access / Read only / Add & edit, plus a
   separate "can delete" tick. Talks to the admin_* functions that
   supabase/schema.sql defines.
   PROVIDES: openUsers, loadUserList, renderUserList, showUserPane,
     showUserForm, buildFlowRows, readFlowPerms, syncFlowLock,
     saveUser, removeUser, friendlyError
   ============================================================ */

/* ============ users & access ============ */

/* Flow ids (core.js FLOW_LIST) → the labels used on the tabs. */
const FLOW_LABELS = {
  dashboard: "Dashboard",
  sales: "Sales",
  receivables: "To receive",
  payables: "To pay",
  loans: "Loans",
  expenses: "Expenses",
  purchases: "Purchases",
  zakat: "Zakat",
  cashin: "Cash in",
};

/* The rows currently in the list, so a tap can open one for editing. */
let userListRows = [];

/* Opens the sheet on the list pane and loads everyone. */
async function openUsers() {
  showUserPane("list");
  openModal("modal-users");
  await loadUserList();
}

/* Fetches users + logins (admin_list_users) and draws the list. */
async function loadUserList() {
  busy(true);
  try {
    const { data, error } = await sb.rpc("admin_list_users");
    if (error) throw error;
    userListRows = data || [];
    renderUserList();
  } catch (e) {
    toast(friendlyError(e), true);
  } finally {
    busy(false);
  }
}

/* Draws one tappable row per person: name, email and a badge showing
   either "Admin" or the flows they were granted (red "No access" = none). */
function renderUserList() {
  $("#user-list").innerHTML = userListRows.length
    ? userListRows.map((u) => {
        const flows = Object.entries(u.perms?.flows || {})
          .filter(([, p]) => p && p.access && p.access !== "none")
          .map(([f]) => FLOW_LABELS[f] || f);
        const badges =
          (u.is_admin ? '<span class="badge badge-paid">Admin</span>' : "") +
          (flows.length
            ? `<span class="badge badge-pending">${esc(flows.join(", "))}</span>`
            : u.is_admin
              ? ""
              : '<span class="badge badge-overdue">No access</span>');
        return `<div class="row user-row" data-id="${u.id}" role="button" tabindex="0">
          <div class="row-main">
            <div class="row-title">${esc(u.name || u.email)}${badges}</div>
            <div class="row-sub">${u.name ? esc(u.email) : "Not granted yet"}</div>
          </div>
          <div class="row-right"><div class="row-bal" style="color:var(--muted)">Edit ›</div></div>
        </div>`;
      }).join("")
    : '<p class="hint">Nobody here yet — add the first user.</p>';

  /* tapping a row opens it in the edit form */
  $$("#user-list .user-row").forEach((el) =>
    el.addEventListener("click", () => {
      const row = userListRows.find((u) => u.id === el.dataset.id);
      if (row) showUserForm(row);
    })
  );
}

/* Flips between the two panes of the sheet ("list" | "form"). */
function showUserPane(pane) {
  $("#users-list-pane").hidden = pane !== "list";
  $("#user-form").hidden = pane !== "form";
}

/* Fills the form for a NEW person (row = null) or an EXISTING one.
   Email and password are Supabase's business: while editing, the email is
   read-only and the password box disappears (reset it in the dashboard). */
function showUserForm(row) {
  const isEdit = !!row;
  $("#u-id").value = isEdit ? row.id : "";
  $("#u-email").value = isEdit ? row.email : "";
  $("#u-email").readOnly = isEdit;
  $("#u-password").value = "";
  $("#u-password").closest(".field").hidden = isEdit;
  $("#u-password-hint").hidden = isEdit;
  $("#u-name").value = isEdit ? row.name || "" : "";
  $("#u-admin").checked = !!(isEdit && row.is_admin);
  buildFlowRows(isEdit ? row.perms : null);
  $("#user-form-error").hidden = true;
  /* you can never delete yourself out of the app */
  $("#u-remove-btn").hidden = !isEdit || row.id === user?.id;
  showUserPane("form");
  $("#u-email").focus();
}

/* Builds one row per flow: label + access select (+ delete tick, which
   dashboard never gets — there is nothing to delete there).
   perms comes from the edited user, or null for a fresh person. */
function buildFlowRows(perms) {
  $("#u-flows").innerHTML = FLOW_LIST.map((flow) => {
    const p = perms?.flows?.[flow] || {};
    const access = p.access || "none";
    const del = flow === "dashboard" ? "" :
      `<label class="flow-del"><input type="checkbox" ${p.delete ? "checked" : ""} />
         <span>Delete</span></label>`;
    return `<div class="flow-row" data-flow="${flow}">
      <span class="flow-name">${FLOW_LABELS[flow] || flow}</span>
      <select class="flow-access" aria-label="${FLOW_LABELS[flow] || flow} access">
        <option value="none" ${access === "none" ? "selected" : ""}>No access</option>
        <option value="read" ${access === "read" ? "selected" : ""}>Read only</option>
        <option value="write" ${access === "write" ? "selected" : ""}>Add &amp; edit</option>
      </select>
      ${del}
    </div>`;
  }).join("");
  syncFlowLock();   /* an admin sees everything, so their flow rows grey out */
}

/* Reads the flow rows back into the JSON shape schema.sql stores:
   { flows: { <flow>: { access, delete } } } */
function readFlowPerms() {
  const flows = {};
  $$("#u-flows .flow-row").forEach((row) => {
    flows[row.dataset.flow] = {
      access: $(".flow-access", row).value,
      delete: !!$(".flow-del input", row)?.checked,
    };
  });
  return { flows };
}

/* Admins bypass every flow check, so their permission rows are greyed out
   while the box is ticked (the values are still saved for later). */
function syncFlowLock() {
  const off = $("#u-admin").checked;
  $$("#u-flows .flow-access, #u-flows .flow-del input").forEach((el) => (el.disabled = off));
}

/* Turns scary database messages into instructions a human can act on. */
function friendlyError(e) {
  const m = e?.message || String(e);
  if (/app_users|admin_(add|grant|delete|list)_user/.test(m))
    return "Needs the new schema.sql — run it in the Supabase SQL Editor, then try again.";
  return m;
}

/* Shows a message under the form fields instead of a floating toast. */
function showFormError(msg) {
  const el = $("#user-form-error");
  el.textContent = msg;
  el.hidden = false;
}

/* Save button: creates a person (with password, or granting an existing
   login when the password box is left blank) or updates an existing one. */
async function saveUser(e) {
  e.preventDefault();
  $("#user-form-error").hidden = true;

  const id = $("#u-id").value;
  const email = $("#u-email").value.trim().toLowerCase();
  const password = $("#u-password").value;
  const name = $("#u-name").value.trim() || null;
  const isAdmin = $("#u-admin").checked;
  const perms = readFlowPerms();

  /* never let the signed-in admin demote themselves — nobody would be
     left to manage users afterwards */
  if (id && !isAdmin && id === user?.id)
    return showFormError("You can't remove your own admin access — ask another admin to do it.");

  busy(true);
  try {
    if (!id) {
      /* NEW person. Blank password = the login already exists (made in the
         Supabase dashboard), so only grant access; otherwise create the
         login and the access in one go. */
      const { data, error } = password
        ? await sb.rpc("admin_add_user", {
            p_email: email, p_password: password, p_name: name, p_perms: perms,
          })
        : await sb.rpc("admin_grant_user", {
            p_email: email, p_name: name, p_perms: perms,
          });
      if (error) throw error;
      if (isAdmin) {
        /* the admin tick is a follow-up update — the RPCs always start
           people as regular users (unless they are the very first account) */
        const { error: e2 } = await sb
          .from("app_users").update({ is_admin: true }).eq("id", data.id);
        if (e2) throw e2;
      }
      toast("User added");
    } else {
      /* EXISTING person: only name / permissions / admin flag change here */
      const { error } = await sb
        .from("app_users")
        .update({ name, perms, is_admin: isAdmin })
        .eq("id", id);
      if (error) throw error;
      toast("Saved");
      /* editing my own row? reload my permissions so the UI matches —
         only jump screens if my current one just became forbidden
         (switchView closes every sheet, so avoid it otherwise) */
      if (id === user?.id) {
        await loadMe();
        applyAccess();
        if (!can(state.view, "read")) switchView(state.view, true);
      }
    }
    showUserPane("list");
    await loadUserList();
  } catch (err) {
    showFormError(friendlyError(err));
  } finally {
    busy(false);
  }
}

/* Remove button: confirm, then delete the person AND their login. */
function removeUser() {
  const id = $("#u-id").value;
  const row = userListRows.find((u) => u.id === id);
  if (!row) return;
  askConfirm(
    "Remove user?",
    `${row.name || row.email} will no longer be able to sign in. Their data stays.`,
    async () => {
      /* The confirm dialog closes every sheet and pops the history entry a
         moment later — start waiting for that BEFORE the await below, so the
         sheet we reopen isn't immediately closed again by the late popstate. */
      const settled = new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          window.removeEventListener("popstate", finish);
          resolve();
        };
        window.addEventListener("popstate", finish);
        setTimeout(finish, 150);   /* safety net when no popstate is coming */
      });
      busy(true);
      let err = null;
      try {
        const { error } = await sb.rpc("admin_delete_user", { p_id: id });
        if (error) throw error;
      } catch (e) {
        err = e;
      }
      busy(false);
      await settled;
      openModal("modal-users");   /* back into the sheet on the list pane */
      showUserPane("list");
      if (err) toast(friendlyError(err), true);
      else {
        toast("User removed");
        await loadUserList();
      }
    }
  );
}
