import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc, collectionGroup } from 'firebase/firestore';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config();

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyAqPNF4SRiyF8nZbFPLraUHldNoxvHQiQk',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'guideone-a6ee4.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'guideone-a6ee4',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'guideone-a6ee4.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '239656505483',
  appId: process.env.FIREBASE_APP_ID || '1:239656505483:web:287895cbc2757f512fc48e'
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const collectionsToPurge = [
  'appointments',
  'referrals',
  'cases',
  'walkinQueue',
  'walkin_queue',
  'otpVerifications',
  'auditLogs',
  'students',
  'counselors',
  'faculty',
  'head',
  'admin'
];

const ROLE_CATEGORIES = ['students', 'counselors', 'faculty', 'head', 'admin'];

async function purgeCollection(collectionName) {
  try {
    const colRef = collection(db, collectionName);
    const snapshot = await getDocs(colRef);

    if (snapshot.empty) {
      console.log(`ℹ Collection [${collectionName}] is already empty.`);
      return;
    }

    let deletedCount = 0;
    for (const docSnap of snapshot.docs) {
      if (collectionName === 'cases') {
        try {
          const notesRef = collection(db, `cases/${docSnap.id}/notes`);
          const notesSnap = await getDocs(notesRef);
          for (const noteDoc of notesSnap.docs) {
            await deleteDoc(doc(db, `cases/${docSnap.id}/notes`, noteDoc.id));
          }
        } catch (e) {}
      }

      await deleteDoc(doc(db, collectionName, docSnap.id));
      deletedCount++;
    }

    console.log(` Cleared [${collectionName}]: ${deletedCount} document(s) deleted.`);
  } catch (err) {
    console.warn(` Notice clearing [${collectionName}]:`, err.message);
  }
}

async function purgeUserSubcollections() {
  console.log('\n Purging old intermediate subcollections (accounts, users, etc.)...');
  for (const cat of ROLE_CATEGORIES) {
    // Purge accounts subcollections
    try {
      const snap = await getDocs(collection(db, 'users', cat, 'accounts'));
      for (const d of snap.docs) {
        await deleteDoc(doc(db, 'users', cat, 'accounts', d.id));
      }
      if (snap.size > 0) {
        console.log(` Purged users/${cat}/accounts (${snap.size} docs)`);
      }
    } catch (e) {}

    // Purge users subcollections under role
    try {
      const snap = await getDocs(collection(db, 'users', cat, 'users'));
      for (const d of snap.docs) {
        await deleteDoc(doc(db, 'users', cat, 'users', d.id));
      }
      if (snap.size > 0) {
        console.log(` Purged users/${cat}/users (${snap.size} docs)`);
      }
    } catch (e) {}
  }
}

async function purgeRootUsersCollection() {
  console.log('\n Purging old / messy root [users] documents...');
  try {
    const snap = await getDocs(collection(db, 'users'));
    let count = 0;
    for (const docSnap of snap.docs) {
      await deleteDoc(doc(db, 'users', docSnap.id));
      count++;
    }
    console.log(` Wiped [users] root collection: ${count} document(s) deleted.`);
  } catch (err) {
    console.error(' Error purging root users collection:', err.message);
  }
}

async function runCleanup() {
  console.log('====================================================');
  console.log(' COMPLETE DATABASE PURGE & RESET');
  console.log(' Wiping all test bookings, referrals, logs,');
  console.log(' and redundant / messy [users] documents...');
  console.log('====================================================');

  // 1. Purge all operational collections
  for (const colName of collectionsToPurge) {
    await purgeCollection(colName);
  }

  // 2. Purge role category subcollections
  await purgeUserSubcollections();

  // 3. Purge root users collection
  await purgeRootUsersCollection();

  console.log('\n====================================================');
  console.log(' Database completely wiped! Ready for clean seeding.');
  console.log('====================================================');
  process.exit(0);
}

runCleanup();
