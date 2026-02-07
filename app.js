import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cfg = window.HOTWILLS_CONFIG || {};
const refs = {
  configNotice: document.getElementById("configNotice"),
  authCard: document.getElementById("authCard"),
  appCard: document.getElementById("appCard"),
  status: document.getElementById("status"),
  authForm: document.getElementById("authForm"),
  signUpBtn: document.getElementById("signUpBtn"),
  googleSignInBtn: document.getElementById("googleSignInBtn"),
  signOutBtn: document.getElementById("signOutBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  searchInput: document.getElementById("searchInput"),
  modelsBody: document.getElementById("modelsBody"),
  createForm: document.getElementById("createForm")
};

const imageBucket = cfg.imageBucket || "model-images";
let supabase = null;
let authListener = null;
let realtimeChannel = null;
let currentUser = null;
let models = [];

function setStatus(message, isError = false) {
  refs.status.textContent = message || "";
  refs.status.style.color = isError ? "#f6a8aa" : "";
}

function isConfigured() {
  return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function oauthRedirectTo() {
  return `${window.location.origin}${window.location.pathname}`;
}

function readOAuthErrorFromUrl() {
  const query = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#")
    ? new URLSearchParams(window.location.hash.slice(1))
    : new URLSearchParams();

  const errorDescription =
    query.get("error_description") ||
    hash.get("error_description") ||
    query.get("error") ||
    hash.get("error");

  return errorDescription ? decodeURIComponent(errorDescription.replace(/\+/g, " ")) : "";
}

async function configureOAuthButtons() {
  try {
    const response = await fetch(`${cfg.supabaseUrl}/auth/v1/settings`, {
      headers: {
        apikey: cfg.supabaseAnonKey
      }
    });
    if (!response.ok) return;

    const settings = await response.json();
    const googleEnabled = Boolean(settings?.external?.google);
    refs.googleSignInBtn.disabled = !googleEnabled;

    if (!googleEnabled) {
      refs.googleSignInBtn.title = "Google provider is disabled in Supabase";
      setStatus("Google OAuth is disabled in Supabase. Enable it in Auth Providers.", true);
    } else {
      refs.googleSignInBtn.title = "";
    }
  } catch (_) {
    // Keep UI functional even if settings endpoint is unavailable.
  }
}

function publicImageUrl(path) {
  if (!path) return "";
  return supabase.storage.from(imageBucket).getPublicUrl(path).data.publicUrl;
}

async function fetchModels() {
  const { data, error } = await supabase
    .from("models")
    .select("id,name,year,code,image_file,source_link,created_by,updated_at")
    .order("code", { ascending: true });

  if (error) {
    setStatus(`Load error: ${error.message}`, true);
    return;
  }

  models = data || [];
  renderModels();
}

function getFilteredModels() {
  const q = (refs.searchInput.value || "").trim().toLowerCase();
  if (!q) return models;
  return models.filter((item) => {
    return (
      (item.name || "").toLowerCase().includes(q) ||
      (item.code || "").toLowerCase().includes(q) ||
      (item.year || "").toLowerCase().includes(q)
    );
  });
}

function renderModels() {
  const rows = getFilteredModels();
  refs.modelsBody.innerHTML = "";

  if (rows.length === 0) {
    refs.modelsBody.innerHTML = '<tr><td colspan="8" class="mini">No models found</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const model of rows) {
    const tr = document.createElement("tr");
    tr.dataset.id = model.id;

    tr.innerHTML = `
      <td>
        <img class="preview" src="${escapeHtml(publicImageUrl(model.image_file))}" alt="${escapeHtml(model.name)}" />
      </td>
      <td><input data-field="name" type="text" value="${escapeHtml(model.name)}" /></td>
      <td><input data-field="year" type="text" value="${escapeHtml(model.year)}" /></td>
      <td><input data-field="code" type="text" value="${escapeHtml(model.code)}" /></td>
      <td><input data-field="image_file" type="text" value="${escapeHtml(model.image_file)}" /></td>
      <td><input data-field="source_link" type="url" value="${escapeHtml(model.source_link || "")}" /></td>
      <td><span class="mini">${escapeHtml(model.created_by || "system")}</span></td>
      <td>
        <div class="actions">
          <button type="button" data-action="save" class="muted">Save</button>
          <button type="button" data-action="delete" class="danger">Delete</button>
        </div>
      </td>
    `;

    fragment.appendChild(tr);
  }

  refs.modelsBody.appendChild(fragment);
}

async function saveRow(rowEl) {
  const id = rowEl.dataset.id;
  const payload = {};
  rowEl.querySelectorAll("input[data-field]").forEach((input) => {
    payload[input.dataset.field] = input.value.trim();
  });

  if (!payload.name || !payload.year || !payload.code || !payload.image_file) {
    setStatus("name/year/code/image_file are required", true);
    return;
  }

  const { error } = await supabase
    .from("models")
    .update(payload)
    .eq("id", id);

  if (error) {
    setStatus(`Save failed: ${error.message}`, true);
    return;
  }

  setStatus("Saved");
}

async function deleteRow(rowEl) {
  const id = rowEl.dataset.id;
  const ok = window.confirm("Delete this model?");
  if (!ok) return;

  const { error } = await supabase
    .from("models")
    .delete()
    .eq("id", id);

  if (error) {
    setStatus(`Delete failed: ${error.message}`, true);
    return;
  }

  setStatus("Deleted");
}

async function handleCreate(event) {
  event.preventDefault();

  if (!currentUser) {
    setStatus("You must sign in", true);
    return;
  }

  const name = document.getElementById("newName").value.trim();
  const year = document.getElementById("newYear").value.trim();
  const code = document.getElementById("newCode").value.trim();
  const sourceLink = document.getElementById("newLink").value.trim();
  const existingImageFile = document.getElementById("newImageFile").value.trim();
  const imageFileInput = document.getElementById("newImage");

  if (!name || !year || !code) {
    setStatus("name/year/code are required", true);
    return;
  }

  let imageFile = existingImageFile;
  const file = imageFileInput.files?.[0] || null;

  if (file) {
    const path = `${currentUser.id}/${Date.now()}_${sanitizeFilename(file.name)}`;
    const upload = await supabase.storage
      .from(imageBucket)
      .upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" });

    if (upload.error) {
      setStatus(`Image upload failed: ${upload.error.message}`, true);
      return;
    }

    imageFile = path;
  }

  if (!imageFile) {
    setStatus("Provide existing image path or upload an image", true);
    return;
  }

  const insertPayload = {
    name,
    year,
    code,
    image_file: imageFile,
    source_link: sourceLink || null,
    created_by: currentUser.id
  };

  const { error } = await supabase.from("models").insert(insertPayload);

  if (error) {
    setStatus(`Create failed: ${error.message}`, true);
    return;
  }

  refs.createForm.reset();
  setStatus("Created");
}

function bindTableActions() {
  refs.modelsBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const row = button.closest("tr[data-id]");
    if (!row) return;

    const action = button.dataset.action;
    if (action === "save") await saveRow(row);
    if (action === "delete") await deleteRow(row);
  });
}

function unsubscribeRealtime() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

function subscribeRealtime() {
  unsubscribeRealtime();

  realtimeChannel = supabase
    .channel("models-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "models" }, () => {
      fetchModels();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setStatus("Realtime connected");
    });
}

async function setUiBySession(user) {
  currentUser = user || null;
  const authed = Boolean(currentUser);
  refs.authCard.classList.toggle("hidden", authed);
  refs.appCard.classList.toggle("hidden", !authed);

  if (authed) {
    await fetchModels();
    subscribeRealtime();
  } else {
    models = [];
    unsubscribeRealtime();
    renderModels();
  }
}

async function initAuthState() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    setStatus(`Session error: ${error.message}`, true);
    return;
  }

  await setUiBySession(data.session?.user || null);

  authListener = supabase.auth.onAuthStateChange(async (_event, session) => {
    await setUiBySession(session?.user || null);
  });
}

function bindAuthActions() {
  refs.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("emailInput").value.trim();
    const password = document.getElementById("passwordInput").value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus(`Sign in failed: ${error.message}`, true);
      return;
    }

    setStatus("Signed in");
  });

  refs.signUpBtn.addEventListener("click", async () => {
    const email = document.getElementById("emailInput").value.trim();
    const password = document.getElementById("passwordInput").value;

    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setStatus(`Sign up failed: ${error.message}`, true);
      return;
    }

    setStatus("Sign up successful. Check your email if confirmation is enabled.");
  });

  refs.googleSignInBtn.addEventListener("click", async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: oauthRedirectTo()
      }
    });

    if (error) {
      setStatus(`Google sign-in failed: ${error.message}`, true);
      return;
    }
  });

  refs.signOutBtn.addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setStatus(`Sign out failed: ${error.message}`, true);
      return;
    }
    setStatus("Signed out");
  });
}

function bindAppActions() {
  refs.searchInput.addEventListener("input", renderModels);
  refs.refreshBtn.addEventListener("click", fetchModels);
  refs.createForm.addEventListener("submit", handleCreate);
  bindTableActions();
}

async function main() {
  if (!isConfigured()) {
    refs.configNotice.classList.remove("hidden");
    refs.authCard.classList.add("hidden");
    refs.appCard.classList.add("hidden");
    setStatus("Set Supabase config in config.js", true);
    return;
  }

  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  await configureOAuthButtons();

  const oauthError = readOAuthErrorFromUrl();
  if (oauthError) {
    setStatus(`OAuth error: ${oauthError}`, true);
  }

  bindAuthActions();
  bindAppActions();
  await initAuthState();
}

window.addEventListener("beforeunload", () => {
  unsubscribeRealtime();
  if (authListener?.data?.subscription) {
    authListener.data.subscription.unsubscribe();
  }
});

main().catch((err) => {
  setStatus(`Fatal error: ${err.message}`, true);
});
