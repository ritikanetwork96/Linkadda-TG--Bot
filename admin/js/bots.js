import { API } from './api.js';

window.addEventListener('load-bots', async () => {
  await loadBotsPool();
});

// Load the switcher globally on DOM Load
document.addEventListener('DOMContentLoaded', async () => {
  await populateGlobalBotSwitcher();
  
  // Bind change handler on switcher
  const switcher = document.getElementById('active-bot-switcher');
  if (switcher) {
    switcher.addEventListener('change', () => {
      const selectedBotId = switcher.value;
      localStorage.setItem('admin_active_bot_id', selectedBotId);
      
      // Reload the active tab panel data!
      const activeTab = document.querySelector('.menu-items li.active');
      if (activeTab) {
        const tabId = activeTab.getAttribute('data-target');
        window.dispatchEvent(new CustomEvent(`load-${tabId}`));
      }
    });
  }
});



export async function populateGlobalBotSwitcher() {
  const switcher = document.getElementById('active-bot-switcher');
  if (!switcher) return;

  try {
    const response = await API.get('/bots');
    if (response.status !== 'success') return;

    const bots = response.bots;
    if (bots.length === 0) {
      switcher.innerHTML = '<option value="">No registered bots</option>';
      return;
    }

    switcher.innerHTML = `
      <option value="all">🌍 All Bots (Global View)</option>
    ` + bots.map(b => `
      <option value="${b._id}" ${b.status === 'connected' ? 'selected' : ''}>
        ${escapeHTML(b.displayName)} ${b.username ? `(@${escapeHTML(b.username)})` : ''}
      </option>
    `).join('');

    const savedBotId = localStorage.getItem('admin_active_bot_id');
    if (savedBotId && (savedBotId === 'all' || bots.some(b => b._id === savedBotId))) {
      switcher.value = savedBotId;
    } else {
      const activeConnected = bots.find(b => b.status === 'connected');
      if (activeConnected) {
        switcher.value = activeConnected._id;
        localStorage.setItem('admin_active_bot_id', activeConnected._id);
      } else {
        switcher.value = bots[0]._id;
        localStorage.setItem('admin_active_bot_id', bots[0]._id);
      }
    }
  } catch (err) {
    console.error('Failed to populate bot switcher:', err.message);
  }
}

async function loadBotsPool() {
  const tableBody = document.querySelector('#bots-list-table tbody');
  tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Loading configured bots pool...</td></tr>`;

  try {
    const response = await API.get('/bots');
    if (response.status !== 'success') return;

    const bots = response.bots;
    if (bots.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No bots registered. Use form on the right.</td></tr>`;
      return;
    }

    tableBody.innerHTML = bots.map(b => {
      let statusColor = 'badge-secondary';
      if (b.status === 'connected') statusColor = 'badge-success';
      if (b.status === 'error') statusColor = 'badge-danger';

      return `
        <tr>
          <td><strong>${escapeHTML(b.displayName)}</strong></td>
          <td>${b.username ? `<a href="https://t.me/${b.username}" target="_blank" style="color:var(--accent-cyan)">@${escapeHTML(b.username)}</a>` : '<span class="text-muted">Unlinked</span>'}</td>
          <td><span class="badge ${statusColor}">${escapeHTML(b.status.toUpperCase())}</span></td>
          <td>
            <div class="d-flex gap-2">
              <button class="btn btn-secondary btn-sm test-bot-btn" data-id="${b._id}">Test Connection</button>
              ${b.status !== 'connected' ? `<button class="btn btn-primary btn-sm activate-bot-btn" data-id="${b._id}">Activate</button>` : '<span class="badge badge-success text-center">ACTIVE</span>'}
              <button class="btn btn-danger btn-sm delete-bot-btn" data-id="${b._id}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Bind Test Connection
    document.querySelectorAll('.test-bot-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        btn.disabled = true;
        btn.textContent = 'Testing...';
        try {
          const res = await API.post(`/bots/${id}/test`);
          btn.disabled = false;
          btn.textContent = 'Test Connection';
          alert(res.message || 'Verification complete.');
          await loadBotsPool();
          await populateGlobalBotSwitcher();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Test Connection';
          alert('Failed to connect to Telegram API.');
        }
      });
    });

    // Bind Activate Bot
    document.querySelectorAll('.activate-bot-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Are you sure you want to activate this bot token listener? Current bot listener will stop.')) {
          try {
            const res = await API.patch(`/bots/${id}/activate`);
            alert(res.message || 'Bot listener activated successfully!');
            await loadBotsPool();
            await populateGlobalBotSwitcher();
          } catch (err) {
            alert('Failed to activate bot token.');
          }
        }
      });
    });

    // Bind Delete Bot
    document.querySelectorAll('.delete-bot-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Are you sure you want to delete this bot configuration?')) {
          try {
            const res = await API.delete(`/bots/${id}`);
            if (res.status === 'success') {
              alert('Bot configuration deleted successfully!');
              await loadBotsPool();
              await populateGlobalBotSwitcher();
            } else {
              alert(res.message || 'Failed to delete bot config.');
            }
          } catch (err) {
            alert('Delete execution failed.');
          }
        }
      });
    });

  } catch (error) {
    tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">Failed to load bots pool.</td></tr>`;
  }
}

// Bot Token Form Submit
document.getElementById('botTokenForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const displayName = document.getElementById('botDisplayNameInput').value.trim();
  const token = document.getElementById('botTokenInput').value.trim();

  if (!displayName || !token) return;

  const submitBtn = document.getElementById('btn-save-bot-token');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving & Verifying...';

  try {
    const res = await API.post('/bots', { displayName, token });
    if (res.status === 'success') {
      alert('Bot configuration registered! Testing connection...');
      // Auto test connection
      const testRes = await API.post(`/bots/${res.bot._id}/test`);
      alert(testRes.message);
      
      document.getElementById('botTokenForm').reset();
      await loadBotsPool();
      await populateGlobalBotSwitcher();
    } else {
      alert(res.message || 'Failed to register bot.');
    }
  } catch (err) {
    alert('Failed to register bot token.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save & Verify Bot';
  }
});
