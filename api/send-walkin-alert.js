// api/send-walkin-alert.js
// Vercel Serverless Function to dispatch High-Priority Email Alerts to Available Counselors for Walk-In Queue

import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { clientDb, escapeHtml } from './db.js';
import { doc, getDoc } from 'firebase/firestore';

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

  try {
    const {
      ticketNumber,
      studentName,
      studentNumber,
      program,
      concernCategory,
      date,
      timeSlot,
      counselorEmails = []
    } = req.body || {};

    if (!ticketNumber || !studentName) {
      return res.status(400).json({ error: 'Missing required walk-in ticket details.' });
    }

    let targetEmails = Array.isArray(counselorEmails)
      ? counselorEmails.map(e => String(e || '').trim().toLowerCase()).filter(Boolean)
      : String(counselorEmails || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

    // If no specific counselor emails passed, fallback to all registered active counselors
    if (targetEmails.length === 0) {
      try {
        const snap = await getDoc(doc(clientDb, 'users', 'counselors'));
        if (snap.exists()) {
          const data = snap.data();
          for (const val of Object.values(data)) {
            if (val && typeof val === 'object' && val.email) {
              const em = val.email.trim().toLowerCase();
              if (em && !targetEmails.includes(em)) {
                targetEmails.push(em);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[WALKIN ALERT] Fallback counselor fetch warning:', err.message);
      }
    }

    if (targetEmails.length === 0) {
      targetEmails = ['mark.d@nu-fairview.edu.ph', 'robert.p@nu-fairview.edu.ph'];
    }

    const safeTicket = escapeHtml(ticketNumber);
    const safeStudent = escapeHtml(studentName);
    const safeNumber = escapeHtml(studentNumber || 'N/A');
    const safeProgram = escapeHtml(program || 'Student');
    const safeCategory = escapeHtml(concernCategory || 'Walk-In Consultation');
    const safeDate = escapeHtml(date || new Date().toISOString().split('T')[0]);
    const safeSlot = escapeHtml(timeSlot || 'Immediate Consultation');

    const logoPath = path.join(process.cwd(), 'assets', 'nu-logo.png');
    const hasLogo = fs.existsSync(logoPath);

    const mailOptions = {
      from: `"GuideHub Live Queue Alert" <${process.env.GMAIL_USER}>`,
      to: targetEmails.join(', '),
      subject: `🚨 [HIGH PRIORITY] Walk-In Queue Alert: Ticket #${safeTicket} - ${safeStudent} (${safeProgram})`,
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high',
        'Priority': 'urgent'
      },
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Walk-In Queue Notification</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 24px 0;">
            <tr>
              <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0;">
                  <!-- Header -->
                  <tr>
                    <td style="background-color: #00205B; padding: 20px 24px; text-align: left; border-bottom: 4px solid #F5B800;">
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          ${hasLogo ? `<td width="48" style="vertical-align: middle;"><img src="cid:nulogo" alt="NU Logo" width="40" height="40" style="display: block; border-radius: 4px;"></td>` : ''}
                          <td style="vertical-align: middle; padding-left: ${hasLogo ? '12px' : '0'};">
                            <h1 style="color: #ffffff; font-size: 16px; font-weight: 700; margin: 0; letter-spacing: 0.3px;">NU FAIRVIEW • GUIDEHUB</h1>
                            <p style="color: #F5B800; font-size: 11px; margin: 2px 0 0 0; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Guidance &amp; Counseling Center • Urgent Queue Monitor</p>
                          </td>
                          <td align="right" style="vertical-align: middle;">
                            <span style="background-color: #dc2626; color: #ffffff; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 4px 10px; rounded: 9999px; border-radius: 9999px; letter-spacing: 0.5px; display: inline-block;">
                              HIGH PRIORITY
                            </span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Alert Banner -->
                  <tr>
                    <td style="background-color: #fef2f2; border-bottom: 1px solid #fecaca; padding: 14px 24px;">
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="vertical-align: middle;">
                            <strong style="color: #991b1b; font-size: 13px; display: block;">🚨 New Walk-In Student Waiting in Queue</strong>
                            <p style="color: #b91c1c; font-size: 11px; margin: 2px 0 0 0;">
                              A student has just arrived and registered for immediate consultation. This notification is sent to counselors available during this duty period.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Ticket Highlight -->
                  <tr>
                    <td style="padding: 24px; text-align: center; background-color: #fafafa; border-bottom: 1px solid #f1f5f9;">
                      <span style="color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 600; letter-spacing: 1px;">Queue Ticket Number</span>
                      <div style="font-family: monospace; font-size: 32px; font-weight: 800; color: #00205B; letter-spacing: 2px; margin: 4px 0;">
                        ${safeTicket}
                      </div>
                      <span style="display: inline-block; background-color: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-size: 11px; font-weight: 600; padding: 3px 12px; border-radius: 9999px;">
                        Status: Waiting for Counselor Call
                      </span>
                    </td>
                  </tr>

                  <!-- Student Details Table -->
                  <tr>
                    <td style="padding: 24px;">
                      <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e2e8f0; border-radius: 8px; border-collapse: separate; border-spacing: 0; margin-bottom: 20px;">
                        <tr style="background-color: #f8fafc;">
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600; width: 35%;">Student Name:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 12px; font-weight: 700;">${safeStudent}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600;">Student ID:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 12px; font-family: monospace;">${safeNumber}</td>
                        </tr>
                        <tr style="background-color: #f8fafc;">
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600;">Program:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 12px;">${safeProgram}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600;">Reason / Concern:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #00205B; font-size: 12px; font-weight: 600;">${safeCategory}</td>
                        </tr>
                        <tr style="background-color: #f8fafc;">
                          <td style="padding: 10px 16px; color: #64748b; font-size: 12px; font-weight: 600;">Arrival Time:</td>
                          <td style="padding: 10px 16px; color: #334155; font-size: 12px;">${safeDate} • ${safeSlot}</td>
                        </tr>
                      </table>

                      <!-- Action Instructions -->
                      <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
                        <strong style="color: #1e40af; font-size: 12px; display: block; margin-bottom: 4px;">Counselor Duty Instructions:</strong>
                        <p style="margin: 0; color: #1e3a8a; font-size: 11px; line-height: 1.5;">
                          Please log in to your Counselor Care Workspace and navigate to the <strong>Live Walk-In Queue</strong> tab. Click <strong>"Call"</strong> to summon the student. Once you call the student, the ticket will be locked in to your account until consultation completion.
                        </p>
                      </div>

                      <!-- CTA Button -->
                      <div style="text-align: center; margin-bottom: 10px;">
                        <a href="https://nufvguidehub.vercel.app/portals/counselor.html" style="background-color: #00205B; color: #ffffff; font-size: 13px; font-weight: 700; text-decoration: none; padding: 12px 28px; border-radius: 8px; display: inline-block; border-bottom: 3px solid #F5B800; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                          Open Counselor Workspace &amp; Call Student &rarr;
                        </a>
                      </div>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f8fafc; padding: 18px 24px; text-align: center; border-top: 1px solid #f1f5f9;">
                      <p style="margin: 0 0 4px 0; color: #64748b; font-size: 11px;">
                        National University Fairview • Guidance &amp; Counseling Center
                      </p>
                      <p style="margin: 0; color: #94a3b8; font-size: 10px;">
                        Confidential notification sent pursuant to RA 9258 and RA 10173.
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
      ...(hasLogo ? { attachments: [{ filename: 'nu-logo.png', path: logoPath, cid: 'nulogo' }] } : {})
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[WALKIN ALERT DISPATCHED] Recipients: ${targetEmails.join(', ')} | MsgID: ${info.messageId}`);
    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      recipients: targetEmails
    });
  } catch (error) {
    console.error('[WALKIN ALERT ERROR]:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to dispatch walk-in queue email alert.'
    });
  }
}
