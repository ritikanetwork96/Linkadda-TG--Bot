import { API } from './api.js';
import { Toast } from './toast.js';

let currentPage = 1;
const PAGE_SIZE = 20;

window.addEventListener('load-logs', () => loadLogsList());

async function loadLogsList() {
  const tableBody = document.querySelector('#logs-table tbody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-dim" style="padding:1.5rem">
    <div class="spinner" style="margin:0 auto 0.5rem"></div>Loading audit logs...
  </td></tr>`;

  const action = document.getElementById('logs-filter-action')?.value;
  const status = document.getElementById('logs-filter-status')?.value;

  const q = new URLSearchParams({ page: currentPage, limit: PAGE_SIZE });
  if (action) q.set('action', action);
  if (status) q.set('status', status);

  try {
    const response = await API.get(`/logs?${q.toString()}`);
    if (response.status !== 'success') {
      tableBody.innerHTML = errorRow();
      return;
    }

    const logs = response.logs;
    const pagination = response.pagination;

    if (logs.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="5">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          <h4>No logs found</h4>
          <p>No activity logs match your current filters.</p>
        </div>
      </td></tr>`;
      renderPagination(pagination);
      return;
    }

    tableBody.innerHTML = logs.map(log => `
      <tr>
        <td><code class="fs-xs">${fmtDateTime(log.timestamp)}</code></td>
        <td>
          <div style="font-weight:600;color:var(--text)">${escapeHTML(log.action)}</div>
          ${log.metadata ? `<small class="text-dim fs-xs">${escapeHTML(JSON.stringify(log.metadata)).substring(0, 80)}</small>` : ''}
        </td>
        <td class="text-dim">${escapeHTML(log.resourceType || '—')}</td>
        <td>
          <div style="font-weight:500">${log.adminId ? escapeHTML(log.adminId.name || log.adminId.email) : '<span class="text-dim">System</span>'}</div>
          ${log.adminId?.email && log.adminId.email !== log.adminId.name ? `<small class="text-dim fs-xs">${escapeHTML(log.adminId.email)}</small>` : ''}
        </td>
        <td><span class="badge ${log.status === 'success' ? 'badge-success' : 'badge-danger'}">${escapeHTML(log.status)}</span></td>
      </tr>
    `).join('');

    renderPagination(pagination);
  } catch {
    tableBody.innerHTML = errorRow();
    Toast.error('Load Failed', 'Could not load audit logs.');
  }
}

function renderPagination(pageInfo) {
  const container = document.getElementById('logs-pagination');
  if (!container) return;
  if (!pageInfo || pageInfo.pages <= 1) { container.innerHTML = ''; return; }

  let html = '<div class="pagination">';
  if (pageInfo.page > 1)
    html += `<button class="btn btn-secondary btn-sm" onclick="window.setLogsPage(${pageInfo.page - 1})">← Prev</button>`;
  for (let i = 1; i <= Math.min(pageInfo.pages, 8); i++) {
    html += `<button class="btn ${i === pageInfo.page ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="window.setLogsPage(${i})">${i}</button>`;
  }
  if (pageInfo.page < pageInfo.pages)
    html += `<button class="btn btn-secondary btn-sm" onclick="window.setLogsPage(${pageInfo.page + 1})">Next →</button>`;
  html += '</div>';
  container.innerHTML = html;
}

window.setLogsPage = (page) => { currentPage = page; loadLogsList(); };

// Filters
document.getElementById('logs-filter-action')?.addEventListener('change', () => { currentPage = 1; loadLogsList(); });
document.getElementById('logs-filter-status')?.addEventListener('change', () => { currentPage = 1; loadLogsList(); });

function errorRow() {
  return `<tr><td colspan="5">
    <div class="empty-state">
      <h4>Failed to load</h4><p>Could not load audit logs.</p>
      <button class="btn btn-secondary btn-sm" onclick="window.dispatchEvent(new CustomEvent('load-logs'))">Retry</button>
    </div>
  </td></tr>`;
}
