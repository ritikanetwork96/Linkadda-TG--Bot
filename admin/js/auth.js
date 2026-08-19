import { API } from './api.js';

export const Auth = {
  adminUser: null,

  /**
   * Verifies current session credentials with the backend
   * Redirects to login page if token is invalid or missing
   */
  async checkAuth() {
    try {
      const response = await API.get('/auth/me');
      if (response && response.status === 'success') {
        this.adminUser = response.admin;
        return true;
      }
    } catch (err) {
      console.warn('Authentication check failed:', err.message);
    }
    
    // Auth failed: clear state and redirect to login
    localStorage.removeItem('admin_token');
    window.location.href = 'login.html';
    return false;
  },

  /**
   * Performs silent auth verification without triggering login redirect
   */
  async checkAuthSilent() {
    const token = localStorage.getItem('admin_token');
    if (!token) return false;

    try {
      const response = await API.get('/auth/me');
      if (response && response.status === 'success') {
        this.adminUser = response.admin;
        return true;
      }
    } catch (err) {
      // Ignore
    }
    return false;
  },

  /**
   * Clears sessions and calls logout API endpoint
   */
  async logout() {
    try {
      await API.post('/auth/logout');
    } catch (err) {
      console.error('Logout API failure:', err.message);
    }
    localStorage.removeItem('admin_token');
    window.location.href = 'login.html';
  }
};

window.Auth = Auth;
