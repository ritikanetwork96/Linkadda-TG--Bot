import { API } from './api.js';
import { Toast } from './toast.js';
import { Confirm } from './confirm.js';

let currentPage = 1;

window.addEventListener('load-users', () => loadUsersList());

async function loadUsersList() {
  const tableBody = document.querySelector('#users-table tbody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-dim" style="padding:1.5rem">
    <div class="spinner" style="margin:0 auto 0.5rem"></div>Loading users...
  </td></tr>`;

  const search = document.getElementById('users-search')?.value.trim();
  const status = document.getElementById('users-filter-status')?.value;

  const q = new URLSearchParams({ page: currentPage, limit: 15 });
  if (search) q.set('search', search);
  if (status) q.set('status', status);

  try {
    const response = await API.get(`/users?${q.toString()}`);
    if (response.status !== 'success') {
      tableBody.innerHTML = errorRow(7, response.message);
      return;
    }

    const users      = response.users;
    const pagination = response.pagination;

    if (users.length === 0) {
      tableBody.innerHTML = emptyRow(7, 'No users found', 'No users match your current filters.');
      renderPagination(pagination);
      return;
    }

    tableBody.innerHTML = users.map(user => {
      const isBlocked = user.status === 'blocked';
      return `
        <tr>
          <td><code>${escapeHTML(String(user.telegramUserId))}</code></td>
          <td style="font-weight:600;color:var(--text)">${escapeHTML(user.firstName)} ${escapeHTML(user.lastName || '')}</td>
          <td class="text-muted">${user.username ? '@' + escapeHTML(user.username) : '<span class="text-dim">—</span>'}</td>
          <td>
            <span class="badge ${user.status === 'active' ? 'badge-success' : isBlocked ? 'badge-danger' : 'badge-neutral'}">
              ${escapeHTML(user.status)}
            </span>
          </td>
          <td class="text-dim">${fmtDate(user.startedAt || user.createdAt)}</td>
          <td class="text-dim">${user.lastActiveAt ? fmtDateTime(user.lastActiveAt) : '—'}</td>
          <td>
            <button class="btn ${isBlocked ? 'btn-cyan' : 'btn-danger'} btn-sm toggle-block-btn"
                    data-id="${user._id}"
                    data-name="${escapeHTML(user.firstName)}"
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
    tableBody.innerHTML = errorRow(7, 'Failed to load users. Network error.');
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
  for (let i = 1; i <= pageInfo.pages; i++) {
    html += `<button class="btn ${i === pageInfo.page ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="window.setUserPage(${i})">${i}</button>`;
  }
  if (pageInfo.page < pageInfo.pages)
    html += `<button class="btn btn-secondary btn-sm" onclick="window.setUserPage(${pageInfo.page + 1})">Next →</button>`;
  html += '</div>';
  container.innerHTML = html;
}

window.setUserPage = (page) => { currentPage = page; loadUsersList(); };

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
document.getElementById('users-search')?.addEventListener('input', debounce(() => { currentPage = 1; loadUsersList(); }, 350));
document.getElementById('users-filter-status')?.addEventListener('change', () => { currentPage = 1; loadUsersList(); });

async function toggleUserStatus(id, name, newStatus) {
  const verb = newStatus === 'blocked' ? 'block' : 'unblock';
  const confirmed = await Confirm.show({
    title: newStatus === 'blocked' ? 'Block User' : 'Unblock User',
    message: `${newStatus === 'blocked' ? 'Block' : 'Unblock'} ${name}? ${newStatus === 'blocked' ? 'They will no longer receive bot responses.' : 'They will be able to use the bot again.'}`,
    confirmText: newStatus === 'blocked' ? 'Block User' : 'Unblock User',
    type: newStatus === 'blocked' ? 'danger' : 'warning',
  });
  if (!confirmed) return;

  try {
    const response = await API.patch(`/users/${id}/status`, { status: newStatus });
    if (response.status === 'success') {
      Toast.success(newStatus === 'blocked' ? 'User Blocked' : 'User Unblocked', `${name} has been ${verb}ed.`);
      await loadUsersList();
    } else {
      Toast.error('Failed', response.message);
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
