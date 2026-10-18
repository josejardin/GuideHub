import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc
} from 'firebase/firestore';

const clientFirebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyAqPNF4SRiyF8nZbFPLraUHldNoxvHQiQk',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'guideone-a6ee4.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'guideone-a6ee4',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'guideone-a6ee4.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '239656505483',
  appId: process.env.FIREBASE_APP_ID || '1:239656505483:web:287895cbc2757f512fc48e'
};

const app = getApps().length === 0 ? initializeApp(clientFirebaseConfig) : getApps()[0];
export const clientDb = getFirestore(app);

export function escapeHtml(str = '') {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ROLE_CATEGORIES = ['students', 'counselors', 'faculty', 'head', 'admin'];

export async function findAccountByEmail(rawEmail) {
  const cleanEmail = (rawEmail || '').trim().toLowerCase();
  if (!cleanEmail) return null;
  try {
    for (const cat of ROLE_CATEGORIES) {
      const catDoc = await getDoc(doc(clientDb, 'users', cat));
      if (catDoc.exists()) {
        const data = catDoc.data();
        for (const [key, val] of Object.entries(data)) {
          if (val && typeof val === 'object' && val.email && val.email.toLowerCase() === cleanEmail) {
            return { id: key, path: `users/${cat}#${key}`, ...val };
          }
        }
      }
    }
  } catch (err) {
    console.warn('[WARNING] Role doc map email notice:', err.message);
  }
  return null;
}

export async function findAccountById(idNumber) {
  const cleanId = (idNumber || '').trim();
  if (!cleanId) return null;
  try {
    for (const cat of ROLE_CATEGORIES) {
      const catDoc = await getDoc(doc(clientDb, 'users', cat));
      if (catDoc.exists()) {
        const data = catDoc.data();
        for (const [key, val] of Object.entries(data)) {
          if (
            val &&
            typeof val === 'object' &&
            (val.studentOrEmpId === cleanId ||
              key === cleanId ||
              val.authUid === cleanId ||
              val.uid === cleanId ||
              val.id === cleanId)
          ) {
            return { id: key, path: `users/${cat}#${key}`, ...val };
          }
        }
      }
    }
  } catch (err) {
    console.warn('[WARNING] Role doc map ID notice:', err.message);
  }
  return null;
}

export function normalizePersonName(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSamePersonName(nameA = '', nameB = '') {
  const normA = normalizePersonName(nameA);
  const normB = normalizePersonName(nameB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const partsA = normA.split(' ').filter(Boolean);
  const partsB = normB.split(' ').filter(Boolean);
  if (partsA.length < 2 || partsB.length < 2) return normA === normB;
  return partsA[0] === partsB[0] && partsA[partsA.length - 1] === partsB[partsB.length - 1];
}

export async function findAccountByFullName(rawFullName) {
  const cleanName = (rawFullName || '').trim();
  if (!cleanName) return null;
  try {
    for (const cat of ROLE_CATEGORIES) {
      const catDoc = await getDoc(doc(clientDb, 'users', cat));
      if (catDoc.exists()) {
        const data = catDoc.data();
        for (const [key, val] of Object.entries(data)) {
          if (val && typeof val === 'object' && val.fullName && isSamePersonName(val.fullName, cleanName)) {
            return { id: key, path: `users/${cat}#${key}`, ...val };
          }
        }
      }
    }
  } catch (err) {
    console.warn('[WARNING] Role doc map FullName notice:', err.message);
  }
  return null;
}

export async function verifyServerOtp(rawEmail, rawOtp) {
  const cleanEmail = (rawEmail || '').trim().toLowerCase();
  const cleanCode = (rawOtp || '').trim();
  if (!cleanEmail || !cleanCode || !/^\d{6}$/.test(cleanCode)) {
    return { valid: false, status: 400, error: 'A valid 6-digit numeric verification code is required.' };
  }
  try {
    const otpRef = doc(clientDb, 'otpVerifications', cleanEmail);
    const snap = await getDoc(otpRef);
    if (!snap.exists()) {
      return {
        valid: false,
        status: 400,
        error: 'No active verification code found for this email. Please request a new OTP code.'
      };
    }
    const data = snap.data();
    if ((data.attempts || 0) >= 3) {
      await deleteDoc(otpRef).catch(() => {});
      return { valid: false, status: 429, error: 'Maximum failed attempts exceeded (3). Please request a new recovery code.' };
    }
    if (Date.now() > data.expiresAt) {
      await deleteDoc(otpRef).catch(() => {});
      return { valid: false, status: 400, error: 'Verification code has expired (5-minute limit). Please request a new code.' };
    }
    if (String(data.code) !== cleanCode) {
      const nextAttempts = (data.attempts || 0) + 1;
      await updateDoc(otpRef, { attempts: nextAttempts }).catch(() => {});
      return { valid: false, status: 400, error: `Incorrect verification code. ${Math.max(0, 3 - nextAttempts)} attempt(s) remaining.` };
    }
    await deleteDoc(otpRef).catch(() => {});
    return { valid: true };
  } catch (err) {
    console.warn('[WARNING] Server OTP verification notice:', err.message);
    return { valid: true };
  }
}

export async function saveServerOtp(rawEmail, rawOtp, purpose = 'registration', recipientName = '') {
  const cleanEmail = (rawEmail || '').trim().toLowerCase();
  const cleanCode = String(rawOtp || '').trim();
  const now = Date.now();
  const expiresAt = now + 5 * 60 * 1000;
  try {
    const otpRef = doc(clientDb, 'otpVerifications', cleanEmail);
    await setDoc(otpRef, {
      code: cleanCode,
      createdAt: now,
      expiresAt: expiresAt,
      attempts: 0,
      purpose: purpose,
      recipientName: recipientName || 'Nationalian'
    });
    console.log(`[SERVER OTP SAVED] Firestore record set for: ${cleanEmail}`);
    return { success: true, email: cleanEmail, expiresAt };
  } catch (err) {
    console.warn('[WARNING] Failed to save server OTP to Firestore:', err.message);
    return { success: false, error: err.message };
  }
}
