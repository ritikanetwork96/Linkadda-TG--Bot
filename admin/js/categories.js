import { API } from './api.js';
import { Toast } from './toast.js';
import { Confirm } from './confirm.js';

window.addEventListener('load-categories', () => loadCategories());

async function loadCategories() {
  const tableBody = document.querySelector('#categories-table tbody');
  if (!tableBody) return;
  tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-dim" style="padding:1.5rem">
    <div class="spinner" style="margin:0 auto 0.5rem"></div>Loading categories...
  </td></tr>`;

  try {
    const response = await API.get('/categories');
    if (response.status !== 'success') {
      tableBody.innerHTML = errorRow(6, response.message);
      return;
    }

    const categories = response.categories;
    if (categories.length === 0) {
      tableBody.innerHTML = emptyRow(6, 'No categories yet', 'Create your first category to start organizing content.');
      return;
    }

    tableBody.innerHTML = categories.map(cat => `
      <tr>
        <td><code>${escapeHTML(String(cat.sortOrder))}</code></td>
        <td>
          <div style="font-weight:600">${escapeHTML(cat.icon || '')} ${escapeHTML(cat.name)}</div>
          ${cat.displayName ? `<small class="text-dim">${escapeHTML(cat.displayName)}</small>` : ''}
        </td>
        <td><code>${escapeHTML(cat.slug)}</code></td>
        <td><span class="badge ${cat.status === 'active' ? 'badge-success' : 'badge-neutral'}">${escapeHTML(cat.status)}</span></td>
        <td class="text-dim">${cat.isFeatured ? '<span class="badge badge-info">Featured</span>' : '—'}</td>
        <td>
          <div class="d-flex gap-2">
            <button class="btn btn-secondary btn-sm edit-cat-btn" data-id="${cat._id}" title="Edit">Edit</button>
            <button class="btn btn-danger btn-sm delete-cat-btn" data-id="${cat._id}" data-name="${escapeHTML(cat.name)}" title="Delete">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');

    // Bind Edit
    tableBody.querySelectorAll('.edit-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = categories.find(c => c._id === btn.dataset.id);
        if (cat) openCategoryModal(cat);
      });
    });

    // Bind Delete
    tableBody.querySelectorAll('.delete-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteCategory(btn.dataset.id, btn.dataset.name));
    });

  } catch (err) {
    tableBody.innerHTML = errorRow(6, 'Failed to load categories. Network error.');
    Toast.error('Load Failed', 'Could not load categories.');
  }
}

// Open modal
document.getElementById('btn-add-category')?.addEventListener('click', () => openCategoryModal());

function openCategoryModal(cat = null) {
  const modalTitle = document.getElementById('modal-category-title');
  if (modalTitle) modalTitle.textContent = cat ? 'Edit Category' : 'Create Category';

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

  setVal('category-id',           cat?._id || '');
  setVal('category-name',         cat?.name || '');
  setVal('category-display-name', cat?.displayName || '');
  setVal('category-icon',         cat?.icon || '');
  setVal('category-slug',         cat?.slug || '');
  setVal('category-desc',         cat?.description || '');
  setVal('category-status',       cat?.status || 'active');
  setVal('category-sort',         cat?.sortOrder ?? '0');
  setCheck('category-is-featured',  cat?.isFeatured || false);

  // Auto-slug for new categories
  const nameEl = document.getElementById('category-name');
  const slugEl = document.getElementById('category-slug');
  if (!cat && nameEl && slugEl) {
    nameEl.oninput = () => {
      slugEl.value = nameEl.value.toLowerCase().trim()
        .replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-');
    };
  } else if (nameEl) {
    nameEl.oninput = null;
  }

  openModal('category');
}

// Form submit
document.getElementById('categoryForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('category-id')?.value;
  const submitBtn = e.target.querySelector('[type="submit"]');

  const payload = {
    name:        document.getElementById('category-name')?.value.trim(),
    displayName: document.getElementById('category-display-name')?.value.trim(),
    icon:        document.getElementById('category-icon')?.value.trim(),
    slug:        document.getElementById('category-slug')?.value.trim(),
    description: document.getElementById('category-desc')?.value.trim(),
    status:      document.getElementById('category-status')?.value,
    sortOrder:   parseInt(document.getElementById('category-sort')?.value, 10) || 0,
    isFeatured:  document.getElementById('category-is-featured')?.checked || false,
  };

  if (!payload.name || !payload.slug) {
    Toast.warning('Validation', 'Name and slug are required.');
    return;
  }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add('btn-loading'); submitBtn.textContent = 'Saving'; }

  try {
    const response = id
      ? await API.patch(`/categories/${id}`, payload)
      : await API.post('/categories', payload);

    if (response.status === 'success') {
      closeModal('category', true);
      Toast.success(id ? 'Category Updated' : 'Category Created');
      await loadCategories();
    } else {
      Toast.error('Save Failed', response.message || 'Could not save category.');
    }
  } catch (err) {
    Toast.error('Network Error', 'Failed to save category.');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('btn-loading'); submitBtn.textContent = 'Save Changes'; }
  }
});

// Delete
async function deleteCategory(id, name) {
  const confirmed = await Confirm.show({
    title: 'Delete Category',
    message: `Delete "${name}"? This will unlink all content from this category. The content itself will NOT be deleted.`,
    confirmText: 'Delete Category',
    type: 'danger',
  });
  if (!confirmed) return;

  try {
    const response = await API.delete(`/categories/${id}`);
    if (response.status === 'success') {
      Toast.success('Deleted', `Category "${name}" removed.`);
      await loadCategories();
    } else {
      Toast.error('Delete Failed', response.message);
    }
  } catch (err) {
    Toast.error('Network Error', 'Could not delete category.');
  }
}

// Helpers
function emptyRow(cols, title, desc) {
  return `<tr><td colspan="${cols}">
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
      <h4>${title}</h4>
      <p>${desc}</p>
    </div>
  </td></tr>`;
}

function errorRow(cols, msg) {
  return `<tr><td colspan="${cols}">
    <div class="empty-state">
      <h4>Failed to load</h4>
      <p>${escapeHTML(msg)}</p>
      <button class="btn btn-secondary btn-sm" onclick="window.dispatchEvent(new CustomEvent('load-categories'))">Retry</button>
    </div>
  </td></tr>`;
}
