const { Client } = require('pg');

function quoteIdentifier(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Unsafe database name "${name}". Use letters, numbers, and underscores only.`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

async function ensureDatabase(config) {
  const client = new Client({
    host: config.dbHost,
    user: config.dbUser,
    password: config.dbPass,
    database: config.dbAdminDatabase
  });

  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.dbName]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(config.dbName)}`);
      return { created: true, database: config.dbName };
    }
    return { created: false, database: config.dbName };
  } finally {
    await client.end();
  }
}

module.exports = { ensureDatabase };
