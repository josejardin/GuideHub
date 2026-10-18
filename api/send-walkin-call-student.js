// api/send-walkin-call-student.js
// Vercel Serverless Function to dispatch High-Priority Email Alert to Student when Counselor calls their Walk-In Ticket

import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { findAccountByEmail, findAccountById, findAccountByFullName, escapeHtml } from './db.js';

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
      studentEmail,
      studentId,
      counselorName,
      concernCategory,
      location = 'Guidance & Counseling Center (2nd Floor, Main Building)'
    } = req.body || {};

    if (!ticketNumber || !studentName) {
      return res.status(400).json({ error: 'Missing required walk-in ticket details.' });
    }

    let targetEmail = (studentEmail || '').trim().toLowerCase();

    // Auto-resolve student email by studentNumber, studentId, or studentName if omitted
    if (!targetEmail) {
      const idsToTry = [studentNumber, studentId].filter(Boolean);
      for (const testId of idsToTry) {
        if (targetEmail) break;
        try {
          const acct = await findAccountById(testId);
          if (acct && acct.email) {
            targetEmail = acct.email.trim().toLowerCase();
          }
        } catch (err) {
          console.warn('[WALKIN CALL] ID lookup warning:', err.message);
        }
      }
    }

    if (!targetEmail && studentName) {
      try {
        const acct = await findAccountByFullName(studentName);
        if (acct && acct.email) {
          targetEmail = acct.email.trim().toLowerCase();
        }
      } catch (err) {
        console.warn('[WALKIN CALL] Name lookup warning:', err.message);
      }
    }

    if (!targetEmail) {
      console.warn(`[WALKIN CALL] No registered institutional email found for: "${studentName}" (${studentNumber})`);
      return res.status(400).json({
        success: false,
        error: 'Unable to resolve student institutional email address.'
      });
    }

    const safeTicket = escapeHtml(ticketNumber);
    const safeStudent = escapeHtml(studentName);
    const safeNumber = escapeHtml(studentNumber || 'N/A');
    const safeCounselor = escapeHtml(counselorName || 'Assigned Guidance Counselor');
    const safeLocation = escapeHtml(location);
    const safeCategory = escapeHtml(concernCategory || 'Walk-In Consultation');

    const logoPath = path.join(process.cwd(), 'assets', 'nu-logo.png');
    const hasLogo = fs.existsSync(logoPath);

    const mailOptions = {
      from: `"NU Fairview Guidance Center" <${process.env.GMAIL_USER}>`,
      to: targetEmail,
      replyTo: process.env.GMAIL_USER,
      subject: `🚨 [NOW CALLING] Your Turn at Guidance Office: Ticket #${safeTicket} - ${safeCounselor}`,
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high',
        'Priority': 'urgent'
      },
      text: `NOW CALLING: Ticket #${ticketNumber}\n\nHello ${studentName},\n\nCounselor ${counselorName} is now ready to see you at the Guidance & Counseling Center (${location}).\n\nPlease proceed immediately to the Guidance Office.\n\n- National University Fairview Guidance and Counseling Center`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Now Calling: Ticket #${safeTicket}</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 24px 0;">
            <tr>
              <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 14px rgba(0, 32, 91, 0.1); border: 1px solid #e2e8f0;">
                  <!-- Header -->
                  <tr>
                    <td style="background-color: #00205B; padding: 22px 24px; text-align: left; border-bottom: 4px solid #F5B800;">
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          ${hasLogo ? `<td width="48" style="vertical-align: middle;"><img src="cid:nulogo" alt="NU Logo" width="40" height="40" style="display: block; border-radius: 4px;"></td>` : ''}
                          <td style="vertical-align: middle; padding-left: ${hasLogo ? '12px' : '0'};">
                            <h1 style="color: #ffffff; font-size: 16px; font-weight: 800; margin: 0; letter-spacing: 0.3px;">NU FAIRVIEW • GUIDEHUB</h1>
                            <p style="color: #F5B800; font-size: 11px; margin: 2px 0 0 0; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Guidance &amp; Counseling Center • Walk-In Triage</p>
                          </td>
                          <td align="right" style="vertical-align: middle;">
                            <span style="background-color: #dc2626; color: #ffffff; font-size: 10px; font-weight: 800; text-transform: uppercase; padding: 5px 12px; border-radius: 9999px; letter-spacing: 0.5px; display: inline-block;">
                              URGENT CALL
                            </span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Now Calling Banner -->
                  <tr>
                    <td style="background-color: #ecfdf5; border-bottom: 2px solid #a7f3d0; padding: 16px 24px; text-align: center;">
                      <span style="color: #065f46; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; display: block;">
                        🔔 NOW CALLING • YOUR TURN AT GUIDANCE OFFICE
                      </span>
                      <p style="color: #047857; font-size: 12px; margin: 4px 0 0 0; font-weight: 500;">
                        Counselor <strong>${safeCounselor}</strong> is ready for your consultation.
                      </p>
                    </td>
                  </tr>

                  <!-- Ticket Number Feature -->
                  <tr>
                    <td style="padding: 24px; text-align: center; background-color: #fafafa; border-bottom: 1px solid #f1f5f9;">
                      <span style="color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 1px;">Your Queue Ticket</span>
                      <div style="font-family: monospace; font-size: 38px; font-weight: 800; color: #00205B; letter-spacing: 3px; margin: 6px 0;">
                        ${safeTicket}
                      </div>
                      <span style="display: inline-block; background-color: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; font-size: 12px; font-weight: 700; padding: 4px 14px; border-radius: 9999px;">
                        Assigned to: ${safeCounselor}
                      </span>
                    </td>
                  </tr>

                  <!-- Details Table -->
                  <tr>
                    <td style="padding: 24px;">
                      <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e2e8f0; border-radius: 10px; border-collapse: separate; border-spacing: 0; margin-bottom: 20px; overflow: hidden;">
                        <tr style="background-color: #f8fafc;">
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600; width: 36%;">Student Name:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-size: 12px; font-weight: 700;">${safeStudent}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600;">Student Number:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 12px; font-family: monospace;">${safeNumber}</td>
                        </tr>
                        <tr style="background-color: #f8fafc;">
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 12px; font-weight: 600;">Location / Venue:</td>
                          <td style="padding: 10px 16px; border-bottom: 1px solid #e2e8f0; color: #00205B; font-size: 12px; font-weight: 700;">${safeLocation}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 16px; color: #64748b; font-size: 12px; font-weight: 600;">Concern Category:</td>
                          <td style="padding: 10px 16px; color: #334155; font-size: 12px;">${safeCategory}</td>
                        </tr>
                      </table>

                      <!-- Next Steps Instructions -->
                      <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 0 8px 8px 0; margin-bottom: 22px;">
                        <strong style="color: #1e40af; font-size: 12px; display: block; margin-bottom: 6px;">Next Steps:</strong>
                        <ul style="margin: 0; padding-left: 18px; color: #1e3a8a; font-size: 11px; line-height: 1.6;">
                          <li>Please proceed immediately to the <strong>Guidance &amp; Counseling Center</strong> (2nd Floor, Main Building).</li>
                          <li>Inform the lobby receptionist or knock gently at Counselor <strong>${safeCounselor}'s</strong> consultation room.</li>
                          <li>If you are currently attending a class, Counselor <strong>${safeCounselor}</strong> can issue an official digital <strong>Institutional Call Slip</strong> to excuse your attendance.</li>
                        </ul>
                      </div>

                      <!-- CTA Button -->
                      <div style="text-align: center; margin-bottom: 12px;">
                        <a href="https://nufvguidehub.vercel.app/portals/student.html" style="background-color: #00205B; color: #ffffff; font-size: 13px; font-weight: 700; text-decoration: none; padding: 12px 28px; border-radius: 8px; display: inline-block; border-bottom: 3px solid #F5B800; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                          Open Student Workspace &amp; View Status &rarr;
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
                        In compliance with RA 9258 (Guidance and Counseling Act) &amp; RA 10173 (Data Privacy Act).
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
    console.log(`[WALKIN STUDENT CALL ALERT] Destination: ${targetEmail} | MsgID: ${info.messageId}`);
    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      recipient: targetEmail
    });
  } catch (error) {
    console.error('[WALKIN STUDENT CALL ALERT ERROR]:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to dispatch student call email alert.'
    });
  }
}
