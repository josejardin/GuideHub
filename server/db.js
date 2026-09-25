import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { initializeApp as initAdminApp, cert, getApps as getAdminApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp as initClientApp, getApps as getClientApps } from 'firebase/app';
import {
  getFirestore as getClientFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  collectionGroup
} from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config();

// 1. Firebase Admin SDK Initialization (Optional / Guarded)
let isFirebaseAdminInitialized = false;

const primaryKeyPath = path.join(ROOT_DIR, 'scripts', 'serviceAccountKey.json');
const fallbackKeyPath = path.join(ROOT_DIR, 'serviceAccountKey.json');
const serviceAccountPath = fs.existsSync(primaryKeyPath) ? primaryKeyPath : fallbackKeyPath;

if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    if (getAdminApps().length === 0) {
      initAdminApp({
        credential: cert(serviceAccount)
      });
      isFirebaseAdminInitialized = true;
      console.log(`[INFO] Firebase Admin SDK initialized successfully from ${path.basename(serviceAccountPath)}.`);
    } else {
      isFirebaseAdminInitialized = true;
    }
  } catch (err) {
    console.warn('[WARNING] Firebase Admin SDK init skipped / invalid credential:', err.message);
  }
} else {
  console.warn('[WARNING] serviceAccountKey.json not found in scripts/ or root. Admin features will be unavailable.');
}

export const adminAuth = isFirebaseAdminInitialized ? getAdminAuth() : null;
export const adminDb = isFirebaseAdminInitialized ? getAdminFirestore() : null;
export { getAdminAuth as getAuth, getAdminFirestore as getFirestore, isFirebaseAdminInitialized };

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

  // 1. Check root users collection (users/{docId})
  try {
    const qRoot = query(collection(clientDb, 'users'), where('email', '==', cleanEmail));
    const snapRoot = await getDocs(qRoot);
    if (!snapRoot.empty) {
      return { id: snapRoot.docs[0].id, path: snapRoot.docs[0].ref.path, ...snapRoot.docs[0].data() };
    }
  } catch (err) {
    console.warn('[WARNING] Root users email query notice:', err.message);
  }

  // 2. Check role subcollections (users/{roleCategory}/users)
  try {
    for (const cat of ROLE_CATEGORIES) {
      const qCat = query(collection(clientDb, 'users', cat, 'users'), where('email', '==', cleanEmail));
      const snapCat = await getDocs(qCat);
      if (!snapCat.empty) {
        return { id: snapCat.docs[0].id, path: snapCat.docs[0].ref.path, ...snapCat.docs[0].data() };
      }
    }
  } catch (err) {
    console.warn('[WARNING] Subcollection users email query notice:', err.message);
  }

  // 3. Check role collections at root ({roleCategory}/{docId})
  try {
    for (const cat of ROLE_CATEGORIES) {
      const qCat = query(collection(clientDb, cat), where('email', '==', cleanEmail));
      const snapCat = await getDocs(qCat);
      if (!snapCat.empty) {
        return { id: snapCat.docs[0].id, path: snapCat.docs[0].ref.path, ...snapCat.docs[0].data() };
      }
    }
  } catch (err) {
    console.warn('[WARNING] Root category email query notice:', err.message);
  }

  // 4. Check role document maps: users/{category} contains docId fields
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

  // 5. Safely check Admin Auth if available
  if (isFirebaseAdminInitialized) {
    try {
      const adminUser = await getAdminAuth()
        .getUserByEmail(cleanEmail)
        .catch(err => {
          if (err.code === 'auth/user-not-found') return null;
          return null;
        });
      if (adminUser) {
        return { id: adminUser.uid, email: adminUser.email, authOnly: true };
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

  // 1. Check root users collection
  try {
    const qRoot = query(collection(clientDb, 'users'), where('studentOrEmpId', '==', cleanId));
    const snapRoot = await getDocs(qRoot);
    if (!snapRoot.empty) {
      return { id: snapRoot.docs[0].id, path: snapRoot.docs[0].ref.path, ...snapRoot.docs[0].data() };
    }
  } catch (err) {
    console.warn('[WARNING] Root users ID query notice:', err.message);
  }

  // 2. Check role subcollections (users/{roleCategory}/users)
  try {
    for (const cat of ROLE_CATEGORIES) {
      const qCat = query(collection(clientDb, 'users', cat, 'users'), where('studentOrEmpId', '==', cleanId));
      const snapCat = await getDocs(qCat);
      if (!snapCat.empty) {
        return { id: snapCat.docs[0].id, path: snapCat.docs[0].ref.path, ...snapCat.docs[0].data() };
      }
    }
  } catch (err) {
    console.warn('[WARNING] Subcollection users ID query notice:', err.message);
  }

  // 3. Check role collections at root ({roleCategory}/{docId})
  try {
    for (const cat of ROLE_CATEGORIES) {
      const qCat = query(collection(clientDb, cat), where('studentOrEmpId', '==', cleanId));
      const snapCat = await getDocs(qCat);
      if (!snapCat.empty) {
        return { id: snapCat.docs[0].id, path: snapCat.docs[0].ref.path, ...snapCat.docs[0].data() };
      }
    }
  } catch (err) {
    console.warn('[WARNING] Root category ID query notice:', err.message);
  }

  // 4. Check role document maps: users/{category} contains docId fields
  try {
    for (const cat of ROLE_CATEGORIES) {
      const catDoc = await getDoc(doc(clientDb, 'users', cat));
      if (catDoc.exists()) {
        const data = catDoc.data();
        for (const [key, val] of Object.entries(data)) {
          if (val && typeof val === 'object' && val.studentOrEmpId === cleanId) {
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
