import { API } from './api.js';
import { Toast } from './toast.js';
import { Confirm } from './confirm.js';

let currentPage = 1;

window.addEventListener('load-users', () => { currentPage = 1; loadUsersList(); });

async function loadUsersList() {
  const tableBody = document.querySelector('#users-table tbody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-dim" style="padding:2rem">
    <div class="spinner" style="margin:0 auto 0.5rem"></div>Loading users...
  </td></tr>`;

  const search = document.getElementById('users-search')?.value.trim() || '';
  const statusVal = document.getElementById('users-filter-status')?.value || '';

  const q = new URLSearchParams({ page: currentPage, limit: 15 });
  if (search) q.set('search', search);
  // Only send status param if it's an actual filter value (not empty or 'all')
  if (statusVal && statusVal !== 'all') q.set('status', statusVal);

  try {
    const response = await API.get(`/users?${q.toString()}`);
    if (response.status !== 'success') {
      tableBody.innerHTML = errorRow(7, response.message || 'Failed to load users.');
      return;
    }

    const users      = response.users || [];
    const pagination = response.pagination;

    // Update user count badge
    const countBadge = document.getElementById('users-total-count');
    if (countBadge) countBadge.textContent = pagination?.total ?? users.length;

    if (users.length === 0) {
      tableBody.innerHTML = emptyRow(7, 'No users found', 'No Telegram users have interacted with this bot yet, or no users match your filters.');
      renderPagination(pagination);
      return;
    }

    tableBody.innerHTML = users.map(user => {
      const isBlocked = user.status === 'blocked';
      const isInactive = user.status === 'inactive';
      const displayName = [escapeHTML(user.firstName || ''), escapeHTML(user.lastName || '')].filter(Boolean).join(' ') || '<span class="text-dim">—</span>';
      const displayUsername = user.username ? `@${escapeHTML(user.username)}` : '<span class="text-dim">—</span>';

      return `
        <tr>
          <td><code style="font-size:0.75rem">${escapeHTML(String(user.telegramUserId))}</code></td>
          <td style="font-weight:600;color:var(--text)">${displayName}</td>
          <td class="text-muted">${displayUsername}</td>
          <td>
            <span class="badge ${user.status === 'active' ? 'badge-success' : isBlocked ? 'badge-danger' : 'badge-neutral'}">
              ${escapeHTML(user.status)}
            </span>
          </td>
          <td class="text-dim" style="font-size:0.82rem">${fmtDate(user.startedAt || user.createdAt)}</td>
          <td class="text-dim" style="font-size:0.82rem">${user.lastActiveAt ? fmtDateTime(user.lastActiveAt) : '—'}</td>
          <td>
            <button class="btn ${isBlocked ? 'btn-outline' : 'btn-danger'} btn-sm toggle-block-btn"
                    data-id="${user._id}"
                    data-name="${escapeHTML(user.firstName || 'User')}"
                    data-action="${isBlocked ? 'active' : 'blocked'}">
              ${isBlocked ? 'Unblock' : 'Block'}
            </button>
          </td>
        </tr>
      `;
    }).join('');

    renderPagination(pagination);

    tableBody.querySelectorAll('.toggle-block-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleUserStatus(btn.dataset.id, btn.dataset.name, btn.dataset.action));
    });

  } catch (err) {
    console.error('Users load error:', err);
    tableBody.innerHTML = errorRow(7, 'Failed to load users. Check your connection.');
    Toast.error('Load Failed', 'Could not load users list.');
  }
}

function renderPagination(pageInfo) {
  const container = document.getElementById('users-pagination');
  if (!container) return;
  if (!pageInfo || pageInfo.pages <= 1) { container.innerHTML = ''; return; }

  let html = '<div class="pagination">';
  if (pageInfo.page > 1)
    html += `<button class="btn btn-secondary btn-sm" onclick="window.setUserPage(${pageInfo.page - 1})">← Prev</button>`;

  // Show max 7 page buttons
  const totalPages = pageInfo.pages;
  const curPage = pageInfo.page;
  let startPage = Math.max(1, curPage - 3);
  let endPage = Math.min(totalPages, startPage + 6);
  if (endPage - startPage < 6) startPage = Math.max(1, endPage - 6);

  if (startPage > 1) html += `<button class="btn btn-secondary btn-sm" onclick="window.setUserPage(1)">1</button><span class="text-dim" style="padding:0 0.25rem">…</span>`;
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="btn ${i === curPage ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="window.setUserPage(${i})">${i}</button>`;
  }
  if (endPage < totalPages) html += `<span class="text-dim" style="padding:0 0.25rem">…</span><button class="btn btn-secondary btn-sm" onclick="window.setUserPage(${totalPages})">${totalPages}</button>`;

  if (pageInfo.page < totalPages)
    html += `<button class="btn btn-secondary btn-sm" onclick="window.setUserPage(${pageInfo.page + 1})">Next →</button>`;
  html += '</div>';
  container.innerHTML = html;
}

window.setUserPage = (page) => { currentPage = page; loadUsersList(); };

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// Attach search and filter listeners after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('users-search')?.addEventListener('input', debounce(() => { currentPage = 1; loadUsersList(); }, 350));
  document.getElementById('users-filter-status')?.addEventListener('change', () => { currentPage = 1; loadUsersList(); });
});

// Also attach immediately in case DOM is already ready
document.getElementById('users-search')?.addEventListener('input', debounce(() => { currentPage = 1; loadUsersList(); }, 350));
document.getElementById('users-filter-status')?.addEventListener('change', () => { currentPage = 1; loadUsersList(); });

async function toggleUserStatus(id, name, newStatus) {
  const isBlocking = newStatus === 'blocked';
  const confirmed = await Confirm.show({
    title: isBlocking ? 'Block User' : 'Unblock User',
    message: `${isBlocking ? 'Block' : 'Unblock'} <b>${name}</b>? ${isBlocking ? 'They will no longer receive bot responses.' : 'They will be able to use the bot again.'}`,
    confirmText: isBlocking ? 'Block User' : 'Unblock User',
    type: isBlocking ? 'danger' : 'warning',
  });
  if (!confirmed) return;

  try {
    const response = await API.patch(`/users/${id}/status`, { status: newStatus });
    if (response.status === 'success') {
      Toast.success(
        isBlocking ? 'User Blocked' : 'User Unblocked',
        `${name} has been ${isBlocking ? 'blocked' : 'unblocked'}.`
      );
      await loadUsersList();
    } else {
      Toast.error('Failed', response.message || 'Could not update status.');
    }
  } catch {
    Toast.error('Network Error', 'Could not update user status.');
  }
}

function emptyRow(cols, title, desc) {
  return `<tr><td colspan="${cols}">
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
      <h4>${title}</h4><p>${desc}</p>
    </div>
  </td></tr>`;
}

function errorRow(cols, msg) {
  return `<tr><td colspan="${cols}">
    <div class="empty-state">
      <h4>Failed to load</h4>
      <p>${escapeHTML(msg || '')}</p>
      <button class="btn btn-secondary btn-sm" onclick="window.dispatchEvent(new CustomEvent('load-users'))">Retry</button>
    </div>
  </td></tr>`;
}
