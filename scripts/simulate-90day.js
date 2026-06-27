/**
 * simulate-90day.js
 * ─────────────────────────────────────────────────────────────────────────
 * Creates 7 test patients + RX records that cover EVERY 90-day scenario:
 *
 *   PATIENT A — No service date yet        → Can receive service any time
 *   PATIENT B — Service started today      → Window ACTIVE, 90 days left
 *   PATIENT C — Service started 45 days ago → Window ACTIVE, 45 days left
 *   PATIENT D — Service started 75 days ago → Window EXPIRING (15d left)
 *   PATIENT E — Service started 83 days ago → Window EXPIRING SOON (7d left)
 *   PATIENT F — Service started 90 days ago → Window EXACTLY expired today
 *   PATIENT G — Service started 120 days ago → Eligible for NEW service
 *
 * Each patient also gets the matching RX record(s) so the workflow can be
 * tested visually in the UI.
 *
 * Run: node scripts/simulate-90day.js
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

const db = require('../models');

// ── helpers ───────────────────────────────────────────────────────────────
function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(0, 0, 0, 0);
    return d;
}

function fmt(date) {
    if (!date) return 'none';
    return date.toISOString().slice(0, 10);
}

// ── scenario definitions ──────────────────────────────────────────────────
const scenarios = [
    {
        tag:         'A',
        firstName:   'Alice',
        lastName:    'NoService',
        dob:         '1985-03-12',
        phone:       '555-0001',
        serviceDate: null,              // No service date
        scenario:    'NO SERVICE DATE — Can receive first service any time',
        rxRecords: []                   // No RX records yet
    },
    {
        tag:         'B',
        firstName:   'Bob',
        lastName:    'JustStarted',
        dob:         '1990-07-20',
        phone:       '555-0002',
        serviceDate: daysAgo(0),        // Started TODAY
        scenario:    'ACTIVE WINDOW — Just started today (90 days remaining)',
        rxRecords: [
            { offsetDays: 0, label: 'First RX — Received today' }
        ]
    },
    {
        tag:         'C',
        firstName:   'Carol',
        lastName:    'MidWindow',
        dob:         '1978-11-05',
        phone:       '555-0003',
        serviceDate: daysAgo(45),       // 45 days in
        scenario:    'ACTIVE WINDOW — 45 days in (45 days remaining)',
        rxRecords: [
            { offsetDays: 45, label: 'First RX — Received 45 days ago' },
            { offsetDays: 30, label: 'Second delivery — 30 days ago' }
        ]
    },
    {
        tag:         'D',
        firstName:   'David',
        lastName:    'Expiring',
        dob:         '1965-04-22',
        phone:       '555-0004',
        serviceDate: daysAgo(75),       // 75 days in — 15 left
        scenario:    'EXPIRING — 75 days in (15 days remaining)',
        rxRecords: [
            { offsetDays: 75, label: 'First RX — 75 days ago' },
            { offsetDays: 45, label: 'Mid-cycle delivery' },
            { offsetDays: 15, label: 'Latest delivery — 15 days ago' }
        ]
    },
    {
        tag:         'E',
        firstName:   'Eva',
        lastName:    'ClosingOut',
        dob:         '1995-09-14',
        phone:       '555-0005',
        serviceDate: daysAgo(83),       // 83 days in — 7 left
        scenario:    'EXPIRING SOON — 83 days in (7 days remaining)',
        rxRecords: [
            { offsetDays: 83, label: 'First RX — 83 days ago' },
            { offsetDays: 60, label: 'Mid delivery' },
            { offsetDays: 7,  label: 'Most recent delivery — 7 days ago' }
        ]
    },
    {
        tag:         'F',
        firstName:   'Frank',
        lastName:    'JustExpired',
        dob:         '1972-01-30',
        phone:       '555-0006',
        serviceDate: daysAgo(90),       // Exactly 90 days — window just closed
        scenario:    'JUST ELIGIBLE — Window expired exactly today (0 days remaining)',
        rxRecords: [
            { offsetDays: 90, label: 'First RX from 90 days ago' },
            { offsetDays: 60, label: 'Delivery 60 days ago' },
            { offsetDays: 30, label: 'Last delivery 30 days ago' }
        ]
    },
    {
        tag:         'G',
        firstName:   'Grace',
        lastName:    'EligibleNow',
        dob:         '1988-06-08',
        phone:       '555-0007',
        serviceDate: daysAgo(120),      // 120 days — fully eligible
        scenario:    'ELIGIBLE NOW — Window expired 30 days ago (ready for new service)',
        rxRecords: [
            { offsetDays: 120, label: 'First RX from 120 days ago' },
            { offsetDays: 90,  label: 'Mid-cycle delivery' },
            { offsetDays: 100, label: 'Late delivery in old cycle' }
        ]
    }
];

// ── main ──────────────────────────────────────────────────────────────────
async function run() {
    await db.sequelize.authenticate();
    console.log('\n🔧  90-Day Simulation — Patient & RX Seeder\n' + '─'.repeat(55));

    let pharmacy = await db.Pharmacy.findOne();
    if (!pharmacy) {
        console.log('⚠️  No pharmacy found. Creating a demo pharmacy...');
        pharmacy = await db.Pharmacy.create({
            name:    'Demo Pharmacy',
            address: '100 Main St',
            phone:   '555-9999'
        });
    }
    console.log(`✅  Using pharmacy: ${pharmacy.name} (ID ${pharmacy.id})\n`);

    // Remove any previous simulation patients (tagged with sim tag)
    const simTags = scenarios.map(s => 'SIM-' + s.tag);
    await db.Patient.destroy({ where: { patientCode: simTags }, force: true });
    console.log('🗑️   Cleared previous simulation patients\n');

    for (const sc of scenarios) {
        // ── Create patient ─────────────────────────────────────────────
        const patient = await db.Patient.create({
            patientCode:  'SIM-' + sc.tag,
            firstName:    sc.firstName,
            lastName:     sc.lastName,
            dob:          sc.dob,
            phone:        sc.phone,
            serviceDate:  sc.serviceDate,
            pharmacyId:   pharmacy.id,
            isActive:     true
        });

        const exp = sc.serviceDate
            ? new Date(sc.serviceDate.getTime() + 90 * 864e5)
            : null;

        console.log(`\n👤  Patient ${sc.tag}: ${sc.firstName} ${sc.lastName} (ID: ${patient.id})`);
        console.log(`    Scenario : ${sc.scenario}`);
        console.log(`    Svc Date : ${fmt(sc.serviceDate)}`);
        console.log(`    Expires  : ${fmt(exp)}`);

        // ── Create RX records ──────────────────────────────────────────
        for (const rx of sc.rxRecords) {
            const svcDate = daysAgo(rx.offsetDays);
            // Arrival = same as service date (simplest valid setup)
            const rec = await db.RXRecord.create({
                patientId:   patient.id,
                pharmacyId:  pharmacy.id,
                arrivalDate: svcDate,
                serviceDate: svcDate,
                notes:       rx.label
            });
            console.log(`    📋  RX #${rec.id}: ${rx.label} (svc: ${fmt(svcDate)})`);
        }

        if (sc.rxRecords.length === 0) {
            console.log('    📋  No RX records — patient awaiting first service');
        }
    }

    console.log('\n' + '─'.repeat(55));
    console.log('✅  Simulation complete!\n');
    console.log('Scenarios to test in the UI:');
    console.log('  • Patients page: check "Next Svc Date" column badges');
    console.log('  • Patients page: use the 90-Day Eligibility filter dropdown');
    console.log('  • Dashboard:  see the Eligibility widget counts update');
    console.log('  • Edit Patient SIM-B/C/D/E: amber lock banner + read-only date');
    console.log('  • Edit Patient SIM-F/G: date field is UNLOCKED (eligible)');
    console.log('  • Try creating a NEW RX for SIM-B/C/D/E: should be BLOCKED');
    console.log('  • Try creating a NEW RX for SIM-F/G:   should SUCCEED\n');

    await db.sequelize.close();
}

run().catch(err => {
    console.error('❌  Simulation failed:', err.message);
    process.exit(1);
});
