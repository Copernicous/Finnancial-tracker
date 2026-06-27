# Home Accounting

Home Accounting is a private household accounting web application based on the mature prior web application template. The application shell is reused for authentication, roles, audit logging, backoffice, reports, uploads/proofs, staging, backups, and Windows server compilation.

## Current Scope

- Active accounting template year: 2026.
- Historical Excel workbooks stay local in `data-source/raw-excel/`.
- Old workbooks may inform structure such as account names and aliases.
- Historical transactions, balances, and workbook totals are not imported into the clean app.

## Development

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env` and set database credentials:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Create the development database in PostgreSQL:

   ```powershell
   createdb home_accounting_dev
   ```

4. Run migrations and seeders:

   ```powershell
   npm run db:migrate
   npm run db:seed
   ```

5. Start development:

   ```powershell
   npm run dev
   ```

## Staging

1. Copy `.env.staging.example` to `.env.staging`.
2. Use a separate database named `home_accounting_staging`.
3. Run:

   ```powershell
   npm run staging:check
   npm run staging:start
   ```

Staging uses `APP_WRITABLE_ROOT=staging/runtime` so uploads, backups, and runtime files stay separate from development.

## Build For Another Server

Build a Windows executable:

```powershell
npm run build:exe
```

The compiled artifact is created under `dist/`. Copy the build package, environment file, and deployment checklist to the target server.

## Data Safety

- Do not commit `.env`, `.env.staging`, secrets, uploads, backups, compiled builds, or local databases.
- Do not commit `data-source/raw-excel/`; it is a local source archive for later curated work.
- Backoffice will include clear/reset tools for simulation and accounting data while preserving users, roles, audit history, and source archives.

