#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const envPath = path.join(ROOT_DIR, '.env');
const envFile = parseEnvFile(envPath);
const settings = {
  host: readSetting('DB_HOST', '127.0.0.1'),
  port: readSetting('DB_PORT', '5432'),
  user: readSetting('DB_USER', 'postgres'),
  password: readSetting('DB_PASS', ''),
  database: readSetting('DB_NAME', 'home_accounting_dev')
};

main();

function main() {
  const psql = findOnPath('psql.exe') || findPostgresTool('psql.exe');

  console.log('');
  console.log('============================================================');
  console.log('  Home Accounting - PostgreSQL Connection Test');
  console.log('============================================================');
  console.log(`  .env     : ${envPath}`);
  console.log(`  Database : ${settings.database}`);
  console.log(`  Host     : ${settings.host}`);
  console.log(`  Port     : ${settings.port}`);
  console.log(`  User     : ${settings.user}`);
  console.log(`  Password : ${settings.password ? `set (${settings.password.length} chars)` : 'missing'}`);
  console.log(`  psql     : ${psql || 'not found'}`);
  console.log('============================================================');
  console.log('');

  if (!psql) {
    fail('Could not find psql.exe. Install PostgreSQL or add PostgreSQL bin to PATH.');
    return;
  }

  if (!settings.password) {
    fail('DB_PASS is empty. Put the PostgreSQL password in .env.');
    return;
  }

  const env = { ...process.env, PGPASSWORD: settings.password };

  console.log('[1/3] Testing login to default database "postgres"...');
  const login = run(psql, [
    '-h', settings.host,
    '-p', settings.port,
    '-U', settings.user,
    '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1',
    '-c', 'SELECT 1;'
  ], env);
  if (login.status !== 0) {
    fail('PostgreSQL rejected the .env login settings.', login);
    return;
  }
  console.log('  OK: login works.');
  console.log('');

  console.log(`[2/3] Checking database "${settings.database}"...`);
  const exists = run(psql, [
    '-h', settings.host,
    '-p', settings.port,
    '-U', settings.user,
    '-d', 'postgres',
    '-tAc',
    `SELECT 1 FROM pg_database WHERE datname = '${escapeSql(settings.database)}';`
  ], env);
  if (exists.status !== 0) {
    fail('Could not check the target database.', exists);
    return;
  }
  if (!String(exists.stdout || '').trim().includes('1')) {
    console.log(`  MISSING: database "${settings.database}" does not exist yet.`);
    console.log('  Run setup.bat to create it.');
    process.exitCode = 2;
    return;
  }
  console.log('  OK: database exists.');
  console.log('');

  console.log(`[3/3] Testing login to target database "${settings.database}"...`);
  const target = run(psql, [
    '-h', settings.host,
    '-p', settings.port,
    '-U', settings.user,
    '-d', settings.database,
    '-v', 'ON_ERROR_STOP=1',
    '-c', 'SELECT 1;'
  ], env);
  if (target.status !== 0) {
    fail('Could not log in to the target database.', target);
    return;
  }
  console.log('  OK: target database login works.');
  console.log('');
  console.log('[PASS] PostgreSQL settings in .env are valid.');
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = stripMatchingQuotes(trimmed.slice(index + 1).trim());
    env[key] = value;
  }
  return env;
}

function readSetting(name, fallback) {
  return envFile[name] || process.env[name] || fallback;
}

function stripMatchingQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function findOnPath(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) return '';
  return String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function findPostgresTool(tool) {
  const roots = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)']
  ].filter(Boolean);

  const candidates = [];
  for (const root of roots) {
    const postgresDir = path.join(root, 'PostgreSQL');
    if (!fs.existsSync(postgresDir)) continue;
    for (const version of fs.readdirSync(postgresDir)) {
      candidates.push(path.join(postgresDir, version, 'bin', tool));
    }
  }

  return candidates
    .filter((candidate) => fs.existsSync(candidate))
    .sort(compareVersionsFromPath)
    .pop() || '';
}

function compareVersionsFromPath(left, right) {
  return Number(path.basename(path.dirname(path.dirname(left)))) - Number(path.basename(path.dirname(path.dirname(right))));
}

function run(command, args, env) {
  return spawnSync(command, args, {
    cwd: ROOT_DIR,
    env,
    encoding: 'utf8',
    windowsHide: true
  });
}

function fail(message, result) {
  console.error(`[FAIL] ${message}`);
  if (result) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    if (output) console.error(output);
  }
  console.error('');
  console.error('Manual PowerShell test:');
  console.error(`  & "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe" -h ${settings.host} -p ${settings.port} -U ${settings.user} -d postgres -c "SELECT 1;"`);
  process.exitCode = 1;
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}
