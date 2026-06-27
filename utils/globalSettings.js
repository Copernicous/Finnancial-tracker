'use strict';

const fs = require('fs');
const path = require('path');
const { getWritableRoot } = require('./runtimePaths');

const WRITABLE_ROOT = getWritableRoot();
const SETTINGS_PATH = path.join(WRITABLE_ROOT, 'data', 'settings.json');

const DEFAULT_SETTINGS = {
    backupPath: path.join(WRITABLE_ROOT, 'backups'),
    backupRetentionDays: 30,
    appName: 'Home Accounting',
    sessionTimeoutMinutes: 60,
    maxLoginAttempts: 5,
    maintenanceMode: false,
    serviceDateOverrideEnabled: false
};

function ensureSettingsDir() {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readSettings() {
    try {
        ensureSettingsDir();
        const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
        return { ...DEFAULT_SETTINGS };
    }
}

function writeSettings(next) {
    ensureSettingsDir();
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

function isTruthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isServiceDateOverrideEnabled() {
    if (process.env.SERVICE_DATE_OVERRIDE_ENABLED !== undefined) {
        return isTruthy(process.env.SERVICE_DATE_OVERRIDE_ENABLED);
    }
    return readSettings().serviceDateOverrideEnabled === true;
}

module.exports = {
    DEFAULT_SETTINGS,
    SETTINGS_PATH,
    readSettings,
    writeSettings,
    isServiceDateOverrideEnabled
};

