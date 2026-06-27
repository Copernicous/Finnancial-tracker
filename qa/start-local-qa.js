const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { spawn, spawnSync } = require('child_process');
const {
  readConfig,
  ensureQaDirectories,
  assertQaDatabase,
  applyRuntimeEnv
} = require('./lib/qa-env');
const { ensureDatabase } = require('./lib/postgres');

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

function startDetached(command, args, options, logFile) {
  const out = fs.openSync(logFile, 'a');
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true
  });
  child.unref();
  return child.pid;
}

function ensureCertificate(config) {
  const pfxPath = path.join(config.certDir, 'localhost.pfx');
  if (fs.existsSync(pfxPath)) {
    try {
      tls.createSecureContext({
        pfx: fs.readFileSync(pfxPath),
        passphrase: config.pfxPassphrase
      });
      return pfxPath;
    } catch {
      console.log('Existing local HTTPS certificate does not match the QA passphrase; recreating it...');
      fs.rmSync(pfxPath, { force: true });
    }
  }

  console.log('Creating local self-signed HTTPS certificate for localhost...');
  const escapedPfx = pfxPath.replace(/'/g, "''");
  const escapedPass = config.pfxPassphrase.replace(/'/g, "''");
  const script = [
    `$password = ConvertTo-SecureString '${escapedPass}' -AsPlainText -Force`,
    `$cert = New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation 'Cert:\\CurrentUser\\My'`,
    `Export-PfxCertificate -Cert $cert -FilePath '${escapedPfx}' -Password $password | Out-Null`,
    `Remove-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $cert.Thumbprint) -Force`
  ].join('; ');

  const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: config.rootDir,
    encoding: 'utf8'
  });

  if (result.status !== 0 || !fs.existsSync(pfxPath)) {
    throw new Error(`Could not create HTTPS certificate.\n${result.stderr || result.stdout}`);
  }

  return pfxPath;
}

async function main() {
  const config = readConfig();
  ensureQaDirectories(config);
  assertQaDatabase(config);

  const backendPidFile = path.join(config.pidsDir, 'backend.pid');
  const proxyPidFile = path.join(config.pidsDir, 'https-proxy.pid');
  const existingBackendPid = readPid(backendPidFile);
  const existingProxyPid = readPid(proxyPidFile);

  await ensureDatabase(config);
  ensureCertificate(config);

  applyRuntimeEnv(config);

  if (existingBackendPid && isPidAlive(existingBackendPid)) {
    console.log(`QA backend already running, PID ${existingBackendPid}`);
  } else {
    const backendLog = path.join(config.logsDir, 'backend.log');
    const backendPid = startDetached(process.execPath, ['app.js'], {
      cwd: config.rootDir,
      env: { ...process.env }
    }, backendLog);
    fs.writeFileSync(backendPidFile, String(backendPid));
    console.log(`Started QA backend on port ${config.backendPort}, PID ${backendPid}`);
  }

  if (existingProxyPid && isPidAlive(existingProxyPid)) {
    console.log(`QA HTTPS proxy already running, PID ${existingProxyPid}`);
  } else {
    const proxyLog = path.join(config.logsDir, 'https-proxy.log');
    const proxyPid = startDetached(process.execPath, ['qa/https-proxy.js'], {
      cwd: config.rootDir,
      env: { ...process.env }
    }, proxyLog);
    fs.writeFileSync(proxyPidFile, String(proxyPid));
    console.log(`Started QA HTTPS proxy on ${config.baseURL}, PID ${proxyPid}`);
  }

  console.log('');
  console.log(`QA URL: ${config.baseURL}`);
  console.log(`QA database: ${config.dbName}`);
  console.log('Next recommended command: node qa/seed-qa-data.js');
}

main().catch(err => {
  console.error('[QA start failed]', err.message);
  process.exit(1);
});
