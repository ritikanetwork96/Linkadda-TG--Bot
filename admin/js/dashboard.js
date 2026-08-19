import { API } from './api.js';
import { Toast } from './toast.js';
import { Confirm } from './confirm.js';

window.addEventListener('load-dashboard', async () => {
  const metricsContainer = document.getElementById('dashboard-metrics');

  // Show skeleton loading for metrics
  metricsContainer.innerHTML = Array(5).fill(0).map(() => `
    <div class="metric-card">
      <div class="skeleton" style="height:10px;width:60%;margin-bottom:0.6rem;"></div>
      <div class="skeleton" style="height:28px;width:40%;margin-bottom:0.4rem;"></div>
      <div class="skeleton" style="height:9px;width:70%;"></div>
    </div>
  `).join('');

  // 1. Fetch Demo Environment Status
  checkDemoStatus();

  // 2. Fetch Dashboard Metrics and Recents
  try {
    const response = await API.get('/dashboard');
    if (response.status !== 'success') {
      Toast.error('Dashboard Error', response.message);
      return;
    }

    const { metrics, recentContent, recentUsers } = response;

    metricsContainer.innerHTML = `
      <div class="metric-card">
        <span class="metric-dot green"></span>
        <h3>Total Users</h3>
        <div class="value">${metrics.totalUsers.toLocaleString()}</div>
        <div class="sub-value text-success">+${metrics.usersToday} today</div>
      </div>
      <div class="metric-card">
        <span class="metric-dot blue"></span>
        <h3>Active Users</h3>
        <div class="value">${metrics.activeUsers.toLocaleString()}</div>
        <div class="sub-value">${((metrics.activeUsers / (metrics.totalUsers || 1)) * 100).toFixed(0)}% engagement</div>
      </div>
      <div class="metric-card">
        <span class="metric-dot purple"></span>
        <h3>Content Items</h3>
        <div class="value">${metrics.totalContent.toLocaleString()}</div>
        <div class="sub-value">${metrics.activeContent} active</div>
      </div>
      <div class="metric-card">
        <span class="metric-dot purple"></span>
        <h3>Start Content</h3>
        <div class="value">${metrics.startContentCount}</div>
        <div class="sub-value">/ 25 max</div>
      </div>
      <div class="metric-card">
        <span class="metric-dot amber"></span>
        <h3>Pending Deletes</h3>
        <div class="value text-warning">${metrics.pendingDeletions}</div>
        <div class="sub-value">Scheduled</div>
      </div>
    `;

    // Recent Users
    const usersBody = document.querySelector('#dashboard-users-table tbody');
    if (recentUsers.length === 0) {
      usersBody.innerHTML = `<tr><td colspan="3" class="text-center text-dim" style="padding:1.5rem">No users yet</td></tr>`;
    } else {
      usersBody.innerHTML = recentUsers.map(user => `
        <tr>
          <td><strong>${escapeHTML(user.firstName)} ${escapeHTML(user.lastName || '')}</strong></td>
          <td>${user.username ? '@' + escapeHTML(user.username) : '<span class="text-dim">—</span>'}</td>
          <td class="text-dim">${fmtDate(user.createdAt)}</td>
        </tr>
      `).join('');
    }

    // Recent Content
    const contentBody = document.querySelector('#dashboard-content-table tbody');
    if (recentContent.length === 0) {
      contentBody.innerHTML = `<tr><td colspan="3" class="text-center text-dim" style="padding:1.5rem">No content yet</td></tr>`;
    } else {
      contentBody.innerHTML = recentContent.map(item => `
        <tr>
          <td><strong>${escapeHTML(item.title)}</strong></td>
          <td><span class="badge badge-info">${escapeHTML(item.type)}</span></td>
          <td><span class="badge ${item.status === 'active' ? 'badge-success' : 'badge-neutral'}">${escapeHTML(item.status)}</span></td>
        </tr>
      `).join('');
    }
  } catch (error) {
    Toast.error('Dashboard Failed', 'Could not load dashboard data.');
    document.getElementById('dashboard-metrics').innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-dim)">
        Failed to load metrics. 
        <button class="btn btn-secondary btn-sm" style="margin-left:0.5rem" onclick="window.dispatchEvent(new CustomEvent('load-dashboard'))">Retry</button>
      </div>`;
  }
});

// Check status helper
async function checkDemoStatus() {
  const statusText = document.getElementById('demo-status-text');
  const actionsContainer = document.getElementById('demo-actions-container');
  if (!statusText || !actionsContainer) return;

  try {
    const res = await API.get('/system/demo-status');
    if (res.status === 'success') {
      if (res.loaded) {
        statusText.textContent = 'Loaded';
        statusText.className = 'text-success';
        actionsContainer.innerHTML = `
          <button class="btn btn-secondary btn-sm" id="btn-view-demo-packs">View Packs</button>
          <button class="btn btn-danger btn-sm" id="btn-remove-demo-data">Remove Demo</button>
        `;
        
        document.getElementById('btn-view-demo-packs')?.addEventListener('click', () => {
          window.location.hash = 'content-packs';
        });

        document.getElementById('btn-remove-demo-data')?.addEventListener('click', handleRemoveDemo);
      } else {
        statusText.textContent = 'Not Loaded';
        statusText.className = 'text-dim';
        actionsContainer.innerHTML = `
          <button class="btn btn-primary btn-sm" id="btn-load-demo-data">Load Demo Data</button>
        `;

        document.getElementById('btn-load-demo-data')?.addEventListener('click', handleLoadDemo);
      }
    } else {
      statusText.textContent = 'Error';
      statusText.className = 'text-danger';
      statusText.title = res.message || 'Unknown error';
      actionsContainer.innerHTML = `<span class="text-dim" style="font-size:0.75rem">${escapeHTML(res.message || 'Error occurred')}</span>`;
    }
  } catch {
    statusText.textContent = 'Error';
    statusText.className = 'text-danger';
  }
}

// Load demo handler
async function handleLoadDemo(e) {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    const res = await API.post('/system/seed-demo');
    if (res.status === 'success') {
      Toast.success('Workspace Loaded', 'Demo categories, contents, and packs loaded successfully.');
      // Re-trigger dashboard load to refresh counts
      window.dispatchEvent(new CustomEvent('load-dashboard'));
    } else {
      Toast.error('Load Failed', res.message);
      btn.disabled = false;
      btn.textContent = 'Load Demo Data';
    }
  } catch {
    Toast.error('Connection Error', 'Could not load demo data.');
    btn.disabled = false;
    btn.textContent = 'Load Demo Data';
  }
}

// Remove demo handler
async function handleRemoveDemo(e) {
  const confirmed = await Confirm.show({
    title: 'Clean Demo Data?',
    message: 'This will permanently remove all isDemo=true Categories, Content items, and Content Packs. Real records will not be touched.',
    confirmText: 'Remove Demo',
    cancelText: 'Keep Data',
    type: 'danger'
  });
  if (!confirmed) return;

  const btn = e.target;
  btn.disabled = true;
  btn.textContent = 'Clearing...';

  try {
    const res = await API.delete('/system/clear-demo');
    if (res.status === 'success') {
      Toast.success('Workspace Cleaned', 'All demo data removed successfully.');
      window.dispatchEvent(new CustomEvent('load-dashboard'));
    } else {
      Toast.error('Clean Failed', res.message);
      btn.disabled = false;
      btn.textContent = 'Remove Demo';
    }
  } catch {
    Toast.error('Connection Error', 'Could not delete demo data.');
    btn.disabled = false;
    btn.textContent = 'Remove Demo';
  }
}
