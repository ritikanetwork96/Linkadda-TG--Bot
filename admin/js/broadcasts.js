import { API } from './api.js';
import { Toast } from './toast.js';

window.addEventListener('load-broadcasts', () => loadBroadcastsList());

async function loadBroadcastsList() {
  const tableBody = document.querySelector('#broadcasts-table tbody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-dim" style="padding:1.5rem">
    <div class="spinner" style="margin:0 auto 0.5rem"></div>Loading broadcast history...
  </td></tr>`;

  try {
    const response = await API.get('/broadcasts');
    if (response.status !== 'success') {
      tableBody.innerHTML = errorRow();
      return;
    }

    const broadcasts = response.broadcasts;
    if (broadcasts.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/></svg>
          <h4>No broadcasts yet</h4>
          <p>Create your first broadcast to reach your users.</p>
          <button class="btn btn-primary btn-sm" onclick="document.getElementById('btn-create-broadcast').click()">Create Broadcast</button>
        </div>
      </td></tr>`;
      return;
    }

    tableBody.innerHTML = broadcasts.map(b => {
      const statusClass = { completed: 'badge-success', failed: 'badge-danger', processing: 'badge-warning', scheduled: 'badge-info' }[b.status] || 'badge-neutral';
      return `
        <tr>
          <td>
            <div style="font-weight:600;color:var(--text)">${escapeHTML(b.title)}</div>
            ${b.errorMessage ? `<small class="text-danger">${escapeHTML(b.errorMessage.substring(0, 80))}</small>` : ''}
          </td>
          <td><span class="badge badge-info">${escapeHTML(b.type)}</span></td>
          <td><span class="badge ${statusClass}">${escapeHTML(b.status)}</span></td>
          <td><code>${escapeHTML(String(b.sentCount))} / ${escapeHTML(String(b.targetedCount))}</code></td>
          <td>
            ${b.failedCount > 0  ? `<span class="text-danger">${b.failedCount} failed</span><br>` : ''}
            ${b.blockedCount > 0 ? `<span class="text-dim">${b.blockedCount} blocked</span>` : '—'}
          </td>
          <td class="text-dim">${fmtDateTime(b.createdAt)}</td>
        </tr>
      `;
    }).join('');
  } catch {
    tableBody.innerHTML = errorRow();
    Toast.error('Load Failed', 'Could not load broadcast history.');
  }
}

// Open modal
document.getElementById('btn-create-broadcast')?.addEventListener('click', () => {
  document.getElementById('broadcastForm')?.reset();
  toggleBroadcastFields('text');
  openModal('broadcast-editor');
});

// Type toggle
const broadcastTypeSelect = document.getElementById('broadcast-type');
broadcastTypeSelect?.addEventListener('change', () => toggleBroadcastFields(broadcastTypeSelect.value));

function toggleBroadcastFields(type) {
  const fileGroup = document.getElementById('broadcast-file-group');
  const fileInput = document.getElementById('broadcast-file');
  const isFile    = ['photo','video','document'].includes(type);

  if (fileGroup) fileGroup.classList.toggle('d-none', !isFile);
  if (fileInput) {
    fileInput.required = isFile;
    if (!isFile) fileInput.value = '';
    fileInput.accept = type === 'photo' ? 'image/*' : type === 'video' ? 'video/*' : '*/*';
  }
}

// Form Submit
document.getElementById('broadcastForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('[type="submit"]');
  const type      = broadcastTypeSelect?.value || 'text';
  const isFile    = ['photo','video','document'].includes(type);

  const formData = new FormData();
  formData.append('title', document.getElementById('broadcast-title')?.value.trim() || '');
  formData.append('type',  type);
  formData.append('text',  document.getElementById('broadcast-text')?.value.trim() || '');

  const btnLabel = document.getElementById('broadcast-btn-label')?.value.trim();
  const btnUrl   = document.getElementById('broadcast-btn-url')?.value.trim();
  if (btnLabel && btnUrl) {
    formData.append('urlButtonLabel', btnLabel);
    formData.append('urlButtonUrl',   btnUrl);
  }

  const scheduledAt = document.getElementById('broadcast-scheduled-at')?.value;
  if (scheduledAt) formData.append('scheduledAt', new Date(scheduledAt).toISOString());

  if (isFile) {
    const fileInput = document.getElementById('broadcast-file');
    if (fileInput?.files.length > 0) formData.append('file', fileInput.files[0]);
  }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add('btn-loading'); submitBtn.textContent = 'Queuing'; }

  try {
    const response = await API.post('/broadcasts', formData);
    if (response.status === 'success') {
      closeModal('broadcast-editor', true);
      Toast.success('Broadcast Queued', scheduledAt ? 'Your broadcast has been scheduled.' : 'Broadcast is being sent to all users.');
      await loadBroadcastsList();
    } else {
      Toast.error('Broadcast Failed', response.message || 'Could not queue broadcast.');
    }
  } catch {
    Toast.error('Network Error', 'Failed to submit broadcast.');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('btn-loading'); submitBtn.textContent = 'Dispatch Broadcast'; }
  }
});

function errorRow() {
  return `<tr><td colspan="6">
    <div class="empty-state">
      <h4>Failed to load</h4><p>Could not load broadcast history.</p>
      <button class="btn btn-secondary btn-sm" onclick="window.dispatchEvent(new CustomEvent('load-broadcasts'))">Retry</button>
    </div>
  </td></tr>`;
}
