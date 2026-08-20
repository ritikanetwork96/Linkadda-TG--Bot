import { API } from './api.js';
import { Toast } from './toast.js';
import { Confirm } from './confirm.js';

let linksCurrentPage = 1;
let linksSearchQuery = '';
let linksStatusFilter = '';

window.addEventListener('load-links', () => {
  linksCurrentPage = 1;
  loadLinksList();
  ensureEditModal();
});

document.getElementById('links-search')?.addEventListener('input', (e) => {
  linksSearchQuery = e.target.value.trim();
  linksCurrentPage = 1;
  debounceLoadLinks();
});

document.getElementById('links-filter-status')?.addEventListener('change', (e) => {
  linksStatusFilter = e.target.value;
  linksCurrentPage = 1;
  loadLinksList();
});

let debounceTimer;
function debounceLoadLinks() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { loadLinksList(); }, 300);
}

async function loadLinksList() {
  const tableBody = document.querySelector('#links-table tbody');
  if (!tableBody) return;
  tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Loading links list...</td></tr>`;

  try {
    const params = new URLSearchParams({ page: linksCurrentPage, limit: 10, search: linksSearchQuery, status: linksStatusFilter });
    const response = await API.get(`/links?${params.toString()}`);
    if (response.status !== 'success') {
      tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error: ${response.message || 'Could not load links.'}</td></tr>`;
      return;
    }

    const links = response.links || [];
    if (links.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No generated links found matching criteria.</td></tr>`;
      renderPagination(response.pagination);
      return;
    }

    tableBody.innerHTML = links.map(link => {
      const createdTime = new Date(link.createdAt).toLocaleString();
      const expiresTime = link.expiresAt ? new Date(link.expiresAt).toLocaleString() : 'Never';
      let statusColor = 'badge-secondary';
      if (link.status === 'active') statusColor = 'badge-success';
      if (link.status === 'inactive') statusColor = 'badge-warning';
      if (link.status === 'expired') statusColor = 'badge-danger';
      const toggleActionLabel = link.status === 'active' ? 'Deactivate' : 'Activate';
      const toggleActionClass = link.status === 'active' ? 'btn-warning' : 'btn-success';
      const linkDataAttr = encodeURIComponent(JSON.stringify({ token: link.token, status: link.status, expiresAt: link.expiresAt || null, shareLink: link.shareLink || '' }));

      return `<tr>
        <td>${createdTime}</td>
        <td>
          <div><a href="${link.shareLink}" target="_blank" style="color:var(--accent-cyan);word-break:break-all">${link.shareLink}</a></div>
          <div style="font-size:0.75rem;color:var(--text-dim);margin-top:0.25rem">Token: <code>${link.token}</code></div>
        </td>
        <td><span class="badge badge-info">${link.items ? link.items.length : 0} items</span></td>
        <td><div style="font-size:0.8rem">Link: <span class="text-muted">${expiresTime}</span></div></td>
        <td><span class="badge ${statusColor}">${link.status.toUpperCase()}</span></td>
        <td>
          <div class="d-flex gap-2" style="flex-wrap:wrap">
            <button class="btn btn-sm ${toggleActionClass} toggle-link-btn" data-token="${link.token}" data-status="${link.status}">${toggleActionLabel}</button>
            <button class="btn btn-danger btn-sm delete-link-btn" data-token="${link.token}">Delete</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    tableBody.querySelectorAll('.toggle-link-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleLinkStatus(btn.getAttribute('data-token'), btn.getAttribute('data-status')));
    });
    tableBody.querySelectorAll('.delete-link-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteLink(btn.getAttribute('data-token')));
    });

    renderPagination(response.pagination);
  } catch (error) {
    console.error('Failed to load links:', error);
    tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Failed to fetch links from backend.</td></tr>`;
  }
}

function renderPagination(pageInfo) {
  const container = document.getElementById('links-pagination');
  if (!container) return;
  if (!pageInfo || pageInfo.pages <= 1) { container.innerHTML = ''; return; }
  const { page, pages } = pageInfo;
  let html = `<div class="pagination-wrapper d-flex justify-center align-center gap-2 mt-4">`;
  if (page > 1) html += `<button class="btn btn-secondary btn-sm" onclick="changeLinksPage(${page - 1})">Prev</button>`;
  html += `<span style="font-size:0.85rem" class="text-muted">Page ${page} of ${pages}</span>`;
  if (page < pages) html += `<button class="btn btn-secondary btn-sm" onclick="changeLinksPage(${page + 1})">Next</button>`;
  html += `</div>`;
  container.innerHTML = html;
}

window.changeLinksPage = function(pageNumber) { linksCurrentPage = pageNumber; loadLinksList(); };

async function toggleLinkStatus(token, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  try {
    const res = await API.patch(`/links/${token}/status`, { status: newStatus });
    if (res.status === 'success') { Toast.success('Status Updated', `Link status updated to ${newStatus}.`); loadLinksList(); }
    else Toast.error('Update Failed', res.message || 'Could not update status.');
  } catch (error) { Toast.error('Network Error', 'Failed to toggle status.'); }
}

async function deleteLink(token) {
  const confirmed = await Confirm.show({ title: 'Delete Link', message: `Are you sure you want to delete the link with token: ${token}? This action cannot be undone.`, confirmText: 'Delete', cancelText: 'Cancel', type: 'danger' });
  if (!confirmed) return;
  try {
    const res = await API.delete(`/links/${token}`);
    if (res.status === 'success') { Toast.success('Deleted', 'Link deleted successfully.'); loadLinksList(); }
    else Toast.error('Delete Failed', res.message || 'Could not delete link.');
  } catch (error) { Toast.error('Network Error', 'Failed to delete link.'); }
}

// ── EDIT MODAL ──────────────────────────────────────────────────────────────

function ensureEditModal() {
  if (document.getElementById('link-edit-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'link-edit-modal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);align-items:center;justify-content:center;padding:1rem;';
  modal.innerHTML = `
    <div id="link-edit-dialog" style="background:var(--surface,#151c2c);border:1px solid rgba(255,255,255,0.1);border-radius:1.25rem;padding:2rem;width:100%;max-width:480px;box-shadow:0 25px 60px -10px rgba(0,0,0,0.5);animation:linkEditSlideUp 0.2s ease;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem">
        <h3 style="margin:0;font-size:1.15rem;font-weight:600;color:var(--text,#f3f4f6)">✏️ Edit Link</h3>
        <button id="link-edit-close" style="background:none;border:none;cursor:pointer;color:var(--text-dim,#9ca3af);font-size:1.4rem;line-height:1;padding:0.25rem 0.5rem;border-radius:0.5rem;">x</button>
      </div>
      <div style="margin-bottom:1rem">
        <label style="font-size:0.75rem;color:var(--text-dim,#9ca3af);font-weight:500;display:block;margin-bottom:0.4rem;text-transform:uppercase;letter-spacing:0.05em">Link Token</label>
        <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:0.6rem;padding:0.6rem 0.875rem;font-size:0.85rem;font-family:monospace;color:var(--accent-cyan,#67e8f9);word-break:break-all;" id="edit-link-token-display">-</div>
        <div id="edit-link-url-display" style="margin-top:0.35rem;font-size:0.75rem;color:var(--text-dim,#9ca3af);word-break:break-all;"></div>
      </div>
      <div style="margin-bottom:1rem">
        <label for="edit-link-status" style="font-size:0.75rem;color:var(--text-dim,#9ca3af);font-weight:500;display:block;margin-bottom:0.4rem;text-transform:uppercase;letter-spacing:0.05em">Status</label>
        <select id="edit-link-status" style="width:100%;background:var(--surface-2,#1e2738);border:1px solid rgba(255,255,255,0.12);border-radius:0.6rem;padding:0.65rem 0.875rem;color:var(--text,#f3f4f6);font-size:0.9rem;outline:none;cursor:pointer;">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div style="margin-bottom:1.75rem">
        <label for="edit-link-expires" style="font-size:0.75rem;color:var(--text-dim,#9ca3af);font-weight:500;display:block;margin-bottom:0.4rem;text-transform:uppercase;letter-spacing:0.05em">Link Expires At <span style="font-weight:400;text-transform:none;font-size:0.7rem;color:#6b7280">(link band ho jaata hai is date ke baad)</span></label>
        <input type="datetime-local" id="edit-link-expires" style="width:100%;background:var(--surface-2,#1e2738);border:1px solid rgba(255,255,255,0.12);border-radius:0.6rem;padding:0.65rem 0.875rem;color:var(--text,#f3f4f6);font-size:0.9rem;outline:none;box-sizing:border-box;color-scheme:dark;" />
        <div style="margin-top:0.5rem;display:flex;align-items:center;gap:0.5rem">
          <input type="checkbox" id="edit-link-never-expires" style="cursor:pointer;width:14px;height:14px;accent-color:var(--primary,#a78bfa)" />
          <label for="edit-link-never-expires" style="font-size:0.8rem;color:var(--text-dim,#9ca3af);cursor:pointer">Kabhi expire nahi hoga (Never Expires)</label>
        </div>
      </div>
      <div style="display:flex;gap:0.75rem;justify-content:flex-end">
        <button id="link-edit-cancel-btn" style="padding:0.6rem 1.25rem;border-radius:0.6rem;border:1px solid rgba(255,255,255,0.15);background:transparent;color:var(--text-dim,#9ca3af);cursor:pointer;font-size:0.9rem;">Cancel</button>
        <button id="link-edit-save-btn" style="padding:0.6rem 1.5rem;border-radius:0.6rem;border:none;background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;cursor:pointer;font-size:0.9rem;font-weight:600;box-shadow:0 4px 14px rgba(124,58,237,0.4);">Save Changes</button>
      </div>
    </div>
    <style>@keyframes linkEditSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}</style>
  `;
  document.body.appendChild(modal);
  document.getElementById('link-edit-close').addEventListener('click', closeEditModal);
  document.getElementById('link-edit-cancel-btn').addEventListener('click', closeEditModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeEditModal(); });
  document.getElementById('edit-link-never-expires').addEventListener('change', (e) => {
    const el = document.getElementById('edit-link-expires');
    el.disabled = e.target.checked;
    if (e.target.checked) el.value = '';
  });
  document.getElementById('link-edit-save-btn').addEventListener('click', saveEditLink);
}

let _editingToken = null;

function openEditLinkModal(linkData) {
  ensureEditModal();
  _editingToken = linkData.token;
  document.getElementById('edit-link-token-display').textContent = linkData.token;
  // Show full Telegram URL below token
  const urlEl = document.getElementById('edit-link-url-display');
  if (urlEl && linkData.shareLink) {
    urlEl.innerHTML = `<span style="color:#6b7280">URL:</span> <span style="color:#a5b4fc">${linkData.shareLink}</span>`;
  }
  document.getElementById('edit-link-status').value = linkData.status || 'active';
  const expiresInput = document.getElementById('edit-link-expires');
  const neverCb = document.getElementById('edit-link-never-expires');
  if (linkData.expiresAt) {
    const d = new Date(linkData.expiresAt);
    expiresInput.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    expiresInput.disabled = false;
    neverCb.checked = false;
  } else {
    expiresInput.value = '';
    expiresInput.disabled = true;
    neverCb.checked = true;
  }
  const modal = document.getElementById('link-edit-modal');
  modal.style.display = 'flex';
}

function closeEditModal() {
  const modal = document.getElementById('link-edit-modal');
  if (modal) modal.style.display = 'none';
  _editingToken = null;
}

async function saveEditLink() {
  if (!_editingToken) return;
  const saveBtn = document.getElementById('link-edit-save-btn');
  const status = document.getElementById('edit-link-status').value;
  const neverExpires = document.getElementById('edit-link-never-expires').checked;
  const expiresRaw = document.getElementById('edit-link-expires').value;
  const payload = { status };
  if (neverExpires) payload.expiresAt = null;
  else if (expiresRaw) payload.expiresAt = new Date(expiresRaw).toISOString();
  saveBtn.textContent = 'Saving...';
  saveBtn.disabled = true;
  try {
    const res = await API.patch(`/links/${_editingToken}`, payload);
    if (res.status === 'success') {
      Toast.success('Saved', 'Link updated successfully.');
      closeEditModal();
      loadLinksList();
    } else Toast.error('Save Failed', res.message || 'Could not update link.');
  } catch (error) {
    Toast.error('Network Error', 'Failed to save link changes.');
  } finally {
    saveBtn.textContent = 'Save Changes';
    saveBtn.disabled = false;
  }
}
