import { API } from './api.js';

window.addEventListener('load-storage', async () => {
  await Promise.all([loadStorageOverview(), loadStorageHealth()]);
});

async function loadStorageOverview() {
  const orphansTable = document.querySelector('#storage-orphans-table tbody');
  orphansTable.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Scanning storage orphans...</td></tr>`;

  try {
    const response = await API.get('/storage/overview');
    if (response.status !== 'success') return;

    document.getElementById('storage-total-count').textContent = response.totalManagedCount;
    document.getElementById('storage-s3-size').textContent = `${(response.approximateStorageUsage / (1024 * 1024)).toFixed(2)} MB`;
    document.getElementById('storage-orphans-count').textContent = response.orphans.length;

    if (response.orphans.length === 0) {
      orphansTable.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No orphaned objects found in storage bucket.</td></tr>`;
      return;
    }

    orphansTable.innerHTML = response.orphans.map(o => `
      <tr>
        <td style="word-break:break-all"><code>${escapeHTML(o.key)}</code></td>
        <td><code>${(o.size / 1024).toFixed(1)} KB</code></td>
        <td>
          <button class="btn btn-danger btn-sm clean-orphan-btn" data-key="${o.key}">Clean</button>
        </td>
      </tr>
    `).join('');

    // Bind clean buttons
    document.querySelectorAll('.clean-orphan-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.getAttribute('data-key');
        if (confirm(`Are you sure you want to delete this orphaned key from S3? This cannot be undone:\n\n${key}`)) {
          try {
            const res = await API.post('/storage/cleanup', { keys: [key] });
            if (res.status === 'success') {
              alert('Orphaned object deleted successfully!');
              await loadStorageOverview();
            } else {
              alert(res.message || 'Failed to delete orphan.');
            }
          } catch (err) {
            alert('Cleanup execution failed.');
          }
        }
      });
    });

  } catch (error) {
    orphansTable.innerHTML = `<tr><td colspan="3" class="text-center text-danger">Failed to scan storage overview. Network error.</td></tr>`;
  }
}

async function loadStorageHealth() {
  const healthTable = document.querySelector('#storage-health-table tbody');
  healthTable.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Analyzing content integrity...</td></tr>`;

  try {
    const response = await API.get('/maintenance/health-check');
    if (response.status !== 'success') return;

    const checklist = response.checklist;
    if (checklist.length === 0) {
      healthTable.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No content library records registered.</td></tr>`;
      return;
    }

    healthTable.innerHTML = checklist.map(item => {
      let badge = 'badge-success';
      if (item.severity === 'Warning') badge = 'badge-warning';
      if (item.severity === 'Broken') badge = 'badge-danger';

      return `
        <tr>
          <td><strong>${escapeHTML(item.title)}</strong> <small class="text-muted">(${escapeHTML(item.type)})</small></td>
          <td><span class="badge ${badge}">${escapeHTML(item.severity)}</span></td>
          <td>${item.issues ? `<span class="text-danger">${escapeHTML(item.issues)}</span>` : '<span class="text-muted">No issues detected</span>'}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    healthTable.innerHTML = `<tr><td colspan="3" class="text-center text-danger">Failed to load content health check.</td></tr>`;
  }
}
