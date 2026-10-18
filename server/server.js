import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initializeApp as initClientApp, deleteApp } from 'firebase/app';
import { getAuth as getClientAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
  getAuth,
  getFirestore,
  isFirebaseAdminInitialized,
  adminAuth,
  adminDb,
  clientDb,
  findAccountByEmail,
  findAccountById,
  findAccountByFullName,
  verifyServerOtp,
  escapeHtml
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// Load environment variables from project root
dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Security headers & sensitive path protection middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const reqPath = (req.path || '').toLowerCase();
  if (
    reqPath === '/' ||
    reqPath.endsWith('.html') ||
    reqPath.startsWith('/portals/') ||
    reqPath.startsWith('/auth/')
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  const blockedPrefixes = ['/server', '/scripts', '/.git', '/.env', '/node_modules'];
  const blockedFiles = [
    '/package.json',
    '/package-lock.json',
    '/firestore.rules',
    '/vercel.json',
    '/serviceaccountkey.json',
    '/.prettierrc',
    '/.prettierignore',
    '/.gitignore'
  ];

  if (
    blockedPrefixes.some(prefix => reqPath === prefix || reqPath.startsWith(`${prefix}/`) || reqPath.startsWith(prefix)) ||
    blockedFiles.includes(reqPath)
  ) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  next();
});

// Cache heavy static assets (images/icons) to accelerate public tunnel loading
app.use('/assets', express.static(path.join(ROOT_DIR, 'assets'), { maxAge: '1d', immutable: false }));

// Serve static assets, client portals, and views from project root (denying dotfiles)
app.use(express.static(ROOT_DIR, { dotfiles: 'deny', maxAge: '5m' }));

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
  const { to, otp, name, role, idNumber, departmentOrProgram, purpose } = req.body || {};

  const isRegistration = purpose !== 'password_reset';

  // 1. Strict Server-Side Required Fields Validation
  if (!to || !otp || (isRegistration && (!name || !role || !idNumber))) {
    return res.status(400).json({
      error: 'All fields are required. Please complete the registration form.'
    });
  }

  if (!/^\d{6}$/.test(String(otp).trim())) {
    return res.status(400).json({ error: 'Invalid OTP format. Must be a 6-digit numeric code.' });
  }

  const cleanTo = (to || '').trim().toLowerCase();
  const recipientName = (name || 'Nationalian').trim();
  const emailPrefix = cleanTo.split('@')[0];

  const isStudentDomainEmail = cleanTo.endsWith('@students.nu-fairview.edu.ph');
  const isStaffDomainEmail = cleanTo.endsWith('@nu-fairview.edu.ph') && !isStudentDomainEmail;

  if (!isStudentDomainEmail && !isStaffDomainEmail) {
    return res.status(400).json({
      error: 'Only official @students.nu-fairview.edu.ph or @nu-fairview.edu.ph institutional emails are permitted.'
    });
  }

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
  const empIdRegex = /^(?:\d{2,3}-\d{2,7}|(?:EMP|FAC|STAFF|GC|GCO)-\d{2,4}(?:-\d{2,7})?)$/i;

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
      error: 'Invalid Faculty/Employee ID format. Expected format: XX-XXXX or XXX-XXXX (e.g., 24-0102 or 102-0451).'
    });
  }

  // 4. Instant Pattern & Troll Filter
  const trollPatterns = /^(test|temp|dummy|admin|fake|asdf|qwerty|sample|none|null|undefined|12345|user)$/i;
  const repetitiveChars = /(.)\1{4,}/;

  if (
    isRegistration &&
    (trollPatterns.test(emailPrefix) ||
      trollPatterns.test(recipientName) ||
      repetitiveChars.test(emailPrefix) ||
      emailPrefix.length < 3)
  ) {
    return res
      .status(400)
      .json({ error: 'Invalid account details detected. Please use your official NU Fairview credentials.' });
  }

  // 5. Prevent Duplicate & Cross-Role Registration (or verify account exists for Password Reset)
  if (isRegistration) {
    try {
      // 5a. Check exact target email across hierarchical and root users
      const exactUser = await findAccountByEmail(cleanTo);
      if (exactUser) {
        return res.status(409).json({
          error:
            'This institutional email is already registered. If you are unable to access your account, please reset your password or contact the Guidance and Counseling Office (nufairviewgco@gmail.com).'
        });
      }

      // 5b. Check cross-role collision (e.g. student prefix attempting faculty account or vice versa)
      const altDomain = isStudent ? '@nu-fairview.edu.ph' : '@students.nu-fairview.edu.ph';
      const crossEmail = `${emailPrefix}${altDomain}`;
      const crossUser = await findAccountByEmail(crossEmail);
      if (crossUser) {
        return res.status(409).json({
          error: `An existing ${isStudent ? 'Faculty' : 'Student'} account already exists with username "${emailPrefix}". Cross-role registration is not permitted.`
        });
      }

      // 5c. Student / Employee ID Duplicate Pre-Check
      if (idNumber) {
        const cleanId = idNumber.trim();
        const existingIdUser = await findAccountById(cleanId);
        if (existingIdUser) {
          return res.status(409).json({
            error: `Student / Employee ID number (${cleanId}) is already registered to an existing account. Please verify your ID number or contact the Guidance and Counseling Office (nufairviewgco@gmail.com).`
          });
        }
      }
    } catch (err) {
      console.warn('[WARNING] Account uniqueness pre-check notice:', err.message);
    }
  } else {
    try {
      const existingAccount = await findAccountByEmail(cleanTo);
      if (!existingAccount) {
        return res.status(404).json({
          error: 'No registered GuideHub account was found for this institutional email address.'
        });
      }
    } catch (err) {
      console.warn('[WARNING] Password reset account lookup notice:', err.message);
    }
  }

  const logoPath = path.join(ROOT_DIR, 'assets', 'nu-logo.png');
  const safeName = escapeHtml(recipientName);
  const safeOtp = escapeHtml(otp);

  const mailOptions = {
    from: `"NU Fairview Guidance Center" <${process.env.GMAIL_USER}>`,
    to: cleanTo,
    replyTo: process.env.GMAIL_USER,
    subject: `GuideHub Verification Code: ${safeOtp}`,
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
                    <p style="margin: 0 0 16px 0; color: #334155; font-size: 14px; line-height: 1.5;">Hello <strong>${safeName}</strong>,</p>
                    <p style="margin: 0 0 24px 0; color: #475569; font-size: 13px; line-height: 1.6;">
                      You are completing your institutional identity verification for the <strong>NU Fairview GuideHub</strong> counseling and student care portal. Please use the official single-use verification code below:
                    </p>
                    <div style="background-color: #f8fafc; border: 2px dashed #00205B; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                      <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 900; color: #00205B; letter-spacing: 10px; display: inline-block; padding-left: 10px;">${safeOtp}</span>
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
    attachments: [{ filename: 'nu-logo.png', path: logoPath, cid: 'nulogo' }],
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
      Importance: 'high'
    }
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(` [LIVE OTP DISPATCHED] Destination: ${cleanTo} | OTP Code: ${otp} | MsgID: ${info.messageId}`);
    return res.status(200).json({ success: true, messageId: info.messageId, otp: otp });
  } catch (error) {
    console.warn(
      ` [DEVELOPMENT / DISPATCH FALLBACK] Live SMTP dispatch failed (${error.message}). Simulating OTP for testing.`
    );
    console.info(`=======================================================`);
    console.info(` [DEV MODE OTP] Target: ${cleanTo} | OTP Code: ${otp}`);
    console.info(`=======================================================`);
    return res.status(200).json({
      success: true,
      simulated: true,
      otp: otp,
      message: 'Email service notice: Verification code simulated for local environment.'
    });
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

  const safeFullName = escapeHtml(details.fullName || 'N/A');
  const safeEmail = escapeHtml(details.email || 'N/A');
  const safeRole = escapeHtml(details.role || 'N/A');
  const safeId = escapeHtml(details.studentOrEmpId || 'N/A');
  const safeDept = escapeHtml(details.departmentOrProgram || 'N/A');
  const safeReason = escapeHtml(details.reason || 'Failed institutional identity checks.');

  let subject = '';
  let badgeColor = '';
  let badgeText = '';
  let headline = '';
  let bodyHtml = '';

  if (eventType === 'REGISTRATION_SUCCESS') {
    subject = ` [SECURITY AUDIT] New Account Verified - ${safeFullName} (${safeRole.toUpperCase()})`;
    badgeColor = '#10b981';
    badgeText = 'VERIFIED REGISTRATION';
    headline = 'Institutional Account Provisioned';
    bodyHtml = `
      <p style="margin: 0 0 16px 0; color: #334155; font-size: 14px; line-height: 1.6;">
        A user has completed 6-digit OTP verification and successfully registered an institutional account:
      </p>
      <table width="100%" cellpadding="8" cellspacing="0" style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 13px; margin-bottom: 20px;">
        <tr><td width="35%" style="color: #64748b; font-weight: 600;">Full Legal Name:</td><td style="color: #0f172a; font-weight: bold;">${safeFullName}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Institutional Email:</td><td style="color: #00205B; font-weight: bold;">${safeEmail}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Assigned Role:</td><td style="color: #0f172a; text-transform: uppercase; font-weight: bold;">${safeRole}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Student / Employee ID:</td><td style="color: #0f172a; font-family: monospace;">${safeId}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Program / Department:</td><td style="color: #0f172a;">${safeDept}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Verification Timestamp:</td><td style="color: #0f172a;">${timestamp} (PHT)</td></tr>
      </table>
    `;
  } else if (eventType === 'REGISTRATION_BLOCKED') {
    subject = ` [SECURITY WARNING] Registration Attempt Blocked - ${safeEmail}`;
    badgeColor = '#ef4444';
    badgeText = 'REGISTRATION BLOCKED';
    headline = 'Unauthorized or Malformed Attempt Intercepted';
    bodyHtml = `
      <p style="margin: 0 0 16px 0; color: #334155; font-size: 14px; line-height: 1.6;">
        The system rejected an account creation or OTP verification attempt for the following reason:
      </p>
      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; margin-bottom: 20px; border-radius: 0 8px 8px 0;">
        <strong style="color: #991b1b; font-size: 13px;">Rejection Reason:</strong>
        <p style="margin: 4px 0 0 0; color: #b91c1c; font-size: 12px;">${safeReason}</p>
      </div>
      <table width="100%" cellpadding="8" cellspacing="0" style="background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 13px; margin-bottom: 20px;">
        <tr><td width="35%" style="color: #64748b; font-weight: 600;">Submitted Name:</td><td style="color: #0f172a;">${safeFullName}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Target Email:</td><td style="color: #00205B; font-family: monospace;">${safeEmail}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Attempted Role:</td><td style="color: #0f172a;">${safeRole}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Submitted ID:</td><td style="color: #0f172a; font-family: monospace;">${safeId}</td></tr>
        <tr><td style="color: #64748b; font-weight: 600;">Attempt Timestamp:</td><td style="color: #0f172a;">${timestamp} (PHT)</td></tr>
      </table>
    `;
  } else {
    subject = ` [SECURITY EVENT] GuideHub Notification - ${escapeHtml(eventType)}`;
    badgeColor = '#00205B';
    badgeText = escapeHtml(eventType);
    headline = 'System Security Event';
    bodyHtml = `<pre style="background:#f8fafc; padding:12px; font-size:12px; border:1px solid #e2e8f0;">${escapeHtml(JSON.stringify(details, null, 2))}</pre>`;
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
        <title>${escapeHtml(subject)}</title>
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
  const { email, otp, newPassword } = req.body || {};

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ success: false, error: 'Email, OTP, and new password are required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Verify institutional domain
  if (!normalizedEmail.endsWith('@students.nu-fairview.edu.ph') && !normalizedEmail.endsWith('@nu-fairview.edu.ph')) {
    return res.status(400).json({ success: false, error: 'Only official NU Fairview institutional emails are supported.' });
  }

  // Server-side OTP verification against Firestore
  const otpCheck = await verifyServerOtp(normalizedEmail, otp);
  if (!otpCheck.valid) {
    return res.status(otpCheck.status || 400).json({ success: false, error: otpCheck.error });
  }

  try {
    if (isFirebaseAdminInitialized) {
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
    } else {
      const apiKey = process.env.FIREBASE_API_KEY || 'AIzaSyAqPNF4SRiyF8nZbFPLraUHldNoxvHQiQk';
      const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: [normalizedEmail] })
      });
      const lookupData = await lookupRes.json();
      if (!lookupData.users || lookupData.users.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: 'No registered account found with this institutional email.' });
      }
      const localId = lookupData.users[0].localId;
      const updateRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          localId,
          password: newPassword,
          returnSecureToken: false
        })
      });
      const updateData = await updateRes.json();
      if (!updateRes.ok) {
        return res
          .status(500)
          .json({ success: false, error: updateData.error?.message || 'Failed to update credentials in Firebase Auth.' });
      }
    }

    console.log(` [PASSWORD UPDATED] Credentials successfully updated for ${normalizedEmail}`);

    const safeNormEmail = escapeHtml(normalizedEmail);
    const mailOptions = {
      from: `"GuideHub Security" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: ` [PASSWORD RESET] Account Password Changed - ${safeNormEmail}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; background-color: #f8fafc;">
          <div style="max-width: 480px; margin: auto; background: white; border-radius: 8px; padding: 24px; border: 1px solid #e2e8f0;">
            <h3 style="color: #00205B; margin-top: 0;">Password Reset Completed</h3>
            <p style="color: #334155; font-size: 14px;">The account associated with <strong>${safeNormEmail}</strong> has successfully updated its credentials.</p>
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

// Helper function to format 12-hour time strings
function format12hTime(timeStr) {
  if (!timeStr) return 'Scheduled Time';
  return timeStr
    .split('-')
    .map(part => {
      const trimmed = part.trim();
      const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return trimmed;
      let h = parseInt(match[1], 10);
      const m = match[2];
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${m} ${ampm}`;
    })
    .join(' - ');
}

// Endpoint: Send Automated Email Notification When Counselor Confirms Booking
app.post('/api/send-appointment-confirmation', async (req, res) => {
  try {
    const {
      studentEmail,
      studentName,
      studentNumber,
      studentId,
      studentAuthUid,
      counselorName,
      date,
      timeSlot,
      concernCategory,
      appointmentId,
      location = 'Guidance & Counseling Center (2nd Floor, Main Building)'
    } = req.body || {};

    let targetEmail = (studentEmail || '').trim().toLowerCase();

    // Auto-resolve student email by ID number, studentId, studentAuthUid, or Full Name if omitted or missing
    const idsToTry = [studentNumber, studentId, studentAuthUid].filter(Boolean);
    for (const testId of idsToTry) {
      if (targetEmail) break;
      try {
        const acct = await findAccountById(testId);
        if (acct && acct.email) {
          targetEmail = acct.email.trim().toLowerCase();
        }
      } catch (err) {
        console.warn('[WARNING] ID-based email lookup notice:', err.message);
      }
    }

    if (!targetEmail && studentName) {
      try {
        const acct = await findAccountByFullName(studentName);
        if (acct && acct.email) {
          targetEmail = acct.email.trim().toLowerCase();
        }
      } catch (err) {
        console.warn('[WARNING] Name-based email lookup notice:', err.message);
      }
    }

    if (!targetEmail) {
      console.warn(`[WARNING] No email address could be resolved for student: "${studentName}" (${studentNumber})`);
      return res.status(400).json({
        success: false,
        error: 'Unable to resolve registered student institutional email. Please verify student account credentials.'
      });
    }

    const cleanEmail = targetEmail;
    const safeStudentName = escapeHtml(studentName || 'Nationalian');
    const safeCounselorName = escapeHtml(counselorName || 'Guidance Counselor');
    const safeDate = escapeHtml(date || 'Scheduled Date');
    const safeTime = escapeHtml(format12hTime(timeSlot));
    const safeCategory = escapeHtml(concernCategory || 'General Guidance Consultation');
    const safeAptId = escapeHtml(appointmentId || 'N/A');
    const safeLocation = escapeHtml(location);

    // Format human-friendly calendar date (e.g., Monday, October 20, 2026)
    let displayDate = safeDate;
    try {
      if (date && date.includes('-')) {
        const [y, m, d] = date.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        if (!isNaN(dateObj.getTime())) {
          displayDate = dateObj.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
        }
      }
    } catch (_) {}

    const logoPath = path.join(ROOT_DIR, 'assets', 'nu-logo.png');

    const mailOptions = {
      from: `"NU Fairview Guidance Center" <${process.env.GMAIL_USER}>`,
      to: cleanEmail,
      replyTo: process.env.GMAIL_USER,
      subject: `[APPOINTMENT CONFIRMED] Consultation Confirmed - ${displayDate}`,
      text: `Hello ${studentName || 'Nationalian'},\n\nYour guidance consultation request has been confirmed by ${counselorName}.\n\nDate: ${displayDate}\nTime: ${safeTime}\nLocation: ${location}\nConcern: ${concernCategory}\nReference ID: ${appointmentId}\n\nPlease arrive 5-10 minutes early at the Guidance Office.\n\n- National University Fairview Guidance and Counseling Center`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Appointment Confirmed</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 32px 16px;">
            <tr>
              <td align="center">
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 14px rgba(0, 32, 91, 0.08);">
                  <!-- Institutional Navy Header -->
                  <tr>
                    <td style="background-color: #00205B; padding: 26px 24px; text-align: center;">
                      <table border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                        <tr>
                          <td style="vertical-align: middle; padding-right: 12px;">
                            <img src="cid:nulogo" alt="NU Logo" width="46" height="46" style="display: block; width: 46px; height: 46px; object-fit: contain;" />
                          </td>
                          <td style="vertical-align: middle; text-align: left;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 17px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">National University Fairview</h1>
                            <p style="margin: 3px 0 0 0; color: #F5B800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Guidance and Counseling Center • GuideHub</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Confirmation Badge Banner -->
                  <tr>
                    <td style="background-color: #ecfdf5; border-bottom: 1px solid #a7f3d0; padding: 14px 24px; text-align: center;">
                      <span style="display: inline-block; color: #065f46; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">
                        ✓ Consultation Request Confirmed &amp; Scheduled
                      </span>
                    </td>
                  </tr>

                  <!-- Body Content -->
                  <tr>
                    <td style="padding: 28px 24px 20px 24px;">
                      <p style="margin: 0 0 14px 0; color: #334155; font-size: 15px; line-height: 1.5;">Hello <strong>${safeStudentName}</strong>,</p>
                      <p style="margin: 0 0 20px 0; color: #475569; font-size: 13px; line-height: 1.6;">
                        Your counseling appointment request has been reviewed and officially confirmed by your guidance counselor. We are looking forward to providing you with a safe, comforting, and confidential space to talk.
                      </p>

                      <!-- Session Details Card -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 22px; overflow: hidden;">
                        <tr>
                          <td colspan="2" style="background-color: #00205B; color: #ffffff; padding: 10px 16px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                            Appointment Summary
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600; width: 38%;">Assigned Counselor:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 13px; font-weight: 700;">${safeCounselorName}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600;">Date:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 13px; font-weight: 700;">${displayDate}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600;">Time Slot:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #00205B; font-size: 13px; font-weight: 800;">${safeTime}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600;">Location / Venue:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 12px;">${safeLocation}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600;">Category:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 12px;">${safeCategory}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 16px; color: #64748b; font-size: 12px; font-weight: 600;">Reference Code:</td>
                          <td style="padding: 10px 16px; color: #64748b; font-size: 11px; font-family: monospace;">${safeAptId}</td>
                        </tr>
                      </table>

                      <!-- Helpful Guidance Reminders -->
                      <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
                        <strong style="color: #1e40af; font-size: 12px; display: block; margin-bottom: 4px;">Important Reminders:</strong>
                        <ul style="margin: 0; padding-left: 18px; color: #1e3a8a; font-size: 11px; line-height: 1.5;">
                          <li>Please arrive at the Guidance Office 5 to 10 minutes before your scheduled appointment.</li>
                          <li>If you need to excuse yourself from a class, your counselor can issue an official digital <strong>Institutional Call Slip</strong> during or right after the session.</li>
                          <li>If you need to reschedule or cancel due to an academic conflict, please update your appointment in GuideHub at least 24 hours in advance so another student may be accommodated.</li>
                        </ul>
                      </div>

                      <p style="margin: 0; color: #64748b; font-size: 11px; line-height: 1.5; font-style: italic;">
                        "Whatever you're going through, you don't have to carry it all alone. We're here to listen with an open heart."
                      </p>
                    </td>
                  </tr>

                  <!-- Institutional Footer -->
                  <tr>
                    <td style="background-color: #f8fafc; padding: 18px 24px; text-align: center; border-top: 1px solid #f1f5f9;">
                      <p style="margin: 0 0 6px 0; color: #64748b; font-size: 11px; line-height: 1.4;">
                        National University Fairview • Guidance &amp; Counseling Center<br />
                        In compliance with RA 9258 (Guidance and Counseling Act) &amp; RA 10173 (Data Privacy Act)
                      </p>
                      <p style="margin: 0; color: #94a3b8; font-size: 10px;">
                        This is an automated confirmation from the NU Fairview GuideHub Care Portal.
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
      attachments: [{ filename: 'nu-logo.png', path: logoPath, cid: 'nulogo' }],
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        Importance: 'high'
      }
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(` [LIVE CONFIRMATION DISPATCHED] Destination: ${cleanEmail} | MsgID: ${info.messageId}`);
    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      recipient: cleanEmail
    });
  } catch (err) {
    console.error(' [CONFIRMATION EMAIL ERROR]:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'Server error sending email.' });
  }
});

// Admin Route: Direct Staff Account Provisioning
app.post('/api/admin/create-staff', async (req, res) => {
  try {
    const { fullName, email, password, role, department, studentOrEmpId, gender, contactNumber } = req.body || {};

    if (!fullName || !email || !password || !role || !studentOrEmpId) {
      return res.status(400).json({
        error: 'Please provide all required fields: full name, institutional email, password, role, and employee ID.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanRole = role.trim().toLowerCase();
    const cleanId = studentOrEmpId.trim();

    if (!cleanEmail.endsWith('@nu-fairview.edu.ph') || cleanEmail.endsWith('@students.nu-fairview.edu.ph')) {
      return res.status(400).json({
        error: 'Staff accounts must use the official institutional domain (@nu-fairview.edu.ph).'
      });
    }

    const allowedRoles = ['counselor', 'faculty', 'head', 'admin'];
    if (!allowedRoles.includes(cleanRole)) {
      return res.status(400).json({ error: 'Invalid staff role specified.' });
    }

    // 1. Check existing account in database
    const existing = await findAccountByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: `An account with email "${cleanEmail}" is already registered.` });
    }

    const existingId = await findAccountById(cleanId);
    if (existingId) {
      return res.status(409).json({ error: `Employee ID "${cleanId}" is already assigned to an existing account.` });
    }

    // 2. Create in Firebase Auth using a dedicated client instance
    let authUid = null;
    const clientFirebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyAqPNF4SRiyF8nZbFPLraUHldNoxvHQiQk',
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'guideone-a6ee4.firebaseapp.com',
      projectId: process.env.FIREBASE_PROJECT_ID || 'guideone-a6ee4',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'guideone-a6ee4.firebasestorage.app',
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '239656505483',
      appId: process.env.FIREBASE_APP_ID || '1:239656505483:web:287895cbc2757f512fc48e'
    };

    let tempApp = null;
    try {
      tempApp = initClientApp(clientFirebaseConfig, 'staff-prov-' + Date.now() + Math.random().toString(36).slice(2, 6));
      const tempAuth = getClientAuth(tempApp);
      try {
        const cred = await createUserWithEmailAndPassword(tempAuth, cleanEmail, password);
        authUid = cred.user.uid;
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-in-use') {
          try {
            const cred = await signInWithEmailAndPassword(tempAuth, cleanEmail, password);
            authUid = cred.user.uid;
          } catch (signErr) {
            authUid = `auth_${Date.now()}`;
          }
        } else {
          throw authErr;
        }
      }
    } finally {
      if (tempApp) {
        try { await deleteApp(tempApp); } catch (e) {}
      }
    }

    // 3. Category & Doc ID
    const categoryMap = {
      counselor: 'counselors',
      faculty: 'faculty',
      head: 'head',
      admin: 'admin'
    };
    const category = categoryMap[cleanRole] || 'faculty';
    const emailPrefix = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
    const userDocId = `usr_${cleanRole}_${emailPrefix}`;

    const completeProfile = {
      uid: userDocId,
      authUid: authUid || `auth_${Date.now()}`,
      fullName: fullName.trim(),
      email: cleanEmail,
      role: cleanRole,
      roleType: cleanRole,
      studentOrEmpId: cleanId,
      department: (department || 'Guidance and Counseling Center').trim(),
      program: (department || 'Guidance and Counseling Center').trim(),
      gender: gender || 'Prefer not to say',
      contactNumber: contactNumber || '',
      isVerified: true,
      emailVerified: true,
      createdAt: new Date().toISOString()
    };

    // 4. Save to Firestore users/{category} document
    await setDoc(
      doc(clientDb, 'users', category),
      {
        [userDocId]: completeProfile,
        roleCategory: category,
        lastUpdated: serverTimestamp()
      },
      { merge: true }
    );

    // Log to institutional audit trail
    try {
      await addDoc(collection(clientDb, 'audit_logs'), {
        timestamp: new Date().toISOString(),
        actorId: 'admin_provisioner',
        actorName: 'System Administrator',
        actorRole: 'admin',
        action: 'STAFF_PROVISIONED',
        summary: `Admin provisioned verified ${cleanRole.toUpperCase()} account for ${fullName.trim()} (${cleanEmail})`
      });
    } catch (e) {}

    console.log(` [STAFF PROVISIONED] Role: ${cleanRole} | Name: ${fullName} | Email: ${cleanEmail}`);
    return res.status(200).json({
      success: true,
      message: `Successfully provisioned ${cleanRole} account for ${fullName}.`,
      user: completeProfile
    });
  } catch (err) {
    console.error(' [ADMIN CREATE STAFF ERROR]:', err);
    return res.status(500).json({ error: err.message || 'Failed to create staff account.' });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(` GuideHub running at http://127.0.0.1:${PORT} (http://localhost:${PORT})`);
});
