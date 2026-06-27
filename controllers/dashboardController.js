const db = require('../models');
const { Op, fn, col, literal } = require('sequelize');

// ── Helper: build a date-range WHERE clause from ?from= / ?to= params ─────────
function buildDateRange(req) {
    const from = req.query.from || null;   // 'YYYY-MM-DD' or empty
    const to   = req.query.to   || null;
    if (!from && !to) return null;
    const clause = {};
    if (from) clause[Op.gte] = new Date(from + 'T00:00:00');
    if (to)   clause[Op.lte] = new Date(to   + 'T23:59:59');
    return clause;
}

exports.getStats = async (req, res) => {
    try {
        const dateRange = buildDateRange(req);

        // M3 FIX: Use Op.or [false, null] to match getAll — include legacy rows where isDeleted IS NULL
        const notDeleted = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };

        // Patient counts — filtered by createdAt if a date range is active
        const patientWhere = { ...notDeleted };
        if (dateRange) patientWhere.createdAt = dateRange;

        const activePatients   = await db.Patient.count({ where: { ...patientWhere, isActive: true  } });
        const inactivePatients = await db.Patient.count({ where: { ...patientWhere, isActive: false } });

        // RX counts — filtered by serviceDate if a date range is active (UX-01: exclude deleted)
        const rxWhere = { isDeleted: false };
        if (dateRange) rxWhere.serviceDate = dateRange;

        const activeRxCount = await db.RXRecord.count({ where: rxWhere });

        // Pending deliveries: RX records that have NOT completed ALL workflow steps
        // PERF-01: Use a single aggregate query instead of N+1 per-record loop
        const totalWorkflowSteps = await db.WorkflowAction.count({ where: { isActive: true } });

        let pendingDeliveriesCount = 0;
        if (totalWorkflowSteps === 0) {
            // No steps defined — all RX records are "pending"
            pendingDeliveriesCount = await db.RXRecord.count({ where: rxWhere });
        } else {
            // Fetch tracking counts grouped by rxRecordId in one query
            const trackingCounts = await db.RXWorkflowTracking.findAll({
                attributes: ['rxRecordId', [fn('COUNT', col('id')), 'stepsDone']],
                group: ['rxRecordId'],
                raw: true
            });

            const doneMap = {};
            for (const row of trackingCounts) {
                doneMap[row.rxRecordId] = parseInt(row.stepsDone, 10);
            }

            // Get all non-deleted RX IDs (with optional date filter)
            const allRxIds = await db.RXRecord.findAll({
                attributes: ['id'],
                where: rxWhere,
                raw: true
            });

            for (const { id } of allRxIds) {
                const done = doneMap[id] || 0;
                if (done < totalWorkflowSteps) pendingDeliveriesCount++;
            }
        }

        const recentActivity = await db.AuditLog.findAll({
            limit: 10,
            order: [['date', 'DESC'], ['time', 'DESC']],
            include: [{ model: db.User, attributes: ['firstName', 'lastName'] }]
        });

        // Active patients with NO RX records
        const patientIdsWithRx = await db.RXRecord.findAll({
            attributes: ['patientId'],
            where: { isDeleted: false },
            group: ['patientId'],
            raw: true
        });
        const idsWithRx = patientIdsWithRx.map(r => r.patientId);
        const patientsWithNoRx = await db.Patient.count({
            where: {
                isActive: true,
                ...notDeleted,
                id: { [Op.notIn]: idsWithRx.length ? idsWithRx : [0] }
            }
        });

        res.json({ activePatients, inactivePatients, pendingDeliveriesCount, activeRxCount, patientsWithNoRx, recentActivity });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getActivePatients = async (req, res) => {
    try {
        const patients = await db.Patient.findAll({
            // M3 FIX: include legacy rows where isDeleted IS NULL
            where: { isActive: true, [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            include: [{ model: db.Clinic }, { model: db.PatientTransportCompany }, { model: db.PharmacyTransportCompany }],
            order: [['lastName', 'ASC']]
        });
        res.json(patients);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getInactivePatients = async (req, res) => {
    try {
        const patients = await db.Patient.findAll({
            // M3 FIX: include legacy rows where isDeleted IS NULL
            where: { isActive: false, [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            include: [{ model: db.Clinic }, { model: db.PatientTransportCompany }, { model: db.PharmacyTransportCompany }],
            order: [['lastName', 'ASC']]
        });
        res.json(patients);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getPatientsWithNoRx = async (req, res) => {
    try {
        const patientIdsWithRx = await db.RXRecord.findAll({
            attributes: ['patientId'],
            where: { isDeleted: false },
            group: ['patientId'],
            raw: true
        });
        const idsWithRx = patientIdsWithRx.map(r => r.patientId);
        // M3 FIX: include legacy rows where isDeleted IS NULL
        const notDeleted = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };
        const patients = await db.Patient.findAll({
            where: {
                isActive: true,
                ...notDeleted,
                id: { [Op.notIn]: idsWithRx.length ? idsWithRx : [0] }
            },
            include: [{ model: db.Clinic }, { model: db.PatientTransportCompany }, { model: db.PharmacyTransportCompany }],
            order: [['lastName', 'ASC']]
        });
        res.json(patients);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getPendingRx = async (req, res) => {
    try {
        const totalWorkflowSteps = await db.WorkflowAction.count({ where: { isActive: true } });
        const allRx = await db.RXRecord.findAll({
            where: { isDeleted: false },   // BUG-12 fix: exclude soft-deleted
            include: [
                { model: db.Patient,  attributes: ['firstName', 'lastName', 'patientCode'] },
                { model: db.Pharmacy, attributes: ['name'] },
                { model: db.RXWorkflowTracking }
            ],
            order: [['serviceDate', 'DESC']]
        });
        const pending = allRx.filter(rx => (rx.RXWorkflowTrackings || []).length < totalWorkflowSteps);
        res.json(pending);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getTotalRx = async (req, res) => {
    try {
        const allRx = await db.RXRecord.findAll({
            where: { isDeleted: false },   // exclude soft-deleted
            include: [
                { model: db.Patient,  attributes: ['firstName', 'lastName', 'patientCode'] },
                { model: db.Pharmacy, attributes: ['name'] },
                { model: db.RXWorkflowTracking }
            ],
            order: [['serviceDate', 'DESC']]
        });
        res.json(allRx);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getChartData = async (req, res) => {
    try {
        // ── Patients per month (last 6 months) ──────────────────────────────
        const months = [];
        const patientCounts = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setDate(1);
            d.setMonth(d.getMonth() - i);
            const year  = d.getFullYear();
            const month = d.getMonth() + 1;
            const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
            const startStr = `${year}-${String(month).padStart(2,'0')}-01`;
            const endDate  = new Date(year, month, 0);
            const endStr   = `${year}-${String(month).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;
            const count = await db.Patient.count({
                where: {
                    isDeleted: false,
                    createdAt: { [Op.between]: [new Date(startStr), new Date(endStr + 'T23:59:59')] }
                }
            });
            months.push(label);
            patientCounts.push(count);
        }

        // PERF-01: Replace N+1 per-record loop with grouped aggregate
        const totalSteps2 = await db.WorkflowAction.count({ where: { isActive: true } });
        const allRxIds    = await db.RXRecord.findAll({
            attributes: ['id'],
            where: { isDeleted: false },
            raw: true
        });

        let completed2 = 0, pending = 0;

        if (totalSteps2 === 0) {
            pending = allRxIds.length;
        } else {
            const trackingCounts = await db.RXWorkflowTracking.findAll({
                attributes: ['rxRecordId', [fn('COUNT', col('id')), 'stepsDone']],
                group: ['rxRecordId'],
                raw: true
            });
            const doneMap = {};
            for (const row of trackingCounts) {
                doneMap[row.rxRecordId] = parseInt(row.stepsDone, 10);
            }
            for (const { id } of allRxIds) {
                const done = doneMap[id] || 0;
                if (done >= totalSteps2) completed2++;
                else pending++;
            }
        }

        res.json({
            patientsPerMonth: { labels: months, data: patientCounts },
            rxStatus: { labels: ['Completed', 'Pending'], data: [completed2, pending] }
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getRxPipeline = async (req, res) => {
    try {
        const steps = await db.WorkflowAction.findAll({
            where: { isActive: true },
            order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
        });
        const totalSteps = steps.length;

        const allRx = await db.RXRecord.findAll({
            include: [{ model: db.RXWorkflowTracking }],
            where: { isDeleted: false }
        });

        let notStarted = 0, inProgress = 0, completedCount = 0;
        const stepCounts = steps.map(s => ({ id: s.id, name: s.name, count: 0 }));

        for (const rx of allRx) {
            const done = (rx.RXWorkflowTrackings || []).length;
            if (totalSteps === 0 || done >= totalSteps) {
                completedCount++;
            } else if (done === 0) {
                notStarted++;
            } else {
                inProgress++;
                const currentStepIndex = done;
                if (stepCounts[currentStepIndex]) stepCounts[currentStepIndex].count++;
            }
        }

        res.json({
            total: allRx.length,
            notStarted,
            inProgress,
            completed: completedCount,
            totalSteps,
            stepBreakdown: stepCounts
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// GET /api/dashboard/eligibility
// Returns 90-day eligibility breakdown for active patients.
// SOURCE OF TRUTH: patient.serviceDate (canonical 90-day clock).
// This matches the frontend liveFilter() logic in patients.js.
exports.getEligibilityStats = async (req, res) => {
    try {
        const notDeleted = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };

        // Get all active non-deleted patients
        const patients = await db.Patient.findAll({
            where: { isActive: true, ...notDeleted },
            attributes: ['id', 'firstName', 'lastName', 'patientCode', 'serviceDate'],
            raw: true
        });

        const today = new Date(); today.setHours(0, 0, 0, 0);

        let eligibleNow    = 0;   // patient.serviceDate window fully expired (daysLeft < 0)
        let expiringIn7    = 0;   // window expires in 0–7 days
        let inWindow       = 0;   // window active, > 7 days remaining
        let noServiceDate  = 0;   // patient has no serviceDate at all
        const eligibleList = [];

        for (const p of patients) {
            // ── Canonical source: patient.serviceDate ──────────────────────────
            // This is the same field the frontend patients.js liveFilter() uses.
            if (!p.serviceDate) {
                noServiceDate++;
                continue;
            }
            const svcDay    = new Date(p.serviceDate); svcDay.setHours(0, 0, 0, 0);
            const expiryDay = new Date(svcDay); expiryDay.setDate(svcDay.getDate() + 90);
            const daysLeft  = Math.ceil((expiryDay - today) / 864e5);

            if (daysLeft < 0) {
                // Window fully expired — patient is eligible for a new service
                eligibleNow++;
                eligibleList.push({
                    id:            p.id,
                    patientCode:   p.patientCode,
                    name:          (p.firstName || '') + ' ' + (p.lastName || ''),
                    lastService:   p.serviceDate,
                    eligibleSince: expiryDay.toISOString().slice(0, 10),
                    daysPastDue:   Math.abs(daysLeft)
                });
            } else if (daysLeft <= 7) {
                // Window closing soon (0–7 days left)
                expiringIn7++;
            } else {
                // Active window, > 7 days remaining
                inWindow++;
            }
        }

        // Sort eligible list: longest overdue first
        eligibleList.sort((a, b) => b.daysPastDue - a.daysPastDue);

        res.json({
            eligibleNow,
            expiringIn7,
            inWindow,
            noServiceDate,
            total: patients.length,
            eligibleList: eligibleList.slice(0, 20)
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// GET /api/dashboard/eligibility-drilldown/:filter
// Returns the full patient list for a specific 90-day eligibility category.
// Filter values: eligible | expiring | window | none
// Uses the SAME logic as getEligibilityStats so popup counts match card numbers.
exports.getEligibilityDrilldown = async (req, res) => {
    try {
        const filter     = req.params.filter;  // eligible | expiring | window | none
        const notDeleted = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };

        const patients = await db.Patient.findAll({
            where: { isActive: true, ...notDeleted },
            attributes: ['id', 'firstName', 'lastName', 'patientCode', 'serviceDate', 'phone', 'dob'],
            include: [
                { model: db.Clinic, attributes: ['name'], required: false },
                { model: db.Pharmacy, attributes: ['name'], required: false }
            ],
            raw: false
        });

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const results = [];

        for (const p of patients) {
            const svcDate = p.serviceDate;

            if (!svcDate) {
                // 'none' category: no service date on the patient record
                if (filter === 'none') {
                    results.push({
                        id:          p.id,
                        patientCode: p.patientCode,
                        firstName:   p.firstName,
                        lastName:    p.lastName,
                        phone:       p.phone,
                        serviceDate: null,
                        expiryDate:  null,
                        daysLeft:    null,
                        status:      'none',
                        clinicName:  p.Clinic ? p.Clinic.name : null,
                        pharmacyName: p.Pharmacy ? p.Pharmacy.name : null
                    });
                }
                continue;
            }

            // Canonical 90-day window calculation
            const svcDay    = new Date(svcDate); svcDay.setHours(0, 0, 0, 0);
            const expiryDay = new Date(svcDay); expiryDay.setDate(svcDay.getDate() + 90);
            const daysLeft  = Math.ceil((expiryDay - today) / 864e5);

            const matches = (
                (filter === 'eligible' && daysLeft < 0)       ||  // window expired
                (filter === 'expiring' && daysLeft >= 0 && daysLeft <= 7) ||  // closing soon
                (filter === 'window'   && daysLeft > 7)        // active, plenty of time
            );

            if (matches) {
                results.push({
                    id:           p.id,
                    patientCode:  p.patientCode,
                    firstName:    p.firstName,
                    lastName:     p.lastName,
                    phone:        p.phone,
                    serviceDate:  svcDate,
                    expiryDate:   expiryDay.toISOString().slice(0, 10),
                    daysLeft:     daysLeft,
                    daysPastDue:  daysLeft < 0 ? Math.abs(daysLeft) : 0,
                    status:       filter,
                    clinicName:   p.Clinic   ? p.Clinic.name   : null,
                    pharmacyName: p.Pharmacy ? p.Pharmacy.name : null
                });
            }
        }

        // Sort: eligible → oldest first; expiring → fewest days first; window → most days first; none → alpha
        results.sort((a, b) => {
            if (filter === 'eligible') return b.daysPastDue - a.daysPastDue;
            if (filter === 'expiring') return a.daysLeft   - b.daysLeft;
            if (filter === 'window')   return b.daysLeft   - a.daysLeft;
            return (a.lastName || '').localeCompare(b.lastName || '');
        });

        res.json(results);
    } catch (error) { res.status(500).json({ error: error.message }); }
};
