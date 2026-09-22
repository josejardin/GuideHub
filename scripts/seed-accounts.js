import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });
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
const auth = getAuth(app);
const db = getFirestore(app);

const dummyAccounts = [
  {
    email: 'counselor.test@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Ms. Maria Santos, RGC',
    role: 'counselor',
    roleType: 'counselor',
    department: 'Guidance and Counseling Center',
    studentOrEmpId: 'EMP-2024-0101',
    gender: 'Female'
  },
  {
    email: 'faculty.test@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Engr. Benedict Zurbito',
    role: 'faculty',
    roleType: 'faculty',
    department: 'School of Engineering and Technology (SET)',
    studentOrEmpId: 'EMP-2024-0202',
    gender: 'Male'
  },
  {
    email: 'admin.test@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'System Administrator',
    role: 'admin',
    roleType: 'admin',
    department: 'Guidance and Counseling Center',
    studentOrEmpId: 'EMP-2024-0001',
    gender: 'Prefer not to say'
  },
  {
    email: 'head.test@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Dr. Elena Ramos, RGC (Guidance Head)',
    role: 'head',
    roleType: 'head',
    department: 'Guidance and Counseling Center',
    studentOrEmpId: 'EMP-2024-0010',
    gender: 'Female'
  }
];

async function seedAccounts() {
  console.log('====================================================');
  console.log(' Seeding GuideHub Dummy Staff & Admin Accounts...');
  console.log('====================================================');

  for (const account of dummyAccounts) {
    try {
      let uid;
      try {
        const cred = await createUserWithEmailAndPassword(auth, account.email, account.password);
        uid = cred.user.uid;
        console.log(` [AUTH CREATED] ${account.email}`);
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-in-use') {
          const cred = await signInWithEmailAndPassword(auth, account.email, account.password);
          uid = cred.user.uid;
          console.log(`ℹ [AUTH EXISTS] Authenticated as ${account.email}`);
        } else {
          throw authErr;
        }
      }

      await setDoc(
        doc(db, 'users', uid),
        {
          uid: uid,
          email: account.email,
          fullName: account.fullName,
          role: account.role,
          roleType: account.roleType,
          department: account.department,
          studentOrEmpId: account.studentOrEmpId,
          gender: account.gender,
          yearLevel: null,
          academicTrack: null,
          createdAt: serverTimestamp()
        },
        { merge: true }
      );

      console.log(` [FIRESTORE SYNCED] Role: ${account.role.toUpperCase()} -> users/${uid}`);
      await signOut(auth);
    } catch (err) {
      console.error(` Error provisioning ${account.email}:`, err.message);
    }
  }

  console.log('====================================================');
  console.log(' Seeding completed successfully!');
  console.log('====================================================');
  process.exit(0);
}

seedAccounts();
