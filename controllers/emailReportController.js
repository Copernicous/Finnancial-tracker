/**
 * emailReportController.js
 *
 * Handles on-demand "Email Report" requests triggered from the Reports page.
 * Builds an HTML email from live report data and sends it via emailService.
 *
 * POST /api/email-report
 * Body: {
 *   reportType: 'patients' | 'rx-receipts' | 'rx-actions' | 'summary',
 *   to:         'recipient@example.com'  (or comma-separated list),
 *   subject:    optional custom subject,
 *   dateFrom:   optional ISO date string,
 *   dateTo:     optional ISO date string
 * }
 */

const emailService  = require('../services/emailService');
const db            = require('../models');
const { Op }        = require('sequelize');

// â”€â”€ HTML email template â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function emailWrap(title, body, generatedAt) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; background: #f4f6fb; margin: 0; padding: 0; }
  .container { max-width: 700px; margin: 30px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
  .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 28px 32px; }
  .header h1 { color: #fff; margin: 0; font-size: 1.4rem; }
  .header p  { color: rgba(255,255,255,.8); margin: 4px 0 0; font-size: .85rem; }
  .body { padding: 28px 32px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: .82rem; }
  th { background: #f1f2ff; color: #6366f1; padding: 8px 10px; text-align: left; font-weight: 700; border-bottom: 2px solid #e5e7ff; }
  td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; color: #374151; vertical-align: top; }
  tr:hover td { background: #fafbff; }
  .stat-grid { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .stat-box { flex: 1; min-width: 130px; background: #f4f6fb; border-radius: 10px; padding: 16px; text-align: center; border-top: 3px solid #6366f1; }
  .stat-box .val { font-size: 2rem; font-weight: 700; color: #6366f1; }
  .stat-box .lbl { font-size: .73rem; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-top: 4px; }
  .footer { background: #f8f9fd; padding: 16px 32px; text-align: center; font-size: .75rem; color: #9ca3af; border-top: 1px solid #e5e7ff; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: .72rem; font-weight: 700; }
  .badge-active   { background: #d1fae5; color: #065f46; }
  .badge-inactive { background: #fee2e2; color: #991b1b; }
  .badge-pending  { background: #fef3c7; color: #92400e; }
  .badge-done     { background: #ede9fe; color: #5b21b6; }
  .section-title  { font-weight: 700; color: #374151; font-size: 1rem; margin: 24px 0 8px; border-left: 4px solid #6366f1; padding-left: 10px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>ðŸ’Š Home Accounting â€” ${title}</h1>
    <p>Generated: ${generatedAt}</p>
  </div>
  <div class="body">
    ${body}
  </div>
  <div class="footer">
    This email was sent from the Home Accounting &bull; Do not reply to this email.
  </div>
</div>
</body>
</html>`;
}

// â”€â”€ Build report bodies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function buildSummaryBody(dateFrom, dateTo) {
    const where = { isDeleted: { [Op.or]: [false, null] } };
    if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt[Op.gte] = new Date(dateFrom);
        if (dateTo)   where.createdAt[Op.lte] = new Date(dateTo + 'T23:59:59');
    }

    const [totalPatients, activePatients, totalRx, pendingRx] = await Promise.all([
        db.Patient.count({ where }),
        db.Patient.count({ where: { ...where, status: 'Active' } }),
        db.RXRecord.count({ where }),
        db.RXRecord.count({ where: { ...where, status: { [Op.ne]: 'Completed' } } })
    ]);

    return `
    <div class="stat-grid">
      <div class="stat-box"><div class="val">${totalPatients}</div><div class="lbl">Total Patients</div></div>
      <div class="stat-box"><div class="val">${activePatients}</div><div class="lbl">Active Patients</div></div>
      <div class="stat-box"><div class="val">${totalRx}</div><div class="lbl">Total RX Records</div></div>
      <div class="stat-box" style="border-color:#f59e0b"><div class="val" style="color:#f59e0b">${pendingRx}</div><div class="lbl">Pending RX</div></div>
    </div>
    <p style="color:#6b7280;font-size:.82rem">
      ${dateFrom || dateTo ? `Date range: <strong>${dateFrom || 'â€”'}</strong> to <strong>${dateTo || 'today'}</strong>` : 'All time data'}
    </p>`;
}

async function buildPatientBody() {
    const patients = await db.Patient.findAll({
        where: { isDeleted: { [Op.or]: [false, null] } },
        include: [
            { model: db.Clinic, attributes: ['name'], required: false },
            { model: db.RXRecord, as: 'RXRecords', required: false, where: { isDeleted: { [Op.or]: [false, null] } }, attributes: ['id', 'status'] }
        ],
        order: [['lastName', 'ASC']]
    });

    const rows = patients.map(p => {
        const rxCount = p.RXRecords?.length || 0;
        const pending = p.RXRecords?.filter(r => r.status !== 'Completed').length || 0;
        const statusBadge = p.status === 'Active'
            ? '<span class="badge badge-active">Active</span>'
            : '<span class="badge badge-inactive">Inactive</span>';
        return `<tr>
            <td>${p.lastName}, ${p.firstName}</td>
            <td>${p.dob ? new Date(p.dob).toLocaleDateString() : 'â€”'}</td>
            <td>${statusBadge}</td>
            <td>${p.Clinic?.name || 'â€”'}</td>
            <td style="text-align:center">${rxCount}</td>
            <td style="text-align:center">${pending > 0 ? `<span class="badge badge-pending">${pending}</span>` : '0'}</td>
        </tr>`;
    }).join('');

    return `
    <div class="section-title">Patient List (${patients.length} patients)</div>
    <table>
      <thead><tr><th>Name</th><th>DOB</th><th>Status</th><th>Clinic</th><th>Total RX</th><th>Pending RX</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#9ca3af">No patients found</td></tr>'}</tbody>
    </table>`;
}

async function buildRxReceiptsBody() {
    const records = await db.RXRecord.findAll({
        where: { isDeleted: { [Op.or]: [false, null] } },
        include: [
            { model: db.Patient, attributes: ['firstName', 'lastName'] },
            { model: db.Pharmacy, attributes: ['name'], required: false },
        ],
        order: [['createdAt', 'DESC']],
        limit: 100
    });

    const rows = records.map(r => {
        const statusBadge = r.status === 'Completed'
            ? '<span class="badge badge-done">Completed</span>'
            : '<span class="badge badge-pending">Pending</span>';
        return `<tr>
            <td>${r.Patient ? r.Patient.lastName + ', ' + r.Patient.firstName : 'â€”'}</td>
            <td>${r.rxNumber || 'â€”'}</td>
            <td>${r.Pharmacy?.name || 'â€”'}</td>
            <td>${statusBadge}</td>
            <td>${r.createdAt ? new Date(r.createdAt).toLocaleDateString() : 'â€”'}</td>
        </tr>`;
    }).join('');

    return `
    <div class="section-title">RX Records â€” Last 100 (${records.length} shown)</div>
    <table>
      <thead><tr><th>Patient</th><th>RX Number</th><th>Pharmacy</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#9ca3af">No records found</td></tr>'}</tbody>
    </table>`;
}

async function buildRxActionsBody() {
    const tracking = await db.RXWorkflowTracking.findAll({
        include: [
            { model: db.RXRecord, include: [{ model: db.Patient, attributes: ['firstName','lastName'] }] },
            { model: db.WorkflowAction, attributes: ['name'] }
        ],
        order: [['createdAt', 'DESC']],
        limit: 100
    });

    const rows = tracking.map(t => {
        const patient = t.RXRecord?.Patient;
        const name = patient ? `${patient.lastName}, ${patient.firstName}` : 'â€”';
        const completed = t.isCompleted
            ? '<span class="badge badge-done">Done</span>'
            : '<span class="badge badge-pending">Pending</span>';
        return `<tr>
            <td>${name}</td>
            <td>${t.WorkflowAction?.name || 'â€”'}</td>
            <td>${completed}</td>
            <td>${t.completionDate ? new Date(t.completionDate).toLocaleDateString() : 'â€”'}</td>
        </tr>`;
    }).join('');

    return `
    <div class="section-title">Workflow Actions â€” Last 100 (${tracking.length} shown)</div>
    <table>
      <thead><tr><th>Patient</th><th>Step</th><th>Status</th><th>Completed</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#9ca3af">No actions found</td></tr>'}</tbody>
    </table>`;
}

// â”€â”€ Controller: POST /api/email-report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.sendReport = async (req, res) => {
    try {
        if (!emailService.isConfigured()) {
            return res.status(422).json({
                error: 'Email is not configured.',
                hint: 'Add SMTP_USER and SMTP_PASS to your .env file. See System Settings â†’ Email Setup.'
            });
        }

        const { reportType, to, subject, dateFrom, dateTo } = req.body;

        if (!to || !to.trim()) {
            return res.status(400).json({ error: 'Recipient email address is required.' });
        }
        if (!reportType) {
            return res.status(400).json({ error: 'reportType is required.' });
        }

        const now = new Date().toLocaleString('en-US', { timeZone: process.env.TZ || 'America/New_York' });

        let bodyHtml = '';
        let reportTitle = '';

        switch (reportType) {
            case 'summary':
                reportTitle = 'Daily Summary Report';
                bodyHtml = await buildSummaryBody(dateFrom, dateTo);
                break;
            case 'patients':
                reportTitle = 'Patient Report';
                bodyHtml = await buildPatientBody();
                break;
            case 'rx-receipts':
                reportTitle = 'RX Records Report';
                bodyHtml = await buildRxReceiptsBody();
                break;
            case 'rx-actions':
                reportTitle = 'Workflow Actions Report';
                bodyHtml = await buildRxActionsBody();
                break;
            default:
                return res.status(400).json({ error: `Unknown reportType: "${reportType}". Use: summary, patients, rx-receipts, rx-actions` });
        }

        const finalSubject = subject?.trim() || `Home Accounting â€” ${reportTitle} (${new Date().toLocaleDateString()})`;
        const html = emailWrap(reportTitle, bodyHtml, now);

        await emailService.sendEmail({ to: to.trim(), subject: finalSubject, html });

        res.json({ ok: true, message: `Report sent to ${to.trim()}`, reportType, sentAt: new Date().toISOString() });
    } catch (e) {
        console.error('[emailReport] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// â”€â”€ Controller: POST /api/email-report/test â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.testConnection = async (req, res) => {
    try {
        if (!emailService.isConfigured()) {
            return res.status(422).json({
                configured: false,
                error: 'SMTP_USER and SMTP_PASS are not set in .env'
            });
        }
        const result = await emailService.testConnection();
        res.json({ configured: true, ...result });
    } catch (e) {
        res.status(500).json({ configured: true, ok: false, error: e.message });
    }
};

