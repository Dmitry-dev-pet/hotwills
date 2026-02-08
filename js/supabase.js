'use strict';

const CLOUD = {
  TABLE: 'models',
  PROFILE_TABLE: 'user_profiles',
  IMAGE_BUCKET: (window.HOTWILLS_CONFIG && window.HOTWILLS_CONFIG.imageBucket) || 'model-images'
};

let cloudClient = null;
let cloudUser = null;
let cloudAuthSub = null;
let cloudRealtime = null;
let cloudOnDataChange = null;
let cloudOwnerId = null;
let cloudOwnerOptions = [];
let cloudOwnersLastError = '';
let cloudOwnerEmailById = {};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeUserId(value) {
  const out = (value || '').trim().toLowerCase();
  return UUID_RE.test(out) ? out : '';
}

function normalizeEmail(value) {
  return (value || '').trim().toLowerCase();
}

function getCloudOwnerId() {
  if (cloudOwnerId) return cloudOwnerId;
  return cloudUser?.id || null;
}

function isCloudReadOnlyView() {
  const ownerId = getCloudOwnerId();
  return Boolean(ownerId && (!cloudUser || ownerId !== cloudUser.id));
}

async function triggerCloudRefresh() {
  if (typeof cloudOnDataChange !== 'function') return;
  await cloudOnDataChange();
}

function getCompactUserId(id) {
  if (!id) return '';
  return id.length <= 10 ? id : `${id.slice(0, 8)}...`;
}

function labelForOwner(ownerId) {
  if (!ownerId) return '';
  const email = cloudOwnerEmailById[ownerId] || '';
  if (cloudUser && ownerId === cloudUser.id) {
    return email ? `${email} (${t('catalogOwnerMine')})` : t('catalogOwnerMine');
  }
  return email || ownerId;
}

function ownerStatusLabel(ownerId) {
  if (!ownerId) return '';
  return cloudOwnerEmailById[ownerId] || getCompactUserId(ownerId);
}

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

function getStoragePublicUrl(path) {
  if (!cloudClient || !path) return '';
  const { data } = cloudClient.storage.from(CLOUD.IMAGE_BUCKET).getPublicUrl(path);
  return data?.publicUrl || '';
}

async function fetchBlobByUrl(url) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.blob();
  } catch (e) {
    return null;
  }
}

async function ensureUserScopedImagePath(imagePath, userId) {
  const raw = (imagePath || '').trim();
  if (!raw) return { ok: false, error: 'empty image path' };
  if (raw.includes('/')) return { ok: true, path: raw };

  const scopedPath = `${userId}/${raw}`;
  const uploadScoped = async (blob) => {
    if (!blob) return { ok: false, error: 'empty blob' };
    const { error } = await cloudClient.storage
      .from(CLOUD.IMAGE_BUCKET)
      .upload(scopedPath, blob, { upsert: true, contentType: blob.type || 'application/octet-stream' });
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true, path: scopedPath };
  };

  // Prefer browser-local images imported from folder: no noisy Storage probing.
  if (typeof getLocalImageBlobByName === 'function') {
    const localBlob = await getLocalImageBlobByName(raw);
    if (localBlob) {
      return uploadScoped(localBlob);
    }
  }

  const scopedBlob = await fetchBlobByUrl(getStoragePublicUrl(scopedPath));
  if (scopedBlob) return { ok: true, path: scopedPath };

  // 1) try existing object from storage root key (legacy import)
  // 2) try browser local image storage (folder import)
  // 3) fallback to local bundled image under /img
  const fromStorage = await fetchBlobByUrl(getStoragePublicUrl(raw));
  const fromIndexedDb = fromStorage
    ? null
    : (typeof getLocalImageBlobByName === 'function' ? await getLocalImageBlobByName(raw) : null);
  const imgDir = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.IMG_DIR) ? CONFIG.IMG_DIR : 'img/';
  const fromLocal = (fromStorage || fromIndexedDb) ? null : await fetchBlobByUrl(imgDir + encodeURIComponent(raw));
  const blob = fromStorage || fromIndexedDb || fromLocal;
  if (!blob) {
    return { ok: false, error: `image not found: ${raw}` };
  }

  return uploadScoped(blob);
}

function getImageUrlFromCloud(path) {
  if (!path) return '';
  if (!cloudClient) return CONFIG.IMG_DIR + path;
  const { data } = cloudClient.storage.from(CLOUD.IMAGE_BUCKET).getPublicUrl(path);
  return data?.publicUrl || (CONFIG.IMG_DIR + path);
}

async function fetchModelsFromCloud(ownerId) {
  if (!cloudClient) throw new Error('Cloud client not initialized');
  const targetOwnerId = normalizeUserId(ownerId) || getCloudOwnerId();
  if (!targetOwnerId) throw new Error('No target owner selected');
  const { data, error } = await cloudClient
    .from(CLOUD.TABLE)
    .select('id,name,year,code,image_file,source_link,created_by,updated_at')
    .eq('created_by', targetOwnerId)
    .order('code', { ascending: true });

  if (error) throw error;
  return (data || []).map(mapRowToModel);
}

async function saveModelsToCloud(models) {
  if (!cloudClient) return { ok: false, error: new Error('Cloud client not initialized') };
  if (!cloudUser) return { ok: false, error: new Error('Not authenticated') };
  if (isCloudReadOnlyView()) return { ok: false, error: new Error(t('readOnlyEditorDisabled')) };

  const prepared = [];
  for (const model of (models || [])) {
    const base = {
      name: (model.name || '').trim(),
      year: (model.year || '').trim(),
      code: (model.code || '').trim(),
      image: (model.image || '').trim(),
      link: (model.link || '').trim()
    };
    if (!base.name || !base.year || !base.code || !base.image) continue;

    const resolved = await ensureUserScopedImagePath(base.image, cloudUser.id);
    if (!resolved.ok) {
      return { ok: false, error: new Error(`Image prepare failed for "${base.image}": ${resolved.error}`) };
    }

    prepared.push({
      ...base,
      image: resolved.path
    });
  }

  const payload = prepared.map((model) => mapModelToRow(model, cloudUser.id));

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
  if (isCloudReadOnlyView()) return files.map((f) => ({ file: f, path: f.name, uploaded: false }));

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

async function ensureCurrentUserProfile() {
  if (!cloudClient || !cloudUser) return;
  const email = normalizeEmail(cloudUser.email || '');
  if (!email) return;
  cloudOwnerEmailById[cloudUser.id] = email;
  await cloudClient
    .from(CLOUD.PROFILE_TABLE)
    .upsert({ user_id: cloudUser.id, email }, { onConflict: 'user_id' });
}

function renderOwnerSelect() {
  const ownerSelect = document.getElementById('authOwnerSelect');
  if (!ownerSelect) return;

  const options = cloudOwnerOptions.filter(Boolean);
  const fallbackOwnerId = cloudUser?.id || options[0] || '';
  const targetOwnerId = normalizeUserId(getCloudOwnerId()) || fallbackOwnerId;
  const finalOptions = options.length ? options : (fallbackOwnerId ? [fallbackOwnerId] : []);

  if (!finalOptions.length) {
    ownerSelect.innerHTML = `<option value="">${t('catalogOwnerNoData')}</option>`;
    ownerSelect.disabled = true;
    return;
  }

  ownerSelect.innerHTML = finalOptions.map((id) => {
    const selected = id === targetOwnerId ? ' selected' : '';
    return `<option value="${id}"${selected}>${escapeHtml(labelForOwner(id))}</option>`;
  }).join('');
  ownerSelect.disabled = false;
}

async function refreshOwnerOptions() {
  const ownerSelect = document.getElementById('authOwnerSelect');
  cloudOwnersLastError = '';
  if (ownerSelect) {
    ownerSelect.disabled = true;
    ownerSelect.innerHTML = `<option value="">${t('catalogOwnerLoading')}</option>`;
  }

  if (!cloudClient) {
    cloudOwnerOptions = [];
    cloudOwnerEmailById = {};
    renderOwnerSelect();
    return;
  }

  const ownerSet = new Set();
  cloudOwnerEmailById = {};

  const { data: profileRows, error: profileRowsError } = await cloudClient
    .from(CLOUD.PROFILE_TABLE)
    .select('user_id,email')
    .limit(5000);

  if (profileRowsError) {
    cloudOwnersLastError = profileRowsError.message || String(profileRowsError);
  } else {
    (profileRows || []).forEach((row) => {
      const userId = normalizeUserId(row.user_id);
      const email = normalizeEmail(row.email);
      if (!userId) return;
      ownerSet.add(userId);
      if (email) cloudOwnerEmailById[userId] = email;
    });
  }

  if (cloudUser?.id && cloudUser?.email) {
    ownerSet.add(cloudUser.id);
    cloudOwnerEmailById[cloudUser.id] = normalizeEmail(cloudUser.email);
  }

  if (ownerSet.size === 0) {
    const { data: modelOwners, error: modelOwnersError } = await cloudClient
      .from(CLOUD.TABLE)
      .select('created_by')
      .not('created_by', 'is', null)
      .limit(5000);
    if (modelOwnersError) {
      cloudOwnersLastError = cloudOwnersLastError || modelOwnersError.message || String(modelOwnersError);
    } else {
      (modelOwners || []).forEach((row) => {
        const userId = normalizeUserId(row.created_by);
        if (userId) ownerSet.add(userId);
      });
    }
  }

  const ownerIds = Array.from(ownerSet);
  cloudOwnerOptions = ownerIds.sort((a, b) => {
    if (cloudUser?.id && a === cloudUser.id) return -1;
    if (cloudUser?.id && b === cloudUser.id) return 1;
    const ak = cloudOwnerEmailById[a] || a;
    const bk = cloudOwnerEmailById[b] || b;
    return ak.localeCompare(bk);
  });

  if (!cloudOwnerOptions.length && cloudUser?.id) {
    cloudOwnerOptions = [cloudUser.id];
  }
  if (!cloudOwnerId || !cloudOwnerOptions.includes(cloudOwnerId)) {
    cloudOwnerId = cloudUser?.id || cloudOwnerOptions[0] || null;
  }

  renderOwnerSelect();
}

function setAuthUi() {
  const signInBtn = document.getElementById('authSignInBtn');
  const signOutBtn = document.getElementById('authSignOutBtn');
  const ownerSelect = document.getElementById('authOwnerSelect');
  const userEl = document.getElementById('authUser');

  if (!signInBtn || !signOutBtn || !userEl) return;

  const hasUser = Boolean(cloudUser);
  const ownerId = getCloudOwnerId();
  const readOnlyView = isCloudReadOnlyView();
  userEl.textContent = cloudUser ? (cloudUser.email || cloudUser.id) : t('anonymous');
  signOutBtn.disabled = !hasUser;

  const onlyOwnCatalog = Boolean(
    hasUser
    && cloudOwnerOptions.length === 1
    && cloudOwnerOptions[0] === cloudUser.id
  );

  if (cloudOwnersLastError) {
    cloudStatus(`${t('catalogOwnerLoadFailed')}: ${cloudOwnersLastError}`, true);
  } else if (onlyOwnCatalog) {
    cloudStatus(t('catalogOwnerOnlyMine'), false);
  } else if (ownerId) {
    const message = readOnlyView
      ? `${t('authViewingUser', { id: ownerStatusLabel(ownerId) })} (${t('readOnlyMode')})`
      : t('authViewingOwn');
    cloudStatus(message, false);
  }

  signInBtn.onclick = async () => {
    if (!cloudClient) {
      cloudStatus(t('authConfigMissing'), true);
      return;
    }
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await cloudClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (error) cloudStatus(error.message, true);
  };

  signOutBtn.onclick = async () => {
    if (!cloudClient) {
      cloudStatus(t('authConfigMissing'), true);
      return;
    }
    if (!cloudUser) {
      cloudStatus(t('authSignedOut'), false);
      return;
    }
    const { error } = await cloudClient.auth.signOut();
    if (error) cloudStatus(error.message, true);
    else cloudStatus(t('authSignedOut'), false);
  };

  if (ownerSelect) {
    ownerSelect.onchange = async (e) => {
      const nextOwnerId = normalizeUserId(e.target.value);
      if (!nextOwnerId) return;
      cloudOwnerId = nextOwnerId;
      startCloudRealtime();
      await triggerCloudRefresh();
      setAuthUi();
    };
  }

  renderOwnerSelect();
}

function setGoogleButtonState(googleEnabled) {
  const signInBtn = document.getElementById('authSignInBtn');
  if (!signInBtn) return;
  signInBtn.disabled = !googleEnabled;
  signInBtn.title = googleEnabled ? '' : t('authGoogleDisabled');
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
  const ownerId = getCloudOwnerId();
  if (!ownerId) return;
  cloudRealtime = cloudClient
    .channel(`models-live-${ownerId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: CLOUD.TABLE,
      filter: `created_by=eq.${ownerId}`
    }, () => {
      if (typeof cloudOnDataChange === 'function') cloudOnDataChange();
    })
    .subscribe();
}

async function syncUserFromSession() {
  const { data } = await cloudClient.auth.getSession();
  cloudUser = data?.session?.user || null;
  await ensureCurrentUserProfile();
  if (cloudUser && !normalizeUserId(cloudOwnerId)) {
    cloudOwnerId = cloudUser.id;
  }
  if (!cloudUser && cloudOwnerId && !normalizeUserId(cloudOwnerId)) {
    cloudOwnerId = null;
  }
  await refreshOwnerOptions();
  setAuthUi();
}

async function initCloud(onDataChange) {
  cloudOnDataChange = onDataChange;
  setAuthUi();
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
window.isCloudReadOnlyView = isCloudReadOnlyView;
window.getCloudOwnerId = getCloudOwnerId;
window.refreshCloudUi = setAuthUi;
window.refreshCloudOwners = refreshOwnerOptions;
