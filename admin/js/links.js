import { API } from './api.js';
import { Toast } from './toast.js';
import { Confirm } from './confirm.js';

let linksCurrentPage = 1;
let linksSearchQuery = '';
let linksStatusFilter = '';

window.addEventListener('load-links', () => {
  linksCurrentPage = 1;
  loadLinksList();
});

// Event Listeners for Filters
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
  debounceTimer = setTimeout(() => {
    loadLinksList();
  }, 300);
}

async function loadLinksList() {
  const tableBody = document.querySelector('#links-table tbody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Loading links list...</td></tr>`;

  try {
    const activeBotId = localStorage.getItem('admin_active_bot_id') || '';
    
    // Construct Query Params
    const params = new URLSearchParams({
      page: linksCurrentPage,
      limit: 10,
      search: linksSearchQuery,
      status: linksStatusFilter
    });

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
      let autoDeleteText = 'None';
      if (link.autoDeleteSeconds) {
        const mins = link.autoDeleteSeconds / 60;
        if (mins < 60) {
          autoDeleteText = `${mins}m`;
        } else {
          const hrs = mins / 60;
          if (hrs < 24) {
            autoDeleteText = `${hrs}h`;
          } else {
            autoDeleteText = `${hrs / 24}d`;
          }
        }
      }

      const expiresTime = link.expiresAt ? new Date(link.expiresAt).toLocaleString() : 'Never';
      let statusColor = 'badge-secondary';
      if (link.status === 'active') statusColor = 'badge-success';
      if (link.status === 'inactive') statusColor = 'badge-warning';
      if (link.status === 'expired') statusColor = 'badge-danger';

      const toggleActionLabel = link.status === 'active' ? 'Deactivate' : 'Activate';
      const toggleActionClass = link.status === 'active' ? 'btn-warning' : 'btn-success';

      return `
        <tr>
          <td>${createdTime}</td>
          <td>
            <div><a href="${link.shareLink}" target="_blank" style="color:var(--accent-cyan); word-break:break-all">${link.shareLink}</a></div>
            <div style="font-size:0.75rem; color:var(--text-dim); margin-top:0.25rem">Token: <code>${link.token}</code></div>
          </td>
          <td><span class="badge badge-info">${link.items ? link.items.length : 0} items</span></td>
          <td>
            <div style="font-size:0.8rem">Link: <span class="text-muted">${expiresTime}</span></div>
            <div style="font-size:0.8rem; margin-top:0.15rem">Auto-Delete: <strong style="color:var(--primary)">${autoDeleteText}</strong></div>
          </td>
          <td><span class="badge ${statusColor}">${link.status.toUpperCase()}</span></td>
          <td>
            <div class="d-flex gap-2">
              <button class="btn btn-sm ${toggleActionClass} toggle-link-btn" data-token="${link.token}" data-status="${link.status}">
                ${toggleActionLabel}
              </button>
              <button class="btn btn-danger btn-sm delete-link-btn" data-token="${link.token}">
                Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Bind event listeners to Action Buttons
    tableBody.querySelectorAll('.toggle-link-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const token = btn.getAttribute('data-token');
        const currentStatus = btn.getAttribute('data-status');
        toggleLinkStatus(token, currentStatus);
      });
    });

    tableBody.querySelectorAll('.delete-link-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const token = btn.getAttribute('data-token');
        deleteLink(token);
      });
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

  if (!pageInfo || pageInfo.pages <= 1) {
    container.innerHTML = '';
    return;
  }

  const { page, pages } = pageInfo;
  let html = `<div class="pagination-wrapper d-flex justify-center align-center gap-2 mt-4">`;

  if (page > 1) {
    html += `<button class="btn btn-secondary btn-sm" onclick="changeLinksPage(${page - 1})">Prev</button>`;
  }

  html += `<span style="font-size:0.85rem" class="text-muted">Page ${page} of ${pages}</span>`;

  if (page < pages) {
    html += `<button class="btn btn-secondary btn-sm" onclick="changeLinksPage(${page + 1})">Next</button>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

window.changeLinksPage = function(pageNumber) {
  linksCurrentPage = pageNumber;
  loadLinksList();
};

async function toggleLinkStatus(token, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  try {
    const res = await API.patch(`/links/${token}/status`, { status: newStatus });
    if (res.status === 'success') {
      Toast.success('Status Updated', `Link status updated to ${newStatus}.`);
      loadLinksList();
    } else {
      Toast.error('Update Failed', res.message || 'Could not update status.');
    }
  } catch (error) {
    Toast.error('Network Error', 'Failed to toggle status.');
  }
}

async function deleteLink(token) {
  const confirmed = await Confirm.show({
    title: 'Delete Link',
    message: `Are you sure you want to delete the link with token: ${token}? This action cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    type: 'danger'
  });

  if (!confirmed) return;

  try {
    const res = await API.delete(`/links/${token}`);
    if (res.status === 'success') {
      Toast.success('Deleted', 'Link deleted successfully.');
      loadLinksList();
    } else {
      Toast.error('Delete Failed', res.message || 'Could not delete link.');
    }
  } catch (error) {
    Toast.error('Network Error', 'Failed to delete link.');
  }
}
