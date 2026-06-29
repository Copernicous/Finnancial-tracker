'use strict';

const baseUrl = (process.argv.find((arg) => /^https?:\/\//i.test(arg)) || process.env.SMOKE_BASE_URL || 'http://localhost:3026').replace(/\/$/, '');
const shouldSeed = process.argv.includes('--seed');
const username = process.env.SMOKE_USER || 'admin';
const password = process.env.SMOKE_PASS || 'admin123';

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, options);
  const text = await response.text();
  return { response, text };
}

async function expectOk(path, options = {}) {
  const { response, text } = await request(path, options);
  if (!response.ok) {
    throw new Error(path + ' returned HTTP ' + response.status + ': ' + text.slice(0, 160));
  }
  return { response, text };
}

async function main() {
  console.log('[smoke] Base URL: ' + baseUrl);
  const login = await expectOk('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const loginData = JSON.parse(login.text);
  if (!loginData.token) throw new Error('Login did not return a JWT.');

  const token = loginData.token;
  const authHeaders = { Authorization: 'Bearer ' + token };
  const pageHeaders = { Cookie: 'haToken=' + encodeURIComponent(token) };

  const pages = ['/dashboard', '/finance', '/entry', '/import', '/reports', '/active-users', '/budgets', '/financial-goals'];
  for (const page of pages) {
    const result = await expectOk(page, { headers: pageHeaders });
    const oldTerms = ['R' + 'X Tracker', 'Pat' + 'ient', 'Cli' + 'nic', 'Pres' + 'cription'];
    if (oldTerms.some((term) => result.text.toLowerCase().includes(term.toLowerCase()))) {
      throw new Error(page + ' contains old domain text.');
    }
    console.log('[smoke] page ok ' + page);
  }

  const apis = [
    '/api/version',
    '/api/accounts',
    '/api/categories',
    '/api/transactions',
    '/api/budgets',
    '/api/recurring-transactions',
    '/api/financial-goals',
    '/api/investment-holdings',
    '/api/currency-rates',
    '/api/account-balance-snapshots',
    '/api/import/batches',
    '/api/import/bank-statement/profiles',
    '/api/import/merchant-rules',
    '/api/import/categories/export',
    '/api/finance/overview?year=2026&currency=ALL',
    '/api/finance/search?limit=10'
  ];
  for (const api of apis) {
    await expectOk(api, { headers: authHeaders });
    console.log('[smoke] api ok ' + api);
  }

  if (loginData.user && loginData.user.isMaster === true) {
    await expectOk('/backoffice', { headers: pageHeaders });
    console.log('[smoke] page ok /backoffice');
    const adminApis = [
      '/api/admin/stats',
      '/api/admin/schema',
      '/api/admin/table-data/Transactions?limit=2',
      '/api/admin/orphans',
      '/api/admin/financial-checks',
      '/api/admin/health',
      '/api/admin/log-dashboard',
      '/api/admin/backups/status',
      '/api/admin/csv-backups'
    ];
    for (const api of adminApis) {
      await expectOk(api, { headers: authHeaders });
      console.log('[smoke] admin api ok ' + api);
    }
  } else {
    console.log('[smoke] skipped /backoffice master checks for non-isMaster user');
  }

  await expectOk('/api/import/merchant-suggest', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders),
    body: JSON.stringify({ merchant: 'Google Fi', description: 'Google Fi wireless service', transactionType: 'expense', onlineLookup: false })
  });
  console.log('[smoke] api ok /api/import/merchant-suggest');

  if (shouldSeed) {
    const seeded = await expectOk('/api/simulation/seed', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders)
    });
    const data = JSON.parse(seeded.text);
    if (!data.created) throw new Error('Simulation seed did not create transactions.');
    console.log('[smoke] simulation seeded ' + data.created + ' transactions');

    const overview = await expectOk('/api/finance/overview?year=2026&currency=ALL', { headers: authHeaders });
    const overviewData = JSON.parse(overview.text);
    if (!overviewData.summary || !overviewData.summary.transactionCount) {
      throw new Error('Seeded overview did not report transactions.');
    }
  }

  console.log('[smoke] Home Accounting smoke checks passed.');
}

main().catch((err) => {
  console.error('[smoke] ' + err.message);
  process.exit(1);
});
