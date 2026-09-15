import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount)
    });
    console.log('[INFO] Firebase Admin SDK initialized successfully.');
  }
} else {
  console.warn('[WARNING] serviceAccountKey.json not found in root.');
}

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

  const logoPath = path.join(__dirname, 'assets', 'nu-logo.png');

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
 <table border="0" cellspacing="0" cellpadding="0" align="center">
 <tr>
 <td align="center" style="padding-bottom: 12px;">
 <img src="cid:nulogo" alt="National University Fairview" width="68" height="82" style="display: block; border: 0; width: 68px; height: auto;" />
 </td>
 </tr>
 </table>
 <h1 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">National University Fairview</h1>
 <p style="margin: 4px 0 0 0; color: #F5B800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;">Guidance and Counseling Center • GuideHub</p>
 </td>
 </tr>
 <tr>
 <td style="padding: 32px 28px 24px 28px;">
 <h2 style="margin: 0 0 12px 0; color: #0f172a; font-size: 18px; font-weight: 700;">Account Verification Code</h2>
 <p style="margin: 0 0 16px 0; color: #334155; font-size: 14px; line-height: 1.6;">Hello <strong>${recipientName}</strong>,</p>
 <p style="margin: 0 0 24px 0; color: #475569; font-size: 13px; line-height: 1.6;">
 Thank you for registering with GuideHub. Please enter the following 6-digit One-Time Password (OTP) on the verification screen to activate your institutional portal:
 </p>
 <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 2px dashed #00205B; border-radius: 12px; margin-bottom: 24px;">
 <tr>
 <td style="padding: 20px; text-align: center;">
 <span style="display: block; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;">Your 6-Digit One-Time Password</span>
 <span style="font-family: 'Courier New', Courier, monospace, sans-serif; font-size: 36px; font-weight: 900; color: #00205B; letter-spacing: 10px; display: inline-block;">${otp}</span>
 </td>
 </tr>
 </table>
 <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
 <tr>
 <td style="color: #64748b; font-size: 12px; line-height: 1.5;">
 ⏱ This verification code is valid for <strong>5 minutes</strong>.<br />
 For your account protection, never share this code or your password with anyone.
 </td>
 </tr>
 </table>
 <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
 <tr>
 <td style="padding: 12px 14px; font-size: 11px; color: #92400e; line-height: 1.5;">
 <strong>Delivery Tip:</strong> If counseling notices appear in your <strong>Junk / Spam folder</strong>, please click <em>"Report as Not Junk"</em> to ensure direct delivery to your primary inbox.
 </td>
 </tr>
 </table>
 </td>
 </tr>
 <tr>
 <td style="background-color: #f8fafc; padding: 20px 28px; text-align: center; border-top: 1px solid #f1f5f9;">
 <p style="margin: 0; color: #64748b; font-size: 11px; font-weight: 600;">National University Fairview • Guidance and Counseling Center</p>
 <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 10px; line-height: 1.4;">
 In compliance with RA 9258 (Guidance and Counseling Act of 2004) & RA 10173 (Data Privacy Act of 2012)
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
    attachments: [
      {
        filename: 'nu-logo.png',
        path: logoPath,
        cid: 'nulogo'
      }
    ],
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
      Importance: 'high'
    }
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error(' Live dispatch error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin-alert', async (req, res) => {
  const { eventType, details } = req.body;

  if (!eventType || !details) {
    return res.status(400).json({ error: 'Missing alert payload details.' });
  }

  const isBlocked = eventType === 'REGISTRATION_BLOCKED';
  const subjectTag = isBlocked
    ? ' [SECURITY ALERT] Blocked Registration Attempt'
    : ' [NEW REGISTRATION] Verified User Account';
  const headerBg = isBlocked ? '#DC2626' : '#00205B';
  const accentBorder = isBlocked ? '#991B1B' : '#F5B800';

  const mailOptions = {
    from: `"GuideHub Security Monitor" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: `${subjectTag} - ${details.email || 'Unknown User'}`,
    html: `
 <!DOCTYPE html>
 <html>
 <head><meta charset="utf-8"></head>
 <body style="margin: 0; padding: 24px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
 <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; margin: auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
 <tr>
 <td style="background-color: ${headerBg}; padding: 20px 24px; border-bottom: 4px solid ${accentBorder}; text-align: left;">
 <h2 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 700;">GuideHub Security & Audit Notification</h2>
 <p style="color: #f8fafc; font-size: 12px; margin: 4px 0 0 0; opacity: 0.9;">Event Type: ${eventType}</p>
 </td>
 </tr>
 <tr>
 <td style="padding: 24px;">
 <p style="color: #0f172a; font-size: 14px; margin: 0 0 16px 0; font-weight: 600;">
 ${isBlocked ? 'A registration attempt failed institutional restriction checks:' : 'A new institutional user account has been successfully verified and created:'}
 </p>
 
 <table width="100%" cellpadding="8" cellspacing="0" style="border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; color: #334155;">
 <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
 <td style="font-weight: 600; width: 35%;">User / Attempt Name:</td>
 <td>${details.fullName || 'N/A'}</td>
 </tr>
 <tr style="border-bottom: 1px solid #e2e8f0;">
 <td style="font-weight: 600;">Submitted Email:</td>
 <td><code style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${details.email || 'N/A'}</code></td>
 </tr>
 <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
 <td style="font-weight: 600;">Target Role:</td>
 <td>${details.role || 'N/A'}</td>
 </tr>
 <tr style="border-bottom: 1px solid #e2e8f0;">
 <td style="font-weight: 600;">Student / Employee ID:</td>
 <td>${details.studentOrEmpId || 'N/A'}</td>
 </tr>
 <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
 <td style="font-weight: 600;">Program / Department:</td>
 <td>${details.departmentOrProgram || 'N/A'}</td>
 </tr>
 ${
   isBlocked
     ? `
 <tr style="background-color: #FEF2F2; color: #991B1B;">
 <td style="font-weight: 700;">Rejection Reason:</td>
 <td style="font-weight: 600;">${details.reason || 'Restricted domain or invalid credentials.'}</td>
 </tr>`
     : ''
 }
 </table>

 <p style="color: #64748b; font-size: 11px; margin: 20px 0 0 0; text-align: center;">
 Generated automatically by NU Fairview GuideHub • ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })}
 </p>
 </td>
 </tr>
 </table>
 </body>
 </html>
 `
  };

  try {
    await transporter.sendMail(mailOptions);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Alert dispatch error:', error.message);
    return res.status(500).json({ error: 'Failed to dispatch admin notification.' });
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(` GuideHub running at http://localhost:${PORT}`);
});
