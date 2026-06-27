'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { google } = require('googleapis');

const ROOT_DIR = path.join(__dirname, '..');
const CLIENT_FILE = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_FILE
    || path.join(ROOT_DIR, 'secrets', 'google-drive-oauth-client.json');
const TOKEN_FILE = process.env.GOOGLE_DRIVE_TOKEN_FILE
    || path.join(ROOT_DIR, 'secrets', 'google-drive-token.json');
const AUTH_URL_FILE = process.env.GOOGLE_DRIVE_AUTH_URL_FILE
    || path.join(ROOT_DIR, 'secrets', 'google-drive-auth-url.txt');
const ENV_FILE = process.env.GOOGLE_DRIVE_ENV_FILE
    || path.join(ROOT_DIR, '.env');
const ROOT_FOLDER_NAME = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME
    || 'Home Accounting Documents';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function readClientConfig() {
    if (!fs.existsSync(CLIENT_FILE)) {
        throw new Error('OAuth client file not found: ' + CLIENT_FILE);
    }
    const raw = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'));
    const config = raw.installed || raw.web;
    if (!config || !config.client_id || !config.client_secret) {
        throw new Error('OAuth client file is missing client_id or client_secret.');
    }
    return {
        type: raw.installed ? 'installed' : 'web',
        clientId: config.client_id,
        clientSecret: config.client_secret,
        redirectUris: config.redirect_uris || []
    };
}

function ensureSecretsDir() {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function formatEnvValue(value) {
    const text = String(value == null ? '' : value);
    if (/^[A-Za-z0-9_./:@-]+$/.test(text)) return text;
    return JSON.stringify(text);
}

function updateEnvFile(updates) {
    let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text ? text.split(/\r?\n/) : [];
    const seen = new Set();

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^([A-Z0-9_]+)=/);
        if (!match) continue;
        const key = match[1];
        if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
        lines[i] = key + '=' + formatEnvValue(updates[key]);
        seen.add(key);
    }

    const missing = Object.keys(updates).filter((key) => !seen.has(key));
    if (missing.length) {
        if (lines.length && lines[lines.length - 1] !== '') lines.push('');
        lines.push('# Google Drive document storage');
        missing.forEach((key) => {
            lines.push(key + '=' + formatEnvValue(updates[key]));
        });
    }

    text = lines.join(newline).replace(/(\r?\n)*$/, newline);
    fs.writeFileSync(ENV_FILE, text);
}

function escapeDriveQueryValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function openUrl(url) {
    const command = process.platform === 'win32'
        ? ['powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            'Start-Process -FilePath $args[0]',
            url
        ]]
        : process.platform === 'darwin'
            ? ['open', [url]]
            : ['xdg-open', [url]];

    try {
        const child = spawn(command[0], command[1], {
            detached: true,
            stdio: 'ignore',
            shell: false
        });
        child.unref();
    } catch (err) {
        console.log('Could not open browser automatically: ' + err.message);
    }
}

function getRedirectBase(clientConfig) {
    const rawRedirect = clientConfig.redirectUris[0] || 'http://localhost';
    const redirectUrl = new URL(rawRedirect);
    if (redirectUrl.hostname !== 'localhost' && redirectUrl.hostname !== '127.0.0.1') {
        throw new Error('OAuth redirect URI must use localhost for this setup script.');
    }
    return redirectUrl;
}

function waitForOAuthCode(oauth2Client, redirectUrl, authUrl) {
    return new Promise((resolve, reject) => {
        let timeoutId = null;
        const server = http.createServer((req, res) => {
            const requestUrl = new URL(req.url, redirectUrl.origin);
            if (requestUrl.pathname !== redirectUrl.pathname) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Invalid callback path.');
                return;
            }

            const error = requestUrl.searchParams.get('error');
            if (error) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Authorization rejected. You can close this tab.');
                cleanup();
                reject(new Error('Google authorization rejected: ' + error));
                return;
            }

            const code = requestUrl.searchParams.get('code');
            if (!code) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('No authorization code found.');
                cleanup();
                reject(new Error('No authorization code found in callback.'));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h2>Google Drive authorization complete.</h2><p>You can close this tab and return to Home Accounting.</p>');
            cleanup();
            resolve(code);
        });

        function cleanup() {
            if (timeoutId) clearTimeout(timeoutId);
            server.close();
        }

        server.on('error', reject);
        server.listen(0, () => {
            const address = server.address();
            redirectUrl.port = String(address.port);
            oauth2Client.redirectUri = redirectUrl.toString();
            const url = oauth2Client.generateAuthUrl({
                response_type: 'code',
                access_type: 'offline',
                prompt: 'consent',
                scope: SCOPES,
                redirect_uri: redirectUrl.toString()
            });
            fs.writeFileSync(AUTH_URL_FILE, url + '\n');

            console.log('');
            console.log('Open this Google authorization URL if the browser does not open:');
            console.log(url);
            console.log('');
            console.log('Waiting for Google authorization callback...');
            openUrl(url || authUrl);
        });

        timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('Timed out waiting for Google authorization.'));
        }, 15 * 60 * 1000);
    });
}

async function findOrCreateRootFolder(auth) {
    const drive = google.drive({ version: 'v3', auth });
    const safeName = escapeDriveQueryValue(ROOT_FOLDER_NAME);
    const query = "mimeType='application/vnd.google-apps.folder' and "
        + "name='" + safeName + "' and trashed=false";
    const existing = await drive.files.list({
        q: query,
        spaces: 'drive',
        pageSize: 1,
        fields: 'files(id,name)'
    });

    const folder = existing.data.files && existing.data.files[0];
    if (folder) return folder.id;

    const created = await drive.files.create({
        requestBody: {
            name: ROOT_FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id,name'
    });
    return created.data.id;
}

async function main() {
    ensureSecretsDir();
    const clientConfig = readClientConfig();
    const redirectUrl = getRedirectBase(clientConfig);
    const oauth2Client = new google.auth.OAuth2(
        clientConfig.clientId,
        clientConfig.clientSecret,
        redirectUrl.toString()
    );

    console.log('Sign in with the dedicated Drive account and approve access.');
    const code = await waitForOAuthCode(oauth2Client, redirectUrl);
    const tokenResult = await oauth2Client.getToken({
        code,
        redirect_uri: oauth2Client.redirectUri
    });
    oauth2Client.setCredentials(tokenResult.tokens);

    const refreshToken = tokenResult.tokens && tokenResult.tokens.refresh_token;
    if (!refreshToken) {
        throw new Error(
            'Google did not return a refresh token. Revoke this app in the '
            + 'Google account security page, then run npm run drive:auth again.'
        );
    }

    const rootFolderId = await findOrCreateRootFolder(oauth2Client);
    if (fs.existsSync(AUTH_URL_FILE)) {
        fs.unlinkSync(AUTH_URL_FILE);
    }
    const tokenPayload = {
        type: 'authorized_user',
        client_id: clientConfig.clientId,
        client_secret: clientConfig.clientSecret,
        refresh_token: refreshToken,
        scope: SCOPES.join(' '),
        root_folder_id: rootFolderId,
        root_folder_name: ROOT_FOLDER_NAME,
        created_at: new Date().toISOString()
    };

    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenPayload, null, 2) + '\n');
    updateEnvFile({
        GOOGLE_DRIVE_ENABLED: 'true',
        GOOGLE_DRIVE_AUTH_MODE: 'oauth',
        GOOGLE_DRIVE_CLIENT_ID: clientConfig.clientId,
        GOOGLE_DRIVE_CLIENT_SECRET: clientConfig.clientSecret,
        GOOGLE_DRIVE_REFRESH_TOKEN: refreshToken,
        GOOGLE_DRIVE_ROOT_FOLDER_ID: rootFolderId,
        GOOGLE_DRIVE_ROOT_FOLDER_NAME: ROOT_FOLDER_NAME,
        GOOGLE_DRIVE_SCOPE: SCOPES.join(' ')
    });

    console.log('');
    console.log('Google Drive authorization saved.');
    console.log('Root folder name: ' + ROOT_FOLDER_NAME);
    console.log('Root folder ID: ' + rootFolderId);
    console.log('Token file: ' + TOKEN_FILE);
    console.log('.env updated with Google Drive settings.');
}

main().catch((err) => {
    console.error('');
    console.error('Google Drive authorization failed.');
    console.error(err.message);
    process.exit(1);
});

