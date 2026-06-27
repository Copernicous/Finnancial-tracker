/**
 * emailService.js
 *
 * Wraps nodemailer to send emails via Gmail SMTP (or any SMTP server).
 *
 * Configuration is read from system settings (DB) or .env fallback:
 *   SMTP_HOST      â€” default: smtp.gmail.com
 *   SMTP_PORT      â€” default: 587
 *   SMTP_USER      â€” Gmail address
 *   SMTP_PASS      â€” Gmail App Password (NOT your real password)
 *   SMTP_FROM      â€” "From" display name, default: "Home Accounting"
 *
 * Gmail App Password setup:
 *   1. Go to https://myaccount.google.com/security
 *   2. Enable 2-Step Verification
 *   3. Search "App Passwords" â†’ Create one for "Mail"
 *   4. Paste the 16-char password into SMTP_PASS in your .env
 */

const nodemailer = require('nodemailer');

let _transporter = null;

// â”€â”€ Build or return the cached transporter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getTransporter() {
    const host  = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port  = parseInt(process.env.SMTP_PORT || '587', 10);
    const user  = process.env.SMTP_USER || '';
    const pass  = process.env.SMTP_PASS || '';

    if (!user || !pass) {
        throw new Error('Email not configured. Please set SMTP_USER and SMTP_PASS in your .env file.');
    }

    // Re-create the transporter if credentials changed
    const key = `${host}:${port}:${user}`;
    if (!_transporter || _transporter._key !== key) {
        _transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass }
        });
        _transporter._key = key;
    }
    return _transporter;
}

/**
 * Send an email.
 * @param {Object} opts
 * @param {string|string[]} opts.to      - recipient(s)
 * @param {string}          opts.subject - email subject
 * @param {string}          opts.html    - HTML body
 * @param {string}          [opts.text]  - plain-text fallback
 * @param {Object[]}        [opts.attachments] - nodemailer attachments array
 * @returns {Promise<Object>}            - nodemailer send result
 */
exports.sendEmail = async ({ to, subject, html, text, attachments }) => {
    const transporter = getTransporter();
    const fromName  = process.env.SMTP_FROM_NAME || 'Home Accounting';
    const fromEmail = process.env.SMTP_USER;

    const result = await transporter.sendMail({
        from:        `"${fromName}" <${fromEmail}>`,
        to:          Array.isArray(to) ? to.join(', ') : to,
        subject,
        html,
        text:        text || html.replace(/<[^>]+>/g, ''),
        attachments: attachments || []
    });
    return result;
};

/**
 * Test connectivity â€” verify SMTP credentials are valid.
 * Returns { ok: true } or throws an error with a human-readable message.
 */
exports.testConnection = async () => {
    const transporter = getTransporter();
    await transporter.verify();
    return { ok: true, user: process.env.SMTP_USER };
};

/** Returns true if SMTP is configured (user + pass set) */
exports.isConfigured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

/**
 * IMPROVE-04: Send a welcome email to a newly created user.
 * Fire-and-forget â€” errors are logged but never thrown (don't break user creation).
 * @param {Object} opts
 * @param {string} opts.toEmail    - recipient email
 * @param {string} opts.firstName  - recipient first name
 * @param {string} opts.username   - their login username
 * @param {string} [opts.sysUrl]   - optional system URL shown in the email
 */
exports.sendWelcome = async ({ toEmail, firstName, username, sysUrl }) => {
    if (!exports.isConfigured()) return; // SMTP not set up â€” skip silently
    if (!toEmail)                return; // no email address on the user â€” skip
    try {
        const fromName = process.env.SMTP_FROM_NAME || 'Home Accounting';
        const url      = sysUrl || '';
        const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:32px 36px;text-align:center">
    <div style="font-size:2.4rem;margin-bottom:8px">ðŸ’Š</div>
    <h1 style="color:#fff;font-size:1.4rem;font-weight:700;margin:0">Welcome to Home Accounting</h1>
  </div>
  <div style="padding:32px 36px">
    <p style="font-size:1rem;color:#374151">Hi <strong>${firstName || username}</strong>,</p>
    <p style="color:#6b7280;line-height:1.6">Your account has been created by an administrator. Here are your login details:</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin:20px 0">
      <div style="margin-bottom:8px"><span style="color:#9ca3af;font-size:.85rem">Username</span><br><strong style="font-size:1.05rem;color:#111827">${username}</strong></div>
      ${url ? `<div><span style="color:#9ca3af;font-size:.85rem">System URL</span><br><a href="${url}" style="color:#6366f1;font-weight:600">${url}</a></div>` : ''}
    </div>
    <p style="color:#6b7280;line-height:1.6">Your administrator will provide your temporary password. Please change it after your first login.</p>
    <p style="color:#6b7280;font-size:.85rem;margin-top:28px;border-top:1px solid #f3f4f6;padding-top:16px">
      This message was sent by <strong>${fromName}</strong>. If you did not expect this, please contact your administrator.
    </p>
  </div>
</div>`;
        await exports.sendEmail({
            to:      toEmail,
            subject: `Welcome to ${fromName} â€” Your account is ready`,
            html
        });
        console.log(`[Email] Welcome email sent to ${toEmail} (user: ${username})`);
    } catch (err) {
        console.warn(`[Email] Could not send welcome email to ${toEmail}:`, err.message);
    }
};

