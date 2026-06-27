# Home Accounting Changelog

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
- Replaced inherited operational pages with accounting-focused pages and removed obsolete inherited browser bundles, QA scripts, and route manifests.
- Added financial DB reset and smoke-test commands for development and staging.
- Preserved raw Excel files outside the import pipeline for future manual curation.
