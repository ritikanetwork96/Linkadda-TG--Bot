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

  } catch (err) {
    Toast.error('Settings Error', 'Network error loading settings.');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
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
