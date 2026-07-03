#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

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

  const settings = loadSettings();
  if (!settings.DB_PASS || settings.DB_PASS === 'your_db_password_here') {
    settings.DB_PASS = await promptHiddenEnough(`Enter PostgreSQL password for ${settings.DB_USER}: `);
  }

  const tools = findPostgresTools();
  const npm = findOnPath(process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npx = findOnPath(process.platform === 'win32' ? 'npx.cmd' : 'npx');
  if (!npm) throw new Error('npm is not available on PATH. Install Node.js, then reopen PowerShell.');
  if (!npx) throw new Error('npx is not available on PATH. Install Node.js, then reopen PowerShell.');

  printHeader(settings, tools.psql);

  if (!checkOnly) {
    console.log('[1/6] Installing Node.js dependencies...');
    run(npm, ['install'], { env: process.env });
    console.log('');
  }

  console.log(checkOnly ? '[1/2] Checking PostgreSQL login...' : '[2/6] Checking PostgreSQL login...');
  const env = { ...process.env, PGPASSWORD: settings.DB_PASS };
  const login = run(tools.psql, [
    '-U', settings.DB_USER,
    '-h', settings.DB_HOST,
    '-p', settings.DB_PORT,
    '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1',
    '-c', 'SELECT 1;'
  ], { env, quiet: true, allowFailure: true });

  if (login.status !== 0) {
    printLoginFailure(settings, tools.psql, login);
    process.exitCode = 1;
    return;
  }
  console.log('  PostgreSQL connected OK.');
  console.log('');

  console.log(`${checkOnly ? '[2/2]' : '[3/6]'} Creating database "${settings.DB_NAME}" if needed...`);
  const exists = run(tools.psql, [
    '-U', settings.DB_USER,
    '-h', settings.DB_HOST,
    '-p', settings.DB_PORT,
    '-d', 'postgres',
    '-tAc',
    `SELECT 1 FROM pg_database WHERE datname = '${escapeSql(settings.DB_NAME)}';`
  ], { env, quiet: true, allowFailure: true });

  if (!String(exists.stdout || '').trim().includes('1')) {
    const create = run(tools.createdb, [
      '-U', settings.DB_USER,
      '-h', settings.DB_HOST,
      '-p', settings.DB_PORT,
      settings.DB_NAME
    ], { env, allowFailure: true });

    if (create.status !== 0) {
      throw new Error(`Could not create database "${settings.DB_NAME}". Confirm that user "${settings.DB_USER}" has CREATEDB permission.`);
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
      '-U', settings.DB_USER,
      '-h', settings.DB_HOST,
      '-p', settings.DB_PORT,
      '-d', settings.DB_NAME,
      '--no-owner',
      '--no-privileges',
      restoreFile
    ], { env, allowFailure: true });
    if (restore.status !== 0) {
      console.log('  Restore completed with warnings or errors. Review the output above.');
    } else {
      console.log('  Database restored successfully.');
    }
    console.log('');

    console.log('[5/6] Skipping migrations because data was restored from dump.');
    console.log('[6/6] Setup complete.');

    console.log('');
    console.log('============================================================');
    console.log('  RESTORE COMPLETE');
    console.log('  Start the server: npm start');
    console.log('  Then open: http://localhost:3026');
    console.log('============================================================');
    return;
  }

  console.log('[4/6] Running database migrations...');
  run(npx, ['sequelize-cli', 'db:migrate'], { env: process.env });
  console.log('  Tables created successfully.');
  console.log('');

  console.log('[5/6] Seeding initial data...');
  const seed = run(npx, ['sequelize-cli', 'db:seed:all'], { env: process.env, allowFailure: true });
  if (seed.status !== 0) {
    console.log('  WARNING: Seeding failed. You may need to create the admin manually.');
  } else {
    console.log('  Seed complete.');
  }
  console.log('');

  console.log('[6/6] Setup complete.');
  console.log('');

  console.log('============================================================');
  console.log('  FRESH INSTALL COMPLETE');
  console.log('  Default admin login:');
  console.log('    Username: admin');
  console.log('    Password: admin123');
  console.log('');
  console.log('  IMPORTANT: Change the admin password after first login.');
  console.log('  Start the server: npm start');
  console.log('  Then open: http://localhost:3026');
  console.log('============================================================');
}

function loadSettings() {
  const env = parseEnvFile(path.join(ROOT_DIR, '.env'));
  return {
    DB_NAME: readSetting(env, 'DB_NAME', 'home_accounting_dev'),
    DB_USER: readSetting(env, 'DB_USER', 'postgres'),
    DB_PASS: readSetting(env, 'DB_PASS', ''),
    DB_HOST: readSetting(env, 'DB_HOST', '127.0.0.1'),
    DB_PORT: readSetting(env, 'DB_PORT', '5432')
  };
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
    const value = stripMatchingQuotes(trimmed.slice(index + 1).trim());
    env[key] = value;
  }
  return env;
}

function readSetting(env, name, fallback) {
  return env[name] || process.env[name] || fallback;
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

function findPostgresTools() {
  const psql = findOnPath('psql.exe') || findPostgresTool('psql.exe');
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.quiet ? 'pipe' : 'inherit',
    windowsHide: true
  });

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }

  return result;
}

function printHeader(settings, psql) {
  console.log('');
  console.log('============================================================');
  console.log('  Home Accounting - New Server Setup');
  console.log('============================================================');
  console.log(`  Database : ${settings.DB_NAME}`);
  console.log(`  Host     : ${settings.DB_HOST}`);
  console.log(`  Port     : ${settings.DB_PORT}`);
  console.log(`  User     : ${settings.DB_USER}`);
  console.log(`  psql     : ${psql}`);
  console.log('============================================================');
  console.log('');
}

function printLoginFailure(settings, psql, result) {
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  console.log('');
  console.log('[ERROR] Cannot log in to PostgreSQL using the .env settings.');
  console.log('');
  console.log(`  Host: ${settings.DB_HOST}`);
  console.log(`  Port: ${settings.DB_PORT}`);
  console.log(`  User: ${settings.DB_USER}`);
  console.log('');
  console.log('  Notes:');
  console.log('  - 127.0.0.1 is correct when PostgreSQL is on this same server.');
  console.log('  - Check DB_PASS in .env and remove trailing spaces.');
  console.log('  - Passwords with ! are supported by this setup script.');
  console.log('  - Make sure the PostgreSQL Windows service is running.');
  if (output) {
    console.log('');
    console.log('  PostgreSQL said:');
    console.log(`  ${output.replace(/\r?\n/g, `${os.EOL}  `)}`);
  }
  console.log('');
  console.log('  Manual test:');
  console.log(`  "${psql}" -h ${settings.DB_HOST} -p ${settings.DB_PORT} -U ${settings.DB_USER} -d postgres -c "SELECT 1;"`);
  console.log('');
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

function promptHiddenEnough(question) {
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
  console.log(`Home Accounting setup

Usage:
  setup.bat
  setup.bat check
  setup.bat restore "path\\to\\backup.dump"
`);
}
