import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { initializeApp as initClientApp, getApps as getClientApps } from 'firebase/app';
import {
  getFirestore as getClientFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  collectionGroup
} from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config();

export function escapeHtml(str = '') {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 1. Firebase Admin SDK Initialization (Optional / Guarded via dynamic import for serverless compatibility)
let isFirebaseAdminInitialized = false;
let adminAuth = null;
let adminDb = null;

const primaryKeyPath = path.join(ROOT_DIR, 'scripts', 'serviceAccountKey.json');
const fallbackKeyPath = path.join(ROOT_DIR, 'serviceAccountKey.json');
const serviceAccountPath = fs.existsSync(primaryKeyPath) ? primaryKeyPath : fallbackKeyPath;

if (fs.existsSync(serviceAccountPath)) {
  try {
    const { initializeApp: initAdminApp, cert, getApps: getAdminApps } = await import('firebase-admin/app');
    const { getAuth: getAdminAuth } = await import('firebase-admin/auth');
    const { getFirestore: getAdminFirestore } = await import('firebase-admin/firestore');

    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    if (getAdminApps().length === 0) {
      initAdminApp({
        credential: cert(serviceAccount)
      });
    }
    isFirebaseAdminInitialized = true;
    adminAuth = getAdminAuth();
    adminDb = getAdminFirestore();
    console.log(`[INFO] Firebase Admin SDK initialized successfully from ${path.basename(serviceAccountPath)}.`);
  } catch (err) {
    console.warn('[WARNING] Firebase Admin SDK init skipped / invalid credential:', err.message);
  }
} else {
  // Silent fallback: In serverless environments (e.g. Vercel), client SDK handles all Firestore queries
}

export { adminAuth, adminDb, isFirebaseAdminInitialized };
export function getAuth() { return adminAuth; }
export function getFirestore() { return adminDb; }

// 2. Firebase Client SDK (Resilient queries across all environments)
const clientFirebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyAqPNF4SRiyF8nZbFPLraUHldNoxvHQiQk',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'guideone-a6ee4.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'guideone-a6ee4',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'guideone-a6ee4.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '239656505483',
  appId: process.env.FIREBASE_APP_ID || '1:239656505483:web:287895cbc2757f512fc48e'
};

const clientApp = getClientApps().length === 0 ? initClientApp(clientFirebaseConfig) : getClientApps()[0];
export const clientDb = getClientFirestore(clientApp);

const ROLE_CATEGORIES = ['students', 'counselors', 'faculty', 'head', 'admin'];

// 3. Reliable Account Uniqueness Lookups Across Clean Hierarchy & Root Structures
export async function findAccountByEmail(rawEmail) {
  const cleanEmail = (rawEmail || '').trim().toLowerCase();
  if (!cleanEmail) return null;

  // 1. Check role document maps: users/{category} contains docId fields
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

  // 2. If not in Firestore, clean up any orphaned Firebase Auth record so re-registration succeeds cleanly
  if (isFirebaseAdminInitialized && adminAuth) {
    try {
      const adminUser = await adminAuth
        .getUserByEmail(cleanEmail)
        .catch(() => null);
      if (adminUser) {
        await adminAuth
          .deleteUser(adminUser.uid)
          .catch(() => {});
        console.log(`[AUTH SYNC] Removed orphaned Firebase Auth record for ${cleanEmail} (not present in Firestore).`);
      }
    } catch (adminErr) {
      // Ignored
    }
  }

  return null;
}

export async function findAccountById(idNumber) {
  const cleanId = (idNumber || '').trim();
  if (!cleanId) return null;

  // Check role document maps: users/{category} contains docId fields
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

  if (partsA.length < 2 || partsB.length < 2) {
    return normA === normB;
  }

  const firstA = partsA[0];
  const firstB = partsB[0];
  const lastA = partsA[partsA.length - 1];
  const lastB = partsB[partsB.length - 1];

  if (firstA === firstB && lastA === lastB) {
    return true;
  }

  const compoundPrefixes = ['de', 'del', 'dela', 'delos', 'san', 'santa', 'sta'];
  if (partsA.length >= 3 && partsB.length >= 3) {
    const isCompA = compoundPrefixes.includes(partsA[partsA.length - 2]);
    const isCompB = compoundPrefixes.includes(partsB[partsB.length - 2]);
    if (isCompA && isCompB) {
      const compA = `${partsA[partsA.length - 2]} ${partsA[partsA.length - 1]}`;
      const compB = `${partsB[partsB.length - 2]} ${partsB[partsB.length - 1]}`;
      if (firstA === firstB && compA === compB) return true;
    }
  }

  return false;
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
    let snap = await getDoc(otpRef);
    if (!snap.exists()) {
      const prefix = cleanEmail.split('@')[0];
      const altDomain = cleanEmail.endsWith('@students.nu-fairview.edu.ph')
        ? '@nu-fairview.edu.ph'
        : '@students.nu-fairview.edu.ph';
      const altRef = doc(clientDb, 'otpVerifications', `${prefix}${altDomain}`);
      const altSnap = await getDoc(altRef);
      if (altSnap.exists()) {
        snap = altSnap;
      } else {
        return {
          valid: false,
          status: 400,
          error: 'No active verification code found for this email. Please request a new OTP code.'
        };
      }
    }
    const data = snap.data();
    if ((data.attempts || 0) >= 3) {
      await deleteDoc(snap.ref).catch(() => {});
      return { valid: false, status: 429, error: 'Maximum failed attempts exceeded (3). Please request a new recovery code.' };
    }
    if (Date.now() > data.expiresAt) {
      await deleteDoc(snap.ref).catch(() => {});
      return { valid: false, status: 400, error: 'Verification code has expired (5-minute limit). Please request a new code.' };
    }
    if (String(data.code) !== cleanCode) {
      const nextAttempts = (data.attempts || 0) + 1;
      await updateDoc(snap.ref, { attempts: nextAttempts }).catch(() => {});
      return { valid: false, status: 400, error: `Incorrect verification code. ${Math.max(0, 3 - nextAttempts)} attempt(s) remaining.` };
    }
    await deleteDoc(snap.ref).catch(() => {});
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

