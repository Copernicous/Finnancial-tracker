'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const useStaging = process.argv.includes('--staging');

dotenv.config({ path: path.join(root, '.env') });
if (useStaging) {
  const stagingPath = path.join(root, '.env.staging');
  if (!fs.existsSync(stagingPath)) {
    console.error('Missing .env.staging.');
    process.exit(1);
  }
  dotenv.config({ path: stagingPath, override: true });
}

const dbName = process.env.DB_NAME || 'home_accounting_dev';
const dbUser = process.env.DB_USER || 'postgres';
const dbPass = process.env.DB_PASS || '';
const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbPort = parseInt(process.env.DB_PORT || '5432', 10);

if (!/^home_accounting/i.test(dbName)) {
  console.error('Refusing to reset DB_NAME="' + dbName + '". Use a home_accounting database name.');
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: Object.assign({}, process.env, { ALLOW_DEFAULT_SEED: 'true' }),
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

async function main() {
  const client = new Client({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPass,
    database: 'postgres'
  });

  await client.connect();
  try {
    console.log('[reset] Recreating PostgreSQL database "' + dbName + '".');
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]);
    await client.query('DROP DATABASE IF EXISTS "' + dbName + '"');
    await client.query('CREATE DATABASE "' + dbName + '" TEMPLATE template0');
  } finally {
    await client.end().catch(() => {});
  }

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  run(npx, ['sequelize-cli', 'db:migrate']);
  run(npx, ['sequelize-cli', 'db:seed:all']);
  console.log('[reset] Complete. Raw Excel archive was not touched.');
}

main().catch((err) => {
  console.error('[reset] ' + err.message);
  process.exit(1);
});
