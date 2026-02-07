'use strict';

// ─── App (main) ─────────────────────────────────────────────────────────
function sortBy(key, noToggle) {
  if (!noToggle && sortKey === key) {
    sortDesc = !sortDesc;
  } else {
    sortKey = key;
    sortDesc = false;
  }
  data.sort(sortComparator);
  sortedData = [...data];
  setSortPrefs(sortKey, sortDesc);
  renderCurrent();
}

function loadData(json) {
  data = Array.isArray(json) ? json : [];
  sortedData = [...data];
  sortBy(sortKey, true);
  renderCurrent();
}

function renderCurrent() {
  if (currentMode === 'gallery') renderGallery();
  else if (currentMode === 'editor') renderEditor();
  else if (currentMode === 'infographic') renderInfographic();
}

async function refreshCloudData() {
  try {
    const rows = await tryLoadDataJson();
    loadData(rows);
  } catch (e) {
    loadData([]);
  }
}

function updateToolbarVisibility(mode) {
  document.getElementById('viewGallery').classList.toggle('hidden', mode !== 'gallery');
  document.getElementById('viewEditor').classList.toggle('hidden', mode !== 'editor');
  document.getElementById('viewInfographic').classList.toggle('hidden', mode !== 'infographic');
  document.querySelectorAll('.mode-editor').forEach(el => el.style.display = mode === 'editor' ? '' : 'none');
  document.querySelectorAll('.mode-gallery').forEach(el => el.style.display = (mode === 'gallery' || mode === 'infographic') ? '' : 'none');
  const modeSelect = document.getElementById('modeSelect');
  if (modeSelect) {
    modeSelect.value = mode;
    modeSelect.querySelectorAll('option').forEach(opt => {
      opt.textContent = t(opt.dataset.t || opt.value);
    });
  }
  const favBtn = document.getElementById('favoritesBtn');
  if (favBtn) {
    favBtn.classList.toggle('active', favoritesFilter);
    favBtn.textContent = favoritesFilter ? '♥' : '♡';
    favBtn.title = t('favorites');
  }
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function formatCloudError(err) {
  if (!err) return 'unknown error';
  const parts = [];
  if (err.message) parts.push(err.message);
  if (err.details) parts.push(err.details);
  if (err.hint) parts.push('hint: ' + err.hint);
  if (err.code) parts.push('code: ' + err.code);
  return parts.join(' | ') || String(err);
}

function switchToGallery() {
  history.replaceState(null, '', location.pathname + location.search);
  if (currentMode === 'editor') {
    data = collectFromDOM();
    sortedData = [...data];
    sortBy(sortKey, true);
  }
  closeYearModal();
  currentMode = 'gallery';
  setMode('gallery');
  updateToolbarVisibility('gallery');
  renderGallery();
}

function switchToEditor() {
  history.replaceState(null, '', location.pathname + location.search + '#editor');
  if (currentMode === 'infographic') closeYearModal();
  if (currentMode === 'gallery' || currentMode === 'infographic') {
    data = [...sortedData];
  }
  currentMode = 'editor';
  setMode('editor');
  updateToolbarVisibility('editor');
  renderEditor();
}

function switchToInfographic() {
  history.replaceState(null, '', location.pathname + location.search + '#infographic');
  if (currentMode === 'editor') {
    data = collectFromDOM();
    sortedData = [...data];
    sortBy(sortKey, true);
  }
  currentMode = 'infographic';
  setMode('infographic');
  updateToolbarVisibility('infographic');
  renderInfographic();
}

// ─── Init ───────────────────────────────────────────────────────────────
document.documentElement.lang = getLang();

currentMode = getMode();
(function initSort() {
  const p = getSortPrefs();
  sortKey = p.key;
  sortDesc = p.desc;
})();

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('yearModalClose').addEventListener('click', closeYearModal);
document.getElementById('yearModalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'yearModalOverlay') closeYearModal();
});
document.getElementById('modalPrev').addEventListener('click', (e) => { e.stopPropagation(); modalPrev(); });
document.getElementById('modalNext').addEventListener('click', (e) => { e.stopPropagation(); modalNext(); });
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.getElementById('yearModalOverlay').classList.contains('show')) closeYearModal();
    else closeModal();
  }
  if (document.getElementById('modalOverlay').classList.contains('show')) {
    if (e.key === 'ArrowLeft') modalPrev();
    if (e.key === 'ArrowRight') modalNext();
  }
});

document.getElementById('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      let text = String(r.result).replace(/^\uFEFF/, '').trim();
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : (parsed?.items ?? parsed?.data ?? []);
      loadData(Array.isArray(arr) ? arr : []);
      showToast(t('jsonLoaded'));
    } catch (err) {
      alert(t('errorInvalidJson') + '\n' + (err.message || ''));
    }
  };
  r.readAsText(file, 'UTF-8');
  e.target.value = '';
});

const applySearch = debounce(() => {
  searchQuery = document.getElementById('searchInput').value;
  if (currentMode === 'gallery') renderGallery();
  else if (currentMode === 'infographic') renderInfographic();
  else applyEditorSearchFilter();
}, 300);

document.getElementById('searchInput').addEventListener('input', applySearch);

document.getElementById('sortSelect').addEventListener('change', (e) => {
  sortBy(e.target.value, true);
  if (currentMode === 'infographic') renderInfographic();
});
document.getElementById('addPhotoBtn').addEventListener('click', () => document.getElementById('addPhotoInput').click());
document.getElementById('addPhotoInput').addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  let prepared = Array.from(files).map(f => ({ path: f.name, uploaded: false }));
  if (typeof uploadImageFilesToCloud === 'function') {
    prepared = await uploadImageFilesToCloud(files);
  }

  const newRows = prepared.map(item => ({
    name: '', year: '', code: '', image: item.path, link: ''
  }));

  data = newRows.concat(data);
  if (currentMode === 'editor') renderEditor();
  else { sortedData = [...data]; sortBy(sortKey, true); }

  const uploadedCount = prepared.filter(i => i.uploaded).length;
  if (uploadedCount > 0) showToast(t('addPhotoUploaded', { n: uploadedCount }));
  else showToast(t('addPhotoAdded', { n: newRows.length }));
  e.target.value = '';
});

document.getElementById('copyBtn').addEventListener('click', () => {
  if (data.length === 0) { showToast(t('loadJsonFirst')); return; }
  navigator.clipboard.writeText(toJSON()).then(() => showToast(t('copiedToClipboard')));
});

document.getElementById('saveBtn').addEventListener('click', () => {
  if (data.length === 0) { showToast(t('loadJsonFirst')); return; }
  const blob = new Blob([toJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'data.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(t('fileDownloaded'));
});

document.getElementById('cloudSaveBtn').addEventListener('click', async () => {
  if (typeof saveModelsToCloud !== 'function') {
    showToast(t('cloudNotConfigured'));
    return;
  }
  const rows = collectFromDOM();
  const result = await saveModelsToCloud(rows);
  if (!result.ok) {
    const msg = t('cloudSaveFailed') + ': ' + formatCloudError(result.error);
    console.error('cloudSave failed', result.error);
    if (typeof cloudStatus === 'function') cloudStatus(msg, true);
    showToast(msg);
    alert(msg);
    return;
  }
  loadData(rows);
  showToast(t('cloudSaved'));
});

document.getElementById('cloudReloadBtn').addEventListener('click', async () => {
  await refreshCloudData();
  showToast(t('cloudReloaded'));
});

document.getElementById('modeSelect').addEventListener('change', (e) => {
  const mode = e.target.value;
  if (mode === 'gallery') switchToGallery();
  else if (mode === 'editor') switchToEditor();
  else if (mode === 'infographic') switchToInfographic();
});

document.getElementById('favoritesBtn').addEventListener('click', () => {
  favoritesFilter = !favoritesFilter;
  updateToolbarVisibility(currentMode);
  if (currentMode === 'infographic') renderInfographic();
  else renderGallery();
});

document.getElementById('themeSelect').value = getTheme();
document.getElementById('themeSelect').addEventListener('change', (e) => setTheme(e.target.value));
document.getElementById('sortSelect').value = sortKey;
document.getElementById('langSelect').value = getLang();
document.documentElement.lang = getLang();
document.getElementById('langSelect').addEventListener('change', (e) => {
  setLang(e.target.value);
  document.documentElement.lang = getLang();
  applyTranslations();
  document.title = t('pageTitle');
  document.getElementById('searchInput').placeholder = t('searchPlaceholder');
  updateToolbarVisibility(currentMode);
  renderCurrent();
});

applyTranslations();
document.title = t('pageTitle');
document.getElementById('searchInput').placeholder = t('searchPlaceholder');
updateToolbarVisibility(currentMode);

(async () => {
  if (typeof initCloud === 'function') {
    await initCloud(refreshCloudData);
  }
  await refreshCloudData();
})();
