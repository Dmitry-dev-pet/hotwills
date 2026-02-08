'use strict';

// ─── Config ─────────────────────────────────────────────────────────────
const CONFIG = {
  IMG_DIR: 'img/',
  LS: {
    SORT_KEY: 'mbx_sortKey',
    SORT_DESC: 'mbx_sortDesc',
    MODE: 'mbx_viewMode',
    FAVORITES: 'mbx_favorites',
    MIGRATE: { sortKey: 'sortKey', sortDesc: 'sortDesc', viewMode: 'viewMode' }
  },
  ROW_KEYS: ['name', 'year', 'code', 'image', 'link'],
  SORT_KEYS: ['name', 'code', 'year']
};

// ─── State ──────────────────────────────────────────────────────────────
let data = [];
let sortedData = [];
let sortKey = 'code';
let sortDesc = false;
let modalIndex = -1;
let searchQuery = '';
let favoritesFilter = false;
let currentMode = 'gallery';
const LOCAL_IMAGES_DB = 'hotwills_local_images_db';
const LOCAL_IMAGES_STORE = 'images';
let localImageUrls = new Map();
let localImageUrlsLower = new Map();

// ─── Storage ────────────────────────────────────────────────────────────
function getSortPrefs() {
  try {
    const key = localStorage.getItem(CONFIG.LS.SORT_KEY) ?? localStorage.getItem(CONFIG.LS.MIGRATE.sortKey);
    const desc = localStorage.getItem(CONFIG.LS.SORT_DESC) ?? localStorage.getItem(CONFIG.LS.MIGRATE.sortDesc);
    return {
      key: CONFIG.SORT_KEYS.includes(key) ? key : 'code',
      desc: desc === 'true'
    };
  } catch (e) {
    return { key: 'code', desc: false };
  }
}

function setSortPrefs(key, desc) {
  try {
    localStorage.setItem(CONFIG.LS.SORT_KEY, key);
    localStorage.setItem(CONFIG.LS.SORT_DESC, String(desc));
  } catch (e) {}
}

function getMode() {
  if (window.location.hash === '#editor') return 'editor';
  if (window.location.hash === '#infographic') return 'infographic';
  try {
    const m = localStorage.getItem(CONFIG.LS.MODE) ?? localStorage.getItem(CONFIG.LS.MIGRATE.viewMode);
    return ['editor', 'infographic'].includes(m) ? m : 'gallery';
  } catch (e) {
    return 'gallery';
  }
}

function setMode(mode) {
  try {
    localStorage.setItem(CONFIG.LS.MODE, mode);
  } catch (e) {}
}

function getFavorites() {
  try {
    const raw = localStorage.getItem(CONFIG.LS.FAVORITES);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function setFavorites(imageFiles) {
  try {
    localStorage.setItem(CONFIG.LS.FAVORITES, JSON.stringify(imageFiles));
  } catch (e) {}
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function isFavorite(imageFile) {
  return getFavorites().includes(imageFile);
}

function toggleFavorite(imageFile) {
  const fav = getFavorites();
  const idx = fav.indexOf(imageFile);
  if (idx >= 0) fav.splice(idx, 1);
  else fav.push(imageFile);
  setFavorites(fav);
}

function openLocalImagesDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('indexedDB is not available'));
      return;
    }
    const req = indexedDB.open(LOCAL_IMAGES_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOCAL_IMAGES_STORE)) {
        db.createObjectStore(LOCAL_IMAGES_STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open indexedDB'));
  });
}

function clearLocalImageUrlCache() {
  localImageUrls.forEach((url) => URL.revokeObjectURL(url));
  localImageUrls = new Map();
  localImageUrlsLower = new Map();
}

async function loadLocalImagesFromStore() {
  clearLocalImageUrlCache();
  if (!window.indexedDB) return { count: 0 };

  const db = await openLocalImagesDb();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_IMAGES_STORE, 'readonly');
    const store = tx.objectStore(LOCAL_IMAGES_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('Failed to read images from store'));
  });
  db.close();

  rows.forEach((row) => {
    if (!row?.name || !(row.blob instanceof Blob)) return;
    const url = URL.createObjectURL(row.blob);
    localImageUrls.set(row.name, url);
    localImageUrlsLower.set(String(row.name).toLowerCase(), url);
  });

  return { count: localImageUrls.size };
}

async function saveImagesToLocalStore(fileList) {
  const files = Array.from(fileList || []).filter((f) => f && f.name);
  if (!files.length) return { saved: 0 };
  if (!window.indexedDB) throw new Error('indexedDB is not available');

  const db = await openLocalImagesDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_IMAGES_STORE, 'readwrite');
    const store = tx.objectStore(LOCAL_IMAGES_STORE);
    files.forEach((file) => {
      store.put({
        name: file.name,
        blob: file,
        type: file.type || '',
        updatedAt: Date.now()
      });
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save images to store'));
    tx.onabort = () => reject(tx.error || new Error('Image save aborted'));
  });
  db.close();

  await loadLocalImagesFromStore();
  return { saved: files.length };
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('Failed to decode embedded image');
  return response.blob();
}

async function saveImageMapToLocalStore(imageMap) {
  if (!imageMap || typeof imageMap !== 'object') return { saved: 0 };
  if (!window.indexedDB) throw new Error('indexedDB is not available');

  const entries = Object.entries(imageMap).filter(([name, value]) =>
    Boolean(name) && typeof value === 'string' && value.startsWith('data:')
  );
  if (!entries.length) return { saved: 0 };

  const db = await openLocalImagesDb();
  await new Promise(async (resolve, reject) => {
    const tx = db.transaction(LOCAL_IMAGES_STORE, 'readwrite');
    const store = tx.objectStore(LOCAL_IMAGES_STORE);
    try {
      for (const [name, dataUrl] of entries) {
        const blob = await dataUrlToBlob(dataUrl);
        store.put({
          name,
          blob,
          type: blob.type || '',
          updatedAt: Date.now()
        });
      }
    } catch (e) {
      tx.abort();
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save embedded images'));
    tx.onabort = () => reject(tx.error || new Error('Embedded image save aborted'));
  });
  db.close();

  await loadLocalImagesFromStore();
  return { saved: entries.length };
}

function getLocalImageUrl(filename) {
  const key = String(filename || '').trim();
  if (!key) return '';
  return localImageUrls.get(key) || localImageUrlsLower.get(key.toLowerCase()) || '';
}

async function initLocalImages() {
  if (!window.indexedDB) return false;
  try {
    await loadLocalImagesFromStore();
    return true;
  } catch (e) {
    return false;
  }
}

// ─── Data ───────────────────────────────────────────────────────────────
function parseYearRange(yearStr) {
  if (!yearStr || !yearStr.trim()) return null;
  const y = yearStr.trim();
  const range = y.match(/(\d{4})\s*-\s*(\d{4})/);
  if (range) return { start: parseInt(range[1], 10), end: parseInt(range[2], 10) };
  const single = y.match(/(\d{4})/);
  return single ? { start: parseInt(single[1], 10), end: parseInt(single[1], 10) } : null;
}

function isYearInRange(year, range) {
  return range && year >= range.start && year <= range.end;
}

function yearMatchesSearch(yearStr, searchStr) {
  if (!yearStr || !searchStr) return false;
  const s = searchStr.trim();
  const y = yearStr.trim();
  if (y.toLowerCase().includes(s.toLowerCase())) return true;
  const n = parseInt(s, 10);
  if (isNaN(n)) return false;
  const year = n < 100 ? 1900 + n : n;
  const range = y.match(/(\d{4})\s*-\s*(\d{4})/);
  if (range) return year >= parseInt(range[1], 10) && year <= parseInt(range[2], 10);
  const single = y.match(/(\d{4})/);
  return single ? parseInt(single[1], 10) === year : false;
}

function matchesSearch(item, q) {
  if (!q.trim()) return true;
  const s = q.trim().toLowerCase();
  const name = (item.name || '').toLowerCase();
  const code = (item.code || '').toLowerCase();
  return name.includes(s) || yearMatchesSearch(item.year || '', q) || code.includes(s);
}

function getFilteredGalleryData() {
  let out = searchQuery ? sortedData.filter(item => matchesSearch(item, searchQuery)) : sortedData;
  if (favoritesFilter) out = out.filter(item => isFavorite(item.image || ''));
  return out;
}

function imgPath(filename) {
  const localUrl = getLocalImageUrl(filename || '');
  if (localUrl) return localUrl;
  if (typeof getImageUrlFromCloud === 'function') {
    return getImageUrlFromCloud(filename || '');
  }
  return CONFIG.IMG_DIR + (filename || '');
}

function sortComparator(a, b) {
  const va = (a[sortKey] || '').toString();
  const vb = (b[sortKey] || '').toString();
  const cmp = va.localeCompare(vb, undefined, { numeric: sortKey === 'code' });
  return sortDesc ? -cmp : cmp;
}

function tryLoadDataJson() {
  const fetchLocal = () => fetch('data/data.json')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(json => {
      const arr = Array.isArray(json) ? json : (json?.items ?? json?.data ?? []);
      return Array.isArray(arr) ? arr : [];
    });

  const hasCloudOwner = typeof getCloudOwnerId === 'function' && Boolean(getCloudOwnerId());
  if (
    typeof fetchModelsFromCloud === 'function'
    && typeof isCloudReady === 'function'
    && isCloudReady()
    && hasCloudOwner
  ) {
    return fetchModelsFromCloud(getCloudOwnerId()).catch(() => fetchLocal());
  }
  return fetchLocal();
}

function showEmptyWithLoadButton(container, attachClick) {
  container.innerHTML = '<div class="gallery-empty"><button type="button" class="empty-load-btn" data-t="loadJson">' + t('loadJson') + '</button></div>';
  const btn = container.querySelector('.empty-load-btn');
  if (btn && attachClick) btn.addEventListener('click', () => document.getElementById('fileInput').click());
}

window.saveImagesToLocalStore = saveImagesToLocalStore;
window.saveImageMapToLocalStore = saveImageMapToLocalStore;
window.initLocalImages = initLocalImages;
