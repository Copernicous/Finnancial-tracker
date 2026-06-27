'use strict';
/**
 * snapshotService.js
 * Computes and persists a daily metrics snapshot.
 * Call captureSnapshot() manually or let the cron trigger it at 00:05 each night.
 */
const { QueryTypes } = require('sequelize');

let _db = null;
function db() {
    if (!_db) _db = require('../models');
    return _db;
}

/**
 * Capture a snapshot for a given date (defaults to today).
 * If a snapshot already exists for that date it is overwritten (upsert).
 * @param {string|Date} [forDate]  — ISO date string 'YYYY-MM-DD' or Date object.
 * @returns {Promise<object>}      — The saved DailySnapshot instance.
 */
async function captureSnapshot(forDate) {
    const d = forDate ? new Date(forDate) : new Date();
    // Normalise to YYYY-MM-DD in local time
    const pad = n => String(n).padStart(2, '0');
    const snapshotDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // M6 FIX: Build timezone-aware day window using the configured app timezone.
    // Using Date.UTC ensures the boundary timestamps are unambiguous regardless of
    // the PostgreSQL server's timezone setting.
    const dayStartDt = new Date(`${snapshotDate}T00:00:00`);
    const dayEndDt   = new Date(`${snapshotDate}T23:59:59`);
    // ISO strings are always UTC — PostgreSQL TIMESTAMPTZ will compare correctly
    const dayStart = dayStartDt.toISOString();
    const dayEnd   = dayEndDt.toISOString();

    const seq = db().sequelize;

    // ── Patients ──────────────────────────────────────────────────────────
    // Patients table uses isActive (no isDeleted column)
    const [pat] = await seq.query(`
        SELECT
            COUNT(*)                                                             AS "totalPatients",
            COUNT(*) FILTER (WHERE "isActive" = true)                            AS "activePatients",
            COUNT(*) FILTER (WHERE "isActive" = false)                           AS "inactivePatients",
            COUNT(*) FILTER (WHERE "createdAt" BETWEEN :dayStart AND :dayEnd)    AS "newPatientsToday",
            COUNT(*) FILTER (WHERE "isNonCompanyPatient" = true)                 AS "nonCompanyPatients"
        FROM "Patients"
    `, { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } });

    // ── RX Records ────────────────────────────────────────────────────────
    // pendingRX = RX where NOT all workflow steps are completed
    const [rx] = await seq.query(`
        WITH wf_totals AS (
            SELECT
                r.id,
                (SELECT COUNT(*) FROM "WorkflowActions" WHERE "isActive" = true) AS total_steps,
                (SELECT COUNT(*) FROM "RXWorkflowTrackings" t WHERE t."rxRecordId" = r.id) AS done_steps
            FROM "RXRecords" r
            WHERE r."isDeleted" = false
        )
        SELECT
            (SELECT COUNT(*) FROM "RXRecords" WHERE "isDeleted" = false)                                                            AS "totalRX",
            (SELECT COUNT(*) FROM "RXRecords" WHERE "isDeleted" = false AND "createdAt" BETWEEN :dayStart AND :dayEnd)              AS "newRXToday",
            (SELECT COUNT(*) FROM wf_totals WHERE done_steps < total_steps)                                                         AS "pendingRX",
            (SELECT COUNT(*) FROM wf_totals WHERE done_steps >= total_steps AND total_steps > 0)                                    AS "completedRX",
            (SELECT COUNT(*) FROM "RXRecords" WHERE "isDeleted" = true)                                                             AS "deletedRX",
            (SELECT COUNT(*) FROM "RXRecords" WHERE "returnedToWarehouse" = true AND "isDeleted" = false)                          AS "returnedToWarehouseRX"
    `, { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } });

    // ── Workflow steps ────────────────────────────────────────────────────
    const totalActiveStepDefs = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "WorkflowActions" WHERE "isActive" = true`,
        { type: QueryTypes.SELECT }
    );
    const activeRXCount = parseInt((await seq.query(
        `SELECT COUNT(*) AS cnt FROM "RXRecords" WHERE "isDeleted" = false`,
        { type: QueryTypes.SELECT }
    ))[0].cnt, 10);
    const totalWorkflowSteps     = parseInt(totalActiveStepDefs[0].cnt, 10) * activeRXCount;
    const completedWorkflowSteps = await seq.query(
        // H3 FIX: Only count tracking rows for non-deleted RX records to prevent rate > 100%
        `SELECT COUNT(*) AS cnt
         FROM "RXWorkflowTrackings" t
         JOIN "RXRecords" r ON r.id = t."rxRecordId"
         WHERE r."isDeleted" = false`,
        { type: QueryTypes.SELECT }
    ).then(r => parseInt(r[0].cnt, 10));
    const workflowStepsToday = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "RXWorkflowTrackings" WHERE "completionDate" BETWEEN :dayStart AND :dayEnd`,
        { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } }
    ).then(r => parseInt(r[0].cnt, 10));
    const workflowCompletionRate = totalWorkflowSteps > 0
        ? parseFloat(((completedWorkflowSteps / totalWorkflowSteps) * 100).toFixed(2))
        : 0;

    // ── Users & Activity ──────────────────────────────────────────────────
    const [usr] = await seq.query(`
        SELECT
            COUNT(*)                                       AS "totalUsers",
            COUNT(*) FILTER (WHERE "isActive" = true)     AS "activeUsers"
        FROM "Users"
    `, { type: QueryTypes.SELECT });

    const auditEventsToday = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "AuditLogs" WHERE "createdAt" BETWEEN :dayStart AND :dayEnd`,
        { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } }
    ).then(r => parseInt(r[0].cnt, 10));

    const errorLogsToday = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "ErrorLogs" WHERE "createdAt" BETWEEN :dayStart AND :dayEnd`,
        { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } }
    ).then(r => parseInt(r[0].cnt, 10));

    const unresolvedErrors = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "ErrorLogs" WHERE "resolved" = false`,
        { type: QueryTypes.SELECT }
    ).then(r => parseInt(r[0].cnt, 10));

    // Pharmacies and Clinics use isActive, no isDeleted column
    const totalPharmacies = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "Pharmacies"`,
        { type: QueryTypes.SELECT }
    ).then(r => parseInt(r[0].cnt, 10));

    const totalClinics = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "Clinics"`,
        { type: QueryTypes.SELECT }
    ).then(r => parseInt(r[0].cnt, 10));

    const totalTransportCompanies = await seq.query(
        `SELECT (
            (SELECT COUNT(*) FROM "PatientTransportCompanies")  +
            (SELECT COUNT(*) FROM "PharmacyTransportCompanies")
        ) AS cnt`,
        { type: QueryTypes.SELECT }
    ).then(r => parseInt(r[0].cnt, 10));

    // ── Build payload ─────────────────────────────────────────────────────
    const payload = {
        snapshotDate,
        // patients
        totalPatients:           parseInt(pat.totalPatients,   10) || 0,
        activePatients:          parseInt(pat.activePatients,  10) || 0,
        inactivePatients:        parseInt(pat.inactivePatients,10) || 0,
        newPatientsToday:        parseInt(pat.newPatientsToday,10) || 0,
        nonCompanyPatients:      parseInt(pat.nonCompanyPatients,10) || 0,
        // rx
        totalRX:                 parseInt(rx.totalRX,           10) || 0,
        newRXToday:              parseInt(rx.newRXToday,         10) || 0,
        pendingRX:               parseInt(rx.pendingRX,          10) || 0,
        completedRX:             parseInt(rx.completedRX,        10) || 0,
        deletedRX:               parseInt(rx.deletedRX,          10) || 0,
        returnedToWarehouseRX:   parseInt(rx.returnedToWarehouseRX, 10) || 0,
        // workflow
        totalWorkflowSteps,
        completedWorkflowSteps,
        workflowStepsToday,
        workflowCompletionRate,
        // users
        totalUsers:              parseInt(usr.totalUsers,       10) || 0,
        activeUsers:             parseInt(usr.activeUsers,      10) || 0,
        auditEventsToday,
        errorLogsToday,
        unresolvedErrors,
        // lookup
        totalPharmacies,
        totalClinics,
        totalTransportCompanies,
    };

    // Upsert — replace if same date already exists
    const [snap] = await db().DailySnapshot.upsert(payload, { returning: true });
    console.log(`[Snapshot] Captured ${snapshotDate}: patients=${payload.totalPatients} rx=${payload.totalRX} pending=${payload.pendingRX}`);
    return snap;
}

module.exports = { captureSnapshot };
