'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../models');
const { loadAccountRegistry } = require('../services/bankStatementAccounts');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'reports');
const args = process.argv.slice(2);
const argSet = new Set(args);
const TOLERANCE_CENTS = cents(argValue('--tolerance', '0.01')) || 1;
const WRITE_SNAPSHOTS = argSet.has('--write-snapshots');

function argValue(name, fallback) {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function cents(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  const cleaned = text.replace(/[,$()\s]/g, '').replace(/^\+|-$/g, '');
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return null;
  return Math.round(Math.abs(number) * 100) * (negative ? -1 : 1);
}

function money(centsValue) {
  const value = Number(centsValue || 0) / 100;
  return value.toFixed(2);
}

function signedMoney(centsValue) {
  const value = Number(centsValue || 0) / 100;
  return (value >= 0 ? '' : '-') + Math.abs(value).toFixed(2);
}

function isoDate(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function daysBetween(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.round((end - start) / 86400000);
}

function csvCell(value) {
  return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
}

function writeCsv(filePath, rows) {
  if (!rows.length) {
    fs.writeFileSync(filePath, '', 'utf8');
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvCell).join(',')].concat(
    rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))
  );
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function reportStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function registryHelpers(registry, accounts) {
  const registryByKey = new Map((registry.accounts || []).map((account) => [account.key, account]));
  const accountByRegistryKey = new Map();
  const accountByCode = new Map(accounts.map((account) => [account.accountCode, account]));
  for (const registryAccount of registry.accounts || []) {
    const code = registryAccount.ledgerAccountCode || (registryAccount.ledgerAccountSpec && registryAccount.ledgerAccountSpec.accountCode);
    const account = code ? accountByCode.get(code) : null;
    if (account) accountByRegistryKey.set(registryAccount.key, account);
  }

  function findRegistryByNumber({ accountNumber, last4, accountType }) {
    const number = String(accountNumber || '');
    const suffix = String(last4 || (number ? number.slice(-4) : ''));
    const type = String(accountType || '').toLowerCase();
    return (registry.accounts || []).find((account) => {
      const exactNumber = number && (account.accountNumbers || []).includes(number);
      const exactLast4 = suffix && (account.last4 || []).includes(suffix);
      const digitalLast4 = suffix && (account.digitalLast4 || []).includes(suffix);
      const typeMatches = !type || !account.accountType || String(account.accountType).toLowerCase() === type;
      return (exactNumber || exactLast4 || digitalLast4) && typeMatches;
    }) || null;
  }

  return { registryByKey, accountByRegistryKey, findRegistryByNumber };
}

function sourceFromBatch(batch, notes, metadata) {
  const sourceCopies = Array.isArray(notes.sourceCopies) ? notes.sourceCopies : [];
  return {
    batchId: batch.id,
    importType: batch.importType,
    batchFileName: batch.fileName || '',
    originalFileName: notes.originalFileName || batch.fileName || '',
    relativePath: notes.relativePath || (sourceCopies[0] && sourceCopies[0].relativePath) || '',
    fileHashSha256: notes.fileHashSha256 || '',
    profile: notes.canonicalProfile || notes.profile || metadata.canonicalProfile || metadata.profile || '',
    parserVersion: notes.parserVersion || ''
  };
}

function componentCents(value) {
  const parsed = cents(value);
  return parsed == null ? 0 : parsed;
}

function creditCardSummaryValidation(metadata) {
  const previous = cents(metadata.previousBalance);
  const current = cents(metadata.newBalance);
  if (previous == null || current == null) return null;
  const expected = previous
    - componentCents(metadata.payments)
    - componentCents(metadata.credits)
    + componentCents(metadata.purchases)
    + componentCents(metadata.cashAdvances)
    + componentCents(metadata.fees)
    + componentCents(metadata.interest);
  return {
    expectedCents: expected,
    actualCents: current,
    diffCents: current - expected,
    status: Math.abs(current - expected) <= TOLERANCE_CENTS ? 'matched' : 'mismatch'
  };
}

function bankingSummaryValidation(summary) {
  const opening = cents(summary.openingBalance);
  const closing = cents(summary.closingBalance);
  const subtracted = cents(summary.totalSubtracted);
  const added = cents(summary.totalAdded);
  if (opening == null || closing == null || subtracted == null || added == null) return null;
  const expected = opening - subtracted + added;
  return {
    expectedCents: expected,
    actualCents: closing,
    diffCents: closing - expected,
    status: Math.abs(closing - expected) <= TOLERANCE_CENTS ? 'matched' : 'mismatch'
  };
}

function addCheckpoint(checkpoints, issues, helpers, batch, notes, metadata, payload) {
  const registryAccount = helpers.registryByKey.get(payload.registryKey);
  const account = helpers.accountByRegistryKey.get(payload.registryKey);
  const statementDate = isoDate(payload.statementDate || metadata.statementDate || metadata.billingPeriodEnd);
  const balanceCents = cents(payload.balance);

  if (!registryAccount || !account) {
    issues.push({
      severity: 'error',
      type: 'checkpoint_account_missing',
      batchId: batch.id,
      fileName: batch.fileName,
      registryKey: payload.registryKey || '',
      message: 'Statement checkpoint could not be mapped to a ledger account.'
    });
    return;
  }
  if (!statementDate || balanceCents == null) {
    issues.push({
      severity: 'warning',
      type: 'checkpoint_incomplete',
      batchId: batch.id,
      fileName: batch.fileName,
      registryKey: payload.registryKey,
      message: 'Statement checkpoint is missing statement date or balance.'
    });
    return;
  }

  const source = sourceFromBatch(batch, notes, metadata);
  checkpoints.push({
    accountId: account.id,
    accountName: account.name,
    accountCode: account.accountCode,
    accountClass: account.accountClass,
    accountSubtype: account.accountSubtype,
    currency: account.currency,
    registryKey: payload.registryKey,
    accountLabel: registryAccount.label,
    statementDate,
    periodStart: isoDate(metadata.billingPeriodStart),
    periodEnd: isoDate(metadata.billingPeriodEnd),
    balanceCents,
    openingCents: cents(payload.openingBalance),
    previousCents: cents(payload.previousBalance),
    totalAddedCents: cents(payload.totalAdded),
    totalSubtractedCents: cents(payload.totalSubtracted),
    checkpointType: payload.checkpointType,
    summaryStatus: payload.summaryValidation ? payload.summaryValidation.status : 'not_available',
    summaryDiffCents: payload.summaryValidation ? payload.summaryValidation.diffCents : null,
    ...source
  });
}

function extractCheckpoints(batches, accounts, registry) {
  const helpers = registryHelpers(registry, accounts);
  const checkpoints = [];
  const issues = [];
  const batchesWithoutCheckpoints = [];

  for (const batch of batches) {
    const notes = parseJson(batch.notes);
    const metadata = notes.metadata || {};
    const beforeCount = checkpoints.length;
    const statementDate = metadata.statementDate || metadata.billingPeriodEnd;

    const scopeKey = notes.accountScopeKey || metadata.registryKey;
    const scopeRegistry = scopeKey ? helpers.registryByKey.get(scopeKey) : null;
    if (metadata.newBalance != null && scopeRegistry && scopeRegistry.accountType === 'credit_card') {
      addCheckpoint(checkpoints, issues, helpers, batch, notes, metadata, {
        registryKey: scopeKey,
        statementDate,
        balance: -Number(metadata.newBalance),
        previousBalance: metadata.previousBalance == null ? null : -Number(metadata.previousBalance),
        checkpointType: 'credit_card_new_balance',
        summaryValidation: creditCardSummaryValidation(metadata)
      });
    }

    const bankingSummaries = Array.isArray(metadata.bankingAccountSummaries) ? metadata.bankingAccountSummaries : [];
    for (const summary of bankingSummaries) {
      const registryAccount = helpers.findRegistryByNumber({
        accountNumber: summary.accountNumber,
        last4: summary.accountLast4,
        accountType: summary.accountClass
      });
      addCheckpoint(checkpoints, issues, helpers, batch, notes, metadata, {
        registryKey: registryAccount && registryAccount.key,
        statementDate,
        balance: summary.closingBalance,
        openingBalance: summary.openingBalance,
        totalAdded: summary.totalAdded,
        totalSubtracted: summary.totalSubtracted,
        checkpointType: `banking_${summary.accountClass || 'account'}_closing_balance`,
        summaryValidation: bankingSummaryValidation(summary)
      });
    }

    const cdSummaries = metadata.certificateOfDepositSummaries;
    const cdRows = Array.isArray(cdSummaries) ? cdSummaries : (cdSummaries && Array.isArray(cdSummaries.accounts) ? cdSummaries.accounts : []);
    for (const summary of cdRows) {
      const registryAccount = helpers.findRegistryByNumber({
        accountNumber: summary.accountNumber,
        last4: summary.accountLast4,
        accountType: 'cd'
      });
      addCheckpoint(checkpoints, issues, helpers, batch, notes, metadata, {
        registryKey: registryAccount && registryAccount.key,
        statementDate,
        balance: summary.balanceAsOfStatementDate ?? summary.closingBalance ?? summary.principalBalance,
        checkpointType: 'cd_statement_balance',
        summaryValidation: null
      });
    }

    if (checkpoints.length === beforeCount) {
      batchesWithoutCheckpoints.push({
        batchId: batch.id,
        fileName: batch.fileName,
        importType: batch.importType,
        accountScopeKey: scopeKey || '',
        statementDate: isoDate(statementDate)
      });
    }
  }

  return { checkpoints, issues, batchesWithoutCheckpoints };
}

function consolidateCheckpoints(checkpoints) {
  const byAccountDate = new Map();
  const conflicts = [];
  for (const checkpoint of checkpoints) {
    const key = `${checkpoint.accountId}|${checkpoint.statementDate}`;
    if (!byAccountDate.has(key)) {
      byAccountDate.set(key, { ...checkpoint, sourceCount: 1, sourceFiles: checkpoint.originalFileName, batchIds: String(checkpoint.batchId) });
      continue;
    }
    const existing = byAccountDate.get(key);
    existing.sourceCount += 1;
    existing.sourceFiles = Array.from(new Set(String(existing.sourceFiles).split(' | ').concat(checkpoint.originalFileName).filter(Boolean))).join(' | ');
    existing.batchIds = Array.from(new Set(String(existing.batchIds).split(',').concat(String(checkpoint.batchId)))).join(',');
    if (existing.balanceCents !== checkpoint.balanceCents) {
      conflicts.push({
        accountId: checkpoint.accountId,
        accountName: checkpoint.accountName,
        statementDate: checkpoint.statementDate,
        firstBalance: money(existing.balanceCents),
        conflictingBalance: money(checkpoint.balanceCents),
        firstBatchIds: existing.batchIds,
        conflictingBatchId: checkpoint.batchId,
        conflictingFile: checkpoint.originalFileName
      });
    }
  }
  return {
    checkpoints: Array.from(byAccountDate.values()).sort((a, b) => a.accountId - b.accountId || a.statementDate.localeCompare(b.statementDate)),
    conflicts
  };
}

function buildIntervals(checkpoints) {
  const byAccount = new Map();
  for (const checkpoint of checkpoints) {
    if (!byAccount.has(checkpoint.accountId)) byAccount.set(checkpoint.accountId, []);
    byAccount.get(checkpoint.accountId).push(checkpoint);
  }
  const intervals = [];
  for (const accountCheckpoints of byAccount.values()) {
    accountCheckpoints.sort((a, b) => a.statementDate.localeCompare(b.statementDate) || a.batchId - b.batchId);
    for (let index = 1; index < accountCheckpoints.length; index += 1) {
      intervals.push({
        intervalIndex: intervals.length,
        accountId: accountCheckpoints[index].accountId,
        accountName: accountCheckpoints[index].accountName,
        accountCode: accountCheckpoints[index].accountCode,
        accountClass: accountCheckpoints[index].accountClass,
        currency: accountCheckpoints[index].currency,
        priorDate: accountCheckpoints[index - 1].statementDate,
        currentDate: accountCheckpoints[index].statementDate,
        priorBalanceCents: accountCheckpoints[index - 1].balanceCents,
        currentBalanceCents: accountCheckpoints[index].balanceCents,
        currentOpeningCents: accountCheckpoints[index].openingCents,
        priorSource: accountCheckpoints[index - 1].sourceFiles || accountCheckpoints[index - 1].originalFileName,
        currentSource: accountCheckpoints[index].sourceFiles || accountCheckpoints[index].originalFileName,
        currentRelativePath: accountCheckpoints[index].relativePath,
        gapDays: daysBetween(accountCheckpoints[index - 1].statementDate, accountCheckpoints[index].statementDate)
      });
    }
  }
  return intervals;
}

function sqlDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid SQL date: ${value}`);
  return value;
}

function intervalValuesSql(intervals) {
  return intervals.map((interval) => (
    `(${interval.intervalIndex}, ${Number(interval.accountId)}, DATE '${sqlDate(interval.priorDate)}', DATE '${sqlDate(interval.currentDate)}')`
  )).join(',\n');
}

async function dateTransactionSums(intervals) {
  if (!intervals.length) return new Map();
  const values = intervalValuesSql(intervals);
  const [rows] = await db.sequelize.query(`
    WITH intervals(interval_index, account_id, prior_date, end_date) AS (
      VALUES
      ${values}
    )
    SELECT
      i.interval_index AS "intervalIndex",
      COUNT(t.id)::int AS "transactionCount",
      COALESCE(ROUND(SUM(t.amount)::numeric, 2), 0)::text AS "transactionSum",
      COALESCE(ROUND(SUM(CASE WHEN t."transactionType" = 'income' THEN t.amount ELSE 0 END)::numeric, 2), 0)::text AS "incomeSum",
      COALESCE(ROUND(SUM(CASE WHEN t."transactionType" = 'expense' THEN t.amount ELSE 0 END)::numeric, 2), 0)::text AS "expenseSum",
      COALESCE(ROUND(SUM(CASE WHEN t."transactionType" = 'transfer' THEN t.amount ELSE 0 END)::numeric, 2), 0)::text AS "transferSum",
      MIN(t."transactionDate") AS "firstTransactionDate",
      MAX(t."transactionDate") AS "lastTransactionDate"
    FROM intervals i
    LEFT JOIN "Transactions" t
      ON t."accountId" = i.account_id
     AND t.status <> 'void'
     AND t."transactionDate" > i.prior_date
     AND t."transactionDate" <= i.end_date
    GROUP BY i.interval_index
    ORDER BY i.interval_index
  `);
  return new Map(rows.map((row) => [Number(row.intervalIndex), row]));
}

async function sourceStatementTransactionSums(intervals) {
  if (!intervals.length) return new Map();
  const values = intervalValuesSql(intervals);
  const [rows] = await db.sequelize.query(`
    WITH intervals(interval_index, account_id, prior_date, end_date) AS (
      VALUES
      ${values}
    ),
    tx_sources AS (
      SELECT DISTINCT
        t.id,
        t."accountId",
        t.amount,
        t."transactionType",
        t."transactionDate",
        COALESCE(
          b.notes::jsonb #>> '{metadata,statementDate}',
          b.notes::jsonb #>> '{metadata,billingPeriodEnd}'
        )::date AS statement_date
      FROM "Transactions" t
      JOIN "ImportRows" r ON r."postedTransactionId" = t.id
      JOIN "ImportBatches" b ON b.id = r."importBatchId"
      WHERE t.status <> 'void'
        AND b.status = 'posted'
        AND b.notes IS NOT NULL
    )
    SELECT
      i.interval_index AS "intervalIndex",
      COUNT(tx.id)::int AS "transactionCount",
      COALESCE(ROUND(SUM(tx.amount)::numeric, 2), 0)::text AS "transactionSum",
      COALESCE(ROUND(SUM(CASE WHEN tx."transactionType" = 'income' THEN tx.amount ELSE 0 END)::numeric, 2), 0)::text AS "incomeSum",
      COALESCE(ROUND(SUM(CASE WHEN tx."transactionType" = 'expense' THEN tx.amount ELSE 0 END)::numeric, 2), 0)::text AS "expenseSum",
      COALESCE(ROUND(SUM(CASE WHEN tx."transactionType" = 'transfer' THEN tx.amount ELSE 0 END)::numeric, 2), 0)::text AS "transferSum",
      MIN(tx."transactionDate") AS "firstTransactionDate",
      MAX(tx."transactionDate") AS "lastTransactionDate"
    FROM intervals i
    LEFT JOIN tx_sources tx
      ON tx."accountId" = i.account_id
     AND tx.statement_date = i.end_date
    GROUP BY i.interval_index
    ORDER BY i.interval_index
  `);
  return new Map(rows.map((row) => [Number(row.intervalIndex), row]));
}

async function mismatchTransactionDetails(mismatches) {
  if (!mismatches.length) return [];
  const limited = mismatches.slice(0, 200);
  const values = intervalValuesSql(limited);
  const [rows] = await db.sequelize.query(`
    WITH intervals(interval_index, account_id, prior_date, end_date) AS (
      VALUES
      ${values}
    ),
    tx_sources AS (
      SELECT DISTINCT
        t.id,
        t."accountId",
        t."transactionDate",
        t."transactionType",
        t.amount,
        t.currency,
        t.merchant,
        t.description,
        t."referenceNumber",
        t.status,
        COALESCE(
          b.notes::jsonb #>> '{metadata,statementDate}',
          b.notes::jsonb #>> '{metadata,billingPeriodEnd}'
        )::date AS statement_date
      FROM "Transactions" t
      JOIN "ImportRows" r ON r."postedTransactionId" = t.id
      JOIN "ImportBatches" b ON b.id = r."importBatchId"
      WHERE t.status <> 'void'
        AND b.status = 'posted'
        AND b.notes IS NOT NULL
    )
    SELECT
      i.interval_index AS "intervalIndex",
      tx.id AS "transactionId",
      tx."transactionDate",
      a.name AS "accountName",
      tx."transactionType",
      tx.amount::text AS amount,
      tx.currency,
      tx.merchant,
      tx.description,
      tx."referenceNumber",
      tx.status
    FROM intervals i
    JOIN tx_sources tx
      ON tx."accountId" = i.account_id
     AND tx.statement_date = i.end_date
    JOIN "Accounts" a ON a.id = tx."accountId"
    ORDER BY i.interval_index, tx."transactionDate", tx.id
  `);
  return rows;
}

async function duplicateCandidates() {
  const [rows] = await db.sequelize.query(`
    SELECT
      a.name AS "accountName",
      t."accountId",
      t."transactionDate",
      ROUND(t.amount::numeric, 2)::text AS amount,
      COALESCE(NULLIF(TRIM(t."referenceNumber"), ''), LOWER(REGEXP_REPLACE(TRIM(t.description), '\\s+', ' ', 'g'))) AS fingerprint,
      COUNT(*)::int AS count,
      STRING_AGG(t.id::text, ',' ORDER BY t.id) AS "transactionIds",
      MIN(t.description) AS "sampleDescription"
    FROM "Transactions" t
    JOIN "Accounts" a ON a.id = t."accountId"
    WHERE t.status <> 'void'
    GROUP BY a.name, t."accountId", t."transactionDate", ROUND(t.amount::numeric, 2),
      COALESCE(NULLIF(TRIM(t."referenceNumber"), ''), LOWER(REGEXP_REPLACE(TRIM(t.description), '\\s+', ' ', 'g')))
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, t."transactionDate" DESC
    LIMIT 500
  `);
  return rows;
}

async function transferSummary() {
  const [rows] = await db.sequelize.query(`
    SELECT
      a.name AS "accountName",
      t."accountId",
      COUNT(*)::int AS count,
      ROUND(SUM(t.amount)::numeric, 2)::text AS "signedSum"
    FROM "Transactions" t
    JOIN "Accounts" a ON a.id = t."accountId"
    WHERE t.status <> 'void'
      AND t."transactionType" = 'transfer'
    GROUP BY a.name, t."accountId"
    ORDER BY ABS(SUM(t.amount)) DESC
  `);
  return rows;
}

async function accountCoverage(accounts, checkpoints) {
  const byAccount = new Map();
  for (const checkpoint of checkpoints) {
    if (!byAccount.has(checkpoint.accountId)) byAccount.set(checkpoint.accountId, []);
    byAccount.get(checkpoint.accountId).push(checkpoint);
  }
  const [txCounts] = await db.sequelize.query(`
    SELECT
      "accountId",
      COUNT(*)::int AS count,
      MIN("transactionDate") AS first_date,
      MAX("transactionDate") AS last_date
    FROM "Transactions"
    WHERE status <> 'void'
    GROUP BY "accountId"
  `);
  const txMap = new Map(txCounts.map((row) => [Number(row.accountId), row]));
  return accounts.map((account) => {
    const accountCheckpoints = (byAccount.get(account.id) || []).sort((a, b) => a.statementDate.localeCompare(b.statementDate));
    const tx = txMap.get(account.id) || {};
    return {
      accountId: account.id,
      accountName: account.name,
      accountCode: account.accountCode || '',
      accountClass: account.accountClass || '',
      transactionCount: Number(tx.count || 0),
      firstTransactionDate: tx.first_date || '',
      lastTransactionDate: tx.last_date || '',
      checkpointCount: accountCheckpoints.length,
      firstCheckpointDate: accountCheckpoints[0] ? accountCheckpoints[0].statementDate : '',
      lastCheckpointDate: accountCheckpoints[accountCheckpoints.length - 1] ? accountCheckpoints[accountCheckpoints.length - 1].statementDate : '',
      status: accountCheckpoints.length >= 2 ? 'reconcilable' : (accountCheckpoints.length === 1 ? 'single_checkpoint' : 'no_checkpoints')
    };
  });
}

async function writeSnapshots(checkpoints) {
  let created = 0;
  let updated = 0;
  for (const checkpoint of checkpoints) {
    const where = {
      accountId: checkpoint.accountId,
      snapshotDate: checkpoint.statementDate,
      source: 'statement_import_checkpoint'
    };
    const payload = {
      ...where,
      balance: money(checkpoint.balanceCents),
      currency: checkpoint.currency || 'USD',
      notes: `Time-machine checkpoint from ${checkpoint.sourceFiles || checkpoint.originalFileName || checkpoint.batchFileName}; batches ${checkpoint.batchIds || checkpoint.batchId}.`,
      isSimulation: false
    };
    const existing = await db.AccountBalanceSnapshot.findOne({ where });
    if (existing) {
      await existing.update(payload);
      updated += 1;
    } else {
      await db.AccountBalanceSnapshot.create(payload);
      created += 1;
    }
  }
  return { created, updated };
}

function summarizeByAccount(intervalRows) {
  const map = new Map();
  for (const row of intervalRows) {
    if (!map.has(row.accountId)) {
      map.set(row.accountId, {
        accountId: row.accountId,
        accountName: row.accountName,
        intervals: 0,
        matched: 0,
        mismatches: 0,
        maxAbsDifference: 0,
        netDifference: 0
      });
    }
    const item = map.get(row.accountId);
    item.intervals += 1;
    if (row.status === 'matched') item.matched += 1;
    if (row.status === 'mismatch') item.mismatches += 1;
    item.maxAbsDifference = Math.max(item.maxAbsDifference, Math.abs(Number(row.difference || 0)));
    item.netDifference += Number(row.difference || 0);
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    maxAbsDifference: row.maxAbsDifference.toFixed(2),
    netDifference: row.netDifference.toFixed(2)
  }));
}

function mismatchReason(interval, transactionCount, differenceCents) {
  if (Math.abs(differenceCents) <= TOLERANCE_CENTS) return 'matched';
  const openingDiff = interval.currentOpeningCents == null ? null : interval.currentOpeningCents - interval.priorBalanceCents;
  if (openingDiff != null && Math.abs(openingDiff) > TOLERANCE_CENTS) return 'current_statement_opening_differs_from_prior_checkpoint';
  if (Number(interval.gapDays || 0) > 45) return 'long_gap_missing_statement_checkpoints';
  if (!transactionCount) return 'no_imported_transactions_for_statement_account';
  return 'transaction_sum_does_not_match_statement_delta';
}

function markdownReport(summary, accountRows, topMismatches, files) {
  const lines = [];
  lines.push('# Time Machine Reconciliation');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Accounts: ${summary.accounts}`);
  lines.push(`- Posted import batches scanned: ${summary.postedBatches}`);
  lines.push(`- Extracted raw checkpoints: ${summary.rawCheckpoints}`);
  lines.push(`- Consolidated checkpoints: ${summary.consolidatedCheckpoints}`);
  lines.push(`- Reconciliation intervals: ${summary.intervals}`);
  lines.push(`- Matched intervals: ${summary.matchedIntervals}`);
  lines.push(`- Mismatched intervals: ${summary.mismatchedIntervals}`);
  lines.push(`- Checkpoint conflicts: ${summary.checkpointConflicts}`);
  lines.push(`- Batches without checkpoints: ${summary.batchesWithoutCheckpoints}`);
  lines.push(`- Duplicate transaction candidates: ${summary.duplicateCandidates}`);
  lines.push(`- Snapshot write mode: ${summary.snapshotWriteMode}`);
  lines.push('');
  lines.push('## Account Results');
  lines.push('');
  lines.push('| Account | Intervals | Matched | Mismatches | Max Difference | Net Difference |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const row of accountRows) {
    lines.push(`| ${row.accountName} | ${row.intervals} | ${row.matched} | ${row.mismatches} | ${row.maxAbsDifference} | ${row.netDifference} |`);
  }
  lines.push('');
  lines.push('## Largest Mismatches');
  lines.push('');
  if (!topMismatches.length) {
    lines.push('No mismatched checkpoint intervals found.');
  } else {
    lines.push('| Account | Prior Date | Current Date | Prior Balance | Transactions | Expected | Actual | Difference | Current Source |');
    lines.push('|---|---|---|---:|---:|---:|---:|---:|---|');
    for (const row of topMismatches) {
      lines.push(`| ${row.accountName} | ${row.priorDate} | ${row.currentDate} | ${row.priorBalance} | ${row.transactionSum} | ${row.expectedBalance} | ${row.actualBalance} | ${row.difference} | ${row.currentSource} |`);
    }
  }
  lines.push('');
  lines.push('## Files');
  lines.push('');
  Object.entries(files).forEach(([label, filePath]) => {
    lines.push(`- ${label}: ${path.relative(ROOT, filePath)}`);
  });
  lines.push('');
  lines.push('## Query Note');
  lines.push('');
  lines.push('The interval transaction sums, duplicate scan, transfer summary, and coverage counts are calculated with PostgreSQL SQL queries. JavaScript is only extracting statement checkpoints from import metadata and formatting the report.');
  return `${lines.join('\n')}\n`;
}

async function main() {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

  const registry = loadAccountRegistry();
  const [accounts, batches] = await Promise.all([
    db.Account.findAll({ order: [['id', 'ASC']], raw: true }),
    db.ImportBatch.findAll({
      where: { status: 'posted' },
      attributes: ['id', 'importType', 'fileName', 'status', 'rowCount', 'acceptedCount', 'notes'],
      order: [['id', 'ASC']],
      raw: true
    })
  ]);

  const extracted = extractCheckpoints(batches, accounts, registry);
  const consolidated = consolidateCheckpoints(extracted.checkpoints);
  const intervals = buildIntervals(consolidated.checkpoints);
  const sourceSums = await sourceStatementTransactionSums(intervals);
  const dateSums = await dateTransactionSums(intervals);

  const intervalRows = intervals.map((interval) => {
    const sourceSum = sourceSums.get(interval.intervalIndex) || {};
    const dateSum = dateSums.get(interval.intervalIndex) || {};
    const transactionSumCents = cents(sourceSum.transactionSum) || 0;
    const dateTransactionSumCents = cents(dateSum.transactionSum) || 0;
    const expectedCents = interval.priorBalanceCents + transactionSumCents;
    const differenceCents = interval.currentBalanceCents - expectedCents;
    const dateExpectedCents = interval.priorBalanceCents + dateTransactionSumCents;
    const dateDifferenceCents = interval.currentBalanceCents - dateExpectedCents;
    const openingDifferenceCents = interval.currentOpeningCents == null ? null : interval.currentOpeningCents - interval.priorBalanceCents;
    const transactionCount = Number(sourceSum.transactionCount || 0);
    return {
      intervalIndex: interval.intervalIndex,
      accountId: interval.accountId,
      accountName: interval.accountName,
      accountCode: interval.accountCode,
      accountClass: interval.accountClass,
      priorDate: interval.priorDate,
      currentDate: interval.currentDate,
      gapDays: interval.gapDays,
      reconciliationMethod: 'source_statement',
      priorBalance: signedMoney(interval.priorBalanceCents),
      currentStatementOpeningBalance: interval.currentOpeningCents == null ? '' : signedMoney(interval.currentOpeningCents),
      openingVsPriorDifference: openingDifferenceCents == null ? '' : signedMoney(openingDifferenceCents),
      transactionSum: signedMoney(transactionSumCents),
      expectedBalance: signedMoney(expectedCents),
      actualBalance: signedMoney(interval.currentBalanceCents),
      difference: signedMoney(differenceCents),
      differenceCents,
      transactionCount,
      incomeSum: sourceSum.incomeSum || '0.00',
      expenseSum: sourceSum.expenseSum || '0.00',
      transferSum: sourceSum.transferSum || '0.00',
      firstTransactionDate: sourceSum.firstTransactionDate || '',
      lastTransactionDate: sourceSum.lastTransactionDate || '',
      dateTransactionSum: signedMoney(dateTransactionSumCents),
      dateExpectedBalance: signedMoney(dateExpectedCents),
      dateDifference: signedMoney(dateDifferenceCents),
      dateTransactionCount: Number(dateSum.transactionCount || 0),
      priorSource: interval.priorSource,
      currentSource: interval.currentSource,
      currentRelativePath: interval.currentRelativePath,
      status: Math.abs(differenceCents) <= TOLERANCE_CENTS ? 'matched' : 'mismatch',
      reason: mismatchReason(interval, transactionCount, differenceCents)
    };
  });

  const mismatches = intervalRows.filter((row) => row.status === 'mismatch');
  const duplicateRows = await duplicateCandidates();
  const transferRows = await transferSummary();
  const coverageRows = await accountCoverage(accounts, consolidated.checkpoints);
  const mismatchDetails = await mismatchTransactionDetails(mismatches);
  const snapshotWriteResult = WRITE_SNAPSHOTS ? await writeSnapshots(consolidated.checkpoints) : null;

  const stamp = reportStamp();
  const files = {
    markdown: path.join(REPORT_DIR, `time-machine-reconciliation-${stamp}.md`),
    json: path.join(REPORT_DIR, `time-machine-reconciliation-${stamp}.json`),
    intervalsCsv: path.join(REPORT_DIR, `time-machine-reconciliation-${stamp}-intervals.csv`),
    checkpointsCsv: path.join(REPORT_DIR, `time-machine-reconciliation-${stamp}-checkpoints.csv`),
    mismatchDetailsCsv: path.join(REPORT_DIR, `time-machine-reconciliation-${stamp}-mismatch-transactions.csv`),
    duplicatesCsv: path.join(REPORT_DIR, `time-machine-reconciliation-${stamp}-duplicate-candidates.csv`),
    transferCsv: path.join(REPORT_DIR, `time-machine-reconciliation-${stamp}-transfer-summary.csv`),
    coverageCsv: path.join(REPORT_DIR, `time-machine-reconciliation-${stamp}-coverage.csv`)
  };

  const accountRows = summarizeByAccount(intervalRows);
  const topMismatches = mismatches
    .slice()
    .sort((a, b) => Math.abs(b.differenceCents) - Math.abs(a.differenceCents))
    .slice(0, 25);
  const checkpointRows = consolidated.checkpoints.map((row) => ({
    accountId: row.accountId,
    accountName: row.accountName,
    accountCode: row.accountCode,
    statementDate: row.statementDate,
    balance: signedMoney(row.balanceCents),
    checkpointType: row.checkpointType,
    sourceFiles: row.sourceFiles || row.originalFileName,
    batchIds: row.batchIds || row.batchId,
    relativePath: row.relativePath,
    summaryStatus: row.summaryStatus,
    summaryDiff: row.summaryDiffCents == null ? '' : signedMoney(row.summaryDiffCents)
  }));

  const summary = {
    generatedAt: new Date().toISOString(),
    database: process.env.DB_NAME || 'home_accounting_dev',
    tolerance: money(TOLERANCE_CENTS),
    accounts: accounts.length,
    postedBatches: batches.length,
    rawCheckpoints: extracted.checkpoints.length,
    consolidatedCheckpoints: consolidated.checkpoints.length,
    intervals: intervalRows.length,
    matchedIntervals: intervalRows.filter((row) => row.status === 'matched').length,
    mismatchedIntervals: mismatches.length,
    checkpointConflicts: consolidated.conflicts.length,
    batchesWithoutCheckpoints: extracted.batchesWithoutCheckpoints.length,
    extractionIssues: extracted.issues.length,
    duplicateCandidates: duplicateRows.length,
    transferAccounts: transferRows.length,
    snapshotWriteMode: WRITE_SNAPSHOTS ? `wrote ${snapshotWriteResult.created} created, ${snapshotWriteResult.updated} updated` : 'read-only'
  };

  const report = {
    summary,
    accountResults: accountRows,
    intervals: intervalRows,
    checkpoints: checkpointRows,
    checkpointConflicts: consolidated.conflicts,
    extractionIssues: extracted.issues,
    batchesWithoutCheckpoints: extracted.batchesWithoutCheckpoints,
    duplicateCandidates: duplicateRows,
    transferSummary: transferRows,
    coverage: coverageRows,
    mismatchTransactionDetails: mismatchDetails,
    files: Object.fromEntries(Object.entries(files).map(([key, filePath]) => [key, path.relative(ROOT, filePath)]))
  };

  fs.writeFileSync(files.json, JSON.stringify(report, null, 2), 'utf8');
  writeCsv(files.intervalsCsv, intervalRows.map(({ differenceCents, ...row }) => row));
  writeCsv(files.checkpointsCsv, checkpointRows);
  writeCsv(files.mismatchDetailsCsv, mismatchDetails);
  writeCsv(files.duplicatesCsv, duplicateRows);
  writeCsv(files.transferCsv, transferRows);
  writeCsv(files.coverageCsv, coverageRows);
  fs.writeFileSync(files.markdown, markdownReport(summary, accountRows, topMismatches, files), 'utf8');

  console.log(JSON.stringify({
    summary,
    files: Object.fromEntries(Object.entries(files).map(([key, filePath]) => [key, path.relative(ROOT, filePath)])),
    topMismatches
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close();
  });
