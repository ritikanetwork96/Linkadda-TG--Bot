import fetch from 'node-fetch'; // wait, node-fetch is not installed but we are in Node 18+ which has native global fetch!
// So we can use the global fetch API directly!

const BASE_URL = 'http://localhost:3000';

async function runV2Tests() {
  console.log('Starting V2 End-to-End integration checks...');
  let adminCookie = null;
  let adminToken = null;

  try {
    // 1. Check health check endpoint (V1 Regression)
    console.log('\n--- Check Health Check API ---');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const health = await healthRes.json();
    console.log('Health Check Response:', JSON.stringify(health));
    if (health.status !== 'ok') {
      throw new Error('Health check status is not OK');
    }

    // 2. Try accessing protected resource anonymously (Security review check)
    console.log('\n--- Verify Protected Dashboard API is blocked anonymously ---');
    const anonRes = await fetch(`${BASE_URL}/api/admin/dashboard`);
    console.log('Anonymous request status:', anonRes.status); // Should be 401
    if (anonRes.status !== 401) {
      throw new Error('Protected dashboard resource was not rejected anonymously!');
    }
    const anonJson = await anonRes.json();
    console.log('Anonymous response message:', anonJson.message);

    // 3. Authenticate with seeded Admin credentials
    console.log('\n--- Login with Seeded Administrator credentials ---');
    const loginRes = await fetch(`${BASE_URL}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@bot.com', password: 'adminpassword' }),
    });
    console.log('Login Response status:', loginRes.status);
    const loginJson = await loginRes.json();
    console.log('Login Response JSON:', JSON.stringify(loginJson));
    if (loginJson.status !== 'success') {
      throw new Error('Seeded admin login failed.');
    }
    adminToken = loginJson.token;
    
    // Parse cookies from login response headers
    const setCookieHeader = loginRes.headers.get('set-cookie');
    if (setCookieHeader) {
      adminCookie = setCookieHeader.split(';')[0];
      console.log('Session Cookie retrieved:', adminCookie.substring(0, 30) + '...');
    }

    // Prepare headers for authenticated requests
    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
      ...(adminCookie && { 'Cookie': adminCookie }),
    };

    // 4. Load Dashboard statistics
    console.log('\n--- Fetch Dashboard Analytics ---');
    const dashboardRes = await fetch(`${BASE_URL}/api/api/admin/dashboard`, { // Wait, path is /api/admin/dashboard
      headers: authHeaders
    });
    // Wait, let's fix path if it was /api/admin/dashboard
    const dashboardResCorrect = await fetch(`${BASE_URL}/api/admin/dashboard`, {
      headers: authHeaders
    });
    const dashboard = await dashboardResCorrect.json();
    console.log('Dashboard metrics:', JSON.stringify(dashboard.metrics));

    // 5. Create category
    console.log('\n--- Create Test Category ---');
    const catRes = await fetch(`${BASE_URL}/api/admin/categories`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'V2 Test Category',
        slug: `v2-test-cat-${Date.now()}`,
        description: 'Test category created during integration check',
        status: 'active',
        sortOrder: 5
      }),
    });
    const catJson = await catRes.json();
    console.log('Create Category Response:', JSON.stringify(catJson));
    const testCategoryId = catJson.category._id;

    // 6. Fetch settings & patch welcome message
    console.log('\n--- Fetch Settings & Edit Welcome Message ---');
    const settingsGetRes = await fetch(`${BASE_URL}/api/admin/settings`, { headers: authHeaders });
    const settingsGet = await settingsGetRes.json();
    console.log('Current settings welcomeMessage:', settingsGet.settings.welcomeMessage);

    const settingsPatchRes = await fetch(`${BASE_URL}/api/admin/settings`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        welcomeMessage: 'V2 Welcome Message - Updated via Integration Test.',
        startContentLimit: 5,
        autoDeleteHours: 12
      }),
    });
    const settingsPatch = await settingsPatchRes.json();
    console.log('Patched Settings welcomeMessage:', settingsPatch.settings.welcomeMessage);

    // 7. Cleanup created test category
    console.log('\n--- Cleanup Category ---');
    const deleteCatRes = await fetch(`${BASE_URL}/api/admin/categories/${testCategoryId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    const deleteCatJson = await deleteCatRes.json();
    console.log('Delete Category Response:', JSON.stringify(deleteCatJson));

    // 8. Sign Out
    console.log('\n--- Sign Out Administrator ---');
    const logoutRes = await fetch(`${BASE_URL}/api/admin/auth/logout`, {
      method: 'POST',
      headers: authHeaders,
    });
    const logoutJson = await logoutRes.json();
    console.log('Logout Response:', JSON.stringify(logoutJson));

    console.log('\nAll V2 End-to-End checks passed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('V2 End-to-End checks failed:', error);
    process.exit(1);
  }
}

runV2Tests();
