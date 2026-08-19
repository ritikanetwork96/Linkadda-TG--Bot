import { API } from './api.js';
import { Toast } from './toast.js';
import { Confirm } from './confirm.js';

let currentPage = 1;
let categoriesList = [];

window.addEventListener('load-content', async () => {
  await loadCategoriesOptions();
  await loadContentList();
});

async function loadCategoriesOptions() {
  try {
    const response = await API.get('/categories');
    if (response.status === 'success') {
      categoriesList = response.categories;
      const filterCat = document.getElementById('content-filter-category');
      const formCat   = document.getElementById('content-category');
      const bulkCat   = document.getElementById('bulk-category-select');
      const opts = categoriesList.map(c => `<option value="${c._id}">${escapeHTML(c.name)}</option>`).join('');
      if (filterCat) filterCat.innerHTML = '<option value="">All Categories</option>' + opts;
      if (formCat)   formCat.innerHTML   = '<option value="">No Category</option>' + opts;
      if (bulkCat)   bulkCat.innerHTML   = opts;
    }
  } catch (err) {
    console.error('Failed to load categories:', err.message);
  }
}

async function loadContentList() {
  const tableBody = document.querySelector('#content-table tbody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-dim" style="padding:1.5rem">
    <div class="spinner" style="margin:0 auto 0.5rem"></div>Loading content...
  </td></tr>`;

  const search     = document.getElementById('content-search')?.value.trim();
  const categoryId = document.getElementById('content-filter-category')?.value;
  const type       = document.getElementById('content-filter-type')?.value;
  const status     = document.getElementById('content-filter-status')?.value;
  const isFeatured = document.getElementById('content-filter-featured')?.value;
  const sort       = document.getElementById('content-filter-sort')?.value;

  const q = new URLSearchParams({ page: currentPage, limit: 10 });
  if (search)     q.set('search', search);
  if (categoryId) q.set('categoryId', categoryId);
  if (type)       q.set('type', type);
  if (status)     q.set('status', status);
  if (isFeatured) q.set('isFeatured', isFeatured);
  if (sort)       q.set('sort', sort);

  try {
    const response = await API.get(`/content?${q.toString()}`);
    if (response.status !== 'success') {
      tableBody.innerHTML = errorRow(7, response.message);
      return;
    }

    const items = response.content;
    const pagination = response.pagination;

    const selectAll = document.getElementById('select-all-content');
    if (selectAll) selectAll.checked = false;
    updateBulkActionsToolbar();

    if (items.length === 0) {
      tableBody.innerHTML = emptyRow(7, 'No content found', 'Try adjusting your filters or add new content.');
      renderPagination(pagination);
      return;
    }

    tableBody.innerHTML = items.map(item => {
      let previewHtml = '';
      if (item.type === 'photo' && item.downloadUrl) {
        previewHtml = `<img src="${item.downloadUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;border:1px solid rgba(255,255,255,0.1)">`;
      } else if (item.type === 'video' && item.downloadUrl) {
        previewHtml = `<video src="${item.downloadUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;border:1px solid rgba(255,255,255,0.1)" muted preload="metadata"></video>`;
      } else {
        const icon = item.type === 'link' ? '🔗' : item.type === 'text' ? '📝' : '📁';
        previewHtml = `<div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);border-radius:4px;font-size:1.1rem">${icon}</div>`;
      }

      return `
        <tr>
          <td><input type="checkbox" class="content-row-select" data-id="${item._id}" style="accent-color:var(--primary)"></td>
          <td>
            <div style="display:flex;align-items:center;gap:12px">
              ${previewHtml}
              <div>
                <div style="font-weight:600;color:var(--text)">${escapeHTML(item.title)}</div>
                <small class="text-dim">${escapeHTML(item.originalFileName || item.url || 'Text content')}</small>
              </div>
            </div>
          </td>
          <td><span class="badge badge-info">${escapeHTML(item.type)}</span></td>
          <td class="text-muted">${item.categoryId ? escapeHTML(item.categoryId.name) : '<span class="text-dim">—</span>'}</td>
          <td><span class="badge ${item.status === 'active' ? 'badge-success' : 'badge-neutral'}">${escapeHTML(item.status)}</span></td>
          <td>
            ${item.isStartContent ? '<span class="badge badge-info">Start</span>' : ''}
            ${item.isFeatured    ? '<span class="badge badge-warning">Featured</span>' : ''}
            ${!item.isStartContent && !item.isFeatured ? '<span class="text-dim">—</span>' : ''}
          </td>
          <td>
            <div class="d-flex gap-2">
              <button class="btn btn-secondary btn-sm edit-content-btn" data-id="${item._id}" title="Edit">Edit</button>
              <button class="btn btn-secondary btn-sm copy-link-btn"    data-id="${item._id}" title="Copy Link">Copy Link</button>
              <button class="btn btn-danger btn-sm delete-content-btn"  data-id="${item._id}" data-title="${escapeHTML(item.title)}" title="Delete">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Bind checkboxes
    tableBody.querySelectorAll('.content-row-select').forEach(chk =>
      chk.addEventListener('change', updateBulkActionsToolbar)
    );

    // Bind Edit
    tableBody.querySelectorAll('.edit-content-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = items.find(i => i._id === btn.dataset.id);
        if (item) openContentModal(item);
      });
    });

    // Bind Copy Link
    tableBody.querySelectorAll('.copy-link-btn').forEach(btn => {
      btn.addEventListener('click', () => copyContentLink(btn));
    });

    // Bind Delete
    tableBody.querySelectorAll('.delete-content-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteContent(btn.dataset.id, btn.dataset.title));
    });

    renderPagination(pagination);

  } catch (err) {
    tableBody.innerHTML = errorRow(7, 'Failed to load content. Network error.');
    Toast.error('Load Failed', 'Could not load content list.');
  }
}

// Pagination
function renderPagination(pageInfo) {
  const container = document.getElementById('content-pagination');
  if (!container) return;
  if (!pageInfo || pageInfo.pages <= 1) { container.innerHTML = ''; return; }

  let html = '<div class="pagination">';
  if (pageInfo.page > 1)
    html += `<button class="btn btn-secondary btn-sm" onclick="window.setContentPage(${pageInfo.page - 1})">← Prev</button>`;
  for (let i = 1; i <= pageInfo.pages; i++) {
    if (pageInfo.pages > 7 && Math.abs(i - pageInfo.page) > 2 && i !== 1 && i !== pageInfo.pages) {
      if (i === 2 || i === pageInfo.pages - 1) html += `<span style="color:var(--text-dim);align-self:center;padding:0 0.25rem">…</span>`;
      continue;
    }
    html += `<button class="btn ${i === pageInfo.page ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="window.setContentPage(${i})">${i}</button>`;
  }
  if (pageInfo.page < pageInfo.pages)
    html += `<button class="btn btn-secondary btn-sm" onclick="window.setContentPage(${pageInfo.page + 1})">Next →</button>`;
  html += '</div>';
  container.innerHTML = html;
}

window.setContentPage = (page) => { currentPage = page; loadContentList(); };

// Filters
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
document.getElementById('content-search')?.addEventListener('input', debounce(() => { currentPage = 1; loadContentList(); }, 350));
['content-filter-category','content-filter-type','content-filter-status','content-filter-featured','content-filter-sort'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => { currentPage = 1; loadContentList(); });
});

// Add button
document.getElementById('btn-add-content')?.addEventListener('click', () => openContentModal());

// Type select
const contentTypeSelect = document.getElementById('content-type');
contentTypeSelect?.addEventListener('change', () => toggleFields(contentTypeSelect.value));

function toggleFields(type) {
  const fileGroup    = document.getElementById('content-file-group');
  const urlGroup     = document.getElementById('content-url-group');
  const textGroup    = document.getElementById('content-text-group');
  const captionGroup = document.getElementById('content-caption-group');
  const fileInput    = document.getElementById('content-file');
  const urlInput     = document.getElementById('content-url');
  const textInput    = document.getElementById('content-text');
  const labelEl      = document.getElementById('content-file-label');

  [fileGroup, urlGroup, textGroup, captionGroup].forEach(el => el?.classList.add('d-none'));
  if (fileInput)  fileInput.required = false;
  if (urlInput)   urlInput.required  = false;
  if (textInput)  textInput.required = false;

  if (['photo','video','document'].includes(type)) {
    fileGroup?.classList.remove('d-none');
    captionGroup?.classList.remove('d-none');
    const isNew = !document.getElementById('content-id')?.value;
    if (isNew && fileInput) fileInput.required = true;
    if (fileInput) {
      fileInput.accept = type === 'photo' ? 'image/*' : type === 'video' ? 'video/*' : '*/*';
    }
    if (labelEl) labelEl.textContent = type === 'photo' ? 'Upload Image' : type === 'video' ? 'Upload Video' : 'Upload Document';
  } else if (type === 'link') {
    urlGroup?.classList.remove('d-none');
    captionGroup?.classList.remove('d-none');
    if (urlInput) urlInput.required = true;
  } else if (type === 'text') {
    textGroup?.classList.remove('d-none');
    if (textInput) textInput.required = true;
  }
}

function openContentModal(item = null) {
  const progressContainer = document.getElementById('upload-progress-container');
  const progressBar       = document.getElementById('upload-progress-bar');
  const progressText      = document.getElementById('upload-progress-text');
  if (progressContainer) progressContainer.style.display = 'none';
  if (progressBar)       progressBar.style.width = '0%';
  if (progressText)      progressText.textContent = '';

  const setVal   = (id, val)  => { const el = document.getElementById(id); if (el) el.value   = val ?? ''; };
  const setCheck = (id, val)  => { const el = document.getElementById(id); if (el) el.checked = !!val; };

  document.getElementById('modal-content-title').textContent = item ? 'Edit Content' : 'Add Content';

  setVal('content-id',       item?._id || '');
  setVal('content-title',    item?.title || '');
  setVal('content-category', item?.categoryId?._id || item?.categoryId || '');
  setVal('content-status',   item?.status || 'active');
  setVal('content-sort',     item?.sortOrder ?? '0');
  setVal('content-url',      item?.url || '');
  setVal('content-text',     item?.text || '');
  setVal('content-caption',  item?.caption || '');
  setCheck('content-is-start',    item?.isStartContent || false);
  setCheck('content-is-featured', item?.isFeatured || false);

  if (contentTypeSelect) {
    contentTypeSelect.value    = item?.type || 'text';
    contentTypeSelect.disabled = !!item;
  }

  const fileInput = document.getElementById('content-file');
  if (fileInput && !item) fileInput.value = '';

  toggleFields(contentTypeSelect?.value || 'text');
  openModal('content-editor');
}

// Form Submit
document.getElementById('contentForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id        = document.getElementById('content-id')?.value;
  const type      = contentTypeSelect?.value;
  const submitBtn = document.getElementById('btn-save-content');
  const isFileUpload = !id && ['photo','video','document'].includes(type);

  if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add('btn-loading'); submitBtn.textContent = isFileUpload ? 'Uploading' : 'Saving'; }

  // PATCH existing — use JSON
  if (id) {
    const patchPayload = {
      title:          document.getElementById('content-title')?.value.trim(),
      categoryId:     document.getElementById('content-category')?.value || null,
      status:         document.getElementById('content-status')?.value,
      sortOrder:      parseInt(document.getElementById('content-sort')?.value, 10) || 0,
      isStartContent: document.getElementById('content-is-start')?.checked,
      isFeatured:     document.getElementById('content-is-featured')?.checked,
      caption:        document.getElementById('content-caption')?.value.trim(),
    };
    if (type === 'link')  patchPayload.url  = document.getElementById('content-url')?.value.trim();
    if (type === 'text')  patchPayload.text = document.getElementById('content-text')?.value.trim();

    try {
      const response = await API.patch(`/content/${id}`, patchPayload);
      if (response.status === 'success') {
        closeModal('content-editor', true);
        Toast.success('Content Updated');
        await loadContentList();
      } else {
        Toast.error('Update Failed', response.message);
      }
    } catch {
      Toast.error('Network Error', 'Could not update content.');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('btn-loading'); submitBtn.textContent = 'Save Content'; }
    }
    return;
  }

  // POST new — use FormData (supports file upload)
  const formData = new FormData();
  formData.append('title',          document.getElementById('content-title')?.value.trim() || '');
  formData.append('type',           type);
  formData.append('categoryId',     document.getElementById('content-category')?.value || '');
  formData.append('status',         document.getElementById('content-status')?.value || 'active');
  formData.append('sortOrder',      document.getElementById('content-sort')?.value || '0');
  formData.append('isStartContent', document.getElementById('content-is-start')?.checked || false);
  formData.append('isFeatured',     document.getElementById('content-is-featured')?.checked || false);
  formData.append('caption',        document.getElementById('content-caption')?.value.trim() || '');
  if (type === 'link')  formData.append('url',  document.getElementById('content-url')?.value.trim() || '');
  if (type === 'text')  formData.append('text', document.getElementById('content-text')?.value.trim() || '');

  const fileInput = document.getElementById('content-file');
  if (isFileUpload && fileInput?.files.length > 0) {
    formData.append('file', fileInput.files[0]);
  }

  // Show progress bar for file uploads
  const progressContainer = document.getElementById('upload-progress-container');
  const progressBar       = document.getElementById('upload-progress-bar');
  const progressText      = document.getElementById('upload-progress-text');
  if (isFileUpload && progressContainer) progressContainer.style.display = 'block';

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/admin/content');

  const token = localStorage.getItem('admin_token');
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

  const activeBotId = localStorage.getItem('admin_active_bot_id');
  if (activeBotId) xhr.setRequestHeader('X-Bot-ID', activeBotId);

  xhr.withCredentials = true;

  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable || !isFileUpload) return;
    const pct = ((event.loaded / event.total) * 100).toFixed(0);
    if (progressBar)  progressBar.style.width  = `${pct}%`;
    if (progressText) progressText.textContent = `${pct}% — ${(event.loaded/1048576).toFixed(1)} / ${(event.total/1048576).toFixed(1)} MB`;
  };

  xhr.onload = async () => {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('btn-loading'); submitBtn.textContent = 'Save Content'; }
    try {
      const response = JSON.parse(xhr.responseText);
      if (response.status === 'success') {
        closeModal('content-editor', true);
        Toast.success('Content Added', 'File uploaded and saved successfully.');
        await loadContentList();
      } else {
        Toast.error('Upload Failed', response.message || 'Server returned an error.');
      }
    } catch {
      Toast.error('Parse Error', 'Invalid server response.');
    }
  };
  xhr.onerror = () => {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('btn-loading'); submitBtn.textContent = 'Save Content'; }
    Toast.error('Upload Failed', 'Network connection error during upload.');
  };

  xhr.send(formData);
});

// Copy Link
async function copyContentLink(btn) {
  const id = btn.dataset.id;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '...';
  try {
    const res = await API.post(`/content/${id}/share-link`);
    if (res.status === 'success') {
      try {
        await navigator.clipboard.writeText(res.link);
        btn.textContent = 'Copied ✓';
        btn.style.color = 'var(--success)';
        Toast.success('Copied', 'Share link copied to clipboard.');
        setTimeout(() => { btn.textContent = original; btn.style.color = ''; btn.disabled = false; }, 1800);
        return;
      } catch {
        // Fallback for browsers without clipboard API
        const ta = document.createElement('textarea');
        ta.value = res.link;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        btn.textContent = 'Copied ✓';
        Toast.success('Copied', 'Share link copied to clipboard.');
        setTimeout(() => { btn.textContent = original; btn.style.color = ''; btn.disabled = false; }, 1800);
        return;
      }
    }
    Toast.error('Link Error', res.message || 'Could not generate share link.');
  } catch {
    Toast.error('Network Error', 'Could not generate share link.');
  }
  btn.disabled = false; btn.textContent = original;
}

// Delete Content
async function deleteContent(id, title) {
  const confirmed = await Confirm.show({
    title: 'Delete Content',
    message: `Delete "${title}"? This will permanently remove the item and its file from Filebase storage.`,
    confirmText: 'Delete Permanently',
    type: 'danger',
  });
  if (!confirmed) return;

  try {
    const response = await API.delete(`/content/${id}`);
    if (response.status === 'success') {
      Toast.success('Deleted', `"${title}" has been removed.`);
      await loadContentList();
    } else {
      Toast.error('Delete Failed', response.message);
    }
  } catch {
    Toast.error('Network Error', 'Could not delete content.');
  }
}

// Bulk Actions
window.updateBulkActionsToolbar = function() {
  const checked  = document.querySelectorAll('.content-row-select:checked');
  const toolbar  = document.getElementById('bulk-actions-toolbar');
  const countEl  = document.getElementById('bulk-select-count');
  if (toolbar) toolbar.classList.toggle('d-none', checked.length === 0);
  if (countEl) countEl.textContent = checked.length;
};

document.getElementById('select-all-content')?.addEventListener('change', (e) => {
  document.querySelectorAll('.content-row-select').forEach(chk => { chk.checked = e.target.checked; });
  updateBulkActionsToolbar();
});

const bulkActionSelect   = document.getElementById('bulk-action-select');
const bulkCategorySelect = document.getElementById('bulk-category-select');
bulkActionSelect?.addEventListener('change', () => {
  bulkCategorySelect?.classList.toggle('d-none', bulkActionSelect.value !== 'category');
});

document.getElementById('btn-apply-bulk')?.addEventListener('click', async () => {
  const action  = bulkActionSelect?.value;
  if (!action) { Toast.warning('Bulk Action', 'Please select an action first.'); return; }

  const ids = Array.from(document.querySelectorAll('.content-row-select:checked')).map(c => c.dataset.id);
  if (ids.length === 0) return;

  const categoryId = action === 'category' ? bulkCategorySelect?.value : null;

  const verb = action === 'delete' ? 'permanently delete' : `mark as "${action}"`;
  const confirmed = await Confirm.show({
    title: 'Bulk Action',
    message: `This will ${verb} ${ids.length} item(s). Continue?`,
    confirmText: action === 'delete' ? 'Delete All' : 'Apply',
    type: action === 'delete' ? 'danger' : 'warning',
  });
  if (!confirmed) return;

  try {
    const res = await API.post('/content/bulk', { ids, action, categoryId });
    if (res.status === 'success') {
      Toast.success('Bulk Action Complete', res.message);
      await loadContentList();
    } else {
      Toast.error('Bulk Action Failed', res.message);
    }
  } catch {
    Toast.error('Network Error', 'Bulk action failed.');
  }
});

// Helpers
function emptyRow(cols, title, desc) {
  return `<tr><td colspan="${cols}">
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
      <h4>${title}</h4><p>${desc}</p>
    </div>
  </td></tr>`;
}
function errorRow(cols, msg) {
  return `<tr><td colspan="${cols}">
    <div class="empty-state">
      <h4>Failed to load</h4>
      <p>${escapeHTML(msg || '')}</p>
      <button class="btn btn-secondary btn-sm" onclick="window.dispatchEvent(new CustomEvent('load-content'))">Retry</button>
    </div>
  </td></tr>`;
}
