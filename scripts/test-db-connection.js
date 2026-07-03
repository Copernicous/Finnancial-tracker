#!/usr/bin/env node

require('dotenv').config();

const path = require('path');
const { Client } = require('pg');

const envPath = path.join(process.cwd(), '.env');
const settings = {
  host: readEnv('DB_HOST', '127.0.0.1'),
  port: Number(readEnv('DB_PORT', '5432')),
  user: readEnv('DB_USER', 'postgres'),
  password: readEnv('DB_PASS', ''),
  database: readEnv('DB_NAME', 'home_accounting_dev')
};

main().catch((error) => {
  console.error('');
  console.error('[FAIL] Database connection test failed.');
  printConnectionError(error);
  process.exitCode = 1;
});

async function main() {
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
  console.log('============================================================');
  console.log('');

  if (!settings.password) {
    throw new Error('DB_PASS is empty. Put the PostgreSQL password in .env.');
  }

  console.log('[1/3] Testing login to default database "postgres"...');
  const root = await connectTo('postgres');
  const serverInfo = await root.query('select current_user as user_name, inet_server_port() as port');
  await root.end();
  console.log(`  OK: logged in as ${serverInfo.rows[0].user_name} on port ${serverInfo.rows[0].port || settings.port}.`);
  console.log('');

  console.log(`[2/3] Checking database "${settings.database}"...`);
  const check = await connectTo('postgres');
  const exists = await check.query('select 1 from pg_database where datname = $1', [settings.database]);
  await check.end();
  if (!exists.rowCount) {
    console.log(`  MISSING: database "${settings.database}" does not exist yet.`);
    console.log('  Run setup.bat to create it, or create it manually with createdb.');
    process.exitCode = 2;
    return;
  }
  console.log('  OK: database exists.');
  console.log('');

  console.log(`[3/3] Testing login to target database "${settings.database}"...`);
  const target = await connectTo(settings.database);
  await target.query('select 1');
  await target.end();
  console.log('  OK: target database login works.');
  console.log('');
  console.log('[PASS] PostgreSQL settings in .env are valid.');
}

function readEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return stripMatchingQuotes(String(raw).trim());
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

async function connectTo(database) {
  const client = new Client({
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database,
    connectionTimeoutMillis: 5000
  });
  await client.connect();
  return client;
}

function printConnectionError(error) {
  if (error.code === '28P01') {
    console.error('Reason: PostgreSQL rejected the password.');
    console.error('Fix: check DB_PASS in .env exactly. Passwords with ! are okay in .env.');
  } else if (error.code === '3D000') {
    console.error(`Reason: database does not exist: ${settings.database}`);
    console.error('Fix: run setup.bat so it can create the database.');
  } else if (error.code === 'ECONNREFUSED') {
    console.error(`Reason: no PostgreSQL listener answered at ${settings.host}:${settings.port}.`);
    console.error('Fix: check the PostgreSQL Windows service and port.');
  } else {
    console.error(`Reason: ${error.message || error}`);
    if (error.code) console.error(`Code: ${error.code}`);
  }

  console.error('');
  console.error('Manual PowerShell test:');
  console.error(`  & "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe" -h ${settings.host} -p ${settings.port} -U ${settings.user} -d postgres -c "SELECT 1;"`);
}
