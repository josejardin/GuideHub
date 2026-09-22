import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isFirebaseAdminInitialized = false;

// Search for service account in scripts/ first, then root fallback
const primaryKeyPath = path.join(__dirname, '..', 'scripts', 'serviceAccountKey.json');
const fallbackKeyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
const serviceAccountPath = fs.existsSync(primaryKeyPath) ? primaryKeyPath : fallbackKeyPath;

if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    if (getApps().length === 0) {
      initializeApp({
        credential: cert(serviceAccount)
      });
      isFirebaseAdminInitialized = true;
      console.log(`[INFO] Firebase Admin SDK initialized successfully from ${path.basename(serviceAccountPath)}.`);
    } else {
      isFirebaseAdminInitialized = true;
    }
  } catch (err) {
    console.error('[ERROR] Failed to initialize Firebase Admin SDK:', err.message);
  }
} else {
  console.warn('[WARNING] serviceAccountKey.json not found in scripts/ or root. Admin features will be unavailable.');
}

export const adminAuth = isFirebaseAdminInitialized ? getAuth() : null;
export const adminDb = isFirebaseAdminInitialized ? getFirestore() : null;
export { getAuth, getFirestore, isFirebaseAdminInitialized };
