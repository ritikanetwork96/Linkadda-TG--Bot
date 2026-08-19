import { API } from './api.js';
import { Toast } from './toast.js';

// Bind Bulk Upload trigger
const btnBulkUpload = document.getElementById('btn-bulk-upload');
if (btnBulkUpload) {
  btnBulkUpload.addEventListener('click', async () => {
    // Populate categories preset select
    const presetCat = document.getElementById('bulk-preset-category');
    if (presetCat) presetCat.innerHTML = '<option value="">No Category</option>';
    
    try {
      const res = await API.get('/categories');
      if (res.status === 'success' && presetCat) {
        res.categories.forEach(c => {
          presetCat.innerHTML += `<option value="${c._id}">${escapeHTML(c.name)}</option>`;
        });
      }
    } catch (err) {}

    const bulkForm = document.getElementById('bulkUploadForm');
    if (bulkForm) bulkForm.reset();
    
    const resultsPanel = document.getElementById('bulk-upload-queue-results');
    if (resultsPanel) resultsPanel.classList.add('d-none');
    
    openModal('bulk-upload');
  });
}

// Detect media type based on filename extension
function detectFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'photo';
  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
  return 'document';
}

// Convert filename to clean title
function cleanTitle(filename) {
  const base = filename.substring(0, filename.lastIndexOf('.')) || filename;
  return base.replace(/[_\-]/g, ' ')
             .replace(/\b\w/g, c => c.toUpperCase());
}

// Custom Concurrency upload queue
document.getElementById('bulkUploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const fileInput = document.getElementById('bulk-upload-files');
  const files = Array.from(fileInput.files);
  if (files.length === 0) return;

  const categoryId = document.getElementById('bulk-preset-category').value;
  const status = document.getElementById('bulk-preset-status').value;
  const caption = document.getElementById('bulk-preset-caption').value.trim();
  const isStartContent = document.getElementById('bulk-preset-start').checked;
  const isFeatured = document.getElementById('bulk-preset-featured').checked;
  const concurrency = parseInt(document.getElementById('bulk-upload-concurrency').value, 10) || 3;

  const resultsDiv = document.getElementById('bulk-upload-queue-results');
  resultsDiv.classList.remove('d-none');
  resultsDiv.innerHTML = `
    <h4 style="font-family:'Outfit'; font-size:0.95rem" class="mb-3">Upload Queue:</h4>
    <div id="bulk-queue-items" style="display:flex; flex-direction:column; gap:0.75rem"></div>
  `;

  const queueItemsDiv = document.getElementById('bulk-queue-items');
  const fileStates = files.map((file, index) => {
    const itemDiv = document.createElement('div');
    itemDiv.style.background = 'var(--bg-body)';
    itemDiv.style.border = '1px solid var(--border-color)';
    itemDiv.style.padding = '0.75rem';
    itemDiv.style.borderRadius = '6px';
    itemDiv.style.fontSize = '0.85rem';
    itemDiv.innerHTML = `
      <div class="d-flex justify-between align-center mb-1">
        <span><strong>${escapeHTML(file.name)}</strong> <small class="text-muted">(${(file.size / (1024 * 1024)).toFixed(1)} MB)</small></span>
        <span class="status-badge text-muted" id="bulk-status-${index}">Queued</span>
      </div>
      <div style="background:var(--border-color); height:6px; border-radius:3px; overflow:hidden">
        <div id="bulk-progress-${index}" style="background:var(--primary-color); height:100%; width:0%; transition:width 0.1s"></div>
      </div>
    `;
    queueItemsDiv.appendChild(itemDiv);

    return {
      file,
      index,
      status: 'queued',
      progressDiv: itemDiv.querySelector(`#bulk-progress-${index}`),
      statusSpan: itemDiv.querySelector(`#bulk-status-${index}`)
    };
  });

  const submitBtn = document.getElementById('btn-start-bulk-upload');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading files...';

  // Run queue with concurrency limit
  let activeCount = 0;
  let nextIndex = 0;

  return new Promise((resolve) => {
    function startNext() {
      if (nextIndex >= fileStates.length) {
        if (activeCount === 0) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Start Upload Queue';
          Toast.success('Bulk Upload Complete', 'All files processed successfully.');
          closeModal('bulk-upload', true);
          // Reload content list
          window.dispatchEvent(new CustomEvent('load-content'));
          resolve();
        }
        return;
      }

      const item = fileStates[nextIndex++];
      activeCount++;
      uploadItem(item).then(() => {
        activeCount--;
        startNext();
      });
    }

    // Start initial batch
    for (let i = 0; i < Math.min(concurrency, fileStates.length); i++) {
      startNext();
    }
  });

  // Perform single file XHR upload
  async function uploadItem(item) {
    item.statusSpan.textContent = 'Uploading...';
    item.statusSpan.style.color = 'var(--accent-cyan)';

    const type = detectFileType(item.file.name);
    const title = cleanTitle(item.file.name);

    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('title', title);
    formData.append('type', type);
    formData.append('categoryId', categoryId);
    formData.append('status', status);
    formData.append('caption', caption || title);
    formData.append('isStartContent', isStartContent);
    formData.append('isFeatured', isFeatured);

    return new Promise((resolveItem) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/content');

      const token = localStorage.getItem('admin_token');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      const botSelector = document.getElementById('active-bot-switcher');
      const activeBotId = botSelector ? botSelector.value : '';
      if (activeBotId) {
        xhr.setRequestHeader('X-Bot-ID', activeBotId);
      }

      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = ((e.loaded / e.total) * 100).toFixed(0);
          item.progressDiv.style.width = `${pct}%`;
          item.statusSpan.textContent = `${pct}%`;
        }
      };

      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.status === 'success' || res.status === 'duplicate_warning') {
            if (res.status === 'duplicate_warning') {
              item.statusSpan.textContent = 'Skipped (Duplicate)';
              item.statusSpan.style.color = 'var(--text-warning)';
              item.progressDiv.style.background = 'var(--text-warning)';
            } else {
              item.statusSpan.textContent = 'Success';
              item.statusSpan.style.color = 'var(--badge-success-color, #10b981)';
            }
            item.progressDiv.style.width = '100%';
          } else {
            item.statusSpan.textContent = 'Failed';
            item.statusSpan.style.color = 'var(--text-danger)';
            item.progressDiv.style.background = 'var(--text-danger)';
          }
        } catch (err) {
          item.statusSpan.textContent = 'Error';
          item.statusSpan.style.color = 'var(--text-danger)';
        }
        resolveItem();
      };

      xhr.onerror = () => {
        item.statusSpan.textContent = 'Network Error';
        item.statusSpan.style.color = 'var(--text-danger)';
        resolveItem();
      };

      xhr.send(formData);
    });
  }
});
