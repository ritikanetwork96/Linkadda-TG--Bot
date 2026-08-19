import { API } from './api.js';

window.addEventListener('load-bot-menus', async () => {
  await loadBotMenus();
});

async function loadBotMenus() {
  const tableBody = document.querySelector('#bot-menus-table tbody');
  tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Loading bot menu buttons...</td></tr>`;

  try {
    const response = await API.get('/bot-menus');
    if (response.status !== 'success') return;

    const menus = response.menus;
    if (menus.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No bot menu buttons defined yet. Click "Create Menu Button" to start.</td></tr>`;
      return;
    }

    tableBody.innerHTML = menus.map(m => `
      <tr>
        <td><code>${escapeHTML(m.sortOrder)}</code></td>
        <td><strong>${m.icon ? escapeHTML(m.icon) : '<span class="text-muted">None</span>'}</strong></td>
        <td><strong>${escapeHTML(m.label)}</strong></td>
        <td><span class="badge badge-info">${escapeHTML(m.actionType)}</span></td>
        <td><code>${m.target ? escapeHTML(m.target) : '<span class="text-muted">None</span>'}</code></td>
        <td>
          <span class="badge ${m.status === 'active' ? 'badge-success' : 'badge-danger'}">
            ${escapeHTML(m.status)}
          </span>
        </td>
        <td>
          <div class="d-flex gap-2">
            <button class="btn btn-secondary btn-sm edit-menu-btn" data-id="${m._id}">Edit</button>
            <button class="btn btn-danger btn-sm delete-menu-btn" data-id="${m._id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');

    // Bind Edit buttons
    document.querySelectorAll('.edit-menu-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const menu = menus.find(x => x._id === id);
        if (menu) {
          openEditModal(menu);
        }
      });
    });

    // Bind Delete buttons
    document.querySelectorAll('.delete-menu-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Are you sure you want to delete this menu button?')) {
          try {
            const res = await API.delete(`/bot-menus/${id}`);
            if (res.status === 'success') {
              alert('Menu button deleted successfully!');
              await loadBotMenus();
            } else {
              alert(res.message || 'Failed to delete menu button.');
            }
          } catch (err) {
            alert('Failed to delete menu button.');
          }
        }
      });
    });

  } catch (error) {
    tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load menu buttons. Network error.</td></tr>`;
  }
}

function openEditModal(menu) {
  document.getElementById('modal-bot-menu-title').textContent = 'Edit Menu Button';
  document.getElementById('bot-menu-id').value = menu._id;
  document.getElementById('bot-menu-label').value = menu.label;
  document.getElementById('bot-menu-icon').value = menu.icon || '';
  document.getElementById('bot-menu-action').value = menu.actionType;
  document.getElementById('bot-menu-target').value = menu.target || '';
  document.getElementById('bot-menu-order').value = menu.sortOrder;
  document.getElementById('bot-menu-status').value = menu.status;

  openModal('bot-menu');
}

// Bind Create button
document.getElementById('btn-add-bot-menu').addEventListener('click', () => {
  document.getElementById('modal-bot-menu-title').textContent = 'Create Menu Button';
  document.getElementById('bot-menu-id').value = '';
  document.getElementById('bot-menu-label').value = '';
  document.getElementById('bot-menu-icon').value = '';
  document.getElementById('bot-menu-action').value = 'CATEGORY';
  document.getElementById('bot-menu-target').value = '';
  document.getElementById('bot-menu-order').value = '0';
  document.getElementById('bot-menu-status').value = 'active';

  openModal('bot-menu');
});

// Form Submission handler
document.getElementById('botMenuForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('bot-menu-id').value;
  const payload = {
    label: document.getElementById('bot-menu-label').value.trim(),
    icon: document.getElementById('bot-menu-icon').value.trim(),
    actionType: document.getElementById('bot-menu-action').value,
    target: document.getElementById('bot-menu-target').value.trim(),
    sortOrder: parseInt(document.getElementById('bot-menu-order').value, 10) || 0,
    status: document.getElementById('bot-menu-status').value,
  };

  try {
    let res;
    if (id) {
      res = await API.patch(`/bot-menus/${id}`, payload);
    } else {
      res = await API.post('/bot-menus', payload);
    }

    if (res.status === 'success' || res.menu) {
      Toast.success(id ? 'Button Updated' : 'Button Created', id ? 'Menu button updated successfully!' : 'Menu button created successfully!');
      closeModal('bot-menu', true);
      await loadBotMenus();
    } else {
      Toast.error('Save Failed', res.message || 'Failed to save menu button.');
    }
  } catch (error) {
    Toast.error('Error', error.message || 'Failed to save menu button.');
  }
});
