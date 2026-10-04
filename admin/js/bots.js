import { API } from './api.js';
import { Toast } from './toast.js';
import { Confirm } from './confirm.js';

// Helper to escape HTML characters safely
function escapeHTML(str) {
  if (str === undefined || str === null) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.addEventListener('load-bots', async () => {
  await loadBotsPool();
});

// Helper to refresh currently visible panel
function reloadActiveTab() {
  const activeTab = document.querySelector('.menu-items li.active');
  if (activeTab) {
    const tabId = activeTab.getAttribute('data-target');
    window.dispatchEvent(new CustomEvent(`load-${tabId}`));
  }
}

// Load the switcher globally on DOM Load
document.addEventListener('DOMContentLoaded', async () => {
  await populateGlobalBotSwitcher();
  
  // Bind change handler on switcher
  const switcher = document.getElementById('active-bot-switcher');
  if (switcher) {
    switcher.addEventListener('change', () => {
      const selectedBotId = switcher.value;
      localStorage.setItem('admin_active_bot_id', selectedBotId);
      reloadActiveTab();
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
  if (!tableBody) return;
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
            <div class="d-flex gap-2" style="flex-wrap: wrap;">
              <button class="btn btn-secondary btn-sm test-bot-btn" data-id="${b._id}">Test Connection</button>
              ${b.status !== 'connected' 
                ? `<button class="btn btn-primary btn-sm activate-bot-btn" data-id="${b._id}" data-name="${escapeHTML(b.displayName)}">Activate</button>` 
                : '<span class="badge badge-success text-center" style="display:flex;align-items:center;padding:4px 8px;">ACTIVE</span>'
              }
              <button class="btn btn-warning btn-sm migrate-bot-btn" data-id="${b._id}" data-name="${escapeHTML(b.displayName)}" title="Transfer all platform assets from other bots to this bot">🔄 Transfer Data</button>
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
          if (res.status === 'success') {
            Toast.success('Connection Verified', res.message || 'Verification complete.');
          } else {
            Toast.error('Connection Failed', res.message || 'Verification failed.');
          }
          await loadBotsPool();
          await populateGlobalBotSwitcher();
        } catch (err) {
          Toast.error('Connection Error', 'Failed to connect to Telegram API.');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Test Connection';
        }
      });
    });

    // Bind Activate Bot with Auto-Data Transfer
    document.querySelectorAll('.activate-bot-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name') || 'this bot';

        const transfer = await Confirm.show({
          title: `Activate "${name}"?`,
          message: `Activate "${name}" as your live Telegram bot?\n\nThis will TRANSFER ALL PLATFORM DATA (Categories, Media, Content Packs, Links, Users & Settings) from your previous bot to "${name}" so everything works seamlessly.`,
          confirmText: 'Activate & Transfer Data',
          cancelText: 'Cancel',
          type: 'warning'
        });

        if (!transfer) return;

        btn.disabled = true;
        btn.textContent = 'Activating...';

        try {
          const res = await API.patch(`/bots/${id}/activate`, { transferData: true });
          if (res.status === 'success') {
            const m = res.migrationStats || {};
            Toast.success('Bot Activated & Data Transferred', `Live listener switched to @${res.botInfo?.username || name}!`);
            localStorage.setItem('admin_active_bot_id', id);
            await loadBotsPool();
            await populateGlobalBotSwitcher();
            reloadActiveTab();
          } else {
            Toast.error('Activation Failed', res.message || 'Failed to activate bot.');
          }
        } catch (err) {
          Toast.error('Activation Error', 'Failed to activate bot token.');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Activate';
        }
      });
    });

    // Bind Manual Transfer Data Button
    document.querySelectorAll('.migrate-bot-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name') || 'this bot';

        const confirmed = await Confirm.show({
          title: `Transfer Data to "${name}"?`,
          message: `Are you sure you want to TRANSFER ALL DATA (Categories, Media, Packs, Links, Users & Settings) from other bots into "${name}" and activate it?`,
          confirmText: 'Transfer & Activate',
          cancelText: 'Cancel',
          type: 'warning'
        });

        if (!confirmed) return;

        btn.disabled = true;
        btn.textContent = 'Transferring...';
        try {
          const res = await API.post(`/bots/${id}/migrate-data`, {});
          if (res.status === 'success') {
            const m = res.migrationStats || {};
            Toast.success('Data Transferred', `Transferred ${m.categories || 0} Categories, ${m.content || 0} Media, ${m.links || 0} Links to "${name}"!`);
            localStorage.setItem('admin_active_bot_id', id);
            await loadBotsPool();
            await populateGlobalBotSwitcher();
            reloadActiveTab();
          } else {
            Toast.error('Transfer Failed', res.message || 'Data migration failed.');
          }
        } catch (err) {
          Toast.error('Transfer Error', 'Data migration failed.');
        } finally {
          btn.disabled = false;
          btn.textContent = '🔄 Transfer Data';
        }
      });
    });

    // Bind Delete Bot
    document.querySelectorAll('.delete-bot-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const confirmed = await Confirm.show({
          title: 'Delete Bot?',
          message: 'Are you sure you want to delete this bot configuration from the pool?',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          type: 'danger'
        });

        if (!confirmed) return;

        try {
          const res = await API.delete(`/bots/${id}`);
          if (res.status === 'success') {
            Toast.success('Deleted', 'Bot configuration deleted successfully!');
            await loadBotsPool();
            await populateGlobalBotSwitcher();
            reloadActiveTab();
          } else {
            Toast.error('Delete Failed', res.message || 'Failed to delete bot config.');
          }
        } catch (err) {
          Toast.error('Error', 'Delete execution failed.');
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
    if (res.status === 'success' && res.bot) {
      Toast.success('Bot Registered', `@${res.bot.username} verified with Telegram!`);
      
      document.getElementById('botTokenForm').reset();
      await loadBotsPool();
      await populateGlobalBotSwitcher();

      // Offer immediate activation & transfer
      const wantActivate = await Confirm.show({
        title: `Activate @${res.bot.username}?`,
        message: `Bot @${res.bot.username} is verified! Do you want to ACTIVATE it now and TRANSFER all platform data (categories, media, links, users) to it immediately?`,
        confirmText: 'Activate & Transfer Data',
        cancelText: 'Keep in Pool (Activate Later)',
        type: 'warning'
      });

      if (wantActivate) {
        try {
          const actRes = await API.patch(`/bots/${res.bot._id}/activate`, { transferData: true });
          if (actRes.status === 'success') {
            Toast.success('Bot Activated', `Now actively polling @${res.bot.username} with all data transferred!`);
            localStorage.setItem('admin_active_bot_id', res.bot._id);
            await loadBotsPool();
            await populateGlobalBotSwitcher();
            reloadActiveTab();
          } else {
            Toast.error('Activation Failed', actRes.message || 'Could not activate bot.');
          }
        } catch (actErr) {
          Toast.error('Activation Error', 'Failed to activate bot.');
        }
      }
    } else {
      Toast.error('Registration Failed', res.message || 'Failed to register bot.');
    }
  } catch (err) {
    Toast.error('Error', err.message || 'Failed to register bot token.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save & Verify Bot';
  }
});
