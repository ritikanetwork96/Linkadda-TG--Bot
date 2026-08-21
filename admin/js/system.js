import { API } from './api.js';

window.addEventListener('load-system-health', async () => {
  await loadSystemStats();
});

async function loadSystemStats() {
  try {
    const res = await API.get('/system/info');
    if (res.status !== 'success') return;

    // Convert seconds to human readable
    const minutes = Math.floor(res.uptime / 60);
    const hours = Math.floor(minutes / 60);
    const uptimeStr = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;

    document.getElementById('system-uptime').textContent = uptimeStr;
    document.getElementById('system-memory').textContent = `${(res.memoryUsage.rss / (1024 * 1024)).toFixed(1)} MB`;
    document.getElementById('system-db-status').textContent = res.dbStatus;
    
    if (res.dbStatus !== 'Connected') {
      document.getElementById('system-db-status').style.color = 'var(--text-danger)';
    }

    // Render bot statuses
    updateBotStatusRow('row-user-bot', res.userBot);
    updateBotStatusRow('row-admin-bot', res.adminBot);

  } catch (err) {
    console.error('System Stats Load Error:', err.message);
  }
}

function updateBotStatusRow(rowId, botData) {
  const row = document.getElementById(rowId);
  if (!row || !botData) return;

  const statusEl = row.querySelector('td:nth-child(2)');
  const checkEl = row.querySelector('.last-check');
  const updateEl = row.querySelector('.last-update');
  const attemptsEl = row.querySelector('.attempts');
  const errorEl = row.querySelector('.last-error');

  let statusBadge = '';
  if (botData.state === 'running') {
    statusBadge = '<span class="badge badge-success">🟢 Running</span>';
  } else if (botData.state === 'reconnecting' || botData.state === 'starting') {
    statusBadge = '<span class="badge badge-warning">🟡 Reconnecting</span>';
  } else if (botData.state === 'failed') {
    statusBadge = '<span class="badge badge-danger">🔴 Failed</span>';
  } else {
    statusBadge = '<span class="badge badge-secondary">⚪ Stopped</span>';
  }

  statusEl.innerHTML = statusBadge;
  checkEl.textContent = botData.lastSuccessfulCheck ? fmtDateTime(botData.lastSuccessfulCheck) : '-';
  updateEl.textContent = botData.lastUpdate ? fmtDateTime(botData.lastUpdate) : '-';
  attemptsEl.textContent = botData.reconnectAttempts || 0;
  
  if (botData.lastError) {
    errorEl.textContent = botData.lastError;
    errorEl.classList.remove('text-muted');
    errorEl.style.color = 'var(--text-danger)';
  } else {
    errorEl.textContent = '-';
    errorEl.classList.add('text-muted');
    errorEl.style.color = '';
  }
}

// Data Export Trigger
document.getElementById('btn-export-csv').addEventListener('click', async () => {
  const resource = document.getElementById('export-resource-select').value;
  try {
    // Retrieve active bot switcher context if present
    const botSelector = document.getElementById('active-bot-switcher');
    const activeBotId = botSelector ? botSelector.value : '';

    const headers = {};
    if (activeBotId) headers['X-Bot-ID'] = activeBotId;

    const res = await API.getBlob(`/export/${resource}`, headers);
    const url = window.URL.createObjectURL(res);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resource}_export_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    alert('Failed to export CSV. Network error.');
  }
});

// CSV Import variables
const importForm = document.getElementById('csvImportForm');
const previewBtn = document.getElementById('btn-import-preview');
const commitBtn = document.getElementById('btn-import-commit');
const previewResults = document.getElementById('import-preview-results');

let currentImportFile = null;

importForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('csvImportFile');
  if (fileInput.files.length === 0) return;

  currentImportFile = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', currentImportFile);

  previewBtn.disabled = true;
  previewBtn.textContent = 'Processing preview...';

  try {
    const botSelector = document.getElementById('active-bot-switcher');
    const activeBotId = botSelector ? botSelector.value : '';
    const headers = {};
    if (activeBotId) headers['X-Bot-ID'] = activeBotId;

    const res = await API.post('/import/content?dryRun=true', formData, headers);
    previewBtn.disabled = false;
    previewBtn.textContent = 'Dry-Run Preview';

    if (res.status === 'success') {
      const summary = res.summary;
      previewResults.classList.remove('d-none');
      
      previewResults.innerHTML = `
        <h4 style="font-family:'Outfit'; font-size:0.95rem" class="mb-2">Dry-Run Results:</h4>
        <ul style="list-style:none; padding:0; display:flex; flex-direction:column; gap:0.4rem; font-size:0.85rem">
          <li>Total rows parsed: <strong>${summary.totalRows}</strong></li>
          <li>Valid new items: <strong class="text-success">${summary.validRows}</strong></li>
          <li>Conflicts (existing titles): <strong class="text-warning">${summary.previews.existingConflicts.length}</strong></li>
          <li>Invalid rows (validation failed): <strong class="text-danger">${summary.invalidRows}</strong></li>
        </ul>
      `;

      if (summary.validRows > 0) {
        commitBtn.classList.remove('d-none');
      } else {
        commitBtn.classList.add('d-none');
      }
    } else {
      alert(res.message || 'Import dry-run processing failed.');
    }
  } catch (err) {
    previewBtn.disabled = false;
    previewBtn.textContent = 'Dry-Run Preview';
    alert('Import dry-run failed. Check file format.');
  }
});

commitBtn.addEventListener('click', async () => {
  if (!currentImportFile) return;
  
  const formData = new FormData();
  formData.append('file', currentImportFile);

  commitBtn.disabled = true;
  commitBtn.textContent = 'Importing data...';

  try {
    const botSelector = document.getElementById('active-bot-switcher');
    const activeBotId = botSelector ? botSelector.value : '';
    const headers = {};
    if (activeBotId) headers['X-Bot-ID'] = activeBotId;

    const res = await API.post('/import/content?dryRun=false', formData, headers);
    commitBtn.disabled = false;
    commitBtn.textContent = 'Commit Import';

    if (res.status === 'success') {
      const summary = res.summary;
      alert(`Import completed successfully! ${summary.importedRows} items created.`);
      importForm.reset();
      previewResults.classList.add('d-none');
      commitBtn.classList.add('d-none');
    } else {
      alert(res.message || 'Import failed.');
    }
  } catch (err) {
    commitBtn.disabled = false;
    commitBtn.textContent = 'Commit Import';
    alert('Failed to execute metadata import.');
  }
});
