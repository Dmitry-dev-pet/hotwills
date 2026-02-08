'use strict';

// ─── Gallery ────────────────────────────────────────────────────────────
let lazyGalleryObserver = null;
let modalForcedFromNonGallery = false;

function observeLazyGalleryImages() {
  const container = document.querySelector('.gallery-container');
  const imgs = document.querySelectorAll('.gallery-img-lazy');
  if (!container || imgs.length === 0) return;
  if (lazyGalleryObserver) lazyGalleryObserver.disconnect();
  lazyGalleryObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      const src = img.dataset.src;
      if (src) {
        img.src = src;
        img.removeAttribute('data-src');
        img.classList.remove('gallery-img-lazy');
        lazyGalleryObserver?.unobserve(img);
      }
    });
  }, { root: container, rootMargin: '100px', threshold: 0.01 });
  imgs.forEach((img) => lazyGalleryObserver.observe(img));
}

function renderGallery() {
  const gallery = document.getElementById('gallery');
  gallery.innerHTML = '';
  const filtered = getFilteredGalleryData();
  if (filtered.length === 0) {
    if (sortedData.length === 0) {
      tryLoadDataJson()
        .then(arr => { if (arr.length > 0) loadData(arr); else showEmptyWithLoadButton(gallery, true); })
        .catch(() => showEmptyWithLoadButton(gallery, true));
    } else {
      gallery.innerHTML = '<p class="gallery-empty">' + (favoritesFilter ? t('noFavorites') : t('searchNoResults')) + '</p>';
    }
    return;
  }
  filtered.forEach((item) => {
    const imgFile = item.image || '';
    const fav = isFavorite(imgFile);
    const card = document.createElement('div');
    card.className = 'gallery-card';
    const imgSrc = imgPath(item.image || '');
    card.innerHTML = `
      <button type="button" class="card-fav ${fav ? 'active' : ''}" data-image="${escapeHtml(imgFile)}" title="${t('favorites')}" aria-label="${t('favorites')}">${fav ? '♥' : '♡'}</button>
      <img class="gallery-img-lazy" data-src="${escapeHtml(imgSrc)}" alt="${escapeHtml(item.name || '')}">
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
      if (favoritesFilter) {
        renderGallery();
      } else {
        const btn = e.target.closest('.gallery-card')?.querySelector('.card-fav');
        if (btn) {
          btn.className = 'card-fav ' + (isFavorite(imgFile) ? 'active' : '');
          btn.textContent = isFavorite(imgFile) ? '♥' : '♡';
        }
      }
    });
    card.addEventListener('click', (e) => {
      if (!e.target.closest('a') && !e.target.closest('.card-fav')) {
        const idx = sortedData.indexOf(item);
        showGalleryDetail(idx >= 0 ? idx : 0);
      }
    });
    gallery.appendChild(card);
  });
  observeLazyGalleryImages();
}

function showGalleryDetail(index) {
  if (sortedData.length === 0) return;
  const viewGallery = document.getElementById('viewGallery');
  if (viewGallery && currentMode !== 'gallery' && viewGallery.classList.contains('hidden')) {
    viewGallery.classList.remove('hidden');
    modalForcedFromNonGallery = true;
  } else {
    modalForcedFromNonGallery = false;
  }

  modalIndex = ((index % sortedData.length) + sortedData.length) % sortedData.length;
  const item = sortedData[modalIndex];
  const content = document.getElementById('modalContent');
  document.getElementById('modalTitle').textContent = item.name || '—';
  content.innerHTML = `
    <div class="modal-photo-wrap">
      <img class="modal-photo" src="${imgPath(item.image || '')}" alt="${escapeHtml(item.name || '')}">
    </div>
    <div class="modal-data">
      <dl class="modal-info">
      <dt>${t('code')}</dt>
      <dd>${escapeHtml(item.code || '—')}</dd>
      <dt>${t('year')}</dt>
      <dd>${escapeHtml(item.year || '—')}</dd>
      <dt>${t('file')}</dt>
      <dd>${escapeHtml(item.image || '—')}</dd>
      ${item.link ? `<dt>${t('link')}</dt><dd><a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">${t('linkWord')}</a></dd>` : ''}
      </dl>
    </div>
  `;
  document.getElementById('modalOverlay').classList.add('show');
  const navHidden = sortedData.length <= 1 ? ' modal-nav-hidden' : '';
  document.getElementById('modalPrev').className = 'modal-nav modal-nav-left' + navHidden;
  document.getElementById('modalNext').className = 'modal-nav modal-nav-right' + navHidden;
}

function modalPrev() {
  if (sortedData.length <= 1) return;
  modalIndex = (modalIndex - 1 + sortedData.length) % sortedData.length;
  showGalleryDetail(modalIndex);
}

function modalNext() {
  if (sortedData.length <= 1) return;
  modalIndex = (modalIndex + 1) % sortedData.length;
  showGalleryDetail(modalIndex);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
  if (modalForcedFromNonGallery && currentMode !== 'gallery') {
    document.getElementById('viewGallery').classList.add('hidden');
  }
  modalForcedFromNonGallery = false;
}
