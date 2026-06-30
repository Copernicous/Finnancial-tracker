'use strict';

const db = require('../models');
const learner = require('../services/merchantRuleLearner');

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  return match.slice(prefix.length);
}

(async () => {
  const hours = Number(argValue('hours', 6)) || 6;
  const limit = Number(argValue('limit', 500)) || 500;
  const dryRun = process.argv.includes('--dry-run');
  const result = await learner.learnRecentCategoryEdits({
    hours,
    limit,
    apply: !dryRun,
    source: 'user',
    notes: `Learned from recent manual category edits in the last ${hours} hour(s).`
  });

  console.log(JSON.stringify({
    dryRun,
    hours,
    limit,
    scanned: result.scanned,
    learned: result.learned,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    skippedReasons: result.skippedReasons,
    rules: result.rules.map((rule) => ({
      pattern: rule.pattern,
      categoryName: rule.categoryName,
      transactionType: rule.transactionType,
      sampleTransactionId: rule.sampleTransactionId
    }))
  }, null, 2));
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close();
  });
