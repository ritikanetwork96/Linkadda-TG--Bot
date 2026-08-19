import { API } from './api.js';
import { Toast } from './toast.js';

let currentRange = '7d';

window.addEventListener('load-analytics', () => loadAnalytics());

async function loadAnalytics() {
  // Set loading state for kpi boxes
  ['analytics-total-starts','analytics-today-starts','analytics-file-requests',
   'analytics-file-deliveries','analytics-search-count','analytics-deep-link-views'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });

  const contentTableBody = document.querySelector('#analytics-content-table tbody');
  const catTableBody     = document.querySelector('#analytics-category-table tbody');
  const bcTableBody      = document.querySelector('#analytics-broadcasts-table tbody');

  [contentTableBody, catTableBody, bcTableBody].forEach(tb => {
    if (tb) tb.innerHTML = `<tr><td colspan="6" class="text-center text-dim" style="padding:1.25rem">
      <div class="spinner" style="margin:0 auto"></div>
    </td></tr>`;
  });

  try {
    const response = await API.get(`/analytics?range=${currentRange}`);
    if (response.status !== 'success') {
      Toast.error('Analytics Error', response.message || 'Could not load analytics data.');
      return;
    }

    const { metrics, topContent, topCategories, broadcasts } = response;

    // KPI Boxes
    const setKpi = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '0'; };
    setKpi('analytics-total-starts',    metrics.totalStarts?.toLocaleString() || '0');
    setKpi('analytics-today-starts',    `+${metrics.todayStarts || 0} today`);
    setKpi('analytics-file-requests',   metrics.contentRequests?.toLocaleString() || '0');
    setKpi('analytics-file-deliveries', `${metrics.contentDeliveries || 0} delivered`);
    setKpi('analytics-search-count',    metrics.searchCount?.toLocaleString() || '0');
    setKpi('analytics-deep-link-views', metrics.deepLinkOpens?.toLocaleString() || '0');

    // Top Content
    if (topContent.length === 0) {
      contentTableBody.innerHTML = emptyRow(4, 'No content requests yet');
    } else {
      contentTableBody.innerHTML = topContent.map((item, i) => `
        <tr>
          <td><code>${i + 1}</code></td>
          <td style="font-weight:600;color:var(--text)">${escapeHTML(item.title)}</td>
          <td><span class="badge badge-info">${escapeHTML(item.type)}</span></td>
          <td><code>${escapeHTML(String(item.requests))}</code></td>
          <td style="color:var(--text-cyan);font-weight:600">${escapeHTML(String(item.deliveries))}</td>
        </tr>
      `).join('');
    }

    // Top Categories
    if (topCategories.length === 0) {
      catTableBody.innerHTML = emptyRow(3, 'No category views yet');
    } else {
      catTableBody.innerHTML = topCategories.map((cat, i) => `
        <tr>
          <td><code>${i + 1}</code></td>
          <td style="font-weight:600;color:var(--text)">${escapeHTML(cat.name)}</td>
          <td><code>${escapeHTML(String(cat.views))}</code></td>
          <td><code>${escapeHTML(String(cat.requests))}</code></td>
        </tr>
      `).join('');
    }

    // Broadcasts
    if (broadcasts.length === 0) {
      bcTableBody.innerHTML = emptyRow(6, 'No broadcasts yet');
    } else {
      bcTableBody.innerHTML = broadcasts.map(b => {
        const statusClass = { completed:'badge-success', failed:'badge-danger', processing:'badge-warning' }[b.status] || 'badge-neutral';
        return `
          <tr>
            <td style="font-weight:600;color:var(--text)">${escapeHTML(b.title)}</td>
            <td><span class="badge ${statusClass}">${escapeHTML(b.status)}</span></td>
            <td><code>${escapeHTML(String(b.targetedCount))}</code></td>
            <td style="color:var(--text-cyan);font-weight:600">${escapeHTML(String(b.sentCount))}</td>
            <td>${b.failedCount > 0 ? `<span class="text-danger">${b.failedCount} failed</span>` : '—'}</td>
            <td class="text-dim">${fmtDate(b.createdAt)}</td>
          </tr>
        `;
      }).join('');
    }

  } catch (err) {
    Toast.error('Analytics Failed', 'Could not load analytics data. Network error.');
  }
}

// Date range tabs
document.querySelectorAll('.date-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.date-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentRange = tab.dataset.range || '7d';
    loadAnalytics();
  });
});

function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" class="text-center text-dim" style="padding:1rem">${msg}</td></tr>`;
}
