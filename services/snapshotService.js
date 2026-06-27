'use strict';

let _db = null;
function db() {
  if (!_db) _db = require('../models');
  return _db;
}

async function captureSnapshot(forDate) {
  const d = forDate ? new Date(forDate) : new Date();
  const pad = n => String(n).padStart(2, '0');
  const snapshotDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const [
    totalAccounts,
    activeAccounts,
    totalTransactions,
    draftTransactions,
    reviewedTransactions,
    reconciledTransactions,
    proofDocuments,
    openReconciliations,
    totalFinancialInstitutions,
    totalCategories,
    totalUsers,
    activeUsers,
    auditEventsToday,
    errorLogsToday,
    unresolvedErrors
  ] = await Promise.all([
    db().Account.count(),
    db().Account.count({ where: { status: 'active' } }),
    db().Transaction.count(),
    db().Transaction.count({ where: { status: 'draft' } }),
    db().Transaction.count({ where: { status: 'reviewed' } }),
    db().Transaction.count({ where: { status: 'reconciled' } }),
    db().ProofDocument.count({ where: { isDeleted: false } }),
    db().Reconciliation.count({ where: { status: 'open' } }),
    db().FinancialInstitution.count(),
    db().Category.count(),
    db().User.count(),
    db().User.count({ where: { isActive: true } }),
    db().AuditLog.count({ where: { date: snapshotDate } }),
    db().ErrorLog ? db().ErrorLog.count({ where: { resolved: false } }) : 0,
    db().ErrorLog ? db().ErrorLog.count({ where: { resolved: false } }) : 0
  ]);

  const payload = {
    snapshotDate,
    totalAccounts,
    activeAccounts,
    totalTransactions,
    transactionsToday: 0,
    draftTransactions,
    reviewedTransactions,
    reconciledTransactions,
    proofDocuments,
    openReconciliations,
    netWorth: 0,
    netIncomeMonth: 0,
    totalUsers,
    activeUsers,
    auditEventsToday,
    errorLogsToday,
    unresolvedErrors,
    totalFinancialInstitutions,
    totalCategories
  };

  const [snap] = await db().DailySnapshot.upsert(payload, { returning: true });
  console.log(`[Snapshot] Captured ${snapshotDate}: accounts=${totalAccounts} transactions=${totalTransactions}`);
  return snap;
}

module.exports = { captureSnapshot };
