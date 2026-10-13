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
    docId: 'usr_student_angelica_r',
    email: 'angelica.reyes@students.nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Angelica Reyes',
    role: 'student',
    roleType: 'student',
    department: 'College of Computing and Information Technology',
    program: 'BS Information Technology',
    yearLevel: '4th Year',
    studentOrEmpId: '2024-10892',
    gender: 'Female',
    contactNumber: '0919-555-7788',
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
    docId: 'usr_counselor_claire_m',
    email: 'claire.m@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Claire Mendoza, RGC',
    role: 'counselor',
    roleType: 'counselor',
    department: 'Guidance and Counseling Center',
    studentOrEmpId: 'EMP-2024-0103',
    gender: 'Female',
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
    docId: 'usr_faculty_alyssa_v',
    email: 'alyssa.v@nu-fairview.edu.ph',
    password: 'Password123!',
    fullName: 'Prof. Alyssa Villanueva',
    role: 'faculty',
    roleType: 'faculty',
    department: 'College of Arts and Sciences',
    studentOrEmpId: 'EMP-2024-0204',
    gender: 'Female',
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
  }
];

function getRelativeDateIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

const todayIso = getRelativeDateIso(0);
const tomorrowIso = getRelativeDateIso(1);
const yesterdayIso = getRelativeDateIso(-1);
const twoDaysAgoIso = getRelativeDateIso(-2);
const threeDaysAgoIso = getRelativeDateIso(-3);
const nowIso = new Date().toISOString();

// Sample Relational Data Matching Portal Schemas
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
    counselorGenderPreference: 'Any',
    date: todayIso,
    timeSlot: '09:00 - 10:00',
    concernCategory: 'Academic Stress & Time Management',
    academicCycle: 'Midterms',
    specificConcern: 'Consultation regarding balancing engineering coursework and capstone project deadlines.',
    status: 'Confirmed',
    isWalkIn: false,
    createdAt: yesterdayIso
  },
  {
    id: 'apt_sample_02',
    studentId: 'usr_student_angelica_r',
    studentName: 'Angelica Reyes',
    studentNumber: '2024-10892',
    program: 'BS Information Technology',
    gender: 'Female',
    contactNumber: '0919-555-7788',
    counselorId: 'usr_counselor_mark_d',
    counselorName: 'Mark Dimalanta, RGC',
    counselorGenderPreference: 'Any',
    date: todayIso,
    timeSlot: '11:00 - 12:00',
    concernCategory: 'Career & Internship Guidance',
    academicCycle: 'Finals',
    specificConcern: 'Guidance on OJT placement and IT career specialization tracks.',
    status: 'Pending',
    isWalkIn: false,
    createdAt: todayIso
  },
  {
    id: 'apt_sample_03',
    studentId: 'usr_student_joshua_g',
    studentName: 'Joshua Garcia',
    studentNumber: '2023-10442',
    program: 'BS Psychology',
    gender: 'Male',
    contactNumber: '0918-222-3333',
    counselorId: 'usr_counselor_mark_d',
    counselorName: 'Mark Dimalanta, RGC',
    counselorGenderPreference: 'Male',
    date: yesterdayIso,
    timeSlot: '14:00 - 15:00',
    concernCategory: 'Mental Health & Emotional Well-being',
    academicCycle: 'First Year Transition',
    specificConcern: 'Follow-up consultation on sleep hygiene and stress management.',
    status: 'Completed',
    isWalkIn: false,
    createdAt: twoDaysAgoIso
  },
  {
    id: 'apt_sample_04',
    studentId: 'usr_student_gio_l',
    studentName: 'Gio Daniel Canag Laberinto',
    studentNumber: '2024-1033694',
    program: 'BS Computer Engineering',
    gender: 'Male',
    contactNumber: '0917-111-2222',
    counselorId: 'usr_counselor_claire_m',
    counselorName: 'Claire Mendoza, RGC',
    counselorGenderPreference: 'Any',
    date: twoDaysAgoIso,
    timeSlot: '10:00 - 11:00',
    concernCategory: 'Academic Stress & Time Management',
    academicCycle: 'Midterms',
    specificConcern: 'Initial academic adjustment check-in.',
    status: 'Completed',
    isWalkIn: false,
    createdAt: threeDaysAgoIso
  },
  {
    id: 'apt_sample_05',
    studentId: 'usr_student_joshua_g',
    studentName: 'Joshua Garcia',
    studentNumber: '2023-10442',
    program: 'BS Psychology',
    gender: 'Male',
    contactNumber: '0918-222-3333',
    counselorId: 'usr_counselor_claire_m',
    counselorName: 'Claire Mendoza, RGC',
    counselorGenderPreference: 'Any',
    date: threeDaysAgoIso,
    timeSlot: '15:00 - 16:00',
    concernCategory: 'Relationship & Personal',
    academicCycle: 'Enrollment / Prelims',
    specificConcern: 'Same-day walk-in consultation for peer adjustment.',
    status: 'Completed',
    isWalkIn: true,
    createdAt: threeDaysAgoIso
  }
];

const sampleReferrals = [
  {
    id: 'ref_sample_01',
    studentId: 'usr_student_gio_l',
    studentName: 'Gio Daniel Canag Laberinto',
    studentNumber: '2024-1033694',
    program: 'BS Computer Engineering',
    subjectCourse: 'CPE104 - Microprocessors',
    facultyId: 'usr_faculty_benedict_z',
    facultyName: 'Engr. Benedict Zurbito',
    facultyEmail: 'b.zurbito@nu-fairview.edu.ph',
    reasonCategory: 'Sudden Drop in Academic Grades',
    specificObservations:
      'Student showed strong early performance but missed two recent laboratory submissions and appeared fatigued during lecture.',
    status: 'Referred',
    createdAt: yesterdayIso,
    updatedAt: yesterdayIso
  },
  {
    id: 'ref_sample_02',
    studentId: 'usr_student_joshua_g',
    studentName: 'Joshua Garcia',
    studentNumber: '2023-10442',
    program: 'BS Psychology',
    subjectCourse: 'GE102 - Ethics',
    facultyId: 'usr_faculty_benedict_z',
    facultyName: 'Engr. Benedict Zurbito',
    facultyEmail: 'b.zurbito@nu-fairview.edu.ph',
    reasonCategory: 'Emotional Distress in Class',
    specificObservations:
      'Student requested to step out during lecture due to acute anxiety; recommended supportive guidance check-in.',
    status: 'Call Slip Issued',
    callSlipIssuedAt: todayIso,
    callSlipAppointmentDate: tomorrowIso,
    callSlipAppointmentTime: '10:00 AM',
    assignedCounselor: 'Mark Dimalanta, RGC',
    createdAt: twoDaysAgoIso,
    updatedAt: todayIso
  }
];

const sampleCases = [
  {
    id: 'case_sample_01',
    caseId: 'case_sample_01',
    studentId: 'usr_student_gio_l',
    studentName: 'Gio Daniel Canag Laberinto',
    studentNumber: '2024-1033694',
    program: 'BS Computer Engineering',
    counselorId: 'usr_counselor_mark_d',
    counselorName: 'Mark Dimalanta, RGC',
    category: 'Academic Stress & Time Management',
    status: 'Active',
    riskFlags: {
      selfHarm: false,
      abuseHarmFromOthers: false,
      threatToOthers: false
    },
    lastSessionDate: twoDaysAgoIso,
    createdAt: threeDaysAgoIso,
    updatedAt: twoDaysAgoIso,
    notes: [
      {
        id: 'note_01',
        noteType: 'Intake Assessment',
        sessionDate: twoDaysAgoIso,
        counselorId: 'usr_counselor_mark_d',
        counselorName: 'Mark Dimalanta, RGC',
        subjectiveObservation:
          'Student expressed feeling overwhelmed by simultaneous laboratory deadlines and capstone milestones.',
        counselorRemarks:
          'Conducted structured time-blocking exercise and cognitive reframing for academic performance anxiety.',
        actionPlan: '1. Implement weekly priority matrix; 2. Follow-up check-in during midterm week.',
        followUpDate: null,
        riskFlags: { selfHarm: false, abuseHarmFromOthers: false, threatToOthers: false },
        createdAt: twoDaysAgoIso
      }
    ]
  },
  {
    id: 'case_sample_02',
    caseId: 'case_sample_02',
    studentId: 'usr_student_joshua_g',
    studentName: 'Joshua Garcia',
    studentNumber: '2023-10442',
    program: 'BS Psychology',
    counselorId: 'usr_counselor_mark_d',
    counselorName: 'Mark Dimalanta, RGC',
    category: 'Mental Health & Emotional Well-being',
    status: 'High Risk',
    riskFlags: {
      selfHarm: true,
      abuseHarmFromOthers: false,
      threatToOthers: false
    },
    lastSessionDate: yesterdayIso,
    createdAt: threeDaysAgoIso,
    updatedAt: yesterdayIso,
    notes: [
      {
        id: 'note_01',
        noteType: 'Crisis Intervention',
        sessionDate: yesterdayIso,
        counselorId: 'usr_counselor_mark_d',
        counselorName: 'Mark Dimalanta, RGC',
        subjectiveObservation:
          'Student disclosed acute emotional exhaustion and passive distress thoughts following family conflict.',
        counselorRemarks:
          'Activated RA 9258 crisis safety protocol, established grounding techniques, and coordinated supportive monitoring.',
        actionPlan: '1. Daily grounding log; 2. Scheduled priority follow-up consultation.',
        followUpDate: tomorrowIso,
        riskFlags: { selfHarm: true, abuseHarmFromOthers: false, threatToOthers: false },
        createdAt: yesterdayIso
      }
    ]
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
    gender: 'Male',
    contactNumber: '0918-222-3333',
    concernCategory: 'Urgent Stress / Anxiety Relief',
    status: 'Waiting',
    assignedCounselorId: null,
    date: todayIso,
    createdAt: nowIso
  },
  {
    id: 'walkin_sample_02',
    ticketNumber: 'W-102',
    studentId: 'usr_student_angelica_r',
    studentName: 'Angelica Reyes',
    studentNumber: '2024-10892',
    program: 'BS Information Technology',
    gender: 'Female',
    contactNumber: '0919-555-7788',
    concernCategory: 'Academic Difficulty Consultation',
    status: 'Calling',
    assignedCounselorId: 'usr_counselor_mark_d',
    date: todayIso,
    createdAt: nowIso
  }
];

const sampleAuditLogs = [
  {
    id: 'log_sample_01',
    actorId: 'usr_admin_alex_m',
    actorName: 'Alex Mendoza',
    actorRole: 'admin',
    action: 'USER_LOGIN',
    details: 'Authenticated into admin portal (admin.alex@nu-fairview.edu.ph)',
    timestamp: nowIso
  },
  {
    id: 'log_sample_02',
    actorId: 'usr_student_gio_l',
    actorName: 'Gio Daniel Canag Laberinto',
    actorRole: 'student',
    action: 'APPOINTMENT_BOOKED',
    details: `Booked ${todayIso} (09:00 - 10:00) with Mark Dimalanta, RGC - Academic Stress & Time Management`,
    timestamp: yesterdayIso + 'T10:15:00.000Z'
  },
  {
    id: 'log_sample_03',
    actorId: 'usr_faculty_benedict_z',
    actorName: 'Engr. Benedict Zurbito',
    actorRole: 'faculty',
    action: 'REFERRAL_SUBMITTED',
    details: 'Submitted referral for Gio Daniel Canag Laberinto (2024-1033694)',
    timestamp: yesterdayIso + 'T14:30:00.000Z'
  },
  {
    id: 'log_sample_04',
    actorId: 'usr_counselor_mark_d',
    actorName: 'Mark Dimalanta, RGC',
    actorRole: 'counselor',
    action: 'CALL_SLIP_ISSUED',
    details: `Issued Call Slip for Joshua Garcia on ${tomorrowIso} 10:00 AM`,
    timestamp: nowIso
  },
  {
    id: 'log_sample_05',
    actorId: 'usr_counselor_mark_d',
    actorName: 'Mark Dimalanta, RGC',
    actorRole: 'counselor',
    action: 'CASE_NOTE_RECORDED',
    details: `Recorded session note for case 2023-10442 (Follow-up: ${tomorrowIso})`,
    timestamp: yesterdayIso + 'T16:00:00.000Z'
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
        createdAt: nowIso
      };

      // Store strictly inside users/{category} -> [docId]: profilePayload (NO nested users subcollection)
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
    } catch (err) {
      console.error(` Error provisioning ${account.email}:`, err.message);
    }
  }

  // Ensure we are signed in as Admin before seeding protected relational collections
  try {
    await signInWithEmailAndPassword(auth, 'admin.alex@nu-fairview.edu.ph', 'Password123!');
  } catch (e) {}

  // 2. Seed Relational Collections
  console.log('\n Provisioning Relational Collections (Referencing Standardized IDs)...');

  for (const apt of sampleAppointments) {
    try {
      await setDoc(doc(db, 'appointments', apt.id), apt, { merge: true });
      console.log(` [APPOINTMENT SYNCED] ${apt.id} -> Student: ${apt.studentId}, Counselor: ${apt.counselorId}`);
    } catch (err) {
      console.error(` Error creating appointment ${apt.id}:`, err.message);
    }
  }

  for (const ref of sampleReferrals) {
    try {
      await setDoc(doc(db, 'referrals', ref.id), ref, { merge: true });
      console.log(` [REFERRAL SYNCED] ${ref.id} -> Student: ${ref.studentId}, Faculty: ${ref.facultyId}`);
    } catch (err) {
      console.error(` Error creating referral ${ref.id}:`, err.message);
    }
  }

  for (const c of sampleCases) {
    try {
      const { notes, ...caseDoc } = c;
      await setDoc(doc(db, 'cases', c.id), caseDoc, { merge: true });
      for (const n of notes || []) {
        await setDoc(doc(db, `cases/${c.id}/notes`, n.id), n, { merge: true });
      }
      console.log(` [CASE SYNCED] ${c.id} -> Student: ${c.studentId}, Counselor: ${c.counselorId}`);
    } catch (err) {
      console.error(` Error creating case ${c.id}:`, err.message);
    }
  }

  for (const w of sampleWalkinQueue) {
    try {
      await setDoc(doc(db, 'walkin_queue', w.id), w, { merge: true });
      console.log(` [WALKIN SYNCED] ${w.id} (${w.ticketNumber}) -> Student: ${w.studentId}`);
    } catch (err) {
      console.error(` Error creating walkin ${w.id}:`, err.message);
    }
  }

  for (const log of sampleAuditLogs) {
    try {
      await setDoc(doc(db, 'auditLogs', log.id), log, { merge: true });
      console.log(` [AUDIT LOG SYNCED] ${log.id} (${log.action})`);
    } catch (err) {
      console.error(` Error creating audit log ${log.id}:`, err.message);
    }
  }

  await signOut(auth).catch(() => {});

  console.log('\n================================================================');
  console.log(' Clean Demo Seeding Completed Successfully!');
  console.log(' All accounts structured without intermediate "accounts" subcollections.');
  console.log('================================================================');
  process.exit(0);
}

seedDatabase();
