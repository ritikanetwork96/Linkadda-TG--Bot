import { API } from './api.js';
import { Toast } from './toast.js';

let currentMediaPage = 1;
let totalMediaPages = 1;
const mediaLimit = 24;

export async function loadMediaGallery(page = 1) {
  const container = document.getElementById('media-gallery-container');
  const typeFilter = document.getElementById('media-type-filter').value;
  const search = document.getElementById('media-search').value.trim();

  container.innerHTML = '<div class="p-6 text-center" style="grid-column: 1 / -1;"><div class="spinner"></div><p>Loading media...</p></div>';
  
  try {
    let url = `/content?type=${encodeURIComponent(typeFilter)}&page=${page}&limit=${mediaLimit}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    
    const res = await API.get(url);
    if (res.status === 'success') {
      currentMediaPage = res.pagination.page;
      totalMediaPages = res.pagination.pages;
      
      renderMediaGallery(res.content);
      updateMediaPagination();
    } else {
      throw new Error(res.message || 'Failed to load media');
    }
  } catch (err) {
    container.innerHTML = `<div class="p-6 text-center text-red" style="grid-column: 1 / -1;">Error: ${err.message}</div>`;
    Toast.show('Failed to load media gallery', 'error');
  }
}

function getCleanBucketName(bucket) {
  if (!bucket) return 'linkadda-bot';
  let clean = bucket.replace(/^https?:\/\//i, '');
  clean = clean.split('.')[0];
  return clean;
}

function renderMediaGallery(items) {
  const container = document.getElementById('media-gallery-container');
  
  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 4rem 1rem; text-align: center; color: var(--text-secondary);">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width: 64px; height: 64px; opacity: 0.5; margin-bottom: 1rem;"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
        <h3>No Media Found</h3>
        <p>You haven't uploaded any photos or videos yet, or they don't match your search.</p>
      </div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    // Generate S3 URL if storageKey exists, otherwise fallback to telegram url or placeholder
    const mediaUrl = item.downloadUrl || (item.storageKey ? `https://${getCleanBucketName(item.storageBucket)}.s3.filebase.com/${item.storageKey}` : '');
    
    let thumbHtml = '';
    if (item.type === 'photo') {
      thumbHtml = mediaUrl 
        ? `<img src="${mediaUrl}" alt="${item.title}" loading="lazy">` 
        : `<div class="media-icon"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></div>`;
    } else if (item.type === 'video') {
      thumbHtml = mediaUrl 
        ? `<video src="${mediaUrl}" preload="metadata" muted></video>` 
        : `<div class="media-icon"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg></div>`;
      thumbHtml += `<div class="video-badge">VIDEO</div>`;
    }

    const sizeStr = item.fileSize ? (item.fileSize / 1024 / 1024).toFixed(1) + ' MB' : '';

    return `
      <div class="media-card">
        <div class="media-thumbnail">
          ${thumbHtml}
        </div>
        <div class="media-info">
          <div class="media-title" title="${item.title}">${item.title}</div>
          <div class="media-meta">
            <span>${new Date(item.createdAt).toLocaleDateString()}</span>
            <span>${sizeStr}</span>
          </div>
          <div class="media-actions">
            ${mediaUrl ? `<a href="${mediaUrl}" target="_blank" class="btn btn-outline" style="text-decoration:none; text-align:center;">Preview</a>` : ''}
            <button class="btn btn-outline btn-copy-link" data-url="${mediaUrl}">Copy URL</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Bind copy events
  container.querySelectorAll('.btn-copy-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      if (!url) return Toast.show('URL not available', 'error');
      navigator.clipboard.writeText(url).then(() => {
        Toast.show('Media URL copied!', 'success');
      });
    });
  });
}

function updateMediaPagination() {
  const prevBtn = document.getElementById('btn-media-prev');
  const nextBtn = document.getElementById('btn-media-next');
  const pageInfo = document.getElementById('media-page-info');
  
  if (!prevBtn || !nextBtn || !pageInfo) return;

  pageInfo.textContent = `Page ${currentMediaPage} of ${totalMediaPages || 1}`;
  prevBtn.disabled = currentMediaPage <= 1;
  nextBtn.disabled = currentMediaPage >= totalMediaPages;
}

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('media-search');
  const typeFilter = document.getElementById('media-type-filter');
  const refreshBtn = document.getElementById('btn-refresh-media');
  const prevBtn = document.getElementById('btn-media-prev');
  const nextBtn = document.getElementById('btn-media-next');

  let debounceTimer;

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadMediaGallery(1), 500);
    });
  }

  if (typeFilter) {
    typeFilter.addEventListener('change', () => loadMediaGallery(1));
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadMediaGallery(1));
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentMediaPage > 1) loadMediaGallery(currentMediaPage - 1);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentMediaPage < totalMediaPages) loadMediaGallery(currentMediaPage + 1);
    });
  }
  
  // Custom event to trigger load when tab is opened
  window.addEventListener('load-media', () => {
    loadMediaGallery(currentMediaPage);
  });
});
