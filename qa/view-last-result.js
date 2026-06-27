const fs = require('fs');
const path = require('path');
const { readConfig, ensureQaDirectories } = require('./lib/qa-env');

const config = readConfig();
ensureQaDirectories(config);

const reportPath = path.join(config.resultsDir, 'smoke-report.json');
if (!fs.existsSync(reportPath)) {
  console.log('No smoke report found yet. Run: node qa/smoke-qa.js');
  process.exit(0);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
console.log(`Smoke report: ${path.relative(config.rootDir, reportPath)}`);
console.log(`Passed: ${report.passed}`);
console.log(`Failed: ${report.failed}`);
console.log(`Errors: ${report.errors.length}`);
console.log(`Skipped: ${report.skipped.length}`);

if (report.failed || report.errors.length) {
  console.log('');
  console.log('Failures / errors:');
  report.results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`- ${r.name}: ${r.detail}`);
  });
  report.errors.forEach(err => console.log(`- ${err}`));
}
