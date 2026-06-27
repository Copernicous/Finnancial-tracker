const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..', '..');
const qaDir = path.resolve(rootDir, 'qa');

function loadEnv() {
  const rootEnv = path.join(rootDir, '.env');
  const qaEnv = path.join(qaDir, '.env.qa');
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });
  if (fs.existsSync(qaEnv)) dotenv.config({ path: qaEnv, override: true });
}

function bool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).toLowerCase());
}

function number(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readConfig() {
  loadEnv();

  const baseURL = process.env.QA_BASE_URL || 'https://localhost:3443';
  const parsedURL = new URL(baseURL);
  const httpsPort = number(process.env.QA_HTTPS_PORT || parsedURL.port, 3443);
  const backendPort = number(process.env.QA_BACKEND_PORT, 3001);
  const dbName = process.env.QA_DB_NAME || 'patient_rx_qa';

  return {
    rootDir,
    qaDir,
    baseURL,
    backendURL: `http://127.0.0.1:${backendPort}`,
    httpsPort,
    backendPort,
    dbName,
    dbHost: process.env.DB_HOST || '127.0.0.1',
    dbUser: process.env.DB_USER || 'postgres',
    dbPass: process.env.DB_PASS || 'password',
    dbAdminDatabase: process.env.QA_DB_ADMIN_DATABASE || 'postgres',
    nodeEnv: process.env.QA_NODE_ENV || 'production',
    appOrigin: process.env.QA_APP_ORIGIN || `${baseURL},http://localhost:${backendPort}`,
    loginUsername: process.env.QA_LOGIN_USERNAME || 'admin',
    loginPassword: process.env.QA_LOGIN_PASSWORD || 'admin',
    headless: bool(process.env.QA_HEADLESS, true),
    slowMo: number(process.env.QA_SLOW_MO, 0),
    smokeNeedsAction: bool(process.env.QA_SMOKE_NEEDS_ACTION, false),
    chromePath: process.env.QA_CHROME_PATH || '',
    allowNonQaDb: bool(process.env.QA_ALLOW_NON_QA_DB, false),
    pfxPassphrase: process.env.QA_PFX_PASSPHRASE || 'patient-rx-local-qa',
    pidsDir: path.join(qaDir, 'pids'),
    logsDir: path.join(qaDir, 'logs'),
    resultsDir: path.join(qaDir, 'results'),
    screenshotsDir: path.join(qaDir, 'results', 'screenshots'),
    certDir: path.join(qaDir, 'certs')
  };
}

function ensureQaDirectories(config) {
  [
    config.pidsDir,
    config.logsDir,
    config.resultsDir,
    config.screenshotsDir,
    config.certDir
  ].forEach(dir => fs.mkdirSync(dir, { recursive: true }));
}

function assertQaDatabase(config) {
  if (config.allowNonQaDb) return;
  const safeName = /(qa|test|staging|sandbox|codex)/i.test(config.dbName);
  if (!safeName) {
    throw new Error(
      `Refusing to use database "${config.dbName}". Set QA_DB_NAME to a QA/staging DB name, or set QA_ALLOW_NON_QA_DB=true only if you fully understand the risk.`
    );
  }
}

function applyRuntimeEnv(config) {
  process.env.NODE_ENV = config.nodeEnv;
  process.env.PORT = String(config.backendPort);
  process.env.DB_NAME = config.dbName;
  process.env.DB_HOST = config.dbHost;
  process.env.DB_USER = config.dbUser;
  process.env.DB_PASS = config.dbPass;
  process.env.APP_ORIGIN = config.appOrigin;
  process.env.ALLOW_DEFAULT_SEED = process.env.QA_ALLOW_DEFAULT_SEED || 'true';
}

module.exports = {
  rootDir,
  qaDir,
  readConfig,
  ensureQaDirectories,
  assertQaDatabase,
  applyRuntimeEnv,
  bool
};
