const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const auditLogger = require('../middleware/auditLogger').auditLog;
const db = require('../models');
const backupService = require('../services/backupService');
const path = require('path');
const fs   = require('fs');
const multer = require('multer');
const errorLogController = require('../controllers/errorLogController');
const sessionTracker = require('../services/sessionTracker');
const { getWritableRoot } = require('../utils/runtimePaths');

const pharmacyController = require('../controllers/pharmacyController');
const patientTransportController = require('../controllers/patientTransportController');
const pharmacyTransportController = require('../controllers/pharmacyTransportController');
const userController = require('../controllers/userController');
const workflowActionController = require('../controllers/workflowActionController');
const patientController = require('../controllers/patientController');
const rxController = require('../controllers/rxController');
const dashboardController = require('../controllers/dashboardController');
const reportController = require('../controllers/reportController');
const auditLogController = require('../controllers/auditLogController');
const userActivityLogController = require('../controllers/userActivityLogController');
const clinicController = require('../controllers/clinicController');
const patientNoteController = require('../controllers/patientNoteController');
const searchController = require('../controllers/searchController');
const settingsController = require('../controllers/settingsController');
const apiKeyController = require('../controllers/apiKeyController');
const emailReportController  = require('../controllers/emailReportController');
const patientLockController  = require('../controllers/patientLockController');
const medicationCatalogController = require('../controllers/medicationCatalogController');
const adminController = require('../controllers/adminController');
const snapshotController = require('../controllers/snapshotController');
const roleController = require('../controllers/roleController');
const documentController = require('../controllers/documentController');
const { isServiceDateOverrideEnabled } = require('../utils/globalSettings');

// â”€â”€ Public routes (no auth required) â€” must be declared BEFORE router.use(auth) â”€â”€
router.get('/version', (req, res) => {
    // Bust require() cache so nodemon restarts always serve the current version.
    const pkgPath = require.resolve('../package.json');
    delete require.cache[pkgPath];
    const pkg = require('../package.json');
    res.json({
        version:   pkg.version,
        name:      pkg.description || 'Home Accounting',
        node:      process.version,
        uptime:    Math.floor(process.uptime()),
        buildDate: new Date().toISOString().slice(0, 10)
    });
});

// All remaining API routes require authentication
router.use(auth);

// â”€â”€ Lookup endpoint â€” auth-only, NO visibility check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Used by forms (patient, RX records, etc.) to populate dropdowns.
// Decouples "can navigate to the management page" from "can read data for selects".
// Any authenticated user can call this â€” hiding a module in the nav/RBAC does NOT
// break form dropdowns that depend on that reference data.
const LOOKUP_MAP = {
    'pharmacies':         { model: db.Pharmacy,                  fields: ['id', 'name',        'address'],       where: { isActive: true } },
    'clinics':            { model: db.Clinic,                    fields: ['id', 'name',        'address'],       where: { isActive: true } },
    'patient-transport':  { model: db.PatientTransportCompany,   fields: ['id', 'companyName', 'contactPerson'], where: { isActive: true } },
    'pharmacy-transport': { model: db.PharmacyTransportCompany,  fields: ['id', 'companyName', 'contactPerson'], where: { isActive: true } },
    'workflow-actions':   { model: db.WorkflowAction,            fields: ['id', 'name', 'sequenceNumber', 'description'], where: { isActive: true }, order: [['sequenceNumber', 'ASC'], ['id', 'ASC']] },
    'medication-catalog': { model: db.MedicationCatalog,         fields: ['id', 'name', 'sortOrder', 'description'],      where: { isActive: true } },
};
router.get('/lookup/:module', async (req, res) => {
    try {
        const cfg = LOOKUP_MAP[req.params.module];
        if (!cfg) return res.status(404).json({ error: 'Unknown lookup module' });
        const order = cfg.order || [['id', 'ASC']];
        const rows = await cfg.model.findAll({ attributes: cfg.fields, where: cfg.where, order });
        res.json(rows);
    } catch (e) {
        console.error('[lookup]', e.message);
        res.status(500).json({ error: e.message });
    }
});

router.get('/service-date-override/status', (req, res) => {
    res.json({ enabled: isServiceDateOverrideEnabled() });
});
router.get('/session-config', settingsController.getSessionConfig);

// Helper mapping for paths to permissions key
const pathMap = {
    '/pharmacies': 'pharmacies',
    '/patient-transport': 'patient_transport',
    '/pharmacy-transport': 'pharmacy_transport',
    '/users': 'users',
    '/workflow-actions': 'workflow_actions',
    '/patients': 'patients',
    '/clinics': 'clinics',
    '/rx-records': 'rx_records',
    '/medication-catalog': 'medication_catalog'
};

const DOCUMENT_MAX_MB = parseInt(process.env.DOCUMENT_UPLOAD_MAX_MB || '25', 10);
const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: Math.max(DOCUMENT_MAX_MB, 1) * 1024 * 1024,
        files: 10
    },
    fileFilter: function(req, file, cb) {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const allowedExts = new Set([
            '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff',
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'
        ]);
        const allowedMime = (file.mimetype || '').startsWith('image/')
            || [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'text/csv',
                'text/plain'
            ].includes(file.mimetype);
        if (!allowedMime && !allowedExts.has(ext)) {
            return cb(new Error('Only pictures, PDFs, Office files, CSV, and text documents are accepted.'));
        }
        cb(null, true);
    }
}).array('files', 10);

function handleDocumentUpload(req, res, next) {
    documentUpload(req, res, function(err) {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}

// Helper function to generate CRUD routes
// POST (create) uses 'add', PUT (update) uses 'edit' â€” intentionally separate
const generateCRUDRoutes = (path, controller, moduleName) => {
    const key = pathMap[path] || moduleName.toLowerCase().replace(/ /g, '_');

    router.get(path,           rbac.requirePermission(key, 'read'), controller.getAll);
    router.get(`${path}/:id`,  rbac.requirePermission(key, 'read'), controller.getOne);
    router.post(path,          rbac.requirePermission(key, 'add'),  auditLogger(moduleName), controller.create);
    const updateAction = key === 'patients' ? 'writeOrOverrideExpired' : 'edit';
    router.put(`${path}/:id`,  rbac.requirePermission(key, updateAction), auditLogger(moduleName), controller.update);

    // Users and workflow-actions require Administrator role to delete
    const deleteGuard = (key === 'users' || key === 'workflow_actions')
        ? rbac.requireRole(['Administrator'])
        : rbac.requirePermission(key, 'delete');
    router.delete(`${path}/:id`, deleteGuard, auditLogger(moduleName), controller.delete);
};

// Pharmacy purge (admin only) â€” must be BEFORE generateCRUDRoutes to avoid :id conflict
router.delete('/pharmacies/purge', rbac.requireRole(['Administrator']), auditLogger('Pharmacies'), pharmacyController.purge);

generateCRUDRoutes('/pharmacies', pharmacyController, 'Pharmacies');
router.put('/pharmacies/:id/restore', rbac.requirePermission('pharmacies', 'edit'), auditLogger('Pharmacies'), pharmacyController.restore);

generateCRUDRoutes('/patient-transport', patientTransportController, 'Patient Transportation');
router.put('/patient-transport/:id/restore', rbac.requirePermission('patient_transport', 'edit'), auditLogger('Patient Transportation'), patientTransportController.restore);

generateCRUDRoutes('/pharmacy-transport', pharmacyTransportController, 'Pharmacy Transportation');
router.put('/pharmacy-transport/:id/restore', rbac.requirePermission('pharmacy_transport', 'edit'), auditLogger('Pharmacy Transportation'), pharmacyTransportController.restore);

generateCRUDRoutes('/users', userController, 'Users');
router.put('/users/:id/restore', rbac.requireRole(['Administrator']), auditLogger('Users'), userController.restore);

// â”€â”€â”€ Custom Roles Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// All role management requires Administrator role
router.get('/roles/permission-defaults',  rbac.requireRole(['Administrator']), roleController.getDefaults);
router.get('/roles',                      rbac.requireRole(['Administrator']), roleController.getAll);
router.get('/roles/:id',                  rbac.requireRole(['Administrator']), roleController.getOne);
router.post('/roles',                     rbac.requireRole(['Administrator']), roleController.create);
router.put('/roles/:id',                  rbac.requireRole(['Administrator']), roleController.update);
router.delete('/roles/:id',               rbac.requireRole(['Administrator']), roleController.delete);
router.post('/roles/:id/duplicate',       rbac.requireRole(['Administrator']), roleController.duplicate);

generateCRUDRoutes('/workflow-actions', workflowActionController, 'Workflow Actions');
router.put('/workflow-actions/:id/restore', rbac.requireRole(['Administrator']), auditLogger('Workflow Actions'), workflowActionController.restore);

// BUG-02 FIX: Static/named routes must come BEFORE generateCRUDRoutes which registers GET /patients/:id
// Otherwise Express matches 'check-duplicate' as :id and hits patientController.getOne instead.
router.get('/patients/check-duplicate', rbac.requirePermission('patients', 'read'), patientController.checkDuplicate);
router.get('/patients/:id/timeline',    rbac.requirePermission('patients', 'read'), patientController.getTimeline);
router.get('/patients/:id/service-date-history', rbac.requirePermission('patients', 'read'), patientController.getServiceDateHistory);
router.put('/patients/:id/restore',     rbac.requirePermission('patients', 'edit'), auditLogger('Patients'), patientController.restore);
generateCRUDRoutes('/patients', patientController, 'Patients');

// Patient Notes â€” permissions handled separately via patient_notes module
// POST: requires patient_notes.canAdd
// DELETE: controller enforces canDelete OR isAuthor logic
router.get('/patients/:id/notes',           rbac.requirePermission('patients',      'read'), patientNoteController.getNotes);
router.post('/patients/:id/notes',          rbac.requirePermission('patient_notes', 'add'),  patientNoteController.addNote);
router.delete('/patients/:id/notes/:noteId',rbac.requirePermission('patients',      'read'), patientNoteController.deleteNote);
router.get('/patients/:id/documents',       rbac.requirePermission('patients',      'read'), documentController.listPatientDocuments);
router.post('/patients/:id/documents',      rbac.requirePermission('patients',      'edit'), handleDocumentUpload, documentController.uploadPatientDocuments);

generateCRUDRoutes('/clinics', clinicController, 'Clinics');
router.put('/clinics/:id/restore', rbac.requirePermission('clinics', 'edit'), auditLogger('Clinics'), clinicController.restore);

// Medication Catalog (master list of medication names for RX form)
generateCRUDRoutes('/medication-catalog', medicationCatalogController, 'Medication Catalog');
router.put('/medication-catalog/:id/restore', rbac.requirePermission('medication_catalog', 'edit'), auditLogger('Medication Catalog'), medicationCatalogController.restore);

// RX Workflow must be registered BEFORE the generic rx-records CRUD to avoid :id matching "workflow"
router.post('/rx-records/return-to-warehouse', rbac.requirePermission('rx_records', 'warehouse'), auditLogger('RX Workflow'), rxController.returnToWarehouse);
router.post('/rx-records/undo-workflow',        rbac.requirePermission('rx_records', 'undo'), auditLogger('RX Workflow'), rxController.undoWorkflow);
router.post('/rx-records/workflow',             rbac.requirePermission('rx_records', 'add'),  auditLogger('RX Workflow'), rxController.updateWorkflow);
// FEAT-10: Bulk workflow step application
router.post('/rx-records/bulk-workflow',        rbac.requirePermission('rx_records', 'add'),  auditLogger('RX Workflow'), rxController.bulkWorkflow);
// FEAT-11: Workflow step date override (edit permission, or expired-lock override)
router.put('/rx-records/workflow-date',         rbac.requirePermission('rx_records', 'writeOrOverrideExpired'), auditLogger('RX Workflow'), rxController.updateWorkflowDate);
router.post('/rx-records/:id/reset-cycle',      rbac.requirePermission('rx_records', 'edit'), auditLogger('RX Records'), rxController.resetRxCycle);
router.post('/rx-records/:id/close-expired-workflow', rbac.requirePermission('rx_records', 'writeOrOverrideExpired'), auditLogger('RX Workflow'), rxController.closeExpiredWorkflow);
router.put('/rx-records/:id/restore',           rbac.requirePermission('rx_records', 'edit'), auditLogger('RX Records'), rxController.restore);
// RX History â€” must be before the generic CRUD block
router.get('/rx-records/:id/history', rbac.requirePermission('rx_records', 'read'), rxController.getHistory);
router.get('/rx-records/:id/documents', rbac.requirePermission('rx_records', 'read'), documentController.listRxDocuments);
router.post('/rx-records/:id/documents', rbac.requirePermission('rx_records', 'edit'), handleDocumentUpload, documentController.uploadRxDocuments);
generateCRUDRoutes('/rx-records', rxController, 'RX Records');

router.get('/documents/:id/download', documentController.downloadDocument);
router.delete('/documents/:id', documentController.deleteDocument);

// Dashboard Stats
router.get('/dashboard/stats', rbac.requirePermission('dashboard', 'read'), dashboardController.getStats);
router.get('/dashboard/active-patients', rbac.requirePermission('dashboard', 'read'), dashboardController.getActivePatients);
router.get('/dashboard/inactive-patients', rbac.requirePermission('dashboard', 'read'), dashboardController.getInactivePatients);
router.get('/dashboard/patients-no-rx', rbac.requirePermission('dashboard', 'read'), dashboardController.getPatientsWithNoRx);
router.get('/dashboard/pending-rx', rbac.requirePermission('dashboard', 'read'), dashboardController.getPendingRx);
router.get('/dashboard/total-rx', rbac.requirePermission('dashboard', 'read'), dashboardController.getTotalRx);
router.get('/dashboard/charts', rbac.requirePermission('dashboard', 'read'), dashboardController.getChartData);
router.get('/dashboard/rx-pipeline', rbac.requirePermission('dashboard', 'read'), dashboardController.getRxPipeline);
router.get('/dashboard/eligibility', rbac.requirePermission('dashboard', 'read'), dashboardController.getEligibilityStats);
router.get('/dashboard/eligibility-drilldown/:filter', rbac.requirePermission('dashboard', 'read'), dashboardController.getEligibilityDrilldown);


// Reports
router.get('/reports/patients', rbac.requirePermission('reports', 'read'), reportController.getPatientReport);
router.get('/reports/rx-receipts', rbac.requirePermission('reports', 'read'), reportController.getRXReceiptReport);
router.get('/reports/rx-actions', rbac.requirePermission('reports', 'read'), reportController.getRXActionReport);

// Audit Log â€” controlled by its own audit_log permission
router.get('/audit-logs',              rbac.requirePermission('audit_log', 'read'),  auditLogController.getAll);
router.get('/audit-logs/users',        rbac.requirePermission('audit_log', 'read'),  auditLogController.getUsers);
router.get('/audit-logs/modules',      rbac.requirePermission('audit_log', 'read'),  auditLogController.getModules);
router.get('/audit-logs/actions',      rbac.requirePermission('audit_log', 'read'),  auditLogController.getActions);
router.delete('/audit-logs/:id',       rbac.requireRole(['Administrator']),           auditLogController.deleteOne);
router.delete('/audit-logs',           rbac.requireRole(['Administrator']),           auditLogController.bulkDelete);
router.post('/audit-logs/rotate',      rbac.requireRole(['Administrator']),           auditLogController.rotate);
router.get('/user-activity-logs',       rbac.requirePermission('audit_log', 'read'),  userActivityLogController.getAll);
router.get('/user-activity-logs/users', rbac.requirePermission('audit_log', 'read'),  userActivityLogController.getUsers);
router.get('/user-activity-logs/roles', rbac.requirePermission('audit_log', 'read'),  userActivityLogController.getRoles);
router.get('/user-activity-logs/pages', rbac.requirePermission('audit_log', 'read'),  userActivityLogController.getPages);

// Logout tracking (user-triggered, auth required)
router.post('/auth/logout', auth, async (req, res) => {
    try {
        await db.AuditLog.create({
            userId: req.user ? req.user.id : null,
            date: new Date(),
            time: new Date().toTimeString().split(' ')[0],
            module: 'Authentication',
            action: 'Logout',
            ipAddress: req.ip
        });
    } catch (e) { /* non-fatal */ }
    // Remove from active sessions tracker immediately
    if (req.user) sessionTracker.remove(req.user.id);
    res.clearCookie('rxToken', { path: '/', sameSite: 'none', secure: true });  // clear FortiGate-compatible cookie auth
    res.status(200).json({ message: 'Logged out.' });
});

// â”€â”€ Active User Sessions (Who's Online) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/heartbeat â€” any authenticated user; updates their session entry
router.post('/heartbeat', auth, (req, res) => {
    const { currentPage, currentUrl } = req.body || {};
    // Capture real IP â€” x-forwarded-for first (FortiGate/proxy), then direct
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'â€”';
    sessionTracker.upsert(req.user.id, {
        username:    req.user.username,
        firstName:   req.user.firstName  || '',
        lastName:    req.user.lastName   || '',
        role:        req.user.role       || '',
        ip,
        currentPage: currentPage || 'Unknown',
        currentUrl:  currentUrl  || '/'
    });
    res.status(204).end();
});

// GET /api/active-sessions â€” role-gated: requires active_users visibility
router.get('/active-sessions', rbac.requirePermission('active_users', 'read'), (req, res) => {
    res.json(sessionTracker.getActive());
});


// Global Search
router.get('/search', searchController.search);

// ---- Backup Management (Admin only) ----
function adminOnly(req, res, next) {
    if (!req.user || req.user.role !== 'Administrator') return res.status(403).json({ error: 'Admins only' });
    next();
}

// ---- Back-Office / Data Control Center (MASTER admin only) ----
// masterOnly checks isMaster === true in the JWT.
// This flag can ONLY be set via direct SQL on PostgreSQL â€” never via UI or API.
// Recovery: UPDATE "Users" SET "isMaster" = true WHERE "username" = 'your_username';
function masterOnly(req, res, next) {
    if (!req.user || req.user.isMaster !== true) {
        return res.status(403).json({ error: 'Master admin access required. Contact your system administrator.' });
    }
    next();
}

// ---- DB Restore â€” multer upload ----
const UPLOAD_DIR = path.join(getWritableRoot(), 'backups', 'uploads');

const restoreUpload = multer({
    storage: multer.diskStorage({
        destination: function(req, file, cb) {
            if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
            cb(null, UPLOAD_DIR);
        },
        filename: function(req, file, cb) {
            cb(null, 'restore_upload_' + Date.now() + '.dump');
        }
    }),
    limits: { fileSize: 500 * 1024 * 1024 },  // 500 MB cap
    fileFilter: function(req, file, cb) {
        if (!file.originalname.endsWith('.dump')) {
            return cb(new Error('Only .dump files are accepted'));
        }
        cb(null, true);
    }
}).single('dumpFile');

router.post('/backups/restore', auth, adminOnly, function(req, res) {
    restoreUpload(req, res, async function(err) {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        try {
            const result = await backupService.restoreBackup(
                req.file.path,
                'GUI restore by ' + req.user.username
            );
            // Clean up temp upload file
            try { fs.unlinkSync(req.file.path); } catch {}
            res.json(result);
        } catch (e) {
            try { fs.unlinkSync(req.file.path); } catch {}
            res.status(500).json({ error: e.message });
        }
    });
});

router.get('/backups/status', adminOnly, (req, res) => {
    res.json(backupService.getStatus());
});

router.post('/backups/run', adminOnly, async (req, res) => {
    const result = await backupService.runBackup('Manual (' + req.user.username + ')');
    res.json(result);
});

router.post('/backups/schedule', adminOnly, (req, res) => {
    const { schedule } = req.body;
    if (!schedule || typeof schedule !== 'string') {
        return res.status(400).json({ error: 'schedule is required' });
    }
    const result = backupService.startScheduler(schedule.trim());
    if (!result || !result.ok) {
        return res.status(400).json({ error: result ? result.error : 'Failed to update schedule' });
    }
    res.json({ ok: true, schedule: result.schedule });
});

router.get('/backups/download/:filename', adminOnly, (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(backupService.getDbBackupDir(), filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
    res.download(filepath, filename);
});

// ---- Delete a DB backup (file + log entry) ----
router.delete('/backups/:filename', adminOnly, (req, res) => {
    try {
        const filename = path.basename(req.params.filename);
        backupService.deleteBackup(filename);
        res.status(204).end();
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ---- Backup folder configuration ----
router.get('/backups/config', adminOnly, (req, res) => {
    res.json({
        dbBackupDir:   backupService.getDbBackupDir(),
        siteBackupDir: backupService.getSiteBackupDir()
    });
});

router.post('/backups/config', adminOnly, (req, res) => {
    const { siteBackupDir, dbBackupDir } = req.body;
    const result = {};
    try {
        if (dbBackupDir !== undefined) {
            if (typeof dbBackupDir !== 'string' || dbBackupDir.trim().length < 3) {
                return res.status(400).json({ error: 'Invalid DB backup directory path' });
            }
            backupService.setDbBackupDir(dbBackupDir.trim());
            result.dbBackupDir = dbBackupDir.trim();
        }
        if (siteBackupDir !== undefined) {
            if (typeof siteBackupDir !== 'string' || siteBackupDir.trim().length < 3) {
                return res.status(400).json({ error: 'Invalid site backup directory path' });
            }
            backupService.setSiteBackupDir(siteBackupDir.trim());
            result.siteBackupDir = siteBackupDir.trim();
        }
        if (!dbBackupDir && !siteBackupDir) {
            return res.status(400).json({ error: 'No directory provided' });
        }
        res.json({ ok: true, ...result });
    } catch (e) {
        res.status(500).json({ error: 'Could not set directory: ' + e.message });
    }
});

// ---- Full Site Backup (Admin only) ----
router.get('/backups/site/status', adminOnly, (req, res) => {
    res.json(backupService.getSiteBackupStatus());
});

router.post('/backups/site/run', adminOnly, async (req, res) => {
    const result = await backupService.runFullSiteBackup('Manual (' + req.user.username + ')');
    res.json(result);
});

router.post('/backups/site/schedule', adminOnly, (req, res) => {
    const { schedule } = req.body;
    if (!schedule || typeof schedule !== 'string') {
        return res.status(400).json({ error: 'schedule is required' });
    }
    const result = backupService.startSiteBackupScheduler(schedule.trim());
    if (!result || !result.ok) {
        return res.status(400).json({ error: result ? result.error : 'Failed to update site schedule' });
    }
    res.json({ ok: true, schedule: result.schedule });
});

router.get('/backups/site/download/:filename', adminOnly, (req, res) => {
    const filename = path.basename(req.params.filename);
    // Site backups are stored outside the project in SITE_BACKUP_DIR
    const siteDir  = process.env.SITE_BACKUP_DIR || 'C:\\RX-SiteBackups';
    const filepath = path.join(siteDir, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
    res.download(filepath, filename);
});

// ---- Delete a Site backup (file + log entry) ----
router.delete('/backups/site/:filename', adminOnly, (req, res) => {
    try {
        const filename = path.basename(req.params.filename);
        backupService.deleteSiteBackup(filename);
        res.status(204).end();
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ---- Delete a DB backup history entry by ID (for failed entries with no file) ----
router.delete('/backups/history/:id', adminOnly, (req, res) => {
    try {
        backupService.deleteBackupHistoryEntry(req.params.id);
        res.status(204).end();
    } catch (e) {
        res.status(404).json({ error: e.message });
    }
});

// ---- Delete a Site backup history entry by ID ----
router.delete('/backups/site/history/:id', adminOnly, (req, res) => {
    try {
        backupService.deleteBackupSiteHistoryEntry(req.params.id);
        res.status(204).end();
    } catch (e) {
        res.status(404).json({ error: e.message });
    }
});


// ---- Error Boundary Logging ----
// Frontend can POST without being authenticated (token optional â€” anonymous errors still useful)
router.post('/errors', (req, res, next) => {
    // Try to decode token if present but don't block unauthenticated
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        try {
            const jwt = require('jsonwebtoken');
            req.user = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        } catch {}
    }
    next();
}, errorLogController.logFrontend);

router.get('/errors',                    auth, adminOnly, errorLogController.getAll);
router.patch('/errors/bulk-resolve',     auth, adminOnly, errorLogController.bulkResolve);
router.delete('/errors/bulk-delete',     auth, adminOnly, errorLogController.bulkDelete);
router.patch('/errors/:id/resolve',      auth, adminOnly, errorLogController.resolve);
router.delete('/errors',                 auth, adminOnly, errorLogController.clearResolved);

// ---- System Settings (Admin only) ----
router.get('/settings',              adminOnly, settingsController.getAll);
router.get('/settings/timezones',    adminOnly, settingsController.getTimezones);
router.get('/settings/email-status', adminOnly, settingsController.getEmailStatus);
router.get('/settings/api-routes',    adminOnly, settingsController.getApiRoutes);
router.put('/settings',              adminOnly, settingsController.update);

// ---- API Key Management (Admin only) ----
router.get('/api-keys',            adminOnly, apiKeyController.getAll);
router.post('/api-keys',           adminOnly, apiKeyController.generate);
router.patch('/api-keys/:id/toggle', adminOnly, apiKeyController.toggle);
router.delete('/api-keys/:id',     adminOnly, apiKeyController.remove);

// ---- Patient Soft Locks (multi-user awareness) ----
router.get('/patient-locks/:patientId',            rbac.requirePermission('patients', 'read'),  patientLockController.getViewers);
router.post('/patient-locks/:patientId/acquire',   rbac.requirePermission('patients', 'read'),  patientLockController.acquire);
router.post('/patient-locks/:patientId/heartbeat', rbac.requirePermission('patients', 'read'),  patientLockController.heartbeat);
router.delete('/patient-locks/:patientId/release', rbac.requirePermission('patients', 'read'),  patientLockController.release);
router.post('/patient-locks/:patientId/release',  rbac.requirePermission('patients', 'read'),  patientLockController.release);   // sendBeacon uses POST

// ---- Email Reports ----
// Test must be BEFORE the generic /email-report POST to avoid route conflict
router.post('/email-report/test', rbac.requirePermission('reports', 'read'), emailReportController.testConnection);
router.post('/email-report',      rbac.requirePermission('reports', 'read'), emailReportController.sendReport);

// ---- Back-Office Admin (MASTER admin only) ----
router.get('/admin/stats',              masterOnly, adminController.getStats);
router.get('/admin/schema',             masterOnly, adminController.getSchema);
router.get('/admin/table-data/:tableName', masterOnly, adminController.getTableData);
router.post('/admin/row-impact',        masterOnly, adminController.getRowImpact);
router.delete('/admin/rows',            masterOnly, adminController.deleteRows);
router.delete('/admin/purge',           masterOnly, adminController.purge);
router.get('/admin/orphans',            masterOnly, adminController.getOrphans);
router.delete('/admin/orphans',         masterOnly, adminController.cleanOrphans);
router.get('/admin/duplicates',         masterOnly, adminController.getDuplicates);
router.get('/admin/audit-logs',         masterOnly, adminController.getAuditLogs);
// System Settings
router.get('/admin/settings',           masterOnly, adminController.getSettings);
router.post('/admin/settings',          masterOnly, adminController.saveSettings);
// Backup Manager
router.post('/admin/backups',           masterOnly, adminController.createBackup);
router.get('/admin/backups',            masterOnly, adminController.listBackups);
router.delete('/admin/backups/:name',   masterOnly, adminController.deleteBackup);
router.get('/admin/backups/:name/:file',masterOnly, adminController.downloadBackupFile);
// System Health
router.get('/admin/health',             masterOnly, adminController.getHealth);
router.get('/admin/log-dashboard',      masterOnly, adminController.getLogDashboard);
// Lock Manager
router.get('/admin/locks',              masterOnly, adminController.getLocks);
router.delete('/admin/locks/:id',       masterOnly, adminController.releaseLock);
router.delete('/admin/locks',           masterOnly, adminController.releaseExpiredLocks);
router.get('/admin/service-date-overrides/patients', masterOnly, adminController.searchPatientsForServiceDateOverride);
router.post('/admin/patients/:id/service-date-override', masterOnly, adminController.overridePatientServiceDate);
// User Manager
router.get('/admin/users',              masterOnly, adminController.getUsers);
router.patch('/admin/users/:id',        masterOnly, adminController.updateUser);
router.post('/admin/users/:id/reset-password', masterOnly, adminController.adminResetPassword);
router.post('/admin/users/:id/unlock',          masterOnly, require('../controllers/twoFactorController').adminUnlock);
router.delete('/admin/users/:id/reset-2fa',    masterOnly, require('../controllers/twoFactorController').adminReset);


// Error Log Manager
router.get('/admin/error-logs',            masterOnly, adminController.getErrorLogs);
router.patch('/admin/error-logs/resolve',  masterOnly, adminController.resolveErrorLogs);
router.delete('/admin/error-logs',         masterOnly, adminController.purgeErrorLogs);

// Daily Metrics Snapshots
router.get('/admin/snapshots/export',      masterOnly, snapshotController.exportCSV);
router.get('/admin/snapshots',             masterOnly, snapshotController.getSnapshots);
router.post('/admin/snapshots/capture',    masterOnly, snapshotController.captureNow);
router.delete('/admin/snapshots/:date',    masterOnly, snapshotController.deleteSnapshot);


// â”€â”€ Git commit log (admin only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns last N commits with per-file stats for the changelog page
router.get('/git-log', auth, adminOnly, (req, res) => {
    const { execSync } = require('child_process');
    const IS_PKG = typeof process.pkg !== 'undefined';

    // git is only available in dev mode (not inside server.exe snapshot)
    if (IS_PKG) {
        return res.json({ available: false, commits: [], reason: 'Running as compiled exe â€” git log not available' });
    }

    try {
        const limit  = Math.min(parseInt(req.query.n || '30'), 100);
        const sep    = '----COMMIT----';
        const raw    = execSync(
            `git log --format="${sep}%H|%ad|%an|%s" --date=short --stat -${limit}`,
            { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 8000 }
        );

        const commits = [];
        const blocks  = raw.split(sep).filter(b => b.trim());

        for (const block of blocks) {
            const lines    = block.trim().split('\n');
            const header   = lines[0].split('|');
            if (header.length < 4) continue;
            const [hash, date, author, ...msgParts] = header;
            const message  = msgParts.join('|');

            // Parse file stats lines (e.g. "  foo/bar.js | 12 ++--")
            const files = [];
            for (let i = 1; i < lines.length; i++) {
                const m = lines[i].match(/^\s+(.+?)\s+\|\s+(\d+)\s*([\+\-]*)/);
                if (m) {
                    files.push({ file: m[1].trim(), changes: parseInt(m[2]), diff: m[3] });
                }
            }
            // Summary line (last stat line: "N files changed, X insertions, Y deletions")
            const summary = lines.find(l => l.includes('changed')) || '';

            commits.push({ hash: hash.trim().substring(0,7), fullHash: hash.trim(), date: date.trim(), author: author.trim(), message: message.trim(), files, summary: summary.trim() });
        }

        res.json({ available: true, commits });
    } catch (e) {
        res.json({ available: false, commits: [], reason: e.message });
    }
});

module.exports = router;

