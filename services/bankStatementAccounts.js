'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ACCOUNT_REGISTRY_PATH = path.join(ROOT, 'config', 'bank-statement-accounts.json');

function loadAccountRegistry() {
  if (!fs.existsSync(ACCOUNT_REGISTRY_PATH)) {
    return { accounts: [], unknownAccountPolicy: 'review_required' };
  }
  return JSON.parse(fs.readFileSync(ACCOUNT_REGISTRY_PATH, 'utf8'));
}

function accountProductMatches(account, registryAccount) {
  const product = String(account.product || account.accountName || '').toLowerCase();
  return (registryAccount.productPatterns || [])
    .some((pattern) => product.includes(String(pattern).toLowerCase()));
}

function matchRegistryAccount(account, registry = loadAccountRegistry()) {
  const accountNumber = String(account.accountNumber || '');
  const last4 = String(account.last4 || account.accountLast4 || (accountNumber ? accountNumber.slice(-4) : ''));

  for (const registryAccount of registry.accounts || []) {
    const exactNumber = accountNumber && (registryAccount.accountNumbers || []).includes(accountNumber);
    const exactLast4 = last4 && (registryAccount.last4 || []).includes(last4);
    const digitalLast4 = account.isDigitalAccountNumber && last4 && (registryAccount.digitalLast4 || []).includes(last4);
    const typeMatches = !registryAccount.accountType || registryAccount.accountType === account.accountType;

    if ((exactNumber || exactLast4 || digitalLast4) && typeMatches) {
      return {
        key: registryAccount.key,
        label: registryAccount.label,
        profile: registryAccount.profile,
        ledgerAccountCode: registryAccount.ledgerAccountCode,
        ledgerAccountSpec: registryAccount.ledgerAccountSpec || null,
        status: registryAccount.status || 'known',
        matchType: exactNumber ? 'account_number' : (digitalLast4 ? 'digital_last4' : 'last4'),
        notes: registryAccount.notes || ''
      };
    }

    if ((exactNumber || exactLast4 || digitalLast4) && !typeMatches && accountProductMatches(account, registryAccount)) {
      return {
        key: registryAccount.key,
        label: registryAccount.label,
        profile: registryAccount.profile,
        ledgerAccountCode: registryAccount.ledgerAccountCode,
        ledgerAccountSpec: registryAccount.ledgerAccountSpec || null,
        status: 'type_mismatch_needs_review',
        matchType: exactNumber ? 'account_number' : (digitalLast4 ? 'digital_last4' : 'last4'),
        notes: `Detected as ${account.accountType}; registry expects ${registryAccount.accountType}.`
      };
    }
  }

  return null;
}

function annotateDetectedAccounts(accounts, registry = loadAccountRegistry()) {
  return (accounts || []).map((account) => ({
    ...account,
    registryMatch: matchRegistryAccount(account, registry)
  }));
}

function accountLabel(account) {
  return `${account.product || account.accountName || account.accountType || 'Account'} ${account.accountNumber || account.last4 || account.accountLast4 || ''}`.trim();
}

module.exports = {
  ACCOUNT_REGISTRY_PATH,
  loadAccountRegistry,
  matchRegistryAccount,
  annotateDetectedAccounts,
  accountLabel
};
