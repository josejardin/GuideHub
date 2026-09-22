import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { getAuth, getFirestore, isFirebaseAdminInitialized } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// Load environment variables from project root
dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve all static assets, client portals, and views from the project root
app.use(express.static(ROOT_DIR));

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER?.trim(),
    pass: process.env.GMAIL_APP_PASS?.replace(/\s+/g, '')
  }
});

transporter.verify(error => {
  if (error) {
    console.error(' SMTP Startup Error:', error.message);
  } else {
    console.log(' Gmail SMTP connected and ready for live OTP dispatch.');
  }
});

app.post('/api/send-otp', async (req, res) => {
  const { to, otp, name, role, idNumber, departmentOrProgram, purpose } = req.body;

  const isRegistration = purpose !== 'password_reset';

  // 1. Strict Server-Side Required Fields Validation
  if (!to || !otp || (isRegistration && (!name || !role || !idNumber))) {
    return res.status(400).json({
      error: 'All fields are required. Please complete the registration form.'
    });
  }

  const cleanTo = (to || '').trim().toLowerCase();
  const recipientName = (name || 'Student').trim();
  const emailPrefix = cleanTo.split('@')[0];

  const isStudent = role === 'student' || role === 'college_student' || role === 'shs_student';
  const expectedDomain = isStudent ? '@students.nu-fairview.edu.ph' : '@nu-fairview.edu.ph';

  // 2. Verify Role Domain Matching
  if (isRegistration && !cleanTo.endsWith(expectedDomain)) {
    return res.status(400).json({
      error: `Domain mismatch. ${isStudent ? 'Students must use @students.nu-fairview.edu.ph' : 'Faculty must use @nu-fairview.edu.ph'}.`
    });
  }

  // 3. Validate ID Format per Role
  const studentIdRegex = /^20[1-2][0-9]-(SHS-)?\d{4,7}$/i;
  const empIdRegex = /^(EMP|FAC|STAFF|GC|GCO)-\d{3,4}(-\d{3,4})?$/i;

  if (isRegistration && isStudent && !studentIdRegex.test(idNumber)) {
    return res.status(400).json({
      error: 'Invalid Student ID format. Expected format: YYYY-XXXXXX (e.g., 2024-10892 or 2024-1039005).'
    });
  }

  if (isRegistration && !isStudent && studentIdRegex.test(idNumber)) {
    return res.status(400).json({
      error: 'Student ID numbers cannot be used for Faculty registration. Please use your official Employee ID.'
    });
  }

  if (isRegistration && !isStudent && !empIdRegex.test(idNumber)) {
    return res.status(400).json({
      error: 'Invalid Faculty/Employee ID format. Expected format: FAC-XXXX or EMP-YYYY-XXXX.'
    });
  }

  // 4. Instant Pattern & Troll Filter
  const trollPatterns = /^(test|temp|dummy|admin|fake|asdf|qwerty|sample|none|null|undefined|12345|user)/i;
  const repetitiveChars = /(.)\1{4,}/;

  if (
    trollPatterns.test(emailPrefix) ||
    trollPatterns.test(recipientName) ||
    repetitiveChars.test(emailPrefix) ||
    emailPrefix.length < 3
  ) {
    return res
      .status(400)
      .json({ error: 'Invalid account details detected. Please use your official NU Fairview credentials.' });
  }

  // 5. Prevent Duplicate & Cross-Role Registration
  if (isRegistration) {
    try {
      const authInstance = getAuth();

      // 5a. Check exact target email
      const exactUser = await authInstance.getUserByEmail(cleanTo).catch(err => {
        if (err.code === 'auth/user-not-found') return null;
        throw err;
      });
      if (exactUser) {
        return res.status(409).json({
          error:
            'This institutional email is already registered. If you are unable to access your account, please reset your password or contact the Guidance and Counseling Office (nufairviewgco@gmail.com).'
        });
      }

      // 5b. Check cross-role collision (e.g. student prefix attempting faculty account or vice versa)
      const altDomain = isStudent ? '@nu-fairview.edu.ph' : '@students.nu-fairview.edu.ph';
      const crossEmail = `${emailPrefix}${altDomain}`;
      const crossUser = await authInstance.getUserByEmail(crossEmail).catch(err => {
        if (err.code === 'auth/user-not-found') return null;
        throw err;
      });
      if (crossUser) {
        return res.status(409).json({
          error: `An existing ${isStudent ? 'Faculty' : 'Student'} account already exists with username "${emailPrefix}". Cross-role registration is not permitted.`
        });
      }
    } catch (err) {
      console.error('[ERROR] Account verification check failed:', err);
      return res.status(500).json({ error: 'Failed to verify account uniqueness.' });
    }

    // 5c. Student / Employee ID Duplicate Pre-Check
    if (idNumber) {
      try {
        const firestoreAdmin = getFirestore();
        const cleanId = idNumber.trim();
        const idQuery = await firestoreAdmin.collection('users').where('studentOrEmpId', '==', cleanId).limit(1).get();

        if (!idQuery.empty) {
          return res.status(409).json({
            error: `Student / Employee ID number (${cleanId}) is already registered to an existing account. Please verify your ID number or contact the Guidance and Counseling Office (nufairviewgco@gmail.com).`
          });
        }
      } catch (idErr) {
        console.warn('[WARNING] ID pre-check notice:', idErr.message);
      }
    }
  }

  const logoPath = path.join(ROOT_DIR, 'assets', 'nu-logo.png');

  const mailOptions = {
    from: `"NU Fairview Guidance Center" <${process.env.GMAIL_USER}>`,
    to: cleanTo,
    replyTo: process.env.GMAIL_USER,
    subject: `GuideHub Verification Code: ${otp}`,
    text: `Hello ${recipientName},\n\nYour 6-digit NU Fairview GuideHub verification code is: ${otp}\n\nThis code expires in 5 minutes.\n\n- National University Fairview Guidance and Counseling Center`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>GuideHub Verification Code</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 32px 16px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0, 32, 91, 0.08);">
                <tr>
                  <td height="6" style="background-color: #F5B800; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="background-color: #00205B; padding: 28px 24px; text-align: center;">
                    <img src="cid:nulogo" alt="National University" style="width: 56px; height: auto; margin-bottom: 12px; display: inline-block;" />
                    <h1 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">National University Fairview</h1>
                    <p style="margin: 4px 0 0 0; color: #F5B800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Guidance and Counseling Center • GuideHub</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 32px 28px 24px 28px;">
                    <h2 style="margin: 0 0 12px 0; color: #0f172a; font-size: 18px; font-weight: 700; text-align: left;">Account Verification Code</h2>
                    <p style="margin: 0 0 16px 0; color: #334155; font-size: 14px; line-height: 1.5;">Hello <strong>${recipientName}</strong>,</p>
                    <p style="margin: 0 0 24px 0; color: #475569; font-size: 13px; line-height: 1.6;">
                      You are completing your institutional identity registration for the <strong>NU Fairview GuideHub</strong> counseling and student care portal. Please use the official single-use verification code below:
                    </p>
                    <div style="background-color: #f8fafc; border: 2px dashed #00205B; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                      <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 900; color: #00205B; letter-spacing: 10px; display: inline-block; padding-left: 10px;">${otp}</span>
                    </div>
                    <div style="background-color: #fffbeb; border-left: 4px solid #F5B800; padding: 12px 16px; margin-bottom: 24px; border-radius: 0 8px 8px 0;">
                      <p style="margin: 0; color: #92400e; font-size: 12px; line-height: 1.5;">
                        <strong>Security Notice:</strong> This code expires in <strong>5 minutes</strong>. If you did not initiate this request from the official GuideHub portal, please immediately report this to the Guidance Office.
                      </p>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #f8fafc; padding: 20px 28px; text-align: center; border-top: 1px solid #f1f5f9;">
                    <p style="margin: 0; color: #64748b; font-size: 11px; line-height: 1.4;">
                      National University Fairview • Guidance & Counseling Office<br />
                      In compliance with RA 9258 (Guidance and Counseling Act) & RA 10173 (Data Privacy Act)
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    attachments: [{ filename: 'nu-logo.png', path: logoPath, cid: 'nulogo' }]
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(` [LIVE OTP DISPATCHED] Destination: ${cleanTo} | MsgID: ${info.messageId}`);
    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error(' LIVE DISPATCH ERROR:', error.message);
    return res.status(500).json({ error: 'Unable to deliver verification code to this address.' });
  }
});

app.post('/api/admin-alert', async (req, res) => {
  const { eventType, details } = req.body || {};

  if (!eventType || !details) {
    return res.status(400).json({ error: 'eventType and details are required' });
  }

  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' });
  const adminEmail = process.env.GMAIL_USER || 'nufairviewgco@gmail.com';
  const logoPath = path.join(ROOT_DIR, 'assets', 'nu-logo.png');

  let subject = '';
  let badgeColor = '';
  let badgeText = '';
  let headline = '';
  let bodyHtml = '';

  if (eventType === 'REGISTRATION_SUCCESS') {
    subject = ` [SECURITY AUDIT] New Account Verified - ${details.fullName} (${details.role.toUpperCase()})`;
    badgeColor = '#10b981';
    badgeText = 'VERIFIED REGISTRATION';
    headline = 'Institutional Account Provisioned';
    bodyHtml = `
      <p style="margin: 0 0 16px 0; color: #334155; font-size: 14px; line-height: 1.6;">
        A user has completed 6-digit OTP verification and successfully registered an institutional account:
      </p>
      <table width="100%" cellpadding="8" cellspacing="0" style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 13px; margin-bottom: 20px;">
        <tr><td width="35%" style="color: #64748b; font-weight: 600;">Full Legal Name:</td><td style="color: #0f172a; font-weight: bold;">${details.fullName}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Institutional Email:</td><td style="color: #00205B; font-weight: bold;">${details.email}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Assigned Role:</td><td style="color: #0f172a; text-transform: uppercase; font-weight: bold;">${details.role}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Student / Employee ID:</td><td style="color: #0f172a; font-family: monospace;">${details.studentOrEmpId || 'N/A'}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Program / Department:</td><td style="color: #0f172a;">${details.departmentOrProgram || 'N/A'}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Verification Timestamp:</td><td style="color: #0f172a;">${timestamp} (PHT)</td></tr>
      </table>
    `;
  } else if (eventType === 'REGISTRATION_BLOCKED') {
    subject = ` [SECURITY WARNING] Registration Attempt Blocked - ${details.email || 'Unknown'}`;
    badgeColor = '#ef4444';
    badgeText = 'REGISTRATION BLOCKED';
    headline = 'Unauthorized or Malformed Attempt Intercepted';
    bodyHtml = `
      <p style="margin: 0 0 16px 0; color: #334155; font-size: 14px; line-height: 1.6;">
        The system rejected an account creation or OTP verification attempt for the following reason:
      </p>
      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; margin-bottom: 20px; border-radius: 0 8px 8px 0;">
        <strong style="color: #991b1b; font-size: 13px;">Rejection Reason:</strong>
        <p style="margin: 4px 0 0 0; color: #b91c1c; font-size: 12px;">${details.reason || 'Failed institutional identity checks.'}</p>
      </div>
      <table width="100%" cellpadding="8" cellspacing="0" style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 13px; margin-bottom: 20px;">
        <tr><td width="35%" style="color: #64748b; font-weight: 600;">Submitted Name:</td><td style="color: #0f172a;">${details.fullName || 'N/A'}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Target Email:</td><td style="color: #00205B; font-family: monospace;">${details.email || 'N/A'}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Attempted Role:</td><td style="color: #0f172a;">${details.role || 'N/A'}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Submitted ID:</td><td style="color: #0f172a; font-family: monospace;">${details.studentOrEmpId || 'N/A'}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Attempt Timestamp:</td><td style="color: #0f172a;">${timestamp} (PHT)</td></tr>
      </table>
    `;
  } else {
    subject = ` [SECURITY EVENT] GuideHub Notification - ${eventType}`;
    badgeColor = '#00205B';
    badgeText = eventType;
    headline = 'System Security Event';
    bodyHtml = `<pre style="background:#f8fafc; padding:12px; font-size:12px; border:1px solid #e2e8f0;">${JSON.stringify(details, null, 2)}</pre>`;
  }

  const mailOptions = {
    from: `"GuideHub Security Monitor" <${process.env.GMAIL_USER}>`,
    to: adminEmail,
    subject: subject,
    text: `${headline}\nEvent: ${eventType}\nTimestamp: ${timestamp}\nDetails:\n${JSON.stringify(details, null, 2)}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <title>${subject}</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="padding: 32px 16px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
                <tr><td height="6" style="background-color: ${badgeColor};"></td></tr>
                <tr>
                  <td style="background-color: #00205B; padding: 24px; text-align: center;">
                    <img src="cid:nulogo" alt="National University" style="width: 48px; height: auto; margin-bottom: 8px; display: inline-block;" />
                    <h2 style="margin: 0; color: #ffffff; font-size: 16px; text-transform: uppercase;">National University Fairview</h2>
                    <p style="margin: 2px 0 0 0; color: #F5B800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Guidance Center • Security Audit System</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 28px 24px;">
                    <div style="display: inline-block; padding: 4px 10px; border-radius: 6px; background-color: ${badgeColor}20; color: ${badgeColor}; font-size: 10px; font-weight: 800; text-transform: uppercase; margin-bottom: 12px;">
                      ${badgeText}
                    </div>
                    <h3 style="margin: 0 0 16px 0; color: #0f172a; font-size: 18px;">${headline}</h3>
                    ${bodyHtml}
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #f1f5f9;">
                    <p style="margin: 0; color: #64748b; font-size: 11px;">
                      Automated Security Monitor • NU Fairview Guidance &amp; Counseling Center<br />
                      Confidential under RA 9258 &amp; RA 10173
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    attachments: [{ filename: 'nu-logo.png', path: logoPath, cid: 'nulogo' }]
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(` [ADMIN ALERT DISPATCHED] Event: ${eventType} | MsgID: ${info.messageId}`);
    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error(' ADMIN ALERT ERROR:', err.message);
    return res.status(500).json({ error: 'Failed to dispatch security notification.' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ success: false, error: 'Email, OTP, and new password are required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const auth = getAuth();

    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(normalizedEmail);
    } catch (userErr) {
      if (userErr.code === 'auth/user-not-found') {
        return res
          .status(404)
          .json({ success: false, error: 'No registered account found with this institutional email.' });
      }
      throw userErr;
    }

    await auth.updateUser(userRecord.uid, {
      password: newPassword
    });

    console.log(` [PASSWORD UPDATED] Credentials successfully updated for ${normalizedEmail}`);

    const mailOptions = {
      from: `"GuideHub Security" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: ` [PASSWORD RESET] Account Password Changed - ${normalizedEmail}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; background-color: #f8fafc;">
          <div style="max-width: 480px; margin: auto; background: white; border-radius: 8px; padding: 24px; border: 1px solid #e2e8f0;">
            <h3 style="color: #00205B; margin-top: 0;">Password Reset Completed</h3>
            <p style="color: #334155; font-size: 14px;">The account associated with <strong>${normalizedEmail}</strong> has successfully updated its credentials.</p>
            <p style="color: #64748b; font-size: 12px; margin-top: 20px;">Timestamp: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })}</p>
          </div>
        </div>
      `
    };
    transporter.sendMail(mailOptions).catch(err => console.error('Alert error:', err));

    return res.status(200).json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Server error while resetting password.' });
  }
});

// Explicit route for root landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

// Universal fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(` GuideHub running at http://localhost:${PORT}`);
});
