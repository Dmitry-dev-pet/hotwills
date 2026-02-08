'use strict';

const STATS_COMPARE_OWNER_KEY = 'mbx_stats_compare_owner';

let statsRows = [];
let statsSummary = null;
let statsSimilarSummary = { codesWithSimilar: 0, modelsWithSimilar: 0, totalOtherMatches: 0 };
let statsSimilarMap = new Map();
let statsSimilarReqSeq = 0;
let statsCompareReqSeq = 0;
let statsCompareCache = new Map();
let statsCompareResult = null;

function normalizeCodeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getSavedCompareOwnerId() {
  try {
    return localStorage.getItem(STATS_COMPARE_OWNER_KEY) || '';
  } catch (e) {
    return '';
  }
}

function setSavedCompareOwnerId(ownerId) {
  try {
    if (ownerId) localStorage.setItem(STATS_COMPARE_OWNER_KEY, ownerId);
    else localStorage.removeItem(STATS_COMPARE_OWNER_KEY);
  } catch (e) {
    // ignore storage errors
  }
}

function formatYearRange(summary) {
  if (!summary || summary.yearMin == null || summary.yearMax == null) return '—';
  if (summary.yearMin === summary.yearMax) return String(summary.yearMin);
  return `${summary.yearMin}-${summary.yearMax}`;
}

function parseYearStart(value) {
  if (typeof parseYearRange === 'function') {
    const out = parseYearRange(value || '');
    return out ? out.start : null;
  }
  const m = String(value || '').match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

function collectCatalogStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const codeCounts = new Map();
  const decadeCounts = new Map();
  let yearMin = null;
  let yearMax = null;
  let missingLink = 0;
  let missingImage = 0;
  const favorites = typeof getFavorites === 'function' ? new Set(getFavorites()) : new Set();
  let favoriteModels = 0;

  list.forEach((row) => {
    const code = String(row?.code || '').trim();
    if (code) codeCounts.set(code, (codeCounts.get(code) || 0) + 1);

    const yearStart = parseYearStart(row?.year || '');
    if (yearStart != null) {
      if (yearMin == null || yearStart < yearMin) yearMin = yearStart;
      if (yearMax == null || yearStart > yearMax) yearMax = yearStart;
      const decade = Math.floor(yearStart / 10) * 10;
      decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1);
    }

    if (!String(row?.link || '').trim()) missingLink += 1;
    if (!String(row?.image || '').trim()) missingImage += 1;
    if (favorites.has(String(row?.image || '').trim())) favoriteModels += 1;
  });

  const topCodes = Array.from(codeCounts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, 10);

  const duplicates = Array.from(codeCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const decades = Array.from(decadeCounts.entries())
    .map(([decade, count]) => ({ decade, count }))
    .sort((a, b) => a.decade - b.decade);

  return {
    total: list.length,
    uniqueCodes: codeCounts.size,
    yearMin,
    yearMax,
    favoriteModels,
    missingLink,
    missingImage,
    topCodes,
    duplicates,
    decades,
    codeCounts
  };
}

function computeSimilarSummary(rows, similarMap) {
  const list = Array.isArray(rows) ? rows : [];
  const map = similarMap instanceof Map ? similarMap : new Map();
  const codesWithSimilar = new Set();
  let modelsWithSimilar = 0;
  let totalOtherMatches = 0;
  const countedCodes = new Set();

  list.forEach((row) => {
    const key = normalizeCodeKey(row?.code || '');
    if (!key) return;
    const matches = map.get(key) || [];
    if (!matches.length) return;
    modelsWithSimilar += 1;
    codesWithSimilar.add(key);
    if (!countedCodes.has(key)) {
      countedCodes.add(key);
      totalOtherMatches += matches.length;
    }
  });

  return {
    codesWithSimilar: codesWithSimilar.size,
    modelsWithSimilar,
    totalOtherMatches
  };
}

function renderHeaderMetrics() {
  const modelsEl = document.getElementById('headerStatModels');
  const codesEl = document.getElementById('headerStatCodes');
  const yearsEl = document.getElementById('headerStatYears');
  const similarEl = document.getElementById('headerStatSimilar');
  if (!modelsEl || !codesEl || !yearsEl || !similarEl) return;

  const summary = statsSummary || collectCatalogStats(statsRows);
  modelsEl.textContent = t('headerMetricModels', { n: summary.total || 0 });
  codesEl.textContent = t('headerMetricCodes', { n: summary.uniqueCodes || 0 });
  yearsEl.textContent = t('headerMetricYears', { years: formatYearRange(summary) });
  similarEl.textContent = t('headerMetricSimilar', { n: statsSimilarSummary.codesWithSimilar || 0 });
}

function renderCards(target, cards) {
  if (!target) return;
  target.innerHTML = cards.map((card) => `
    <article class="stats-card">
      <div class="stats-card-label">${escapeHtml(card.label)}</div>
      <div class="stats-card-value">${escapeHtml(String(card.value))}</div>
    </article>
  `).join('');
}

function renderList(target, rows, rowRenderer, emptyText) {
  if (!target) return;
  if (!rows.length) {
    target.innerHTML = `<div class="stats-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  target.innerHTML = rows.map(rowRenderer).join('');
}

function renderOverviewSection() {
  const summary = statsSummary || collectCatalogStats(statsRows);
  const overviewCardsEl = document.getElementById('statsOverviewCards');
  const qualityCardsEl = document.getElementById('statsQualityCards');
  if (!overviewCardsEl || !qualityCardsEl) return;

  const overviewCards = [
    { label: t('statsTotalModels'), value: summary.total || 0 },
    { label: t('statsUniqueCodes'), value: summary.uniqueCodes || 0 },
    { label: t('statsYearRange'), value: formatYearRange(summary) },
    { label: t('statsFavorites'), value: summary.favoriteModels || 0 },
    { label: t('statsAlsoInOthers'), value: statsSimilarSummary.codesWithSimilar || 0 },
    { label: t('statsModelsWithOthers'), value: statsSimilarSummary.modelsWithSimilar || 0 }
  ];
  renderCards(overviewCardsEl, overviewCards);

  const qualityCards = [
    { label: t('statsMissingLinks'), value: summary.missingLink || 0 },
    { label: t('statsMissingImages'), value: summary.missingImage || 0 }
  ];
  renderCards(qualityCardsEl, qualityCards);
}

function renderCollectionSection() {
  const summary = statsSummary || collectCatalogStats(statsRows);
  const topCodesEl = document.getElementById('statsTopCodesList');
  const duplicatesEl = document.getElementById('statsDuplicatesList');
  const decadesEl = document.getElementById('statsDecadesBars');
  if (!topCodesEl || !duplicatesEl || !decadesEl) return;

  renderList(
    topCodesEl,
    summary.topCodes || [],
    (row, i) => `
      <div class="stats-list-row">
        <span class="stats-list-key">${i + 1}. ${escapeHtml(row.code)}</span>
        <span class="stats-list-value">${escapeHtml(String(row.count))}</span>
      </div>
    `,
    t('statsNoData')
  );

  renderList(
    duplicatesEl,
    summary.duplicates || [],
    (row) => `
      <div class="stats-list-row">
        <span class="stats-list-key">${escapeHtml(row.code)}</span>
        <span class="stats-list-value">${escapeHtml(String(row.count))}</span>
      </div>
    `,
    t('statsNoDuplicates')
  );

  const decades = summary.decades || [];
  if (!decades.length) {
    decadesEl.innerHTML = `<div class="stats-empty">${escapeHtml(t('statsNoDecades'))}</div>`;
    return;
  }
  const maxCount = Math.max(...decades.map((d) => d.count), 1);
  decadesEl.innerHTML = decades.map((row) => {
    const width = Math.max(4, Math.round((row.count / maxCount) * 100));
    return `
      <div class="stats-bar-row">
        <div class="stats-bar-label">${escapeHtml(String(row.decade))}s</div>
        <div class="stats-bar-track">
          <div class="stats-bar-fill" style="width:${width}%"></div>
        </div>
        <div class="stats-bar-value">${escapeHtml(String(row.count))}</div>
      </div>
    `;
  }).join('');
}

function getCompareOwnerOptions() {
  const ownerOptions = typeof getCloudOwnerOptions === 'function' ? getCloudOwnerOptions() : [];
  const currentOwnerId = typeof getCloudOwnerId === 'function' ? getCloudOwnerId() : '';
  return (ownerOptions || []).filter((id) => id && id !== currentOwnerId);
}

function formatOwnerLabel(ownerId) {
  if (!ownerId) return '';
  if (typeof getCloudOwnerLabel === 'function') return getCloudOwnerLabel(ownerId);
  return ownerId;
}

function ensureCompareOwnerSelection() {
  const selectEl = document.getElementById('statsCompareOwner');
  if (!selectEl) return '';

  const options = getCompareOwnerOptions();
  const saved = getSavedCompareOwnerId();
  const first = options[0] || '';
  const selected = options.includes(saved) ? saved : first;

  if (!options.length) {
    selectEl.innerHTML = `<option value="">${escapeHtml(t('catalogOwnerNoData'))}</option>`;
    selectEl.disabled = true;
    setSavedCompareOwnerId('');
    return '';
  }

  selectEl.innerHTML = options.map((ownerId) => `
    <option value="${escapeHtml(ownerId)}"${ownerId === selected ? ' selected' : ''}>
      ${escapeHtml(formatOwnerLabel(ownerId))}
    </option>
  `).join('');
  selectEl.disabled = false;
  setSavedCompareOwnerId(selected);
  return selected;
}

async function fetchOwnerRows(ownerId) {
  if (!ownerId) return [];
  const cached = statsCompareCache.get(ownerId);
  if (cached) return cached;
  if (typeof fetchModelsFromCloud !== 'function') return [];
  const rows = await fetchModelsFromCloud(ownerId);
  statsCompareCache.set(ownerId, Array.isArray(rows) ? rows : []);
  return statsCompareCache.get(ownerId);
}

function buildCodeCountMap(rows) {
  const out = new Map();
  (rows || []).forEach((row) => {
    const code = String(row?.code || '').trim();
    if (!code) return;
    out.set(code, (out.get(code) || 0) + 1);
  });
  return out;
}

function renderComparison(result, isLoading, errorMessage) {
  const cardsEl = document.getElementById('statsCompareCards');
  const listEl = document.getElementById('statsSharedCodesList');
  if (!cardsEl || !listEl) return;

  if (isLoading) {
    cardsEl.innerHTML = `<div class="stats-empty">${escapeHtml(t('statsLoading'))}</div>`;
    listEl.innerHTML = '';
    return;
  }
  if (errorMessage) {
    cardsEl.innerHTML = `<div class="stats-empty">${escapeHtml(`${t('statsError')}: ${errorMessage}`)}</div>`;
    listEl.innerHTML = '';
    return;
  }
  if (!result) {
    cardsEl.innerHTML = `<div class="stats-empty">${escapeHtml(t('statsNoData'))}</div>`;
    listEl.innerHTML = '';
    return;
  }

  const cards = [
    { label: t('statsSharedCodes'), value: result.sharedCodes },
    { label: t('statsSharedPercent'), value: `${result.sharedPercent}%` },
    { label: t('statsOnlyMine'), value: result.onlyMine },
    { label: t('statsOnlyOther'), value: result.onlyOther }
  ];
  renderCards(cardsEl, cards);

  renderList(
    listEl,
    result.topSharedCodes,
    (row) => `
      <div class="stats-list-row">
        <span class="stats-list-key">${escapeHtml(row.code)}</span>
        <span class="stats-list-value">${escapeHtml(`${row.mine}/${row.other}`)}</span>
      </div>
    `,
    t('statsNoSharedCodes')
  );
}

async function refreshComparison() {
  const selectEl = document.getElementById('statsCompareOwner');
  const ownerId = String(selectEl?.value || '').trim();
  if (!ownerId) {
    statsCompareResult = null;
    renderComparison(null, false, '');
    return;
  }

  const reqId = ++statsCompareReqSeq;
  renderComparison(null, true, '');
  try {
    const otherRows = await fetchOwnerRows(ownerId);
    if (reqId !== statsCompareReqSeq) return;

    const mineMap = buildCodeCountMap(statsRows);
    const otherMap = buildCodeCountMap(otherRows);
    const mineCodes = new Set(mineMap.keys());
    const otherCodes = new Set(otherMap.keys());

    const sharedCodes = Array.from(mineCodes).filter((code) => otherCodes.has(code));
    const onlyMine = Array.from(mineCodes).filter((code) => !otherCodes.has(code)).length;
    const onlyOther = Array.from(otherCodes).filter((code) => !mineCodes.has(code)).length;
    const sharedPercent = mineCodes.size > 0 ? Math.round((sharedCodes.length / mineCodes.size) * 100) : 0;

    const topSharedCodes = sharedCodes
      .map((code) => ({
        code,
        mine: mineMap.get(code) || 0,
        other: otherMap.get(code) || 0,
        rank: Math.min(mineMap.get(code) || 0, otherMap.get(code) || 0)
      }))
      .sort((a, b) => b.rank - a.rank || (b.mine + b.other) - (a.mine + a.other) || a.code.localeCompare(b.code))
      .slice(0, 10);

    statsCompareResult = {
      sharedCodes: sharedCodes.length,
      sharedPercent,
      onlyMine,
      onlyOther,
      topSharedCodes
    };
    renderComparison(statsCompareResult, false, '');
  } catch (e) {
    if (reqId !== statsCompareReqSeq) return;
    renderComparison(null, false, e?.message || String(e));
  }
}

function renderStatsModal() {
  statsSummary = collectCatalogStats(statsRows);
  renderOverviewSection();
  renderCollectionSection();
  ensureCompareOwnerSelection();
  renderComparison(statsCompareResult, false, '');
}

async function refreshSimilarSummary(rows) {
  const reqId = ++statsSimilarReqSeq;
  if (typeof fetchSimilarModelsByCodes !== 'function' || typeof getCloudOwnerId !== 'function') {
    statsSimilarMap = new Map();
    statsSimilarSummary = { codesWithSimilar: 0, modelsWithSimilar: 0, totalOtherMatches: 0 };
    renderHeaderMetrics();
    if (isStatsModalOpen()) renderOverviewSection();
    return;
  }
  const ownerId = getCloudOwnerId();
  const hasCloud = typeof isCloudReady === 'function' && isCloudReady();
  if (!hasCloud || !ownerId) {
    statsSimilarMap = new Map();
    statsSimilarSummary = { codesWithSimilar: 0, modelsWithSimilar: 0, totalOtherMatches: 0 };
    renderHeaderMetrics();
    if (isStatsModalOpen()) renderOverviewSection();
    return;
  }
  const codes = Array.from(new Set((rows || []).map((row) => String(row?.code || '').trim()).filter(Boolean)));
  if (!codes.length) {
    statsSimilarMap = new Map();
    statsSimilarSummary = { codesWithSimilar: 0, modelsWithSimilar: 0, totalOtherMatches: 0 };
    renderHeaderMetrics();
    if (isStatsModalOpen()) renderOverviewSection();
    return;
  }

  try {
    const map = await fetchSimilarModelsByCodes(codes, ownerId);
    if (reqId !== statsSimilarReqSeq) return;
    statsSimilarMap = map instanceof Map ? map : new Map();
    statsSimilarSummary = computeSimilarSummary(rows, statsSimilarMap);
  } catch (e) {
    if (reqId !== statsSimilarReqSeq) return;
    statsSimilarMap = new Map();
    statsSimilarSummary = { codesWithSimilar: 0, modelsWithSimilar: 0, totalOtherMatches: 0 };
  }
  renderHeaderMetrics();
  if (isStatsModalOpen()) renderOverviewSection();
}

function openStatsModal() {
  const overlay = document.getElementById('statsModalOverlay');
  if (!overlay) return;
  overlay.classList.add('show');
  renderStatsModal();
  refreshComparison();
}

function closeStatsModal() {
  const overlay = document.getElementById('statsModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('show');
}

function isStatsModalOpen() {
  return Boolean(document.getElementById('statsModalOverlay')?.classList.contains('show'));
}

function onCatalogDataChanged(rows) {
  statsRows = Array.isArray(rows) ? rows : [];
  statsSummary = collectCatalogStats(statsRows);
  statsCompareCache = new Map();
  statsCompareResult = null;
  renderHeaderMetrics();
  refreshSimilarSummary(statsRows);
  if (isStatsModalOpen()) {
    renderStatsModal();
    refreshComparison();
  }
}

function refreshStatsUi() {
  renderHeaderMetrics();
  if (isStatsModalOpen()) {
    renderStatsModal();
    renderComparison(statsCompareResult, false, '');
  }
}

function initStats() {
  const openBtn = document.getElementById('statsBtn');
  const closeBtn = document.getElementById('statsModalClose');
  const overlay = document.getElementById('statsModalOverlay');
  const compareApply = document.getElementById('statsCompareApply');
  const compareSelect = document.getElementById('statsCompareOwner');

  openBtn?.addEventListener('click', openStatsModal);
  closeBtn?.addEventListener('click', closeStatsModal);
  overlay?.addEventListener('click', (e) => {
    if (e.target?.id === 'statsModalOverlay') closeStatsModal();
  });
  compareApply?.addEventListener('click', refreshComparison);
  compareSelect?.addEventListener('change', (e) => {
    const ownerId = String(e.target.value || '').trim();
    setSavedCompareOwnerId(ownerId);
    refreshComparison();
  });

  statsRows = Array.isArray(data) ? data : [];
  statsSummary = collectCatalogStats(statsRows);
  renderHeaderMetrics();
  refreshSimilarSummary(statsRows);
}

window.openStatsModal = openStatsModal;
window.closeStatsModal = closeStatsModal;
window.isStatsModalOpen = isStatsModalOpen;
window.onCatalogDataChanged = onCatalogDataChanged;
window.refreshStatsUi = refreshStatsUi;

initStats();
