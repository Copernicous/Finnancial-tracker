'use strict';

const path = require('path');

function getAppRoot() {
    return typeof process.pkg !== 'undefined'
        ? path.dirname(process.execPath)
        : path.join(__dirname, '..');
}

function getWritableRoot() {
    const configured = process.env.APP_WRITABLE_ROOT || process.env.RX_WRITABLE_ROOT;
    if (!configured) return getAppRoot();
    return path.isAbsolute(configured)
        ? configured
        : path.resolve(getAppRoot(), configured);
}

function resolveWritablePath() {
    return path.join(getWritableRoot(), ...Array.prototype.slice.call(arguments));
}

function resolveMaybeWritable(configuredPath) {
    if (!configuredPath) return getWritableRoot();
    return path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(getWritableRoot(), configuredPath);
}

module.exports = {
    getAppRoot,
    getWritableRoot,
    resolveWritablePath,
    resolveMaybeWritable
};
