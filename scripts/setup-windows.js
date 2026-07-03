#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, '.env.example');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');

main().catch((error) => {
  console.error('');
  console.error(`[ERROR] ${error.message || error}`);
  process.exitCode = 1;
});

async function main() {
  const args = process.argv.slice(2);
  const mode = String(args[0] || '').toLowerCase();
  const restoreMode = mode === 'restore';
  const checkOnly = mode === 'check' || mode === 'test';
  const restoreFile = restoreMode ? args[1] : '';

  if (mode === 'help' || mode === '--help' || mode === '-h') {
    printUsage();
    return;
  }

  if (mode && !restoreMode && !checkOnly) {
    throw new Error(`Unknown setup mode: ${args[0]}`);
  }

  const pkg = readPackage();
  ensureEnvFile(checkOnly);
  const settings = await loadSettings();
  const runtimeEnv = buildRuntimeEnv(settings);
  const tools = findPostgresTools();
  const npm = findOnPath(process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npx = findOnPath(process.platform === 'win32' ? 'npx.cmd' : 'npx');
  if (!npm) throw new Error('npm is not available on PATH. Install Node.js, then reopen PowerShell.');
  if (!npx) throw new Error('npx is not available on PATH. Install Node.js, then reopen PowerShell.');

  printHeader(settings, tools.psql, pkg);

  if (!checkOnly) {
    console.log('[1/6] Installing Node.js dependencies...');
    run(npm, ['install'], { env: runtimeEnv });
    console.log('');
  }

  console.log(checkOnly ? '[1/2] Checking PostgreSQL login...' : '[2/6] Checking PostgreSQL login...');
  const env = runtimeEnv;
  const login = run(tools.psql, [
    '-U', settings.user,
    '-h', settings.host,
    '-p', settings.port,
    '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1',
    '-c', 'SELECT 1;'
  ], { env, quiet: true, allowFailure: true });

  if (login.status !== 0 || login.error) {
    printLoginFailure(settings, tools.psql, login);
    process.exitCode = 1;
    return;
  }
  console.log('  PostgreSQL connected OK.');
  console.log('');

  console.log(`${checkOnly ? '[2/2]' : '[3/6]'} Creating database "${settings.database}" if needed...`);
  const exists = run(tools.psql, [
    '-U', settings.user,
    '-h', settings.host,
    '-p', settings.port,
    '-d', 'postgres',
    '-tAc',
    `SELECT 1 FROM pg_database WHERE datname = '${escapeSql(settings.database)}';`
  ], { env, quiet: true, allowFailure: true });

  if (!String(exists.stdout || '').trim().includes('1')) {
    const create = run(tools.createdb, [
      '-U', settings.user,
      '-h', settings.host,
      '-p', settings.port,
      settings.database
    ], { env, allowFailure: true });

    if (create.status !== 0 || create.error) {
      throw new Error(`Could not create database "${settings.database}". Confirm that user "${settings.user}" has CREATEDB permission.`);
    }
    console.log('  Database created.');
  } else {
    console.log('  Database already exists.');
  }
  console.log('  Database ready.');
  console.log('');

  if (checkOnly) {
    console.log('CHECK COMPLETE. PostgreSQL settings are valid.');
    return;
  }

  if (restoreMode) {
    if (!restoreFile) {
      throw new Error('Restore mode requires a .dump file path. Usage: setup.bat restore "path\\to\\backup.dump"');
    }
    if (!fs.existsSync(path.resolve(restoreFile))) {
      throw new Error(`Restore file not found: ${restoreFile}`);
    }

    console.log(`[4/6] Restoring database from: ${restoreFile}`);
    const restore = run(tools.pgRestore, [
      '-U', settings.user,
      '-h', settings.host,
      '-p', settings.port,
      '-d', settings.database,
      '--no-owner',
      '--no-privileges',
      restoreFile
    ], { env, allowFailure: true });
    if (restore.status !== 0 || restore.error) {
      console.log('  Restore completed with warnings or errors. Review the output above.');
    } else {
      console.log('  Database restored successfully.');
    }
    console.log('');

    console.log('[5/6] Skipping migrations because data was restored from dump.');
    console.log('[6/6] Setup complete.');
    printComplete('RESTORE COMPLETE', pkg);
    return;
  }

  console.log('[4/6] Running database setup...');
  runDatabaseSetup(pkg, tools, env, settings);
  console.log('');

  console.log('[5/6] Seeding initial data...');
  runSeed(pkg, env);
  console.log('');

  console.log('[6/6] Setup complete.');
  printComplete('FRESH INSTALL COMPLETE', pkg);
}

function ensureEnvFile(checkOnly) {
  if (fs.existsSync(ENV_PATH) || checkOnly) return;
  if (!fs.existsSync(ENV_EXAMPLE_PATH)) return;
  fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
  console.log('[OK] Created .env from .env.example.');
}

async function loadSettings() {
  const env = parseEnvFile(ENV_PATH);
  const settings = {
    host: readSetting(env, ['DB_HOST', 'PGHOST'], '127.0.0.1'),
    port: readSetting(env, ['DB_PORT', 'PGPORT'], '5432'),
    user: readSetting(env, ['DB_USER', 'PGUSER'], 'postgres'),
    password: readSetting(env, ['DB_PASS', 'PGPASSWORD'], ''),
    database: readSetting(env, ['DB_NAME', 'PGDATABASE'], defaultDatabaseName())
  };

  if (!settings.password || isPasswordPlaceholder(settings.password)) {
    settings.password = await promptLine(`Enter PostgreSQL password for ${settings.user}: `);
  }

  return settings;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log('[!] .env file not found. Defaults will be used where possible.');
    return {};
  }

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

function readSetting(env, names, fallback) {
  for (const name of names) {
    const value = env[name] || process.env[name];
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

function isPasswordPlaceholder(value) {
  return /^(yourpassword|your_db_password_here|change_me|password)$/i.test(String(value).trim());
}

function defaultDatabaseName() {
  const pkg = readPackage();
  const base = String(pkg.name || path.basename(ROOT_DIR))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'app';
  return `${base}_dev`;
}

function readPackage() {
  if (!fs.existsSync(PACKAGE_PATH)) return {};
  return JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
}

function buildRuntimeEnv(settings) {
  return {
    ...process.env,
    DB_HOST: settings.host,
    DB_PORT: settings.port,
    DB_USER: settings.user,
    DB_PASS: settings.password,
    DB_NAME: settings.database,
    PGHOST: settings.host,
    PGPORT: settings.port,
    PGUSER: settings.user,
    PGPASSWORD: settings.password,
    PGDATABASE: settings.database
  };
}

function findPostgresTools() {
  const psql = findOnPath(process.platform === 'win32' ? 'psql.exe' : 'psql') || findPostgresTool(process.platform === 'win32' ? 'psql.exe' : 'psql');
  if (!psql) {
    throw new Error('Could not find psql.exe. Install PostgreSQL or add PostgreSQL bin to PATH.');
  }

  const binDir = path.dirname(psql);
  const createdb = path.join(binDir, process.platform === 'win32' ? 'createdb.exe' : 'createdb');
  const pgRestore = path.join(binDir, process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore');
  if (!fs.existsSync(createdb)) throw new Error(`Could not find createdb next to psql: ${createdb}`);
  if (!fs.existsSync(pgRestore)) throw new Error(`Could not find pg_restore next to psql: ${pgRestore}`);

  return { psql, createdb, pgRestore };
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

function findOnPath(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) return '';
  return String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function runDatabaseSetup(pkg, tools, env, settings) {
  if (pkg.scripts && pkg.scripts['db:migrate']) {
    const npx = findOnPath(process.platform === 'win32' ? 'npx.cmd' : 'npx');
    run(npx, ['sequelize-cli', 'db:migrate'], { env });
    console.log('  Migrations completed.');
    return;
  }

  const schemaPath = path.join(ROOT_DIR, 'infra', 'postgres', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    run(tools.psql, [
      '-U', settings.user,
      '-h', settings.host,
      '-p', settings.port,
      '-d', settings.database,
      '-v', 'ON_ERROR_STOP=1',
      '-f', schemaPath
    ], { env });
    console.log('  Schema applied.');
    return;
  }

  console.log('  No db:migrate script or infra/postgres/schema.sql found. Skipping.');
}

function runSeed(pkg, env) {
  if (!(pkg.scripts && pkg.scripts['db:seed'])) {
    console.log('  No db:seed script found. Skipping.');
    return;
  }
  const npx = findOnPath(process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const seed = run(npx, ['sequelize-cli', 'db:seed:all'], { env, allowFailure: true });
  if (seed.status !== 0 || seed.error) {
    console.log('  WARNING: Seeding failed. This can be normal if seed data already exists.');
  } else {
    console.log('  Seed complete.');
  }
}

function run(command, args, options = {}) {
  const prepared = prepareCommand(command, args);
  const result = spawnSync(prepared.command, prepared.args, {
    cwd: ROOT_DIR,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.quiet ? 'pipe' : 'inherit',
    windowsHide: true
  });

  if (!options.allowFailure && (result.error || result.status !== 0)) {
    const reason = result.error ? result.error.message : `exit code ${result.status}`;
    const output = options.quiet ? `${result.stdout || ''}${result.stderr || ''}`.trim() : '';
    const details = output ? `${os.EOL}${output}` : '';
    throw new Error(`Command failed (${reason}): ${command} ${args.join(' ')}${details}`);
  }

  return result;
}

function prepareCommand(command, args) {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args };
  }

  const comspec = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
  return {
    command: comspec,
    args: ['/d', '/c', 'call', command, ...args]
  };
}

function printHeader(settings, psql, pkg) {
  console.log('');
  console.log('============================================================');
  console.log(`  ${pkg.name || 'Node App'} - New Server Setup`);
  console.log('============================================================');
  console.log(`  Database : ${settings.database}`);
  console.log(`  Host     : ${settings.host}`);
  console.log(`  Port     : ${settings.port}`);
  console.log(`  User     : ${settings.user}`);
  console.log(`  psql     : ${psql}`);
  console.log('============================================================');
  console.log('');
}

function printLoginFailure(settings, psql, result) {
  const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? result.error.message : ''}`.trim();
  console.log('');
  console.log('[ERROR] Cannot log in to PostgreSQL using the .env settings.');
  console.log('');
  console.log(`  Host: ${settings.host}`);
  console.log(`  Port: ${settings.port}`);
  console.log(`  User: ${settings.user}`);
  console.log('');
  console.log('  Notes:');
  console.log('  - 127.0.0.1 is correct when PostgreSQL is on this same server.');
  console.log('  - Check DB_PASS/PGPASSWORD in .env and remove trailing spaces.');
  console.log('  - Passwords with ! are supported by this setup script.');
  console.log('  - Make sure the PostgreSQL Windows service is running.');
  if (output) {
    console.log('');
    console.log('  PostgreSQL said:');
    console.log(`  ${output.replace(/\r?\n/g, `${os.EOL}  `)}`);
  }
  console.log('');
  console.log('  Manual test:');
  console.log(`  "${psql}" -h ${settings.host} -p ${settings.port} -U ${settings.user} -d postgres -c "SELECT 1;"`);
  console.log('');
}

function printComplete(title, pkg) {
  console.log('');
  console.log('============================================================');
  console.log(`  ${title}`);
  console.log('  Start the server: npm start');
  if (pkg.scripts && pkg.scripts.dev) console.log('  Development: npm run dev');
  console.log('============================================================');
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

function promptLine(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function printUsage() {
  console.log(`Windows setup

Usage:
  setup.bat
  setup.bat check
  setup.bat restore "path\\to\\backup.dump"
`);
}
