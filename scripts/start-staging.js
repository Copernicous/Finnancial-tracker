'use strict';

const { prepareStagingEnv, printSummary } = require('./lib/staging-env');

try {
    const config = prepareStagingEnv();
    printSummary(config);
    console.log('Starting staging server. Press Ctrl+C to stop.');
    require('../app');
} catch (err) {
    console.error('[staging:start] ' + err.message);
    process.exit(1);
}
