const crypto = require('crypto');
const db = require('../models');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a cryptographically secure API key: rxk_ + 32 random hex chars */
function generateRawKey() {
    return 'rxk_' + crypto.randomBytes(20).toString('hex');
}

/** SHA-256 hash of the key — what we store in the DB */
function hashKey(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Compute expiry date from a duration string: '30d', '90d', '1y', or 'never' */
function computeExpiry(duration) {
    if (!duration || duration === 'never') return null;
    const now = new Date();
    if (duration === '30d')  { now.setDate(now.getDate() + 30);  return now; }
    if (duration === '90d')  { now.setDate(now.getDate() + 90);  return now; }
    if (duration === '180d') { now.setDate(now.getDate() + 180); return now; }
    if (duration === '1y')   { now.setFullYear(now.getFullYear() + 1); return now; }
    return null;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

/**
 * GET /api/api-keys
 * Returns all API keys (without keyHash). Shows keyPrefix for identification.
 */
exports.getAll = async (req, res) => {
    try {
        const keys = await db.ApiKey.findAll({
            include: [{ model: db.User, as: 'CreatedBy', attributes: ['firstName', 'lastName', 'username'] }],
            order: [['createdAt', 'DESC']]
        });
        // Never return keyHash to the client
        const safe = keys.map(k => {
            const j = k.toJSON();
            delete j.keyHash;
            return j;
        });
        res.json(safe);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

/**
 * POST /api/api-keys
 * Generate a new API key.
 * Body: { name, description?, expiresIn? }
 * Returns: the plaintext key ONCE — it cannot be retrieved again.
 */
exports.generate = async (req, res) => {
    try {
        const { name, description, expiresIn } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'A name/label is required for the API key.' });
        }

        const rawKey   = generateRawKey();
        const hash     = hashKey(rawKey);
        const prefix   = rawKey.substring(0, 12);   // "rxk_XXXXXXXX"
        const expiresAt = computeExpiry(expiresIn);

        const apiKey = await db.ApiKey.create({
            name:            name.trim(),
            description:     description?.trim() || null,
            keyPrefix:       prefix,
            keyHash:         hash,
            createdByUserId: req.user?.id || null,
            isActive:        true,
            expiresAt
        });

        res.status(201).json({
            message: 'API key generated. Copy it now — it will NOT be shown again.',
            id:         apiKey.id,
            name:       apiKey.name,
            keyPrefix:  apiKey.keyPrefix,
            fullKey:    rawKey,     // ← shown ONLY in this response
            expiresAt:  apiKey.expiresAt,
            createdAt:  apiKey.createdAt
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

/**
 * PATCH /api/api-keys/:id/toggle
 * Enable or disable a key without deleting it.
 */
exports.toggle = async (req, res) => {
    try {
        const key = await db.ApiKey.findByPk(req.params.id);
        if (!key) return res.status(404).json({ error: 'API key not found.' });
        key.isActive = !key.isActive;
        await key.save();
        res.json({ id: key.id, isActive: key.isActive });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

/**
 * DELETE /api/api-keys/:id
 * Permanently revoke and delete an API key.
 */
exports.remove = async (req, res) => {
    try {
        const key = await db.ApiKey.findByPk(req.params.id);
        if (!key) return res.status(404).json({ error: 'API key not found.' });
        await key.destroy();
        res.status(204).send();
    } catch (e) { res.status(500).json({ error: e.message }); }
};

/**
 * Middleware: authenticate an incoming request using X-API-Key header.
 * Used to protect API endpoints that external systems call.
 * Attaches req.apiKey = the matched ApiKey record.
 */
exports.authenticateApiKey = async (req, res, next) => {
    const rawKey = req.headers['x-api-key'];
    if (!rawKey) return next();  // no key — fall through to JWT auth

    try {
        const hash = hashKey(rawKey);
        const key  = await db.ApiKey.findOne({ where: { keyHash: hash } });

        if (!key) return res.status(401).json({ error: 'Invalid API key.' });
        if (!key.isActive) return res.status(403).json({ error: 'This API key has been disabled.' });
        if (key.expiresAt && new Date() > new Date(key.expiresAt)) {
            return res.status(403).json({ error: 'This API key has expired.' });
        }

        // Update lastUsedAt asynchronously (don't block the request)
        key.update({ lastUsedAt: new Date() }).catch(() => {});

        req.apiKey = key;
        req.user   = { id: null, role: 'APIClient', username: `api:${key.name}` };
        next();
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
