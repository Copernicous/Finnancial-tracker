/**
 * rbac.js — Role-Based Access Control middleware.
 *
 * Permissions are stored in the Roles table (Roles.permissions JSONB).
 * There are NO hardcoded per-role defaults in code — everything lives in the DB.
 * The startup migration in app.js seeds the initial defaults for the 4 built-in roles.
 *
 * Permission object shape per module:
 *   { visible, canAdd, canEdit, canDelete, canExport, canUndo, canWarehouse, canOverrideExpired }
 *
 * canAdd  → can CREATE new records (POST)
 * canEdit → can MODIFY existing records (PUT/PATCH)
 * These are intentionally separate — a user can add without being able to edit.
 */

// ─── Hardcoded seed defaults (used ONLY during startup migration to seed DB) ──
const BUILT_IN_DEFAULTS = {
    Administrator: () => {
        const full = { visible: true, canAdd: true, canEdit: true, canDelete: true, canExport: true, canUndo: false, canOverrideExpired: false };
        return {
            dashboard:          { visible: true,  canAdd: false, canEdit: false, canDelete: false, canExport: true,  canUndo: false },
            patients:           { ...full, canOverrideExpired: true },
            rx_records:         { ...full, canUndo: true, canWarehouse: true, canOverrideExpired: true },
            reports:            { visible: true,  canAdd: false, canEdit: false, canDelete: false, canExport: true,  canUndo: false },
            audit_log:          { visible: true,  canAdd: false, canEdit: false, canDelete: false, canExport: false, canUndo: false },
            import:             { ...full },
            pharmacies:         { ...full },
            patient_transport:  { ...full },
            pharmacy_transport: { ...full },
            workflow_actions:   { ...full },
            clinics:            { ...full },
            medication_catalog: { ...full },
            patient_notes:      { visible: true,  canAdd: true,  canEdit: false, canDelete: true,  canExport: false, canUndo: false },
            users:              { ...full },
            backups:            { ...full },
            system_settings:    { ...full },
            active_users:       { visible: true,  canAdd: false, canEdit: false, canDelete: false, canExport: false, canUndo: false }
        };
    },
    Supervisor: () => {
        const full = { visible: true, canAdd: true, canEdit: true, canDelete: true,  canExport: true,  canUndo: false, canOverrideExpired: false };
        const add  = { visible: true, canAdd: true, canEdit: true, canDelete: false, canExport: true,  canUndo: false, canOverrideExpired: false };
        const view = { visible: true, canAdd: false, canEdit: false, canDelete: false, canExport: true, canUndo: false, canOverrideExpired: false };
        const hide = { visible: false, canAdd: false, canEdit: false, canDelete: false, canExport: false, canUndo: false, canOverrideExpired: false };
        return {
            dashboard:          { visible: true,  canAdd: false, canEdit: false, canDelete: false, canExport: true,  canUndo: false },
            patients:           { ...full },
            rx_records:         { ...full, canUndo: true, canWarehouse: true },
            reports:            { ...view },
            audit_log:          { visible: true,  canAdd: false, canEdit: false, canDelete: false, canExport: false, canUndo: false },
            import:             { ...add },
            pharmacies:         { ...full },
            patient_transport:  { ...full },
            pharmacy_transport: { ...full },
            workflow_actions:   { ...add },
            clinics:            { ...full },
            medication_catalog: { ...full },
            patient_notes:      { visible: true,  canAdd: true,  canEdit: false, canDelete: true,  canExport: false, canUndo: false },
            users:              { ...hide },
            backups:            { ...hide },
            system_settings:    { ...hide },
            active_users:       { visible: true,  canAdd: false, canEdit: false, canDelete: false, canExport: false, canUndo: false }
        };
    },
    Operator: () => {
        const addOnly = { visible: true, canAdd: true,  canEdit: false, canDelete: false, canExport: true,  canUndo: false, canOverrideExpired: false };
        const view    = { visible: true, canAdd: false, canEdit: false, canDelete: false, canExport: true,  canUndo: false, canOverrideExpired: false };
        const hide    = { visible: false, canAdd: false, canEdit: false, canDelete: false, canExport: false, canUndo: false, canOverrideExpired: false };
        return {
            dashboard:          { visible: true,  canAdd: false, canEdit: false, canDelete: false, canExport: true,  canUndo: false },
            patients:           { ...addOnly },
            rx_records:         { ...addOnly, canUndo: false, canWarehouse: false },
            reports:            { ...view },
            audit_log:          { ...hide },
            import:             { ...hide },
            pharmacies:         { ...view },
            patient_transport:  { ...view },
            pharmacy_transport: { ...view },
            workflow_actions:   { ...hide },
            clinics:            { ...view },
            medication_catalog: { ...view },
            patient_notes:      { visible: true,  canAdd: true,  canEdit: false, canDelete: false, canExport: false, canUndo: false },
            users:              { ...hide },
            backups:            { ...hide },
            system_settings:    { ...hide },
            active_users:       { ...hide }
        };
    },
    'Read Only': () => {
        const view = { visible: true,  canAdd: false, canEdit: false, canDelete: false, canExport: true,  canUndo: false, canOverrideExpired: false };
        const hide = { visible: false, canAdd: false, canEdit: false, canDelete: false, canExport: false, canUndo: false, canOverrideExpired: false };
        return {
            dashboard:          { visible: true,  canAdd: false, canEdit: false, canDelete: false, canExport: true,  canUndo: false },
            patients:           { ...view },
            rx_records:         { ...view, canUndo: false, canWarehouse: false },
            reports:            { ...view },
            audit_log:          { ...hide },
            import:             { ...hide },
            pharmacies:         { ...hide },
            patient_transport:  { ...hide },
            pharmacy_transport: { ...hide },
            workflow_actions:   { ...view },
            clinics:            { ...hide },
            medication_catalog: { ...view },
            patient_notes:      { visible: true,  canAdd: false, canEdit: false, canDelete: false, canExport: false, canUndo: false },
            users:              { ...hide },
            backups:            { ...hide },
            system_settings:    { ...hide },
            active_users:       { ...hide }
        };
    }
};

exports.BUILT_IN_DEFAULTS = BUILT_IN_DEFAULTS;

function normalizePermission(rawPerm) {
    return rawPerm ? {
        visible:            !!rawPerm.visible,
        canAdd:             rawPerm.canAdd !== undefined ? !!rawPerm.canAdd : !!rawPerm.canEdit,
        canEdit:            !!rawPerm.canEdit,
        canDelete:          !!rawPerm.canDelete,
        canExport:          !!rawPerm.canExport,
        canUndo:            !!rawPerm.canUndo,
        canWarehouse:       rawPerm.canWarehouse !== undefined ? !!rawPerm.canWarehouse : !!rawPerm.canEdit,
        canOverrideExpired: !!rawPerm.canOverrideExpired
    } : {
        visible: false, canAdd: false, canEdit: false, canDelete: false,
        canExport: false, canUndo: false, canWarehouse: false, canOverrideExpired: false
    };
}

async function getRequestPermission(req, moduleKey) {
    if (!req.user) return normalizePermission(null);
    if (req.user.role === 'Administrator') {
        return {
            visible: true, canAdd: true, canEdit: true, canDelete: true,
            canExport: true, canUndo: true, canWarehouse: true, canOverrideExpired: true
        };
    }

    const db = require('../models');
    const user = await db.User.findByPk(req.user.id, {
        attributes: ['id'],
        include: [{ model: db.Role, attributes: ['name', 'permissions'] }]
    });

    if (!user || !user.Role) return normalizePermission(null);

    const roleName = user.Role.name;
    const rolePerms = user.Role.permissions ||
        (BUILT_IN_DEFAULTS[roleName] ? BUILT_IN_DEFAULTS[roleName]() : {});

    return normalizePermission(rolePerms[moduleKey]);
}

exports.getRequestPermission = getRequestPermission;

exports.userCanOverrideExpired = async (req, moduleKey) => {
    const perm = await getRequestPermission(req, moduleKey);
    return !!(perm.visible && perm.canOverrideExpired);
};

// ─── requireRole ─────────────────────────────────────────────────────────────
exports.requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Access denied: insufficient permissions' });
        }
        next();
    };
};

// ─── requireMaster ───────────────────────────────────────────────────────────
/**
 * Guards routes that require the MASTER admin flag (isMaster === true in JWT).
 *
 * The isMaster column in the Users table can ONLY be set via direct SQL on
 * PostgreSQL — no UI or API endpoint exposes this field. This ensures the
 * backoffice (Data Control Center) is never reachable through a role escalation
 * attack or a UI misconfiguration.
 *
 * Recovery SQL (run in psql or pgAdmin):
 *   UPDATE "Users" SET "isMaster" = true WHERE "username" = 'your_username';
 * Then log out and back in to get a new JWT with isMaster: true.
 */
exports.requireMaster = (req, res, next) => {
    // req.user is populated by auth.js (API) or webAuth.js (web pages)
    if (!req.user || req.user.isMaster !== true) {
        // For XHR / API requests return JSON; for page requests redirect
        const wantsJson = req.headers['accept'] && req.headers['accept'].includes('application/json');
        if (wantsJson || req.path.startsWith('/api/')) {
            return res.status(403).json({ error: 'Master admin access required. Contact your system administrator.' });
        }
        // Web page: redirect to dashboard with a clear message
        return res.redirect('/dashboard?error=backoffice_restricted');
    }
    next();
};

// ─── requirePermission ───────────────────────────────────────────────────────
/**
 * requiredAction:
 *   'read'   → visible check only
 *   'add'    → canAdd   (POST — create new records)
 *   'edit'   → canEdit  (PUT  — modify existing records)
 *   'write'  → canAdd OR canEdit (backward-compat alias)
 *   'delete' → canDelete
 *   'export' → canExport
 *   'undo'   → canUndo
 */
exports.requirePermission = (moduleKey, requiredAction) => {
    return async (req, res, next) => {
        try {
            if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

            // Dashboard always accessible
            if (moduleKey === 'dashboard') return next();

            const perm = await getRequestPermission(req, moduleKey);

            if (!perm.visible) {
                return res.status(403).json({ message: `Access denied: ${moduleKey} module is hidden.` });
            }

            if (requiredAction === 'read')      return next();
            if (requiredAction === 'add'       && !perm.canAdd)       return res.status(403).json({ message: `Access denied: you cannot add records to ${moduleKey}.` });
            if (requiredAction === 'edit'      && !perm.canEdit)      return res.status(403).json({ message: `Access denied: you cannot edit ${moduleKey}.` });
            if (requiredAction === 'write'     && !perm.canAdd && !perm.canEdit) return res.status(403).json({ message: `Access denied: you cannot write to ${moduleKey}.` });
            if (requiredAction === 'writeOrOverrideExpired' && !perm.canAdd && !perm.canEdit && !perm.canOverrideExpired) return res.status(403).json({ message: `Access denied: you cannot write to ${moduleKey} or override expired locks.` });
            if (requiredAction === 'delete'    && !perm.canDelete)    return res.status(403).json({ message: `Access denied: you cannot delete from ${moduleKey}.` });
            if (requiredAction === 'export'    && !perm.canExport)    return res.status(403).json({ message: `Access denied: you cannot export ${moduleKey}.` });
            if (requiredAction === 'undo'      && !perm.canUndo)      return res.status(403).json({ message: `Access denied: you cannot undo workflow steps.` });
            if (requiredAction === 'warehouse' && !perm.canWarehouse) return res.status(403).json({ message: `Access denied: you cannot return RX records to warehouse.` });
            if (requiredAction === 'overrideExpired' && !perm.canOverrideExpired) return res.status(403).json({ message: `Access denied: you cannot override expired 90-day locks.` });

            next();
        } catch (e) {
            console.error('[rbac] error:', e.message);
            res.status(500).json({ error: e.message });
        }
    };
};
