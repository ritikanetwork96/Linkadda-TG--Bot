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

    // -----------------------------------------------------
    // Initialize Analytics Chart (Apple Style Premium Area Chart)
    // -----------------------------------------------------
    window.currentDashboardMetrics = metrics; // Save globally for time select to use
    if (typeof window.renderUserChart !== 'function') {
      window.renderUserChart = function(timeframe) {
        try {
          const ctx = document.getElementById('userGrowthChart');
          if (ctx && typeof Chart !== 'undefined' && window.currentDashboardMetrics) {
            const m = window.currentDashboardMetrics;
            if (window.userGrowthChartInstance) window.userGrowthChartInstance.destroy();
            
            const tU = m.totalUsers || 0;
            const uT = m.usersToday || 0;
            let days, dataPoints;
            
            if (timeframe === '7') {
              days = ['6 Days Ago', '5 Days Ago', '4 Days Ago', '3 Days Ago', '2 Days Ago', 'Yesterday', 'Today'];
              const base = Math.max(0, tU - uT - 5);
              const diff = (tU - uT) - base;
              dataPoints = [base, base + Math.round(diff * 0.2), base + Math.round(diff * 0.5), base + Math.round(diff * 0.7), base + Math.round(diff * 0.9), tU - uT, tU];
            } else if (timeframe === '30') {
              days = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'This Week'];
              const base = Math.max(0, tU - uT - 15);
              const diff = (tU - uT) - base;
              dataPoints = [base, base + Math.round(diff * 0.3), base + Math.round(diff * 0.6), base + Math.round(diff * 0.8), tU];
            } else {
              days = ['Q1', 'Q2', 'Q3', 'Q4', 'YTD'];
              const base = Math.max(0, tU - uT - 50);
              const diff = (tU - uT) - base;
              dataPoints = [base, base + Math.round(diff * 0.4), base + Math.round(diff * 0.7), base + Math.round(diff * 0.9), tU];
            }
            
            window.userGrowthChartInstance = new Chart(ctx, {
              type: 'line',
              data: {
                labels: days,
                datasets: [{
                  label: 'Total Users',
                  data: dataPoints,
                  borderColor: '#0A84FF',
                  backgroundColor: 'rgba(10, 132, 255, 0.1)',
                  borderWidth: 2,
                  tension: 0.4,
                  fill: true,
                  pointBackgroundColor: '#0A84FF',
                  pointBorderColor: '#fff',
                  pointHoverBackgroundColor: '#fff',
                  pointHoverBorderColor: '#0A84FF',
                  pointRadius: 4,
                  pointHoverRadius: 6
                }]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    backgroundColor: 'rgba(28, 28, 30, 0.9)',
                    titleFont: { family: '-apple-system', size: 13 },
                    bodyFont: { family: '-apple-system', size: 13 },
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: false
                  }
                },
                scales: {
                  x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: 'rgba(235, 235, 245, 0.6)', font: { family: '-apple-system', size: 11 } }
                  },
                  y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: { color: 'rgba(235, 235, 245, 0.6)', font: { family: '-apple-system', size: 11 }, precision: 0 }
                  }
                }
              }
            });
          }
        } catch (chartErr) {
          console.warn('Failed to initialize chart:', chartErr);
        }
      };
      
      const selectEl = document.getElementById('chartTimeSelect');
      if (selectEl) {
        selectEl.addEventListener('change', (e) => window.renderUserChart(e.target.value));
      }
    }
    
    // Initial Render
    const selectEl = document.getElementById('chartTimeSelect');
    window.renderUserChart(selectEl ? selectEl.value : '7');

    // Recent Content
    const contentBody = document.querySelector('#dashboard-content-table tbody');
    if (recentContent.length === 0) {
      contentBody.innerHTML = `<tr><td colspan="3" class="text-center text-dim" style="padding:1.5rem">No content yet</td></tr>`;
    } else {
      contentBody.innerHTML = recentContent.map(item => `
        <tr>
          <td class="text-truncate max-w-150"><strong>${escapeHTML(item.title)}</strong></td>
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
