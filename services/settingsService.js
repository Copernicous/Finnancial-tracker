/**
 * settingsService.js
 *
 * Singleton service that manages system settings (key/value pairs stored in the DB).
 * On startup it loads settings into memory. Any write also updates the in-memory cache
 * and â€” for the TZ key â€” immediately applies the timezone to the current Node process.
 *
 * SMTP settings (smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name) are also
 * stored here so admins can configure email from the System Settings UI without editing .env.
 * emailService reads from settingsService first, falling back to process.env.
 */

// â”€â”€ Sensitive keys â€” never returned to the frontend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SENSITIVE_KEYS = new Set(['smtp_pass']);

const DEFAULTS = {
    app_timezone:  process.env.TZ          || 'America/New_York',
    app_name:      process.env.APP_NAME    || 'Home Accounting',
    // Global 2FA enforcement toggle (true = 2FA required for users who have it set up)
    require_2fa:   'true',
    // SMTP â€” seeded from .env if present, otherwise blank (user fills via UI)
    smtp_host:     process.env.SMTP_HOST   || 'smtp.gmail.com',
    smtp_port:     process.env.SMTP_PORT   || '587',
    smtp_user:     process.env.SMTP_USER   || '',
    smtp_pass:     process.env.SMTP_PASS   || '',   // stored encrypted in next iteration; stored plaintext for now
    smtp_from_name:process.env.SMTP_FROM_NAME || 'Home Accounting',
    // Security settings â€” editable from System Settings > Security card
    session_timeout_minutes: process.env.SESSION_TIMEOUT_MINUTES || '30',
    max_failed_logins:       process.env.MAX_FAILED_LOGINS        || '5'
};

let _cache = { ...DEFAULTS };
let _db = null;

// â”€â”€ List of valid IANA timezone identifiers (common zones) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const KNOWN_TIMEZONES = [
    // Eastern US
    'America/New_York', 'America/Detroit',
    // Central US
    'America/Chicago', 'America/Winnipeg',
    // Mountain US
    'America/Denver', 'America/Phoenix',
    // Pacific US
    'America/Los_Angeles', 'America/Vancouver',
    // Other US
    'America/Anchorage', 'Pacific/Honolulu',
    // Caribbean / Atlantic
    'America/Puerto_Rico', 'America/Santo_Domingo', 'America/Barbados',
    'America/Jamaica', 'Atlantic/Bermuda',
    // UTC
    'UTC',
    // Europe
    'Europe/London', 'Europe/Madrid', 'Europe/Paris',
    'Europe/Berlin', 'Europe/Lisbon', 'Europe/Rome',
    // Latin America
    'America/Bogota', 'America/Lima', 'America/Caracas',
    'America/La_Paz', 'America/Sao_Paulo',
    'America/Argentina/Buenos_Aires', 'America/Santiago'
];

exports.KNOWN_TIMEZONES = KNOWN_TIMEZONES;

/**
 * Load all settings from the DB into the in-memory cache.
 * Should be called once during server startup (after DB is ready).
 */
exports.load = async () => {
    try {
        if (!_db) _db = require('../models');
        const rows = await _db.SystemSetting.findAll();
        for (const row of rows) {
            _cache[row.key] = row.value;
        }
        // Seed default rows for any missing keys
        for (const [key, value] of Object.entries(DEFAULTS)) {
            if (!rows.find(r => r.key === key)) {
                await _db.SystemSetting.create({ key, value, description: `Default: ${key}` });
                _cache[key] = value;
            }
        }
        // Apply timezone immediately after loading
        _applyTimezone(_cache['app_timezone']);
        // Apply SMTP settings to process.env so emailService can also use them
        _applySmtp();
        console.log(`[Settings] Loaded. Timezone: ${_cache['app_timezone']} | SMTP: ${_cache['smtp_user'] || '(not set)'}`);
    } catch (e) {
        console.warn('[Settings] Could not load from DB, using defaults:', e.message);
    }
};

/**
 * Get a setting value by key. Returns the default if not found.
 */
exports.get = (key) => {
    return _cache[key] ?? DEFAULTS[key] ?? null;
};

/**
 * Set a setting value in the DB and update the in-memory cache.
 */
exports.set = async (key, value) => {
    if (!_db) _db = require('../models');
    const [row] = await _db.SystemSetting.findOrCreate({ where: { key }, defaults: { value } });
    row.value = value;
    await row.save();
    _cache[key] = value;

    if (key === 'app_timezone') _applyTimezone(value);

    // Re-apply SMTP settings to process.env whenever any smtp_ key changes
    if (key.startsWith('smtp_')) _applySmtp();
};

/**
 * Get all settings as a plain object, with sensitive keys masked.
 * @param {boolean} includeSensitive - set true for internal server-side use only
 */
exports.getAll = (includeSensitive = false) => {
    const copy = { ..._cache };
    if (!includeSensitive) {
        for (const k of SENSITIVE_KEYS) {
            if (copy[k]) copy[k] = 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢';   // mask; don't send password to browser
        }
    }
    return copy;
};

/**
 * Returns true if SMTP is fully configured (user + pass both set).
 */
exports.isSmtpConfigured = () => {
    return !!(_cache['smtp_user'] && _cache['smtp_pass']);
};

// â”€â”€ Internal helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _applyTimezone(tz) {
    if (!tz) return;
    process.env.TZ = tz;
}

/** Push SMTP settings from cache into process.env so nodemailer picks them up */
function _applySmtp() {
    if (_cache['smtp_host'])     process.env.SMTP_HOST      = _cache['smtp_host'];
    if (_cache['smtp_port'])     process.env.SMTP_PORT      = _cache['smtp_port'];
    if (_cache['smtp_user'])     process.env.SMTP_USER      = _cache['smtp_user'];
    if (_cache['smtp_pass'])     process.env.SMTP_PASS      = _cache['smtp_pass'];
    if (_cache['smtp_from_name'])process.env.SMTP_FROM_NAME = _cache['smtp_from_name'];
}

