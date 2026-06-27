const db = require('../models');

// Extract a human-readable label from the request body based on module
function extractLabel(moduleName, body, recordId) {
    if (!body) return recordId ? `#${recordId}` : null;
    switch (moduleName) {
        case 'Patients':
            return body.firstName && body.lastName
                ? `${body.firstName} ${body.lastName}` + (body.dob ? ` (DOB: ${body.dob})` : '')
                : recordId ? `Patient #${recordId}` : null;
        case 'RX Records':
            return body.patientId
                ? `RX for Patient #${body.patientId}` + (body.arrivalDate ? ` — Arrival: ${body.arrivalDate}` : '')
                : recordId ? `RX #${recordId}` : null;
        case 'Pharmacies':
            return body.name || (recordId ? `Pharmacy #${recordId}` : null);
        case 'Patient Transportation':
            return body.contactPerson || body.companyName || (recordId ? `Transport #${recordId}` : null);
        case 'Pharmacy Transportation':
            return body.contactPerson || body.companyName || (recordId ? `Transport #${recordId}` : null);
        case 'Workflow Actions':
            return body.name
                ? `${body.name}` + (body.sequenceNumber !== undefined ? ` (Step ${body.sequenceNumber})` : '')
                : recordId ? `Action #${recordId}` : null;
        case 'Clinics':
            return body.name || (recordId ? `Clinic #${recordId}` : null);
        case 'Users':
            return body.username
                ? body.username + (body.firstName ? ` (${body.firstName} ${body.lastName || ''})`.trim() : '')
                : body.firstName && body.lastName ? `${body.firstName} ${body.lastName}` : (recordId ? `User #${recordId}` : null);
        case 'RX Workflow':
            return body.rxId
                ? `RX #${body.rxId}`
                : body.workflowActionId
                    ? `Step #${body.workflowActionId}` + (body.rxRecordId ? ` on RX #${body.rxRecordId}` : '')
                    : recordId ? `RX #${recordId}` : null;
        default:
            return recordId ? `#${recordId}` : null;
    }
}

// Detect the real action name from the URL path
function detectAction(req, defaultAction) {
    const path = req.path || '';
    if (path.endsWith('/restore'))             return 'Restore';
    if (path.endsWith('/undo-workflow'))        return 'Undo';
    if (path.endsWith('/return-to-warehouse')) return 'Return to Warehouse';
    if (req.method === 'DELETE')               return 'Disable';
    return defaultAction;
}

// Snapshot the current workflow state for an RX before the operation runs
async function snapshotWorkflow(rxId) {
    if (!rxId) return null;
    try {
        const trackings = await db.RXWorkflowTracking.findAll({
            where: { rxRecordId: rxId },
            include: [{ model: db.WorkflowAction }],
            order: [['createdAt', 'ASC']]
        });
        if (!trackings.length) return { steps: [], summary: 'No steps completed' };
        const steps = trackings.map(t => ({
            stepId: t.workflowActionId,
            stepName: t.WorkflowAction ? t.WorkflowAction.name : `Step #${t.workflowActionId}`,
            sequence: t.WorkflowAction ? t.WorkflowAction.sequenceNumber : null,
            completedAt: t.completionDate
        }));
        const summary = steps.map(s => `Step ${s.sequence}: ${s.stepName}`).join(' → ');
        return { steps, summary };
    } catch (e) {
        return null;
    }
}

exports.auditLog = (moduleName) => {
    return async (req, res, next) => {

        // For workflow undo / return-to-warehouse: capture the BEFORE state
        let previousWorkflowSnapshot = null;
        const path = req.path || '';
        const isWorkflowMutation = path.endsWith('/undo-workflow') || path.endsWith('/return-to-warehouse');
        if (isWorkflowMutation && req.body && req.body.rxId) {
            previousWorkflowSnapshot = await snapshotWorkflow(req.body.rxId);
        }

        const originalJson = res.json.bind(res);

        res.json = function (body) {
            res.json = originalJson;

            if (['POST', 'PUT', 'DELETE'].includes(req.method) && res.statusCode >= 200 && res.statusCode < 300) {
                let action = 'Create';
                if (req.method === 'PUT') action = 'Update';
                else if (req.method === 'DELETE') action = 'Delete';
                action = detectAction(req, action);

                const recordId = req.params.id ? parseInt(req.params.id) : null;
                const label = extractLabel(moduleName, req.body, recordId);

                // Strip sensitive fields
                const { password, passwordHash, ...safeBody } = req.body || {};

                let newValue;
                let previousValue = null;

                if (isWorkflowMutation) {
                    const rxId = req.body.rxId;
                    const note = req.body.note || null;

                    // previousValue = the workflow steps that existed BEFORE this operation
                    previousValue = previousWorkflowSnapshot
                        ? { _label: `RX #${rxId}`, ...previousWorkflowSnapshot }
                        : { _label: `RX #${rxId}` };

                    // newValue = description of what the operation did
                    if (action === 'Undo') {
                        const undoneStep = previousWorkflowSnapshot && previousWorkflowSnapshot.steps.length > 0
                            ? previousWorkflowSnapshot.steps[previousWorkflowSnapshot.steps.length - 1]
                            : null;
                        newValue = {
                            _label: `RX #${rxId}`,
                            action: 'Undo Last Step',
                            undoneStep: undoneStep ? `Step ${undoneStep.sequence}: ${undoneStep.stepName}` : 'Unknown step',
                            remainingSteps: (previousWorkflowSnapshot && previousWorkflowSnapshot.steps.length > 1)
                                ? previousWorkflowSnapshot.steps.slice(0, -1).map(s => `Step ${s.sequence}: ${s.stepName}`).join(' → ')
                                : 'None'
                        };
                    } else if (action === 'Return to Warehouse') {
                        newValue = {
                            _label: `RX #${rxId}`,
                            action: 'Return to Warehouse',
                            clearedSteps: previousWorkflowSnapshot ? previousWorkflowSnapshot.summary : 'Unknown',
                            note: note || null,
                            newState: 'Reset to Step 1 (Warehouse)'
                        };
                    }
                } else {
                    // Standard create/update/delete
                    newValue = req.method !== 'DELETE'
                        ? { ...safeBody, _label: label }
                        : (label ? { _label: label } : null);
                }

                db.AuditLog.create({
                    userId:        req.user ? req.user.id : null,
                    date:          new Date().toISOString().split('T')[0],
                    time:          new Date().toTimeString().split(' ')[0],
                    module:        moduleName,
                    action:        action,
                    recordId:      recordId || (req.body && req.body.rxId ? req.body.rxId : null),
                    previousValue: previousValue ? JSON.stringify(previousValue) : null,
                    newValue:      newValue,
                    // M4 FIX: req.connection is deprecated in Node ≥19; use req.socket as fallback
                    ipAddress:     req.ip || req.socket?.remoteAddress || 'unknown'
                }).catch(err => console.error('[AuditLog Error]', err.message));
            }

            return originalJson(body);
        };

        next();
    };
};
