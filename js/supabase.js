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
const CLOUD_OWNER_STORAGE_KEY = 'mbx_cloud_owner_id';
const OWNER_QUERY_TIMEOUT_MS = 7000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeUserId(value) {
  const out = (value || '').trim().toLowerCase();
  return UUID_RE.test(out) ? out : '';
}

function normalizeEmail(value) {
  return (value || '').trim().toLowerCase();
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function loadPersistedOwnerId() {
  try {
    return normalizeUserId(localStorage.getItem(CLOUD_OWNER_STORAGE_KEY) || '');
  } catch (e) {
    return '';
  }
}

function persistOwnerId(ownerId) {
  try {
    const normalized = normalizeUserId(ownerId);
    if (normalized) localStorage.setItem(CLOUD_OWNER_STORAGE_KEY, normalized);
    else localStorage.removeItem(CLOUD_OWNER_STORAGE_KEY);
  } catch (e) {
    // ignore storage errors
  }
}

function getCloudOwnerId() {
  if (cloudOwnerId) return cloudOwnerId;
  const persisted = loadPersistedOwnerId();
  if (persisted) {
    cloudOwnerId = persisted;
    return cloudOwnerId;
  }
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

function isRealtimeEnabled() {
  const cfg = window.HOTWILLS_CONFIG || {};
  const flag = cfg.enableRealtime;
  return flag === true || flag === 'true' || flag === 1;
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

  // Strict replace behavior:
  // use local imported images (IndexedDB) first, then bundled /img fallback.
  // Do not silently reuse old cloud objects for bare names.
  const imgDir = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.IMG_DIR) ? CONFIG.IMG_DIR : 'img/';
  const fromLocal = await fetchBlobByUrl(imgDir + encodeURIComponent(raw));
  const blob = fromLocal;
  if (!blob) {
    return { ok: false, error: `image not found locally: ${raw}` };
  }

  return uploadScoped(blob);
}

async function listStoragePathsRecursive(bucket, prefix) {
  const basePrefix = String(prefix || '').replace(/^\/+|\/+$/g, '');
  const out = [];
  const queue = [basePrefix];
  const pageLimit = 100;

  while (queue.length > 0) {
    const current = queue.shift();
    for (let offset = 0; ; offset += pageLimit) {
      const { data: listPage, error: listError } = await cloudClient.storage
        .from(bucket)
        .list(current, { limit: pageLimit, offset, sortBy: { column: 'name', order: 'asc' } });
      if (listError) return { ok: false, error: listError };

      const rows = Array.isArray(listPage) ? listPage : [];
      rows.forEach((entry) => {
        const name = (entry && entry.name) ? String(entry.name) : '';
        if (!name) return;
        const fullPath = current ? `${current}/${name}` : name;
        const isFolder = entry.id == null || entry.metadata == null;
        if (isFolder) queue.push(fullPath);
        else out.push(fullPath);
      });

      if (rows.length < pageLimit) break;
    }
  }

  return { ok: true, paths: out };
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
  const out = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await cloudClient
      .from(CLOUD.TABLE)
      .select('id,name,year,code,image_file,source_link,created_by,updated_at')
      .eq('created_by', targetOwnerId)
      .order('code', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out.map(mapRowToModel);
}

function normalizeCodeKey(value) {
  return String(value || '').trim().toLowerCase();
}

async function fetchSimilarModelsByCodes(codes, ownerId) {
  if (!cloudClient) return new Map();
  const targetOwnerId = normalizeUserId(ownerId) || getCloudOwnerId();
  if (!targetOwnerId) return new Map();

  const codeSeen = new Set();
  const codeList = [];
  (codes || []).forEach((code) => {
    const raw = String(code || '').trim();
    const key = normalizeCodeKey(raw);
    if (!key || codeSeen.has(key)) return;
    codeSeen.add(key);
    codeList.push(raw);
  });
  if (!codeList.length) return new Map();

  const rows = [];
  const codeChunkSize = 100;
  const pageSize = 1000;
  for (let i = 0; i < codeList.length; i += codeChunkSize) {
    const chunk = codeList.slice(i, i + codeChunkSize);
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data, error } = await cloudClient
        .from(CLOUD.TABLE)
        .select('created_by,code,name,year,image_file,source_link')
        .in('code', chunk)
        .not('created_by', 'is', null)
        .neq('created_by', targetOwnerId)
        .order('created_by', { ascending: true })
        .range(from, to);
      if (error) throw error;
      const page = Array.isArray(data) ? data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
  }

  const missingOwnerIds = Array.from(new Set(
    rows
      .map((row) => normalizeUserId(row.created_by))
      .filter((id) => id && !cloudOwnerEmailById[id])
  ));

  for (let i = 0; i < missingOwnerIds.length; i += 100) {
    const chunk = missingOwnerIds.slice(i, i + 100);
    const { data: profileRows, error: profileError } = await cloudClient
      .from(CLOUD.PROFILE_TABLE)
      .select('user_id,email')
      .in('user_id', chunk);
    if (profileError) throw profileError;
    (profileRows || []).forEach((profile) => {
      const userId = normalizeUserId(profile.user_id);
      const email = normalizeEmail(profile.email);
      if (userId && email) cloudOwnerEmailById[userId] = email;
    });
  }

  const groupedByModel = new Map();
  rows.forEach((row) => {
    const code = String(row?.code || '').trim();
    const codeKey = normalizeCodeKey(code);
    const ownerId = normalizeUserId(row?.created_by);
    if (!codeKey || !ownerId) return;
    const email = cloudOwnerEmailById[ownerId] || ownerId;
    const name = String(row?.name || '').trim();
    const year = String(row?.year || '').trim();
    const image = String(row?.image_file || '').trim();
    const link = String(row?.source_link || '').trim();
    const modelKey = `${ownerId}|${codeKey}`;
    let item = groupedByModel.get(modelKey);
    if (!item) {
      item = {
        ownerId,
        email,
        code,
        names: [],
        years: [],
        image: image || '',
        link: link || ''
      };
      groupedByModel.set(modelKey, item);
    }
    if (name && !item.names.includes(name)) item.names.push(name);
    if (year && !item.years.includes(year)) item.years.push(year);
    if (!item.image && image) item.image = image;
    if (!item.link && link) item.link = link;
  });

  const out = new Map();
  groupedByModel.forEach((item) => {
    const key = normalizeCodeKey(item.code);
    const current = out.get(key) || [];
    current.push({
      ownerId: item.ownerId,
      email: item.email,
      code: item.code,
      name: item.names.join(' / '),
      year: item.years.join(', '),
      image: item.image,
      link: item.link
    });
    out.set(key, current);
  });

  out.forEach((items) => {
    items.sort((a, b) => {
      const byEmail = String(a.email || '').localeCompare(String(b.email || ''));
      if (byEmail !== 0) return byEmail;
      const byName = String(a.name || '').localeCompare(String(b.name || ''));
      if (byName !== 0) return byName;
      return String(a.code || '').localeCompare(String(b.code || ''));
    });
  });

  return out;
}

async function saveModelsToCloud(models, options = {}) {
  if (!cloudClient) return { ok: false, error: new Error('Cloud client not initialized') };
  if (!cloudUser) return { ok: false, error: new Error('Not authenticated') };
  if (isCloudReadOnlyView()) return { ok: false, error: new Error(t('readOnlyEditorDisabled')) };

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const reportProgress = (stage, extra = {}) => {
    if (!onProgress) return;
    try {
      onProgress({ stage, ...extra });
    } catch (e) {
      // ignore progress callback failures
    }
  };

  const candidates = [];
  for (const model of (models || [])) {
    const base = {
      name: (model.name || '').trim(),
      year: (model.year || '').trim(),
      code: (model.code || '').trim(),
      image: (model.image || '').trim(),
      link: (model.link || '').trim()
    };
    if (!base.name || !base.year || !base.code || !base.image) {
      continue;
    }
    candidates.push(base);
  }

  reportProgress('prepare_start', { current: 0, total: candidates.length });

  const prepared = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const base = candidates[i];
    const resolved = await ensureUserScopedImagePath(base.image, cloudUser.id);
    if (!resolved.ok) {
      return { ok: false, error: new Error(`Image prepare failed for "${base.image}": ${resolved.error}`) };
    }

    prepared.push({
      ...base,
      image: resolved.path
    });
    reportProgress('prepare', { current: i + 1, total: candidates.length, image: base.image });
  }

  const payload = prepared.map((model) => mapModelToRow(model, cloudUser.id));

  if (payload.length === 0) return { ok: false, error: new Error('No valid rows to save') };

  const seenImages = new Set();
  for (const row of payload) {
    const key = String(row?.image_file || '').trim();
    if (!key) continue;
    if (seenImages.has(key)) {
      return { ok: false, error: new Error(`Duplicate image in payload: ${key}`) };
    }
    seenImages.add(key);
  }

  // Keep cloud catalog equal to current editor state:
  // replace all user rows with current payload.
  reportProgress('cleanup_scan', { current: 0, total: payload.length });
  const existingRows = [];
  const selectPageSize = 1000;
  for (let from = 0; ; from += selectPageSize) {
    const to = from + selectPageSize - 1;
    const { data: pageRows, error: existingRowsError } = await cloudClient
      .from(CLOUD.TABLE)
      .select('id,image_file')
      .eq('created_by', cloudUser.id)
      .order('id', { ascending: true })
      .range(from, to);
    if (existingRowsError) return { ok: false, error: existingRowsError };
    const rows = Array.isArray(pageRows) ? pageRows : [];
    existingRows.push(...rows);
    if (rows.length < selectPageSize) break;
  }

  const keepImages = new Set(payload.map((row) => row.image_file).filter(Boolean));
  const staleRows = (existingRows || [])
    .filter((row) => row?.id && row?.image_file && !keepImages.has(row.image_file));
  const existingIds = (existingRows || []).map((row) => row.id).filter(Boolean);

  // Remove stale storage objects referenced by stale rows first.
  // This supports legacy non-user-scoped paths if storage delete policy allows it.
  const staleStorageByRows = Array.from(new Set(staleRows.map((row) => row.image_file).filter(Boolean)));

  if (existingIds.length > 0) {
    const { error: deleteError } = await cloudClient
      .from(CLOUD.TABLE)
      .delete()
      .eq('created_by', cloudUser.id);
    if (deleteError) return { ok: false, error: deleteError };
    reportProgress('cleanup', { current: existingIds.length, total: existingIds.length });
  } else {
    reportProgress('cleanup', { current: 0, total: 0 });
  }

  reportProgress('upsert', { current: payload.length, total: payload.length });
  const { error } = await cloudClient
    .from(CLOUD.TABLE)
    .upsert(payload, { onConflict: 'image_file' });
  if (error) return { ok: false, error };

  reportProgress('cleanup_storage_scan', { current: 0, total: staleStorageByRows.length });
  const removeChunkSize = 100;
  for (let i = 0; i < staleStorageByRows.length; i += removeChunkSize) {
    const chunk = staleStorageByRows.slice(i, i + removeChunkSize);
    const { error: removeError } = await cloudClient.storage
      .from(CLOUD.IMAGE_BUCKET)
      .remove(chunk);
    if (removeError) return { ok: false, error: removeError };
    reportProgress('cleanup_storage', {
      current: Math.min(i + chunk.length, staleStorageByRows.length),
      total: staleStorageByRows.length
    });
  }

  // Remove stale files from user storage folder as well.
  const userPrefix = `${cloudUser.id}/`;
  const keepUserScoped = new Set(
    Array.from(keepImages).filter((p) => typeof p === 'string' && p.startsWith(userPrefix))
  );

  const listedResult = await listStoragePathsRecursive(CLOUD.IMAGE_BUCKET, cloudUser.id);
  if (!listedResult.ok) return { ok: false, error: listedResult.error };
  const listedPaths = Array.from(new Set((listedResult.paths || []).filter(Boolean)));

  const staleStoragePaths = listedPaths.filter((p) => !keepUserScoped.has(p));
  reportProgress('cleanup_storage_scan', { current: 0, total: staleStoragePaths.length });

  for (let i = 0; i < staleStoragePaths.length; i += removeChunkSize) {
    const chunk = staleStoragePaths.slice(i, i + removeChunkSize);
    const { error: removeError } = await cloudClient.storage
      .from(CLOUD.IMAGE_BUCKET)
      .remove(chunk);
    if (removeError) return { ok: false, error: removeError };
    reportProgress('cleanup_storage', {
      current: Math.min(i + chunk.length, staleStoragePaths.length),
      total: staleStoragePaths.length
    });
  }

  const { count: finalCount, error: finalCountError } = await cloudClient
    .from(CLOUD.TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('created_by', cloudUser.id);
  if (finalCountError) return { ok: false, error: finalCountError };
  if (typeof finalCount === 'number' && finalCount !== payload.length) {
    return {
      ok: false,
      error: new Error(`Cloud row count mismatch after save: expected ${payload.length}, got ${finalCount}`)
    };
  }

  reportProgress('done', { current: payload.length, total: payload.length });
  return {
    ok: true,
    savedCount: payload.length,
    finalCount: (typeof finalCount === 'number') ? finalCount : payload.length
  };
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
  const previousOwnerOptions = Array.isArray(cloudOwnerOptions) ? [...cloudOwnerOptions] : [];
  const previousOwnerEmailById = { ...cloudOwnerEmailById };
  let nextOwnersLastError = '';

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

  let profileRows = null;
  let profileRowsError = null;
  try {
    const profileResult = await withTimeout(
      cloudClient
        .from(CLOUD.PROFILE_TABLE)
        .select('user_id,email')
        .limit(5000),
      OWNER_QUERY_TIMEOUT_MS,
      'catalog owners query'
    );
    profileRows = profileResult.data;
    profileRowsError = profileResult.error;
  } catch (e) {
    profileRowsError = e;
  }

  if (profileRowsError) {
    nextOwnersLastError = profileRowsError.message || String(profileRowsError);
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
    let modelOwners = null;
    let modelOwnersError = null;
    try {
      const modelOwnersResult = await withTimeout(
        cloudClient
          .from(CLOUD.TABLE)
          .select('created_by')
          .not('created_by', 'is', null)
          .limit(5000),
        OWNER_QUERY_TIMEOUT_MS,
        'model owners fallback query'
      );
      modelOwners = modelOwnersResult.data;
      modelOwnersError = modelOwnersResult.error;
    } catch (e) {
      modelOwnersError = e;
    }
    if (modelOwnersError) {
      nextOwnersLastError = nextOwnersLastError || modelOwnersError.message || String(modelOwnersError);
    } else {
      (modelOwners || []).forEach((row) => {
        const userId = normalizeUserId(row.created_by);
        if (userId) ownerSet.add(userId);
      });
    }
  }

  // If queries failed/time out, keep previous known owners to avoid UI stuck in loading state.
  if (ownerSet.size === 0 && previousOwnerOptions.length > 0) {
    previousOwnerOptions.forEach((ownerId) => {
      const normalized = normalizeUserId(ownerId);
      if (normalized) ownerSet.add(normalized);
    });
    cloudOwnerEmailById = { ...previousOwnerEmailById, ...cloudOwnerEmailById };
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
  cloudOwnersLastError = nextOwnersLastError;
  persistOwnerId(cloudOwnerId);

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
    signOutBtn.disabled = true;
    let signOutError = null;
    try {
      // Prefer local sign-out first so logout works even with unstable network.
      try {
        const { error } = await cloudClient.auth.signOut({ scope: 'local' });
        if (error) signOutError = error;
      } catch (e) {
        signOutError = e;
      }

      // Fallback to default sign-out path if local scope was not successful.
      if (signOutError) {
        try {
          const { error } = await cloudClient.auth.signOut();
          if (!error) signOutError = null;
          else signOutError = error;
        } catch (e) {
          signOutError = e;
        }
      }

      await syncUserFromSession();
      startCloudRealtime();
      if (typeof cloudOnDataChange === 'function') await cloudOnDataChange();

      if (!cloudUser) {
        cloudStatus(t('authSignedOut'), false);
        const authMenu = document.querySelector('.auth-menu');
        if (authMenu?.open) authMenu.removeAttribute('open');
      } else if (signOutError) {
        cloudStatus(signOutError.message || String(signOutError), true);
      } else {
        cloudStatus(t('cloudLoadFailed'), true);
      }
    } finally {
      setAuthUi();
    }
  };

  if (ownerSelect) {
    ownerSelect.onchange = async (e) => {
      const nextOwnerId = normalizeUserId(e.target.value);
      if (!nextOwnerId) return;
      cloudOwnerId = nextOwnerId;
      persistOwnerId(cloudOwnerId);
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
  if (!cloudClient || !cloudUser || !isRealtimeEnabled()) return;
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
  if (!normalizeUserId(cloudOwnerId)) {
    const persistedOwnerId = loadPersistedOwnerId();
    if (persistedOwnerId) cloudOwnerId = persistedOwnerId;
  }
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
window.fetchSimilarModelsByCodes = fetchSimilarModelsByCodes;
window.saveModelsToCloud = saveModelsToCloud;
window.uploadImageFilesToCloud = uploadImageFilesToCloud;
window.getImageUrlFromCloud = getImageUrlFromCloud;
window.getCloudUser = () => cloudUser;
window.isCloudReady = () => Boolean(cloudClient);
window.isCloudReadOnlyView = isCloudReadOnlyView;
window.getCloudOwnerId = getCloudOwnerId;
window.getCloudOwnerOptions = () => [...cloudOwnerOptions];
window.getCloudOwnerLabel = (ownerId) => labelForOwner(normalizeUserId(ownerId) || ownerId);
window.refreshCloudUi = setAuthUi;
window.refreshCloudOwners = refreshOwnerOptions;
