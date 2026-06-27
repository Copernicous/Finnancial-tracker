'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { getWritableRoot, resolveMaybeWritable } = require('../utils/runtimePaths');

const WRITABLE_ROOT = getWritableRoot();
const DEFAULT_LOCAL_DIR = path.join(WRITABLE_ROOT, 'uploads', 'documents');
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

let cachedDriveToken = null;

function boolEnv(value) {
    return String(value || '').toLowerCase() === 'true';
}

function safeSegment(value) {
    return String(value || 'file')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'file';
}

function uniqueName(originalName) {
    const ext = path.extname(originalName || '').slice(0, 20);
    const base = safeSegment(path.basename(originalName || 'document', ext)).slice(0, 80);
    return Date.now() + '-' + crypto.randomBytes(5).toString('hex') + '-' + base + ext;
}

function escapeDriveQueryValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isDriveConfigured() {
    return boolEnv(process.env.GOOGLE_DRIVE_ENABLED)
        && !!process.env.GOOGLE_DRIVE_CLIENT_ID
        && !!process.env.GOOGLE_DRIVE_CLIENT_SECRET
        && !!process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
}

function getNativeFetch() {
    if (typeof globalThis.fetch !== 'function') {
        throw new Error('Google Drive document storage requires Node.js fetch support.');
    }
    return globalThis.fetch.bind(globalThis);
}

function appendQuery(url, params) {
    const target = new URL(url);
    Object.keys(params || {}).forEach((key) => {
        if (params[key] !== undefined && params[key] !== null) {
            target.searchParams.set(key, String(params[key]));
        }
    });
    return target.toString();
}

function parseGoogleError(text) {
    if (!text) return '';
    try {
        const body = JSON.parse(text);
        if (body.error_description) return body.error_description;
        if (body.error && typeof body.error === 'string') return body.error;
        if (body.error && body.error.message) return body.error.message;
        if (body.message) return body.message;
    } catch {}
    return String(text).trim().slice(0, 300);
}

async function readGoogleJson(res, label) {
    const text = await res.text();
    if (!res.ok) {
        const message = parseGoogleError(text) || res.statusText || 'Unknown Google Drive error';
        throw new Error(label + ' failed (' + res.status + '): ' + message);
    }
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(label + ' returned an invalid JSON response.');
    }
}

async function getDriveAccessToken() {
    const now = Date.now();
    if (cachedDriveToken && cachedDriveToken.expiresAt > now + 60000) {
        return cachedDriveToken.accessToken;
    }

    const body = new URLSearchParams({
        client_id: process.env.GOOGLE_DRIVE_CLIENT_ID,
        client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
        grant_type: 'refresh_token'
    });

    const res = await getNativeFetch()('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    const data = await readGoogleJson(res, 'Google Drive token refresh');
    if (!data.access_token) {
        throw new Error('Google Drive token refresh did not return an access token.');
    }

    const ttlSeconds = Math.max(Number(data.expires_in || 3600) - 60, 60);
    cachedDriveToken = {
        accessToken: data.access_token,
        expiresAt: now + ttlSeconds * 1000
    };
    return cachedDriveToken.accessToken;
}

async function driveFetch(url, options, label, retryUnauthorized) {
    const token = await getDriveAccessToken();
    const headers = new Headers(options && options.headers ? options.headers : {});
    headers.set('Authorization', 'Bearer ' + token);

    const res = await getNativeFetch()(url, Object.assign({}, options, { headers }));
    if (res.status === 401 && retryUnauthorized !== false) {
        cachedDriveToken = null;
        return driveFetch(url, options, label, false);
    }
    return res;
}

async function driveJson(url, options, label) {
    const res = await driveFetch(url, options || {}, label);
    return readGoogleJson(res, label);
}

async function findOrCreateFolder(name, parentId) {
    const safeName = escapeDriveQueryValue(name);
    let query = "mimeType='application/vnd.google-apps.folder' and "
        + "name='" + safeName + "' and trashed=false";
    if (parentId) query += " and '" + escapeDriveQueryValue(parentId) + "' in parents";

    const existing = await driveJson(appendQuery(DRIVE_API_BASE + '/files', {
        q: query,
        spaces: 'drive',
        pageSize: 1,
        fields: 'files(id,name)'
    }), { method: 'GET' }, 'Find Google Drive folder');

    const folder = existing.files && existing.files[0];
    if (folder) return folder.id;

    const requestBody = {
        name,
        mimeType: 'application/vnd.google-apps.folder'
    };
    if (parentId) requestBody.parents = [parentId];

    const created = await driveJson(appendQuery(DRIVE_API_BASE + '/files', {
        fields: 'id,name'
    }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    }, 'Create Google Drive folder');
    return created.id;
}

function patientFolderName(patient) {
    if (!patient) return null;
    const code = patient.patientCode || ('Patient-' + patient.id);
    const fullName = [patient.lastName, patient.firstName].filter(Boolean).join(' ').trim() || 'Unknown Name';
    const dob = patient.dob ? ('DOB ' + patient.dob) : 'DOB unknown';
    return safeSegment(code + ' - ' + fullName + ' - ' + dob);
}

function rxFolderName(rx) {
    const parts = ['RX-' + (rx && rx.id ? rx.id : 'unknown')];
    if (rx && rx.serviceDate) parts.push('Service ' + rx.serviceDate);
    return safeSegment(parts.join(' - '));
}

async function ensureDriveOwnerFolder(ownerType, ownerId, owner) {
    const rootName = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME || 'Home Accounting Documents';
    const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
        || await findOrCreateFolder(rootName, null);
    const patientsId = await findOrCreateFolder('Patients', rootId);

    if (ownerType === 'patient') {
        const folderName = patientFolderName(owner) || ('Patient-' + ownerId);
        return await findOrCreateFolder(folderName, patientsId);
    }

    const patient = owner && owner.Patient ? owner.Patient : null;
    if (patient) {
        const patientId = await findOrCreateFolder(patientFolderName(patient), patientsId);
        const rxGroupId = await findOrCreateFolder('RX Records', patientId);
        return await findOrCreateFolder(rxFolderName(owner), rxGroupId);
    }

    const rxGroupId = await findOrCreateFolder('RX Records', rootId);
    return await findOrCreateFolder('RX-' + ownerId, rxGroupId);
}

async function uploadToDrive(file, ownerType, ownerId, owner) {
    const parentId = await ensureDriveOwnerFolder(ownerType, ownerId, owner);
    const storedName = uniqueName(file.originalname);
    const mimeType = file.mimetype || 'application/octet-stream';
    const boundary = 'rx-drive-' + crypto.randomBytes(16).toString('hex');
    const metadata = JSON.stringify({
        name: storedName,
        parents: [parentId]
    });
    const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || '');
    const body = Buffer.concat([
        Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata + '\r\n'),
        Buffer.from('--' + boundary + '\r\nContent-Type: ' + mimeType + '\r\n\r\n'),
        buffer,
        Buffer.from('\r\n--' + boundary + '--')
    ]);

    const created = await driveJson(appendQuery(DRIVE_UPLOAD_BASE + '/files', {
        uploadType: 'multipart',
        fields: 'id,name,webViewLink,webContentLink'
    }), {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
        body
    }, 'Google Drive file upload');

    return {
        provider: 'drive',
        storedName,
        driveFileId: created.id,
        driveWebViewLink: created.webViewLink || null,
        localPath: null
    };
}

function getLocalBaseDir() {
    const configured = process.env.DOCUMENT_STORAGE_LOCAL_DIR;
    if (!configured) return DEFAULT_LOCAL_DIR;
    return resolveMaybeWritable(configured);
}

async function uploadToLocal(file, ownerType, ownerId) {
    const storedName = uniqueName(file.originalname);
    const dir = path.join(getLocalBaseDir(), ownerType === 'rx-record' ? 'rx-records' : 'patients', String(ownerId));
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, storedName);
    fs.writeFileSync(filepath, file.buffer);
    return {
        provider: 'local',
        storedName,
        driveFileId: null,
        driveWebViewLink: null,
        localPath: filepath
    };
}

async function upload(file, ownerType, ownerId, owner) {
    if (isDriveConfigured()) {
        try {
            return await uploadToDrive(file, ownerType, ownerId, owner);
        } catch (err) {
            if (boolEnv(process.env.GOOGLE_DRIVE_ENABLED)) throw err;
            if (!boolEnv(process.env.DOCUMENT_STORAGE_ALLOW_LOCAL_FALLBACK)) throw err;
            console.warn('[documents] Google Drive upload failed; using local storage because Drive is disabled:', err.message);
        }
    }
    if (boolEnv(process.env.GOOGLE_DRIVE_ENABLED) || boolEnv(process.env.DOCUMENT_STORAGE_REQUIRE_DRIVE)) {
        throw new Error('Google Drive document storage is enabled but not configured.');
    }
    return uploadToLocal(file, ownerType, ownerId);
}

async function openReadStream(attachment) {
    if (attachment.provider === 'drive') {
        if (!attachment.driveFileId) throw new Error('Drive file ID is missing.');
        const url = appendQuery(DRIVE_API_BASE + '/files/' + encodeURIComponent(attachment.driveFileId), {
            alt: 'media'
        });
        const res = await driveFetch(url, { method: 'GET' }, 'Google Drive file download');
        if (!res.ok) {
            const text = await res.text();
            const message = parseGoogleError(text) || res.statusText || 'Unknown Google Drive error';
            throw new Error('Google Drive file download failed (' + res.status + '): ' + message);
        }
        if (res.body && typeof res.body.pipe === 'function') return res.body;
        if (res.body && typeof Readable.fromWeb === 'function') return Readable.fromWeb(res.body);
        throw new Error('Google Drive file download returned an unreadable stream.');
    }

    if (!attachment.localPath || !fs.existsSync(attachment.localPath)) {
        throw new Error('Local document file was not found.');
    }
    return fs.createReadStream(attachment.localPath);
}

async function deleteStoredFile(attachment) {
    if (attachment.provider === 'drive' && attachment.driveFileId && isDriveConfigured()) {
        await driveJson(appendQuery(DRIVE_API_BASE + '/files/' + encodeURIComponent(attachment.driveFileId), {
            fields: 'id,trashed'
        }), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trashed: true })
        }, 'Google Drive file delete');
        return;
    }

    if (attachment.provider === 'local' && attachment.localPath && fs.existsSync(attachment.localPath)) {
        fs.unlinkSync(attachment.localPath);
    }
}

module.exports = {
    upload,
    openReadStream,
    deleteStoredFile,
    isDriveConfigured,
    getLocalBaseDir
};

