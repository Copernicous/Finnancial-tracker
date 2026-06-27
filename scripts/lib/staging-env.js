'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..', '..');
const rootEnvPath = path.join(rootDir, '.env');
const stagingEnvPath = path.join(rootDir, '.env.staging');

function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    return dotenv.parse(fs.readFileSync(filePath, 'utf8'));
}

function boolEnv(value) {
    return ['1', 'true', 'yes', 'y', 'on'].includes(String(value || '').toLowerCase());
}

function resolveFromRoot(value) {
    return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function isPrivateIpv4(value) {
    const parts = String(value || '').split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
}

function stagingLanOrigins(port) {
    const origins = new Set([
        'http://localhost:' + port,
        'http://127.0.0.1:' + port
    ]);

    Object.values(os.networkInterfaces()).forEach((entries) => {
        (entries || []).forEach((entry) => {
            if (entry.family !== 'IPv4' || entry.internal || !isPrivateIpv4(entry.address)) return;
            origins.add('http://' + entry.address + ':' + port);
        });
    });

    return Array.from(origins);
}

function appendStagingLanOrigins() {
    const port = process.env.PORT || '3100';
    const current = String(process.env.APP_ORIGIN || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
    const origins = new Set(current);
    stagingLanOrigins(port).forEach(origin => origins.add(origin));
    process.env.APP_ORIGIN = Array.from(origins).join(',');
}

function loadStagingEnv() {
    const rootEnv = parseEnvFile(rootEnvPath);
    if (fs.existsSync(rootEnvPath)) dotenv.config({ path: rootEnvPath });

    if (!fs.existsSync(stagingEnvPath)) {
        throw new Error('Missing .env.staging. Copy .env.staging.example to .env.staging and fill the staging values.');
    }

    const stagingEnv = parseEnvFile(stagingEnvPath);
    dotenv.config({ path: stagingEnvPath, override: true });

    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
    process.env.PORT = process.env.PORT || '3100';
    process.env.APP_ORIGIN = process.env.APP_ORIGIN || ('http://localhost:' + process.env.PORT);
    process.env.APP_WRITABLE_ROOT = resolveFromRoot(process.env.APP_WRITABLE_ROOT || path.join('staging', 'runtime'));
    process.env.DOCUMENT_STORAGE_LOCAL_DIR = process.env.DOCUMENT_STORAGE_LOCAL_DIR || path.join('uploads', 'documents');
    process.env.SITE_BACKUP_DIR = process.env.SITE_BACKUP_DIR || path.join(process.env.APP_WRITABLE_ROOT, 'site-backups');

    if (!boolEnv(process.env.STAGING_ALLOW_SCHEDULED_BACKUPS)) {
        process.env.BACKUP_SCHEDULE = 'off';
        process.env.SITE_BACKUP_SCHEDULE = 'off';
    }

    appendStagingLanOrigins();

    return {
        rootDir,
        rootEnvPath,
        stagingEnvPath,
        rootEnv,
        stagingEnv,
        dbName: process.env.DB_NAME || '',
        dbHost: process.env.DB_HOST || '127.0.0.1',
        dbPort: process.env.DB_PORT || '5432',
        port: process.env.PORT,
        nodeEnv: process.env.NODE_ENV,
        appOrigin: process.env.APP_ORIGIN,
        writableRoot: process.env.APP_WRITABLE_ROOT
    };
}

function assertSafeStagingConfig(config) {
    if (!/(staging|stage|qa|test|sandbox|copy)/i.test(config.dbName)) {
        throw new Error('Refusing to start staging with DB_NAME="' + config.dbName + '". Use a DB name containing staging, stage, qa, test, sandbox, or copy.');
    }

    const rootDbName = config.rootEnv.DB_NAME || '';
    if (rootDbName && rootDbName.toLowerCase() === config.dbName.toLowerCase() && !boolEnv(process.env.STAGING_ALLOW_SHARED_DB)) {
        throw new Error('Refusing to start staging on the same DB_NAME as .env ("' + config.dbName + '").');
    }

    const rootPort = config.rootEnv.PORT || '';
    if (rootPort && String(rootPort) === String(config.port) && !boolEnv(process.env.STAGING_ALLOW_SHARED_PORT)) {
        throw new Error('Refusing to start staging on the same PORT as .env (' + config.port + ').');
    }

    if (config.nodeEnv === 'production' && !config.appOrigin) {
        throw new Error('APP_ORIGIN is required when NODE_ENV=production.');
    }
}

function ensureStagingRuntime(config) {
    [
        config.writableRoot,
        path.join(config.writableRoot, 'data'),
        path.join(config.writableRoot, 'logs'),
        path.join(config.writableRoot, 'backups'),
        path.join(config.writableRoot, 'backups', 'uploads'),
        path.join(config.writableRoot, 'uploads'),
        path.join(config.writableRoot, 'uploads', 'documents'),
        path.join(config.writableRoot, 'site-backups')
    ].forEach(dir => fs.mkdirSync(dir, { recursive: true }));

    const settingsPath = path.join(config.writableRoot, 'data', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
        fs.writeFileSync(settingsPath, JSON.stringify({
            backupRetentionDays: 30,
            appName: 'Home Accounting Staging',
            sessionTimeoutMinutes: 60,
            maxLoginAttempts: 5,
            maintenanceMode: false,
            serviceDateOverrideEnabled: false,
            backupSchedule: 'off',
            siteBackupSchedule: 'off'
        }, null, 2), 'utf8');
    }
}

function prepareStagingEnv() {
    const config = loadStagingEnv();
    assertSafeStagingConfig(config);
    ensureStagingRuntime(config);
    return config;
}

function printSummary(config) {
    console.log('');
    console.log('Home Accounting staging environment');
    console.log('  Branch-safe runtime root : ' + config.writableRoot);
    console.log('  URL                      : http://localhost:' + config.port);
    console.log('  NODE_ENV                 : ' + config.nodeEnv);
    console.log('  DB                       : ' + config.dbHost + ':' + config.dbPort + '/' + config.dbName);
    console.log('  APP_ORIGIN               : ' + config.appOrigin);
    console.log('  Scheduled backups        : ' + process.env.BACKUP_SCHEDULE + ' / ' + process.env.SITE_BACKUP_SCHEDULE);
    console.log('');
}

module.exports = {
    prepareStagingEnv,
    printSummary
};
