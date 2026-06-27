# Home Accounting QA Web Dashboard Manual

## Purpose

The QA web dashboard is a local-only control panel for the smoke test scripts in this folder. It gives you buttons for the same commands that are available in `qa/qa-menu.bat`.

It is intended for QA/release testing only.

## Security Model

The dashboard has no password by design because it is only for local testing.

It does use a temporary browser token for task buttons. This is not a login. It only helps prevent another website from silently triggering QA tasks while the dashboard is open.

Default binding:

```text
http://127.0.0.1:3200
```

Do not expose this dashboard through FortiGate, the LAN, or the public internet. It can start/stop the local QA app and run scripts.

If you ever bind it remotely, add authentication first or use an isolated QA workstation.

## Start The Dashboard

From the project root:

```powershell
npm run qa:web
```

Then open:

```text
http://127.0.0.1:3200
```

Alternative through the batch menu:

```powershell
qa\qa-menu.bat
```

Then choose the QA web dashboard option.

## Recommended Workflow

1. Click `Start QA Site`.
2. Click `Seed Fake Data`.
3. Click `Run Smoke Test`.
4. Click `Run Needs Action Smoke` (optional validation of the needs-action workflow filter).
5. Review the `Latest Result` cards.
6. Review logs if a failure appears.
7. Click `Stop QA Site` when finished.

What the Needs Action smoke task checks:

- seeds a QA patient with service date older than 90 days and an incomplete workflow,
- validates the `needsAction` filter on Patients,
- verifies the needs-action banner is present,
- confirms the seeded patient appears in the filtered list.
- opens the expired RX workflow modal,
- verifies the `90-Day Window Expired` banner,
- verifies the `Close RX Record` option and centered access guidance modal.

## 90-Day Service Date Blocking Diagram

The 90-day rule is based on the patient's `Service Date`. That date starts the patient's active service window.

```text
Example seeded QA Service Date: 2026-06-24

                 ACTIVE 90-DAY WINDOW / BLOCKED
                 normal users cannot move Service Date here

2026-06-24      2026-07-24      2026-08-23      2026-09-22      2026-09-23
Day 0           Day 30          Day 60          Day 90          Day 91
|---------------|---------------|---------------|---------------|---->
Service Date                                    Window ends      Normal edits allowed
starts clock                                    after this day   after this point
```

Simple rule:

- `Patient.serviceDate` is the source of truth for the patient's 90-day clock.
- While the window is active, normal patient/RX service-date changes are blocked.
- During the active 90-day window, existing RX workflow steps can keep moving.
- After the window expires, old-cycle workflow edits require the role permission `canOverrideExpired`.
- Expired unfinished RX workflows show a centered access message and a `Close RX Record` resolution path.
- A normal new service cycle should start after the window expires.
- The Backoffice per-patient override changes one selected patient's service date.
- The Backoffice global override temporarily lifts the service-date 90-day block for all users.
- The global override does not remove unrelated safeguards like inactive-patient checks, workflow sequence rules, or the disabled RX reset-cycle endpoint.

Use the global override only during import correction, then turn it off again.

Focused controller-level validation:

```powershell
npm run test:rx-override
```

This creates temporary QA records and validates Patient service-date override, RX override permissions, expired RX close behavior, and Undo target order without clicking through the browser.

## Seed Fake Data vs Add More Fake Data

`Seed Fake Data` is intentionally idempotent. Pressing it again updates the same baseline QA records instead of creating duplicates. The smoke test depends on these stable records:

- `QA Patient`
- `QA Pharmacy`
- `QA Clinic`
- `QA Medication Action`
- `QA Received Warehouse`

Use `Add More Fake Data` when you want extra records for manual testing. Every click creates a unique QA batch with a timestamp-like suffix.

## FortiGate Mode

FortiGate mode runs the same smoke test through the real FortiGate web access URL instead of the local QA proxy.

Use this when you need to validate proxy-specific behavior:

- Cookie path handling.
- Login after refresh.
- Static assets under `/proxy/...`.
- API calls behind the FortiGate path.
- Redirects that may lose the proxy prefix.
- Headers stripped or rewritten by the proxy.

In the dashboard:

1. Paste the current FortiGate web access URL into `FortiGate QA URL`.
2. Click `Run FortiGate Smoke`.
3. Review `Current Task`, `Latest Result`, and logs.

Example URL:

```text
https://rx.camperos.net:10443/proxy/5b2552c5/http/192.168.60.21:3000
```

If you paste a page URL like:

```text
https://rx.camperos.net:10443/proxy/5b2552c5/http/192.168.60.21:3000/audit-log
```

the dashboard normalizes it back to the app root before running the smoke test.

The FortiGate URL is used only for that run and is not saved to disk.

## Visible Browser Mode

Click `Visible Smoke` if you want to watch Chrome move through the site.

This runs slower and is useful for debugging.

## Output Files

- `qa/results/smoke-report.json` - full smoke result.
- `qa/results/seed-result.json` - seeded fake record IDs.
- `qa/results/screenshots/` - failure screenshots.
- `qa/logs/backend.log` - local QA backend log.
- `qa/logs/https-proxy.log` - local HTTPS proxy log.
- `qa/pids/` - process IDs for the QA backend/proxy.

## What The Smoke Test Checks

- Login through HTTPS.
- Dashboard loads.
- Core pages open.
- Patients search works.
- RX Records search and workflow/history modals open.
- CRUD catalog pages show seeded data and open add modals.
- Reports page has action buttons.
- Backups page loads.
- System Settings page loads.
- Non-master admin is restricted from Backoffice.
- Authenticated dashboard API responds.

In FortiGate mode, these same checks run through the FortiGate URL you paste.

## What The Smoke Test Skips

The test intentionally does not click destructive or heavy actions:

- Backup restore.
- Delete/purge actions.
- Hide RX.
- Full backup execution.
- Any operation that could remove or overwrite data.

## Credentials

The dashboard itself has no password.

The smoke test still logs into the app using the QA login from `qa/.env.qa` or defaults:

```text
QA_LOGIN_USERNAME=admin
QA_LOGIN_PASSWORD=admin
```

The seeder creates or updates that QA login in the QA database.

Set `QA_SMOKE_NEEDS_ACTION=true` to run the optional Needs Action workflow smoke path from the command line. The QA web dashboard sets this automatically for `Run Needs Action Smoke`.

