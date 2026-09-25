import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateUserDocId, getRoleCategory } from '../js/utils/validation.js';

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
const auth = getAuth(app);
const db = getFirestore(app);

// Standardized Clean Demo User Accounts Matching Target Schema
const standardizedAccounts = [
  // 1. Students
  {
    docId: 'usr_student_gio_l',
    email: 'laberintogc@students.nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Gio Daniel Canag Laberinto',
    role: 'student',
    roleType: 'student',
    department: 'College of Computing and Information Technology',
    program: 'BS Computer Engineering',
    yearLevel: '2nd Year',
    studentOrEmpId: '2024-1033694',
    gender: 'Male',
    contactNumber: '0917-111-2222',
    isVerified: true
  },
  {
    docId: 'usr_student_joshua_g',
    email: 'joshua.garcia@students.nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Joshua Garcia',
    role: 'student',
    roleType: 'student',
    department: 'College of Arts and Sciences',
    program: 'BS Psychology',
    yearLevel: '3rd Year',
    studentOrEmpId: '2023-10442',
    gender: 'Male',
    contactNumber: '0918-222-3333',
    isVerified: true
  },
  {
    // Convenience test alias for student
    docId: 'usr_student_test',
    email: 'student.test@students.nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Gio Daniel Canag Laberinto',
    role: 'student',
    roleType: 'student',
    department: 'College of Computing and Information Technology',
    program: 'BS Computer Engineering',
    yearLevel: '2nd Year',
    studentOrEmpId: '2024-10892',
    gender: 'Male',
    contactNumber: '0917-111-2222',
    isVerified: true
  },
  // 2. Counselors
  {
    docId: 'usr_counselor_mark_d',
    email: 'mark.d@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Mark Dimalanta, RGC',
    role: 'counselor',
    roleType: 'counselor',
    department: 'Guidance and Counseling Center',
    studentOrEmpId: 'EMP-2024-0102',
    gender: 'Male',
    contactNumber: '0920-444-5555',
    isVerified: true
  },
  {
    // Convenience test alias for counselor
    docId: 'usr_counselor_test',
    email: 'counselor.test@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Mark Dimalanta, RGC',
    role: 'counselor',
    roleType: 'counselor',
    department: 'Guidance and Counseling Center',
    studentOrEmpId: 'EMP-2024-0103',
    gender: 'Male',
    contactNumber: '0920-444-5556',
    isVerified: true
  },
  // 3. Faculty
  {
    docId: 'usr_faculty_benedict_z',
    email: 'b.zurbito@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Engr. Benedict Zurbito',
    role: 'faculty',
    roleType: 'faculty',
    department: 'Computer Engineering',
    studentOrEmpId: 'EMP-2024-0202',
    gender: 'Male',
    contactNumber: '0921-555-6666',
    isVerified: true
  },
  {
    // Convenience test alias for faculty
    docId: 'usr_faculty_test',
    email: 'faculty.test@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Engr. Benedict Zurbito',
    role: 'faculty',
    roleType: 'faculty',
    department: 'Computer Engineering',
    studentOrEmpId: 'EMP-2024-0204',
    gender: 'Male',
    contactNumber: '0921-555-6667',
    isVerified: true
  },
  // 4. Guidance Head
  {
    docId: 'usr_head_maria_s',
    email: 'maria.s@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Maria Santos, RGC',
    role: 'head',
    roleType: 'head',
    department: 'Guidance and Counseling Center',
    studentOrEmpId: 'EMP-2024-0101',
    gender: 'Female',
    contactNumber: '0919-333-4444',
    isVerified: true
  },
  {
    // Convenience test alias for head
    docId: 'usr_head_test',
    email: 'head.test@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Maria Santos, RGC',
    role: 'head',
    roleType: 'head',
    department: 'Guidance and Counseling Center',
    studentOrEmpId: 'EMP-2024-0010',
    gender: 'Female',
    contactNumber: '0923-777-8888',
    isVerified: true
  },
  // 5. System Administrator
  {
    docId: 'usr_admin_alex_m',
    email: 'admin.alex@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Alex Mendoza',
    role: 'admin',
    roleType: 'admin',
    department: 'Administration',
    studentOrEmpId: 'EMP-2024-0001',
    gender: 'Male',
    contactNumber: '0925-999-0000',
    isVerified: true
  },
  {
    // Convenience test alias for admin
    docId: 'usr_admin_test',
    email: 'admin.test@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Alex Mendoza',
    role: 'admin',
    roleType: 'admin',
    department: 'Administration',
    studentOrEmpId: 'EMP-2024-0002',
    gender: 'Male',
    contactNumber: '0925-999-0001',
    isVerified: true
  }
];

// Sample Relational Data
const sampleAppointments = [
  {
    id: 'apt_sample_01',
    studentId: 'usr_student_gio_l',
    studentName: 'Gio Daniel Canag Laberinto',
    studentNumber: '2024-1033694',
    program: 'BS Computer Engineering',
    gender: 'Male',
    contactNumber: '0917-111-2222',
    counselorId: 'usr_counselor_mark_d',
    counselorName: 'Mark Dimalanta, RGC',
    date: '2026-10-05',
    timeSlot: '10:00 AM - 11:00 AM',
    concernCategory: 'Academic Coaching & Study Strategies',
    specificConcern: 'Consultation regarding career pathing and academic workload balancing.',
    status: 'Confirmed',
    isWalkIn: false
  }
];

const sampleReferrals = [
  {
    id: 'ref_sample_01',
    studentId: 'usr_student_gio_l',
    studentName: 'Gio Daniel Canag Laberinto',
    studentNumber: '2024-1033694',
    program: 'BS Computer Engineering',
    facultyId: 'usr_faculty_benedict_z',
    facultyName: 'Engr. Benedict Zurbito',
    reasonCategory: 'Academic Performance & Retention',
    urgencyLevel: 'Medium',
    status: 'Acknowledged',
    comments: 'Student demonstrated strong aptitude, recommended for academic mentorship program.'
  }
];

const sampleCases = [
  {
    id: 'case_sample_01',
    studentId: 'usr_student_gio_l',
    studentName: 'Gio Daniel Canag Laberinto',
    studentNumber: '2024-1033694',
    counselorId: 'usr_counselor_mark_d',
    counselorName: 'Mark Dimalanta, RGC',
    category: 'Academic Consultation',
    severity: 'Tier 1 - Routine',
    status: 'Open'
  }
];

const sampleWalkinQueue = [
  {
    id: 'walkin_sample_01',
    ticketNumber: 'W-101',
    studentId: 'usr_student_joshua_g',
    studentName: 'Joshua Garcia',
    studentNumber: '2023-10442',
    program: 'BS Psychology',
    counselorGenderPreference: 'Any',
    status: 'Waiting',
    estimatedWaitTime: '5 mins'
  }
];

async function seedDatabase() {
  console.log('================================================================');
  console.log(' Seeding Standardized Clean GuideHub Demo Accounts...');
  console.log(' Target Hierarchy: users/ -> {role}/ -> {userId}');
  console.log(' (No intermediate "accounts" subcollection)');
  console.log('================================================================\n');

  for (const account of standardizedAccounts) {
    const docId = account.docId;
    let uid = null;

    try {
      // Create or sign into Firebase Auth
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, account.email, account.password);
        uid = userCredential.user.uid;
        console.log(` [AUTH CREATED] ${account.email} (AuthUID: ${uid})`);
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-in-use') {
          try {
            const userCredential = await signInWithEmailAndPassword(auth, account.email, account.password);
            uid = userCredential.user.uid;
            console.log(`ℹ [AUTH EXISTS] Authenticated as ${account.email} (AuthUID: ${uid})`);
          } catch (signErr) {
            console.warn(`ℹ [AUTH RECORD PRESENT] Email ${account.email} exists in Firebase Auth.`);
          }
        } else {
          console.warn(`⚠ Auth notice for ${account.email}: ${authErr.message}`);
        }
      }

      const category = getRoleCategory(account.role);
      const profilePayload = {
        uid: docId,
        authUid: uid || docId,
        fullName: account.fullName,
        email: account.email,
        role: account.role,
        roleType: account.roleType || account.role,
        department: account.department || '',
        program: account.program || account.department || '',
        yearLevel: account.yearLevel || null,
        studentOrEmpId: account.studentOrEmpId,
        gender: account.gender || 'Prefer not to say',
        contactNumber: account.contactNumber || '',
        academicTrack: null,
        isVerified: true,
        emailVerified: true,
        createdAt: serverTimestamp()
      };

      // 1. Role Document Field representation: users/{category} contains docId as map
      await setDoc(
        doc(db, 'users', category),
        {
          [docId]: profilePayload,
          roleCategory: category,
          lastUpdated: serverTimestamp()
        },
        { merge: true }
      );
      console.log(` [ROLE DOC FIELD] users/${category} -> ${docId}`);

      // 2. Direct Subcollection under Role (no "accounts" intermediate name)
      // Path: users/{category}/users/{docId}
      await setDoc(doc(db, 'users', category, 'users', docId), profilePayload, { merge: true });
      console.log(` [SUBCOLLECTION] users/${category}/users/${docId}`);

      // 3. Root users collection (users/{docId}) for fast resolution & portal compatibility
      await setDoc(doc(db, 'users', docId), profilePayload, { merge: true });
      console.log(` [ROOT USERS] users/${docId}`);

      // 4. Role collection at root ({category}/{docId})
      await setDoc(doc(db, category, docId), profilePayload, { merge: true });
      console.log(` [ROLE COLLECTION] ${category}/${docId}`);

      // 5. Auth UID alias if different from semantic docId
      if (uid && uid !== docId) {
        await setDoc(
          doc(db, 'users', uid),
          {
            ...profilePayload,
            canonicalDocId: docId
          },
          { merge: true }
        );
      }

      await signOut(auth);
    } catch (err) {
      console.error(` Error provisioning ${account.email}:`, err.message);
    }
  }

  // 2. Seed Relational Collections
  console.log('\n Provisioning Relational Collections (Referencing Standardized IDs)...');

  for (const apt of sampleAppointments) {
    try {
      await setDoc(
        doc(db, 'appointments', apt.id),
        {
          ...apt,
          createdAt: serverTimestamp()
        },
        { merge: true }
      );
      console.log(` [APPOINTMENT SYNCED] ${apt.id} -> Student: ${apt.studentId}, Counselor: ${apt.counselorId}`);
    } catch (err) {
      console.error(` Error creating appointment ${apt.id}:`, err.message);
    }
  }

  for (const ref of sampleReferrals) {
    try {
      await setDoc(
        doc(db, 'referrals', ref.id),
        {
          ...ref,
          createdAt: serverTimestamp()
        },
        { merge: true }
      );
      console.log(` [REFERRAL SYNCED] ${ref.id} -> Student: ${ref.studentId}, Faculty: ${ref.facultyId}`);
    } catch (err) {
      console.error(` Error creating referral ${ref.id}:`, err.message);
    }
  }

  for (const c of sampleCases) {
    try {
      await setDoc(
        doc(db, 'cases', c.id),
        {
          ...c,
          createdAt: serverTimestamp()
        },
        { merge: true }
      );
      await setDoc(
        doc(db, `cases/${c.id}/notes`, 'note_01'),
        {
          counselorId: c.counselorId,
          counselorName: c.counselorName,
          note: 'Initial clinical intake conducted. Collaborative action plan established for weekly review.',
          createdAt: serverTimestamp()
        },
        { merge: true }
      );
      console.log(` [CASE SYNCED] ${c.id} -> Student: ${c.studentId}, Counselor: ${c.counselorId}`);
    } catch (err) {
      console.error(` Error creating case ${c.id}:`, err.message);
    }
  }

  for (const w of sampleWalkinQueue) {
    try {
      await setDoc(
        doc(db, 'walkinQueue', w.id),
        {
          ...w,
          createdAt: serverTimestamp()
        },
        { merge: true }
      );
      console.log(` [WALKIN SYNCED] ${w.id} -> Student: ${w.studentId}`);
    } catch (err) {
      console.error(` Error creating walkin ${w.id}:`, err.message);
    }
  }

  console.log('\n================================================================');
  console.log(' Clean Demo Seeding Completed Successfully!');
  console.log(' All accounts structured without intermediate "accounts" subcollections.');
  console.log('================================================================');
  process.exit(0);
}

seedDatabase();
