/**
 * Confirmation Dialog System
 * Replaces browser's native confirm() with a premium custom modal.
 *
 * Usage:
 *   const confirmed = await Confirm.show({
 *     title: 'Delete Content',
 *     message: 'This will permanently remove this item and its file from Filebase.',
 *     confirmText: 'Delete',
 *     type: 'danger',   // 'danger' | 'warning'
 *   });
 *   if (confirmed) { ... }
 */

export const Confirm = {
  /**
   * @param {Object} opts
   * @param {string} opts.title
   * @param {string} opts.message
   * @param {string} [opts.confirmText='Confirm']
   * @param {string} [opts.cancelText='Cancel']
   * @param {'danger'|'warning'} [opts.type='danger']
   * @returns {Promise<boolean>}
   */
  show({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', type = 'danger' } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('modal-confirm');
      if (!modal) { resolve(window.confirm(message)); return; }

      // Set content
      const iconEl   = modal.querySelector('.confirm-icon');
      const titleEl  = modal.querySelector('.confirm-title');
      const msgEl    = modal.querySelector('.confirm-message');
      const okBtn    = modal.querySelector('#confirm-ok-btn');
      const cancelBtn = modal.querySelector('#confirm-cancel-btn');

      iconEl.className = `confirm-icon ${type}`;
      iconEl.textContent = type === 'danger' ? '🗑' : '⚠️';
      if (titleEl) titleEl.textContent = title || 'Are you sure?';
      msgEl.textContent = message || '';
      okBtn.textContent = confirmText;
      okBtn.className = `btn ${type === 'danger' ? 'btn-danger' : 'btn-primary'}`;
      cancelBtn.textContent = cancelText;

      // Show modal
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';

      // Cleanup helper
      const cleanup = (result) => {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        modal.removeEventListener('click', onBackdrop);
        resolve(result);
      };

      const onOk     = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onKey    = (e) => { if (e.key === 'Escape') cleanup(false); };
      const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };

      okBtn.addEventListener('click', onOk,       { once: true });
      cancelBtn.addEventListener('click', onCancel, { once: true });
      document.addEventListener('keydown', onKey,   { once: true });
      modal.addEventListener('click', onBackdrop);
    });
  }
};

window.Confirm = Confirm;
