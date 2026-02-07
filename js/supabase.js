'use strict';

const CLOUD = {
  TABLE: 'models',
  IMAGE_BUCKET: (window.HOTWILLS_CONFIG && window.HOTWILLS_CONFIG.imageBucket) || 'model-images'
};

let cloudClient = null;
let cloudUser = null;
let cloudAuthSub = null;
let cloudRealtime = null;
let cloudOnDataChange = null;

function isCloudConfigured() {
  const cfg = window.HOTWILLS_CONFIG || {};
  return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
}

function cloudStatus(message, isError) {
  const statusEl = document.getElementById('authStatus');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
}

function mapRowToModel(row) {
  return {
    name: row.name || '',
    year: row.year || '',
    code: row.code || '',
    image: row.image_file || '',
    link: row.source_link || '',
    _id: row.id,
    _createdBy: row.created_by || null,
    _updatedAt: row.updated_at || null
  };
}

function mapModelToRow(model, userId) {
  return {
    name: (model.name || '').trim(),
    year: (model.year || '').trim(),
    code: (model.code || '').trim(),
    image_file: (model.image || '').trim(),
    source_link: (model.link || '').trim() || null,
    created_by: userId || null
  };
}

function getImageUrlFromCloud(path) {
  if (!path) return '';
  if (!cloudClient) return CONFIG.IMG_DIR + path;
  const { data } = cloudClient.storage.from(CLOUD.IMAGE_BUCKET).getPublicUrl(path);
  return data?.publicUrl || (CONFIG.IMG_DIR + path);
}

async function fetchModelsFromCloud() {
  if (!cloudClient) throw new Error('Cloud client not initialized');
  const { data, error } = await cloudClient
    .from(CLOUD.TABLE)
    .select('id,name,year,code,image_file,source_link,created_by,updated_at')
    .order('code', { ascending: true });

  if (error) throw error;
  return (data || []).map(mapRowToModel);
}

async function saveModelsToCloud(models) {
  if (!cloudClient) return { ok: false, error: new Error('Cloud client not initialized') };
  if (!cloudUser) return { ok: false, error: new Error('Not authenticated') };

  const payload = (models || [])
    .map((model) => mapModelToRow(model, cloudUser.id))
    .filter((row) => row.name && row.year && row.code && row.image_file);

  if (payload.length === 0) return { ok: false, error: new Error('No valid rows to save') };

  const { error } = await cloudClient
    .from(CLOUD.TABLE)
    .upsert(payload, { onConflict: 'image_file' });

  if (error) return { ok: false, error };
  return { ok: true };
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function uploadImageFilesToCloud(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return [];
  if (!cloudClient || !cloudUser) return files.map((f) => ({ file: f, path: f.name, uploaded: false }));

  const out = [];
  for (const file of files) {
    const safe = sanitizeFileName(file.name);
    const path = `${cloudUser.id}/${Date.now()}_${safe}`;
    const { error } = await cloudClient.storage
      .from(CLOUD.IMAGE_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });

    if (error) out.push({ file, path: file.name, uploaded: false, error });
    else out.push({ file, path, uploaded: true });
  }
  return out;
}

function setAuthUi() {
  const emailInput = document.getElementById('authEmail');
  const passInput = document.getElementById('authPassword');
  const signInBtn = document.getElementById('authSignInBtn');
  const signUpBtn = document.getElementById('authSignUpBtn');
  const googleBtn = document.getElementById('authGoogleBtn');
  const signOutBtn = document.getElementById('authSignOutBtn');
  const userEl = document.getElementById('authUser');

  if (!emailInput || !passInput || !signInBtn || !signUpBtn || !googleBtn || !signOutBtn || !userEl) return;

  userEl.textContent = cloudUser ? (cloudUser.email || cloudUser.id) : t('anonymous');
  signOutBtn.style.display = cloudUser ? '' : 'none';

  signInBtn.onclick = async () => {
    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) {
      cloudStatus(t('authEnterCreds'), true);
      return;
    }
    const { error } = await cloudClient.auth.signInWithPassword({ email, password });
    if (error) cloudStatus(error.message, true);
    else cloudStatus(t('authSignedIn'), false);
  };

  signUpBtn.onclick = async () => {
    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) {
      cloudStatus(t('authEnterCreds'), true);
      return;
    }
    const { error } = await cloudClient.auth.signUp({ email, password });
    if (error) cloudStatus(error.message, true);
    else cloudStatus(t('authSignUpDone'), false);
  };

  googleBtn.onclick = async () => {
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await cloudClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (error) cloudStatus(error.message, true);
  };

  signOutBtn.onclick = async () => {
    const { error } = await cloudClient.auth.signOut();
    if (error) cloudStatus(error.message, true);
    else cloudStatus(t('authSignedOut'), false);
  };
}

function setGoogleButtonState(googleEnabled) {
  const googleBtn = document.getElementById('authGoogleBtn');
  if (!googleBtn) return;
  googleBtn.disabled = !googleEnabled;
  googleBtn.title = googleEnabled ? '' : t('authGoogleDisabled');
}

async function refreshGoogleProviderState() {
  if (!isCloudConfigured()) return;
  try {
    const cfg = window.HOTWILLS_CONFIG;
    const r = await fetch(`${cfg.supabaseUrl}/auth/v1/settings`, { headers: { apikey: cfg.supabaseAnonKey } });
    if (!r.ok) return;
    const json = await r.json();
    const enabled = Boolean(json?.external?.google);
    setGoogleButtonState(enabled);
    if (!enabled) cloudStatus(t('authGoogleDisabled'), true);
  } catch (e) {
    // noop
  }
}

function stopCloudRealtime() {
  if (cloudRealtime && cloudClient) {
    cloudClient.removeChannel(cloudRealtime);
    cloudRealtime = null;
  }
}

function startCloudRealtime() {
  stopCloudRealtime();
  if (!cloudClient || !cloudUser) return;
  cloudRealtime = cloudClient
    .channel('models-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: CLOUD.TABLE }, () => {
      if (typeof cloudOnDataChange === 'function') cloudOnDataChange();
    })
    .subscribe();
}

async function syncUserFromSession() {
  const { data } = await cloudClient.auth.getSession();
  cloudUser = data?.session?.user || null;
  setAuthUi();
}

async function initCloud(onDataChange) {
  cloudOnDataChange = onDataChange;
  if (!isCloudConfigured()) {
    cloudStatus(t('authConfigMissing'), true);
    return false;
  }

  const cfg = window.HOTWILLS_CONFIG;
  cloudClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  await syncUserFromSession();
  await refreshGoogleProviderState();
  startCloudRealtime();

  if (cloudAuthSub?.data?.subscription) cloudAuthSub.data.subscription.unsubscribe();
  cloudAuthSub = cloudClient.auth.onAuthStateChange(async () => {
    await syncUserFromSession();
    startCloudRealtime();
    if (typeof cloudOnDataChange === 'function') cloudOnDataChange();
  });

  return true;
}

window.initCloud = initCloud;
window.fetchModelsFromCloud = fetchModelsFromCloud;
window.saveModelsToCloud = saveModelsToCloud;
window.uploadImageFilesToCloud = uploadImageFilesToCloud;
window.getImageUrlFromCloud = getImageUrlFromCloud;
window.getCloudUser = () => cloudUser;
window.isCloudReady = () => Boolean(cloudClient);
