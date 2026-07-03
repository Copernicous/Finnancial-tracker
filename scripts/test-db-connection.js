#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const envFile = parseEnvFile(ENV_PATH);
const settings = {
  host: readSetting(['DB_HOST', 'PGHOST'], '127.0.0.1'),
  port: readSetting(['DB_PORT', 'PGPORT'], '5432'),
  user: readSetting(['DB_USER', 'PGUSER'], 'postgres'),
  password: readSetting(['DB_PASS', 'PGPASSWORD'], ''),
  database: readSetting(['DB_NAME', 'PGDATABASE'], defaultDatabaseName())
};

main();

function main() {
  const psql = findOnPath(process.platform === 'win32' ? 'psql.exe' : 'psql') || findPostgresTool(process.platform === 'win32' ? 'psql.exe' : 'psql');

  console.log('');
  console.log('============================================================');
  console.log('  PostgreSQL Connection Test');
  console.log('============================================================');
  console.log(`  .env     : ${ENV_PATH}`);
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

  if (!settings.password || isPasswordPlaceholder(settings.password)) {
    fail('Database password is missing or still a placeholder in .env.');
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
  if (login.status !== 0 || login.error) {
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
  if (exists.status !== 0 || exists.error) {
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
  if (target.status !== 0 || target.error) {
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
    env[key] = stripMatchingQuotes(trimmed.slice(index + 1).trim());
  }
  return env;
}

function readSetting(names, fallback) {
  for (const name of names) {
    const value = envFile[name] || process.env[name];
    if (value !== undefined && value !== null && value !== '') return String(value).trim();
  }
  return fallback;
}

function stripMatchingQuotes(value) {
  const text = String(value).trim();
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1);
  }
  return text;
}

function defaultDatabaseName() {
  const packagePath = path.join(ROOT_DIR, 'package.json');
  if (!fs.existsSync(packagePath)) return 'app_dev';
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const base = String(pkg.name || path.basename(ROOT_DIR))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'app';
  return `${base}_dev`;
}

function isPasswordPlaceholder(value) {
  return /^(yourpassword|your_db_password_here|change_me|password)$/i.test(String(value).trim());
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
    const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? result.error.message : ''}`.trim();
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
