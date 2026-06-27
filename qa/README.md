# Home Accounting QA Smoke Test

This folder contains standalone QA tooling. These scripts are not part of the production app runtime; they only run when you execute the QA commands.

## What It Tests

The smoke test uses Node + Playwright Core + Chrome to open the site like a real user:

1. Opens `https://localhost:3443`.
2. Logs in with the QA credentials.
3. Visits the main pages.
4. Clicks safe buttons and modals.
5. Confirms seeded fake data appears.
6. Writes a pass/fail report.

The test intentionally skips destructive or heavy actions, including backup restore, delete, purge, hide RX, and full backup execution.

## First-Time Setup

From the project root:

```powershell
copy qa\.env.qa.example qa\.env.qa
npm install
```

If Chrome is not installed in the default location, edit `qa\.env.qa` and set `QA_CHROME_PATH`.

## Easy Windows Menu

Run:

```powershell
qa\qa-menu.bat
```

Recommended order:

1. Install/verify QA dependency.
2. Start local QA site.
3. Seed QA data.
4. Optional: run patient import workflow simulation.
5. Run smoke test.
6. Optional: run the new Needs-Action smoke check.
7. View status/result/logs.

The menu also includes a web dashboard option.

## Web Dashboard

Run:

```powershell
npm run qa:web
```

Then open:

```text
http://127.0.0.1:3200
```

The dashboard has no password and is intentionally bound to localhost by default. It also uses a temporary browser token for task buttons so random websites cannot easily trigger QA tasks while it is open. Do not expose it through FortiGate or the LAN unless you add real authentication.

The dashboard includes `FortiGate Mode`. Paste the current FortiGate web access URL and click `Run FortiGate Smoke` to test the real proxy path. The URL is used only for that run and is not saved to disk.

The dashboard also includes:

- `Run Needs Action Smoke`: seeds a patient in an expired 90-day cycle with an incomplete RX workflow and verifies:
  - Needs-action filter applies,
  - needs-action banner appears,
  - seeded patient appears in the filtered list,
  - expired RX workflow banner appears,
  - `Close RX Record` opens the centered access guidance modal.

## Direct Commands

```powershell
npm run qa:start
npm run qa:seed
npm run smoke:qa
npm run qa:status
npm run qa:stop
npm run qa:web
npm run test:rx-override
node scripts/simulate-patient-workflow-import.js
```

`npm run test:rx-override` runs focused controller-level scenarios for Patient service-date override, RX 90-day override permissions, expired RX close behavior, and Undo target order.

Visible browser mode:

```powershell
$env:QA_HEADLESS='false'
$env:QA_SLOW_MO='300'
npm run smoke:qa
```

Needs Action smoke mode:

```powershell
$env:QA_SMOKE_NEEDS_ACTION='true'
npm run smoke:qa
```

## Files Created By QA

- `qa/logs/backend.log` - local QA backend logs.
- `qa/logs/https-proxy.log` - local HTTPS proxy logs.
- `qa/results/seed-result.json` - IDs of seeded fake data.
- `qa/results/smoke-report.json` - last smoke test result.
- `QA web` / `qa-menu.bat` task output - simulation logs when running `simulate-import`.
- `qa/results/screenshots/` - screenshots for failed smoke runs.
- `qa/pids/` - process IDs for the local QA backend/proxy.
- `qa/certs/localhost.pfx` - self-signed localhost certificate generated for QA.

## Safety Rules

- Default QA database is `patient_rx_qa`.
- The seeder refuses database names that do not look like QA/test/staging unless `QA_ALLOW_NON_QA_DB=true`.
- Do not set `QA_DB_NAME` to the production database.
- The smoke test uses fake records with names like `QA Patient`, `QA Pharmacy`, and `QA Clinic`.

## Seed Modes

- `Seed Fake Data` creates/updates one stable baseline dataset used by the smoke test.
- `Add More Fake Data` creates a new unique QA batch each time, so repeated clicks add more records for manual testing.

Direct append command:

```powershell
$env:QA_SEED_APPEND='true'
npm run qa:seed
```

## FortiGate Note

This local QA setup is for `https://localhost:3443` so it does not conflict with a dev site on port `3000`. FortiGate validation should still be done separately through the real FortiGate portal URL because cookie paths and proxy rewriting can behave differently.

