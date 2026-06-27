// CLI flags -- must be first, before any other require
// Usage:  server.exe --v   OR   server.exe --version
// Prints version info and exits without starting the server.
// Usage:  server.exe --reset-password <username> <newpassword>
// Resets the password for the given user and exits. Works without starting the server.
(function checkCliFlags() {
    var args = process.argv.slice(2);

    // ── --version / --v / -v ──────────────────────────────────────────────────
    if (args.indexOf('--v') !== -1 || args.indexOf('--version') !== -1 || args.indexOf('-v') !== -1) {
        var pkg2   = require('./package.json');
        var IS_PKG = typeof process.pkg !== 'undefined';
        var b      = new Date();
        var p      = function(n) { return String(n).padStart(2,'0'); };
        var bstr   = (b.getMonth()+1)+'/'+p(b.getDate())+'/'+b.getFullYear()+
                     '  '+p(b.getHours())+':'+p(b.getMinutes())+':'+p(b.getSeconds());
        console.log('');
        console.log('  Home Accounting');
        console.log('  Version  : ' + pkg2.version);
        console.log('  Node.js  : ' + process.version);
        console.log('  Platform : ' + process.platform + ' ' + process.arch);
        console.log('  Mode     : ' + (IS_PKG ? 'compiled (server.exe)' : 'node app.js'));
        console.log('  Built At : ' + bstr);
        console.log('');
        process.exit(0);
    }

    // ── --reset-password <username> <newpassword> ─────────────────────────────
    var rpIdx = args.indexOf('--reset-password');
    if (rpIdx !== -1) {
        var rpUser = args[rpIdx + 1];
        var rpPass = args[rpIdx + 2];
        if (!rpUser || !rpPass) {
            console.error('\n  Usage: server.exe --reset-password <username> <newpassword>\n');
            process.exit(1);
        }
        // Load .env then reset the password
        require('dotenv').config();
        var bcryptRp = require('bcryptjs');
        var dbRp     = require('./models');
        dbRp.sequelize.authenticate().then(async function() {
            var user = await dbRp.User.findOne({ where: { username: rpUser } });
            if (!user) {
                console.error('\n  ERROR: User "' + rpUser + '" not found.\n');
                process.exit(1);
            }
            var hash = await bcryptRp.hash(rpPass, 12);
            await user.update({ passwordHash: hash, failedLoginCount: 0, lockedUntil: null });
            console.log('\n  ✓ Password for "' + rpUser + '" has been reset successfully.\n');
            process.exit(0);
        }).catch(function(err) {
            console.error('\n  ERROR: ' + err.message + '\n');
            process.exit(1);
        });
        return; // don't continue starting the server
    }
})();


require('dotenv').config();

// -- Log file setup (LOG_FILE=true in .env enables file logging) ----------------
var _logStream = null;    // Morgan HTTP access log stream
var _errStream = null;    // Error log stream
(function setupLogFiles() {
    if (process.env.LOG_FILE !== 'true') return;
    var fs   = require('fs');
    var path2 = require('path');
    var runtimePaths = require('./utils/runtimePaths');
    // Resolve log directory: next to server.exe by default, or APP_WRITABLE_ROOT for staging/test copies.
    var baseDir = runtimePaths.getWritableRoot();
    var logDir  = path2.join(baseDir, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    // Delete log files older than LOG_RETENTION_DAYS (default 7)
    var retainDays = parseInt(process.env.LOG_RETENTION_DAYS || '7', 10);
    var cutoff = Date.now() - retainDays * 86400000;
    fs.readdirSync(logDir).forEach(function(f) {
        if (!/\.(log)$/.test(f)) return;
        var fp = path2.join(logDir, f);
        try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch(e) {}
    });
    // Today's date stamp for file names
    var d   = new Date();
    var pad = function(n) { return String(n).padStart(2,'0'); };
    var stamp = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
    // Open append streams for today
    _logStream = fs.createWriteStream(path2.join(logDir, 'access-' + stamp + '.log'), { flags: 'a' });
    _errStream = fs.createWriteStream(path2.join(logDir, 'error-'  + stamp + '.log'), { flags: 'a' });
    // Patch console.error so errors also go to file
    var _origErr = console.error.bind(console);
    console.error = function() {
        var line = '[' + new Date().toISOString() + '] ' + Array.from(arguments).join(' ') + '\n';
        if (_errStream) _errStream.write(line);
        _origErr.apply(console, arguments);
    };
    console.log('[Log] File logging ON -- ' + logDir + '  (retain ' + retainDays + ' days)');
})();
// -------------------------------------------------------------------------------


// -- Crash prevention -- keep server alive on unhandled async errors ------------
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRASH PREVENTED] Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[CRASH PREVENTED] Uncaught Exception:', err.message, err.stack);
});
const express     = require('express');
const cors        = require('cors');
const morgan      = require('morgan');
const bodyParser  = require('body-parser');
const path        = require('path');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const db          = require('./models');
const packageInfo = require('./package.json');

// Start backup scheduler on boot
require('./services/backupService');

// Daily metrics snapshot scheduler -- captures at 00:05 every night
const cron = require('node-cron');
const { captureSnapshot } = require('./services/snapshotService');
cron.schedule('5 0 * * *', async () => {
    console.log('[Cron] Running daily metrics snapshot...');
    try { await captureSnapshot(); }
    catch (e) { console.error('[Cron] Snapshot failed:', e.message); }
}, { timezone: process.env.TZ || 'America/New_York' });

// Settings service -- load system config (timezone, etc.) from DB
const settingsService = require('./services/settingsService');

const app = express();

// [LOCK] Trust proxy -- 1st hop only (FortiGate). Prevents IP spoofing via forged X-Forwarded-For [LOCK]
app.set('trust proxy', 1);

function isSecureRequest(req) {
    if (req.secure) return true;
    const forwardedProto = (req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'] || '').toLowerCase();
    if (forwardedProto.includes('https')) return true;
    if ((req.headers['front-end-https'] || '').toLowerCase() === 'on') return true;
    if (req.headers['x-arr-ssl']) return true;
    return false;
}

// -- HTTPS redirect (enable with FORCE_HTTPS=true in .env) --------------------
if (process.env.FORCE_HTTPS === 'true') {
    app.use((req, res, next) => {
        if (isSecureRequest(req)) return next();
        return res.redirect(301, 'https://' + req.headers.host + req.url);
    });
}

// -- Security headers (Helmet) -------------------------------------------------
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,  // Prevent Helmet adding upgrade-insecure-requests by default
        directives: {
            defaultSrc:     ["'self'"],
            scriptSrc:      ["'self'", "'unsafe-inline'"],   // CDN removed -- all JS served locally
            scriptSrcAttr:  ["'unsafe-inline'"],             // Required: app uses inline onclick handlers
            styleSrc:       ["'self'", "'unsafe-inline'"],   // CDN removed -- all CSS served locally
            fontSrc:        ["'self'", 'data:'],              // allow inline/base64-encoded fonts
            workerSrc:      ["'self'", 'blob:'],              // allow blob workers
            imgSrc:         ["'self'", 'data:', 'blob:'],
            connectSrc:     ["'self'", 'https://api.ipify.org', 'https://dns.google'],
            frameSrc:       ["'none'"],
            objectSrc:      ["'none'"],
            baseUri:        ["'self'"],
            formAction:     ["'self'"],
            frameAncestors: ["'self'"],
            // upgradeInsecureRequests intentionally omitted -- only add when HTTPS is configured
            ...(process.env.FORCE_HTTPS === 'true' ? { upgradeInsecureRequests: [] } : {})
        }
    },
    crossOriginOpenerPolicy: false,
    hsts: process.env.FORCE_HTTPS === 'true'
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    crossOriginEmbedderPolicy: false // Allow CDN assets
}));

// -- Rate limiting -- brute-force protection on auth endpoints ------------------
const loginLimiter = rateLimit({
    windowMs:         15 * 60 * 1000,  // 15 minutes
    max:              15,               // max 15 login attempts per IP per window
    standardHeaders:  true,
    legacyHeaders:    false,
    message:          { message: 'Too many login attempts. Please try again in 15 minutes.' },
    skipSuccessfulRequests: true        // only count failures toward the limit
});

// Trust FortiGate SSL VPN and reverse proxy chain -- allows Express to correctly read
// X-Forwarded-For (real client IP) and X-Forwarded-Proto (https) headers.

// SEC-01: CORS — locked to explicit origin allowlist.
// APP_ORIGIN supports comma-separated values for multi-origin setups.
// FortiGate origin: https://rx.camperos.net:10443
// Dev origin:       http://localhost:3000
// Example .env:     APP_ORIGIN=https://rx.camperos.net:10443,http://192.168.60.21:3000,http://localhost:3000
(function() {
    const rawOrigin = process.env.APP_ORIGIN || '';
    let corsOrigin;
    if (rawOrigin.trim()) {
        // Parse comma-separated allowlist
        const allowed = rawOrigin.split(',').map(function(o) { return o.trim(); }).filter(Boolean);
        corsOrigin = function(origin, callback) {
            // Allow same-origin / server-to-server requests (no Origin header)
            if (!origin) return callback(null, true);
            if (allowed.indexOf(origin) !== -1) return callback(null, true);
            callback(new Error('CORS: origin not allowed — ' + origin));
        };
    } else if (process.env.NODE_ENV === 'production') {
        // SEC-04: Fail CLOSED in production — never open credentialed CORS without explicit origin.
        console.error('');
        console.error('═══════════════════════════════════════════════════════════');
        console.error('  FATAL: APP_ORIGIN is not set in production mode.');
        console.error('  Refusing to start with open CORS (origin: true).');
        console.error('  Set APP_ORIGIN in .env, e.g.:');
        console.error('    APP_ORIGIN=https://rx.camperos.net:10443,http://192.168.60.21:3000');
        console.error('═══════════════════════════════════════════════════════════');
        console.error('');
        process.exit(1);
    } else {
        // Development / test — warn but allow open (local dev convenience)
        console.warn('[WARN] APP_ORIGIN not set — CORS is open (development mode only).');
        corsOrigin = true;
    }
    app.use(cors({ origin: corsOrigin, credentials: true }));
})();
// HTTP access logging: debug mode uses verbose 'dev' format; file stream used when LOG_FILE=true
var _morganFmt = process.env.DEBUG === 'true' ? 'dev' : (process.env.NODE_ENV === 'production' ? 'combined' : 'dev');
if (_logStream) {
    // Write to BOTH console AND file
    app.use(morgan(_morganFmt, { stream: _logStream }));
    app.use(morgan(_morganFmt));
} else {
    app.use(morgan(_morganFmt));
}
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Cache-bust token: changes on every server restart
// EJS templates use this so FortiGate's cached pages redirect to uncached versioned URLs
const APP_BUILD = Date.now();

// Set EJS as templating engine
// IMPORTANT: use app.engine() with an explicit static require() so @yao-pkg/pkg
// can see 'ejs' as a string literal at compile time and bundle it into server.exe.
// app.set('view engine','ejs') alone causes a dynamic require(ext) which pkg
// cannot analyze — resulting in "Cannot find module 'ejs'" at runtime.
const ejs = require('ejs');
app.engine('ejs', ejs.renderFile);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Disable EJS view cache even in production
app.set('view cache', false);

function getAppEnvironment() {
    return String(process.env.APP_ENV || process.env.APP_INSTANCE || process.env.NODE_ENV || '').trim();
}

function isStagingEnvironment() {
    const markers = [
        process.env.APP_ENV,
        process.env.APP_INSTANCE,
        process.env.DB_NAME,
        process.env.APP_WRITABLE_ROOT
    ].filter(Boolean).join(' ');
    return /\bstaging\b|\bstage\b/i.test(markers);
}

// Expose build/version/environment info to all EJS templates
app.use(function(req, res, next) {
    res.locals.appBuild = APP_BUILD;
    res.locals.appVersion = packageInfo.version;
    res.locals.appEnvironment = getAppEnvironment();
    res.locals.isStaging = isStagingEnvironment();
    next();
});

// Serve a small favicon explicitly to prevent proxy/browser favicon errors.
app.get('/favicon.ico', (req, res) => {
    const favicon = Buffer.from(
        'AAABAAEAEBAAAAAAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'base64'
    );
    res.set('Content-Type', 'image/x-icon');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(favicon);
});


// Force UTF-8 charset on all HTML responses -- required for FortiGate SSL web access
// and any reverse proxy that rewrites HTML (prevents a" garbled characters)
app.use((req, res, next) => {
    const orig = res.setHeader.bind(res);
    res.render = ((origRender) => function(view, options, callback) {
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        return origRender.call(this, view, options, callback);
    })(res.render);
    next();
});

// Prevent FortiGate SSL VPN from caching or TRANSFORMING responses.
// RFC 7234: 'no-transform' tells proxies not to modify the response body --
// specifically targets FortiGate's behavior of injecting REWRITE() wrappers
// around URL strings in JavaScript, which breaks JS syntax.
// 'no-store' prevents FortiGate from caching and serving stale HTML pages.
app.use(function(req, res, next) {
    res.setHeader('Cache-Control', 'no-store, no-cache, no-transform, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});


// Static folder
app.use(express.static(path.join(__dirname, 'public')));


// Routes (to be added)
const authRoutes         = require('./routes/authRoutes');
const apiRoutes          = require('./routes/apiRoutes');
const importRoutes       = require('./routes/importRoutes');
const webRoutes          = require('./routes/webRoutes');
const webAuth            = require('./middleware/webAuth');
const userActivityLogger = require('./middleware/userActivityLogger');
const twoFactorRoutes    = require('./routes/twoFactorRoutes');

// Tag each sub-router with its mount prefix so routeInspector can read it
authRoutes._mountPrefix        = '/api/auth';
importRoutes._mountPrefix      = '/api/import';
apiRoutes._mountPrefix         = '/api';
webRoutes._mountPrefix         = '/';
twoFactorRoutes._mountPrefix   = '/api/auth';

// -- Extended rate limiting for sensitive endpoints ---------------------------
// API key management: 30 requests / 15 min (prevents key enumeration)
const apiKeyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
    message: { message: 'Too many API key requests. Please try again later.' }
});
// 2FA setup: 10 requests / 15 min per IP
const twoFaSetupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { message: 'Too many 2FA setup attempts. Please try again later.' }
});
// Settings write: 20 changes / 15 min
const settingsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
    message: { message: 'Too many settings changes. Please try again later.' },
    skipSuccessfulRequests: false
});

// Apply rate limiters to login and sensitive endpoints
app.use('/api/auth/login',          loginLimiter);
app.use('/api/auth/2fa/setup',      twoFaSetupLimiter);
app.use('/api/auth/2fa/enable',     twoFaSetupLimiter);
app.use('/api/api-keys',            apiKeyLimiter);  // SEC-05: was '/api/keys' (wrong path — routes are at /api/api-keys)
app.use('/api/settings',            settingsLimiter);

app.use('/api/auth',    authRoutes);
app.use('/api/auth',    twoFactorRoutes);
app.use('/api/import',  importRoutes);
app.use('/api',         apiRoutes);
app.use('/',            webAuth, userActivityLogger, webRoutes);   // webAuth decodes rxToken cookie -> res.locals.userPerms




// Error handling middleware -- logs to ErrorLog table
app.use(async (err, req, res, next) => {
    console.error(err.stack);
    try {
        const errorLogController = require('./controllers/errorLogController');
        await errorLogController.logBackend({
            message:   err.message || 'Internal Server Error',
            stack:     err.stack   || null,
            url:       req.originalUrl,
            userId:    req.user ? req.user.id : null,
            ipAddress: req.ip,
            severity:  'error'
        });
    } catch {}
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

// -- Auto-create database if it doesn't exist ----------------------------------
// Connects to the always-present 'postgres' default database first, then issues
// CREATE DATABASE. Safe to run on every boot -- postgres ignores it if db exists.
async function ensureDatabase() {
    const { Client } = require('pg');
    const dbName = process.env.DB_NAME || 'home_accounting_dev';
    const client = new Client({
        host:     process.env.DB_HOST     || '127.0.0.1',
        port:     parseInt(process.env.DB_PORT || '5432'),
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASS     || '',
        database: 'postgres'   // always exists on any PostgreSQL install
    });
    try {
        await client.connect();
        const res = await client.query(
            `SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]
        );
        if (res.rowCount === 0) {
            // Must use template0 so encoding/locale are always compatible
            await client.query(`CREATE DATABASE "${dbName}" TEMPLATE template0`);
            console.log(`[DB] Database "${dbName}" created automatically.`);
        } else {
            console.log(`[DB] Database "${dbName}" already exists.`);
        }
    } catch (e) {
        console.error(`[DB] Could not auto-create database "${dbName}":`, e.message);
        console.error('[DB] Make sure PostgreSQL is running and DB_USER has CREATEDB privilege.');
        process.exit(1);   // fatal -- nothing works without a database
    } finally {
        await client.end().catch(() => {});
    }
}

const startServer = async () => {
    await ensureDatabase();   // <- must succeed before any other DB work

    try {
        // Automatically ensure permissions column exists in PostgreSQL
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "permissions" TEXT;');
        console.log('Database verified: Users.permissions column ready.');
    } catch (e) {
        console.warn('Startup migration warning (non-fatal):', e.message);
    }

    // Add Return-to-Warehouse columns to RXRecords (safe to run repeatedly)
    try {
        await db.sequelize.query('ALTER TABLE "RXRecords" ADD COLUMN IF NOT EXISTS "returnedToWarehouse" BOOLEAN DEFAULT FALSE;');
        await db.sequelize.query('ALTER TABLE "RXRecords" ADD COLUMN IF NOT EXISTS "warehouseReturnDate" TIMESTAMP WITH TIME ZONE;');
        await db.sequelize.query('ALTER TABLE "RXRecords" ADD COLUMN IF NOT EXISTS "warehouseReturnNote" VARCHAR(255);');
        console.log('Database verified: RXRecords warehouse columns ready.');
    } catch (e) {
        console.warn('Startup migration warning (RXRecords warehouse, non-fatal):', e.message);
    }

    // Ensure previousValue column exists in AuditLogs (for undo/return-to-warehouse tracking)
    try {
        await db.sequelize.query('ALTER TABLE "AuditLogs" ADD COLUMN IF NOT EXISTS "previousValue" JSON;');
        console.log('Database verified: AuditLogs.previousValue column ready.');
    } catch (e) {
        console.warn('Startup migration warning (AuditLogs.previousValue, non-fatal):', e.message);
    }

    // Ensure notes column exists in Users table
    try {
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "notes" TEXT;');
        console.log('Database verified: Users.notes column ready.');
    } catch (e) {
        console.warn('Startup migration warning (Users.notes, non-fatal):', e.message);
    }

    // Ensure sortOrder column exists in MedicationCatalogs table
    try {
        await db.sequelize.query('ALTER TABLE "MedicationCatalogs" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER DEFAULT 999;');
        console.log('Database verified: MedicationCatalogs.sortOrder column ready.');
    } catch (e) {
        console.warn('Startup migration warning (MedicationCatalogs.sortOrder, non-fatal):', e.message);
    }

    // H1 FIX: Ensure patientCode has a DB-level UNIQUE constraint (race-safe duplicate prevention)
    try {
        await db.sequelize.query('ALTER TABLE "Patients" ADD CONSTRAINT "Patients_patientCode_unique" UNIQUE ("patientCode");');
        console.log('Database verified: Patients.patientCode UNIQUE constraint ready.');
    } catch (e) {
        // '42P07' = duplicate_table / constraint already exists -- safe to ignore
        if (!e.message.includes('already exists')) {
            console.warn('Startup migration warning (Patients.patientCode unique, non-fatal):', e.message);
        }
    }

    // --- 2FA & Account Security Migration ------------------------------------
    try {
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT;');
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN DEFAULT FALSE;');
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER DEFAULT 0;');
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP WITH TIME ZONE;');
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "backupCodes" TEXT;');
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER DEFAULT 0;');
        // MASTER admin flag — backoffice access. Only settable via direct SQL, never via UI/API.
        await db.sequelize.query('ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "isMaster" BOOLEAN DEFAULT false;');
        console.log('Database verified: Users 2FA, lockout, backup codes, tokenVersion, and isMaster columns ready.');
    } catch (e) {
        console.warn('Startup migration warning (Users 2FA columns, non-fatal):', e.message);
    }

    // Add new columns to Roles table and seed built-in role permissions
    try {
        await db.sequelize.query('ALTER TABLE "Roles" ADD COLUMN IF NOT EXISTS "permissions" TEXT;');
        await db.sequelize.query('ALTER TABLE "Roles" ADD COLUMN IF NOT EXISTS "isSystem"    BOOLEAN DEFAULT false;');
        await db.sequelize.query('ALTER TABLE "Roles" ADD COLUMN IF NOT EXISTS "description" VARCHAR(255);');
        console.log('Database verified: Roles custom columns ready.');

        // Mark the 4 built-in roles as system (non-deletable)
        await db.sequelize.query('UPDATE "Roles" SET "isSystem" = true WHERE name IN (\'Administrator\',\'Supervisor\',\'Operator\',\'Read Only\');');

        // Seed / re-seed permissions for each built-in role.
        // Re-seeds if: (a) no permissions yet, OR (b) canAdd is missing (new field added today)
        const { BUILT_IN_DEFAULTS } = require('./middleware/rbac');
        const builtInRoles = await db.Role.findAll({ where: { isSystem: true } });
        for (const role of builtInRoles) {
            const needsSeed = !role.permissions;
            const needsUpdate = role.permissions && role.permissions.patients !== undefined
                && !Object.prototype.hasOwnProperty.call(role.permissions.patients || {}, 'canAdd');

            const defaultsForRole = BUILT_IN_DEFAULTS[role.name] ? BUILT_IN_DEFAULTS[role.name]() : null;

            // Backfill any newly added permission keys that don't exist yet in DB
            const missingKeys = defaultsForRole
                ? Object.keys(defaultsForRole).filter(
                    k => role.permissions && !Object.prototype.hasOwnProperty.call(role.permissions, k)
                  )
                : [];
            const missingActionKeys = [];
            if (defaultsForRole && role.permissions) {
                Object.keys(defaultsForRole).forEach(moduleKey => {
                    const existingModule = role.permissions[moduleKey];
                    const defaultModule = defaultsForRole[moduleKey];
                    if (!existingModule || !defaultModule || typeof existingModule !== 'object' || typeof defaultModule !== 'object') return;
                    Object.keys(defaultModule).forEach(actionKey => {
                        if (!Object.prototype.hasOwnProperty.call(existingModule, actionKey)) {
                            missingActionKeys.push(moduleKey + '.' + actionKey);
                        }
                    });
                });
            }

            if ((needsSeed || needsUpdate || missingKeys.length > 0 || missingActionKeys.length > 0) && defaultsForRole) {
                let perms;
                if (needsSeed || needsUpdate) {
                    // Full re-seed
                    perms = defaultsForRole;
                } else {
                    // Surgical patch — only add the missing keys, keep existing ones intact
                    perms = Object.assign({}, role.permissions);
                    missingKeys.forEach(k => { perms[k] = defaultsForRole[k]; });
                    missingActionKeys.forEach(k => {
                        const parts = k.split('.');
                        const moduleKey = parts[0];
                        const actionKey = parts[1];
                        perms[moduleKey] = Object.assign({}, perms[moduleKey]);
                        perms[moduleKey][actionKey] = defaultsForRole[moduleKey][actionKey];
                    });
                }
                await role.update({ permissions: perms });
                if (missingKeys.length > 0 || missingActionKeys.length > 0) {
                    console.log(`[Roles] Patched new permission keys [${missingKeys.concat(missingActionKeys).join(', ')}] for role: ${role.name}`);
                } else {
                    console.log(`[Roles] ${needsSeed ? 'Seeded' : 'Updated'} permissions for built-in role: ${role.name}`);
                }
            }
        }
        console.log('Database verified: Built-in role permissions seeded.');

    } catch (e) {
        console.warn('Startup migration warning (Roles custom columns, non-fatal):', e.message);
    }

    await db.sequelize.sync();

    // Ensure patient service-date cycles exist and RX records are linked to them.
    // This is the real Patient -> Service Date Cycle -> RX Records relationship.
    try {
        await db.sequelize.query(`
            CREATE TABLE IF NOT EXISTS "PatientServiceDateCycles" (
                "id" SERIAL PRIMARY KEY,
                "patientId" INTEGER NOT NULL,
                "serviceDate" DATE NOT NULL,
                "status" VARCHAR(20) NOT NULL DEFAULT 'historical',
                "source" VARCHAR(60) NOT NULL DEFAULT 'Patient Service Date',
                "startedAt" TIMESTAMP WITH TIME ZONE,
                "endedAt" TIMESTAMP WITH TIME ZONE,
                "createdByUserId" INTEGER,
                "metadata" JSON,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            );
        `);
        await db.sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS "uq_patient_service_date_cycles_patient_date" ON "PatientServiceDateCycles" ("patientId", "serviceDate");');
        await db.sequelize.query('CREATE INDEX IF NOT EXISTS "idx_patient_service_date_cycles_patient" ON "PatientServiceDateCycles" ("patientId");');
        await db.sequelize.query('CREATE INDEX IF NOT EXISTS "idx_patient_service_date_cycles_status" ON "PatientServiceDateCycles" ("patientId", "status");');
        await db.sequelize.query('ALTER TABLE "RXRecords" ADD COLUMN IF NOT EXISTS "patientServiceDateCycleId" INTEGER;');
        await db.sequelize.query('CREATE INDEX IF NOT EXISTS "idx_rxrecords_patient_service_date_cycle" ON "RXRecords" ("patientServiceDateCycleId");');
        await db.sequelize.query(`
            INSERT INTO "PatientServiceDateCycles"
                ("patientId", "serviceDate", "status", "source", "startedAt", "endedAt", "metadata", "createdAt", "updatedAt")
            SELECT
                x."patientId",
                x."serviceDate",
                CASE WHEN p."serviceDate" = x."serviceDate" THEN 'active' ELSE 'historical' END,
                'Startup Backfill',
                x."serviceDate"::timestamp with time zone,
                CASE WHEN p."serviceDate" = x."serviceDate" THEN NULL ELSE (x."serviceDate"::timestamp with time zone + INTERVAL '90 days') END,
                '{"backfilled":true}'::json,
                NOW(),
                NOW()
            FROM (
                SELECT "id" AS "patientId", "serviceDate" FROM "Patients" WHERE "serviceDate" IS NOT NULL
                UNION
                SELECT "patientId", "serviceDate" FROM "RXRecords" WHERE "patientId" IS NOT NULL AND "serviceDate" IS NOT NULL
            ) x
            JOIN "Patients" p ON p."id" = x."patientId"
            ON CONFLICT ("patientId", "serviceDate") DO NOTHING;
        `);
        await db.sequelize.query(`
            UPDATE "PatientServiceDateCycles" c
            SET "status" = CASE WHEN p."serviceDate" = c."serviceDate" THEN 'active' ELSE 'historical' END,
                "endedAt" = CASE WHEN p."serviceDate" = c."serviceDate" THEN NULL ELSE (c."serviceDate"::timestamp with time zone + INTERVAL '90 days') END,
                "updatedAt" = NOW()
            FROM "Patients" p
            WHERE p."id" = c."patientId";
        `);
        await db.sequelize.query(`
            UPDATE "RXRecords" r
            SET "patientServiceDateCycleId" = c."id"
            FROM "PatientServiceDateCycles" c
            WHERE r."patientId" = c."patientId"
              AND r."serviceDate" = c."serviceDate"
              AND (r."patientServiceDateCycleId" IS NULL OR r."patientServiceDateCycleId" <> c."id");
        `);
        console.log('Database verified: PatientServiceDateCycles ready and RXRecords linked.');
    } catch (e) {
        console.warn('Startup migration warning (PatientServiceDateCycles, non-fatal):', e.message);
    }

    // Ensure patient service-date history exists on environments that do not run
    // sequelize-cli migrations manually.
    try {
        await db.sequelize.query(`
            CREATE TABLE IF NOT EXISTS "PatientServiceDateHistories" (
                "id" SERIAL PRIMARY KEY,
                "patientId" INTEGER NOT NULL,
                "previousServiceDate" DATE,
                "newServiceDate" DATE,
                "changedByUserId" INTEGER,
                "changeSource" VARCHAR(60) NOT NULL DEFAULT 'Patient Update',
                "reason" TEXT,
                "metadata" JSON,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            );
        `);
        await db.sequelize.query('CREATE INDEX IF NOT EXISTS "idx_patient_service_date_histories_patient" ON "PatientServiceDateHistories" ("patientId");');
        await db.sequelize.query('CREATE INDEX IF NOT EXISTS "idx_patient_service_date_histories_patient_created" ON "PatientServiceDateHistories" ("patientId", "createdAt");');
        await db.sequelize.query('CREATE INDEX IF NOT EXISTS "idx_patient_service_date_histories_new_date" ON "PatientServiceDateHistories" ("newServiceDate");');
        await db.sequelize.query(`
            INSERT INTO "PatientServiceDateHistories"
                ("patientId", "previousServiceDate", "newServiceDate", "changedByUserId", "changeSource", "reason", "createdAt", "updatedAt")
            SELECT
                p."id", NULL, p."serviceDate", NULL, 'System Backfill',
                'Existing patient service date captured when history tracking was enabled.',
                NOW(), NOW()
            FROM "Patients" p
            WHERE p."serviceDate" IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM "PatientServiceDateHistories" h
                  WHERE h."patientId" = p."id"
              );
        `);
        console.log('Database verified: PatientServiceDateHistories table ready.');
    } catch (e) {
        console.warn('Startup migration warning (PatientServiceDateHistories, non-fatal):', e.message);
    }

    // -- Auto-seed Roles + default admin on a brand-new database --------------
    try {
        const bcrypt = require('bcryptjs');
        const { BUILT_IN_DEFAULTS } = require('./middleware/rbac');

        // 1. Ensure the 4 built-in roles exist
        const builtInNames = ['Administrator', 'Supervisor', 'Operator', 'Read Only'];
        let adminRole = null;
        for (const name of builtInNames) {
            const [role] = await db.Role.findOrCreate({
                where: { name },
                defaults: {
                    name,
                    isSystem:    true,
                    permissions: BUILT_IN_DEFAULTS[name] ? BUILT_IN_DEFAULTS[name]() : {},
                    description: name + ' role'
                }
            });
            if (name === 'Administrator') adminRole = role;
        }

        // 2. Ensure a default admin user exists on first-run
        // SEC-06: Gated behind ALLOW_DEFAULT_SEED=true to prevent accidental credential
        // creation if the Users table is ever emptied in production (restore, purge, etc.).
        // Set ALLOW_DEFAULT_SEED=true in .env for fresh installs only. Remove after first login.
        const userCount = await db.User.count();
        if (userCount === 0 && adminRole) {
            if (process.env.ALLOW_DEFAULT_SEED === 'true') {
                const hash = await bcrypt.hash('admin123', 10);
                await db.User.create({
                    firstName:    'System',
                    lastName:     'Administrator',
                    username:     'admin',
                    email:        'admin@rxsystem.local',
                    passwordHash: hash,
                    roleId:       adminRole.id,
                    isActive:     true,
                    isMaster:     false   // grant isMaster via SQL after first login
                });
                console.log('');
                console.log('==============================================');
                console.log('         FIRST-RUN DEFAULT CREDENTIALS        ');
                console.log('  Username : admin                            ');
                console.log('  Password : admin123                         ');
                console.log('  !! CHANGE THIS PASSWORD AFTER LOGIN !!      ');
                console.log('  !! THEN REMOVE ALLOW_DEFAULT_SEED=true !!   ');
                console.log('==============================================');
                console.log('');
            } else {
                console.warn('[WARN] SEC-06: Users table is empty but ALLOW_DEFAULT_SEED is not set.');
                console.warn('[WARN]         No default admin was created. To seed a first-run admin,');
                console.warn('[WARN]         set ALLOW_DEFAULT_SEED=true in .env and restart.');
            }
        }
    } catch (e) {
        console.warn('Startup seed warning (non-fatal):', e.message);
    }

    // Load system settings (including timezone) BEFORE the server starts accepting requests
    await settingsService.load();

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}.`);
    });
};

startServer();
module.exports = app;
