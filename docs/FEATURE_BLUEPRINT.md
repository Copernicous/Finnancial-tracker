# Home Accounting Feature Blueprint

## Direction

Home Accounting is a fresh household accounting system. The prior application is used only as an operational reference for web-app behavior: authentication, roles, auditability, proxy-safe navigation, exports, reports, backoffice controls, staging, versioning, and build procedures.

No historical transactions, balances, or workbook totals are imported from the old Excel files. The raw archive remains in `data-source/raw-excel/` for future manual curation.

## Operational Features Carried Forward

- Secure login, JWT sessions, cookie fallback for proxy access, and two-factor authentication support.
- Role administration with module visibility and add, edit, delete, export, undo, warehouse, and override permissions.
- User management with active/inactive users, reset support, and active-session visibility.
- Audit, error, and activity logging for operational traceability.
- Dashboard with relevant metrics, recent activity, dark mode support, and staging visual indicators.
- Backoffice, backups, settings, API keys, and changelog pages.
- Proxy-aware links and navigation for FortiGate-style rewritten URLs.
- CSV export, print-friendly reporting, and formula-safe spreadsheet output.
- Curated import staging with templates, preview, batch history, and no automatic ledger posting.
- Bank statement import profiles that parse uploaded statements into staged rows, then post reviewed selections into the ledger.
- Duplicate protection with exact statement-file hashes and transaction fingerprints.
- Development, staging, reset, smoke, and Windows executable build commands.

## Financial Domain Features

- Chart of accounts with institution, account class, subtype, currency, opening/current balance, credit limit, interest rate, and net-worth inclusion.
- Manual transactions with merchant/payee, category, related account, amount, currency, original currency, FX rate, status, tags, cleared date, memo, and recurring flag.
- Categories grouped by income, home, living, protection, lifestyle, finance, and transfers.
- Budgets by year/month/category, budget type, planned amount, threshold, status, and notes.
- Recurring transactions for salary, utilities, subscriptions, savings transfers, card payments, and investments.
- Financial goals for savings targets, sinking funds, and debt payoff.
- Investment holdings by account, symbol, asset class, quantity, cost basis, market value, and price date.
- Currency rates for multi-currency review.
- Balance snapshots for statement checkpoints and trend reporting.
- Rich 2026 sample simulation data that can be cleared from backoffice or API without touching curated data.

## Reporting And Workspace

- Financial Workspace selectors: year, month, account, currency, free-text search, type, status, and date range.
- KPI cards: net worth, cash flow, income, expenses, savings rate, credit utilization, investments, and budget usage.
- Monthly cash-flow graph with income, expenses, and net movement.
- Category spending graph.
- Account balance stack by account class.
- Budget watch with actual-versus-planned utilization.
- Recurring calendar, investment summary, and goal progress.
- Searchable and sortable transaction ledger with CSV export and print support.

## Product Benchmark Concepts

The app borrows feature concepts common in household finance tools without importing outside data:

- Budget targets, spending review, and reports.
- Bank-import readiness with manual staging and future curated mapping.
- Net-worth, investment, and debt tracking.
- Goals and sinking funds.
- Multi-currency structure and exchange-rate support.
- Spreadsheet-safe exports and accountant-friendly review trails.
- Advantage / Citi credit card PDF parsing with statement metadata, row confidence, duplicate fingerprints, review editing, and selected-row posting.

Useful public references for these concepts:

- Monarch Money product and planning features: https://www.monarchmoney.com/ and https://www.monarchmoney.com/features/planning
- YNAB features: https://www.ynab.com/features
- Quicken Simplifi: https://www.quicken.com/products/simplifi/
- Tiller Money: https://tiller.com/
