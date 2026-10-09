/* Vaylo Sports — waiting-list dashboard.
 *
 * Standalone page on its own Netlify site. It is NOT a public page: the
 * database denies anonymous reads outright (RLS on public.waitlist_signups has
 * no anon/authenticated grant), so the only way any row appears here is a
 * signed-in session that public.has_role(uid,'admin') returns true for. The
 * client-side check below decides what to DRAW; the database is what actually
 * authorises the read.
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://vvwhausdjzdmsyxekrcl.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_-4WhrnnT9m8gzQ4nUzPQkg_SE_kevgg";

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  var $ = function (id) { return document.getElementById(id); };
  var views = {
    loading: $("view-loading"),
    login: $("view-login"),
    denied: $("view-denied"),
    dash: $("view-dash"),
  };

  var state = { rows: [], showRemoved: false, query: "", user: null };

  function show(name) {
    Object.keys(views).forEach(function (k) {
      views[k].classList.toggle("hidden", k !== name);
    });
  }

  function toast(message) {
    var el = $("toast");
    el.textContent = message;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add("hidden"); }, 2600);
  }

  function activeRows() {
    return state.rows.filter(function (r) { return !r.unsubscribed_at; });
  }

  function visibleRows() {
    var base = state.showRemoved ? state.rows : activeRows();
    var q = state.query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(function (r) {
      return (
        (r.email || "").toLowerCase().indexOf(q) !== -1 ||
        (r.display_name || "").toLowerCase().indexOf(q) !== -1 ||
        (r.source || "").toLowerCase().indexOf(q) !== -1
      );
    });
  }

  function fmtDate(value) {
    if (!value) return "—";
    var d = new Date(value);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function render() {
    var rows = visibleRows();
    var body = $("rows");
    body.textContent = "";

    rows.forEach(function (r) {
      var tr = document.createElement("tr");

      var tdEmail = document.createElement("td");
      tdEmail.className = "email";
      tdEmail.textContent = r.email;

      var tdName = document.createElement("td");
      tdName.textContent = r.display_name || "—";

      var tdSource = document.createElement("td");
      var tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = r.source || "—";
      tdSource.appendChild(tag);

      var tdDate = document.createElement("td");
      tdDate.textContent = fmtDate(r.created_at);

      var tdStatus = document.createElement("td");
      var pill = document.createElement("span");
      pill.className = "pill" + (r.unsubscribed_at ? " off" : "");
      pill.textContent = r.unsubscribed_at ? "Removed" : "On list";
      tdStatus.appendChild(pill);

      var tdAction = document.createElement("td");
      var btn = document.createElement("button");
      btn.textContent = r.unsubscribed_at ? "Restore" : "Remove";
      btn.addEventListener("click", function () { setRemoved(r, !r.unsubscribed_at); });
      tdAction.appendChild(btn);

      tr.appendChild(tdEmail);
      tr.appendChild(tdName);
      tr.appendChild(tdSource);
      tr.appendChild(tdDate);
      tr.appendChild(tdStatus);
      tr.appendChild(tdAction);
      body.appendChild(tr);
    });

    $("empty").classList.toggle("hidden", rows.length > 0);
    var removedCount = state.rows.length - activeRows().length;
    $("count").textContent =
      activeRows().length + " on the list" + (removedCount ? " · " + removedCount + " removed" : "");
    $("removed-btn").textContent = state.showRemoved
      ? "Hide removed"
      : "Show removed (" + removedCount + ")";
    $("removed-btn").setAttribute("aria-pressed", String(state.showRemoved));
  }

  async function load() {
    var res = await sb
      .from("waitlist_signups")
      .select("id, email, display_name, source, created_at, unsubscribed_at")
      .order("created_at", { ascending: false });
    if (res.error) {
      toast("Could not load the list.");
      state.rows = [];
    } else {
      state.rows = res.data || [];
    }
    render();
  }

  async function setRemoved(row, removed) {
    var value = removed ? new Date().toISOString() : null;
    var res = await sb.from("waitlist_signups").update({ unsubscribed_at: value }).eq("id", row.id);
    if (res.error) { toast("Could not update that address."); return; }
    row.unsubscribed_at = value;
    render();
  }

  function addresses() {
    return activeRows().map(function (r) { return r.email; });
  }

  async function copyAll() {
    var list = addresses();
    if (!list.length) return;
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      toast("Copied " + list.length + " address" + (list.length === 1 ? "" : "es") + ".");
    } catch (e) {
      toast("The clipboard is not available here.");
    }
  }

  function downloadCsv() {
    var list = addresses();
    if (!list.length) return;
    var lines = ["email"].concat(list.map(function (e) { return '"' + e.replace(/"/g, '""') + '"'; }));
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vaylo-waitlist-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  async function enter(user) {
    state.user = user;
    var res = await sb.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (res.error || res.data !== true) {
      show("denied");
      return;
    }
    show("dash");
    await load();
  }

  async function signOut() {
    await sb.auth.signOut();
    state.user = null;
    state.rows = [];
    show("login");
  }

  // --- wiring ---------------------------------------------------------------
  $("login-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var err = $("login-err");
    var btn = $("login-btn");
    err.textContent = "";
    btn.disabled = true;
    btn.textContent = "Signing in…";
    var res = await sb.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value,
    });
    btn.disabled = false;
    btn.textContent = "Sign in";
    if (res.error) {
      err.textContent = "Sign-in failed. Check the address and password.";
      return;
    }
    $("password").value = "";
    await enter(res.data.user);
  });

  $("signout-btn").addEventListener("click", signOut);
  $("signout-btn2").addEventListener("click", signOut);
  $("search").addEventListener("input", function (e) { state.query = e.target.value; render(); });
  $("copy-btn").addEventListener("click", copyAll);
  $("csv-btn").addEventListener("click", downloadCsv);
  $("removed-btn").addEventListener("click", function () {
    state.showRemoved = !state.showRemoved;
    render();
  });

  sb.auth.getSession().then(function (res) {
    var session = res.data && res.data.session;
    if (session && session.user) enter(session.user);
    else show("login");
  });
})();
