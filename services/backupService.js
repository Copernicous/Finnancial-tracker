'use strict';

const cron      = require('node-cron');
const { spawn, spawnSync } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const { getAppRoot, getWritableRoot } = require('../utils/runtimePaths');

// ── Writable root ─────────────────────────────────────────────────────────────
// Defaults to the app/exe folder. Staging/test copies can set APP_WRITABLE_ROOT
// so backups, settings, logs, and local uploads never mix with production data.
const WRITABLE_ROOT = getWritableRoot();

// ── Config ────────────────────────────────────────────────────────────────────
const DEFAULT_BACKUP_DIR = path.join(WRITABLE_ROOT, 'backups');
const MAX_BACKUPS        = parseInt(process.env.BACKUP_RETAIN || '10');
const SETTINGS_PATH      = path.join(WRITABLE_ROOT, 'data', 'settings.json');
const PROJECT_ROOT       = getAppRoot();

// readSettings is used here before its definition below — forward-declare it
// so getDbBackupDir() is available to log helpers without a circular reference.
// Full definition is at line ~275 (beside getSiteBackupDir).
function _readSettingsEarly() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; }
}

// ── DB backup dir (configurable, persisted to settings.json) ──────────────────
function getDbBackupDir() {
    const s = _readSettingsEarly();
    return s.dbBackupPath || DEFAULT_BACKUP_DIR;
}
function setDbBackupDir(newDir) {
    ensureDir(path.dirname(SETTINGS_PATH));
    const s = _readSettingsEarly();
    s.dbBackupPath = newDir;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
    ensureDir(newDir);
    console.log('[Backup] DB backup directory updated to:', newDir);
}

// ── PostgreSQL tool locator ───────────────────────────────────────────────────
// Finds pg_dump / pg_restore even when PostgreSQL bin is not in PATH.
// Search order:
//   1. PGBIN env var  (set explicitly by user)
//   2. PATH  (works on dev machines where psql is in PATH)
//   3. Common Windows PostgreSQL install directories (newest version first)
var _pgBinCache = null;
function findPgTool(toolName) {
    // Return cached bin dir result
    if (_pgBinCache) return path.join(_pgBinCache, toolName + '.exe');

    // 1. Explicit env var
    if (process.env.PGBIN) {
        var explicit = path.join(process.env.PGBIN, toolName + '.exe');
        if (fs.existsSync(explicit)) { _pgBinCache = process.env.PGBIN; return explicit; }
    }

    // 2. Try PATH — spawnSync 'where pg_dump' on Windows
    try {
        var where = spawnSync('where', [toolName], { encoding: 'utf8', timeout: 3000 });
        if (where.status === 0 && where.stdout) {
            var first = where.stdout.trim().split(/\r?\n/)[0];
            if (fs.existsSync(first)) {
                _pgBinCache = path.dirname(first);
                console.log('[Backup] Found PostgreSQL tools via PATH:', _pgBinCache);
                return first;
            }
        }
    } catch {}

    // 3. Scan common Windows install paths (Program Files, versions 10-20)
    var bases = [
        process.env['ProgramFiles'],
        process.env['ProgramFiles(x86)'],
        'C:\\Program Files',
        'C:\\Program Files (x86)',
        'C:\\PostgreSQL',
        'C:\\pgsql'
    ].filter(Boolean);

    var candidates = [];
    bases.forEach(function(base) {
        var pgDir = path.join(base, 'PostgreSQL');
        if (!fs.existsSync(pgDir)) return;
        try {
            fs.readdirSync(pgDir).forEach(function(ver) {
                var bin = path.join(pgDir, ver, 'bin');
                var exe = path.join(bin, toolName + '.exe');
                if (fs.existsSync(exe)) candidates.push({ ver: parseFloat(ver) || 0, bin, exe });
            });
        } catch {}
    });

    if (candidates.length) {
        // Pick highest version
        candidates.sort(function(a, b) { return b.ver - a.ver; });
        _pgBinCache = candidates[0].bin;
        console.log('[Backup] Found PostgreSQL tools at:', _pgBinCache);
        return candidates[0].exe;
    }

    // Fallback — return bare name and let the OS try (will get ENOENT if missing)
    console.warn('[Backup] pg tool not found — tried PATH and common dirs. Set PGBIN in .env');
    return toolName;
}

// ── Lazy dir creation (never at module load time inside pkg snapshot) ─────────
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); }
        catch (e) { console.error('[Backup] Could not create dir:', dir, e.message); }
    }
}

// ── Log helpers ───────────────────────────────────────────────────────────────
function readLog() {
    try { return JSON.parse(fs.readFileSync(path.join(getDbBackupDir(), 'backup.log.json'), 'utf8')); }
    catch { return []; }
}
function writeLog(entries) {
    const dir = getDbBackupDir();
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'backup.log.json'), JSON.stringify(entries, null, 2));
}
function appendLog(entry) {
    const entries = readLog();
    entries.unshift(entry);
    if (entries.length > 100) entries.splice(100);
    writeLog(entries);
}

// ── pg_dump runner ────────────────────────────────────────────────────────────
function runBackup(triggeredBy = 'Scheduled') {
    return new Promise((resolve) => {
        const dir      = getDbBackupDir();
        ensureDir(dir);

        const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = 'backup_' + ts + '.dump';
        const filepath = path.join(dir, filename);

        const env  = process.env;
        const args = [
            '-h', env.DB_HOST || '127.0.0.1',
            '-U', env.DB_USER || 'postgres',
            '-d', env.DB_NAME || 'home_accounting_dev',
            '-F', 'c', '-f', filepath
        ];

        const pgEnv = Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' });
        const child = spawn(findPgTool('pg_dump'), args, { env: pgEnv });

        let stderr = '';
        child.stderr.on('data', d => { stderr += d.toString(); });

        child.on('close', code => {
            let size = 0;
            try { size = fs.statSync(filepath).size; } catch {}

            const entry = {
                id:          Date.now(),
                filename,
                filepath:    code === 0 ? filepath : null,
                timestamp:   new Date().toISOString(),
                triggeredBy,
                status:      code === 0 ? 'success' : 'failed',
                size,
                error:       code !== 0 ? stderr.trim() : null
            };

            appendLog(entry);
            pruneOldBackups();
            resolve(entry);
        });

        child.on('error', err => {
            const entry = {
                id:          Date.now(),
                filename:    null,
                timestamp:   new Date().toISOString(),
                triggeredBy,
                status:      'failed',
                size:        0,
                error:       'pg_dump not found or failed to start: ' + err.message
            };
            appendLog(entry);
            resolve(entry);
        });
    });
}

// ── Pruner ────────────────────────────────────────────────────────────────────
function pruneOldBackups() {
    try {
        const dir = getDbBackupDir();
        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith('backup_') && f.endsWith('.dump'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        files.slice(MAX_BACKUPS).forEach(f => {
            try { fs.unlinkSync(path.join(dir, f.name)); } catch {}
        });
    } catch {}
}

// ── Sync log with actual files on disk ────────────────────────────────────────
function syncLogWithDisk() {
    const dir     = getDbBackupDir();
    const entries = readLog();
    const synced  = entries.filter(e => {
        if (!e.filename) return true;
        return fs.existsSync(path.join(dir, e.filename));
    });
    if (synced.length !== entries.length) writeLog(synced);
    return synced;
}

// ── Delete a specific DB backup ───────────────────────────────────────────────
function deleteBackup(filename) {
    if (!filename || !/^backup_[\w\-]+\.dump$/.test(filename)) {
        throw new Error('Invalid backup filename');
    }
    const filepath = path.join(getDbBackupDir(), filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    const entries = readLog();
    writeLog(entries.filter(e => e.filename !== filename));
}

// ── Delete a history entry by ID (for failed entries with no file) ────────────
function deleteBackupHistoryEntry(id) {
    const entries = readLog();
    const filtered = entries.filter(e => String(e.id) !== String(id));
    if (filtered.length === entries.length) throw new Error('Entry not found: ' + id);
    writeLog(filtered);
}

// ── Delete a site backup history entry by ID ──────────────────────────────────
function deleteBackupSiteHistoryEntry(id) {
    const entries = readSiteLog();
    const filtered = entries.filter(e => String(e.id) !== String(id));
    if (filtered.length === entries.length) throw new Error('Site entry not found: ' + id);
    const logPath = path.join(getSiteBackupDir(), 'site-backup.log.json');
    try { fs.writeFileSync(logPath, JSON.stringify(filtered, null, 2)); } catch {}
}

// ── Cron scheduler ────────────────────────────────────────────────────────────
let _cronJob = null;
let _currentSchedule = null;

// BUG-27: returns { ok, error } so API route can detect rejection.
// BUG-28: persists accepted schedule to settings.json for restart survival.
function startScheduler(cronExpression) {
    if (_cronJob) { _cronJob.stop(); _cronJob = null; }
    if (!cronExpression || cronExpression === 'off') {
        _currentSchedule = 'off';
        // Persist disabled state
        try {
            ensureDir(path.dirname(SETTINGS_PATH));
            const s = readSettings();
            s.backupSchedule = 'off';
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
        } catch {}
        console.log('[Backup] Scheduler disabled.');
        return { ok: true, schedule: 'off' };
    }
    if (!cron.validate(cronExpression)) {
        console.error('[Backup] Invalid cron expression:', cronExpression);
        return { ok: false, error: 'Invalid cron expression: ' + cronExpression };
    }
    _currentSchedule = cronExpression;
    _cronJob = cron.schedule(cronExpression, () => {
        console.log('[Backup] Running scheduled backup...');
        runBackup('Scheduled').then(r => {
            console.log('[Backup] Scheduled backup', r.status, r.filename || r.error);
        });
    });
    // Persist accepted schedule
    try {
        ensureDir(path.dirname(SETTINGS_PATH));
        const s = readSettings();
        s.backupSchedule = cronExpression;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
    } catch {}
    console.log('[Backup] Scheduler started with expression:', cronExpression);
    return { ok: true, schedule: cronExpression };
}

const DEFAULT_SCHEDULE = process.env.BACKUP_SCHEDULE || '0 2 * * *';
// BUG-28: read persisted schedule from settings.json before falling back to .env
const _persistedSchedule = (() => { try { return readSettings().backupSchedule; } catch { return null; } })();
startScheduler(_persistedSchedule || DEFAULT_SCHEDULE);

// ════════════════════════════════════════════════════════════════════════════
// FULL SITE BACKUP
// ════════════════════════════════════════════════════════════════════════════
const MAX_SITE_BACKUPS = parseInt(process.env.SITE_BACKUP_RETAIN || '5');

function readSettings() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; }
}
function getSiteBackupDir() {
    const s = readSettings();
    return s.siteBackupPath || process.env.SITE_BACKUP_DIR || 'C:\\HomeAccounting-SiteBackups';
}
function setSiteBackupDir(newDir) {
    ensureDir(path.dirname(SETTINGS_PATH));
    const s = readSettings();
    s.siteBackupPath = newDir;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
    ensureDir(newDir);
    console.log('[SiteBackup] Directory updated to:', newDir);
}

function readSiteLog() {
    try { return JSON.parse(fs.readFileSync(path.join(getSiteBackupDir(), 'site-backup.log.json'), 'utf8')); }
    catch { return []; }
}
function appendSiteLog(entry) {
    const dir     = getSiteBackupDir();
    ensureDir(dir);
    const entries = readSiteLog();
    entries.unshift(entry);
    if (entries.length > 50) entries.splice(50);
    try { fs.writeFileSync(path.join(dir, 'site-backup.log.json'), JSON.stringify(entries, null, 2)); } catch {}
}
function pruneOldSiteBackups() {
    try {
        const files = fs.readdirSync(getSiteBackupDir())
            .filter(f => f.startsWith('HomeAccounting_SiteBackup_') && f.endsWith('.zip'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(getSiteBackupDir(), f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        files.slice(MAX_SITE_BACKUPS).forEach(f => {
            try { fs.unlinkSync(path.join(getSiteBackupDir(), f.name)); } catch {}
        });
    } catch {}
}
function syncSiteLogWithDisk() {
    const entries = readSiteLog();
    const synced  = entries.filter(e => {
        if (!e.filename) return true;
        return fs.existsSync(path.join(getSiteBackupDir(), e.filename));
    });
    if (synced.length !== entries.length) {
        try { fs.writeFileSync(path.join(getSiteBackupDir(), 'site-backup.log.json'), JSON.stringify(synced, null, 2)); } catch {}
    }
    return synced;
}
function deleteSiteBackup(filename) {
    if (!filename || !/^HomeAccounting_SiteBackup_[\w\-]+\.zip$/.test(filename)) {
        throw new Error('Invalid site backup filename');
    }
    const filepath = path.join(getSiteBackupDir(), filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    const entries = readSiteLog();
    const synced  = entries.filter(e => e.filename !== filename);
    try { fs.writeFileSync(path.join(getSiteBackupDir(), 'site-backup.log.json'), JSON.stringify(synced, null, 2)); } catch {}
}

function runFullSiteBackup(triggeredBy = 'Manual') {
    return new Promise((resolve) => {
        const siteDir  = getSiteBackupDir();
        ensureDir(siteDir);

        const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const zipName  = 'HomeAccounting_SiteBackup_' + ts + '.zip';
        const zipPath  = path.join(siteDir, zipName);
        const dbDump   = path.join(siteDir, '_temp_db_' + ts + '.dump');

        const env    = process.env;
        const pgEnv  = Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' });
        const dumpArgs = [
            '-h', env.DB_HOST || '127.0.0.1',
            '-U', env.DB_USER || 'postgres',
            '-d', env.DB_NAME || 'home_accounting_dev',
            '-F', 'c', '-f', dbDump
        ];

        console.log('[SiteBackup] Starting full site backup:', zipName);
        const pg = spawn(findPgTool('pg_dump'), dumpArgs, { env: pgEnv });
        let pgErr = '';
        pg.stderr.on('data', d => { pgErr += d.toString(); });

        pg.on('error', err => {
            const entry = { id: Date.now(), filename: null, timestamp: new Date().toISOString(),
                triggeredBy, status: 'failed', size: 0, error: 'pg_dump error: ' + err.message };
            appendSiteLog(entry);
            resolve(entry);
        });

        pg.on('close', code => {
            if (code !== 0) {
                const entry = { id: Date.now(), filename: null, timestamp: new Date().toISOString(),
                    triggeredBy, status: 'failed', size: 0, error: 'pg_dump failed: ' + pgErr.trim() };
                appendSiteLog(entry);
                resolve(entry);
                return;
            }

            const psFile    = path.join(siteDir, '_sitebackup_' + ts + '.ps1');
            const srcEsc    = PROJECT_ROOT.replace(/\\/g, '\\\\');
            const destEsc   = zipPath.replace(/\\/g, '\\\\');
            const dumpEsc   = dbDump.replace(/\\/g, '\\\\');

            const psContent = [
                'Add-Type -Assembly System.IO.Compression.FileSystem',
                '$src    = "' + srcEsc + '"',
                '$dest   = "' + destEsc + '"',
                '$dbDump = "' + dumpEsc + '"',
                '$exclude = @("node_modules", ".git", "logs")',
                '',
                '$files = Get-ChildItem -Path $src -Recurse -File | Where-Object {',
                '    $rel   = $_.FullName.Substring($src.Length + 1)',
                '    $parts = $rel -split "[\\\\/]"',
                '    $skip  = $false',
                '    foreach ($ex in $exclude) { if ($parts -contains $ex) { $skip = $true; break } }',
                '    -not $skip',
                '}',
                '',
                'if (Test-Path $dest) { Remove-Item $dest -Force }',
                '$zip = [System.IO.Compression.ZipFile]::Open($dest, "Create")',
                'foreach ($f in $files) {',
                '    $entry = $f.FullName.Substring($src.Length + 1)',
                '    try {',
                '        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entry) | Out-Null',
                '    } catch {}',
                '}',
                '# Include DB dump inside the ZIP',
                'try {',
                '    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $dbDump, "db_backup.dump") | Out-Null',
                '} catch {}',
                '$zip.Dispose()',
                'Remove-Item $dbDump -Force -ErrorAction SilentlyContinue',
                'Write-Host "DONE"'
            ].join('\r\n');

            try { fs.writeFileSync(psFile, psContent, 'utf8'); } catch (e) {
                try { fs.unlinkSync(dbDump); } catch {}
                const entry = { id: Date.now(), filename: null, timestamp: new Date().toISOString(),
                    triggeredBy, status: 'failed', size: 0, error: 'Could not write PS script: ' + e.message };
                appendSiteLog(entry);
                resolve(entry);
                return;
            }

            const ps = spawn('powershell',
                ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile],
                { env: process.env });

            let psOut = '', psErrOut = '';
            ps.stdout.on('data', d => { psOut    += d.toString(); });
            ps.stderr.on('data', d => { psErrOut += d.toString(); });

            ps.on('error', err => {
                try { fs.unlinkSync(dbDump); } catch {}
                const entry = { id: Date.now(), filename: null, timestamp: new Date().toISOString(),
                    triggeredBy, status: 'failed', size: 0, error: 'PowerShell error: ' + err.message };
                appendSiteLog(entry);
                resolve(entry);
            });

            ps.on('close', psCode => {
                let size = 0;
                try { size = fs.statSync(zipPath).size; } catch {}
                try { if (fs.existsSync(dbDump)) fs.unlinkSync(dbDump); } catch {}

                const success = psCode === 0 && psOut.includes('DONE') && size > 0;
                const entry = {
                    id:          Date.now(),
                    filename:    success ? zipName : null,
                    filepath:    success ? zipPath : null,
                    timestamp:   new Date().toISOString(),
                    triggeredBy,
                    status:      success ? 'success' : 'failed',
                    size,
                    error:       !success ? (psErrOut.trim() || 'Unknown error') : null
                };
                appendSiteLog(entry);
                if (success) pruneOldSiteBackups();
                console.log('[SiteBackup]', entry.status,
                    success ? zipName + ' (' + Math.round(size / 1024) + ' KB)' : entry.error);
                resolve(entry);
            });
        });
    });
}

// ── Weekly site backup scheduler ──────────────────────────────────────────────
let _siteBackupJob = null;
let _siteBackupSchedule = null;

// BUG-27: returns { ok, error }. BUG-28: persists accepted schedule to settings.json.
function startSiteBackupScheduler(cronExpression) {
    if (_siteBackupJob) { _siteBackupJob.stop(); _siteBackupJob = null; }
    if (!cronExpression || cronExpression === 'off') {
        _siteBackupSchedule = 'off';
        try {
            ensureDir(path.dirname(SETTINGS_PATH));
            const s = readSettings();
            s.siteBackupSchedule = 'off';
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
        } catch {}
        return { ok: true, schedule: 'off' };
    }
    if (!cron.validate(cronExpression)) {
        return { ok: false, error: 'Invalid cron expression: ' + cronExpression };
    }
    _siteBackupSchedule = cronExpression;
    _siteBackupJob = cron.schedule(cronExpression, () => {
        console.log('[SiteBackup] Running scheduled full site backup...');
        runFullSiteBackup('Scheduled (Weekly)');
    });
    try {
        ensureDir(path.dirname(SETTINGS_PATH));
        const s = readSettings();
        s.siteBackupSchedule = cronExpression;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
    } catch {}
    console.log('[SiteBackup] Weekly scheduler started:', cronExpression);
    return { ok: true, schedule: cronExpression };
}

const DEFAULT_SITE_SCHEDULE = process.env.SITE_BACKUP_SCHEDULE || '0 3 * * 0';
// BUG-28: read persisted site schedule from settings.json before falling back to .env
const _persistedSiteSchedule = (() => { try { return readSettings().siteBackupSchedule; } catch { return null; } })();
startSiteBackupScheduler(_persistedSiteSchedule || DEFAULT_SITE_SCHEDULE);

// ── Restore from a .dump file ─────────────────────────────────────────────────
// Strategy: DROP the target DB entirely, recreate it empty, then pg_restore.
// This avoids all FK cascade errors from --clean trying to drop tables in wrong order.
// Steps:
//   1. Auto-safety-backup current DB
//   2. Connect to 'postgres' default DB → DROP DATABASE → CREATE DATABASE
//   3. pg_restore into the fresh empty database (no --clean needed)
function restoreBackup(dumpFilePath, triggeredBy) {
    triggeredBy = triggeredBy || 'Manual restore';
    return new Promise(function(resolve) {
        ensureDir(getDbBackupDir());
        var env    = process.env;
        var pgEnv  = Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' });
        var dbName = env.DB_NAME    || 'home_accounting_dev';
        var host   = env.DB_HOST   || '127.0.0.1';
        var port   = env.DB_PORT   || '5432';
        var user   = env.DB_USER   || 'postgres';

        // Step 1: safety backup
        runBackup('Pre-restore auto-safety-backup').then(function() {

            // Step 2: drop + recreate DB via psql connecting to 'postgres'
            // We run two psql commands: one DROP, one CREATE
            var psqlTool = findPgTool('psql');

            function runPsql(sql, cb) {
                var args = [
                    '-h', host, '-p', port, '-U', user,
                    '-d', 'postgres',
                    '-c', sql
                ];
                var proc = spawn(psqlTool, args, { env: pgEnv });
                var out = '', err = '';
                proc.stdout.on('data', function(d) { out += d.toString(); });
                proc.stderr.on('data', function(d) { err += d.toString(); });
                proc.on('error', function(e) { cb(e, '', ''); });
                proc.on('close', function(code) { cb(null, out, err, code); });
            }

            var logLines = '';

            // Terminate all connections first (required before DROP)
            var terminateSql = 'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = \'' + dbName + '\' AND pid <> pg_backend_pid();';
            runPsql(terminateSql, function(e1) {
                if (e1) {
                    return resolve({ status: 'failed', log: '', error: 'psql not found: ' + e1.message + '\nMake sure PostgreSQL bin is in PATH or set PGBIN in .env' });
                }

                runPsql('DROP DATABASE IF EXISTS "' + dbName + '";', function(e2, o2, err2, c2) {
                    logLines += '[DROP] ' + (c2 === 0 ? 'OK' : 'exit ' + c2) + (err2 ? ' ' + err2.trim() : '') + '\n';

                    runPsql('CREATE DATABASE "' + dbName + '" TEMPLATE template0;', function(e3, o3, err3, c3) {
                        logLines += '[CREATE] ' + (c3 === 0 ? 'OK' : 'exit ' + c3) + (err3 ? ' ' + err3.trim() : '') + '\n';

                        if (c3 !== 0) {
                            return resolve({ status: 'failed', log: logLines, error: 'Failed to recreate database: ' + err3.trim() });
                        }

                        // Step 3: pg_restore into fresh empty DB
                        var args = [
                            '-h', host, '-p', port, '-U', user,
                            '-d', dbName,
                            '-F', 'c',
                            '--no-owner', '--no-privileges',
                            dumpFilePath
                        ];

                        var child = spawn(findPgTool('pg_restore'), args, { env: pgEnv });
                        var restoreOut = '', restoreErr = '';
                        child.stdout.on('data', function(d) { restoreOut += d.toString(); });
                        child.stderr.on('data', function(d) { restoreErr += d.toString(); });

                        child.on('error', function(err) {
                            resolve({ status: 'failed', log: logLines, error: 'pg_restore not found: ' + err.message });
                        });

                        child.on('close', function(code) {
                            var success = code === 0;
                            var fullLog = logLines + restoreOut + (restoreErr ? '\n[stderr]\n' + restoreErr : '');
                            var entry = {
                                id:          Date.now(),
                                filename:    null,
                                timestamp:   new Date().toISOString(),
                                triggeredBy: triggeredBy,
                                status:      success ? 'success' : 'failed',
                                size:        0,
                                error:       success ? null : (restoreErr.trim() || ('Exit code ' + code))
                            };
                            appendLog(entry);
                            resolve({
                                status: success ? 'success' : 'failed',
                                log:    fullLog,
                                error:  success ? null : (restoreErr.trim() || ('Exit code ' + code))
                            });
                        });
                    });
                });
            });
        });
    });
}

module.exports = {
    runBackup,
    restoreBackup,
    readLog,
    deleteBackup,
    deleteBackupHistoryEntry,
    deleteBackupSiteHistoryEntry,
    startScheduler,
    getDbBackupDir,
    setDbBackupDir,
    getStatus: () => ({
        schedule:      _currentSchedule || DEFAULT_SCHEDULE,
        backupDir:     getDbBackupDir(),
        maxBackups:    MAX_BACKUPS,
        recentBackups: syncLogWithDisk().slice(0, 20)
    }),
    runFullSiteBackup,
    readSiteLog,
    deleteSiteBackup,
    setSiteBackupDir,
    getSiteBackupDir,
    startSiteBackupScheduler,
    getSiteBackupStatus: () => ({
        schedule:      _siteBackupSchedule || DEFAULT_SITE_SCHEDULE,
        backupDir:     getSiteBackupDir(),
        maxBackups:    MAX_SITE_BACKUPS,
        recentBackups: syncSiteLogWithDisk().slice(0, 10)
    })
};
