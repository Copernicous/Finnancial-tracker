/**
 * sessionTracker.js — In-memory active user session store.
 *
 * Each logged-in user sends a heartbeat every 30s from the browser.
 * Sessions older than SESSION_EXPIRY_MS are considered expired and
 * removed automatically on every read.
 *
 * No DB required — data is ephemeral and resets on server restart,
 * which is correct behaviour for a "who's online" monitor.
 */

const SESSION_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes of silence = gone

// { userId: { userId, username, firstName, lastName, role, currentPage, currentUrl, loginTime, lastSeen } }
const sessions = {};

/**
 * upsert — called by the heartbeat endpoint.
 * Creates a new entry or refreshes an existing one.
 */
exports.upsert = function (userId, data) {
    const now = new Date();
    sessions[userId] = {
        userId,
        username:    data.username    || sessions[userId]?.username    || '',
        firstName:   data.firstName   || sessions[userId]?.firstName   || '',
        lastName:    data.lastName    || sessions[userId]?.lastName    || '',
        role:        data.role        || sessions[userId]?.role        || '',
        ip:          data.ip          || sessions[userId]?.ip          || '—',
        currentPage: data.currentPage || 'Unknown',
        currentUrl:  data.currentUrl  || '/',
        loginTime:   sessions[userId]?.loginTime || now,
        lastSeen:    now
    };
};

/**
 * remove — called when the user explicitly logs out.
 */
exports.remove = function (userId) {
    delete sessions[userId];
};

/**
 * getActive — returns all non-expired sessions, sorted by username.
 * Cleans up expired entries as a side-effect.
 */
exports.getActive = function () {
    const now   = Date.now();
    const cutoff = now - SESSION_EXPIRY_MS;

    // Prune expired
    Object.keys(sessions).forEach(uid => {
        if (sessions[uid].lastSeen.getTime() < cutoff) delete sessions[uid];
    });

    return Object.values(sessions)
        .map(s => ({
            ...s,
            idleMs:   now - s.lastSeen.getTime(),
            loginTime: s.loginTime,
            lastSeen:  s.lastSeen
        }))
        .sort((a, b) => a.username.localeCompare(b.username));
};
