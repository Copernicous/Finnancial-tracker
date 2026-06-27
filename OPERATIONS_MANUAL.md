# Home Accounting â€” Operations & Developer Manual

Version: 2.0.43 | Last Updated: 2026-06-25

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [File Tree](#3-file-tree)
4. [Environment Variables (.env)](#4-environment-variables)
5. [Running the Server](#5-running-the-server)
6. [Logging & Debug Mode](#6-logging--debug-mode)
7. [Building the Executable](#7-building-the-executable)
8. [Windows Service Setup](#8-windows-service-setup)
9. [Database](#9-database)
10. [User Roles & Permissions](#10-user-roles--permissions)
11. [Key Features Reference](#11-key-features-reference)
12. [Back Office â€” Data Control Center](#12-back-office--data-control-center)
13. [API Routes Summary](#13-api-routes-summary)
14. [Troubleshooting Guide](#14-troubleshooting-guide)
15. [Known Constraints & Notes](#15-known-constraints--notes)
16. [Deployment Checklist](#16-deployment-checklist)

---

## 1. System Overview

Home Accounting Management System is a Node.js/Express web application
that manages patient records, prescription (RX) delivery tracking, transport
companies, pharmacies, and reporting for a medical delivery operation.

- **Backend:** Node.js 22 + Express 5 + Sequelize ORM
- **Database:** PostgreSQL 14+
- **Frontend:** Server-rendered EJS templates + Vanilla JS + Bootstrap 5
- **Auth:** JWT (cookie-based) + optional 2FA (TOTP/QR code)
- **Production:** Compiled to single self-contained `server.exe` via @yao-pkg/pkg
- **Access:** Via FortiGate SSL VPN reverse proxy (HTTPS termination at proxy)

---

## 2. Architecture

```
Browser
  |
  | HTTPS (port 10443)
  v
FortiGate SSL VPN / Reverse Proxy
  |
  | HTTP (port 3000, internal)
  v
server.exe (Node.js 22, Express 5)
  |
  |-- /api/*        -> REST API routes (JSON)
  |-- /*            -> EJS-rendered HTML pages (web routes)
  |
  v
PostgreSQL 14+ (localhost:5432)
  database: home_accounting_dev
```

**Trust proxy** is set to 1 hop â€” this allows Express to read the real client IP
from X-Forwarded-For headers set by FortiGate. Do NOT expose port 3000 directly
to the internet.

---

## 3. File Tree

```
Home Accounting\                         <- Project root (source)
  app.js                            <- Entry point. CLI flags, middleware, routes.
  package.json                      <- Dependencies, build script, pkg config
  .env                              <- Runtime config (never commit to git)
  .env.example                      <- Template for .env (safe to share)
  CHANGELOG.md                      <- Version history with file-level detail
  OPERATIONS_MANUAL.md              <- This file
  pm2.config.js                     <- PM2 config (alternative to service install)
  setup.bat                         <- Windows first-run setup helper
  Home-Accounting-Manager.bat                    <- Quick launch shortcut

  controllers\                      <- Request handlers (one per resource)
  |   adminController.js            <- Back Office: table viewer, orphans, duplicates, purge
  |   authController.js             <- Login, logout, 2FA, JWT
  |   auditLogController.js         <- Read audit log entries
  |   dashboardController.js        <- Stats + chart data
  |   emailReportController.js      <- Send reports by email (SMTP)
  |   errorLogController.js         <- Backend error recording + client error capture
  |   importController.js           <- CSV bulk import
  |   medicationCatalogController.js
  |   patientController.js          <- CRUD for patients + soft delete
  |   patientLockController.js      <- Record locking (prevent concurrent edits)
  |   patientNoteController.js      <- Patient sticky notes
  |   patientTransportController.js
  |   pharmacyController.js
  |   pharmacyTransportController.js
  |   reportController.js           <- Generate reports (PDF, CSV, Excel)
  |   roleController.js             <- Role permissions management
  |   rxController.js               <- RX record CRUD
  |   searchController.js           <- Global search
  |   settingsController.js         <- System settings read/write
  |   snapshotController.js         <- Daily metrics snapshots
  |   twoFactorController.js        <- TOTP 2FA enable/disable/verify
  |   userController.js             <- User CRUD
  |   workflowActionController.js   <- RX workflow status tracking

  models\                           <- Sequelize ORM models
  |   index.js                      <- DB connection + model loader
  |   patient.js                    <- Patient (hasMany RXRecord, PatientNotes)
  |   rxrecord.js                   <- RX prescription record
  |   RXHistory.js                  <- Previous service dates history
  |   user.js                       <- User account + roles
  |   role.js                       <- Role definitions + permissions JSON
  |   patientnote.js                <- Sticky notes per patient
  |   patientlock.js                <- Record lock tracking
  |   auditlog.js                   <- Audit trail entries
  |   errorlog.js                   <- Backend error log entries
  |   clinic.js
  |   pharmacy.js
  |   medication.js
  |   medicationcatalog.js
  |   systemsetting.js              <- Key/value settings stored in DB
  |   dailysnapshot.js              <- Daily metrics history
  |   apikey.js                     <- API key management
  |   rxworkflowtracking.js         <- Per-step workflow completion tracking

  routes\                           <- Express router definitions
  |   webRoutes.js                  <- HTML page routes (GET /patients, etc.)
  |   apiRoutes.js                  <- All REST API routes
  |   patientRoutes.js
  |   rxRoutes.js
  |   authRoutes.js
  |   userRoutes.js
  |   reportRoutes.js
  |   auditLogRoutes.js
  |   importRoutes.js
  |   ... (one file per resource)

  middleware\
  |   auth.js                       <- JWT verification middleware
  |   auditLogger.js                <- Intercepts res.json() to log API actions
  |   roleCheck.js                  <- Permission enforcement per role

  services\
  |   backupService.js              <- Auto daily/weekly DB dump + full site ZIP scheduler
  |   snapshotService.js            <- Daily metrics capture
  |   settingsService.js            <- System settings cache (load from DB)
  |   emailService.js               <- Nodemailer SMTP wrapper

  utils\
  |   dateUtils.js                  <- parseDate() + fmtDate() (MM/DD/YYYY)

  views\                            <- EJS templates (bundled into server.exe)
  |   layout.ejs                    <- Master layout (sidebar, nav, dark mode)
  |   login.ejs
  |   dashboard.ejs
  |   patients.ejs
  |   rx-records.ejs                <- RX records + workflow modal
  |   reports.ejs
  |   users.ejs
  |   audit-log.ejs
  |   changelog.ejs
  |   system-settings.ejs
  |   backoffice.ejs                <- Back Office Data Control Center
  |   backups.ejs                   <- Backup Management page
  |   active-users.ejs              <- Who's Online monitor
  |   ... (one per page)

  public\                           <- Static files (bundled into server.exe)
  |   css\
  |   |   style.css                 <- Global styles + dark mode variables
  |   js\
  |   |   app.js                    <- Core: fetchWithAuth, JWT refresh, error capture
  |   |   patients.js               <- Patient list, cards, print, badges
  |   |   rx.js                     <- RX record management
  |   |   dashboard.js              <- Charts (Chart.js) + theme toggle
  |   |   reports.js                <- Report generation + email modal
  |   |   audit-log.js
  |   |   users.js
  |   |   system-settings.js
  |   |   changelog.js

  migrations\                       <- Sequelize DB schema migrations
  seeders\                          <- DB seed data
  config\
  |   config.json                   <- Sequelize DB config (reads from .env)
  |   settings.json                 <- Default system settings

  dist\                             <- PRODUCTION DEPLOYMENT FOLDER
  |   server.exe                    <- Compiled self-contained binary
  |   install-service.ps1           <- Windows Service installer
  |   uninstall-service.ps1         <- Windows Service remover
  |   README.md                     <- Quick-start guide (ships with exe)
  |   .env                          <- Copy from project root (not auto-copied)
  |   logs\                         <- Created automatically when LOG_FILE=true
  |   |   access-YYYY-MM-DD.log
  |   |   error-YYYY-MM-DD.log

  backups\                          <- Auto DB dump files (.dump format)
  logs\                             <- Dev-mode log files
  uploads\                          <- Uploaded files (imported CSVs, restore uploads)
  data\                             <- Static reference data + settings.json
```

---

## 4. Environment Variables

All configured in `.env` next to server.exe (or project root in dev mode).
**Never commit `.env` to git. Use `.env.example` as template.**

```env
# ---- Server ----------------------------------------------------------------
PORT=3000                           # HTTP port server listens on
NODE_ENV=production                 # production | development
TZ=America/New_York                 # Server timezone for timestamps

# ---- Database (PostgreSQL) -------------------------------------------------
DB_HOST=127.0.0.1                   # DB host (localhost or remote IP)
DB_PORT=5432                        # DB port (default 5432)
DB_NAME=home_accounting_dev              # Database name
DB_USER=postgres                    # DB login user
DB_PASS=yourpassword                # DB login password (note: DB_PASS not DB_PASSWORD)

# ---- Security --------------------------------------------------------------
JWT_SECRET=your-long-random-secret  # Min 32 chars. Change this in production!
SESSION_TIMEOUT_MINUTES=30          # Idle session timeout (minutes)
MAX_FAILED_LOGINS=5                 # Lock account after N failed logins

# ---- Network / Proxy -------------------------------------------------------
APP_ORIGIN=https://rx.yourdomain.com  # Allowed CORS origin (your proxy URL)
FORCE_HTTPS=false                     # true = redirect HTTP -> HTTPS

# ---- Email / SMTP (optional) -----------------------------------------------
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password         # Gmail: use App Password, not account password
SMTP_FROM_NAME=Home Accounting

# ---- Google Drive document storage (optional) ------------------------------
GOOGLE_DRIVE_ENABLED=false
GOOGLE_DRIVE_AUTH_MODE=oauth
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
GOOGLE_DRIVE_ROOT_FOLDER_ID=
GOOGLE_DRIVE_ROOT_FOLDER_NAME=Home Accounting Documents
GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive.file
DOCUMENT_UPLOAD_MAX_MB=25
DOCUMENT_STORAGE_LOCAL_DIR=uploads/documents
DOCUMENT_STORAGE_REQUIRE_DRIVE=false
DOCUMENT_STORAGE_ALLOW_LOCAL_FALLBACK=false

# ---- Logging ---------------------------------------------------------------
LOG_FILE=true                       # true = write logs to files in logs\
LOG_RETENTION_DAYS=7                # Delete log files older than N days on boot
DEBUG=false                         # true = verbose request logging (no recompile)

# ---- Backups ---------------------------------------------------------------
BACKUP_RETAIN=10                    # Max DB .dump files to keep (default 10)
BACKUP_SCHEDULE=0 2 * * *           # Cron for auto DB backup (default 2 AM daily)
SITE_BACKUP_RETAIN=5                # Max site ZIP files to keep (default 5)
SITE_BACKUP_DIR=C:\RX-SiteBackups  # Where site ZIPs are saved

# ---- PostgreSQL Tools (for GUI restore feature) ----------------------------
PGBIN=C:\Program Files\PostgreSQL\16\bin  # Optional: explicit path to pg_dump/pg_restore
```

### Changing settings without recompiling

All `.env` changes take effect on server restart â€” no recompile needed.
The only thing that requires a recompile is changes to `.js` or `.ejs` source files.

---

## 5. Running the Server

### Development (requires Node.js installed)
```bash
npm install           # First time only
npm run dev           # nodemon auto-restarts on file changes
npm start             # node app.js (no auto-restart)
```

### Production (compiled exe)
```
dist\server.exe --v                              # Show version and exit
dist\server.exe --version                        # Same as --v
dist\server.exe --reset-password admin NewPass   # Reset a user's password (emergency)
dist\server.exe                                  # Start the server
Ctrl+C                                           # Stop gracefully
```

### Emergency password reset
If you are locked out of the admin account, run without stopping the server:
```
server.exe --reset-password admin YourNewPassword
```
This connects to the DB, hashes the new password, updates the account,
resets the failed-login counter, unlocks any lockout, and exits immediately.
Works even if the server is already running (does not conflict).

### Startup output (when server starts)
```
[Log] File logging ON -- E:\...\dist\logs  (retain 7 days)
[Backup] Scheduler started with expression: 0 2 * * *
[SiteBackup] Weekly scheduler started: 0 3 * * 0
Server is running on port 3000.
```

---

## 6. Logging & Debug Mode

### Log files (when LOG_FILE=true in .env)

Stored next to server.exe in `logs\`:

| File                       | Contains                                        |
|----------------------------|-------------------------------------------------|
| `access-2026-06-23.log`    | All HTTP requests: IP, method, URL, status, ms  |
| `error-2026-06-23.log`     | console.error output + unhandled crashes        |

- New file created every day at midnight
- Files older than LOG_RETENTION_DAYS deleted on startup
- Both console AND file receive output simultaneously

### Debug mode

**No recompile required.** Just change `.env` and restart:

```env
DEBUG=true
```

Debug mode changes Morgan to `dev` format which shows:
```
GET /api/patients 200 47ms - 8984 bytes
POST /api/auth/login 401 12ms - 58 bytes
```

Color-coded by status code in the console. Useful for tracing:
- FortiGate proxy routing issues
- Slow API endpoints (response time in ms)
- Authentication failures (401/403 patterns)

To disable: set `DEBUG=false` and restart.

### Client-side error capture

The frontend automatically captures uncaught JavaScript errors and unhandled
Promise rejections and POSTs them to `/api/errors`. These are stored in the
`ErrorLogs` table and viewable in the Back Office â†’ Error Logs tab. Each entry
records the URL, error message, stack trace, browser, and timestamp â€” useful for
diagnosing issues that users encounter without needing to reproduce them locally.

---

## 7. Building the Executable

### Prerequisites
- Node.js 22+ installed on the BUILD machine (not needed on production)
- All npm packages installed: `npm install`
- PostgreSQL accessible for dev testing

### Build command
```bash
npm run build:exe
```

Which runs:
```
npx @yao-pkg/pkg@6.20.0 app.js --target node22-win-x64 --output dist/server.exe
```

### CRITICAL: Use @yao-pkg/pkg â€” NOT the old vercel pkg

| Tool              | npm package      | Works? | Notes                                    |
|-------------------|------------------|--------|------------------------------------------|
| @yao-pkg/pkg      | @yao-pkg/pkg     | YES    | Actively maintained, supports node22     |
| vercel pkg (old)  | pkg              | NO     | Does not bundle EJS views correctly      |

Signs you used the wrong build tool:
- `Error: Cannot find module 'ejs'` on startup
- `Failed to lookup view "login" in views directory`

### What gets bundled
- All `.js` source files (app.js, controllers, models, routes, middleware, services)
- All EJS templates (views\)
- All static files (public\)
- All config and data files
- bcryptjs (listed explicitly because dynamically required)

### What does NOT get bundled (must be in same folder as server.exe)
- `.env` (contains secrets, must be placed manually)
- `logs\` folder (created automatically at runtime)

### After compiling
1. Copy `dist\server.exe` to the production machine
2. Copy `.env` to the same folder as `server.exe`
3. Verify: `server.exe --v` shows the correct version number
4. Start: `server.exe`

---

## 8. Windows Service Setup

### Installing as a service (auto-start on boot, auto-restart on crash)

```powershell
# Run as Administrator
cd "path\to\dist"
.\install-service.ps1
```

The installer:
1. Downloads NSSM to `parent-of-dist\nssm\` (one-time)
2. Registers `server.exe` as Windows Service `PatientRXSystem`
3. Reads `.env` from the same folder as `server.exe` (fallback: parent folder) and injects all variables into the service environment
4. Configures auto-restart with 60-second throttle (max 3 restarts)
5. Writes stdout/stderr to `parent-of-dist\logs\` with daily rotation
6. Starts the service immediately

### Service management
```
net start PatientRXSystem    # Start
net stop  PatientRXSystem    # Stop
sc query  PatientRXSystem    # Check status
```

Or via: `services.msc` -> "Home Accounting"

### Uninstalling
```powershell
.\uninstall-service.ps1
```

### NSSM location
After install: `parent-of-dist\nssm\win64\nssm.exe`
NSSM is NOT placed inside `dist\` â€” only `server.exe` and the two scripts live in dist.

---

## 9. Database

### PostgreSQL requirements
- Version 14 or later
- Database must be created before first run
- User must have CREATE TABLE privileges

### Auto-migrations
On every startup, the server runs `db.sequelize.sync({ alter: true })` which:
- Creates missing tables automatically
- Adds missing columns to existing tables
- Does NOT delete existing data or columns

### Manual migrations (dev only)
```bash
npx sequelize-cli db:migrate
npx sequelize-cli db:seed:all
```

### FK Cascade Behavior (important for Back Office deletes)
The Back Office Database Manager handles FK relationships using a `FK_CHILDREN` map
in `adminController.js`. When deleting rows from a parent table, the system
automatically deletes or nullifies child/grandchild rows in the correct order:

| Delete from     | Cascade order                                                      |
|-----------------|--------------------------------------------------------------------|
| `Patients`      | RXHistories â†’ RXWorkflowTrackings â†’ Medications â†’ RXRecords â†’ PatientNotes â†’ PatientLocks |
| `RXRecords`     | RXHistories â†’ RXWorkflowTrackings â†’ Medications                    |
| `Pharmacies`    | Sets pharmacyId = NULL in RXRecords and Patients                   |
| `Users`         | Sets userId = NULL in RXHistories and AuditLogs                    |

### Backups
Automatic backups via `services/backupService.js`:
- **DB Backup:** Daily at 2:00 AM â†’ `backups\backup_YYYY-MM-DDTHH-MM-SS.dump`
- **Site Backup:** Sunday at 3:00 AM â†’ ZIP containing full app + fresh DB dump (stored outside project folder)
- Both schedules are configurable from the Backups page without recompiling
- Format: PostgreSQL custom dump (`.dump`), restore with `pg_restore`

> **Note:** The GUI "Upload & Restore" feature requires `pg_dump.exe` and `pg_restore.exe`
> to be installed on the server and in the PATH (or set PGBIN in .env).
> If these tools are not present, the daily CSV-format backups still work normally.
> Use the emergency manual restore method below if pg tools are unavailable.

Manual restore:
```bash
pg_restore -U postgres -d home_accounting_dev backup_2026-06-23.dump
```

---

## 10. User Roles & Permissions

| Role          | Patients | RX Records | Reports | Users | Settings | Backoffice |
|---------------|----------|------------|---------|-------|----------|------------|
| Administrator | Full     | Full       | Full    | Full  | Full     | Full       |
| Manager       | Full     | Full       | Full    | View  | View     | None       |
| Dispatcher    | View/Edit| Full       | View    | None  | None     | None       |
| Viewer        | View     | View       | View    | None  | None     | None       |

Permissions are stored as JSON in the `Roles` table and editable from:
`Administration â†’ Roles` (Administrator only).

### Role-based workflow permissions
Individual workflow steps (e.g. "Picked Up", "Delivered") can be locked to
specific roles. The workflow modal enforces these permissions and will show a
403 error if the logged-in user's role does not have permission to update a step.

---

## 11. Key Features Reference

### Patient Records
- Full CRUD with soft delete (`isDeleted` flag, not physical delete)
- Date format: MM/DD/YYYY in all inputs and exports
- Patient code auto-generated if not provided
- Duplicate detection on create
- Print preview: Classic layout and Card layout
- CSV import with duplicate handling
- Patient lock system: prevents concurrent edits (lock released on close/timeout)

### Action Button Badges (Patient List)
- RX Records button: shows count of active RX records (hidden when 0)
- History button: shows same RX count (hidden when 0)
- Timeline button: shows RX count + Notes count (hidden when 0)
- Notes button: shows note count (hidden when 0)

### Notes System
- Per-patient sticky notes with timestamp and author
- Note count badge on patient list row
- Role-based access control

### Patient Locks (Concurrent Edit Protection)
- When a user opens a patient record for editing, a soft lock is placed
- Other users see a "record locked" indicator and cannot save conflicting changes
- Lock expires automatically (configurable timeout)
- Locks are stored in the `PatientLocks` table and visible in the Back Office

### RX Records & Workflow
- Track delivery status through configurable workflow stages (Workflow Actions)
- Each stage is a step in the workflow modal, completable with timestamp + notes
- Role-based step permissions: each workflow action can be restricted to specific roles
- Service date tracking with history (previous service dates stored in `RXHistories`)
- Medication catalog integration (prescriptions linked to `MedicationCatalogs`)
- Workflow step state: pending â†’ completed (with undo support)

### Reports
- Patient reports, RX reports, daily summaries
- Export: PDF, CSV, Excel
- Email report via SMTP (configured in .env)
- Date range filtering

### Dashboard
- Patient counts, RX counts, delivery status charts (Chart.js)
- Dark/light mode â€” charts re-render automatically on theme toggle
- Daily snapshot history for trend tracking

### Dark Mode
- Toggle via moon/sun icon in navigation
- All pages including print preview support dark mode
- Classic print layout forces white background regardless of theme
- Preference saved in localStorage

### System Settings
- Timezone, session timeout, security settings
- Stored in PostgreSQL `SystemSettings` table (key/value)
- Loaded and cached at startup via settingsService
- Configurable from: `Administration â†’ System Settings`

### 2FA (Two-Factor Authentication)
- TOTP-based (compatible with Google Authenticator, Authy)
- Per-user opt-in
- QR code provisioning from profile page
- Backup codes supported

### Who's Online (Active Users Monitor)
- Real-time view of currently logged-in users
- Shows username, role, IP, last activity, and session age
- Accessible from sidebar â†’ Administration â†’ Who's Online
- Administrator only

### Backup Management (/backups)
- **Database Backup (DB Dump):** Daily scheduled PostgreSQL dump (pg_dump format)
  - Run manually with "Run Backup Now" button
  - Configurable retention count
  - Download individual backups
  - Delete individual backup files + history entries (including failed entries)
- **Full Site Backup (ZIP):** Weekly ZIP containing all application code + fresh DB dump
  - Saved outside the project folder (configurable via UI)
  - Run manually with "Create Full Site Backup Now" button
- **Restore from Backup:** Upload a .dump file to restore data (requires pg tools)
- **Backup History:** Shows status, timestamp, size, triggered-by, and error for all attempts
- **Configurable schedules:** Change cron expressions via UI without recompiling

### Global Search
- Search bar in the navigation header searches across patients, RX records, and pharmacies in real time
- Results grouped by category with direct navigation to matching record
- Powered by `controllers/searchController.js`

### Patient Timeline
- Per-patient chronological timeline combining RX records, notes, workflow events, and service history
- Accessible from the Timeline button on the patient list row
- Badge shows combined RX + Notes count; hidden when no events exist

### Patient/RX Document Uploads
- Patient modal: `Pictures & Documents` appears inside the patient window after a patient is opened
- RX modal: `Pictures & Documents` appears inside `View Details` for an existing RX record
- Accepts images, PDF, Office, CSV, and text files; default limit is `DOCUMENT_UPLOAD_MAX_MB`
- Uses Google Drive when `GOOGLE_DRIVE_ENABLED=true`; uploads fail instead of silently storing locally if Drive is unavailable
- Drive folders are organized under `Home Accounting Documents/Patients/{patient code - patient name - DOB}`
- Relative `DOCUMENT_STORAGE_LOCAL_DIR` values resolve beside the app/server.exe folder and are only a development fallback when Drive is disabled
- Upload/delete requires Edit permission on Patients or RX Records; read-only users can list/open/download

### CSV Import
- Bulk patient import via CSV upload (`/import` page)
- Template download included so users import in the correct column format
- Duplicate handling: detects and skips patients that already exist by name/code
- Progress feedback with success/error counts after import completes

### Medication Catalog
- Pharmacy-specific medication library (`/medication-catalog` or linked from RX Records)
- Prescriptions in RX Records are linked to `MedicationCatalog` entries
- Supports medication code, description, dosage, and unit tracking

### Pharmacies & Transport Companies
- Pharmacy directory: name, address, contact, linked patients and RX records
- Transport company directory: carrier/driver tracking linked to RX deliveries
- Both are manageable from their own pages and referenced in patient and RX records

### Roles Management (/roles)
- Full role permission matrix editable from the UI (Administrator only)
- Each permission key (read, write, delete, active_users, etc.) can be toggled per role
- Changes take effect immediately without restart
- 4 built-in roles: Administrator, Supervisor, Operator, Read Only
- New permission keys (e.g. `active_users`) are backfilled into existing roles on server startup without resetting custom values

### Maintenance Mode
- Toggle from Back Office â†’ Settings tab
- When enabled: a yellow banner is displayed to all users, and non-admin users cannot log in
- Admin can still log in and use the system normally during maintenance
- Controlled via the `maintenanceMode` key in `SystemSettings` table

### Changelog
- /changelog page shows version history from CHANGELOG.md
- "Git Commits" tab shows recent commits (DEV only â€” not available in server.exe)
- "Dev Only" badge on the Git Commits tab in production to avoid confusion

### API Key Management
- Generate and revoke API keys for external integrations
- Keys are scoped and stored in the `ApiKeys` table
- Managed from Back Office â†’ API Keys tab


---

## 12. Back Office â€” Data Control Center

**URL:** `/backoffice` (Administrator only)

The Back Office is an administrator-only control panel providing direct database
inspection, cleanup, and management tools. Access is blocked for all non-administrator
roles at both the route level and the UI level.

### Tabs

#### Tables & Data
- View live record counts for all 14 application tables
- **View** any table's raw data (paginated, with search)
- **Export CSV** for any table
- **Select** specific rows â†’ **Delete** with cascade handling (FK_CHILDREN map)
- **Purge** entire table (with confirmation) in safe dependency order

#### Schema
- Full column-level schema for all tables: data type, nullable, default value
- FK relationship map showing which tables reference which

#### Orphans
- Detects rows with broken FK references (e.g. RXRecords whose patientId no longer exists)
- "Clean" button removes orphaned rows with automatic grandchild cascade
- Runs within a transaction â€” safe to use in production

#### Duplicates
- Detects duplicate Patients by full name or phone number
- Shows all duplicate groups with record details
- Helps identify data quality issues

#### Audit Log
- Searchable, paginated view of all audit trail entries
- Filter by user, action, entity, date range

#### Settings
- Read/write system settings directly (Administrator override)

#### Backups
- Quick access to backup status and history (same as /backups page)
- Create and manage DB + site backups

#### Health
- Server health indicators: uptime, memory, DB connection status

#### Locks
- View and release patient record locks stuck after a crash or timeout

#### Users
- View and manage user accounts directly from the Back Office
- Reset passwords, change roles, lock/unlock accounts

#### API Keys
- Generate, view, and revoke API keys for external system integrations

#### Error Logs
- Client-side JavaScript errors captured automatically from all users' browsers
- Server-side errors logged to this table
- Searchable by URL, message, stack, browser, date
- "Stack" button expands full stack trace for each error

#### Analytics
- System usage statistics and trends

---

## 13. API Routes Summary

All API routes require `Authorization: Bearer <token>` header OR a valid JWT cookie.
Tokens obtained from `POST /api/auth/login`.

| Method | Route                              | Description                             |
|--------|------------------------------------|-----------------------------------------|
| POST   | /api/auth/login                    | Login, returns JWT token                |
| POST   | /api/auth/logout                   | Invalidate token                        |
| GET    | /api/patients                      | List patients (?includeDeleted=true)    |
| POST   | /api/patients                      | Create patient                          |
| PUT    | /api/patients/:id                  | Update patient                          |
| DELETE | /api/patients/:id                  | Soft delete patient                     |
| GET    | /api/patients/:id/documents        | List patient uploads                    |
| POST   | /api/patients/:id/documents        | Upload patient pictures/documents       |
| GET    | /api/rx                            | List RX records                         |
| POST   | /api/rx                            | Create RX record                        |
| PUT    | /api/rx/:id                        | Update RX record                        |
| GET    | /api/rx-records/:id/documents      | List RX uploads                         |
| POST   | /api/rx-records/:id/documents      | Upload RX pictures/documents            |
| GET    | /api/documents/:id/download        | Open/download an uploaded document      |
| DELETE | /api/documents/:id                 | Delete an uploaded document             |
| GET    | /api/workflow/:rxId                | Get workflow steps for an RX record     |
| POST   | /api/workflow/:rxId/:stepId        | Complete/undo a workflow step           |
| GET    | /api/reports/:type                 | Generate report                         |
| POST   | /api/email-report                  | Send report by email                    |
| GET    | /api/audit-logs                    | Get audit log (paginated)               |
| GET    | /api/users                         | List users                              |
| GET    | /api/dashboard/stats               | Summary counts                          |
| GET    | /api/dashboard/charts              | Chart data                              |
| GET    | /api/version                       | Server version info (auth required)     |
| GET    | /api/settings                      | System settings                         |
| PUT    | /api/settings                      | Update system settings                  |
| GET    | /api/backups/status                | DB backup history + schedule            |
| POST   | /api/backups/run                   | Trigger manual DB backup                |
| DELETE | /api/backups/:filename             | Delete a DB backup file + log entry     |
| DELETE | /api/backups/history/:id           | Delete a failed history entry (no file) |
| GET    | /api/backups/site/status           | Site backup history + schedule          |
| POST   | /api/backups/site/run              | Trigger manual site ZIP backup          |
| DELETE | /api/backups/site/:filename        | Delete a site ZIP + log entry           |
| DELETE | /api/backups/site/history/:id      | Delete a failed site history entry      |
| GET    | /api/admin/tables                  | List all tables with record counts      |
| GET    | /api/admin/rows/:table             | View rows in a table (paginated)        |
| POST   | /api/admin/delete-rows             | Delete specific rows with FK cascade    |
| POST   | /api/admin/purge                   | Purge entire table (safe order)         |
| GET    | /api/admin/orphans                 | List orphaned rows by FK pair           |
| DELETE | /api/admin/orphans                 | Clean orphaned rows (cascades children) |
| GET    | /api/admin/duplicates              | Find duplicate patients                 |
| POST   | /api/errors                        | Log a client-side error                 |
| GET    | /api/errors                        | List error log entries (admin only)     |

---

## 14. Troubleshooting Guide

### Server won't start
- Check .env is present next to server.exe
- Check DB_PASS is correct (note: key is `DB_PASS` not `DB_PASSWORD`)
- Check PostgreSQL is running: `sc query postgresql-x64-14`
- Check port is free: `netstat -ano | findstr :3000`

### Login page shows {"error":"Internal server error"}
- If using server.exe: likely wrong build tool used. Rebuild with `npm run build:exe`
- Signs: `Cannot find module 'ejs'` or `Failed to lookup view "login"` in logs
- Fix: recompile using `@yao-pkg/pkg` (not vercel `pkg`)

### "Network error" when completing a workflow step
- Check that the user's role has permission for that workflow action
- A 403 from the server is the most common cause
- Check browser console for the actual error response
- Check Back Office â†’ Error Logs for captured client-side errors
### Administrator sees a View Only banner on patient or record modals
- Fixed in v2.0.43: the browser permission helper now treats `Administrator` as full access, matching backend RBAC.
- Fixed again in BUG-47: the helper also recognizes stale auth objects by JWT role, `Role.name`, and `roleId: 1`.
- Fixed again in BUG-48: the Patient modal now has its own direct Administrator guard before showing the View Only banner.
- If a browser still shows the banner after deploying the fix, restart the app and force-refresh the page; log out and back in if the session token predates the deployment.
- Non-admin users should still be checked through `Administration â†’ Roles` for the relevant module's Add/Edit permissions.

### Can't delete a Patient/RXRecord from Back Office (FK constraint error)
- This was fixed in v2.0.1 and v2.0.2
- Ensure you are running v2.0.1+ (`server.exe --v`)
- The system now automatically deletes grandchildren (RXHistories â†’ RXWorkflowTrackings â†’ Medications) before deleting RXRecords

### Trash bin on failed backup entries does nothing
- Fixed in v2.0.4
- Failed entries (no .dump file created) are now deleted via `/api/backups/history/:id`
- Ensure you are running v2.0.4+ on the server

### Backup restore fails with "pg_dump not found" / "pg_restore not found"
- PostgreSQL client tools are not installed on the server or not in PATH
- Fix option 1: Install PostgreSQL on the server (full install, not just the engine)
- Fix option 2: Set `PGBIN=C:\Program Files\PostgreSQL\16\bin` in .env
- The daily scheduled DB backups are NOT affected by this â€” they use Sequelize directly
- The GUI "Upload & Restore .dump" feature DOES require these tools

### Can't log in (forgot admin password)
Run from command line (server does NOT need to be stopped):
```
server.exe --reset-password admin YourNewPassword
```
For dev mode:
```
node app.js --reset-password admin YourNewPassword
```

### Audit log not recording deletes
- Route must return `res.json()` not `res.status(204).send()`
- The auditLogger middleware hooks into res.json() only

### Date showing as YYYY-MM-DD instead of MM/DD/YYYY
- Use `window.fmtDate(value)` in all frontend JS date displays
- Use `parseDate()` from `utils/dateUtils.js` on all backend date inputs

### Charts invisible or wrong color after dark mode toggle
- Charts must be destroyed and re-created on theme change
- dashboard.js listens to the theme toggle click and calls Chart.destroy() before re-render

### Email report not sending
- Check SMTP_HOST, SMTP_USER, SMTP_PASS in .env
- Gmail: use App Password (not account password), enable 2-Step Verification first
- Check error log for SMTP connection errors

### Session keeps timing out
- Adjust SESSION_TIMEOUT_MINUTES in .env (default 30)
- Does not require recompile

---

## 15. Known Constraints & Notes

### FortiGate Proxy
- Trust proxy set to 1 hop in app.js
- All JS event handlers should use event delegation where possible
- CSS: some properties may be stripped by FortiGate content inspection
- All API calls go through `fetchWithAuth()` in `public/js/app.js` which handles
  JWT attachment, 401 auto-redirect, and 403 silent handling

### Compilation
- ALWAYS use `npm run build:exe` (uses @yao-pkg/pkg)
- NEVER use plain `npx pkg` (vercel pkg v5) â€” breaks EJS and views
- Arrow functions (=>) are fine
- The `.env` file is NEVER bundled â€” must be placed manually next to server.exe

### Database
- `db.sequelize.sync({ alter: true })` runs on every start
- Avoid renaming columns in migrations â€” alter:true won't rename, only add
- RXRecord soft delete: always use `isDeleted: false` WHERE clause in includes
- FK cascade deletions in Back Office are handled by the `FK_CHILDREN` map in
  `adminController.js` â€” update this map when adding new FK relationships

### Backups
- DB dump format is PostgreSQL custom format (`-F c`) â€” requires `pg_restore` to restore
- Site backups are stored OUTSIDE the project folder (default: `C:\RX-SiteBackups`)
- Both DB backup folder (fixed inside project) and site backup folder (configurable) are
  created automatically if they do not exist

### Frontend
- All date rendering must use `window.fmtDate()` from public/js
- Badge pills use position:absolute â€” parent button must have position:relative
- Dark mode state stored in localStorage key 'rxTheme'
- `fetchWithAuth()` returns `null` on 403 â€” always null-check the response

---

## 16. Deployment Checklist

### First deployment
- [ ] PostgreSQL 14+ installed and running
- [ ] Database created: `createdb -U postgres home_accounting_dev`
- [ ] `.env` file filled with correct values (especially JWT_SECRET and DB_PASS)
- [ ] PORT 3000 open on firewall (or set different PORT)
- [ ] `dist\server.exe` and `.env` in same folder
- [ ] Test: `server.exe --v` shows correct version
- [ ] Test: browse to `http://server-ip:3000/login`
- [ ] Change default admin password after first login (or use `--reset-password`)

### After every recompile
- [ ] Stop the running server.exe (or service)
- [ ] Replace server.exe with new `dist\server.exe`
- [ ] Verify .env is still present and correct (settings are not bundled)
- [ ] Start server and check startup log
- [ ] Browse to /login and confirm it loads
- [ ] Run `server.exe --v` to confirm version number matches expected

### Updating .env only (no recompile)
- [ ] Stop the server
- [ ] Edit .env
- [ ] Start the server
- [ ] No other steps needed

### After adding a new FK relationship (for developers)
- [ ] Add the new child entry to `FK_CHILDREN` in `controllers/adminController.js`
- [ ] Add the table to `TABLE_META` array with correct `dependsOn` value
- [ ] Test deletion from Back Office to confirm no FK constraint errors
- [ ] Recompile and deploy

---

*This document covers v2.0.4. Keep it updated when adding features.*
*See CHANGELOG.md for version-by-version change history.*


---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [File Tree](#3-file-tree)
4. [Environment Variables (.env)](#4-environment-variables)
5. [Running the Server](#5-running-the-server)
6. [Logging & Debug Mode](#6-logging--debug-mode)
7. [Building the Executable](#7-building-the-executable)
8. [Windows Service Setup](#8-windows-service-setup)
9. [Database](#9-database)
10. [User Roles & Permissions](#10-user-roles--permissions)
11. [Key Features Reference](#11-key-features-reference)
12. [API Routes Summary](#12-api-routes-summary)
13. [Troubleshooting Guide](#13-troubleshooting-guide)
14. [Known Constraints & Notes](#14-known-constraints--notes)
15. [Deployment Checklist](#15-deployment-checklist)

---

## 1. System Overview

Home Accounting Management System is a Node.js/Express web application
that manages patient records, prescription (RX) delivery tracking, transport
companies, pharmacies, and reporting for a medical delivery operation.

- **Backend:** Node.js 22 + Express 5 + Sequelize ORM
- **Database:** PostgreSQL 14+
- **Frontend:** Server-rendered EJS templates + Vanilla JS + Bootstrap 5
- **Auth:** JWT (cookie-based) + optional 2FA (TOTP/QR code)
- **Production:** Compiled to single self-contained `server.exe` via @yao-pkg/pkg
- **Access:** Via FortiGate SSL VPN reverse proxy (HTTPS termination at proxy)

---

## 2. Architecture

```
Browser
  |
  | HTTPS (port 10443)
  v
FortiGate SSL VPN / Reverse Proxy
  |
  | HTTP (port 3000, internal)
  v
server.exe (Node.js 22, Express 5)
  |
  |-- /api/*        -> REST API routes (JSON)
  |-- /*            -> EJS-rendered HTML pages (web routes)
  |
  v
PostgreSQL 14+ (localhost:5432)
  database: home_accounting_dev
```

**Trust proxy** is set to 1 hop â€” this allows Express to read the real client IP
from X-Forwarded-For headers set by FortiGate. Do NOT expose port 3000 directly
to the internet.

---

## 3. File Tree

```
Home Accounting\                         <- Project root (source)
  app.js                            <- Entry point. CLI flags, middleware, routes.
  package.json                      <- Dependencies, build script, pkg config
  .env                              <- Runtime config (never commit to git)
  .env.example                      <- Template for .env (safe to share)
  CHANGELOG.md                      <- Version history with file-level detail
  OPERATIONS_MANUAL.md              <- This file
  pm2.config.js                     <- PM2 config (alternative to service install)
  setup.bat                         <- Windows first-run setup helper
  Home-Accounting-Manager.bat                    <- Quick launch shortcut

  app.js                            <- Main Express app
  |
  controllers\                      <- Request handlers (one per resource)
  |   adminController.js            <- Admin user management
  |   authController.js             <- Login, logout, 2FA, JWT
  |   auditLogController.js         <- Read audit log entries
  |   dashboardController.js        <- Stats + chart data
  |   emailReportController.js      <- Send reports by email (SMTP)
  |   errorLogController.js         <- Backend error recording
  |   importController.js           <- CSV bulk import
  |   medicationCatalogController.js
  |   patientController.js          <- CRUD for patients + soft delete
  |   patientLockController.js      <- Record locking (prevent concurrent edits)
  |   patientNoteController.js      <- Patient sticky notes
  |   patientTransportController.js
  |   pharmacyController.js
  |   pharmacyTransportController.js
  |   reportController.js           <- Generate reports (PDF, CSV, Excel)
  |   roleController.js             <- Role permissions management
  |   rxController.js               <- RX record CRUD
  |   searchController.js           <- Global search
  |   settingsController.js         <- System settings read/write
  |   snapshotController.js         <- Daily metrics snapshots
  |   twoFactorController.js        <- TOTP 2FA enable/disable/verify
  |   userController.js             <- User CRUD
  |   workflowActionController.js   <- RX workflow status tracking

  models\                           <- Sequelize ORM models
  |   index.js                      <- DB connection + model loader
  |   patient.js                    <- Patient (hasMany RXRecord, PatientNotes)
  |   rxrecord.js                   <- RX prescription record
  |   RXHistory.js                  <- Previous service dates history
  |   user.js                       <- User account + roles
  |   role.js                       <- Role definitions + permissions JSON
  |   patientnote.js                <- Sticky notes per patient
  |   patientlock.js                <- Record lock tracking
  |   auditlog.js                   <- Audit trail entries
  |   errorlog.js                   <- Backend error log entries
  |   clinic.js
  |   pharmacy.js
  |   medication.js
  |   medicationcatalog.js
  |   systemsetting.js              <- Key/value settings stored in DB
  |   dailysnapshot.js              <- Daily metrics history
  |   apikey.js                     <- API key management
  |   rxworkflowtracking.js

  routes\                           <- Express router definitions
  |   webRoutes.js                  <- HTML page routes (GET /patients, etc.)
  |   patientRoutes.js
  |   rxRoutes.js
  |   authRoutes.js
  |   userRoutes.js
  |   reportRoutes.js
  |   auditLogRoutes.js
  |   importRoutes.js
  |   ... (one file per resource)

  middleware\
  |   auth.js                       <- JWT verification middleware
  |   auditLogger.js                <- Intercepts res.json() to log API actions
  |   roleCheck.js                  <- Permission enforcement per role

  services\
  |   backupService.js              <- Auto daily/weekly DB dump scheduler
  |   snapshotService.js            <- Daily metrics capture
  |   settingsService.js            <- System settings cache (load from DB)
  |   emailService.js               <- Nodemailer SMTP wrapper

  utils\
  |   dateUtils.js                  <- parseDate() + fmtDate() (MM/DD/YYYY)

  views\                            <- EJS templates (bundled into server.exe)
  |   layout.ejs                    <- Master layout (sidebar, nav, dark mode)
  |   login.ejs
  |   dashboard.ejs
  |   patients.ejs
  |   rx.ejs
  |   reports.ejs
  |   users.ejs
  |   audit-log.ejs
  |   changelog.ejs
  |   system-settings.ejs
  |   ... (one per page)

  public\                           <- Static files (bundled into server.exe)
  |   css\
  |   |   style.css                 <- Global styles + dark mode variables
  |   js\
  |   |   patients.js               <- Patient list, cards, print, badges
  |   |   rx.js                     <- RX record management
  |   |   dashboard.js              <- Charts (Chart.js) + theme toggle
  |   |   reports.js                <- Report generation + email modal
  |   |   audit-log.js
  |   |   users.js
  |   |   system-settings.js
  |   |   changelog.js

  migrations\                       <- Sequelize DB schema migrations
  seeders\                          <- DB seed data
  config\
  |   config.json                   <- Sequelize DB config (reads from .env)
  |   settings.json                 <- Default system settings

  dist\                             <- PRODUCTION DEPLOYMENT FOLDER
  |   server.exe                    <- Compiled self-contained binary
  |   install-service.ps1           <- Windows Service installer
  |   uninstall-service.ps1         <- Windows Service remover
  |   README.md                     <- Quick-start guide (ships with exe)
  |   .env                          <- Copy from project root (not auto-copied)
  |   logs\                         <- Created automatically when LOG_FILE=true
  |   |   access-YYYY-MM-DD.log
  |   |   error-YYYY-MM-DD.log

  backups\                          <- Auto DB dump files (.dump format)
  logs\                             <- Dev-mode log files
  uploads\                          <- Uploaded files (imported CSVs, etc.)
  data\                             <- Static reference data
```

---

## 4. Environment Variables

All configured in `.env` next to server.exe (or project root in dev mode).
**Never commit `.env` to git. Use `.env.example` as template.**

```env
# ---- Server ----------------------------------------------------------------
PORT=3000                           # HTTP port server listens on
NODE_ENV=production                 # production | development
TZ=America/New_York                 # Server timezone for timestamps

# ---- Database (PostgreSQL) -------------------------------------------------
DB_HOST=127.0.0.1                   # DB host (localhost or remote IP)
DB_PORT=5432                        # DB port (default 5432)
DB_NAME=home_accounting_dev              # Database name
DB_USER=postgres                    # DB login user
DB_PASSWORD=yourpassword            # DB login password

# ---- Security --------------------------------------------------------------
JWT_SECRET=your-long-random-secret  # Min 32 chars. Change this in production!
SESSION_TIMEOUT_MINUTES=30          # Idle session timeout (minutes)
MAX_FAILED_LOGINS=5                 # Lock account after N failed logins

# ---- Network / Proxy -------------------------------------------------------
APP_ORIGIN=https://rx.yourdomain.com  # Allowed CORS origin (your proxy URL)
FORCE_HTTPS=false                     # true = redirect HTTP -> HTTPS

# ---- Email / SMTP (optional) -----------------------------------------------
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password         # Gmail: use App Password, not account password
SMTP_FROM_NAME=Home Accounting

# ---- Logging ---------------------------------------------------------------
LOG_FILE=true                       # true = write logs to files in logs\
LOG_RETENTION_DAYS=7                # Delete log files older than N days on boot
DEBUG=false                         # true = verbose request logging (no recompile)
```

### Changing settings without recompiling

All `.env` changes take effect on server restart â€” no recompile needed.
The only thing that requires a recompile is changes to `.js` or `.ejs` source files.

---

## 5. Running the Server

### Development (requires Node.js installed)
```bash
npm install           # First time only
npm run dev           # nodemon auto-restarts on file changes
npm start             # node app.js (no auto-restart)
```

### Production (compiled exe)
```
dist\server.exe --v   # Show version and exit (does NOT start the server)
dist\server.exe       # Start the server
Ctrl+C                # Stop gracefully
```

### Startup output (when server starts)
```
[Log] File logging ON -- E:\...\dist\logs  (retain 7 days)
Server is running on port 3000.
```

---

## 6. Logging & Debug Mode

### Log files (when LOG_FILE=true in .env)

Stored next to server.exe in `logs\`:

| File                       | Contains                                        |
|----------------------------|-------------------------------------------------|
| `access-2026-06-23.log`    | All HTTP requests: IP, method, URL, status, ms  |
| `error-2026-06-23.log`     | console.error output + unhandled crashes        |

- New file created every day at midnight
- Files older than LOG_RETENTION_DAYS deleted on startup
- Both console AND file receive output simultaneously

### Debug mode

**No recompile required.** Just change `.env` and restart:

```env
DEBUG=true
```

Debug mode changes Morgan to `dev` format which shows:
```
GET /api/patients 200 47ms - 8984 bytes
POST /api/auth/login 401 12ms - 58 bytes
```

Color-coded by status code in the console. Useful for tracing:
- FortiGate proxy routing issues
- Slow API endpoints (response time in ms)
- Authentication failures (401/403 patterns)

To disable: set `DEBUG=false` and restart.

### Database query logging (advanced)

Not enabled by default. To see raw SQL queries, temporarily add to .env:
```env
DB_LOGGING=true
```
Then in `models/index.js`, set `logging: process.env.DB_LOGGING === 'true'`.

---

## 7. Building the Executable

### Prerequisites
- Node.js 22+ installed on the BUILD machine (not needed on production)
- All npm packages installed: `npm install`
- PostgreSQL accessible for dev testing

### Build command
```bash
npm run build:exe
```

Which runs:
```
npx --yes @yao-pkg/pkg app.js --target node22-win-x64 --output dist/server.exe --compress GZip
```

### CRITICAL: Use @yao-pkg/pkg â€” NOT the old vercel pkg

| Tool              | npm package      | Works? | Notes                                    |
|-------------------|------------------|--------|------------------------------------------|
| @yao-pkg/pkg      | @yao-pkg/pkg     | YES    | Actively maintained, supports node22     |
| vercel pkg (old)  | pkg              | NO     | Does not bundle EJS views correctly      |

Signs you used the wrong build tool:
- `Error: Cannot find module 'ejs'` on startup
- `Failed to lookup view "login" in views directory`

### What gets bundled
- All `.js` source files (app.js, controllers, models, routes, middleware, services)
- All EJS templates (views\)
- All static files (public\)
- All config and data files
- bcryptjs (listed explicitly because dynamically required)

### What does NOT get bundled (must be in same folder as server.exe)
- `.env` (contains secrets, must be placed manually)
- `logs\` folder (created automatically at runtime)

### After compiling
1. Copy `dist\server.exe` to the production machine
2. Copy `.env` to the same folder as `server.exe`
3. Start: `server.exe`

---

## 8. Windows Service Setup

### Installing as a service (auto-start on boot, auto-restart on crash)

```powershell
# Run as Administrator
cd "path\to\dist"
.\install-service.ps1
```

The installer:
1. Downloads NSSM to `parent-of-dist\nssm\` (one-time)
2. Registers `server.exe` as Windows Service `PatientRXSystem`
3. Reads `.env` from the same folder as `server.exe` (fallback: parent folder) and injects all variables into the service environment
4. Configures auto-restart with 60-second throttle (max 3 restarts)
5. Writes stdout/stderr to `parent-of-dist\logs\` with daily rotation
6. Starts the service immediately

### Service management
```
net start PatientRXSystem    # Start
net stop  PatientRXSystem    # Stop
sc query  PatientRXSystem    # Check status
```

Or via: `services.msc` -> "Home Accounting"

### Uninstalling
```powershell
.\uninstall-service.ps1
```

### NSSM location
After install: `parent-of-dist\nssm\win64\nssm.exe`
NSSM is NOT placed inside `dist\` â€” only `server.exe` and the two scripts live in dist.

---

## 9. Database

### PostgreSQL requirements
- Version 14 or later
- Database must be created before first run
- User must have CREATE TABLE privileges

### Auto-migrations
On every startup, the server runs `db.sequelize.sync({ alter: true })` which:
- Creates missing tables automatically
- Adds missing columns to existing tables
- Does NOT delete existing data or columns

### Manual migrations (dev only)
```bash
npx sequelize-cli db:migrate
npx sequelize-cli db:seed:all
```

### Backups
Automatic backups via `services/backupService.js`:
- Daily: 2:00 AM -> `backups\backup_YYYY-MM-DDTHH-MM-SS.dump`
- Weekly: Sunday 3:00 AM -> same location
- Format: PostgreSQL custom dump (`.dump`), restore with `pg_restore`

Manual restore:
```bash
pg_restore -U postgres -d home_accounting_dev backup_2026-06-23.dump
```

---

## 10. User Roles & Permissions

| Role          | Patients | RX Records | Reports | Users | Settings | Notes |
|---------------|----------|------------|---------|-------|----------|-------|
| admin         | Full     | Full       | Full    | Full  | Full     | Full  |
| manager       | Full     | Full       | Full    | View  | View     | Full  |
| dispatcher    | View/Edit| Full       | View    | None  | None     | Full  |
| viewer        | View     | View       | View    | None  | None     | View  |

Permissions are stored as JSON in the `roles` table and editable from Settings > Roles.

---

## 11. Key Features Reference

### Patient Records
- Full CRUD with soft delete (isDeleted flag, not physical delete)
- Date format: MM/DD/YYYY in all inputs and exports
- Patient code auto-generated if not provided
- Duplicate detection on create
- Print preview: Classic layout and Card layout
- CSV import with duplicate handling

### Action Button Badges (Patient List)
- RX Records button: shows count of active RX records (hidden when 0)
- History button: shows same RX count (hidden when 0)
- Timeline button: shows RX count + Notes count (hidden when 0)
- Notes button: shows note count (hidden when 0)

### Notes System
- Per-patient sticky notes with timestamp and author
- Note count badge on patient list row
- Role-based access control

### Audit Log
- Records all create/edit/delete/restore actions via auditLogger middleware
- Captured via res.json() hook (routes returning res.send() or 204 are NOT logged)
- Viewable at /audit-log with filtering by user, action, module, date

### RX Records & Workflow
- Track delivery status through configurable workflow stages
- Service date tracking with history (previous service dates)
- Medication catalog integration

### Reports
- Patient reports, RX reports, daily summaries
- Export: PDF, CSV, Excel
- Email report via SMTP (configured in .env)
- Date range filtering

### Dashboard
- Patient counts, RX counts, delivery status charts (Chart.js)
- Dark/light mode â€” charts re-render automatically on theme toggle
- Daily snapshot history for trend tracking

### Dark Mode
- Toggle via moon/sun icon in navigation
- All pages including print preview support dark mode
- Classic print layout forces white background regardless of theme
- Preference saved in localStorage

### System Settings
- Timezone, session timeout, security settings
- Stored in PostgreSQL `SystemSettings` table (key/value)
- Loaded and cached at startup via settingsService

### 2FA (Two-Factor Authentication)
- TOTP-based (compatible with Google Authenticator, Authy)
- Per-user opt-in
- QR code provisioning from profile page
- Backup codes supported

### Changelog
- /changelog page shows version history from CHANGELOG.md
- "Git Commits" tab shows recent commits (DEV only â€” not available in server.exe)

---

## 12. API Routes Summary

All API routes require `Authorization: Bearer <token>` header.
Tokens obtained from `POST /api/auth/login`.

| Method | Route                      | Description                        |
|--------|----------------------------|------------------------------------|
| POST   | /api/auth/login            | Login, returns JWT token           |
| POST   | /api/auth/logout           | Invalidate token                   |
| GET    | /api/patients              | List patients (supports ?includeDeleted=true) |
| POST   | /api/patients              | Create patient                     |
| PUT    | /api/patients/:id          | Update patient                     |
| DELETE | /api/patients/:id          | Soft delete patient                |
| GET    | /api/rx                    | List RX records                    |
| POST   | /api/rx                    | Create RX record                   |
| GET    | /api/reports/:type         | Generate report                    |
| POST   | /api/email-report          | Send report by email               |
| GET    | /api/audit-logs            | Get audit log (paginated)          |
| GET    | /api/users                 | List users                         |
| GET    | /api/dashboard/stats       | Summary counts                     |
| GET    | /api/dashboard/charts      | Chart data                         |
| GET    | /api/version               | Server version info (auth required)|
| GET    | /api/settings              | System settings                    |
| PUT    | /api/settings              | Update system settings             |

---

## 13. Troubleshooting Guide

### Server won't start
- Check .env is present next to server.exe
- Check DB_PASSWORD is correct
- Check PostgreSQL is running: `sc query postgresql-x64-14`
- Check port is free: `netstat -ano | findstr :3000`

### Login page shows {"error":"Internal server error"}
- If using server.exe: likely wrong build tool used. Rebuild with `npm run build:exe`
- Signs: `Cannot find module 'ejs'` or `Failed to lookup view "login"` in logs
- Fix: recompile using `@yao-pkg/pkg` (not vercel `pkg`)

### Unicode characters in app.js break compilation
- The @yao-pkg/pkg tool handles UTF-8 correctly
- The old vercel pkg v5 did NOT â€” caused "Internal server error" on all page loads
- Solution: always use `npm run build:exe` which uses @yao-pkg/pkg

### Audit log not recording deletes
- Route must return `res.json()` not `res.status(204).send()`
- The auditLogger middleware hooks into res.json() only

### Date showing as YYYY-MM-DD instead of MM/DD/YYYY
- Use `window.fmtDate(value)` in all frontend JS date displays
- Use `parseDate()` from `utils/dateUtils.js` on all backend date inputs

### Charts invisible or wrong color after dark mode toggle
- Charts must be destroyed and re-created on theme change
- dashboard.js listens to the theme toggle click and calls Chart.destroy() before re-render

### Email report not sending
- Check SMTP_HOST, SMTP_USER, SMTP_PASS in .env
- Gmail: use App Password (not account password), enable 2-Step Verification first
- Check error log for SMTP connection errors

### Session keeps timing out
- Adjust SESSION_TIMEOUT_MINUTES in .env (default 30)
- Does not require recompile

---

## 14. Known Constraints & Notes

### FortiGate Proxy
- Trust proxy set to 1 hop in app.js
- All JS event handlers must use event delegation (addEventListener on container)
- Avoid inline onclick attributes in dynamically built HTML strings
- CSS: some properties may be stripped by FortiGate content inspection

### Compilation
- ALWAYS use `npm run build:exe` (uses @yao-pkg/pkg)
- NEVER use plain `npx pkg` (vercel pkg v5) â€” breaks EJS and views
- Unicode characters in console.log strings inside app.js CAN cause issues
  with some pkg versions â€” use ASCII only in log output
- Arrow functions (=>) are fine; the old breakage was encoding, not syntax

### Database
- `db.sequelize.sync({ alter: true })` runs on every start
- Avoid renaming columns in migrations â€” alter:true won't rename, only add
- RXRecord soft delete: always use `isDeleted: false` WHERE clause in includes

### Frontend
- All date rendering must use `window.fmtDate()` from public/js
- Badge pills use position:absolute â€” parent button must have position:relative
- Dark mode state stored in localStorage key 'rxTheme'

---

## 15. Deployment Checklist

### First deployment
- [ ] PostgreSQL 14+ installed and running
- [ ] Database created: `createdb -U postgres home_accounting_dev`
- [ ] `.env` file filled with correct values (especially JWT_SECRET and DB_PASSWORD)
- [ ] PORT 3000 open on firewall (or set different PORT)
- [ ] `dist\server.exe` and `.env` in same folder
- [ ] Test: `server.exe --v` shows correct version
- [ ] Test: browse to `http://server-ip:3000/login`
- [ ] Change default admin password after first login

### After every recompile
- [ ] Stop the running server.exe
- [ ] Replace server.exe with new dist\server.exe
- [ ] Verify .env is still present and correct
- [ ] Start server and check startup log
- [ ] Browse to /login and confirm it loads
- [ ] Run `server --v` to confirm version number

### Updating .env only (no recompile)
- [ ] Stop the server
- [ ] Edit .env
- [ ] Start the server
- [ ] No other steps needed

---

*This document was generated 2026-06-23. Keep it updated when adding features.*
*See CHANGELOG.md for version-by-version change history.*



