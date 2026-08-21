/**
 * Admin API Client — Centralized HTTP request utility
 * - Injects JWT from localStorage as Authorization header
 * - Injects active bot ID from localStorage as X-Bot-ID header
 * - Handles 401 auto-redirect to login
 * - Handles common HTTP errors with clean messages
 */

const BASE_URL = '/api/admin';

// Error messages per HTTP status
const STATUS_MESSAGES = {
  400: 'Invalid request. Please check your input.',
  401: 'Session expired. Redirecting to login...',
  403: 'Access denied. Insufficient permissions.',
  404: 'Resource not found.',
  409: 'Conflict: This resource already exists or is in use.',
  422: 'Validation failed. Please check all required fields.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'Server error. Please try again later.',
  503: 'Service temporarily unavailable.',
};

export const API = {
  async request(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;

    const headers = new Headers(options.headers || {});

    // Attach JWT
    const token = localStorage.getItem('admin_token');
    if (token) headers.set('Authorization', `Bearer ${token}`);

    // Attach active bot ID (for multi-bot context)
    const activeBotId = localStorage.getItem('admin_active_bot_id');
    if (activeBotId && activeBotId !== 'all') headers.set('X-Bot-ID', activeBotId);

    // Set Content-Type for non-FormData bodies
    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const config = {
      ...options,
      headers,
      credentials: 'include',
    };

    try {
      const response = await fetch(url, config);

      // Auto-redirect on 401
      if (response.status === 401 && !url.includes('/auth/login')) {
        localStorage.removeItem('admin_token');
        window.location.href = 'login.html';
        return { status: 'error', message: STATUS_MESSAGES[401] };
      }

      // Parse JSON
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Server returned non-JSON response (HTTP ${response.status})`);
      }

      // Attach a clean message for known error statuses
      if (!response.ok && !data.message && STATUS_MESSAGES[response.status]) {
        data.message = STATUS_MESSAGES[response.status];
      }

      return data;
    } catch (error) {
      console.error(`API [${options.method || 'GET'} ${endpoint}]:`, error.message);
      throw error;
    }
  },

  get(endpoint)         { return this.request(endpoint, { method: 'GET' }); },
  post(endpoint, body)  { return this.request(endpoint, { method: 'POST',  body: body instanceof FormData ? body : JSON.stringify(body) }); },
  patch(endpoint, body) { return this.request(endpoint, { method: 'PATCH', body: body instanceof FormData ? body : JSON.stringify(body) }); },
  delete(endpoint)      { return this.request(endpoint, { method: 'DELETE' }); },
  async getBlob(endpoint, headers = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const token = localStorage.getItem('admin_token');
    const activeBotId = localStorage.getItem('admin_active_bot_id');
    const reqHeaders = new Headers(headers);
    if (token) reqHeaders.set('Authorization', `Bearer ${token}`);
    if (activeBotId && activeBotId !== 'all') reqHeaders.set('X-Bot-ID', activeBotId);

    const response = await fetch(url, { headers: reqHeaders, credentials: 'include' });
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }
    return response.blob();
  },
};

window.API = API;

// Global XSS Sanitization helper
window.escapeHTML = function(str) {
  if (str === undefined || str === null) return '';
  return str.toString()
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
};

// Format date helper
window.fmtDate = function(d) {
  if (!d) return 'N/A';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return 'N/A'; }
};
window.fmtDateTime = function(d) {
  if (!d) return 'N/A';
  try { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return 'N/A'; }
};
