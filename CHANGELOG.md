# Home Accounting Changelog

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
