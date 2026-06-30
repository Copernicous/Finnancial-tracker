# Home Accounting Changelog

## 0.4.2 - 2026-06-30

- Replaced the Financial Workspace investment KPI slot with a statement-balance card that uses the same statement cutoff reconciliation diff logic as the Reconciliation page.
- Moved selected statement balance/date information out of the Month selector into a compact statement strip to prevent filter-row layout shifts.
- Added credit-card payment proof reporting to match card-side payments with checking/savings funding transactions and expose missing payment evidence.
- Added operation-aware categorization for Zelle, payroll, interest, deposits, cash withdrawals, savings transfers, and credit-card payments.
- Added automatic learning from manual transaction category edits and a recent-category learning script for reusable merchant rules.
- Expanded default category rules for utilities, medical, Disney/parks, BJs, rent, insurance, HOA, water/sewer, and related household merchant patterns.

## 0.4.1 - 2026-06-30

- Added the Statement Lab concept page at `/statement-lab` under Reports as an in-app workbench for statement snapshot comparison, cutoff suggestions, and reconciliation diff inspection.
- Added live statement timeline chips, dashboard-versus-statement comparison cards, and cutoff detail drill-downs that show posted ledger rows and staged source rows.

## 0.4.0 - 2026-06-30

- Added statement balance comparison in the Financial Workspace, including account-specific imported statement snapshot dates, balance chips, and dashboard-versus-statement differences.
- Added statement cutoff reconciliation suggestions and drill-down detail showing prior balance, posted movement, book balance, statement balance, diff, posted ledger rows, and staged source rows.
- Rebuilt Analytics & Export with granular filters for year/all-years, month, custom date ranges, account, merchant/text search, type, status, and day/week/month/year grouping.
- Added top-merchant reporting focus and richer CSV export fields for merchant/category/account analysis.
- Made Balance Snapshots and shared accounting tables searchable and sortable by column.
- Added PostgreSQL-backed finance summary query paths and performance indexes for faster reporting/search.
- Added PDF quick-view support from import batch review/history and safer import-year cleanup tooling.
- Compactified several data-entry forms so transaction/account/admin workflows take less vertical space.

## 0.3.0 - 2026-06-30

- Added KPI drill-down reports in the Financial Workspace so dashboard cards can show the transactions, accounts, merchants, transfer reasons, and source statement files behind each number.
- Added source-file enrichment for imported transaction detail using posted import rows and import batch metadata.
- Reclassified internal transfers and credit-card payments out of income/expense calculations to make cash-flow KPIs more realistic.
- Added Citi statement account registry support for checking, savings, AAdvantage credit card, and CD account discovery.
- Added statement PDF review, staging, reset, account-sync, date-normalization, and bank-import audit scripts for safer iterative imports.
- Added the read-only time-machine reconciliation report that extracts statement checkpoints, reconciles statement-to-statement balances using PostgreSQL source-statement queries, flags mismatch reasons, and exports CSV/JSON/Markdown evidence.
- Created the first time-machine validation report from 110 posted statement batches: AAdvantage reconciles fully, while Day to Day Savings 8293 and several historical gaps require additional transaction import/review before the dashboard can be considered fully reconciled.
- Created a fresh PostgreSQL backup after validation: `backups/backup_2026-06-30T02-35-50.dump`.

## 0.2.0 - 2026-06-29

- Added a dedicated financial explorer for categories and merchants with combo-based selection and timeline controls.
- Reworked the category and merchant charts into interactive filters so category clicks can drive merchant exploration.
- Added merchant-focused summary cards, selection state, and a side merchant rail for quick drill-down.
- Normalized merchant handling in the finance workspace and tightened the display around official merchant names.
- Improved chart layout sizing and reduced duplicate visual clutter in the financial workspace.
- Hid sample-data buttons in the working view to keep the interface focused on real accounting data.

## 0.1.0 - 2026-06-27

- Rebuilt the application domain as Home Accounting.
- Added accounting tables for financial institutions, accounts, categories, transactions, reconciliations, proof records, import batches, audit, roles, and users.
- Added manual accounting entry screens, editable accounting setup tables, user management, active-user tracking, reporting, and 2026 sample simulation data.
- Added financial planning tables for budgets, recurring transactions, goals, investments, currency rates, import rows, and balance snapshots.
- Added the Financial Workspace with selectors, KPIs, cash-flow graphs, category graphs, budget watch, goals, recurring items, investments, searchable transactions, CSV export, and print support.
- Added a web-based Advantage / Citi credit card PDF statement importer that stages parsed rows for review without posting ledger transactions.
- Added staged batch review and controlled posting into ledger transactions with exact-file and transaction-fingerprint duplicate protection.
- Added staged document removal, master-only backoffice purge/rollback controls, merchant category suggestions, optional per-merchant online lookup, and learned merchant rules.
- Added category chart CSV/JSON export/import with direct category upsert and merchant keyword-group rules for curated accounting setup.
- Added the full default household category catalog, category search in review dropdowns, staged-batch/review filters and sorting, compact lookup notes, and lookup detail modal.
- Added the dedicated Transactions & New Entry workspace with compact entry, paginated/sortable ledger review, per-view row counts, category drill-in, bulk recategorization, local and online merchant matching, CSV export, print support, and category/merchant trend charts.
- Added account-type filtering and switchable bar/soft-line monthly cash-flow charts with series toggles in the Financial Workspace.
- Added site-wide dark mode controls and fixed the main content width calculation so accounting tables stay inside the viewport.
- Replaced inherited operational pages with accounting-focused pages and removed obsolete inherited browser bundles, QA scripts, and route manifests.
- Added financial DB reset and smoke-test commands for development and staging.
- Preserved raw Excel files outside the import pipeline for future manual curation.
