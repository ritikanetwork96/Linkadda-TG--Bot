import { API } from './api.js';
import { Toast } from './toast.js';

window.addEventListener('load-settings', () => loadSettings());

async function loadSettings() {
  const form = document.getElementById('settingsForm');
  const saveBtn = document.getElementById('btn-save-settings');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Loading...'; }

  try {
    const response = await API.get('/settings');
    if (response.status !== 'success') {
      Toast.error('Load Failed', response.message || 'Could not load settings.');
      return;
    }

    const s = response.settings;

    // Populate fields safely
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setVal('setting-welcome',          s.welcomeMessage);
    setVal('setting-bot-description',  s.botDescription);
    setVal('setting-bot-short-description', s.botShortDescription);
    setVal('setting-limit',            s.startContentLimit);
    setVal('setting-autodelete-hours', s.autoDeleteHours);
    setCheck('setting-start-enabled',    s.startContentEnabled);
    setCheck('setting-autodelete-enabled', s.autoDeleteEnabled);
    setCheck('setting-bot-enabled',      s.botEnabled);

    // Load Admin profile details
    try {
      const authRes = await API.get('/auth/me');
      if (authRes && authRes.status === 'success') {
        setVal('setting-admin-name', authRes.admin.name);
        setVal('setting-admin-email', authRes.admin.email);
      }
    } catch (_) {}

    // Load active sessions
    await loadActiveSessions();

  } catch (err) {
    Toast.error('Settings Error', 'Network error loading settings.');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
  }
}

async function loadActiveSessions() {
  const tableBody = document.querySelector('#sessions-table tbody');
  if (!tableBody) return;

  try {
    const res = await API.get('/system/sessions');
    if (res.status !== 'success') return;

    if (res.sessions.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No login history recorded yet.</td></tr>`;
      return;
    }

    tableBody.innerHTML = res.sessions.map(s => {
      // Parse User-Agent into readable browser/os info
      let browserInfo = s.userAgent || 'Unknown';
      if (browserInfo.includes('Firefox')) browserInfo = 'Mozilla Firefox';
      else if (browserInfo.includes('Chrome')) browserInfo = 'Google Chrome';
      else if (browserInfo.includes('Safari')) browserInfo = 'Apple Safari';
      else if (browserInfo.includes('Edge')) browserInfo = 'Microsoft Edge';
      else if (browserInfo.length > 50) browserInfo = browserInfo.substring(0, 50) + '...';

      return `
        <tr>
          <td><strong>${escapeHTML(s.name)}</strong> <small class="text-muted">(${escapeHTML(s.email)})</small></td>
          <td><code>${escapeHTML(s.ip)}</code></td>
          <td title="${escapeHTML(s.userAgent)}">${escapeHTML(browserInfo)}</td>
          <td>${window.fmtDateTime ? window.fmtDateTime(s.timestamp) : new Date(s.timestamp).toLocaleString()}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load active login locations:', err.message);
  }
}

// Form Submission
document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById('btn-save-settings');

  const adminName = document.getElementById('setting-admin-name')?.value.trim();
  const adminEmail = document.getElementById('setting-admin-email')?.value.trim();
  const adminPass = document.getElementById('setting-admin-password')?.value;
  const adminConfirmPass = document.getElementById('setting-admin-confirm-password')?.value;

  if (adminPass && adminPass !== adminConfirmPass) {
    Toast.error('Validation Error', 'New passwords do not match.');
    return;
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.add('btn-loading'); saveBtn.textContent = 'Saving'; }

  try {
    // 1. Save global settings
    const payload = {
      welcomeMessage:      document.getElementById('setting-welcome')?.value.trim(),
      botDescription:      document.getElementById('setting-bot-description')?.value.trim(),
      botShortDescription: document.getElementById('setting-bot-short-description')?.value.trim(),
      startContentLimit:   parseInt(document.getElementById('setting-limit')?.value, 10),
      autoDeleteHours:     parseInt(document.getElementById('setting-autodelete-hours')?.value, 10),
      startContentEnabled: document.getElementById('setting-start-enabled')?.checked,
      autoDeleteEnabled:   document.getElementById('setting-autodelete-enabled')?.checked,
      botEnabled:          document.getElementById('setting-bot-enabled')?.checked,
    };

    const response = await API.patch('/settings', payload);
    if (response.status !== 'success') {
      Toast.error('Save Failed', response.message || 'Could not save settings.');
      return;
    }

    // 2. Save admin credentials if filled
    if (adminName || adminEmail || adminPass) {
      const profilePayload = {};
      if (adminName) profilePayload.name = adminName;
      if (adminEmail) profilePayload.email = adminEmail;
      if (adminPass) profilePayload.password = adminPass;

      const profRes = await API.patch('/auth/update-profile', profilePayload);
      if (profRes.status !== 'success') {
        Toast.error('Profile Save Failed', profRes.message || 'Could not update admin profile.');
        return;
      }

      // Clear password fields
      const p1 = document.getElementById('setting-admin-password');
      const p2 = document.getElementById('setting-admin-confirm-password');
      if (p1) p1.value = '';
      if (p2) p2.value = '';
    }

    Toast.success('Settings Saved', 'All configuration changes have been applied.');
    await loadSettings();
  } catch (err) {
    Toast.error('Network Error', 'Failed to save settings. Check your connection.');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('btn-loading'); saveBtn.textContent = 'Save Changes'; }
  }
});
