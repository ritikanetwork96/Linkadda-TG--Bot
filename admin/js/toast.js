/**
 * Toast Notification System
 * Usage:
 *   Toast.success('Title', 'Optional message')
 *   Toast.error('Failed', 'Network error occurred')
 *   Toast.warning('Warning', 'This action is irreversible')
 *   Toast.info('Info', 'Operation complete')
 */

const ICONS = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
  info:    'ℹ',
};

const TITLES = {
  success: 'Success',
  error:   'Error',
  warning: 'Warning',
  info:    'Info',
};

let toastContainer = null;

function getContainer() {
  if (!toastContainer) {
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      document.body.appendChild(toastContainer);
    }
  }
  return toastContainer;
}

function showToast(type, title, message, duration = 3500) {
  const container = getContainer();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alert');

  toast.innerHTML = `
    <span class="toast-icon">${ICONS[type]}</span>
    <div class="toast-body">
      <div class="toast-title">${title || TITLES[type]}</div>
      ${message ? `<div class="toast-msg">${message}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="Close">✕</button>
  `;

  // Close on click
  toast.querySelector('.toast-close').addEventListener('click', () => dismiss(toast));
  toast.addEventListener('click', (e) => {
    if (!e.target.classList.contains('toast-close')) dismiss(toast);
  });

  container.appendChild(toast);

  // Auto dismiss
  const timer = setTimeout(() => dismiss(toast), duration);
  toast._timer = timer;

  return toast;
}

function dismiss(toast) {
  if (!toast.isConnected) return;
  clearTimeout(toast._timer);
  toast.classList.add('hiding');
  toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  setTimeout(() => { if (toast.isConnected) toast.remove(); }, 400);
}

export const Toast = {
  success: (title, msg, duration) => showToast('success', title, msg, duration),
  error:   (title, msg, duration) => showToast('error',   title, msg, duration || 5000),
  warning: (title, msg, duration) => showToast('warning', title, msg, duration),
  info:    (title, msg, duration) => showToast('info',    title, msg, duration),
};

window.Toast = Toast;
