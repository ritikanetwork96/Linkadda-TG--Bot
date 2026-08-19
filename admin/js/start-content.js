import { API } from './api.js';
import { Toast } from './toast.js';
import { Confirm } from './confirm.js';

let startContents = [];

window.addEventListener('load-start-content', () => loadStartContentList());

async function loadStartContentList() {
  const tableBody = document.querySelector('#start-content-table tbody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-dim" style="padding:1.5rem">
    <div class="spinner" style="margin:0 auto 0.5rem"></div>Loading start sequences...
  </td></tr>`;

  try {
    const response = await API.get('/start-content');
    if (response.status !== 'success') {
      tableBody.innerHTML = errorRow();
      return;
    }

    startContents = response.content;

    if (startContents.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="5">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          <h4>No start content</h4>
          <p>Mark content as "Start Content" from the Content page, or enable it in Settings.</p>
        </div>
      </td></tr>`;
      return;
    }

    renderStartContentsTable();
  } catch {
    tableBody.innerHTML = errorRow();
    Toast.error('Load Failed', 'Could not load start content list.');
  }
}

function renderStartContentsTable() {
  const tableBody = document.querySelector('#start-content-table tbody');
  if (!tableBody) return;

  tableBody.innerHTML = startContents.map((item, idx) => `
    <tr>
      <td><code>${idx + 1}</code></td>
      <td style="font-weight:600;color:var(--text)">${escapeHTML(item.title)}</td>
      <td><span class="badge badge-info">${escapeHTML(item.type)}</span></td>
      <td class="text-muted">${item.categoryId ? escapeHTML(item.categoryId.name || item.categoryId) : '<span class="text-dim">—</span>'}</td>
      <td>
        <div class="d-flex gap-2">
          <button class="btn btn-secondary btn-sm reorder-up-btn"   data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="Move Up">↑</button>
          <button class="btn btn-secondary btn-sm reorder-down-btn" data-idx="${idx}" ${idx === startContents.length - 1 ? 'disabled' : ''} title="Move Down">↓</button>
          <button class="btn btn-danger btn-sm remove-start-btn"    data-id="${item._id}" data-title="${escapeHTML(item.title)}" title="Remove from Start">Remove</button>
        </div>
      </td>
    </tr>
  `).join('');

  tableBody.querySelectorAll('.reorder-up-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      swapItems(idx, idx - 1);
    });
  });

  tableBody.querySelectorAll('.reorder-down-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      swapItems(idx, idx + 1);
    });
  });

  tableBody.querySelectorAll('.remove-start-btn').forEach(btn => {
    btn.addEventListener('click', () => removeStartContent(btn.dataset.id, btn.dataset.title));
  });
}

async function swapItems(idxA, idxB) {
  // Swap in memory and re-render immediately
  [startContents[idxA], startContents[idxB]] = [startContents[idxB], startContents[idxA]];
  renderStartContentsTable();

  const orders = startContents.map((item, index) => ({ id: item._id, sortOrder: index }));

  try {
    const response = await API.patch('/start-content/reorder', { orders });
    if (response.status !== 'success') {
      Toast.error('Reorder Failed', response.message || 'Could not save new order.');
      await loadStartContentList(); // revert
    }
  } catch {
    Toast.error('Network Error', 'Reorder sync failed.');
    await loadStartContentList();
  }
}

async function removeStartContent(id, title) {
  const confirmed = await Confirm.show({
    title: 'Remove from Start',
    message: `Remove "${title}" from the start sequence? The content item itself will NOT be deleted.`,
    confirmText: 'Remove',
    type: 'warning',
  });
  if (!confirmed) return;

  try {
    const response = await API.patch(`/content/${id}`, { isStartContent: false });
    if (response.status === 'success') {
      Toast.success('Removed', `"${title}" removed from start sequence.`);
      await loadStartContentList();
    } else {
      Toast.error('Failed', response.message);
    }
  } catch {
    Toast.error('Network Error', 'Could not remove start content.');
  }
}

function errorRow() {
  return `<tr><td colspan="5">
    <div class="empty-state">
      <h4>Failed to load</h4>
      <p>Could not load start content list.</p>
      <button class="btn btn-secondary btn-sm" onclick="window.dispatchEvent(new CustomEvent('load-start-content'))">Retry</button>
    </div>
  </td></tr>`;
}
