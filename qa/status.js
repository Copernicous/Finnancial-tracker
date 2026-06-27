const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const { readConfig, ensureQaDirectories } = require('./lib/qa-env');

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(file) {
  if (!fs.existsSync(file)) return null;
  const pid = Number(fs.readFileSync(file, 'utf8').trim());
  return Number.isFinite(pid) ? pid : null;
}

function checkPort(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 1500 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

function requestStatus(url) {
  return new Promise(resolve => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request({
      method: 'HEAD',
      hostname: parsed.hostname,
      port: parsed.port,
      path: '/login',
      rejectUnauthorized: false,
      timeout: 3000
    }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function main() {
  const config = readConfig();
  ensureQaDirectories(config);

  const backendPid = readPid(path.join(config.pidsDir, 'backend.pid'));
  const proxyPid = readPid(path.join(config.pidsDir, 'https-proxy.pid'));
  const backendOpen = await checkPort(config.backendPort);
  const httpsOpen = await checkPort(config.httpsPort);
  const statusCode = await requestStatus(config.baseURL);

  console.log('Home Accounting QA status');
  console.log('--------------------');
  console.log(`QA URL:          ${config.baseURL}`);
  console.log(`QA database:     ${config.dbName}`);
  console.log(`Backend port:    ${config.backendPort} ${backendOpen ? 'OPEN' : 'CLOSED'}`);
  console.log(`HTTPS port:      ${config.httpsPort} ${httpsOpen ? 'OPEN' : 'CLOSED'}`);
  console.log(`Login page:      ${statusCode || 'not reachable'}`);
  console.log(`Backend PID:     ${backendPid || 'none'} ${backendPid && isPidAlive(backendPid) ? '(alive)' : ''}`);
  console.log(`HTTPS proxy PID: ${proxyPid || 'none'} ${proxyPid && isPidAlive(proxyPid) ? '(alive)' : ''}`);
  console.log('');
  console.log(`Logs:            ${path.relative(config.rootDir, config.logsDir)}`);
  console.log(`Results:         ${path.relative(config.rootDir, config.resultsDir)}`);

  const reportPath = path.join(config.resultsDir, 'smoke-report.json');
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    console.log('');
    console.log(`Last smoke:      ${report.passed} passed, ${report.failed} failed, ${report.errors.length} errors, ${report.skipped.length} skipped`);
    console.log(`Report file:     ${path.relative(config.rootDir, reportPath)}`);
  }
}

main().catch(err => {
  console.error('[QA status failed]', err.message);
  process.exit(1);
});

