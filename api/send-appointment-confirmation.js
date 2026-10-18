import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { findAccountByEmail, findAccountById, findAccountByFullName, escapeHtml } from '../server/db.js';

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

function format12hTime(timeSlot = '') {
  if (!timeSlot) return 'Scheduled Time';
  const slotStr = String(timeSlot).trim();
  if (slotStr.includes('-')) {
    const [p1, p2] = slotStr.split('-');
    return `${formatSingleTime(p1)} - ${formatSingleTime(p2)}`;
  }
  return formatSingleTime(slotStr);
}

function formatSingleTime(t = '') {
  const trimmed = String(t).trim();
  if (/am|pm/i.test(trimmed)) return trimmed;
  if (!trimmed.includes(':')) return trimmed;
  const [hStr, mStr] = trimmed.split(':');
  let h = parseInt(hStr, 10);
  if (isNaN(h)) return trimmed;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${(mStr || '00').slice(0, 2)} ${ampm}`;
}

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

    const logoPath = path.join(process.cwd(), 'assets', 'nu-logo.png');
    const hasLogo = fs.existsSync(logoPath);

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
                  <tr>
                    <td style="background-color: #00205B; padding: 26px 24px; text-align: center;">
                      <table border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                        <tr>
                          ${hasLogo ? `<td style="vertical-align: middle; padding-right: 12px;"><img src="cid:nulogo" alt="NU Logo" width="46" height="46" style="display: block; width: 46px; height: 46px; object-fit: contain;" /></td>` : ''}
                          <td style="vertical-align: middle; text-align: left;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 17px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">National University Fairview</h1>
                            <p style="margin: 3px 0 0 0; color: #F5B800; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Guidance and Counseling Center • GuideHub</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="background-color: #ecfdf5; border-bottom: 1px solid #a7f3d0; padding: 14px 24px; text-align: center;">
                      <span style="display: inline-block; color: #065f46; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">
                        ✓ Consultation Request Confirmed &amp; Scheduled
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 28px 24px 20px 24px;">
                      <p style="margin: 0 0 14px 0; color: #334155; font-size: 15px; line-height: 1.5;">Hello <strong>${safeStudentName}</strong>,</p>
                      <p style="margin: 0 0 20px 0; color: #475569; font-size: 13px; line-height: 1.6;">
                        Your counseling appointment request has been reviewed and officially confirmed by your guidance counselor. We are looking forward to providing you with a safe, comforting, and confidential space to talk.
                      </p>
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
      ...(hasLogo ? { attachments: [{ filename: 'nu-logo.png', path: logoPath, cid: 'nulogo' }] } : {}),
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
  } catch (error) {
    console.error(' [LIVE CONFIRMATION ERROR]:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to dispatch appointment confirmation email.'
    });
  }
}
