import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER?.trim(),
    pass: process.env.GMAIL_APP_PASS?.replace(/\s+/g, '')
  }
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, otp, name, role, idNumber, departmentOrProgram, purpose } = req.body || {};

  const isRegistration = purpose !== 'password_reset';

  if (!to || !otp || (isRegistration && (!name || !role || !idNumber))) {
    return res.status(400).json({ error: 'All fields are required. Please complete the registration form.' });
  }

  const cleanTo = (to || '').trim().toLowerCase();
  const recipientName = (name || 'Student').trim();
  const emailPrefix = cleanTo.split('@')[0];

  const isStudent = role === 'student' || role === 'college_student' || role === 'shs_student';
  const expectedDomain = isStudent ? '@students.nu-fairview.edu.ph' : '@nu-fairview.edu.ph';

  // 1. Verify Role Domain Matching
  if (isRegistration && !cleanTo.endsWith(expectedDomain)) {
    return res.status(400).json({
      error: `Domain mismatch. ${isStudent ? 'Students must use @students.nu-fairview.edu.ph' : 'Faculty must use @nu-fairview.edu.ph'}.`
    });
  }

  // 2. Validate ID Format per Role
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

  // 3. Instant Troll / Dummy Account Synchronous Filter
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

  // 4. Prevent Duplicate & Cross-Role Registration
  if (isRegistration) {
    try {
      const apiKey = process.env.FIREBASE_API_KEY || 'AIzaSyAqPNF4SRiyF8nZbFPLraUHldNoxvHQiQk';
      const altDomain = isStudent ? '@nu-fairview.edu.ph' : '@students.nu-fairview.edu.ph';
      const crossEmail = `${emailPrefix}${altDomain}`;

      const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: [cleanTo, crossEmail] })
      });
      const lookupData = await lookupRes.json();
      if (lookupData.users && lookupData.users.length > 0) {
        const foundUser = lookupData.users.find(u => (u.email || '').toLowerCase() === cleanTo);
        if (foundUser) {
          return res.status(409).json({
            error:
              'This institutional email is already registered. If you are unable to access your account, please reset your password or contact the Guidance and Counseling Office (nufairviewgco@gmail.com).'
          });
        }
        const crossFound = lookupData.users.find(u => (u.email || '').toLowerCase() === crossEmail);
        if (crossFound) {
          return res.status(409).json({
            error: `An existing ${isStudent ? 'Faculty' : 'Student'} account already exists with username "${emailPrefix}". Cross-role registration is not permitted.`
          });
        }
      }
    } catch (lookupErr) {
      console.warn('Account pre-check error:', lookupErr.message);
    }

    if (idNumber) {
      try {
        const projectId = 'guideone-a6ee4';
        const cleanId = idNumber.trim();
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
        const fsRes = await fetch(firestoreUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'users' }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'studentOrEmpId' },
                  op: 'EQUAL',
                  value: { stringValue: cleanId }
                }
              },
              limit: 1
            }
          })
        });
        const fsData = await fsRes.json();
        if (Array.isArray(fsData) && fsData.some(item => item.document)) {
          return res.status(409).json({
            error: `Student / Employee ID number (${cleanId}) is already registered to an existing account. Please verify your ID number or contact the Guidance and Counseling Office (nufairviewgco@gmail.com).`
          });
        }
      } catch (fsErr) {
        console.warn('Firestore ID pre-check error:', fsErr.message);
      }
    }
  }

  const logoPath = path.join(process.cwd(), 'assets', 'nu-logo.png');
  const hasLogo = fs.existsSync(logoPath);

  const attachments = [];
  if (hasLogo) {
    attachments.push({
      filename: 'nu-logo.png',
      path: logoPath,
      cid: 'nulogo'
    });
  }

  const mailOptions = {
    from: `"NU Fairview Guidance Center" <${process.env.GMAIL_USER}>`,
    to: to,
    replyTo: process.env.GMAIL_USER,
    subject: `GuideHub Verification Code: ${otp}`,
    text: `Hello ${recipientName},\n\nYour 6-digit NU Fairview GuideHub verification code is: ${otp}\n\nThis code expires in 5 minutes.\n\n- National University Fairview Guidance and Counseling Center`,
    html: `
 <!DOCTYPE html PUBLIC "-
 <html xmlns="http://www.w3.org/1999/xhtml">
 <head>
 <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
 <meta name="viewport" content="width=device-width, initial-scale=1.0" />
 <title>GuideHub Verification Code</title>
 <!--[if mso]>
 <style type="text/css">
 body, table, td { font-family: Arial, Helvetica, sans-serif !important; }
 </style>
 <![endif]-->
 </head>
 <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
 <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 32px 16px;">
 <tr>
 <td align="center">
 <!-- Main Email Card Container -->
 <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0, 32, 91, 0.08);">
 
 <!-- Gold Accent Top Bar -->
 <tr>
 <td height="6" style="background-color: #F5B800; font-size: 0; line-height: 0;">&nbsp;</td>
 </tr>

 <!-- Navy Branded Header with CID Attached Logo -->
 <tr>
 <td style="background-color: #00205B; padding: 28px 24px; text-align: center;">
 ${
   hasLogo
     ? `
 <table border="0" cellspacing="0" cellpadding="0" align="center">
 <tr>
 <td align="center" style="padding-bottom: 12px;">
 <img src="cid:nulogo" alt="National University Fairview" width="68" height="82" style="display: block; border: 0; width: 68px; height: auto;" />
 </td>
 </tr>
 </table>`
     : ''
 }
 <h1 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">National University Fairview</h1>
 <p style="margin: 4px 0 0 0; color: #F5B800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;">Guidance and Counseling Center • GuideHub</p>
 </td>
 </tr>

 <!-- Content Body -->
 <tr>
 <td style="padding: 32px 28px 24px 28px;">
 <h2 style="margin: 0 0 12px 0; color: #0f172a; font-size: 18px; font-weight: 700;">Account Verification Code</h2>
 <p style="margin: 0 0 16px 0; color: #334155; font-size: 14px; line-height: 1.6;">Hello <strong>${recipientName}</strong>,</p>
 <p style="margin: 0 0 24px 0; color: #475569; font-size: 13px; line-height: 1.6;">
 Thank you for registering with GuideHub. Please enter the following 6-digit One-Time Password (OTP) on the verification screen to activate your institutional portal:
 </p>

 <!-- 6-Digit OTP Card -->
 <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 2px dashed #00205B; border-radius: 12px; margin-bottom: 24px;">
 <tr>
 <td style="padding: 20px; text-align: center;">
 <span style="display: block; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;">Your 6-Digit One-Time Password</span>
 <span style="font-family: 'Courier New', Courier, monospace, sans-serif; font-size: 36px; font-weight: 900; color: #00205B; letter-spacing: 10px; display: inline-block;">${otp}</span>
 </td>
 </tr>
 </table>

 <!-- Security Details -->
 <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
 <tr>
 <td style="color: #64748b; font-size: 12px; line-height: 1.5;">
 ⏱ This verification code is valid for <strong>5 minutes</strong>.<br />
 For your account protection, never share this code or your password with anyone.
 </td>
 </tr>
 </table>

 <!-- Outlook / Spam Folder Notice -->
 <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
 <tr>
 <td style="padding: 12px 14px; font-size: 11px; color: #92400e; line-height: 1.5;">
 <strong>Delivery Tip:</strong> If counseling notices appear in your <strong>Junk / Spam folder</strong>, please click <em>"Report as Not Junk"</em> to ensure direct delivery to your primary inbox.
 </td>
 </tr>
 </table>
 </td>
 </tr>

 <!-- Institutional Footer -->
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
    attachments: attachments,
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
}
