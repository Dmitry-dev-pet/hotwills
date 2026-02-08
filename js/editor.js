'use strict';

// ─── Editor ─────────────────────────────────────────────────────────────
function updatePreviewImg(tr, src) {
  const img = tr?.querySelector('.preview img');
  const noImg = tr?.querySelector('.preview .no-img');
  if (!img) return;
  img.src = imgPath(src);
  img.style.display = '';
  noImg?.classList.remove('show');
  img.onerror = () => { img.style.display = 'none'; noImg?.classList.add('show'); };
}

function syncData(e) {
  const input = e.target;
  const i = +input.dataset.i;
  const key = input.dataset.key;
  if (data[i]) data[i][key] = input.value;
  if (key === 'image') updatePreviewImg(input.closest('tr'), input.value);
}

function applyEditorSearchFilter() {
  const rows = document.querySelectorAll('#tbody tr[data-i]');
  rows.forEach(tr => {
    const i = +tr.dataset.i;
    const row = data[i];
    tr.classList.toggle('search-hidden', searchQuery && row && !matchesSearch(row, searchQuery));
  });
}

function collectFromDOM() {
  const rows = document.querySelectorAll('#tbody tr');
  return Array.from(rows)
    .filter(tr => tr.querySelector('input[data-key]'))
    .map(tr => {
      const obj = {};
      CONFIG.ROW_KEYS.forEach(k => {
        const inp = tr.querySelector(`input[data-key="${k}"]`);
        obj[k] = inp ? inp.value : '';
      });
      return obj;
    });
}

function toJSON() {
  return JSON.stringify(collectFromDOM(), null, 2);
}

function renderEditor() {
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  if (typeof isCloudReadOnlyView === 'function' && isCloudReadOnlyView()) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">' + t('readOnlyEditorDisabled') + '</td></tr>';
    return;
  }

  if (data.length === 0) {
    tryLoadDataJson()
      .then(arr => {
        if (arr.length > 0) loadData(arr);
        else {
          tbody.innerHTML = '<tr><td colspan="6" class="table-empty"><button type="button" class="empty-load-btn" data-t="loadFolder">' + t('loadFolder') + '</button></td></tr>';
          tbody.querySelector('.empty-load-btn')?.addEventListener('click', () => document.getElementById('folderInput').click());
        }
      })
      .catch(() => {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty"><button type="button" class="empty-load-btn" data-t="loadFolder">' + t('loadFolder') + '</button></td></tr>';
        tbody.querySelector('.empty-load-btn')?.addEventListener('click', () => document.getElementById('folderInput').click());
      });
    return;
  }

  data.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.dataset.i = i;
    tr.innerHTML = `
      <td class="preview">
        <img src="${imgPath(row.image)}" alt="" loading="lazy">
        <span class="no-img">${t('noImage')}</span>
      </td>
      <td><input type="text" data-i="${i}" data-key="name" value="${escapeHtml(row.name || '')}" placeholder="${t('modelNamePlaceholder')}"></td>
      <td><input type="text" data-i="${i}" data-key="year" value="${escapeHtml(row.year || '')}" placeholder="${t('yearPlaceholder')}"></td>
      <td><input type="text" data-i="${i}" data-key="code" value="${escapeHtml(row.code || '')}" placeholder="${t('codePlaceholder')}"></td>
      <td><input type="text" data-i="${i}" data-key="image" value="${escapeHtml(row.image || '')}" placeholder="${t('imagePlaceholder')}"></td>
      <td><input type="text" data-i="${i}" data-key="link" value="${escapeHtml(row.link || '')}" placeholder="${t('linkPlaceholder')}"></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.preview img').forEach(img => {
    img.onerror = () => {
      img.style.display = 'none';
      img.nextElementSibling?.classList.add('show');
    };
  });

  tbody.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', syncData);
    input.addEventListener('change', (e) => {
      if (e.target.dataset.key === 'image') updatePreviewImg(e.target.closest('tr'), e.target.value);
    });
  });
  applyEditorSearchFilter();
}
