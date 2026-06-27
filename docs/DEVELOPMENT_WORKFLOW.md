# Home Accounting Development Workflow

## Branches

- `development`: active local implementation.
- `staging`: deployment rehearsal branch or environment using `.env.staging`.
- `main`: production-ready releases only.

Use normal Git checkpoints:

```powershell
git status
git add .
git commit -m "Describe the accounting change"
```

## Development Reset

This recreates only the configured PostgreSQL database and then runs migrations and seeders. It does not touch `data-source/raw-excel/`.

```powershell
npm run db:reset:financial
```

Default first-run login after seed:

```text
admin / admin123
```

## Run Locally

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Simulation Data

From the UI:

- Dashboard -> Load Sample Data
- Financial Workspace -> Load Sample

From smoke testing:

```powershell
npm run smoke:local:seed
```

Clear sample data from the UI or:

```powershell
Invoke-RestMethod -Method Delete -Uri http://localhost:3000/api/simulation -Headers @{ Authorization = "Bearer <token>" }
```

Only rows marked as simulation are deleted.

## Smoke Checks

Run after the server is already started:

```powershell
npm run smoke:local
```

Run and also load sample data:

```powershell
npm run smoke:local:seed
```

For another URL:

```powershell
node scripts/smoke-home-accounting.js http://localhost:3100
```

## Staging

Use a separate database and port in `.env.staging`.

```powershell
npm run staging:check
npm run db:reset:financial:staging
npm run staging:start
node scripts/smoke-home-accounting.js http://localhost:3100
```

The staging helper refuses unsafe database names unless they clearly look like staging, QA, test, sandbox, or copy databases.

## Build For Another Server

```powershell
npm run build:exe
```

The compiled server is written to `dist/server.exe`. Keep `.env`, `.env.staging`, uploads, local database files, backups, logs, and raw Excel archives out of Git.

## Import Discipline

- Import templates are available at `/import`.
- Uploads create `ImportBatch` and `ImportRow` records first.
- No upload posts ledger transactions automatically; users must open the staged batch, review mappings, and post selected rows.
- Advantage / Citi PDF statements can be uploaded from `/import` using the bank-statement importer.
- Exact statement-file hashes and posted transaction fingerprints are checked before posting to prevent duplicate imports.
- Future curated import mapping should resolve accounts, categories, currencies, duplicates, and approval status before posting.

## Verification Checklist

- `node --check` for changed backend scripts.
- `npm run db:reset:financial` after schema changes.
- Start server and run `npm run smoke:local`.
- Run `npm run smoke:local:seed` when validating dashboards and graphs.
- Search for inherited domain text before commit.
- Commit on `development`, then promote to `staging` after smoke passes.
