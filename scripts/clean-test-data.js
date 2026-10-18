import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, deleteDoc, doc, setDoc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyAqPNF4SRiyF8nZbFPLraUHldNoxvHQiQk',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'guideone-a6ee4.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'guideone-a6ee4',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'guideone-a6ee4.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '239656505483',
  appId: process.env.FIREBASE_APP_ID || '1:239656505483:web:287895cbc2757f512fc48e'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function cleanTestData() {
  console.log('====================================================');
  console.log(' CLEANING TEST DATA FROM FIRESTORE DATABASE');
  console.log('====================================================');

  await signInWithEmailAndPassword(auth, 'admin.alex@nu-fairview.edu.ph', 'Password123!');
  console.log(' Authenticated as admin.alex@nu-fairview.edu.ph');

  // 1. Clean appointments (Delete temporary test appointments apt_179...)
  const aptsSnap = await getDocs(collection(db, 'appointments'));
  let deletedApts = 0;
  for (const d of aptsSnap.docs) {
    if (d.id.startsWith('apt_179')) {
      await deleteDoc(doc(db, 'appointments', d.id));
      deletedApts++;
    }
  }
  console.log(` Cleared ${deletedApts} test appointments (preserved clean sample appointments).`);

  // 2. Clean referrals (Delete temporary test referrals ref_179...)
  const refSnap = await getDocs(collection(db, 'referrals'));
  let deletedRefs = 0;
  for (const d of refSnap.docs) {
    if (d.id.startsWith('ref_179')) {
      await deleteDoc(doc(db, 'referrals', d.id));
      deletedRefs++;
    }
  }
  console.log(` Cleared ${deletedRefs} test referrals (preserved clean sample referrals).`);

  // 3. Clean cases (Delete temporary test cases)
  const caseSnap = await getDocs(collection(db, 'cases'));
  let deletedCases = 0;
  for (const d of caseSnap.docs) {
    if (d.id.startsWith('case_202') || d.id.startsWith('case_231') || d.id.startsWith('case_angelica')) {
      // Delete any session notes subcollection first
      try {
        const notesSnap = await getDocs(collection(db, 'cases', d.id, 'notes'));
        for (const n of notesSnap.docs) {
          await deleteDoc(doc(db, 'cases', d.id, 'notes', n.id));
        }
      } catch (e) {}
      await deleteDoc(doc(db, 'cases', d.id));
      deletedCases++;
    }
  }
  console.log(` Cleared ${deletedCases} test clinical cases (preserved clean sample cases).`);

  // 4. Clean walk-in queue (Delete temporary test queues queue_179...)
  const queueSnap = await getDocs(collection(db, 'walkin_queue'));
  let deletedQueues = 0;
  for (const d of queueSnap.docs) {
    if (d.id.startsWith('queue_179')) {
      await deleteDoc(doc(db, 'walkin_queue', d.id));
      deletedQueues++;
    }
  }
  console.log(` Cleared ${deletedQueues} test walk-in queue items.`);

  // 5. Clean otpVerifications (Delete old test OTPs)
  const otpSnap = await getDocs(collection(db, 'otpVerifications'));
  let deletedOtps = 0;
  for (const d of otpSnap.docs) {
    await deleteDoc(doc(db, 'otpVerifications', d.id));
    deletedOtps++;
  }
  console.log(` Cleared ${deletedOtps} test OTP verification records.`);

  // 6. Clean audit logs (Delete noisy development debugging logs, keep clean presentation logs)
  const auditSnap = await getDocs(collection(db, 'auditLogs'));
  let deletedLogs = 0;
  for (const d of auditSnap.docs) {
    if (d.id.startsWith('log_179')) {
      await deleteDoc(doc(db, 'auditLogs', d.id));
      deletedLogs++;
    }
  }
  console.log(` Cleared ${deletedLogs} test debug audit logs.`);

  // 7. Clean dummy test accounts from users role documents
  // Specifically remove usr_faculty_gio_l (fasdfasdf@nu-fairview.edu.ph) from users/counselors
  const counselorDocRef = doc(db, 'users', 'counselors');
  const counselorSnap = await getDoc(counselorDocRef);
  if (counselorSnap.exists()) {
    const data = counselorSnap.data() || {};
    if (data['usr_faculty_gio_l'] || data['fasdfasdf@nu-fairview.edu.ph']) {
      await updateDoc(counselorDocRef, {
        usr_faculty_gio_l: deleteField()
      });
      console.log(` Removed dummy test counselor [usr_faculty_gio_l / fasdfasdf@nu-fairview.edu.ph] from users/counselors.`);
    }
  }

  // Also check users/faculty
  const facultyDocRef = doc(db, 'users', 'faculty');
  const facultySnap = await getDoc(facultyDocRef);
  if (facultySnap.exists()) {
    const data = facultySnap.data() || {};
    if (data['usr_faculty_gio_l']) {
      await updateDoc(facultyDocRef, {
        usr_faculty_gio_l: deleteField()
      });
      console.log(` Removed dummy test faculty [usr_faculty_gio_l] from users/faculty.`);
    }
  }

  console.log('\n====================================================');
  console.log(' DATABASE CLEANUP COMPLETE! Clean, professional state ready.');
  console.log('====================================================');
  process.exit(0);
}

cleanTestData().catch(err => {
  console.error('Cleanup error:', err);
  process.exit(1);
});
