import { clientDb, escapeHtml } from '../db.js';
import { doc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

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

  const { fullName, email, studentOrEmpId, role, department, gender, password, contactNumber } = req.body || {};

  if (!fullName || !email || !studentOrEmpId || !role) {
    return res.status(400).json({ error: 'Full name, institutional email, employee ID, and role are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanRole = role.trim().toLowerCase();
  const cleanId = studentOrEmpId.trim();

  try {
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
      authUid: `auth_${Date.now()}`,
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

    await setDoc(
      doc(clientDb, 'users', category),
      {
        [userDocId]: completeProfile,
        roleCategory: category,
        lastUpdated: serverTimestamp()
      },
      { merge: true }
    );

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

    return res.status(200).json({
      success: true,
      message: `Successfully provisioned ${cleanRole} account for ${fullName}.`,
      user: completeProfile
    });
  } catch (err) {
    console.error('[ADMIN CREATE STAFF ERROR]:', err);
    return res.status(500).json({ error: err.message || 'Failed to create staff account.' });
  }
}
