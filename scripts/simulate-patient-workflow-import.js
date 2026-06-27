'use strict';

const { parseDate, formatDate } = require('../utils/dateUtils');

const WORKFLOW_HEADERS = [
    'RX Received Warehouse',
    'On Route with Driver',
    'Delivered',
    'Mark as Received to print log',
    'Signed by Pharmacy',
    'Archived on local and case close'
];

function normalizeImportHeader(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function parseDateField(raw) {
    return parseDate(raw);
}

function toUpperName(value) {
    return String(value || '').trim().toUpperCase();
}

function isoDate(dateLike) {
    if (!dateLike) return null;
    const date = new Date(dateLike);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
}

function formatDateLabel(dateLike) {
    return formatDate(dateLike) || String(dateLike || 'none');
}

function toDateOnly(raw) {
    const date = new Date(raw);
    if (isNaN(date.getTime())) return null;
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    return day;
}

function checkChronologicalSteps(steps) {
    if (steps.length < 2) return null;
    for (let i = 1; i < steps.length; i++) {
        if (steps[i].completionDate < steps[i - 1].completionDate) {
            return `Workflow steps are not chronological: "${steps[i].name}" is before "${steps[i - 1].name}".`;
        }
    }
    return null;
}

function validateWorkflowAgainstServiceDate(steps, serviceDate, errors) {
    if (!serviceDate || !steps.length) return;
    const sorted = [...steps].sort((a, b) => {
        if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber;
        return new Date(a.completionDate) - new Date(b.completionDate);
    });
    const svcDate = toDateOnly(serviceDate);
    if (!svcDate) return;
    const firstDate = toDateOnly(sorted[0].completionDate);
    if (firstDate && firstDate < svcDate) {
        errors.push(`First workflow step "${sorted[0].name}" (${formatDateLabel(firstDate)}) cannot be before service date (${formatDateLabel(svcDate)}).`);
    }
    const expiryDate = new Date(svcDate);
    expiryDate.setDate(expiryDate.getDate() + 90);
    const outsideWindow = sorted.find((step) => {
        const stepDate = toDateOnly(step.completionDate);
        return stepDate && stepDate > expiryDate;
    });
    if (outsideWindow) {
        const stepDate = toDateOnly(outsideWindow.completionDate);
        errors.push(`Workflow step "${outsideWindow.name}" (${formatDateLabel(stepDate)}) exceeds service date + 90 days (${formatDateLabel(expiryDate)}).`);
    }
}

function simulateImportRow(row) {
    const baseActionBySeq = new Map();
    const actionByName = new Map();
    WORKFLOW_HEADERS.forEach((name, idx) => {
        const action = {
            id: idx + 1,
            name,
            sequenceNumber: idx + 1
        };
        actionByName.set(normalizeImportHeader(name), action);
        baseActionBySeq.set(idx + 1, action);
    });

    const errors = [];
    const warnings = [];

    const firstName = toUpperName(row.firstName);
    const lastName = toUpperName(row.lastName);

    if (!firstName) errors.push('First Name is required');
    if (!lastName) errors.push('Last Name is required');
    if (!row.dob || !parseDateField(row.dob)) errors.push('DOB must be a valid MM/DD/YYYY or YYYY-MM-DD date');

    let serviceDate = parseDateField(row.serviceDate) || null;

    const workflowSteps = [];
    const seenIds = new Set();

    Object.keys(row).forEach((rawHeader) => {
        const normalizedHeader = normalizeImportHeader(rawHeader);
        const index = WORKFLOW_HEADERS.findIndex((name) => normalizeImportHeader(name) === normalizedHeader);
        if (index === -1) return;

        const action = actionByName.get(normalizedHeader) || baseActionBySeq.get(index + 1);
        if (!action) return;

        const trimmed = String(row[rawHeader] || '').trim();
        if (!trimmed) return;

        const parsed = parseDateField(trimmed);
        if (!parsed) {
            errors.push(`Workflow date for "${rawHeader}" must be MM/DD/YYYY or YYYY-MM-DD.`);
            return;
        }

        if (seenIds.has(action.id)) {
            errors.push(`Duplicate workflow header mapped to "${action.name}".`);
            return;
        }
        seenIds.add(action.id);

        workflowSteps.push({
            workflowActionId: action.id,
            name: action.name,
            sequenceNumber: action.sequenceNumber,
            completionDate: parsed
        });
    });

    workflowSteps.sort((a, b) => {
        if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber;
        return new Date(a.completionDate) - new Date(b.completionDate);
    });

    const chronologyErr = checkChronologicalSteps(workflowSteps);
    if (chronologyErr) errors.push(chronologyErr);

    if (workflowSteps.length > 0 && !serviceDate) {
        const inferred = workflowSteps.reduce((acc, step) => {
            const stepDate = new Date(step.completionDate);
            if (!acc || stepDate < acc) return stepDate;
            return acc;
        }, null);
        if (inferred) {
            serviceDate = isoDate(inferred);
            warnings.push(`Service Date was blank; inferred from earliest workflow date => ${formatDateLabel(serviceDate)}`);
        }
    }

    if (serviceDate) {
        validateWorkflowAgainstServiceDate(workflowSteps, serviceDate, errors);
    }

    let serviceWindow = null;
    let windowStatus = 'No service date available';
    if (serviceDate) {
        const svc = new Date(serviceDate);
        const expires = new Date(serviceDate);
        expires.setDate(expires.getDate() + 90);
        serviceWindow = {
            started: formatDateLabel(serviceDate),
            expires: formatDateLabel(isoDate(expires)),
            within90DayRule: workflowSteps.every(
                (step) => new Date(step.completionDate) <= expires
            )
        };
        if (workflowSteps.length) {
            const firstStepDate = new Date(workflowSteps[0].completionDate);
            if (firstStepDate < svc) {
                warnings.push(`Step "${workflowSteps[0].name}" is before service date; import will keep it, but later workflow tools enforce 90-day/sequence guards.`);
            }
            if (new Date(workflowSteps[workflowSteps.length - 1].completionDate) > expires) {
                warnings.push(`Last workflow step exceeds 90-day service window.`);
            }
        }
        windowStatus = serviceWindow.within90DayRule
            ? 'PASS (all workflow steps <= serviceDate + 90 days)'
            : 'FAIL (one or more workflow steps are outside serviceDate + 90 days)';
    }

    const rxRecord = serviceDate
        ? {
            arrivalDate: serviceDate,
            serviceDate: serviceDate,
            trackingCount: workflowSteps.length
        }
        : null;

    return {
        firstName,
        lastName,
        serviceDate,
        workflowSteps,
        errors,
        warnings,
        rxRecord,
        patientPayload: {
            patientCode: (row.patientCode || 'SIM-001').trim(),
            firstName,
            lastName,
            dob: parseDateField(row.dob),
            phone: row.phone ? row.phone.trim() : null,
            address: row.address ? row.address.trim() : null,
            serviceDate,
            isActive: String(row.isActive || 'true').trim().toLowerCase() !== 'false'
        },
        windowStatus,
        serviceWindow
    };
}

function printScenario(label, row) {
    const result = simulateImportRow(row);

    console.log('');
    console.log(`┌─ Scenario: ${label}`);
    console.log(`├─ Incoming patientCode: ${row.patientCode}`);
    console.log(`├─ Raw serviceDate: ${row.serviceDate || '(blank)'}`);
    console.log(`├─ Imported first/last: ${result.firstName} ${result.lastName}`);
    console.log(`├─ DOB: ${formatDateLabel(row.dob)}`);
    console.log(`├─ Workflow steps included: ${result.workflowSteps.length}`);
    console.log(`├─ Service date resolved: ${result.serviceDate || 'NOT SET'}`);
    console.log(`├─ Arrival date for created RX: ${result.rxRecord ? result.rxRecord.arrivalDate : 'N/A'}`);
    console.log(`├─ Window check: ${result.windowStatus}`);

    if (result.workflowSteps.length) {
        const names = ['RX Received Warehouse', 'On Route with Driver', 'Delivered', 'Mark as Received to print log', 'Signed by Pharmacy', 'Archived on local and case close'];
        names.forEach((name, idx) => {
            const step = result.workflowSteps.find((entry) => entry.name === name);
            const output = step
                ? `${formatDateLabel(step.completionDate)} (complete)`
                : 'blank (skipped)';
            console.log(`├─ ${name.padEnd(42)} => ${output}`);
        });
        console.log(`├─ Completion payload sample: ${JSON.stringify(
            result.workflowSteps.map((step, idx) => ({
                seq: idx + 1,
                action: step.name,
                completionDate: step.completionDate
            })), null, 2
        ).replace(/\n/g, '\n│  ')}`);
    } else {
        console.log('├─ No workflow columns populated; no RX record would be created from this row.');
    }

    if (result.warnings.length) {
        result.warnings.forEach((warning) => console.log(`├─ Warning: ${warning}`));
    }
    if (result.errors.length) {
        result.errors.forEach((error) => console.log(`├─ ERROR: ${error}`));
        console.log('└─ Import outcome: BLOCKED');
        return;
    }

    if (!result.patientPayload.serviceDate && !result.workflowSteps.length) {
        console.log('├─ Patient import: would create patient only (no RX created)');
    } else if (!result.rxRecord) {
        console.log('├─ Patient import: blocked, no service date + no workflow tracking to auto-create RX');
    } else {
        console.log('├─ Patient import: OK');
        console.log('├─ RX creation: would auto-create 1 RX record with status and dates set to service date');
    }

    console.log('└─ Overall import result: ' + (result.errors.length ? 'FAILED' : 'SUCCESS'));
}

function run() {
    console.log('\n============================================================');
    console.log('PATIENT IMPORT WORKFLOW SIMULATION (text only)');
    console.log('============================================================');
    console.log('Rules used in this simulation:');
    console.log('• patient first/last names are forced to uppercase');
    console.log('• if any workflow date exists and serviceDate is blank, serviceDate = earliest workflow date');
    console.log('• if all needed values are valid, one RX is auto-created with arrivalDate = serviceDate');
    console.log('• completed workflow entries are generated only for workflow columns containing a valid date');
    console.log('• date order is validated by workflow step sequence');

    const baseRow = {
        firstName: 'Ana',
        lastName: 'Garcia',
        dob: '03/12/1985',
        phone: '555-0198',
        address: '100 North St',
        isActive: 'true'
    };

    const scenarios = [
        {
            label: '1) Service date and all workflow steps on same date',
            row: {
                ...baseRow,
                patientCode: 'SIM-SAME-001',
                serviceDate: '06/01/2026',
                'RX Received Warehouse': '06/01/2026',
                'On Route with Driver': '06/01/2026',
                'Delivered': '06/01/2026',
                'Mark as Received to print log': '06/01/2026',
                'Signed by Pharmacy': '06/01/2026',
                'Archived on local and case close': '06/01/2026'
            }
        },
        {
            label: '2) First step on service date, then +1 day each step',
            row: {
                ...baseRow,
                patientCode: 'SIM-INCR-002',
                serviceDate: '06/01/2026',
                'RX Received Warehouse': '06/01/2026',
                'On Route with Driver': '06/02/2026',
                'Delivered': '06/03/2026',
                'Mark as Received to print log': '06/04/2026',
                'Signed by Pharmacy': '06/05/2026',
                'Archived on local and case close': '06/06/2026'
            }
        },
        {
            label: '3) Within 90-day service window, serviceDate omitted (inferred from step 1)',
            row: {
                ...baseRow,
                patientCode: 'SIM-WIN-003',
                serviceDate: '',
                'RX Received Warehouse': '06/01/2026',
                'On Route with Driver': '06/03/2026',
                'Delivered': '06/10/2026',
                'Mark as Received to print log': '06/18/2026',
                'Signed by Pharmacy': '06/24/2026',
                'Archived on local and case close': '07/01/2026'
            }
        }
    ];

    scenarios.forEach((scenario) => printScenario(scenario.label, scenario.row));

    console.log('\nSimulation complete.');
}

run();
