'use strict';
const path = require('path');
const root = path.resolve(__dirname, '..');
process.chdir(root);
require(path.join(root, 'app.js'));
