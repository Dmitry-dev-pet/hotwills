'use strict';

// ─── Infographic ────────────────────────────────────────────────────────
const INFOGRAPHIC_YEARS = Array.from({ length: 50 }, (_, i) => 1950 + i);

let selectedYearColumn = null;
let popoverHideTimer = null;

function buildYearItemsMap(models) {
  const map = new Map();
  const rangeCache = new Map();
  const getRange = (item) => {
    const key = item.year || '';
    if (!rangeCache.has(key)) rangeCache.set(key, parseYearRange(key));
    return rangeCache.get(key);
  };

  INFOGRAPHIC_YEARS.forEach((year) => {
    const items = models
      .filter((item) => isYearInRange(year, getRange(item)))
      .sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
    map.set(year, items);
  });

  return map;
}

function getItemsForYear(year, yearItemsMap) {
  return yearItemsMap ? yearItemsMap.get(year) || [] : [];
}

function getChartColors() {
  const minStr = getComputedStyle(document.documentElement).getPropertyValue('--chart-color-min').trim() || '173, 216, 230';
  const maxStr = getComputedStyle(document.documentElement).getPropertyValue('--chart-color-max').trim() || '0, 102, 204';
  return {
    min: minStr.split(',').map((s) => parseInt(s.trim(), 10)),
    max: maxStr.split(',').map((s) => parseInt(s.trim(), 10))
  };
}

function showYearPopover(year, e, yearItemsMap) {
  const items = getItemsForYear(year, yearItemsMap);
  if (items.length === 0) return;

  const popover = document.getElementById('infographicPopover');
  popover.innerHTML = items.map((item) =>
    `<div class="infographic-popover-row"><span class="infographic-popover-code">${escapeHtml(item.code || '')}</span> ${escapeHtml(item.name || '—')}</div>`
  ).join('');

  const offset = 12;
  popover.style.left = (e.clientX + offset) + 'px';
  popover.style.top = (e.clientY + offset) + 'px';
  popover.classList.add('show');

  requestAnimationFrame(() => {
    const rect = popover.getBoundingClientRect();
    if (rect.right > window.innerWidth) popover.style.left = (e.clientX - rect.width - offset) + 'px';
    if (rect.bottom > window.innerHeight) popover.style.top = (e.clientY - rect.height - offset) + 'px';
  });
}

function hideYearPopover() {
  if (popoverHideTimer) clearTimeout(popoverHideTimer);
  popoverHideTimer = setTimeout(() => {
    document.getElementById('infographicPopover')?.classList.remove('show');
    popoverHideTimer = null;
  }, 80);
}

function setGridYearHover(grid, year, on) {
  if (!grid) return;
  const col = grid.querySelector(`.infographic-col[data-year="${year}"]`);
  if (col) col.classList.toggle('chart-hover', on);
}

function applyYearSelectionStyles(grid, chart) {
  if (!grid || !chart) return;

  grid.querySelectorAll('.infographic-col').forEach((col) => {
    if (col.classList.contains('infographic-col-names')) return;
    col.classList.toggle('selected', +col.dataset.year === selectedYearColumn);
  });

  chart.querySelectorAll('.infographic-chart-bar').forEach((bar) => {
    bar.classList.toggle('selected', +bar.dataset.year === selectedYearColumn);
  });
}

function selectYear(year, grid, chart, yearItemsMap) {
  selectedYearColumn = selectedYearColumn === year ? null : year;
  applyYearSelectionStyles(grid, chart);
  if (selectedYearColumn) {
    showYearModal(selectedYearColumn, getItemsForYear(selectedYearColumn, yearItemsMap));
  }
}

function bindYearInteractions(target, year, grid, chart, yearItemsMap, onEnter, onLeave) {
  target.addEventListener('mouseenter', (e) => {
    if (popoverHideTimer) {
      clearTimeout(popoverHideTimer);
      popoverHideTimer = null;
    }
    showYearPopover(year, e, yearItemsMap);
    if (typeof onEnter === 'function') onEnter();
  });

  target.addEventListener('mousemove', (e) => {
    const popover = document.getElementById('infographicPopover');
    if (popover.classList.contains('show')) {
      showYearPopover(year, e, yearItemsMap);
    }
  });

  target.addEventListener('mouseleave', () => {
    hideYearPopover();
    if (typeof onLeave === 'function') onLeave();
  });

  target.addEventListener('click', () => selectYear(year, grid, chart, yearItemsMap));
}

function showEmptyLoadState(grid) {
  grid.innerHTML = '<div class="gallery-empty"><button type="button" class="empty-load-btn" data-t="loadJson">' + t('loadJson') + '</button></div>';
  grid.querySelector('.empty-load-btn')?.addEventListener('click', () => document.getElementById('fileInput').click());
}

function renderInfographicGrid(grid, chart, models, yearItemsMap) {
  const namesCol = document.createElement('div');
  namesCol.className = 'infographic-col infographic-col-names';
  namesCol.innerHTML = '<div class="infographic-cell model-name infographic-col-header">' + t('infographicModelCol') + '</div>';

  models.forEach((item) => {
    const nameCell = document.createElement('div');
    nameCell.className = 'infographic-cell model-name';
    nameCell.textContent = (item.name || '—').slice(0, 25);
    nameCell.title = item.name || '';
    namesCol.appendChild(nameCell);
  });

  grid.appendChild(namesCol);

  INFOGRAPHIC_YEARS.forEach((year) => {
    const col = document.createElement('div');
    col.className = 'infographic-col';
    col.dataset.year = year;
    col.style.cursor = 'pointer';

    const headerCell = document.createElement('div');
    headerCell.className = 'infographic-cell year-header';
    headerCell.textContent = String(year).slice(2);
    col.appendChild(headerCell);

    const yearItems = getItemsForYear(year, yearItemsMap);
    const yearItemsSet = new Set(yearItems);

    models.forEach((item) => {
      const cell = document.createElement('div');
      cell.className = 'infographic-cell' + (yearItemsSet.has(item) ? ' filled' : '');
      col.appendChild(cell);
    });

    bindYearInteractions(
      col,
      year,
      grid,
      chart,
      yearItemsMap
    );

    grid.appendChild(col);
  });
}

function renderInfographicChart(chart, grid, yearItemsMap, counts, maxCount, chartColors) {
  const chartLeft = document.createElement('div');
  chartLeft.className = 'infographic-chart-left';
  chartLeft.textContent = t('infographicChartLabel');

  const chartRight = document.createElement('div');
  chartRight.className = 'infographic-chart-right';

  const barsRow = document.createElement('div');
  barsRow.className = 'infographic-chart-bars';

  const labelsRow = document.createElement('div');
  labelsRow.className = 'infographic-chart-labels';

  const [rMin, gMin, bMin] = chartColors.min;
  const [rMax, gMax, bMax] = chartColors.max;

  INFOGRAPHIC_YEARS.forEach((year, i) => {
    const count = counts[i];
    const ratio = maxCount > 0 ? count / maxCount : 0;
    const r = Math.round(rMin + ratio * (rMax - rMin));
    const g = Math.round(gMin + ratio * (gMax - gMin));
    const b = Math.round(bMin + ratio * (bMax - bMin));
    const barColor = `rgb(${r},${g},${b})`;

    const chartCell = document.createElement('div');
    chartCell.className = 'infographic-chart-cell';

    const bar = document.createElement('div');
    bar.className = 'infographic-chart-bar';
    bar.dataset.year = year;
    bar.style.height = (count * 8) + 'px';
    bar.style.backgroundColor = barColor;
    bar.title = String(count);
    chartCell.appendChild(bar);
    barsRow.appendChild(chartCell);

    const valueCell = document.createElement('div');
    valueCell.className = 'infographic-chart-value';
    valueCell.textContent = count === 0 ? '' : String(count);
    labelsRow.appendChild(valueCell);

    bindYearInteractions(
      bar,
      year,
      grid,
      chart,
      yearItemsMap,
      () => setGridYearHover(grid, year, true),
      () => setGridYearHover(grid, year, false)
    );
  });

  chart.appendChild(chartLeft);
  chartRight.appendChild(barsRow);
  chartRight.appendChild(labelsRow);
  chart.appendChild(chartRight);
}

function renderInfographic() {
  const grid = document.getElementById('infographicGrid');
  const chart = document.getElementById('infographicChart');
  grid.innerHTML = '';
  chart.innerHTML = '';

  if (data.length === 0) {
    tryLoadDataJson()
      .then((arr) => {
        if (arr.length > 0) loadData(arr);
        else showEmptyLoadState(grid);
      })
      .catch(() => showEmptyLoadState(grid));

    chart.style.display = 'none';
    return;
  }

  chart.style.display = '';

  const models = getFilteredGalleryData();
  if (models.length === 0) {
    grid.innerHTML = '<p class="gallery-empty">' + (favoritesFilter ? t('noFavorites') : t('searchNoResults')) + '</p>';
    chart.style.display = 'none';
    return;
  }

  grid.classList.remove('transposed');
  chart.classList.remove('transposed');

  const yearItemsMap = buildYearItemsMap(models);
  const chartColors = getChartColors();
  const counts = INFOGRAPHIC_YEARS.map((year) => getItemsForYear(year, yearItemsMap).length);
  const maxCount = Math.max(1, ...counts);

  renderInfographicGrid(grid, chart, models, yearItemsMap);
  renderInfographicChart(chart, grid, yearItemsMap, counts, maxCount, chartColors);
  applyYearSelectionStyles(grid, chart);
}

function createYearModalCard(item) {
  const imgFile = item.image || '';
  const fav = isFavorite(imgFile);
  const imgSrc = imgPath(item.image || '');

  const card = document.createElement('div');
  card.className = 'gallery-card';
  card.innerHTML = `
    <button type="button" class="card-fav ${fav ? 'active' : ''}" data-image="${escapeHtml(imgFile)}" title="${t('favorites')}" aria-label="${t('favorites')}">${fav ? '♥' : '♡'}</button>
    <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(item.name || '')}" loading="lazy">
    <div class="gallery-card-body">
      <div class="gallery-card-code">${escapeHtml(item.code || '')}</div>
      <div class="gallery-card-name">${escapeHtml(item.name || '—')}</div>
      <div class="gallery-card-meta">${escapeHtml(item.year || '')}</div>
    </div>
    ${item.link ? `<div class="gallery-card-link"><a href="${escapeHtml(item.link)}" target="_blank" rel="noopener" title="${t('link')}">↗</a></div>` : ''}
  `;

  card.querySelector('.card-fav').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(imgFile);
    card.querySelector('.card-fav').className = 'card-fav ' + (isFavorite(imgFile) ? 'active' : '');
    card.querySelector('.card-fav').textContent = isFavorite(imgFile) ? '♥' : '♡';
  });

  card.addEventListener('click', (e) => {
    if (!e.target.closest('a') && !e.target.closest('.card-fav')) {
      const idx = sortedData.indexOf(item);
      closeYearModal();
      showGalleryDetail(idx >= 0 ? idx : 0);
    }
  });

  return card;
}

function showYearModal(year, items) {
  let yearItems = items;
  if (!yearItems) {
    yearItems = sortedData
      .filter((item) => {
        const range = parseYearRange(item.year || '');
        return range && isYearInRange(year, range);
      })
      .sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
  }

  document.getElementById('yearModalTitle').textContent = t('yearModalTitle', { year });
  const gallery = document.getElementById('yearModalGallery');
  gallery.innerHTML = '';
  yearItems.forEach((item) => gallery.appendChild(createYearModalCard(item)));
  document.getElementById('yearModalOverlay').classList.add('show');
}

function closeYearModal() {
  document.getElementById('yearModalOverlay').classList.remove('show');
  selectedYearColumn = null;
  document.querySelectorAll('.infographic-col').forEach((col) => col.classList.remove('selected'));
  document.querySelectorAll('.infographic-chart-bar').forEach((bar) => bar.classList.remove('selected'));
}
