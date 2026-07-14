'use strict';
const path = require('path');
const { Service } = require('../node_modules/node-windows');
const action = String(process.argv[2] || '').toLowerCase();
const root = path.resolve(__dirname, '..');
const service = new Service({ name: '0-CAMPEROS-ACCOUNTING', description: 'Camperos Accounting project-owned service', script: path.join(root, 'scripts', 'service-entry.js'), workingDirectory: root, env: [{ name: 'NODE_ENV', value: 'production' }], stopparentfirst: true, stoptimeout: 30, wait: 2, grow: 0.5, maxRestarts: 5 });
function fail(error) { console.error(error?.message || error); process.exitCode = 1; }
if (action === 'install') { service.on('install', () => { console.log('Installed 0-CAMPEROS-ACCOUNTING.'); process.exit(0); }); service.on('alreadyinstalled', () => process.exit(0)); service.on('error', fail); service.install(); }
else if (action === 'uninstall') { service.on('uninstall', () => { console.log('Removed 0-CAMPEROS-ACCOUNTING.'); process.exit(0); }); service.on('alreadyuninstalled', () => process.exit(0)); service.on('error', fail); service.uninstall(); }
else fail('Usage: install|uninstall');
