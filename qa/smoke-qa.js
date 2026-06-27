const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { readConfig, ensureQaDirectories, applyRuntimeEnv } = require('./lib/qa-env');
const packageInfo = require('../package.json');

const config = readConfig();
ensureQaDirectories(config);
applyRuntimeEnv(config);

const results = [];
const errors = [];
const skipped = [];
let page;
let smokeAppVersion = null;
const isNeedsActionSmoke = config.smokeNeedsAction;

function qaRoute(pathname) {
  const base = config.baseURL.replace(/\/+$/, '');
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${base}${cleanPath}`;
}

function pass(name, detail = '') {
  results.push({ status: 'PASS', name, detail });
  console.log('PASS:', name, detail);
}

function fail(name, detail = '') {
  results.push({ status: 'FAIL', name, detail });
  console.log('FAIL:', name, detail);
}

function skip(name, detail = '') {
  skipped.push({ name, detail });
  console.log('SKIP:', name, detail);
}

async function upsertOne(model, where, values) {
  const existing = await model.findOne({ where });
  if (existing) {
    await existing.update(values);
    return existing;
  }
  return model.create({ ...where, ...values });
}

function dateBefore(daysAgo) {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo)).toISOString().split('T')[0];
}

async function seedNeedsActionFixture() {
  if (!isNeedsActionSmoke) return null;

  const db = require('../models');
  try {
    await db.sequelize.authenticate();
    await db.sequelize.sync();

    const adminUser = await db.User.findOne({ where: { username: config.loginUsername } });
    if (!adminUser) {
      throw new Error(`QA user "${config.loginUsername}" not found. Run seed command first.`);
    }

    const pharmacy = await upsertOne(db.Pharmacy, { name: 'QA NeedsAction Pharmacy' }, {
      address: '101 QA NeedsAction St',
      phone: '555-0600',
      contactPerson: 'QA NeedsAction Coordinator',
      notes: 'Smoke fixture for Needs Action flow',
      isActive: true
    });

    const clinic = await upsertOne(db.Clinic, { name: 'QA NeedsAction Clinic' }, {
      address: '202 QA NeedsAction Ave',
      phone: '555-0601',
      contactPerson: 'QA NeedsAction Clinic Lead',
      notes: 'Smoke fixture for Needs Action flow',
      isActive: true
    });

    const patientTransport = await upsertOne(db.PatientTransportCompany, { companyName: 'QA NeedsAction Patient Transport' }, {
      phone: '555-0602',
      contactPerson: 'QA NeedsAction Patient Driver',
      notes: 'Smoke fixture for Needs Action flow',
      isActive: true
    });

    const pharmacyTransport = await upsertOne(db.PharmacyTransportCompany, { companyName: 'QA NeedsAction Pharmacy Transport' }, {
      phone: '555-0603',
      contactPerson: 'QA NeedsAction Pharmacy Driver',
      notes: 'Smoke fixture for Needs Action flow',
      isActive: true
    });

    const workflowAction = await db.WorkflowAction.findOne({
      where: { isActive: true },
      order: [['sequenceNumber', 'ASC']]
    });
    if (!workflowAction) {
      throw new Error('No active workflow actions found. Run seed command first.');
    }

    const serviceDate = dateBefore(100);
    const patient = await upsertOne(db.Patient, { firstName: 'QA', lastName: 'NeedsAction' }, {
      dob: '1979-01-01',
      address: '303 QA NeedsAction Rd',
      phone: '555-0604',
      serviceDate,
      patientTransportCompanyId: patientTransport.id,
      pharmacyTransportCompanyId: pharmacyTransport.id,
      clinicId: clinic.id,
      pharmacyId: pharmacy.id,
      notes: 'Needs Action smoke fixture',
      isActive: true,
      isDeleted: false,
      patientCode: 'QA-NA-001',
      isNonCompanyPatient: false
    });

    const rx = await upsertOne(db.RXRecord, { patientId: patient.id, serviceDate }, {
      arrivalDate: serviceDate,
      pharmacyId: pharmacy.id,
      patientTransportCompanyId: patientTransport.id,
      pharmacyTransportCompanyId: pharmacyTransport.id,
      isDeleted: false,
      returnedToWarehouse: false,
      warehouseReturnDate: null,
      warehouseReturnNote: null
    });

    await db.RXWorkflowTracking.destroy({ where: { rxRecordId: rx.id } });
    await db.RXWorkflowTracking.create({
      rxRecordId: rx.id,
      workflowActionId: workflowAction.id,
      completionDate: `${serviceDate}T10:00:00.000Z`,
      userId: adminUser.id
    });

    return {
      patientCode: patient.patientCode,
      patientName: `${patient.firstName} ${patient.lastName}`,
      serviceDate
    };
  } finally {
    await db.sequelize.close().catch(() => {});
  }
}

async function verifyNeedsActionFlow(fixture) {
  await page.goto(qaRoute('/patients'), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await safeClick('#advancedToggleBtn', 'patients advanced filters toggle for needs-action smoke', { wait: 300 });

  const select = page.locator('#srchEligibility');
  const count = await select.count();
  if (!count) {
    fail('needs-action smoke: filter control', 'srchEligibility selector not found');
    return;
  }

  await select.selectOption('needsAction');
  await page.waitForTimeout(700);

  const banner = page.locator('#patientsNeedsActionBanner');
  const bannerText = await banner.textContent().catch(() => '');
  if (typeof bannerText === 'string' && /(needs action|workflow action)/i.test(bannerText)) {
    pass('needs-action smoke banner', `found banner: ${bannerText.trim()}`);
  } else {
    fail('needs-action smoke banner', `expected needs-action banner text, got: ${bannerText || '[empty]'}`);
  }

  const patientRow = page.locator(`tbody tr:has-text("${fixture.patientName}")`);
  const hasPatient = await patientRow.count();
  if (hasPatient) {
    pass('needs-action smoke patient appears in filtered list', fixture.patientName);
  } else {
    fail('needs-action smoke patient appears in filtered list', `${fixture.patientName} was not found in Needs Action filter.`);
  }

  await page.goto(qaRoute('/rx-records'), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.fill('#rxFilterPatient', fixture.patientName);
  await safeClick('#rxFilterBtn', 'needs-action smoke rx search button', { wait: 700 });
  const rxRow = page.locator(`tbody tr:has-text("${fixture.patientName}")`).first();
  await rxRow.waitFor({ state: 'visible', timeout: 10000 });
  await rxRow.locator('button[title="Workflow"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(800);
  pass('needs-action smoke expired workflow modal opens');
  await expectVisible('#workflowModal.show', 'needs-action smoke workflow modal visible');

  const expiredBanner = page.locator('#workflowModal .alert-danger:has-text("90-Day Window Expired")');
  if (await expiredBanner.count()) {
    pass('needs-action smoke expired workflow banner');
  } else {
    fail('needs-action smoke expired workflow banner', '90-Day Window Expired banner not found.');
  }

  const closeButton = page.locator('#closeExpiredInlineBtn');
  if (await closeButton.count() && await closeButton.isVisible().catch(() => false)) {
    pass('needs-action smoke close rx record option');
    await closeButton.click();
    await expectVisible('#expiredAccessModal.show', 'needs-action smoke close rx modal visible');
    await expectText('Please request access for this transaction to your administrator.', 'needs-action smoke access guidance text');
    await expectVisible('#closeExpiredRxBtn', 'needs-action smoke modal close rx option visible');
    await page.locator('#expiredAccessModal.show .btn-close').click().catch(() => {});
    await page.waitForTimeout(300);
  } else {
    fail('needs-action smoke close rx record option', 'Close RX Record button not visible for expired incomplete workflow.');
  }

  const requestAccessButton = page.locator('#expiredAccessBtn');
  if (await requestAccessButton.count() && await requestAccessButton.isVisible().catch(() => false)) {
    await requestAccessButton.click();
    await expectVisible('#expiredAccessModal.show', 'needs-action smoke request access modal visible');
    await page.locator('#expiredAccessModal.show .btn-close').click().catch(() => {});
    await page.waitForTimeout(300);
  } else {
    skip('needs-action smoke request access modal', 'current user has override access or request button is not shown');
  }
  await closeModal();
}

function findChromeExecutable() {
  const candidates = [
    config.chromePath,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : ''
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate));
}

async function captureFailureScreenshot(name) {
  if (!page) return '';
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  const screenshotPath = path.join(config.screenshotsDir, fileName);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  return screenshotPath;
}

async function safeClick(selector, name, opts = {}) {
  const loc = page.locator(selector).first();
  const count = await loc.count();
  if (!count) {
    skip(name, 'not present');
    return false;
  }
  if (!(await loc.isVisible().catch(() => false))) {
    skip(name, 'not visible');
    return false;
  }
  await loc.click({ timeout: 5000 });
  if (opts.wait) await page.waitForTimeout(opts.wait);
  pass(name);
  return true;
}

async function closeModal() {
  const close = page.locator('.modal.show button[data-bs-dismiss="modal"], .modal.show .btn-close').first();
  if (await close.count()) await close.click().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}

async function expectText(text, name) {
  await page.locator(`text=${text}`).first().waitFor({ state: 'visible', timeout: 10000 });
  pass(name);
}

async function expectVisible(selector, name) {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 8000 });
  pass(name);
}

async function verifyAppVersion(context) {
  const res = await context.request.get(qaRoute('/api/version'), { ignoreHTTPSErrors: true });
  if (!res.ok()) {
    fail('app version endpoint', String(res.status()));
    return;
  }
  const data = await res.json();
  smokeAppVersion = data.version || null;
  if (smokeAppVersion === packageInfo.version) {
    pass('app version matches package.json', smokeAppVersion);
  } else {
    fail('app version matches package.json', `api=${smokeAppVersion || '(blank)'} package=${packageInfo.version}`);
  }
}

async function runSmoke() {
  const chrome = findChromeExecutable();
  if (!chrome) {
    throw new Error('Chrome was not found. Install Google Chrome or set QA_CHROME_PATH in qa/.env.qa.');
  }

  const fixture = await seedNeedsActionFixture();

  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo,
    executablePath: chrome
  });

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      baseURL: config.baseURL,
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true
    });

    page = await context.newPage();
    await verifyAppVersion(context);
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
    });
    page.on('requestfailed', req => {
      const errorText = req.failure()?.errorText || '';
      if (errorText.includes('net::ERR_ABORTED')) return;
      errors.push('REQUESTFAILED: ' + req.url() + ' ' + errorText);
    });
    page.on('response', res => {
      const status = res.status();
      if (status >= 500) errors.push('HTTP ' + status + ': ' + res.url());
    });

    await page.goto(qaRoute('/login'), { waitUntil: 'domcontentloaded' });
    await page.fill('#username', config.loginUsername);
    await page.fill('#password', config.loginPassword);
    await Promise.all([
      page.waitForURL('**/dashboard', { timeout: 15000 }),
      page.click('#loginBtn')
    ]);
    pass(`login ${config.loginUsername}/${'*'.repeat(config.loginPassword.length)} via HTTPS proxy`);

    await page.waitForLoadState('networkidle').catch(() => {});
    await expectText('Dashboard', 'dashboard loaded');
    await safeClick('#themeToggle', 'dashboard theme toggle', { wait: 200 });
    await safeClick('#sidebarCollapse', 'dashboard sidebar toggle', { wait: 200 });

    if (isNeedsActionSmoke) {
      await verifyNeedsActionFlow(fixture).catch(err => {
        fail('needs-action smoke flow', err.message || String(err));
      });
    }

    const pages = [
      ['/dashboard', 'Dashboard'],
      ['/patients', 'Patients Management'],
      ['/rx-records', 'RX Records'],
      ['/reports', 'Reports'],
      ['/audit-log', 'Audit Log'],
      ['/import', 'Data Import'],
      ['/pharmacies', 'Pharmacies'],
      ['/patient-transport', 'Patient Transport Companies'],
      ['/pharmacy-transport', 'Pharmacy Transport Companies'],
      ['/clinics', 'Clinics'],
      ['/workflow-actions', 'Workflow Actions'],
      ['/medication-catalog', 'RX Actions'],
      ['/users', 'User Management'],
      ['/roles', 'Roles Management'],
      ['/backups', 'Backup Management'],
      ['/system-settings', 'System Settings'],
      ['/active-users', 'Active Users'],
      ['/changelog', 'Changelog']
    ];

    for (const [url, label] of pages) {
      await page.goto(qaRoute(url), { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await expectText(label.split(' ')[0], `${url} page reachable`);
    }

    await page.goto(qaRoute('/patients'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.fill('#srchFirstName', 'QA');
    await page.waitForTimeout(700);
    await page.locator('tbody:has-text("QA Patient")').waitFor({ state: 'visible', timeout: 10000 });
    pass('patients search shows seeded QA patient');
    await safeClick('#advancedToggleBtn', 'patients advanced filters toggle', { wait: 300 });
    await safeClick('#clearBtn', 'patients clear filters', { wait: 500 });
    await safeClick('#addPatientBtn', 'patients add modal opens', { wait: 500 });
    await expectVisible('#patientModal.show', 'patient modal visible');
    await closeModal();
    await safeClick('#exportPatientsCsvBtn', 'patients export button opens selector/download', { wait: 500 });
    await closeModal();

    await page.goto(qaRoute('/rx-records'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.fill('#rxFilterPatient', 'QA');
    await safeClick('#rxFilterBtn', 'rx search button', { wait: 700 });
    await page.locator('tbody:has-text("QA Patient")').waitFor({ state: 'visible', timeout: 10000 });
    pass('rx list shows seeded QA RX');
    await safeClick('button:has-text("New RX")', 'rx new modal opens', { wait: 500 });
    await expectVisible('#rxModal.show', 'rx modal visible');
    await closeModal();
    await safeClick('#rxClearBtn', 'rx clear filters', { wait: 500 });
    await safeClick('button[title="Workflow"]', 'rx workflow modal opens', { wait: 800 });
    await expectVisible('#workflowModal.show', 'workflow modal visible');
    await closeModal();
    await safeClick('button[title="View History"]', 'rx history modal opens', { wait: 800 });
    await closeModal();

    const crudPages = [
      ['/pharmacies', 'QA Pharmacy'],
      ['/patient-transport', 'QA Patient Transport'],
      ['/pharmacy-transport', 'QA Pharmacy Transport'],
      ['/clinics', 'QA Clinic'],
      ['/workflow-actions', 'QA Received Warehouse'],
      ['/medication-catalog', 'QA Medication Action']
    ];

    for (const [url, seededText] of crudPages) {
      await page.goto(qaRoute(url), { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await expectText(seededText, `${url} shows seeded data`);
      const addButton = page.locator('#addNewBtn, button:has-text("Add"), button:has-text("New")').first();
      if (await addButton.count() && await addButton.isVisible().catch(() => false)) {
        await addButton.click();
        await page.waitForTimeout(400);
        pass(`${url} add button clickable`);
        await closeModal();
      } else {
        skip(`${url} add button`, 'not visible/found');
      }
    }

    await page.goto(qaRoute('/reports'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await safeClick('button, a.btn', 'reports first visible action button', { wait: 500 }).catch(e => skip('reports button', e.message));

    await page.goto(qaRoute('/backups'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expectText('Backup', 'backups page loaded');
    skip('backup run/restore/delete buttons', 'destructive/heavy operations intentionally not clicked in smoke test');

    await page.goto(qaRoute('/system-settings'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expectText('System', 'system settings page loaded');

    await page.goto(qaRoute('/backoffice'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const backofficeUrl = page.url();
    if (backofficeUrl.includes('/dashboard') || await page.locator('text=Master admin access required').count()) {
      pass('backoffice restricted for non-isMaster admin');
    } else {
      fail('backoffice restriction', 'non-isMaster admin was not redirected/restricted: ' + backofficeUrl);
    }

    const api = await context.request.get(qaRoute('/api/dashboard/stats'), { ignoreHTTPSErrors: true });
    if (api.ok()) pass('authenticated API dashboard stats');
    else fail('authenticated API dashboard stats', String(api.status()));
  } finally {
    await browser.close().catch(() => {});
  }
}

function writeSummary() {
  const failed = results.filter(r => r.status === 'FAIL').length;
  const summary = {
    generatedAt: new Date().toISOString(),
    baseURL: config.baseURL,
    database: config.dbName,
    packageVersion: packageInfo.version,
    appVersion: smokeAppVersion,
    smokeNeedsAction: config.smokeNeedsAction,
    passed: results.filter(r => r.status === 'PASS').length,
    failed,
    skipped,
    errors,
    results
  };
  const reportPath = path.join(config.resultsDir, 'smoke-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

(async () => {
  try {
    await runSmoke();
  } catch (err) {
    const screenshot = await captureFailureScreenshot('smoke-crash');
    fail('smoke test crashed', `${err.stack || err.message}${screenshot ? ` | screenshot: ${screenshot}` : ''}`);
  }

  const summary = writeSummary();
  if (summary.failed || summary.errors.length) process.exit(1);
})();
