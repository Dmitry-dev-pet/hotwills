'use strict';

// ─── Infographic ────────────────────────────────────────────────────────
const INFOGRAPHIC_YEARS = [];
for (let y = 1950; y <= 1999; y++) INFOGRAPHIC_YEARS.push(y);

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
    const pr = popover.getBoundingClientRect();
    if (pr.right > window.innerWidth) popover.style.left = (e.clientX - pr.width - offset) + 'px';
    if (pr.bottom > window.innerHeight) popover.style.top = (e.clientY - pr.height - offset) + 'px';
  });
}

function hideYearPopover() {
  if (popoverHideTimer) clearTimeout(popoverHideTimer);
  popoverHideTimer = setTimeout(() => {
    document.getElementById('infographicPopover')?.classList.remove('show');
    popoverHideTimer = null;
  }, 80);
}

function setGridYearHover(grid, year, on, transpose) {
  if (!grid) return;
  if (!transpose) {
    const col = grid.querySelector(`.infographic-col[data-year="${year}"]`);
    if (col) col.classList.toggle('chart-hover', on);
    return;
  }
  grid.querySelectorAll(`[data-year-cell="${year}"]`).forEach((cell) => {
    cell.classList.toggle('year-hover', on);
  });
}

function applyYearSelectionStyles(grid, chart, transpose) {
  if (!grid || !chart) return;

  if (!transpose) {
    grid.querySelectorAll('.infographic-col').forEach((c) => {
      if (c.classList.contains('infographic-col-names')) return;
      c.classList.toggle('selected', +c.dataset.year === selectedYearColumn);
    });
    chart.querySelectorAll('.infographic-chart-bar').forEach((b) => {
      b.classList.toggle('selected', +b.dataset.year === selectedYearColumn);
    });
    return;
  }

  grid.querySelectorAll('.selected-year').forEach((el) => el.classList.remove('selected-year'));
  chart.querySelectorAll('.infographic-chart-row').forEach((row) => {
    row.classList.toggle('selected', +row.dataset.year === selectedYearColumn);
  });

  if (selectedYearColumn == null) return;
  grid.querySelectorAll(`[data-year-cell="${selectedYearColumn}"]`).forEach((cell) => {
    cell.classList.add('selected-year');
  });
}

function selectYear(year, grid, chart, yearItemsMap, transpose) {
  selectedYearColumn = selectedYearColumn === year ? null : year;
  applyYearSelectionStyles(grid, chart, transpose);
  if (selectedYearColumn) showYearModal(selectedYearColumn, getItemsForYear(selectedYearColumn, yearItemsMap));
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
        else {
          grid.innerHTML = '<div class="gallery-empty"><button type="button" class="empty-load-btn" data-t="loadJson">' + t('loadJson') + '</button></div>';
          grid.querySelector('.empty-load-btn')?.addEventListener('click', () => document.getElementById('fileInput').click());
        }
      })
      .catch(() => {
        grid.innerHTML = '<div class="gallery-empty"><button type="button" class="empty-load-btn" data-t="loadJson">' + t('loadJson') + '</button></div>';
        grid.querySelector('.empty-load-btn')?.addEventListener('click', () => document.getElementById('fileInput').click());
      });
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

  const transpose = false;
  grid.classList.toggle('transposed', transpose);
  chart.classList.toggle('transposed', transpose);

  const yearItemsMap = buildYearItemsMap(models);
  const chartColors = getChartColors();
  const counts = INFOGRAPHIC_YEARS.map((y) => getItemsForYear(y, yearItemsMap).length);
  const maxCount = Math.max(1, ...counts);

  if (!transpose) {
    const colNames = document.createElement('div');
    colNames.className = 'infographic-col infographic-col-names';
    colNames.innerHTML = '<div class="infographic-cell model-name infographic-col-header">' + t('infographicModelCol') + '</div>';
    models.forEach((item) => {
      const nameCell = document.createElement('div');
      nameCell.className = 'infographic-cell model-name';
      nameCell.textContent = (item.name || '—').slice(0, 25);
      nameCell.title = item.name || '';
      colNames.appendChild(nameCell);
    });
    grid.appendChild(colNames);

    INFOGRAPHIC_YEARS.forEach((year) => {
      const col = document.createElement('div');
      col.className = 'infographic-col';
      col.dataset.year = year;
      col.style.cursor = 'pointer';

      const headerCell = document.createElement('div');
      headerCell.className = 'infographic-cell year-header';
      headerCell.textContent = String(year).slice(2);
      col.appendChild(headerCell);

      const itemsForYear = getItemsForYear(year, yearItemsMap);
      models.forEach((item) => {
        const inRange = itemsForYear.includes(item);
        const cell = document.createElement('div');
        cell.className = 'infographic-cell' + (inRange ? ' filled' : '');
        col.appendChild(cell);
      });

      col.addEventListener('mouseenter', (e) => {
        if (popoverHideTimer) { clearTimeout(popoverHideTimer); popoverHideTimer = null; }
        showYearPopover(year, e, yearItemsMap);
      });
      col.addEventListener('mousemove', (e) => {
        if (document.getElementById('infographicPopover').classList.contains('show')) {
          showYearPopover(year, e, yearItemsMap);
        }
      });
      col.addEventListener('mouseleave', hideYearPopover);
      col.addEventListener('click', () => selectYear(year, grid, chart, yearItemsMap, false));
      grid.appendChild(col);
    });

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
      const k = maxCount > 0 ? count / maxCount : 0;
      const r = Math.round(rMin + k * (rMax - rMin));
      const g = Math.round(gMin + k * (gMax - gMin));
      const b = Math.round(bMin + k * (bMax - bMin));
      const barColor = `rgb(${r},${g},${b})`;

      const cell = document.createElement('div');
      cell.className = 'infographic-chart-cell';

      const bar = document.createElement('div');
      bar.className = 'infographic-chart-bar';
      bar.dataset.year = year;
      bar.style.height = (count * 8) + 'px';
      bar.style.backgroundColor = barColor;
      bar.title = count + '';
      cell.appendChild(bar);
      barsRow.appendChild(cell);

      const label = document.createElement('div');
      label.className = 'infographic-chart-value';
      label.textContent = count === 0 ? '' : count;
      labelsRow.appendChild(label);

      bar.addEventListener('mouseenter', (e) => {
        if (popoverHideTimer) { clearTimeout(popoverHideTimer); popoverHideTimer = null; }
        showYearPopover(year, e, yearItemsMap);
        setGridYearHover(grid, year, true, false);
      });
      bar.addEventListener('mousemove', (e) => {
        if (document.getElementById('infographicPopover').classList.contains('show')) {
          showYearPopover(year, e, yearItemsMap);
        }
      });
      bar.addEventListener('mouseleave', () => {
        hideYearPopover();
        setGridYearHover(grid, year, false, false);
      });
      bar.addEventListener('click', () => selectYear(year, grid, chart, yearItemsMap, false));
    });

    chart.appendChild(chartLeft);
    chartRight.appendChild(barsRow);
    chartRight.appendChild(labelsRow);
    chart.appendChild(chartRight);
    applyYearSelectionStyles(grid, chart, false);
    return;
  }

  const colYears = document.createElement('div');
  colYears.className = 'infographic-col infographic-col-names';
  colYears.innerHTML = '<div class="infographic-cell year-header infographic-col-header">' + t('infographicYearCol') + '</div>';
  INFOGRAPHIC_YEARS.forEach((year) => {
    const yearCell = document.createElement('div');
    yearCell.className = 'infographic-cell year-header';
    yearCell.textContent = String(year).slice(2);
    yearCell.title = String(year);
    yearCell.dataset.yearCell = year;
    yearCell.addEventListener('mouseenter', (e) => {
      if (popoverHideTimer) { clearTimeout(popoverHideTimer); popoverHideTimer = null; }
      showYearPopover(year, e, yearItemsMap);
      setGridYearHover(grid, year, true, true);
    });
    yearCell.addEventListener('mousemove', (e) => {
      if (document.getElementById('infographicPopover').classList.contains('show')) {
        showYearPopover(year, e, yearItemsMap);
      }
    });
    yearCell.addEventListener('mouseleave', () => {
      hideYearPopover();
      setGridYearHover(grid, year, false, true);
    });
    yearCell.addEventListener('click', () => selectYear(year, grid, chart, yearItemsMap, true));
    colYears.appendChild(yearCell);
  });
  grid.appendChild(colYears);

  const rangeCache = new Map();
  const getModelRange = (item) => {
    const key = item.year || '';
    if (!rangeCache.has(key)) rangeCache.set(key, parseYearRange(key));
    return rangeCache.get(key);
  };

  models.forEach((item) => {
    const col = document.createElement('div');
    col.className = 'infographic-col';
    col.style.cursor = 'pointer';

    const headerCell = document.createElement('div');
    headerCell.className = 'infographic-cell model-name';
    headerCell.textContent = (item.name || '—').slice(0, 18);
    headerCell.title = item.name || '';
    col.appendChild(headerCell);

    const range = getModelRange(item);
    INFOGRAPHIC_YEARS.forEach((year) => {
      const cell = document.createElement('div');
      const inRange = isYearInRange(year, range);
      cell.className = 'infographic-cell' + (inRange ? ' filled' : '');
      cell.dataset.yearCell = year;

      cell.addEventListener('mouseenter', (e) => {
        if (popoverHideTimer) { clearTimeout(popoverHideTimer); popoverHideTimer = null; }
        showYearPopover(year, e, yearItemsMap);
        setGridYearHover(grid, year, true, true);
      });
      cell.addEventListener('mousemove', (e) => {
        if (document.getElementById('infographicPopover').classList.contains('show')) {
          showYearPopover(year, e, yearItemsMap);
        }
      });
      cell.addEventListener('mouseleave', () => {
        hideYearPopover();
        setGridYearHover(grid, year, false, true);
      });
      cell.addEventListener('click', () => selectYear(year, grid, chart, yearItemsMap, true));

      col.appendChild(cell);
    });

    grid.appendChild(col);
  });

  const chartTop = document.createElement('div');
  chartTop.className = 'infographic-chart-top';
  chartTop.textContent = t('infographicChartLabel');
  chart.appendChild(chartTop);

  const rowsWrap = document.createElement('div');
  rowsWrap.className = 'infographic-chart-rows';

  const [rMin, gMin, bMin] = chartColors.min;
  const [rMax, gMax, bMax] = chartColors.max;

  INFOGRAPHIC_YEARS.forEach((year, i) => {
    const count = counts[i];
    const k = maxCount > 0 ? count / maxCount : 0;
    const r = Math.round(rMin + k * (rMax - rMin));
    const g = Math.round(gMin + k * (gMax - gMin));
    const b = Math.round(bMin + k * (bMax - bMin));
    const barColor = `rgb(${r},${g},${b})`;

    const row = document.createElement('div');
    row.className = 'infographic-chart-row';
    row.dataset.year = year;

    const yearEl = document.createElement('div');
    yearEl.className = 'infographic-chart-row-year';
    yearEl.textContent = String(year).slice(2);

    const track = document.createElement('div');
    track.className = 'infographic-chart-row-track';
    const bar = document.createElement('div');
    bar.className = 'infographic-chart-row-bar';
    bar.style.backgroundColor = barColor;
    bar.style.width = `${Math.round((k || 0) * 100)}%`;
    track.appendChild(bar);

    const value = document.createElement('div');
    value.className = 'infographic-chart-row-value';
    value.textContent = count === 0 ? '' : String(count);

    row.appendChild(yearEl);
    row.appendChild(track);
    row.appendChild(value);

    row.addEventListener('mouseenter', (e) => {
      if (popoverHideTimer) { clearTimeout(popoverHideTimer); popoverHideTimer = null; }
      showYearPopover(year, e, yearItemsMap);
      setGridYearHover(grid, year, true, true);
    });
    row.addEventListener('mousemove', (e) => {
      if (document.getElementById('infographicPopover').classList.contains('show')) {
        showYearPopover(year, e, yearItemsMap);
      }
    });
    row.addEventListener('mouseleave', () => {
      hideYearPopover();
      setGridYearHover(grid, year, false, true);
    });
    row.addEventListener('click', () => selectYear(year, grid, chart, yearItemsMap, true));

    rowsWrap.appendChild(row);
  });

  chart.appendChild(rowsWrap);
  applyYearSelectionStyles(grid, chart, true);
}

function showYearModal(year, items) {
  if (!items) {
    items = sortedData
      .filter((item) => {
        const range = parseYearRange(item.year || '');
        return range && isYearInRange(year, range);
      })
      .sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
  }
  document.getElementById('yearModalTitle').textContent = t('yearModalTitle', { year });
  const gallery = document.getElementById('yearModalGallery');
  gallery.innerHTML = '';
  items.forEach((item) => {
    const imgFile = item.image || '';
    const fav = isFavorite(imgFile);
    const card = document.createElement('div');
    card.className = 'gallery-card';
    const imgSrc = imgPath(item.image || '');
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
    gallery.appendChild(card);
  });
  document.getElementById('yearModalOverlay').classList.add('show');
}

function closeYearModal() {
  document.getElementById('yearModalOverlay').classList.remove('show');
  selectedYearColumn = null;
  document.querySelectorAll('.infographic-col').forEach((c) => c.classList.remove('selected'));
  document.querySelectorAll('.selected-year').forEach((c) => c.classList.remove('selected-year'));
  document.querySelectorAll('.infographic-chart-bar').forEach((b) => b.classList.remove('selected'));
  document.querySelectorAll('.infographic-chart-row').forEach((r) => r.classList.remove('selected'));
}
