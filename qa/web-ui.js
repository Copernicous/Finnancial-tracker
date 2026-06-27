const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { readConfig, ensureQaDirectories } = require('./lib/qa-env');

const config = readConfig();
ensureQaDirectories(config);

const app = express();
const webHost = process.env.QA_WEB_HOST || '127.0.0.1';
const webPort = Number(process.env.QA_WEB_PORT || 3200);
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const qaToken = crypto.randomBytes(24).toString('hex');

if (!localHosts.has(webHost) && process.env.QA_WEB_ALLOW_REMOTE !== 'true') {
  console.error('Refusing to start passwordless QA web UI on a non-localhost address.');
  console.error('Use QA_WEB_HOST=127.0.0.1 or set QA_WEB_ALLOW_REMOTE=true only on an isolated QA network.');
  process.exit(1);
}

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.join(config.qaDir, 'web', 'public')));

function requireQaToken(req, res, next) {
  if (req.headers['x-qa-token'] !== qaToken) {
    return res.status(403).json({ error: 'Invalid QA dashboard token. Refresh the dashboard and try again.' });
  }
  next();
}

let currentJob = null;
let lastJob = null;

const tasks = {
  start: {
    title: 'Start local QA site',
    args: ['qa/start-local-qa.js']
  },
  'simulate-import': {
    title: 'Run patient import workflow simulation',
    args: ['scripts/simulate-patient-workflow-import.js']
  },
  seed: {
    title: 'Seed fake QA data',
    args: ['qa/seed-qa-data.js']
  },
  'seed-append': {
    title: 'Add more fake QA data',
    args: ['qa/seed-qa-data.js'],
    env: { QA_SEED_APPEND: 'true' }
  },
  smoke: {
    title: 'Run headless smoke test',
    args: ['qa/smoke-qa.js'],
    env: { QA_HEADLESS: 'true', QA_SLOW_MO: '0' }
  },
  'smoke-needs-action': {
    title: 'Run needs-action smoke check',
    args: ['qa/smoke-qa.js'],
    env: { QA_HEADLESS: 'true', QA_SLOW_MO: '0', QA_SMOKE_NEEDS_ACTION: 'true' }
  },
  'smoke-fortigate': {
    title: 'Run FortiGate smoke test',
    args: ['qa/smoke-qa.js'],
    env: { QA_HEADLESS: 'true', QA_SLOW_MO: '0' },
    requiresBaseURL: true
  },
  'smoke-visible': {
    title: 'Run visible smoke test',
    args: ['qa/smoke-qa.js'],
    env: { QA_HEADLESS: 'false', QA_SLOW_MO: '300' }
  },
  stop: {
    title: 'Stop local QA site',
    args: ['qa/stop-local-qa.js']
  }
};

function appendOutput(job, chunk) {
  job.output += chunk.toString();
  if (job.output.length > 70000) job.output = job.output.slice(-70000);
}

function normalizeSmokeBaseURL(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    throw new Error('FortiGate URL is required.');
  }

  const parsed = new URL(raw);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('FortiGate URL must start with http:// or https://.');
  }

  parsed.hash = '';
  parsed.search = '';

  const segments = parsed.pathname.split('/');
  const schemeIndex = segments.findIndex(segment => segment === 'http' || segment === 'https');
  if (schemeIndex >= 0 && segments[schemeIndex + 1]) {
    parsed.pathname = segments.slice(0, schemeIndex + 2).join('/');
  } else {
    const appRoutes = [
      '/login',
      '/dashboard',
      '/patients',
      '/rx-records',
      '/reports',
      '/audit-log',
      '/import',
      '/pharmacies',
      '/patient-transport',
      '/pharmacy-transport',
      '/clinics',
      '/workflow-actions',
      '/medication-catalog',
      '/users',
      '/roles',
      '/backups',
      '/system-settings',
      '/active-users',
      '/changelog',
      '/backoffice'
    ];
    const matchedRoute = appRoutes.find(route => parsed.pathname.endsWith(route));
    if (matchedRoute) parsed.pathname = parsed.pathname.slice(0, -matchedRoute.length) || '/';
  }

  return parsed.toString().replace(/\/+$/, '');
}

function runNodeTask(taskKey, input = {}) {
  const task = tasks[taskKey];
  if (!task) {
    const err = new Error(`Unknown QA task: ${taskKey}`);
    err.statusCode = 404;
    throw err;
  }

  if (currentJob && currentJob.running) {
    const err = new Error(`Another QA task is already running: ${currentJob.title}`);
    err.statusCode = 409;
    throw err;
  }

  const env = { ...(task.env || {}) };
  let detail = '';
  if (task.requiresBaseURL) {
    const baseURL = normalizeSmokeBaseURL(input.baseURL);
    env.QA_BASE_URL = baseURL;
    detail = `Target: ${baseURL}\n`;
  }

  const job = {
    id: Date.now().toString(36),
    key: taskKey,
    title: task.title,
    running: true,
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    output: detail
  };

  currentJob = job;
  lastJob = job;

  const child = spawn(process.execPath, task.args, {
    cwd: config.rootDir,
    env: { ...process.env, ...env },
    windowsHide: taskKey !== 'smoke-visible'
  });

  child.stdout.on('data', chunk => appendOutput(job, chunk));
  child.stderr.on('data', chunk => appendOutput(job, chunk));
  child.on('error', err => appendOutput(job, `\n[spawn error] ${err.message}\n`));
  child.on('close', code => {
    job.running = false;
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    appendOutput(job, `\n[${task.title} exited with code ${code}]\n`);
    currentJob = null;
  });

  return job;
}

function runStatus() {
  return new Promise(resolve => {
    execFile(process.execPath, ['qa/status.js'], {
      cwd: config.rootDir,
      env: process.env,
      windowsHide: true,
      timeout: 15000
    }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        exitCode: err && typeof err.code === 'number' ? err.code : 0,
        output: `${stdout || ''}${stderr || ''}`.trim()
      });
    });
  });
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function tailFile(filePath, maxBytes = 50000) {
  if (!fs.existsSync(filePath)) return '';
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const buffer = Buffer.alloc(stat.size - start);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

app.get('/api/config', (req, res) => {
  res.json({
    qaBaseURL: config.baseURL,
    qaDatabase: config.dbName,
    qaWebURL: `http://${webHost}:${webPort}`,
    passwordless: true,
    localhostOnly: localHosts.has(webHost),
    qaToken
  });
});

app.get('/api/status', async (req, res) => {
  const status = await runStatus();
  const report = readJsonIfExists(path.join(config.resultsDir, 'smoke-report.json'));
  res.json({ ...status, report, job: currentJob || lastJob });
});

app.post('/api/run/:task', requireQaToken, (req, res) => {
  try {
    const job = runNodeTask(req.params.task, req.body || {});
    res.status(202).json(job);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/job', (req, res) => {
  res.json(currentJob || lastJob || { running: false, output: '', title: 'No task has run yet.' });
});

app.get('/api/report', (req, res) => {
  const report = readJsonIfExists(path.join(config.resultsDir, 'smoke-report.json'));
  if (!report) return res.status(404).json({ error: 'No smoke report found yet.' });
  res.json(report);
});

app.get('/api/logs/:name', (req, res) => {
  const files = {
    backend: path.join(config.logsDir, 'backend.log'),
    proxy: path.join(config.logsDir, 'https-proxy.log'),
    report: path.join(config.resultsDir, 'smoke-report.json'),
    seed: path.join(config.resultsDir, 'seed-result.json')
  };
  const filePath = files[req.params.name];
  if (!filePath) return res.status(404).json({ error: 'Unknown log.' });
  res.type('text/plain').send(tailFile(filePath) || 'No file found yet.');
});

app.get('/manual', (req, res) => {
  res.type('text/plain').send(tailFile(path.join(config.qaDir, 'QA-WEB-MANUAL.md'), 200000));
});

app.listen(webPort, webHost, () => {
  console.log('Home Accounting QA Web Dashboard');
  console.log('---------------------------');
  console.log(`Open: http://${webHost}:${webPort}`);
  console.log(`QA site: ${config.baseURL}`);
  console.log('No dashboard password is required; bound to localhost by default.');
});

