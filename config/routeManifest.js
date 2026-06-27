/**
 * routeManifest.js
 *
 * Human-readable metadata for all API routes.
 * Keys are in the format "METHOD /path" (e.g. "GET /api/patients").
 * Parameters use Express format: :id, :noteId, etc.
 *
 * When a new route is added to apiRoutes.js, it will appear automatically
 * in the API Keys reference. Add an entry here to give it a description,
 * category, and permission label — or it will show with defaults.
 *
 * Categories: patients | rx | dashboard | reports | settings | auth | admin | email
 */

module.exports = {

    // ── Authentication ────────────────────────────────────────────────────
    'POST /api/auth/login':      { category:'auth',      desc:'Authenticate a user and receive a JWT token.',                              perm:'Public',             admin:false },
    'POST /api/auth/logout':     { category:'auth',      desc:'Log the current session out and record it in the audit log.',               perm:'Authenticated',      admin:false },

    // ── Import ────────────────────────────────────────────────────────────
    'POST /api/import/patients': { category:'admin',     desc:'Bulk import patients from a CSV file.',                                     perm:'Administrator',      admin:true  },

    // ── Patients ──────────────────────────────────────────────────────────
    'GET /api/patients':                            { category:'patients', desc:'List all active (non-deleted) patients.',                              perm:'patients: read',   admin:false },
    'GET /api/patients/:id':                        { category:'patients', desc:'Get a single patient by ID.',                                         perm:'patients: read',   admin:false },
    'GET /api/patients/check-duplicate':            { category:'patients', desc:'Check for a duplicate patient. Query: ?firstName=&lastName=&dob=',    perm:'patients: read',   admin:false, query:'?firstName=John&lastName=Doe&dob=1985-03-15' },
    'GET /api/patients/:id/timeline':               { category:'patients', desc:'Get the full RX delivery timeline for a patient.',                    perm:'patients: read',   admin:false },
    'GET /api/patients/:id/service-date-history':   { category:'patients', desc:'Get patient-level service date history.',                             perm:'patients: read',   admin:false },
    'GET /api/patients/:id/notes':                  { category:'patients', desc:'Get all clinical notes for a patient.',                               perm:'patients: read',   admin:false },
    'POST /api/patients':                           { category:'patients', desc:'Create a new patient record.',                                        perm:'patients: write',  admin:false },
    'POST /api/patients/:id/notes':                 { category:'patients', desc:'Add a clinical note to a patient.',                                   perm:'patients: write',  admin:false },
    'PUT /api/patients/:id':                        { category:'patients', desc:'Update an existing patient record.',                                  perm:'patients: write',  admin:false },
    'PUT /api/patients/:id/restore':                { category:'patients', desc:'Restore a soft-deleted patient.',                                     perm:'patients: write',  admin:false },
    'DELETE /api/patients/:id':                     { category:'patients', desc:'Soft-delete a patient (recoverable).',                                perm:'patients: delete', admin:false },
    'DELETE /api/patients/:id/notes/:noteId':       { category:'patients', desc:'Delete a specific clinical note.',                                    perm:'patients: write',  admin:false },

    // ── RX Records ────────────────────────────────────────────────────────
    'GET /api/rx-records':                          { category:'rx', desc:'List all RX records (non-deleted).',                                        perm:'rx_records: read',   admin:false },
    'GET /api/rx-records/:id':                      { category:'rx', desc:'Get a single RX record by ID.',                                            perm:'rx_records: read',   admin:false },
    'GET /api/rx-records/:id/history':              { category:'rx', desc:'Get the full change history for an RX record.',                            perm:'rx_records: read',   admin:false },
    'POST /api/rx-records':                         { category:'rx', desc:'Create a new RX record.',                                                  perm:'rx_records: write',  admin:false },
    'POST /api/rx-records/workflow':                { category:'rx', desc:'Mark a workflow step as complete. Body: { rxId, workflowActionId }',        perm:'rx_records: write',  admin:false, body:'{ "rxId": 1, "workflowActionId": 2 }' },
    'POST /api/rx-records/undo-workflow':           { category:'rx', desc:'Undo the last completed workflow step. Body: { rxId }',                    perm:'rx_records: undo',   admin:false, body:'{ "rxId": 1 }' },
    'PUT /api/rx-records/:id':                      { category:'rx', desc:'Update an RX record.',                                                     perm:'rx_records: write',  admin:false },
    'PUT /api/rx-records/:id/restore':              { category:'rx', desc:'Restore a soft-deleted RX record.',                                        perm:'rx_records: write',  admin:false },
    'DELETE /api/rx-records/:id':                   { category:'rx', desc:'Soft-delete an RX record.',                                               perm:'rx_records: delete', admin:false },

    // ── Dashboard ─────────────────────────────────────────────────────────
    'GET /api/dashboard/stats':            { category:'dashboard', desc:'Summary stats: active patients, pending RX, total RX. Supports ?from=YYYY-MM-DD&to=YYYY-MM-DD', perm:'dashboard: read', admin:false, query:'?from=2026-01-01&to=2026-12-31' },
    'GET /api/dashboard/charts':           { category:'dashboard', desc:'Chart data — patients per month + RX status breakdown.',  perm:'dashboard: read', admin:false },
    'GET /api/dashboard/active-patients':  { category:'dashboard', desc:'List of all currently active patients.',                 perm:'dashboard: read', admin:false },
    'GET /api/dashboard/inactive-patients':{ category:'dashboard', desc:'List of all inactive patients.',                         perm:'dashboard: read', admin:false },
    'GET /api/dashboard/pending-rx':       { category:'dashboard', desc:'List of RX records with an incomplete workflow.',        perm:'dashboard: read', admin:false },
    'GET /api/dashboard/total-rx':         { category:'dashboard', desc:'List of all RX records.',                               perm:'dashboard: read', admin:false },
    'GET /api/dashboard/rx-pipeline':      { category:'dashboard', desc:'Workflow pipeline breakdown by step.',                   perm:'dashboard: read', admin:false },

    // ── Reports ───────────────────────────────────────────────────────────
    'GET /api/reports/patients':    { category:'reports', desc:'Full patient report — names, DOB, status, clinic, RX counts.',          perm:'reports: read', admin:false },
    'GET /api/reports/rx-receipts': { category:'reports', desc:'RX receipt report — patient, pharmacy, RX number, status.',            perm:'reports: read', admin:false },
    'GET /api/reports/rx-actions':  { category:'reports', desc:'Workflow action report — patient, step, completion status and date.',   perm:'reports: read', admin:false },

    // ── Email Reports ─────────────────────────────────────────────────────
    'POST /api/email-report':       { category:'email', desc:'Send a report email. Body: { reportType, to, subject?, dateFrom?, dateTo? }. Types: summary, patients, rx-receipts, rx-actions', perm:'reports: read', admin:false, body:'{ "reportType": "summary", "to": "admin@example.com" }' },
    'POST /api/email-report/test':  { category:'email', desc:'Test the SMTP connection — verifies credentials without sending a real email.', perm:'reports: read', admin:false },

    // ── Reference / Settings data ─────────────────────────────────────────
    'GET /api/pharmacies':              { category:'settings', desc:'List all pharmacies.',                       perm:'pharmacies: read',          admin:false },
    'GET /api/pharmacies/:id':          { category:'settings', desc:'Get a pharmacy by ID.',                      perm:'pharmacies: read',          admin:false },
    'POST /api/pharmacies':             { category:'settings', desc:'Create a pharmacy.',                         perm:'pharmacies: write',         admin:false },
    'PUT /api/pharmacies/:id':          { category:'settings', desc:'Update a pharmacy.',                         perm:'pharmacies: write',         admin:false },
    'PUT /api/pharmacies/:id/restore':  { category:'settings', desc:'Restore a deleted pharmacy.',               perm:'pharmacies: write',         admin:false },
    'DELETE /api/pharmacies/:id':       { category:'settings', desc:'Delete a pharmacy.',                         perm:'pharmacies: delete',        admin:false },

    'GET /api/clinics':              { category:'settings', desc:'List all clinics.',                             perm:'clinics: read',             admin:false },
    'GET /api/clinics/:id':          { category:'settings', desc:'Get a clinic by ID.',                           perm:'clinics: read',             admin:false },
    'POST /api/clinics':             { category:'settings', desc:'Create a clinic.',                              perm:'clinics: write',            admin:false },
    'PUT /api/clinics/:id':          { category:'settings', desc:'Update a clinic.',                              perm:'clinics: write',            admin:false },
    'PUT /api/clinics/:id/restore':  { category:'settings', desc:'Restore a deleted clinic.',                    perm:'clinics: write',            admin:false },
    'DELETE /api/clinics/:id':       { category:'settings', desc:'Delete a clinic.',                              perm:'clinics: delete',           admin:false },

    'GET /api/patient-transport':             { category:'settings', desc:'List patient transport companies.',   perm:'patient_transport: read',   admin:false },
    'POST /api/patient-transport':            { category:'settings', desc:'Create a patient transport company.', perm:'patient_transport: write',  admin:false },
    'PUT /api/patient-transport/:id':         { category:'settings', desc:'Update a patient transport company.', perm:'patient_transport: write',  admin:false },
    'PUT /api/patient-transport/:id/restore': { category:'settings', desc:'Restore a deleted company.',          perm:'patient_transport: write',  admin:false },
    'DELETE /api/patient-transport/:id':      { category:'settings', desc:'Delete a patient transport company.', perm:'patient_transport: delete', admin:false },

    'GET /api/pharmacy-transport':             { category:'settings', desc:'List pharmacy transport companies.',  perm:'pharmacy_transport: read',  admin:false },
    'POST /api/pharmacy-transport':            { category:'settings', desc:'Create a pharmacy transport company.',perm:'pharmacy_transport: write', admin:false },
    'PUT /api/pharmacy-transport/:id':         { category:'settings', desc:'Update a pharmacy transport company.',perm:'pharmacy_transport: write', admin:false },
    'PUT /api/pharmacy-transport/:id/restore': { category:'settings', desc:'Restore a deleted company.',          perm:'pharmacy_transport: write', admin:false },
    'DELETE /api/pharmacy-transport/:id':      { category:'settings', desc:'Delete a pharmacy transport company.',perm:'pharmacy_transport: delete',admin:false },

    'GET /api/workflow-actions':             { category:'settings', desc:'List all workflow action steps.',       perm:'workflow_actions: read',    admin:false },
    'POST /api/workflow-actions':            { category:'settings', desc:'Create a workflow step.',              perm:'Administrator',             admin:true  },
    'PUT /api/workflow-actions/:id':         { category:'settings', desc:'Update a workflow step.',              perm:'Administrator',             admin:true  },
    'PUT /api/workflow-actions/:id/restore': { category:'settings', desc:'Restore a deleted workflow step.',     perm:'Administrator',             admin:true  },
    'DELETE /api/workflow-actions/:id':      { category:'settings', desc:'Delete a workflow step.',              perm:'Administrator',             admin:true  },

    'GET /api/search': { category:'settings', desc:'Global search across patients, RX records, and pharmacies. Query: ?q=term', perm:'Authenticated', admin:false, query:'?q=john' },

    // ── Admin — Users ─────────────────────────────────────────────────────
    'GET /api/users':             { category:'admin', desc:'List all users.',                 perm:'Administrator', admin:true },
    'GET /api/users/:id':         { category:'admin', desc:'Get a user by ID.',               perm:'Administrator', admin:true },
    'POST /api/users':            { category:'admin', desc:'Create a new user account.',      perm:'Administrator', admin:true },
    'PUT /api/users/:id':         { category:'admin', desc:'Update a user account.',          perm:'Administrator', admin:true },
    'PUT /api/users/:id/restore': { category:'admin', desc:'Restore a deleted user.',         perm:'Administrator', admin:true },
    'DELETE /api/users/:id':      { category:'admin', desc:'Delete a user account.',          perm:'Administrator', admin:true },

    // ── Admin — Audit Log ─────────────────────────────────────────────────
    'GET /api/audit-logs':           { category:'admin', desc:'List audit log entries with optional filters.',   perm:'audit_log: read', admin:false },
    'GET /api/audit-logs/users':     { category:'admin', desc:'List users that appear in the audit log.',       perm:'audit_log: read', admin:false },
    'GET /api/audit-logs/modules':   { category:'admin', desc:'List modules that appear in the audit log.',     perm:'audit_log: read', admin:false },
    'DELETE /api/audit-logs':        { category:'admin', desc:'Bulk delete audit log entries.',                  perm:'Administrator',   admin:true  },
    'DELETE /api/audit-logs/:id':    { category:'admin', desc:'Delete a single audit log entry.',               perm:'Administrator',   admin:true  },
    'POST /api/audit-logs/rotate':   { category:'admin', desc:'Rotate/purge old audit log entries.',            perm:'Administrator',   admin:true  },

    // ── Admin — Backups ───────────────────────────────────────────────────
    'GET /api/backups/status':              { category:'admin', desc:'Get backup scheduler status and list of backup files.', perm:'Administrator', admin:true },
    'POST /api/backups/run':                { category:'admin', desc:'Trigger a manual database backup immediately.',         perm:'Administrator', admin:true },
    'POST /api/backups/schedule':           { category:'admin', desc:'Update the backup cron schedule. Body: { schedule }',  perm:'Administrator', admin:true, body:'{ "schedule": "0 2 * * *" }' },
    'GET /api/backups/download/:filename':  { category:'admin', desc:'Download a backup file by filename.',                  perm:'Administrator', admin:true },

    // ── Admin — System Settings ───────────────────────────────────────────
    'GET /api/settings':              { category:'admin', desc:'Get all system settings (passwords masked).',           perm:'Administrator', admin:true },
    'GET /api/settings/timezones':    { category:'admin', desc:'Get list of valid IANA timezone identifiers.',          perm:'Administrator', admin:true },
    'GET /api/settings/email-status': { category:'admin', desc:'Get SMTP email config (password not returned).',       perm:'Administrator', admin:true },
    'GET /api/settings/api-routes':   { category:'admin', desc:'Get all registered API routes (this endpoint).',       perm:'Administrator', admin:true },
    'PUT /api/settings':              { category:'admin', desc:'Update one or more system settings. Body: { key: value }', perm:'Administrator', admin:true, body:'{ "app_timezone": "America/New_York" }' },

    // ── Admin — API Keys ──────────────────────────────────────────────────
    'GET /api/api-keys':               { category:'admin', desc:'List all API keys (hash never returned).',             perm:'Administrator', admin:true },
    'POST /api/api-keys':              { category:'admin', desc:'Generate a new API key (full key shown once only). Body: { name, description?, expiresIn? }', perm:'Administrator', admin:true, body:'{ "name": "Integration", "expiresIn": "90d" }' },
    'PATCH /api/api-keys/:id/toggle':  { category:'admin', desc:'Enable or disable an API key without deleting it.',   perm:'Administrator', admin:true },
    'DELETE /api/api-keys/:id':        { category:'admin', desc:'Permanently revoke and delete an API key.',            perm:'Administrator', admin:true },

    // ── Admin — Error Logs ────────────────────────────────────────────────
    'GET /api/errors':              { category:'admin', desc:'List frontend error log entries.',                   perm:'Administrator', admin:true },
    'PATCH /api/errors/:id/resolve':{ category:'admin', desc:'Mark a frontend error as resolved.',                perm:'Administrator', admin:true },
    'DELETE /api/errors':           { category:'admin', desc:'Clear all resolved frontend error entries.',         perm:'Administrator', admin:true },
    'POST /api/errors':             { category:'admin', desc:'Log a frontend error (can be called without auth).', perm:'Public',        admin:false },


    // ── Auto-discovered (no manual description yet) ─────────────────────────
    'GET /api/auth/profile':                  { category:'auth',     desc:'Get the currently authenticated user profile.',                          perm:'Authenticated', admin:false },
    'POST /api/import/:dataset':              { category:'admin',    desc:'Import data for a given dataset (patients, etc.) via CSV upload.',        perm:'Administrator', admin:true  },
    'GET /api/import/template/:dataset':      { category:'admin',    desc:'Download the CSV import template for a given dataset.',                   perm:'Administrator', admin:true  },
    'GET /api/workflow-actions/:id':        { category:'settings', desc:'Get a single workflow action step by ID.',                               perm:'workflow_actions: read', admin:false },
    'GET /api/patient-transport/:id':         { category:'settings', desc:'Get a single patient transport company by ID.',                           perm:'patient_transport: read', admin:false },
    'GET /api/pharmacy-transport/:id':        { category:'settings', desc:'Get a single pharmacy transport company by ID.',                          perm:'pharmacy_transport: read', admin:false },
    'DELETE /api/patient-transport/:id':      { category:'settings', desc:'Delete a patient transport company.',                                     perm:'patient_transport: delete', admin:false },
    'DELETE /api/pharmacy-transport/:id':     { category:'settings', desc:'Delete a pharmacy transport company.',                                    perm:'pharmacy_transport: delete', admin:false },
};
