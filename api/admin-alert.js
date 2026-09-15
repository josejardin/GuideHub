// api/admin-alert.js
// Vercel Serverless Function for GuideHub Administrative Security & Registration Alerts

import nodemailer from 'nodemailer';
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

  const { eventType, details } = req.body || {};

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
}
