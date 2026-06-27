'use strict';
const db        = require('../models');
const { QueryTypes, Op } = require('sequelize');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const bcrypt    = require('bcryptjs');
const { parseDate } = require('../utils/dateUtils');
const fileSettings = require('../utils/globalSettings');
const logDashboardService = require('../services/logDashboardService');
const {
    recordPatientServiceDateChange
} = require('../services/patientServiceDateHistoryService');

function readSettings() {
    return fileSettings.readSettings();
}

// ── Table definitions with deletion order (dependencies first) ────────────────
const TABLE_META = [
    {
        key: 'RXWorkflowTrackings',
        label: 'RX Workflow Trackings',
        icon: 'fas fa-project-diagram',
        color: '#f59e0b',
        description: 'Workflow step completions for RX records',
        dependsOn: ['RXRecords']
    },
    {
        key: 'RXHistories',
        label: 'RX Histories',
        icon: 'fas fa-history',
        color: '#8b5cf6',
        description: 'Audit trail of RX record changes',
        dependsOn: ['RXRecords']
    },
    {
        key: 'Medications',
        label: 'Medications',
        icon: 'fas fa-pills',
        color: '#06b6d4',
        description: 'Medication entries attached to RX records',
        dependsOn: ['RXRecords']
    },
    {
        key: 'RXRecords',
        label: 'RX Records',
        icon: 'fas fa-prescription',
        color: '#ef4444',
        description: 'All prescription tracking records',
        dependsOn: ['Patients']
    },
    {
        key: 'PatientNotes',
        label: 'Patient Notes',
        icon: 'fas fa-sticky-note',
        color: '#eab308',
        description: 'Free-text notes attached to patient profiles',
        dependsOn: ['Patients']
    },
    {
        key: 'PatientServiceDateHistories',
        label: 'Patient Service Date Histories',
        icon: 'fas fa-calendar-alt',
        color: '#7c3aed',
        description: 'Patient-level service date changes over time',
        dependsOn: ['Patients']
    },
    {
        key: 'PatientLocks',
        label: 'Patient Locks',
        icon: 'fas fa-lock',
        color: '#6b7280',
        description: 'Soft-lock records for concurrent editing protection',
        dependsOn: ['Patients']
    },
    {
        key: 'Patients',
        label: 'Patients',
        icon: 'fas fa-user-injured',
        color: '#f43f5e',
        description: 'All patient profiles and demographic data',
        dependsOn: []
    },
    {
        key: 'Pharmacies',
        label: 'Pharmacies',
        icon: 'fas fa-clinic-medical',
        color: '#10b981',
        description: 'Pharmacy locations and contacts',
        dependsOn: []
    },
    {
        key: 'PharmacyTransportCompanies',
        label: 'Pharmacy Transport Companies',
        icon: 'fas fa-truck',
        color: '#3b82f6',
        description: 'Companies that transport from pharmacies',
        dependsOn: []
    },
    {
        key: 'PatientTransportCompanies',
        label: 'Patient Transport Companies',
        icon: 'fas fa-ambulance',
        color: '#14b8a6',
        description: 'Companies that transport patients',
        dependsOn: []
    },
    {
        key: 'Clinics',
        label: 'Clinics',
        icon: 'fas fa-hospital',
        color: '#6366f1',
        description: 'Clinic locations linked to patients',
        dependsOn: []
    },
    {
        key: 'MedicationCatalogs',
        label: 'RX Actions (Catalog)',
        icon: 'fas fa-clipboard-list',
        color: '#0ea5e9',
        description: 'Catalog of available prescription action types',
        dependsOn: []
    },
    {
        key: 'WorkflowActions',
        label: 'Workflow Actions',
        icon: 'fas fa-tasks',
        color: '#84cc16',
        description: 'Workflow step definitions for RX tracking',
        dependsOn: []
    },
    {
        key: 'AuditLogs',
        label: 'Audit Logs',
        icon: 'fas fa-shield-alt',
        color: '#f97316',
        description: 'System-wide change audit trail',
        dependsOn: []
    },
];

// GET /api/admin/stats — live record counts
exports.getStats = async (req, res) => {
    try {
        const counts = {};
        for (const t of TABLE_META) {
            const [result] = await db.sequelize.query(
                `SELECT COUNT(*) AS cnt FROM "${t.key}"`,
                { type: QueryTypes.SELECT }
            );
            counts[t.key] = parseInt(result.cnt, 10);
        }
        res.json({ tables: TABLE_META, counts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// GET /api/admin/schema — column definitions + FK relationships
exports.getSchema = async (req, res) => {
    try {
        const colRows = await db.sequelize.query(`
            SELECT table_name, column_name, data_type, character_maximum_length,
                   is_nullable, column_default, ordinal_position
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        `, { type: QueryTypes.SELECT });

        const fkRows = await db.sequelize.query(`
            SELECT tc.table_name AS from_table, kcu.column_name AS from_column,
                   ccu.table_name AS to_table, ccu.column_name AS to_column,
                   tc.constraint_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
            ORDER BY tc.table_name, kcu.column_name
        `, { type: QueryTypes.SELECT });

        const pkRows = await db.sequelize.query(`
            SELECT tc.table_name, kcu.column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
        `, { type: QueryTypes.SELECT });

        const pkSet = {};
        pkRows.forEach(r => { if (!pkSet[r.table_name]) pkSet[r.table_name] = new Set(); pkSet[r.table_name].add(r.column_name); });

        const fkMap = {};
        fkRows.forEach(r => { fkMap[`${r.from_table}.${r.from_column}`] = { toTable: r.to_table, toColumn: r.to_column }; });

        const tables = {};
        colRows.forEach(row => {
            if (!tables[row.table_name]) tables[row.table_name] = { name: row.table_name, columns: [] };
            const colKey = `${row.table_name}.${row.column_name}`;
            tables[row.table_name].columns.push({
                name:       row.column_name,
                type:       row.data_type + (row.character_maximum_length ? `(${row.character_maximum_length})` : ''),
                nullable:   row.is_nullable === 'YES',
                isPK:       !!(pkSet[row.table_name] && pkSet[row.table_name].has(row.column_name)),
                isFK:       !!fkMap[colKey],
                references: fkMap[colKey] || null
            });
        });

        res.json({ tables: Object.values(tables), relationships: fkRows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
// DELETE /api/admin/purge — purge selected tables in safe order
exports.purge = async (req, res) => {
    const { tables } = req.body; // array of table keys
    if (!tables || !Array.isArray(tables) || tables.length === 0) {
        return res.status(400).json({ error: 'No tables specified.' });
    }

    // Validate all keys are legit
    const validKeys = new Set(TABLE_META.map(t => t.key));
    const invalid = tables.filter(t => !validKeys.has(t));
    if (invalid.length > 0) {
        return res.status(400).json({ error: `Unknown tables: ${invalid.join(', ')}` });
    }

    // Build topologically-sorted deletion order:
    // children (dependsOn non-empty) go first, then parents
    const orderedAll = [...TABLE_META]; // already in safe order in our definition
    const toDelete = orderedAll.filter(t => tables.includes(t.key));

    // Before deleting Patients, null FK refs in RXRecords and Patients from Pharmacies/Transport
    // Also null pharmacyId and transport refs if those tables are being purged
    const results = {};
    const t = await db.sequelize.transaction();
    try {
        // Handle FK nullification for tables that other records point TO
        if (tables.includes('Pharmacies')) {
            await db.sequelize.query('UPDATE "RXRecords" SET "pharmacyId" = NULL WHERE "pharmacyId" IS NOT NULL', { transaction: t });
            await db.sequelize.query('UPDATE "Patients"  SET "pharmacyId" = NULL WHERE "pharmacyId"  IS NOT NULL', { transaction: t });
        }
        if (tables.includes('PharmacyTransportCompanies')) {
            await db.sequelize.query('UPDATE "RXRecords" SET "pharmacyTransportCompanyId" = NULL WHERE "pharmacyTransportCompanyId" IS NOT NULL', { transaction: t });
            await db.sequelize.query('UPDATE "Patients"  SET "pharmacyTransportCompanyId" = NULL WHERE "pharmacyTransportCompanyId" IS NOT NULL', { transaction: t });
        }
        if (tables.includes('PatientTransportCompanies')) {
            await db.sequelize.query('UPDATE "RXRecords" SET "patientTransportCompanyId" = NULL WHERE "patientTransportCompanyId" IS NOT NULL', { transaction: t });
            await db.sequelize.query('UPDATE "Patients"  SET "patientTransportCompanyId" = NULL WHERE "patientTransportCompanyId"  IS NOT NULL', { transaction: t });
        }
        if (tables.includes('Clinics')) {
            await db.sequelize.query('UPDATE "Patients" SET "clinicId" = NULL WHERE "clinicId" IS NOT NULL', { transaction: t });
        }
        if (tables.includes('RXRecords') || tables.includes('Patients')) {
            // Null workflow/medication FK refs that point to RXRecords/Patients if not already deleting them
            if (!tables.includes('RXWorkflowTrackings')) {
                await db.sequelize.query('DELETE FROM "RXWorkflowTrackings" WHERE "rxRecordId" IN (SELECT id FROM "RXRecords")', { transaction: t });
            }
            if (!tables.includes('Medications')) {
                await db.sequelize.query('DELETE FROM "Medications" WHERE "rxRecordId" IN (SELECT id FROM "RXRecords")', { transaction: t });
            }
            if (!tables.includes('RXHistories')) {
                await db.sequelize.query('DELETE FROM "RXHistories" WHERE "rxRecordId" IN (SELECT id FROM "RXRecords")', { transaction: t });
            }
        }
        if (tables.includes('Patients')) {
            if (!tables.includes('PatientNotes')) {
                await db.sequelize.query('DELETE FROM "PatientNotes" WHERE "patientId" IN (SELECT id FROM "Patients")', { transaction: t });
            }
            if (!tables.includes('PatientServiceDateHistories')) {
                await db.sequelize.query('DELETE FROM "PatientServiceDateHistories" WHERE "patientId" IN (SELECT id FROM "Patients")', { transaction: t });
            }
            if (!tables.includes('PatientLocks')) {
                await db.sequelize.query('DELETE FROM "PatientLocks" WHERE "patientId" IN (SELECT id FROM "Patients")', { transaction: t });
            }
            if (!tables.includes('RXRecords')) {
                await db.sequelize.query('DELETE FROM "RXRecords" WHERE "patientId" IN (SELECT id FROM "Patients")', { transaction: t });
            }
        }

        // Now delete in safe order
        for (const tbl of toDelete) {
            const [rows] = await db.sequelize.query(
                `DELETE FROM "${tbl.key}" RETURNING id`,
                { type: QueryTypes.SELECT, transaction: t }
            );
            results[tbl.key] = Array.isArray(rows) ? rows.length : 0;
        }

        await t.commit();

        // Write to audit log
        try {
            // Use validated labels from TABLE_META (not raw user input) to prevent log injection
            var _validatedLabels = toDelete.map(function(t) { return t.label; }).join(', ');
            await db.AuditLog.create({
                userId: req.user?.id || null,
                action: 'BACKOFFICE_PURGE',
                entity: 'ADMIN',
                entityId: null,
                details: `Purged tables: ${_validatedLabels}. Counts: ${JSON.stringify(results)}`
            });
        } catch(e) { /* non-fatal */ }

        res.json({ success: true, results });
    } catch (err) {
        await t.rollback();
        res.status(500).json({ error: err.message });
    }
};

// ══════════════════════════════════════════════════════════════════════════
// SYSTEM SETTINGS
// ══════════════════════════════════════════════════════════════════════════
exports.getSettings = (req, res) => {
    try { res.json(readSettings()); }
    catch (e) { res.status(500).json({ error: e.message }); }
};

exports.saveSettings = (req, res) => {
    try {
        const allowed = ['backupPath','backupRetentionDays','appName','sessionTimeoutMinutes','maxLoginAttempts','maintenanceMode','serviceDateOverrideEnabled'];
        const current = readSettings();
        const next    = { ...current };
        for (const key of allowed) if (req.body[key] !== undefined) next[key] = req.body[key];
        next.maintenanceMode = next.maintenanceMode === true || next.maintenanceMode === 'true';
        next.serviceDateOverrideEnabled = next.serviceDateOverrideEnabled === true || next.serviceDateOverrideEnabled === 'true';
        if (next.backupPath) { try { fs.mkdirSync(next.backupPath, { recursive: true }); } catch {} }
        fileSettings.writeSettings(next);
        if (current.serviceDateOverrideEnabled !== next.serviceDateOverrideEnabled) {
            db.AuditLog.create({
                userId:        req.user ? req.user.id : null,
                date:          new Date().toISOString().split('T')[0],
                time:          new Date().toTimeString().split(' ')[0],
                module:        'Backoffice',
                action:        next.serviceDateOverrideEnabled ? 'Global 90-Day Override Enabled' : 'Global 90-Day Override Disabled',
                recordId:      null,
                previousValue: { serviceDateOverrideEnabled: current.serviceDateOverrideEnabled },
                newValue:      { serviceDateOverrideEnabled: next.serviceDateOverrideEnabled },
                ipAddress:     req.ip || (req.socket ? req.socket.remoteAddress : 'unknown')
            }).catch(function() {});
        }
        res.json({ success: true, settings: next });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ══════════════════════════════════════════════════════════════════════════
// BACKUP MANAGER
// ══════════════════════════════════════════════════════════════════════════
function rowsToCsv(columns, rows) {
    const esc = v => {
        if (v === null || v === undefined) return '';
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return (s.includes(',') || s.includes('"') || s.includes('\n'))
            ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return columns.map(esc).join(',') + '\n' + rows.map(r => columns.map(c => esc(r[c])).join(',')).join('\n');
}

exports.createBackup = async (req, res) => {
    const settings = readSettings();
    const bkpRoot  = settings.backupPath || path.join(__dirname, '..', 'backups');
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bkpDir   = path.join(bkpRoot, `backup_${ts}`);
    try {
        fs.mkdirSync(bkpDir, { recursive: true });
        const files = [];
        for (const meta of TABLE_META) {
            const rows = await db.sequelize.query(`SELECT * FROM "${meta.key}" ORDER BY id`, { type: QueryTypes.SELECT });
            if (!rows.length) { files.push({ table: meta.key, rows: 0 }); continue; }
            const cols = Object.keys(rows[0]);
            fs.writeFileSync(path.join(bkpDir, `${meta.key}.csv`), rowsToCsv(cols, rows), 'utf8');
            files.push({ table: meta.key, rows: rows.length });
        }
        fs.writeFileSync(path.join(bkpDir, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), tables: files }, null, 2), 'utf8');
        // Auto-prune old backups
        try {
            const retDays = parseInt(settings.backupRetentionDays || 30, 10);
            const cutoff  = Date.now() - retDays * 86400 * 1000;
            fs.readdirSync(bkpRoot).forEach(d => {
                const full = path.join(bkpRoot, d);
                if (fs.statSync(full).isDirectory() && d.startsWith('backup_') && fs.statSync(full).mtimeMs < cutoff)
                    fs.rmSync(full, { recursive: true, force: true });
            });
        } catch {}
        res.json({ success: true, backupDir: `backup_${ts}`, files });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.listBackups = (req, res) => {
    const settings = readSettings();
    const bkpRoot  = settings.backupPath || path.join(__dirname, '..', 'backups');
    try {
        fs.mkdirSync(bkpRoot, { recursive: true });
        const dirs = fs.readdirSync(bkpRoot)
            .filter(d => { try { return fs.statSync(path.join(bkpRoot, d)).isDirectory() && d.startsWith('backup_'); } catch { return false; } })
            .map(d => {
                const full  = path.join(bkpRoot, d);
                const stat  = fs.statSync(full);
                let manifest = null;
                try { manifest = JSON.parse(fs.readFileSync(path.join(full, 'manifest.json'), 'utf8')); } catch {}
                const csvFiles = fs.readdirSync(full).filter(f => f.endsWith('.csv'));
                const size = csvFiles.reduce((s, f) => { try { return s + fs.statSync(path.join(full, f)).size; } catch { return s; } }, 0);
                return { name: d, createdAt: stat.birthtime, sizeBytes: size, fileCount: csvFiles.length, tables: manifest?.tables || [] };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ backups: dirs, backupPath: bkpRoot });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteBackup = (req, res) => {
    const { name } = req.params;
    if (!name || !name.startsWith('backup_') || name.includes('..')) return res.status(400).json({ error: 'Invalid backup name.' });
    const settings = readSettings();
    const bkpRoot  = settings.backupPath || path.join(__dirname, '..', 'backups');
    try {
        const full = path.join(bkpRoot, name);
        if (!fs.existsSync(full)) return res.status(404).json({ error: 'Backup not found.' });
        fs.rmSync(full, { recursive: true, force: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.downloadBackupFile = (req, res) => {
    const { name, file } = req.params;
    if (!name.startsWith('backup_') || name.includes('..') || file.includes('..')) return res.status(400).json({ error: 'Invalid path.' });
    const settings = readSettings();
    const bkpRoot  = settings.backupPath || path.join(__dirname, '..', 'backups');
    const fp = path.join(bkpRoot, name, file);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found.' });
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.sendFile(path.resolve(fp));
};

// ══════════════════════════════════════════════════════════════════════════
// SYSTEM HEALTH
// ══════════════════════════════════════════════════════════════════════════
exports.getHealth = async (req, res) => {
    try {
        const tableStats = await db.sequelize.query(`
            SELECT t.tablename AS "table",
                pg_size_pretty(pg_total_relation_size(quote_ident(t.tablename))) AS "totalSize",
                pg_total_relation_size(quote_ident(t.tablename)) AS "sizeBytes",
                COALESCE(s.n_live_tup, 0) AS "rowEstimate"
            FROM pg_tables t
            LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename
            WHERE t.schemaname = 'public'
            ORDER BY pg_total_relation_size(quote_ident(t.tablename)) DESC
        `, { type: QueryTypes.SELECT });

        const [dbInfo] = await db.sequelize.query(
            `SELECT pg_size_pretty(pg_database_size(current_database())) AS "size",
                    pg_database_size(current_database()) AS "sizeBytes",
                    current_database() AS "name", version() AS "version"`,
            { type: QueryTypes.SELECT }
        );

        const [conn] = await db.sequelize.query(
            `SELECT count(*) AS "active" FROM pg_stat_activity WHERE state = 'active'`,
            { type: QueryTypes.SELECT }
        );

        const mem = process.memoryUsage();
        const node = {
            version: process.version, platform: process.platform, arch: process.arch,
            uptime: Math.floor(process.uptime()),
            heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss,
            cpus: os.cpus().length, hostname: os.hostname(),
            freeMemBytes: os.freemem(), totalMemBytes: os.totalmem()
        };

        res.json({ tableStats, db: dbInfo, connections: parseInt(conn.active, 10), node });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ══════════════════════════════════════════════════════════════════════════
exports.getLogDashboard = async (req, res) => {
    try {
        const summary = await logDashboardService.buildLogDashboardSummary(req.query || {});
        res.json(summary);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// LOCK MANAGER
// ══════════════════════════════════════════════════════════════════════════
exports.getLocks = async (req, res) => {
    try {
        const locks = await db.sequelize.query(`
            SELECT pl.id, pl."patientId", pl."userId", pl."lockedAt", pl."expiresAt",
                p."firstName" || ' ' || p."lastName" AS "patientName",
                u."firstName" || ' ' || u."lastName" AS "userName", u."username",
                CASE WHEN pl."expiresAt" > NOW() THEN true ELSE false END AS "isActive",
                EXTRACT(EPOCH FROM (pl."expiresAt" - NOW()))::int AS "secsRemaining"
            FROM "PatientLocks" pl
            LEFT JOIN "Patients" p ON p.id = pl."patientId"
            LEFT JOIN "Users"    u ON u.id = pl."userId"
            ORDER BY pl."expiresAt" DESC
        `, { type: QueryTypes.SELECT });
        res.json({ locks, active: locks.filter(l => l.isActive).length, expired: locks.filter(l => !l.isActive).length });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.releaseLock = async (req, res) => {
    const { id } = req.params;
    try {
        await db.sequelize.query(`DELETE FROM "PatientLocks" WHERE id = :id`, { replacements: { id: parseInt(id,10) }, type: QueryTypes.DELETE });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.releaseExpiredLocks = async (req, res) => {
    try {
        const rows = await db.sequelize.query(`DELETE FROM "PatientLocks" WHERE "expiresAt" < NOW() RETURNING id`, { type: QueryTypes.SELECT });
        res.json({ success: true, released: Array.isArray(rows) ? rows.length : 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.searchPatientsForServiceDateOverride = async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.json({ patients: [] });

        const like = { [Op.like]: `%${q}%` };
        const patients = await db.Patient.findAll({
            where: {
                [Op.and]: [
                    { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
                    {
                        [Op.or]: [
                            { firstName: like },
                            { lastName: like },
                            { patientCode: like },
                            { phone: like }
                        ]
                    }
                ]
            },
            attributes: ['id', 'patientCode', 'firstName', 'lastName', 'dob', 'phone', 'serviceDate', 'isActive'],
            include: [{
                model: db.RXRecord,
                attributes: ['id', 'serviceDate', 'arrivalDate', 'isDeleted'],
                where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
                required: false
            }],
            order: [['lastName', 'ASC'], ['firstName', 'ASC']],
            limit: 12
        });

        res.json({ patients });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.overridePatientServiceDate = async (req, res) => {
    const patientId = parseInt(req.params.id, 10);
    const newServiceDate = parseDate(req.body.serviceDate);
    const reason = String(req.body.reason || '').trim();
    const syncMatchingRx = req.body.syncMatchingRx === true || req.body.syncMatchingRx === 'true';

    if (!Number.isFinite(patientId)) return res.status(400).json({ error: 'Invalid patient id.' });
    if (!newServiceDate) return res.status(400).json({ error: 'New service date is required.' });
    if (reason.length < 8) return res.status(400).json({ error: 'A reason of at least 8 characters is required.' });

    const t = await db.sequelize.transaction();
    try {
        const patient = await db.Patient.findByPk(patientId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!patient) {
            await t.rollback();
            return res.status(404).json({ error: 'Patient not found.' });
        }

        const oldServiceDate = patient.serviceDate ? String(patient.serviceDate).slice(0, 10) : null;
        if (oldServiceDate === newServiceDate) {
            await t.rollback();
            return res.status(400).json({ error: 'New service date is the same as the current service date.' });
        }

        patient.serviceDate = newServiceDate;
        await patient.save({ transaction: t });

        let rxUpdated = 0;
        if (syncMatchingRx && oldServiceDate) {
            const result = await db.RXRecord.update(
                { serviceDate: newServiceDate, arrivalDate: newServiceDate },
                {
                    where: {
                        patientId,
                        serviceDate: oldServiceDate,
                        [Op.or]: [{ isDeleted: false }, { isDeleted: null }]
                    },
                    transaction: t
                }
            );
            rxUpdated = Array.isArray(result) ? result[0] : result;
        }

        const label = `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || `Patient #${patient.id}`;
        await db.AuditLog.create({
            userId:        req.user ? req.user.id : null,
            date:          new Date().toISOString().split('T')[0],
            time:          new Date().toTimeString().split(' ')[0],
            module:        'Backoffice',
            action:        '90-Day Service Date Override',
            recordId:      patient.id,
            previousValue: {
                _label: label,
                patientCode: patient.patientCode,
                serviceDate: oldServiceDate
            },
            newValue: {
                _label: label,
                patientCode: patient.patientCode,
                serviceDate: newServiceDate,
                reason,
                syncMatchingRx,
                rxUpdated
            },
            ipAddress:     req.ip || req.socket?.remoteAddress || 'unknown'
        }, { transaction: t });

        await t.commit();

        await recordPatientServiceDateChange({
            patientId: patient.id,
            previousServiceDate: oldServiceDate,
            newServiceDate,
            userId: req.user?.id || null,
            changeSource: 'Backoffice Override',
            reason,
            metadata: {
                syncMatchingRx,
                rxUpdated
            }
        });

        res.json({
            success: true,
            patient: {
                id: patient.id,
                patientCode: patient.patientCode,
                firstName: patient.firstName,
                lastName: patient.lastName,
                oldServiceDate,
                serviceDate: newServiceDate
            },
            rxUpdated
        });
    } catch (e) {
        await t.rollback();
        res.status(500).json({ error: e.message });
    }
};

// ══════════════════════════════════════════════════════════════════════════
// USER MANAGER
// ══════════════════════════════════════════════════════════════════════════
const ROLE_LABELS = { 1: 'Administrator', 2: 'Supervisor', 3: 'Operator', 4: 'Read Only' };

exports.getUsers = async (req, res) => {
    try {
        const users = await db.sequelize.query(`
            SELECT u.id, u."username", u."firstName", u."lastName", u."email",
                   u."roleId", u."isActive", u."createdAt",
                   u."twoFactorEnabled", u."failedLoginCount", u."lockedUntil",
                   (SELECT COUNT(*) FROM "AuditLogs" al WHERE al."userId" = u.id)::int AS "activityCount",
                   (SELECT MAX("createdAt") FROM "AuditLogs" al WHERE al."userId" = u.id) AS "lastActivity"
            FROM "Users" u ORDER BY u."createdAt" DESC
        `, { type: QueryTypes.SELECT });
        res.json({ users: users.map(u => ({ ...u, roleLabel: ROLE_LABELS[u.roleId] || 'Unknown' })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updateUser = async (req, res) => {
    const { id } = req.params;
    if (parseInt(id, 10) === req.user?.id) return res.status(400).json({ error: 'Cannot modify your own account here.' });
    const { roleId, isActive } = req.body;
    try {
        const sets = [], rep = { id: parseInt(id, 10) };
        if (roleId   !== undefined) { sets.push(`"roleId" = :roleId`);     rep.roleId   = parseInt(roleId, 10); }
        if (isActive !== undefined) { sets.push(`"isActive" = :isActive`); rep.isActive = !!isActive; }
        if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
        await db.sequelize.query(`UPDATE "Users" SET ${sets.join(',')} WHERE id = :id`, { replacements: rep });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.adminResetPassword = async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (parseInt(id, 10) === req.user?.id) return res.status(400).json({ error: 'Use your profile page to change your own password.' });
    try {
        const hash = await bcrypt.hash(newPassword, 12);
        await db.sequelize.query(`UPDATE "Users" SET "passwordHash" = :hash WHERE id = :id`, { replacements: { hash, id: parseInt(id,10) } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
// ── FK pairs for orphan detection [childTable, childCol, parentTable, parentCol] ──
const FK_PAIRS = [
    ['RXRecords',           'patientId',                  'Patients',                 'id'],
    ['RXWorkflowTrackings', 'rxRecordId',                 'RXRecords',                'id'],
    ['Medications',         'rxRecordId',                 'RXRecords',                'id'],
    ['RXHistories',         'rxRecordId',                 'RXRecords',                'id'],
    ['PatientNotes',        'patientId',                  'Patients',                 'id'],
    ['PatientServiceDateHistories', 'patientId',          'Patients',                 'id'],
    ['PatientServiceDateHistories', 'changedByUserId',    'Users',                    'id'],
    ['PatientLocks',        'patientId',                  'Patients',                 'id'],
    ['RXRecords',           'pharmacyId',                 'Pharmacies',               'id'],
    ['RXRecords',           'pharmacyTransportCompanyId', 'PharmacyTransportCompanies','id'],
    ['RXRecords',           'patientTransportCompanyId',  'PatientTransportCompanies','id'],
    ['Patients',            'clinicId',                   'Clinics',                  'id'],
];

// GET /api/admin/orphans — find FK references with no matching parent
exports.getOrphans = async (req, res) => {
    try {
        const results = [];
        for (const [childTbl, childCol, parentTbl, parentCol] of FK_PAIRS) {
            const [rows] = await db.sequelize.query(
                `SELECT COUNT(*) AS cnt FROM "${childTbl}" c
                 WHERE c."${childCol}" IS NOT NULL
                   AND NOT EXISTS (
                       SELECT 1 FROM "${parentTbl}" p WHERE p."${parentCol}" = c."${childCol}"
                   )`,
                { type: QueryTypes.SELECT }
            );
            const count = parseInt(rows?.cnt ?? 0, 10);
            results.push({
                childTable: childTbl, childCol, parentTable: parentTbl, parentCol,
                orphanCount: count, clean: count === 0
            });
        }
        const totalOrphans = results.reduce((s, r) => s + r.orphanCount, 0);
        res.json({ results, totalOrphans, clean: totalOrphans === 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// DELETE /api/admin/orphans — clean up orphaned rows for a specific FK pair
exports.cleanOrphans = async (req, res) => {
    const { childTable, childCol, parentTable, parentCol } = req.body;
    // Validate against known pairs
    const valid = FK_PAIRS.find(([ct, cc, pt, pc]) =>
        ct === childTable && cc === childCol && pt === parentTable && pc === parentCol);
    if (!valid) return res.status(400).json({ error: 'Unknown FK pair.' });

    // The WHERE clause that identifies orphaned rows in childTable
    const orphanWhere = `"${childCol}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${parentTable}" p WHERE p."${parentCol}" = "${childTable}"."${childCol}")`;

    const t = await db.sequelize.transaction();
    try {
        // Before deleting orphaned rows, cascade-delete their own children
        // (e.g. before deleting orphaned RXRecords, delete their RXHistories/Medications/RXWorkflowTrackings)
        const grandChildren = FK_CHILDREN[childTable] || [];
        for (const gc of grandChildren) {
            if (gc.action === 'cascade' && !gc.via) {
                await db.sequelize.query(
                    `DELETE FROM "${gc.table}" WHERE "${gc.col}" IN (SELECT id FROM "${childTable}" WHERE ${orphanWhere})`,
                    { transaction: t }
                );
            }
        }

        // Now delete the orphaned rows themselves
        const [deleted] = await db.sequelize.query(
            `DELETE FROM "${childTable}" WHERE ${orphanWhere} RETURNING id`,
            { type: QueryTypes.SELECT, transaction: t }
        );
        await t.commit();
        const count = Array.isArray(deleted) ? deleted.length : 0;
        res.json({ success: true, deleted: count });
    } catch (err) {
        await t.rollback();
        res.status(500).json({ error: err.message });
    }
};

// GET /api/admin/duplicates — find duplicate Patients by name or phone
exports.getDuplicates = async (req, res) => {
    try {
        // Duplicates by full name
        const byName = await db.sequelize.query(`
            SELECT
                TRIM(LOWER("firstName")) || ' ' || TRIM(LOWER("lastName")) AS match_key,
                COUNT(*) AS cnt,
                JSON_AGG(JSON_BUILD_OBJECT(
                    'id', id,
                    'firstName', "firstName",
                    'lastName', "lastName",
                    'dob', "dob",
                    'phone', "phone",
                    'createdAt', "createdAt",
                    'isActive', "isActive"
                ) ORDER BY id) AS records
            FROM "Patients"
            GROUP BY TRIM(LOWER("firstName")), TRIM(LOWER("lastName"))
            HAVING COUNT(*) > 1
            ORDER BY cnt DESC
        `, { type: QueryTypes.SELECT });

        // Duplicates by phone
        const byPhone = await db.sequelize.query(`
            SELECT
                "phone" AS match_key,
                COUNT(*) AS cnt,
                JSON_AGG(JSON_BUILD_OBJECT(
                    'id', id,
                    'firstName', "firstName",
                    'lastName', "lastName",
                    'dob', "dob",
                    'phone', "phone",
                    'createdAt', "createdAt"
                ) ORDER BY id) AS records
            FROM "Patients"
            WHERE "phone" IS NOT NULL AND TRIM("phone") != ''
            GROUP BY "phone"
            HAVING COUNT(*) > 1
            ORDER BY cnt DESC
        `, { type: QueryTypes.SELECT });

        res.json({
            byName:  byName.map(r => ({ ...r, cnt: parseInt(r.cnt, 10) })),
            byPhone: byPhone.map(r => ({ ...r, cnt: parseInt(r.cnt, 10) })),
            totalNameGroups:  byName.length,
            totalPhoneGroups: byPhone.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// GET /api/admin/audit-logs — paginated, filterable audit log viewer
exports.getAuditLogs = async (req, res) => {
    const page     = Math.max(1, parseInt(req.query.page  || '1',   10));
    const pageSize = Math.min(500, Math.max(10, parseInt(req.query.size || '50', 10)));
    const offset   = (page - 1) * pageSize;
    const action   = req.query.action   || '';
    const userId   = req.query.userId   || '';
    const module_  = req.query.module   || '';
    const search   = req.query.search   || '';
    const dateFrom = req.query.dateFrom || '';
    const dateTo   = req.query.dateTo   || '';

    const where = ['1=1'];
    const replacements = { limit: pageSize, offset };

    if (action)   { where.push(`al."action" ILIKE :action`);         replacements.action = `%${action}%`; }
    if (userId)   { where.push(`al."userId" = :userId`);              replacements.userId = parseInt(userId, 10); }
    if (module_)  { where.push(`al."module" ILIKE :module_`);         replacements.module_ = `%${module_}%`; }
    if (search)   { where.push(`(al."previousValue"::text ILIKE :search OR al."newValue"::text ILIKE :search)`); replacements.search = `%${search}%`; }
    if (dateFrom) { where.push(`al."date" >= :dateFrom`);             replacements.dateFrom = dateFrom; }
    if (dateTo)   { where.push(`al."date" <= :dateTo`);               replacements.dateTo = dateTo; }

    const whereClause = where.join(' AND ');
    try {
        const [countRow] = await db.sequelize.query(
            `SELECT COUNT(*) AS total FROM "AuditLogs" al WHERE ${whereClause}`,
            { type: QueryTypes.SELECT, replacements }
        );
        const total = parseInt(countRow.total, 10);

        const rows = await db.sequelize.query(`
            SELECT al.id, al."action", al."module", al."recordId", al."date", al."time",
                   al."ipAddress", al."previousValue", al."newValue", al."createdAt", al."userId",
                   u."firstName", u."lastName", u."username"
            FROM "AuditLogs" al
            LEFT JOIN "Users" u ON u.id = al."userId"
            WHERE ${whereClause}
            ORDER BY al."createdAt" DESC
            LIMIT :limit OFFSET :offset
        `, { type: QueryTypes.SELECT, replacements });

        // Distinct action types for filter dropdown
        const actions = await db.sequelize.query(
            `SELECT DISTINCT "action" FROM "AuditLogs" WHERE "action" IS NOT NULL ORDER BY "action"`,
            { type: QueryTypes.SELECT }
        );

        res.json({ rows, total, page, pageSize, pages: Math.ceil(total / pageSize), actions: actions.map(a => a.action) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
// GET /api/admin/table-data/:tableName — fetch all rows from a table
exports.getTableData = async (req, res) => {
    const { tableName } = req.params;
    const validKeys = new Set(TABLE_META.map(t => t.key));
    if (!validKeys.has(tableName)) {
        return res.status(400).json({ error: `Unknown table: ${tableName}` });
    }
    try {
        const rows = await db.sequelize.query(
            `SELECT * FROM "${tableName}" ORDER BY id DESC`,
            { type: QueryTypes.SELECT }
        );
        // Get column names from first row, or from information_schema if empty
        let columns = [];
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        } else {
            const colRows = await db.sequelize.query(
                `SELECT column_name FROM information_schema.columns WHERE table_name = :tbl ORDER BY ordinal_position`,
                { type: QueryTypes.SELECT, replacements: { tbl: tableName } }
            );
            columns = colRows.map(r => r.column_name);
        }
        const meta = TABLE_META.find(t => t.key === tableName);
        res.json({ tableName, label: meta?.label || tableName, columns, rows, total: rows.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ── FK children map: parent table → child tables that reference it ─────────────
// action: 'cascade' = delete child rows, 'null' = SET col = NULL
// IMPORTANT: list grandchildren BEFORE their parents so the delete order is safe
const FK_CHILDREN = {
    Patients: [
        // Grandchildren of RXRecords must be cleaned BEFORE RXRecords is deleted
        { table: 'RXHistories',          col: 'rxRecordId',  action: 'cascade', via: 'RXRecords' },
        { table: 'RXWorkflowTrackings',  col: 'rxRecordId',  action: 'cascade', via: 'RXRecords' },
        { table: 'Medications',          col: 'rxRecordId',  action: 'cascade', via: 'RXRecords' },
        // Direct children of Patients
        { table: 'RXRecords',            col: 'patientId',   action: 'cascade' },
        { table: 'PatientNotes',         col: 'patientId',   action: 'cascade' },
        { table: 'PatientServiceDateHistories', col: 'patientId', action: 'cascade' },
        { table: 'PatientLocks',         col: 'patientId',   action: 'cascade' },
    ],
    RXRecords: [
        // Children of RXRecords — delete in safe order
        { table: 'RXHistories',          col: 'rxRecordId',  action: 'cascade' },
        { table: 'RXWorkflowTrackings',  col: 'rxRecordId',  action: 'cascade' },
        { table: 'Medications',          col: 'rxRecordId',  action: 'cascade' },
    ],
    Pharmacies: [
        { table: 'RXRecords',            col: 'pharmacyId',                 action: 'null' },
        { table: 'Patients',             col: 'pharmacyId',                 action: 'null' },
    ],
    PharmacyTransportCompanies: [
        { table: 'RXRecords',            col: 'pharmacyTransportCompanyId', action: 'null' },
        { table: 'Patients',             col: 'pharmacyTransportCompanyId', action: 'null' },
    ],
    PatientTransportCompanies: [
        { table: 'RXRecords',            col: 'patientTransportCompanyId',  action: 'null' },
        { table: 'Patients',             col: 'patientTransportCompanyId',  action: 'null' },
    ],
    Clinics: [
        { table: 'Patients',             col: 'clinicId',                   action: 'null' },
    ],
    WorkflowActions: [
        { table: 'RXWorkflowTrackings',  col: 'workflowActionId',           action: 'null' },
    ],
    Users: [
        // AuditLogs and RXHistories reference userId — SET NULL to allow user deletion
        { table: 'RXHistories',          col: 'userId',                     action: 'null' },
        { table: 'PatientServiceDateHistories', col: 'changedByUserId',     action: 'null' },
        { table: 'AuditLogs',            col: 'userId',                     action: 'null' },
    ],
};


// POST /api/admin/row-impact — returns count of related records for given IDs
exports.getRowImpact = async (req, res) => {
    const { tableName, ids } = req.body;
    const validKeys = new Set(TABLE_META.map(t => t.key));
    if (!validKeys.has(tableName)) return res.status(400).json({ error: `Unknown table: ${tableName}` });
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided.' });

    const children = FK_CHILDREN[tableName] || [];
    const impact = [];
    try {
        for (const child of children) {
            const idList = ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
            if (!idList.length) continue;
            const [row] = await db.sequelize.query(
                `SELECT COUNT(*) AS cnt FROM "${child.table}" WHERE "${child.col}" IN (:ids)`,
                { type: QueryTypes.SELECT, replacements: { ids: idList } }
            );
            const cnt = parseInt(row.cnt, 10);
            if (cnt > 0 || child.action === 'cascade') {
                impact.push({ table: child.table, col: child.col, count: cnt, action: child.action });
            }
        }
        res.json({ tableName, ids, impact, hasImpact: impact.some(i => i.count > 0) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// DELETE /api/admin/rows — delete specific rows by ID, with cascade/null handling
exports.deleteRows = async (req, res) => {
    const { tableName, ids } = req.body;
    const validKeys = new Set(TABLE_META.map(t => t.key));
    if (!validKeys.has(tableName)) return res.status(400).json({ error: `Unknown table: ${tableName}` });
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided.' });

    const idList = ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
    if (!idList.length) return res.status(400).json({ error: 'No valid IDs.' });

    const children = FK_CHILDREN[tableName] || [];
    const t = await db.sequelize.transaction();
    const results = { deleted: 0, cascaded: {}, nulled: {} };

    try {
        // Handle children first (list is ordered: grandchildren before direct children)
        for (const child of children) {
            if (child.action === 'cascade') {
                let sql;
                if (child.via) {
                    // Grandchild: child.col references child.via table, not the parent directly
                    // e.g. RXHistories.rxRecordId -> RXRecords (where patientId IN (:ids))
                    // Find the FK column that links child.via back to tableName
                    const viaChildren = FK_CHILDREN[tableName] || [];
                    const viaLink = viaChildren.find(c => c.table === child.via && !c.via);
                    if (viaLink) {
                        sql = `DELETE FROM "${child.table}" WHERE "${child.col}" IN (SELECT id FROM "${child.via}" WHERE "${viaLink.col}" IN (:ids))`;
                    } else {
                        // Fallback: skip (shouldn't happen with correct FK_CHILDREN config)
                        continue;
                    }
                } else {
                    sql = `DELETE FROM "${child.table}" WHERE "${child.col}" IN (:ids)`;
                }
                const [rows] = await db.sequelize.query(
                    sql + ' RETURNING id',
                    { type: QueryTypes.SELECT, replacements: { ids: idList }, transaction: t }
                );
                results.cascaded[child.table] = Array.isArray(rows) ? rows.length : 0;
            } else if (child.action === 'null') {
                await db.sequelize.query(
                    `UPDATE "${child.table}" SET "${child.col}" = NULL WHERE "${child.col}" IN (:ids)`,
                    { replacements: { ids: idList }, transaction: t }
                );
                results.nulled[child.table] = child.col;
            }
        }

        // Delete main rows
        const [deleted] = await db.sequelize.query(
            `DELETE FROM "${tableName}" WHERE id IN (:ids) RETURNING id`,
            { type: QueryTypes.SELECT, replacements: { ids: idList }, transaction: t }
        );
        results.deleted = Array.isArray(deleted) ? deleted.length : 0;

        await t.commit();

        // Audit log
        try {
            await db.AuditLog.create({
                userId: req.user?.id || null,
                action: 'BACKOFFICE_ROW_DELETE',
                entity: tableName,
                entityId: null,
                details: `Deleted ${results.deleted} rows [${idList.join(',')}]. Cascaded: ${JSON.stringify(results.cascaded)}`
            });
        } catch(e) { /* non-fatal */ }

        res.json({ success: true, results });
    } catch (err) {
        await t.rollback();
        res.status(500).json({ error: err.message });
    }
};

// --------------------------------------------------------------------------
// ERROR LOG MANAGER
// --------------------------------------------------------------------------
exports.getErrorLogs = async (req, res) => {
    const page     = Math.max(1, parseInt(req.query.page || '1', 10));
    const rawSize  = parseInt(req.query.size || '50', 10);
    // Allow large exports (size >= 9999 is the export signal) — cap at 10000
    const pageSize = rawSize >= 9999 ? Math.min(rawSize, 10000) : Math.min(200, Math.max(10, rawSize));
    const offset   = (page - 1) * pageSize;
    const severity = req.query.severity || '';
    const source   = req.query.source   || '';
    const resolved = req.query.resolved;
    const search   = req.query.search   || '';
    const dateFrom = req.query.dateFrom || '';
    const dateTo   = req.query.dateTo   || '';

    const where = ['1=1'];
    const rep   = { limit: pageSize, offset };

    if (severity) { where.push(`el."severity" = :severity`); rep.severity = severity; }
    if (source)   { where.push(`el."source" = :source`);     rep.source   = source; }
    if (resolved !== undefined && resolved !== '') { where.push(`el."resolved" = :resolved`); rep.resolved = resolved === 'true'; }
    if (search)   { where.push(`(el."message" ILIKE :search OR el."url" ILIKE :search OR el."stack" ILIKE :search)`); rep.search = '%' + search + '%'; }
    if (dateFrom) { where.push(`el."createdAt" >= :dateFrom`); rep.dateFrom = dateFrom; }
    if (dateTo)   { where.push(`el."createdAt" <= :dateTo`);   rep.dateTo   = dateTo + ' 23:59:59'; }

    const wc = where.join(' AND ');
    try {
        const [countRow] = await db.sequelize.query(
            `SELECT COUNT(*) AS total FROM "ErrorLogs" el WHERE ${wc}`,
            { type: QueryTypes.SELECT, replacements: rep }
        );
        const total = parseInt(countRow.total, 10);

        const rows = await db.sequelize.query(`
            SELECT el.id, el."source", el."severity", el."message", el."stack",
                   el."url", el."userAgent", el."ipAddress", el."resolved", el."createdAt",
                   el."userId", u."username", u."firstName", u."lastName"
            FROM "ErrorLogs" el
            LEFT JOIN "Users" u ON u.id = el."userId"
            WHERE ${wc}
            ORDER BY el."createdAt" DESC
            LIMIT :limit OFFSET :offset
        `, { type: QueryTypes.SELECT, replacements: rep });

        // Summary stats
        const stats = await db.sequelize.query(`
            SELECT
                COUNT(*) FILTER (WHERE severity = 'error')   AS errors,
                COUNT(*) FILTER (WHERE severity = 'warning') AS warnings,
                COUNT(*) FILTER (WHERE severity = 'info')    AS infos,
                COUNT(*) FILTER (WHERE resolved = true)      AS resolved,
                COUNT(*) FILTER (WHERE resolved = false)     AS unresolved,
                COUNT(*) FILTER (WHERE source = 'frontend')  AS frontend,
                COUNT(*) FILTER (WHERE source = 'backend')   AS backend
            FROM "ErrorLogs"
        `, { type: QueryTypes.SELECT });

        res.json({ rows, total, page, pageSize, pages: Math.ceil(total / pageSize), stats: stats[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.resolveErrorLogs = async (req, res) => {
    const { ids } = req.body; // array or 'all'
    try {
        if (ids === 'all') {
            await db.sequelize.query(`UPDATE "ErrorLogs" SET "resolved" = true`, { type: QueryTypes.UPDATE });
            res.json({ success: true, message: 'All marked resolved.' });
        } else if (Array.isArray(ids) && ids.length) {
            await db.sequelize.query(
                `UPDATE "ErrorLogs" SET "resolved" = true WHERE id = ANY(:ids)`,
                { replacements: { ids }, type: QueryTypes.UPDATE }
            );
            res.json({ success: true, message: `${ids.length} error(s) marked resolved.` });
        } else {
            res.status(400).json({ error: 'No IDs provided.' });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.purgeErrorLogs = async (req, res) => {
    const { mode, olderThanDays, severity, source, resolvedOnly, ids } = req.body;
    try {
        let deleted = 0;
        if (mode === 'ids' && Array.isArray(ids) && ids.length) {
            const [r] = await db.sequelize.query(
                `DELETE FROM "ErrorLogs" WHERE id = ANY(:ids) RETURNING id`,
                { replacements: { ids }, type: QueryTypes.SELECT }
            );
            deleted = Array.isArray(r) ? r.length : (r?.length || ids.length);
        } else if (mode === 'age' && olderThanDays > 0) {
            const where = [`"createdAt" < NOW() - INTERVAL '${parseInt(olderThanDays,10)} days'`];
            if (severity)     where.push(`"severity" = '${severity.replace(/'/g,"''")}'`);
            if (source)       where.push(`"source" = '${source.replace(/'/g,"''")}'`);
            if (resolvedOnly) where.push(`"resolved" = true`);
            const [r] = await db.sequelize.query(
                `DELETE FROM "ErrorLogs" WHERE ${where.join(' AND ')} RETURNING id`,
                { type: QueryTypes.SELECT }
            );
            deleted = Array.isArray(r) ? r.length : 0;
        } else if (mode === 'filter') {
            const where = ['1=1'];
            const rep = {};
            if (severity)       { where.push(`"severity" = :severity`);   rep.severity = severity; }
            if (source)         { where.push(`"source" = :source`);       rep.source   = source; }
            if (resolvedOnly)   { where.push(`"resolved" = true`); }
            const [r] = await db.sequelize.query(
                `DELETE FROM "ErrorLogs" WHERE ${where.join(' AND ')} RETURNING id`,
                { replacements: rep, type: QueryTypes.SELECT }
            );
            deleted = Array.isArray(r) ? r.length : 0;
        } else if (mode === 'all') {
            const [r] = await db.sequelize.query(`DELETE FROM "ErrorLogs" RETURNING id`, { type: QueryTypes.SELECT });
            deleted = Array.isArray(r) ? r.length : 0;
        } else {
            return res.status(400).json({ error: 'Invalid purge mode.' });
        }
        res.json({ success: true, deleted });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
