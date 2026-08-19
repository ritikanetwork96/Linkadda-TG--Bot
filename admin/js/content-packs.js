import { API } from './api.js';
import { Toast } from './toast.js';
import { Confirm } from './confirm.js';

let packs = [];
let currentPage = 1;
let selectedItems = []; // in-memory list of pack items: { contentId, title, type, captionOverride, deliveryMode, enabled }
let availableContents = []; // fetched for selector modal
let categories = []; // cached categories for selector filter

window.addEventListener('load-content-packs', () => {
  loadPacksList();
  loadCategoriesCached();
});

// Event Listeners for main buttons
document.getElementById('btn-create-pack')?.addEventListener('click', () => {
  openPackEditor();
});

document.getElementById('btn-seed-demo-data')?.addEventListener('click', async () => {
  const confirmed = await Confirm.show({
    title: 'Seed Demo Data',
    message: 'Are you sure you want to load demo Categories, Content, and a Demo Pack Collection for testing?',
    confirmText: 'Seed Data',
    type: 'info'
  });
  if (!confirmed) return;

  try {
    const res = await API.post('/system/seed-demo');
    if (res.status === 'success') {
      Toast.success('Demo Seeded', 'Demo pack and media created successfully.');
      loadPacksList();
    } else {
      Toast.error('Seed Failed', res.message || 'Seeding failed.');
    }
  } catch (err) {
    Toast.error('Error', 'Network error during seeding.');
  }
});

// Filter event listeners
document.getElementById('pack-search')?.addEventListener('input', () => {
  currentPage = 1;
  loadPacksList();
});

document.getElementById('pack-filter-status')?.addEventListener('change', () => {
  currentPage = 1;
  loadPacksList();
});

// Load Content Packs list via API
async function loadPacksList() {
  const tableBody = document.querySelector('#packs-table tbody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-dim" style="padding:1.5rem">
    <div class="spinner" style="margin:0 auto 0.5rem"></div>Loading content packs...
  </td></tr>`;

  try {
    const search = document.getElementById('pack-search')?.value || '';
    const status = document.getElementById('pack-filter-status')?.value || '';

    const res = await API.get(`/content-packs?page=${currentPage}&limit=10&search=${encodeURIComponent(search)}&status=${status}`);
    if (res.status !== 'success') {
      tableBody.innerHTML = errorRow();
      return;
    }

    packs = res.packs;
    if (packs.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V9l6 4-6 4z"/></svg>
          <h4>No Content Packs</h4>
          <p>Create a curated content pack link and share it directly with users.</p>
        </div>
      </td></tr>`;
      renderPagination(res.pagination);
      return;
    }

    renderPacksTable();
    renderPagination(res.pagination);
  } catch (err) {
    tableBody.innerHTML = errorRow();
    Toast.error('Load Failed', 'Could not fetch content packs list.');
  }
}

function renderPacksTable() {
  const tableBody = document.querySelector('#packs-table tbody');
  if (!tableBody) return;

  tableBody.innerHTML = packs.map(pack => {
    const statusClass = {
      ACTIVE: 'badge-success',
      DRAFT: 'badge-neutral',
      DISABLED: 'badge-danger',
      EXPIRED: 'badge-danger'
    }[pack.status] || 'badge-neutral';

    return `
      <tr>
        <td style="font-weight:600;color:var(--text)">${escapeHTML(pack.name)}</td>
        <td><code>${pack.itemCount}</code> items</td>
        <td><span class="badge ${statusClass}">${pack.status}</span></td>
        <td class="text-dim">${fmtDate(pack.createdAt)}</td>
        <td class="text-dim">${pack.expiresAt ? fmtDate(pack.expiresAt) : 'Never'}</td>
        <td>
          <div style="max-width:180px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
            <a href="${pack.shareLink}" target="_blank" style="font-size:0.8rem; color:var(--text-cyan)">${pack.publicCode}</a>
          </div>
        </td>
        <td>
          <div class="d-flex gap-1">
            <button class="btn btn-secondary btn-sm copy-link-btn" data-link="${pack.shareLink}">Copy Link</button>
            <button class="btn btn-secondary btn-sm share-btn" data-title="${escapeHTML(pack.name)}" data-link="${pack.shareLink}">Share</button>
            <button class="btn btn-secondary btn-sm preview-btn" data-id="${pack._id}">Preview</button>
            <button class="btn btn-secondary btn-sm edit-btn" data-id="${pack._id}">Edit</button>
            <button class="btn btn-secondary btn-sm duplicate-btn" data-id="${pack._id}">Duplicate</button>
            <button class="btn btn-danger btn-sm delete-btn" data-id="${pack._id}" data-name="${escapeHTML(pack.name)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Bind actions
  tableBody.querySelectorAll('.copy-link-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      copyToClipboard(btn.dataset.link);
    });
  });

  tableBody.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sharePack(btn.dataset.title, btn.dataset.link);
    });
  });

  tableBody.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      previewPack(btn.dataset.id);
    });
  });

  tableBody.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openPackEditor(btn.dataset.id);
    });
  });

  tableBody.querySelectorAll('.duplicate-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      duplicatePack(btn.dataset.id);
    });
  });

  tableBody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      deletePack(btn.dataset.id, btn.dataset.name);
    });
  });
}

function renderPagination(pagination) {
  const container = document.getElementById('packs-pagination');
  if (!container) return;

  if (pagination.pages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `<div class="pagination-container mt-4 d-flex justify-between align-center">
    <span style="font-size:0.8rem" class="text-dim">Page ${pagination.page} of ${pagination.pages} (Total ${pagination.total} packs)</span>
    <div class="d-flex gap-1">
      <button class="btn btn-secondary btn-sm pagination-prev" ${pagination.page === 1 ? 'disabled' : ''}>◀ Prev</button>
      <button class="btn btn-secondary btn-sm pagination-next" ${pagination.page === pagination.pages ? 'disabled' : ''}>Next ▶</button>
    </div>
  </div>`;

  container.innerHTML = html;

  container.querySelector('.pagination-prev')?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadPacksList();
    }
  });

  container.querySelector('.pagination-next')?.addEventListener('click', () => {
    if (currentPage < pagination.pages) {
      currentPage++;
      loadPacksList();
    }
  });
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    Toast.success('Copied ✓', 'Link copied to clipboard.');
  }).catch(() => {
    Toast.error('Copy Failed', 'Could not copy link.');
  });
}

function sharePack(title, link) {
  if (navigator.share) {
    navigator.share({
      title: title,
      text: `Get content pack link: ${title}`,
      url: link
    }).catch(() => {});
  } else {
    copyToClipboard(link);
  }
}

// Open modal for edit / create
async function openPackEditor(packId = null) {
  selectedItems = [];
  const form = document.getElementById('packForm');
  if (form) form.reset();

  document.getElementById('pack-id').value = packId || '';
  document.getElementById('modal-pack-title').textContent = packId ? 'Edit Content Pack' : 'Create Content Pack';
  document.getElementById('pack-expires-input').value = '';
  document.getElementById('pack-protect-input').checked = false;

  if (packId) {
    try {
      const res = await API.get(`/content-packs/${packId}`);
      if (res.status === 'success') {
        const pack = res.pack;
        document.getElementById('pack-name-input').value = pack.name;
        document.getElementById('pack-desc-input').value = pack.description || '';
        document.getElementById('pack-status-input').value = pack.status;
        document.getElementById('pack-protect-input').checked = pack.protectContent || false;

        if (pack.expiresAt) {
          // Format ISO date to local datetime-local value (YYYY-MM-DDTHH:MM)
          const date = new Date(pack.expiresAt);
          const formatted = date.toISOString().slice(0, 16);
          document.getElementById('pack-expires-input').value = formatted;
        }

        // Map items
        selectedItems = (pack.items || []).map(item => ({
          contentId: item.contentId ? (item.contentId._id || item.contentId) : '',
          title: item.contentId ? (item.contentId.title || 'Unknown') : 'Unknown',
          type: item.contentId ? (item.contentId.type || 'text') : 'text',
          captionOverride: item.captionOverride || '',
          deliveryMode: item.deliveryMode || 'normal',
          enabled: item.enabled !== false
        }));
      }
    } catch {
      Toast.error('Load Failed', 'Could not load pack details.');
      return;
    }
  }

  renderSelectedItemsTable();
  openModal('pack-editor');
}

// Render selected items list in create/edit form
function renderSelectedItemsTable() {
  const tableBody = document.querySelector('#pack-selected-items-table tbody');
  if (!tableBody) return;

  if (selectedItems.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-dim" style="padding:1rem">No content items added. Click "Add Content" above to select.</td></tr>`;
    return;
  }

  tableBody.innerHTML = selectedItems.map((item, index) => {
    return `
      <tr>
        <td><code>${index + 1}</code></td>
        <td style="font-weight:600;font-size:0.82rem;color:var(--text);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</td>
        <td><span class="badge badge-neutral" style="font-size:0.7rem">${item.type}</span></td>
        <td>
          <input type="text" class="form-input caption-override-input" style="padding:0.25rem 0.5rem;font-size:0.75rem;" data-idx="${index}" value="${escapeHTML(item.captionOverride)}" placeholder="override caption...">
        </td>
        <td>
          <select class="form-select mode-input" style="padding:0.25rem 1.5rem 0.25rem 0.5rem;font-size:0.75rem;" data-idx="${index}">
            <option value="normal" ${item.deliveryMode === 'normal' ? 'selected' : ''}>Normal</option>
            <option value="protected" ${item.deliveryMode === 'protected' ? 'selected' : ''}>Protected</option>
          </select>
        </td>
        <td>
          <input type="checkbox" class="item-enabled-input" data-idx="${index}" ${item.enabled ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
        </td>
        <td>
          <div class="d-flex gap-1">
            <button type="button" class="btn btn-secondary btn-sm move-up-btn" data-idx="${index}" ${index === 0 ? 'disabled' : ''} style="padding:0.18rem 0.38rem">↑</button>
            <button type="button" class="btn btn-secondary btn-sm move-down-btn" data-idx="${index}" ${index === selectedItems.length - 1 ? 'disabled' : ''} style="padding:0.18rem 0.38rem">↓</button>
            <button type="button" class="btn btn-danger btn-sm remove-item-btn" data-idx="${index}" style="padding:0.18rem 0.38rem">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Bind events for override inputs
  tableBody.querySelectorAll('.caption-override-input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.idx, 10);
      selectedItems[idx].captionOverride = input.value;
    });
  });

  tableBody.querySelectorAll('.mode-input').forEach(select => {
    select.addEventListener('change', () => {
      const idx = parseInt(select.dataset.idx, 10);
      selectedItems[idx].deliveryMode = select.value;
    });
  });

  tableBody.querySelectorAll('.item-enabled-input').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx, 10);
      selectedItems[idx].enabled = cb.checked;
    });
  });

  tableBody.querySelectorAll('.move-up-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      swapSelectedItems(idx, idx - 1);
    });
  });

  tableBody.querySelectorAll('.move-down-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      swapSelectedItems(idx, idx + 1);
    });
  });

  tableBody.querySelectorAll('.remove-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      selectedItems.splice(idx, 1);
      renderSelectedItemsTable();
    });
  });
}

function swapSelectedItems(a, b) {
  [selectedItems[a], selectedItems[b]] = [selectedItems[b], selectedItems[a]];
  renderSelectedItemsTable();
}

// Form Submission (Create/Edit Save)
document.getElementById('packForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const packId = document.getElementById('pack-id').value;
  const name = document.getElementById('pack-name-input').value;
  const description = document.getElementById('pack-desc-input').value;
  const status = document.getElementById('pack-status-input').value;
  const expiresAt = document.getElementById('pack-expires-input').value;
  const protectContent = document.getElementById('pack-protect-input').checked;

  const payload = {
    name,
    description,
    status,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    protectContent,
    items: selectedItems.map((item, idx) => ({
      contentId: item.contentId,
      sortOrder: idx,
      captionOverride: item.captionOverride,
      deliveryMode: item.deliveryMode,
      enabled: item.enabled
    }))
  };

  try {
    let res;
    if (packId) {
      res = await API.patch(`/content-packs/${packId}`, payload);
    } else {
      res = await API.post('/content-packs', payload);
    }

    if (res.status === 'success') {
      Toast.success('Saved', 'Content pack saved successfully.');
      closeModal('pack-editor', true);
      loadPacksList();
    } else {
      Toast.error('Save Failed', res.message || 'Error occurred.');
    }
  } catch {
    Toast.error('Network Error', 'Could not contact server.');
  }
});

// Duplication Action
async function duplicatePack(packId) {
  try {
    const res = await API.post(`/content-packs/${packId}/duplicate`);
    if (res.status === 'success') {
      Toast.success('Duplicated ✓', `Curated pack copied as "${res.pack.name}".`);
      loadPacksList();
    } else {
      Toast.error('Duplicate Failed', res.message);
    }
  } catch {
    Toast.error('Error', 'Connection failed.');
  }
}

// Delete Action
async function deletePack(packId, name) {
  const confirmed = await Confirm.show({
    title: 'Delete Pack',
    message: `Are you sure you want to delete the content pack "${name}"? The referenced content files will NOT be deleted.`,
    confirmText: 'Delete',
    type: 'danger'
  });
  if (!confirmed) return;

  try {
    const res = await API.delete(`/content-packs/${packId}`);
    if (res.status === 'success') {
      Toast.success('Deleted', 'Pack removed successfully.');
      loadPacksList();
    } else {
      Toast.error('Delete Failed', res.message);
    }
  } catch {
    Toast.error('Error', 'Connection error.');
  }
}

// Preview & Analytics Action
async function previewPack(packId) {
  try {
    const res = await API.get(`/content-packs/${packId}`);
    if (res.status !== 'success') return;

    const pack = res.pack;
    document.getElementById('modal-preview-pack-title').textContent = `${pack.name} — Preview`;
    document.getElementById('preview-pack-status').textContent = pack.status;
    
    // Status color
    const badge = document.getElementById('preview-pack-status');
    badge.className = 'badge ' + {
      ACTIVE: 'badge-success',
      DRAFT: 'badge-neutral',
      DISABLED: 'badge-danger',
      EXPIRED: 'badge-danger'
    }[pack.status];

    document.getElementById('preview-pack-code').textContent = pack.publicCode;
    document.getElementById('preview-pack-expiry').textContent = pack.expiresAt ? fmtDateTime(pack.expiresAt) : 'Never';
    document.getElementById('preview-pack-protection').textContent = pack.protectContent ? 'Enabled (No forwards)' : 'Disabled';

    // Estimations
    const activeItems = (pack.items || []).filter(i => i.enabled);
    document.getElementById('preview-pack-total-items').textContent = activeItems.length;

    // Estimate chunk messages count
    let estMsgs = 0;
    let groupableBuffer = 0;
    const groupableTypes = ['photo', 'video'];

    activeItems.forEach(i => {
      const type = i.contentId ? i.contentId.type : 'text';
      if (groupableTypes.includes(type)) {
        groupableBuffer++;
      } else {
        if (groupableBuffer > 0) {
          estMsgs += Math.ceil(groupableBuffer / 10);
          groupableBuffer = 0;
        }
        estMsgs++;
      }
    });
    if (groupableBuffer > 0) {
      estMsgs += Math.ceil(groupableBuffer / 10);
    }
    document.getElementById('preview-pack-est-msgs').textContent = estMsgs;

    // Table Sequence preview
    const tbody = document.querySelector('#preview-pack-items-table tbody');
    if (tbody) {
      if (activeItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-dim" style="padding:1rem">No active items inside this pack.</td></tr>`;
      } else {
        tbody.innerHTML = activeItems.map((item, idx) => {
          const c = item.contentId || {};
          return `
            <tr>
              <td><code>${idx + 1}</code></td>
              <td style="font-weight:600;font-size:0.8rem;color:var(--text)">${escapeHTML(c.title || 'Deleted Item')}</td>
              <td><span class="badge badge-neutral" style="font-size:0.7rem">${c.type || 'N/A'}</span></td>
              <td class="text-muted" style="font-size:0.75rem">${item.captionOverride ? escapeHTML(item.captionOverride) : '<span class="text-dim">—</span>'}</td>
              <td><span class="badge ${c.status === 'active' ? 'badge-success' : 'badge-danger'}">${c.status || 'inactive'}</span></td>
            </tr>
          `;
        }).join('');
      }
    }

    // Analytics section
    const anaRes = await API.get(`/content-packs/${packId}/analytics`);
    if (anaRes.status === 'success') {
      const stats = anaRes.analytics;
      document.getElementById('analytics-pack-opens').textContent = stats.totalOpens?.toLocaleString() || '0';
      document.getElementById('analytics-pack-users').textContent = stats.uniqueUsers?.toLocaleString() || '0';
      document.getElementById('analytics-pack-msgs').textContent = stats.totalMessagesDelivered?.toLocaleString() || '0';
      document.getElementById('analytics-pack-failed').textContent = stats.failedDeliveries?.toLocaleString() || '0';
    }

    openModal('pack-preview');
  } catch {
    Toast.error('Error', 'Failed to generate pack preview details.');
  }
}

// Nested Content Selector Popup Controls
let selectorCheckedIds = new Set();

document.getElementById('btn-pack-add-content-trigger')?.addEventListener('click', () => {
  selectorCheckedIds.clear();
  // Pre-load existing categories into dropdown if not loaded
  const catFilter = document.getElementById('selector-filter-category');
  if (catFilter) {
    catFilter.innerHTML = '<option value="">All Categories</option>' + categories.map(c => `
      <option value="${c._id}">${escapeHTML(c.displayName || c.name)}</option>
    `).join('');
  }

  // Load available library list
  currentPageSelector = 1;
  loadSelectorLibrary();
  openModal('content-selector');
});

let currentPageSelector = 1;

document.getElementById('selector-search')?.addEventListener('input', () => {
  currentPageSelector = 1;
  loadSelectorLibrary();
});
document.getElementById('selector-filter-category')?.addEventListener('change', () => {
  currentPageSelector = 1;
  loadSelectorLibrary();
});
document.getElementById('selector-filter-type')?.addEventListener('change', () => {
  currentPageSelector = 1;
  loadSelectorLibrary();
});

async function loadSelectorLibrary() {
  const tbody = document.querySelector('#selector-items-table tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="4" class="text-center text-dim" style="padding:1rem"><div class="spinner" style="margin:0 auto"></div></td></tr>`;

  try {
    const search = document.getElementById('selector-search')?.value || '';
    const cat = document.getElementById('selector-filter-category')?.value || '';
    const type = document.getElementById('selector-filter-type')?.value || '';

    // Query active items in library
    const res = await API.get(`/content?status=active&search=${encodeURIComponent(search)}&categoryId=${cat}&type=${type}&limit=50&page=${currentPageSelector}`);
    if (res.status !== 'success') {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-dim">Could not load items list.</td></tr>`;
      return;
    }

    availableContents = res.content;
    if (availableContents.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-dim">No matching active items found in Content Library.</td></tr>`;
      return;
    }

    renderSelectorTable();
  } catch {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-dim">Connection failed.</td></tr>`;
  }
}

function renderSelectorTable() {
  const tbody = document.querySelector('#selector-items-table tbody');
  if (!tbody) return;

  tbody.innerHTML = availableContents.map(c => {
    const isChecked = selectorCheckedIds.has(c._id);
    const catName = c.categoryId ? (c.categoryId.displayName || c.categoryId.name || c.categoryId) : '—';
    return `
      <tr>
        <td>
          <input type="checkbox" class="selector-item-cb" data-id="${c._id}" data-title="${escapeHTML(c.title)}" data-type="${c.type}" ${isChecked ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
        </td>
        <td style="font-weight:600;font-size:0.8rem;color:var(--text);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(c.title)}</td>
        <td><span class="badge badge-info" style="font-size:0.7rem">${c.type}</span></td>
        <td class="text-muted" style="font-size:0.78rem">${escapeHTML(catName)}</td>
      </tr>
    `;
  }).join('');

  // Bind checkbox events
  tbody.querySelectorAll('.selector-item-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) {
        selectorCheckedIds.add(id);
      } else {
        selectorCheckedIds.delete(id);
      }
      updateSelectorCounter();
    });
  });

  updateSelectorCounter();
}

function updateSelectorCounter() {
  const el = document.getElementById('selector-selected-count');
  if (el) el.textContent = selectorCheckedIds.size;
}

// Select All / Clear All popup helpers
document.getElementById('btn-selector-select-all')?.addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('.selector-item-cb');
  checkboxes.forEach(cb => {
    cb.checked = true;
    selectorCheckedIds.add(cb.dataset.id);
  });
  updateSelectorCounter();
});

document.getElementById('btn-selector-clear-all')?.addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('.selector-item-cb');
  checkboxes.forEach(cb => {
    cb.checked = false;
    selectorCheckedIds.delete(cb.dataset.id);
  });
  updateSelectorCounter();
});

// Selector check all header checkbox
document.getElementById('selector-select-all-cb')?.addEventListener('change', (e) => {
  const checkboxes = document.querySelectorAll('.selector-item-cb');
  checkboxes.forEach(cb => {
    cb.checked = e.target.checked;
    if (e.target.checked) {
      selectorCheckedIds.add(cb.dataset.id);
    } else {
      selectorCheckedIds.delete(cb.dataset.id);
    }
  });
  updateSelectorCounter();
});

// Confirm nested selection click
document.getElementById('btn-selector-add-selected')?.addEventListener('click', () => {
  if (selectorCheckedIds.size === 0) {
    closeModal('content-selector');
    return;
  }

  // Iterate checking IDs and append matching items to selectedItems
  selectorCheckedIds.forEach(id => {
    // Check if it's already in selectedItems list (skip to prevent duplicates in current editor)
    const exists = selectedItems.some(i => i.contentId === id);
    if (exists) return;

    // Find the item details in availableContents list
    const found = availableContents.find(c => c._id === id);
    if (found) {
      selectedItems.push({
        contentId: found._id,
        title: found.title,
        type: found.type,
        captionOverride: '',
        deliveryMode: 'normal',
        enabled: true
      });
    }
  });

  renderSelectedItemsTable();
  closeModal('content-selector');
  Toast.success('Items Added', `${selectorCheckedIds.size} content items added to pack.`);
});

// Cache categories for selection filtering
async function loadCategoriesCached() {
  try {
    const res = await API.get('/categories?limit=100');
    if (res.status === 'success') {
      categories = res.categories;
    }
  } catch {}
}

function errorRow() {
  return `<tr><td colspan="7">
    <div class="empty-state">
      <h4>Failed to load</h4>
      <p>Could not load content packs list. Check backend connections.</p>
      <button class="btn btn-secondary btn-sm" onclick="window.dispatchEvent(new CustomEvent('load-content-packs'))">Retry</button>
    </div>
  </td></tr>`;
}
