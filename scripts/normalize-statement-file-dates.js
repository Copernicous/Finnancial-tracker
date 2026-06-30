'use strict';

const fs = require('fs');
const path = require('path');
const { parseBankStatement } = require('../services/bankStatementParser');

const ROOT = path.resolve(__dirname, '..');
const STATEMENTS_SOURCE = path.join(ROOT, 'data-source', 'Statements');

const FOLDERS = [
  {
    profile: 'advantage_citi_pdf',
    folder: path.join(STATEMENTS_SOURCE, 'Citi AAdvantage Credit Card Statement 3888')
  },
  {
    profile: 'citi_checking_pdf',
    folder: path.join(STATEMENTS_SOURCE, 'Citi Checking Statement 8384')
  },
  {
    profile: 'citi_ultimate_plus_pdf',
    folder: path.join(STATEMENTS_SOURCE, 'Citi Ultimate Plus Statement 2950')
  },
  {
    profile: 'citi_savings_pdf',
    folder: path.join(STATEMENTS_SOURCE, 'Day To Day Savings Statement 8293')
  }
];

function normPath(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function listPdfFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  const out = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) out.push(...listPdfFiles(fullPath));
    else if (entry.isFile() && /\.pdf$/i.test(entry.name)) out.push(fullPath);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function toDisplayDate(isoDate) {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `${match[2]}-${match[3]}-${match[1]}`;
}

async function inspectFile(filePath, folderSpec) {
  const buffer = fs.readFileSync(filePath);
  const parsed = await parseBankStatement({ buffer, profile: folderSpec.profile });
  const metadata = parsed.metadata || {};
  const statementDate = metadata.statementDate || metadata.billingPeriodEnd || null;
  const displayDate = toDisplayDate(statementDate);

  return {
    filePath,
    folder: folderSpec.folder,
    profile: folderSpec.profile,
    relativePath: path.relative(ROOT, filePath),
    statementDate,
    displayDate,
    warnings: parsed.warnings || []
  };
}

function assignTargets(records) {
  const sourcePaths = new Set(records.map((record) => normPath(record.filePath)));
  const usedTargets = new Set();

  const sorted = records.slice().sort((a, b) => {
    const aBase = a.displayDate ? `${a.displayDate}.pdf`.toLowerCase() : '';
    const bBase = b.displayDate ? `${b.displayDate}.pdf`.toLowerCase() : '';
    const aAlready = path.basename(a.filePath).toLowerCase() === aBase ? 0 : 1;
    const bAlready = path.basename(b.filePath).toLowerCase() === bBase ? 0 : 1;
    if (aAlready !== bAlready) return aAlready - bAlready;
    return a.filePath.localeCompare(b.filePath);
  });

  for (const record of sorted) {
    if (!record.displayDate) {
      record.status = 'needs_review';
      record.reason = 'No statement date detected.';
      continue;
    }

    let suffix = 0;
    while (true) {
      const suffixText = suffix ? ` (${suffix})` : '';
      const targetPath = path.join(path.dirname(record.filePath), `${record.displayDate}${suffixText}.pdf`);
      const normalizedTarget = normPath(targetPath);
      const targetExistsOutsidePlan = fs.existsSync(targetPath) && !sourcePaths.has(normalizedTarget);
      if (!usedTargets.has(normalizedTarget) && !targetExistsOutsidePlan) {
        record.targetPath = targetPath;
        record.targetRelativePath = path.relative(ROOT, targetPath);
        record.status = normPath(record.filePath) === normalizedTarget ? 'unchanged' : 'rename';
        usedTargets.add(normalizedTarget);
        break;
      }
      suffix += 1;
    }
  }

  return sorted;
}

function applyRenames(records) {
  const moves = records.filter((record) => record.status === 'rename');
  const tempMoves = moves.map((record) => {
    const tempPath = path.join(
      path.dirname(record.filePath),
      `.__statement_rename_${process.pid}_${Math.random().toString(16).slice(2)}.pdf`
    );
    return { ...record, tempPath };
  });

  for (const move of tempMoves) {
    if (!isInside(move.folder, move.filePath) || !isInside(move.folder, move.targetPath) || !isInside(move.folder, move.tempPath)) {
      throw new Error(`Unsafe rename outside account folder: ${move.relativePath}`);
    }
  }

  for (const move of tempMoves) {
    fs.renameSync(move.filePath, move.tempPath);
  }
  for (const move of tempMoves) {
    fs.renameSync(move.tempPath, move.targetPath);
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const summary = {
    apply,
    folders: 0,
    reviewed: 0,
    renamed: 0,
    unchanged: 0,
    needsReview: 0,
    errors: []
  };
  const records = [];

  for (const folderSpec of FOLDERS) {
    summary.folders += 1;
    if (!fs.existsSync(folderSpec.folder)) {
      summary.errors.push({ folder: path.relative(ROOT, folderSpec.folder), error: 'Folder not found.' });
      continue;
    }
    for (const filePath of listPdfFiles(folderSpec.folder)) {
      try {
        records.push(await inspectFile(filePath, folderSpec));
      } catch (err) {
        summary.errors.push({ file: path.relative(ROOT, filePath), error: err.message });
      }
    }
  }

  const planned = assignTargets(records);
  summary.reviewed = planned.length;
  summary.renamed = planned.filter((record) => record.status === 'rename').length;
  summary.unchanged = planned.filter((record) => record.status === 'unchanged').length;
  summary.needsReview = planned.filter((record) => record.status === 'needs_review').length;

  if (apply && summary.renamed) applyRenames(planned);

  for (const record of planned) {
    if (record.status === 'rename') {
      console.log(`${apply ? 'renamed' : 'would rename'}: ${record.relativePath} -> ${record.targetRelativePath}`);
    } else if (record.status === 'needs_review') {
      console.log(`needs review: ${record.relativePath} (${record.reason})`);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length || summary.needsReview) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
