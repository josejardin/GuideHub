// api/reset-password.js
// Vercel Serverless Function for Secure Firebase Auth Password Reset via Identity Toolkit

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

  const { email, otp, newPassword } = req.body || {};

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ success: false, error: 'Email, OTP, and new password are required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const apiKey = process.env.FIREBASE_API_KEY || 'AIzaSyAqPNF4SRiyF8nZbFPLraUHldNoxvHQiQk';

    // 1. Verify the user exists by looking up account info via Google Identity Toolkit REST API
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

    // 2. Update password directly in Firebase Auth via Identity Toolkit
    const updateRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        localId: localId,
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

    // 3. Log security alert to GCO Gmail
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
    transporter.sendMail(mailOptions).catch(err => console.error('Alert error:', err.message));

    return res.status(200).json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ success: false, error: 'Server error while resetting password.' });
  }
}
