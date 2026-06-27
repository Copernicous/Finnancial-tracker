'use strict';

const { prepareStagingEnv, printSummary } = require('./lib/staging-env');

try {
    const config = prepareStagingEnv();
    printSummary(config);
    console.log('Staging config check passed. No server was started.');
} catch (err) {
    console.error('[staging:check] ' + err.message);
    process.exit(1);
}
