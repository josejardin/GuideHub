import {
  db,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  serverTimestamp,
  Timestamp,
  collectionGroup
} from '../firebase-config.js';
import { getRoleCategory } from '../utils/validation.js';

const LOCAL_STORE_KEY = 'guidehub_local_firestore_state';

function getLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Local store read error', e);
  }
  return {
    users: {},
    appointments: {},
    walkinQueue: {},
    referrals: {},
    cases: {},
    caseNotes: {},
    counselorSchedules: {},
    auditLogs: []
  };
}

function saveLocalState(state) {
  try {
    localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(state));
    window.dispatchEvent(new Event('guidehub_data_changed'));
  } catch (e) {
    console.error('Local store write error', e);
  }
}

export async function getUserProfile(uid) {
  try {
    if (db) {
      const categories = ['students', 'counselors', 'faculty', 'head', 'admin'];

      for (const cat of categories) {
        try {
          const catDocRef = doc(db, 'users', cat);
          const catSnap = await getDoc(catDocRef);
          if (catSnap.exists()) {
            const catData = catSnap.data();
            // 1. Direct match by semantic user key (e.g. usr_student_gio_l)
            if (catData[uid] && typeof catData[uid] === 'object') {
              return { uid, ...catData[uid] };
            }
            // 2. Match by authUid if uid passed is a Firebase Auth UID
            for (const [key, val] of Object.entries(catData)) {
              if (val && typeof val === 'object' && val.authUid === uid) {
                return { uid: key, ...val };
              }
            }
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    console.warn('Firestore getUserProfile fallback:', err.message);
  }
  const state = getLocalState();
  return state.users[uid] || null;
}

export async function saveUserProfile(uid, data) {
  const category = getRoleCategory(data.role || 'student');
  const profileData = {
    uid,
    email: data.email || '',
    fullName: data.fullName || 'User',
    role: data.role || 'student',
    studentOrEmpId: data.studentOrEmpId || '',
    program: data.program || 'General',
    gender: data.gender || 'Not Specified',
    contactNumber: data.contactNumber || '',
    createdAt: data.createdAt || new Date().toISOString()
  };

  try {
    if (db) {
      // Strictly store inside users/{category} -> [uid]: profile (NO nested users subcollection)
      await setDoc(doc(db, 'users', category), { [uid]: profileData, roleCategory: category }, { merge: true });
    }
  } catch (err) {
    console.warn('Firestore saveUserProfile fallback:', err.message);
  }

  const state = getLocalState();
  state.users[uid] = { ...(state.users[uid] || {}), ...profileData };
  saveLocalState(state);
  return profileData;
}

export async function getAllUsers() {
  try {
    if (db) {
      const usersMap = new Map();
      const seenEmails = new Set();
      const categories = ['students', 'counselors', 'faculty', 'head', 'admin'];

      const addCleanUser = (id, data) => {
        if (!data || categories.includes(id)) return;
        if (data.canonicalDocId && id !== data.canonicalDocId) return;
        if (!data.email && !data.fullName) return;

        const emailKey = (data.email || '').trim().toLowerCase();
        if (emailKey && seenEmails.has(emailKey)) {
          for (const [existingId, existingUser] of usersMap.entries()) {
            if ((existingUser.email || '').trim().toLowerCase() === emailKey) {
              if (!existingId.startsWith('usr_') && id.startsWith('usr_')) {
                usersMap.delete(existingId);
                usersMap.set(id, { ...data, uid: id });
              }
              return;
            }
          }
          return;
        }

        if (emailKey) seenEmails.add(emailKey);
        usersMap.set(id, { ...data, uid: id });
      };

      // Read strictly from the 5 role documents (users/students, users/counselors, etc.)
      await Promise.all(
        categories.map(async cat => {
          try {
            const snap = await getDoc(doc(db, 'users', cat));
            if (snap.exists()) {
              const data = snap.data();
              for (const [key, val] of Object.entries(data)) {
                if (val && typeof val === 'object' && val.email) {
                  addCleanUser(key, val);
                }
              }
            }
          } catch (e) {}
        })
      );

      if (usersMap.size > 0) {
        return Array.from(usersMap.values());
      }
    }
  } catch (err) {
    console.warn('Firestore getAllUsers fallback:', err.message);
  }
  const state = getLocalState();
  return Object.values(state.users);
}

export async function updateUserRole(uid, newRole) {
  try {
    if (db) {
      const targetCategory = getRoleCategory(newRole);
      const categories = ['students', 'counselors', 'faculty', 'head', 'admin'];
      let userData = null;

      for (const cat of categories) {
        try {
          const catRef = doc(db, 'users', cat);
          const snap = await getDoc(catRef);
          if (snap.exists()) {
            const data = snap.data();
            if (data[uid] && typeof data[uid] === 'object') {
              userData = { ...data[uid], role: newRole, roleType: newRole };
              if (cat !== targetCategory) {
                await updateDoc(catRef, { [uid]: deleteField() }).catch(() => {});
              }
            }
          }
        } catch (e) {}
      }

      if (userData) {
        await setDoc(
          doc(db, 'users', targetCategory),
          { [uid]: userData, roleCategory: targetCategory },
          { merge: true }
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('Firestore updateUserRole fallback:', err.message);
  }
  const state = getLocalState();
  if (state.users[uid]) {
    state.users[uid].role = newRole;
    saveLocalState(state);
  }
}

export async function createAppointment(data) {
  const appointment = {
    studentId: data.studentId,
    studentAuthUid: data.studentAuthUid || data.authUid || data.studentId || '',
    studentEmail: (data.studentEmail || data.email || '').toLowerCase(),
    studentName: data.studentName,
    studentNumber: data.studentNumber || '',
    program: data.program,
    gender: data.gender || 'Not Specified',
    contactNumber: data.contactNumber || '',
    counselorId: data.counselorId || 'any',
    counselorName: data.counselorName || 'Any Available Counselor',
    counselorGenderPreference: data.counselorGenderPreference || 'Any',
    date: data.date,
    timeSlot: data.timeSlot,
    concernCategory: data.concernCategory,
    specificConcern: data.specificConcern || '',
    status: data.status || 'Pending',
    isWalkIn: data.isWalkIn || false,
    queueNumber: data.queueNumber || null,
    academicCycle: data.academicCycle || 'Regular Period',
    counselorNotes: '',
    followUpDate: null,
    createdAt: new Date().toISOString()
  };

  let id = 'apt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  try {
    if (db) {
      const docRef = doc(db, 'appointments', id);
      await setDoc(docRef, appointment);
    }
  } catch (err) {
    console.warn('Firestore createAppointment fallback:', err.message);
  }

  const state = getLocalState();
  state.appointments[id] = { id, ...appointment };
  saveLocalState(state);
  return { id, ...appointment };
}

export function subscribeStudentAppointments(studentUserOrId, callback) {
  const targetUid = typeof studentUserOrId === 'object' ? studentUserOrId.uid : studentUserOrId;
  const targetAuthUid = typeof studentUserOrId === 'object' ? studentUserOrId.authUid : null;
  const targetStudentNumber = typeof studentUserOrId === 'object' ? studentUserOrId.studentOrEmpId : null;
  const targetEmail = typeof studentUserOrId === 'object' ? (studentUserOrId.email || '').toLowerCase() : null;

  const matchesStudent = a => {
    if (!a) return false;
    if (a.studentId && (a.studentId === targetUid || (targetAuthUid && a.studentId === targetAuthUid))) return true;
    if (targetStudentNumber && (a.studentNumber === targetStudentNumber || a.studentId === targetStudentNumber)) return true;
    if (targetEmail && (a.studentEmail || '').toLowerCase() === targetEmail) return true;
    return false;
  };

  const deliver = list => {
    const matched = (list || []).filter(matchesStudent);
    matched.sort(
      (a, b) =>
        new Date(b.date + ' ' + (b.timeSlot || '00:00')) - new Date(a.date + ' ' + (a.timeSlot || '00:00'))
    );
    callback(matched);
  };

  let firestoreList = [];
  let unsubFirestore = null;

  try {
    if (db) {
      const q = query(collection(db, 'appointments'));
      unsubFirestore = onSnapshot(
        q,
        snap => {
          firestoreList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          const state = getLocalState();
          const localList = Object.values(state.appointments || {});
          const mergedMap = new Map();
          firestoreList.forEach(item => mergedMap.set(item.id, item));
          localList.forEach(item => {
            if (!mergedMap.has(item.id)) mergedMap.set(item.id, item);
          });
          deliver(Array.from(mergedMap.values()));
        },
        err => {
          console.warn('Snapshot error student appointments:', err);
          const state = getLocalState();
          deliver(Object.values(state.appointments || {}));
        }
      );
    }
  } catch (e) {
    console.warn('subscribeStudentAppointments firestore exception', e);
  }

  const localHandler = () => {
    const state = getLocalState();
    const localList = Object.values(state.appointments || {});
    const mergedMap = new Map();
    firestoreList.forEach(item => mergedMap.set(item.id, item));
    localList.forEach(item => {
      if (!mergedMap.has(item.id)) mergedMap.set(item.id, item);
    });
    deliver(Array.from(mergedMap.values()));
  };

  window.addEventListener('guidehub_data_changed', localHandler);
  localHandler();

  return () => {
    if (unsubFirestore) unsubFirestore();
    window.removeEventListener('guidehub_data_changed', localHandler);
  };
}

export function subscribeAllAppointments(callback) {
  let firestoreList = [];
  let unsubFirestore = null;

  const deliver = () => {
    const state = getLocalState();
    const localList = Object.values(state.appointments || {});
    const mergedMap = new Map();
    firestoreList.forEach(item => mergedMap.set(item.id, item));
    localList.forEach(item => {
      if (!mergedMap.has(item.id)) mergedMap.set(item.id, item);
    });
    const list = Array.from(mergedMap.values());
    list.sort(
      (a, b) =>
        new Date(b.date + ' ' + (b.timeSlot || '00:00')) - new Date(a.date + ' ' + (a.timeSlot || '00:00'))
    );
    callback(list);
  };

  try {
    if (db) {
      const q = query(collection(db, 'appointments'));
      unsubFirestore = onSnapshot(
        q,
        snap => {
          firestoreList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          deliver();
        },
        err => {
          console.warn('Snapshot error all appointments:', err);
          deliver();
        }
      );
    }
  } catch (e) {
    console.warn('subscribeAllAppointments firestore exception', e);
  }

  window.addEventListener('guidehub_data_changed', deliver);
  deliver();

  return () => {
    if (unsubFirestore) unsubFirestore();
    window.removeEventListener('guidehub_data_changed', deliver);
  };
}

export async function updateAppointmentStatus(appointmentId, status, extraFields = {}) {
  const cleanExtra = {};
  for (const [k, v] of Object.entries(extraFields || {})) {
    if (v !== undefined) cleanExtra[k] = v;
  }
  const updatedAt = new Date().toISOString();

  try {
    if (db) {
      const aptRef = doc(db, 'appointments', appointmentId);
      await updateDoc(aptRef, { status, ...cleanExtra, updatedAt });
    }
  } catch (err) {
    console.warn('Firestore updateAppointmentStatus fallback:', err.message);
  }

  const state = getLocalState();
  const existing = state.appointments[appointmentId] || {};
  state.appointments[appointmentId] = {
    ...existing,
    id: appointmentId,
    status,
    ...cleanExtra,
    updatedAt
  };
  saveLocalState(state);
}

export async function getCounselors() {
  const counselors = [];
  try {
    if (db) {
      const snap = await getDoc(doc(db, 'users', 'counselors'));
      if (snap.exists()) {
        const data = snap.data();
        for (const [key, val] of Object.entries(data)) {
          if (val && typeof val === 'object' && val.fullName) {
            counselors.push({ id: key, uid: key, ...val });
          }
        }
      }
    }
  } catch (e) {
    console.warn('getCounselors warning:', e.message);
  }

  if (counselors.length === 0) {
    const state = getLocalState();
    const fallbackList = Object.entries(state.users || {})
      .filter(([_, u]) => (u.role || '').toLowerCase() === 'counselor')
      .map(([id, u]) => ({ id, uid: id, ...u }));
    if (fallbackList.length > 0) return fallbackList;

    return [
      {
        id: 'usr_counselor_mark_d',
        uid: 'usr_counselor_mark_d',
        fullName: 'Mark Dimalanta, RGC',
        email: 'mark.d@nu-fairview.edu.ph',
        gender: 'Male',
        department: 'Guidance and Counseling Center'
      },
      {
        id: 'usr_counselor_claire_m',
        uid: 'usr_counselor_claire_m',
        fullName: 'Claire Mendoza, RGC',
        email: 'claire.m@nu-fairview.edu.ph',
        gender: 'Female',
        department: 'Guidance and Counseling Center'
      }
    ];
  }

  return counselors;
}

export async function getAvailableCounselorsForSlot(date, timeSlot, genderPreference = 'Any') {
  const state = getLocalState();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayOfWeek = date ? dayNames[new Date(`${date}T00:00:00`).getDay()] : '';

  let activeApts = Object.values(state.appointments || {}).filter(
    apt => apt.date === date && apt.timeSlot === timeSlot && apt.status !== 'Cancelled' && apt.status !== 'No-Show'
  );

  try {
    if (db) {
      const qApts = query(collection(db, 'appointments'), where('date', '==', date));
      const snap = await getDocs(qApts);
      if (!snap.empty) {
        activeApts = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(apt => apt.timeSlot === timeSlot && apt.status !== 'Cancelled' && apt.status !== 'No-Show');
      }
    }
  } catch (err) {
    console.warn('Firestore active appointments fetch warning:', err.message);
  }

  const allCounselors = await getCounselors();

  async function isCounselorBlockedOrBooked(c) {
    const cId = c.id || c.uid;
    const cEmail = (c.email || '').toLowerCase();
    const cName = (c.fullName || '').toLowerCase();

    // 1. Appointment Collision Check
    const hasCollision = activeApts.some(apt => {
      const aptCId = apt.counselorId;
      const aptCName = (apt.counselorName || '').toLowerCase();
      return (
        aptCId === cId ||
        aptCId === cEmail ||
        (aptCName && cName && (aptCName.includes(cName) || cName.includes(aptCName)))
      );
    });
    if (hasCollision) return true;

    // 2. Local State Block Check
    const localDayBlocked = !!(
      (state.counselorSchedules[`${cId}_${dayOfWeek}_${timeSlot}`] || {}).isBlocked ||
      (state.counselorSchedules[`${cId}_${date}_${timeSlot}`] || {}).isBlocked
    );
    if (localDayBlocked) return true;

    // 3. Firestore Block Check
    if (db) {
      try {
        if (dayOfWeek) {
          const daySnap = await getDoc(doc(db, 'counselorSchedules', `${cId}_${dayOfWeek}_${timeSlot}`));
          if (daySnap.exists() && daySnap.data().isBlocked) return true;
        }
        const dateSnap = await getDoc(doc(db, 'counselorSchedules', `${cId}_${date}_${timeSlot}`));
        if (dateSnap.exists() && dateSnap.data().isBlocked) return true;
      } catch (e) {}
    }

    return false;
  }

  const available = [];
  const prefLower = (genderPreference || 'Any').toLowerCase();

  for (const c of allCounselors) {
    if (prefLower !== 'any' && (c.gender || '').toLowerCase() !== prefLower) {
      continue;
    }
    const blocked = await isCounselorBlockedOrBooked(c);
    if (!blocked) {
      available.push(c);
    }
  }

  return available;
}

export async function checkSlotAvailable(date, timeSlot, counselorId = 'any', genderPreference = 'Any') {
  if (counselorId && counselorId !== 'any') {
    const allCounselors = await getCounselors();
    const targetCounselor =
      allCounselors.find(c => c.id === counselorId || c.uid === counselorId || c.email === counselorId) || {
        id: counselorId,
        uid: counselorId
      };
    const available = await getAvailableCounselorsForSlot(date, timeSlot, 'Any');
    return available.some(
      c =>
        c.id === targetCounselor.id ||
        c.uid === targetCounselor.uid ||
        (targetCounselor.email && c.email === targetCounselor.email)
    );
  }

  const available = await getAvailableCounselorsForSlot(date, timeSlot, genderPreference);
  return available.length > 0;
}

export async function generateWalkInTicket(studentData) {
  const today = new Date().toISOString().split('T')[0];
  const state = getLocalState();

  let existingCount = Object.values(state.walkinQueue).filter(t => t.date === today).length;
  try {
    if (db) {
      const qToday = query(collection(db, 'walkin_queue'), where('date', '==', today));
      const snap = await getDocs(qToday);
      if (snap.size > existingCount) {
        existingCount = snap.size;
      }
    }
  } catch (e) {}

  const queueSeq = existingCount + 101;
  const ticketNumber = `W-${queueSeq}`;

  const ticket = {
    studentId: studentData.studentId || 'walkin_guest',
    studentName: studentData.studentName,
    studentNumber: studentData.studentNumber,
    program: studentData.program,
    gender: studentData.gender || 'Not Specified',
    contactNumber: studentData.contactNumber || '',
    concernCategory: studentData.concernCategory || 'Walk-In Consultation',
    ticketNumber,
    date: today,
    status: 'Waiting',
    assignedCounselorId: null,
    calledAt: null,
    completedAt: null,
    createdAt: new Date().toISOString()
  };

  let id = 'queue_' + Date.now();

  try {
    if (db) {
      const docRef = doc(db, 'walkin_queue', id);
      await setDoc(docRef, ticket);
    }
  } catch (err) {
    console.warn('Firestore generateWalkInTicket fallback:', err.message);
  }

  state.walkinQueue[id] = { id, ...ticket };
  saveLocalState(state);
  return { id, ...ticket };
}

export function subscribeLiveWalkInQueue(callback) {
  const today = new Date().toISOString().split('T')[0];

  try {
    if (db) {
      const q = query(collection(db, 'walkin_queue'), where('date', '==', today));
      const unsubscribe = onSnapshot(q, snap => {
        if (!snap.empty) {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          callback(list);
        } else {
          const state = getLocalState();
          const list = Object.values(state.walkinQueue).filter(t => t.date === today);
          list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          callback(list);
        }
      });
      return unsubscribe;
    }
  } catch (e) {
    console.warn('subscribeLiveWalkInQueue firestore exception', e);
  }

  const handler = () => {
    const state = getLocalState();
    const list = Object.values(state.walkinQueue).filter(t => t.date === today);
    list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    callback(list);
  };
  window.addEventListener('guidehub_data_changed', handler);
  handler();
  return () => window.removeEventListener('guidehub_data_changed', handler);
}

export async function updateWalkInStatus(ticketId, status, counselorId = null) {
  const updateData = {
    status,
    updatedAt: new Date().toISOString()
  };
  if (counselorId) updateData.assignedCounselorId = counselorId;
  if (status === 'Calling') updateData.calledAt = new Date().toISOString();
  if (status === 'Completed') updateData.completedAt = new Date().toISOString();

  try {
    if (db) {
      const ticketRef = doc(db, 'walkin_queue', ticketId);
      await updateDoc(ticketRef, updateData);
    }
  } catch (err) {
    console.warn('Firestore updateWalkInStatus fallback:', err.message);
  }

  const state = getLocalState();
  if (state.walkinQueue[ticketId]) {
    state.walkinQueue[ticketId] = {
      ...state.walkinQueue[ticketId],
      ...updateData
    };
    saveLocalState(state);
  }
}

export async function createReferral(data) {
  const referral = {
    facultyId: data.facultyId,
    facultyName: data.facultyName,
    facultyEmail: data.facultyEmail || '',
    studentName: data.studentName,
    studentNumber: data.studentNumber,
    program: data.program,
    subjectCourse: data.subjectCourse || 'General',
    reasonCategory: data.reasonCategory,
    specificObservations: data.specificObservations,
    status: 'Referred',
    callSlipIssuedAt: null,
    callSlipAppointmentDate: null,
    callSlipAppointmentTime: null,
    assignedCounselor: null,
    createdAt: new Date().toISOString()
  };

  let id = 'ref_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  try {
    if (db) {
      const docRef = doc(db, 'referrals', id);
      await setDoc(docRef, referral);
    }
  } catch (err) {
    console.warn('Firestore createReferral fallback:', err.message);
  }

  const state = getLocalState();
  state.referrals[id] = { id, ...referral };
  saveLocalState(state);
  return { id, ...referral };
}

export function subscribeFacultyReferrals(facultyId, callback) {
  try {
    if (db) {
      const q = query(collection(db, 'referrals'), where('facultyId', '==', facultyId));
      const unsubscribe = onSnapshot(q, snap => {
        if (!snap.empty) {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          callback(list);
        } else {
          const state = getLocalState();
          const list = Object.values(state.referrals).filter(r => r.facultyId === facultyId);
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          callback(list);
        }
      });
      return unsubscribe;
    }
  } catch (e) {
    console.warn('subscribeFacultyReferrals firestore exception', e);
  }

  const handler = () => {
    const state = getLocalState();
    const list = Object.values(state.referrals).filter(r => r.facultyId === facultyId);
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    callback(list);
  };
  window.addEventListener('guidehub_data_changed', handler);
  handler();
  return () => window.removeEventListener('guidehub_data_changed', handler);
}

export function subscribeAllReferrals(callback) {
  try {
    if (db) {
      const q = query(collection(db, 'referrals'));
      const unsubscribe = onSnapshot(q, snap => {
        if (!snap.empty) {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          callback(list);
        } else {
          const state = getLocalState();
          const list = Object.values(state.referrals);
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          callback(list);
        }
      });
      return unsubscribe;
    }
  } catch (e) {
    console.warn('subscribeAllReferrals firestore exception', e);
  }

  const handler = () => {
    const state = getLocalState();
    const list = Object.values(state.referrals);
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    callback(list);
  };
  window.addEventListener('guidehub_data_changed', handler);
  handler();
  return () => window.removeEventListener('guidehub_data_changed', handler);
}

export async function updateReferralStatus(referralId, status, extraFields = {}) {
  try {
    if (db) {
      const refDoc = doc(db, 'referrals', referralId);
      await updateDoc(refDoc, { status, ...extraFields, updatedAt: new Date().toISOString() });
    }
  } catch (err) {
    console.warn('Firestore updateReferralStatus fallback:', err.message);
  }

  const state = getLocalState();
  if (state.referrals[referralId]) {
    state.referrals[referralId] = {
      ...state.referrals[referralId],
      status,
      ...extraFields,
      updatedAt: new Date().toISOString()
    };
    saveLocalState(state);
  }
}

export async function getOrCreateCase(studentNumber, studentName, program, counselorId) {
  let id = 'case_' + (studentNumber || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');

  try {
    if (db) {
      // 1. Check direct case ID in Firestore
      const directSnap = await getDoc(doc(db, 'cases', id));
      if (directSnap.exists()) {
        return { id: directSnap.id, ...directSnap.data() };
      }

      // 2. Query Firestore cases by studentNumber
      const qCase = query(collection(db, 'cases'), where('studentNumber', '==', studentNumber));
      const querySnap = await getDocs(qCase);
      if (!querySnap.empty) {
        const docSnap = querySnap.docs[0];
        return { id: docSnap.id, ...docSnap.data() };
      }
    }
  } catch (err) {
    console.warn('Firestore getOrCreateCase lookup notice:', err.message);
  }

  const state = getLocalState();
  let existingCase = Object.values(state.cases).find(c => c.studentNumber === studentNumber);

  if (existingCase) {
    return existingCase;
  }

  const newCase = {
    studentNumber,
    studentName,
    program,
    assignedCounselorId: counselorId,
    status: 'Active',
    riskFlags: {
      selfHarm: false,
      abuseHarmFromOthers: false,
      threatToOthers: false
    },
    category: 'General Counseling',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    if (db) {
      const caseRef = doc(db, 'cases', id);
      await setDoc(caseRef, newCase, { merge: true });
    }
  } catch (err) {
    console.warn('Firestore getOrCreateCase fallback:', err.message);
  }

  state.cases[id] = { id, ...newCase };
  saveLocalState(state);
  return { id, ...newCase };
}

export function subscribeAllCases(callback) {
  try {
    if (db) {
      const q = query(collection(db, 'cases'));
      const unsubscribe = onSnapshot(q, snap => {
        if (!snap.empty) {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          list.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
          callback(list);
        } else {
          const state = getLocalState();
          const list = Object.values(state.cases);
          list.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
          callback(list);
        }
      });
      return unsubscribe;
    }
  } catch (e) {
    console.warn('subscribeAllCases firestore exception', e);
  }

  const handler = () => {
    const state = getLocalState();
    const list = Object.values(state.cases);
    list.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    callback(list);
  };
  window.addEventListener('guidehub_data_changed', handler);
  handler();
  return () => window.removeEventListener('guidehub_data_changed', handler);
}

export async function addSessionNote(caseId, noteData) {
  const note = {
    caseId,
    sessionDate: noteData.sessionDate || new Date().toISOString().split('T')[0],
    counselorId: noteData.counselorId,
    counselorName: noteData.counselorName || 'Counselor',
    noteType: noteData.noteType || 'Individual Counseling',
    subjectiveObservation: noteData.subjectiveObservation || '',
    counselorRemarks: noteData.counselorRemarks || '',
    actionPlan: noteData.actionPlan || '',
    riskFlagsSnapshot: noteData.riskFlags || {},
    followUpDate: noteData.followUpDate || null,
    createdAt: new Date().toISOString()
  };

  let id = 'note_' + Date.now();

  try {
    if (db) {
      const noteRef = doc(db, 'cases', caseId, 'notes', id);
      await setDoc(noteRef, note);
    }
  } catch (err) {
    console.warn('Firestore addSessionNote fallback:', err.message);
  }

  const state = getLocalState();
  if (!state.caseNotes[caseId]) state.caseNotes[caseId] = [];
  state.caseNotes[caseId].push({ id, ...note });

  if (state.cases[caseId]) {
    state.cases[caseId].updatedAt = new Date().toISOString();
    if (noteData.riskFlags) {
      state.cases[caseId].riskFlags = noteData.riskFlags;
      const hasRisk = Object.values(noteData.riskFlags).some(Boolean);
      if (hasRisk) state.cases[caseId].status = 'High Risk';
    }
  }

  saveLocalState(state);
  return { id, ...note };
}

export function subscribeCaseNotes(caseId, callback) {
  try {
    if (db) {
      const q = query(collection(db, 'cases', caseId, 'notes'), orderBy('createdAt', 'desc'));
      const unsubscribe = onSnapshot(q, snap => {
        if (!snap.empty) {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          callback(list);
        } else {
          const state = getLocalState();
          const list = state.caseNotes[caseId] || [];
          list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          callback([...list]);
        }
      });
      return unsubscribe;
    }
  } catch (e) {
    console.warn('subscribeCaseNotes firestore exception', e);
  }

  const handler = () => {
    const state = getLocalState();
    const list = state.caseNotes[caseId] || [];
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    callback([...list]);
  };
  window.addEventListener('guidehub_data_changed', handler);
  handler();
  return () => window.removeEventListener('guidehub_data_changed', handler);
}

export async function updateCaseRiskFlags(caseId, riskFlags) {
  const hasRisk = Object.values(riskFlags).some(Boolean);
  const status = hasRisk ? 'High Risk' : 'Active';

  try {
    if (db) {
      const caseRef = doc(db, 'cases', caseId);
      await setDoc(caseRef, { riskFlags, status, updatedAt: new Date().toISOString() }, { merge: true });
    }
  } catch (err) {
    console.warn('Firestore updateCaseRiskFlags fallback:', err.message);
  }

  const state = getLocalState();
  if (state.cases[caseId]) {
    state.cases[caseId].riskFlags = riskFlags;
    state.cases[caseId].status = status;
    state.cases[caseId].updatedAt = new Date().toISOString();
    saveLocalState(state);
  }
}

export async function getCounselorBlockedSlots(counselorId) {
  try {
    if (db && counselorId) {
      const q = query(collection(db, 'counselorSchedules'), where('counselorId', '==', counselorId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const state = getLocalState();
        snap.docs.forEach(d => {
          state.counselorSchedules[d.id] = d.data();
        });
        try {
          localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(state));
        } catch (e) {}
        return snap.docs.map(d => d.data()).filter(s => s.isBlocked);
      }
    }
  } catch (err) {
    console.warn('Firestore getCounselorBlockedSlots fallback:', err.message);
  }

  const state = getLocalState();
  return Object.values(state.counselorSchedules).filter(s => s.counselorId === counselorId && s.isBlocked);
}

export async function toggleCounselorBlockedSlot(counselorId, dayOfWeek, timeSlot, isBlocked) {
  const key = `${counselorId}_${dayOfWeek}_${timeSlot}`;
  const record = { counselorId, dayOfWeek, timeSlot, isBlocked, updatedAt: new Date().toISOString() };

  try {
    if (db) {
      const schedRef = doc(db, 'counselorSchedules', key);
      await setDoc(schedRef, record, { merge: true });
    }
  } catch (err) {
    console.warn('Firestore toggleCounselorBlockedSlot fallback:', err.message);
  }

  const state = getLocalState();
  state.counselorSchedules[key] = record;
  saveLocalState(state);
  return record;
}

export function subscribeAllCounselorSchedules(callback) {
  let firestoreMap = {};
  let unsubFirestore = null;

  const deliver = () => {
    const state = getLocalState();
    const merged = { ...(state.counselorSchedules || {}), ...firestoreMap };
    callback(Object.values(merged));
  };

  try {
    if (db) {
      const q = query(collection(db, 'counselorSchedules'));
      unsubFirestore = onSnapshot(
        q,
        snap => {
          firestoreMap = {};
          snap.docs.forEach(d => {
            firestoreMap[d.id] = d.data();
          });
          deliver();
        },
        err => {
          console.warn('subscribeAllCounselorSchedules onSnapshot err:', err);
          deliver();
        }
      );
    }
  } catch (e) {
    console.warn('subscribeAllCounselorSchedules exception:', e);
  }

  window.addEventListener('guidehub_data_changed', deliver);
  deliver();

  return () => {
    if (unsubFirestore) unsubFirestore();
    window.removeEventListener('guidehub_data_changed', deliver);
  };
}

export async function logAuditEvent(actorId, actorName, actorRole, action, details = '') {
  const logItem = {
    actorId: actorId || 'anonymous',
    actorName: actorName || 'System Actor',
    actorRole: actorRole || 'Unknown',
    action,
    details,
    timestamp: new Date().toISOString()
  };

  let id = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);

  try {
    if (db) {
      const docRef = doc(db, 'auditLogs', id);
      await setDoc(docRef, logItem);
    }
  } catch (err) {
    console.warn('Firestore logAuditEvent fallback:', err.message);
  }

  const state = getLocalState();
  if (!state.auditLogs) state.auditLogs = [];
  state.auditLogs.unshift({ id, ...logItem });
  if (state.auditLogs.length > 500) state.auditLogs = state.auditLogs.slice(0, 500);
  saveLocalState(state);
  return { id, ...logItem };
}

export function subscribeAuditLogs(callback) {
  try {
    if (db) {
      const q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'));
      const unsubscribe = onSnapshot(q, snap => {
        if (!snap.empty) {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          callback(list);
        } else {
          const state = getLocalState();
          const list = state.auditLogs || [];
          callback([...list]);
        }
      });
      return unsubscribe;
    }
  } catch (e) {
    console.warn('subscribeAuditLogs firestore exception', e);
  }

  const handler = () => {
    const state = getLocalState();
    const list = state.auditLogs || [];
    callback([...list]);
  };
  window.addEventListener('guidehub_data_changed', handler);
  handler();
  return () => window.removeEventListener('guidehub_data_changed', handler);
}

export function computeAnalyticsFromCollections(appointments = [], referrals = [], cases = [], walkins = []) {
  const cycleCounts = {
    'Pre-Exam Anxiety': 0,
    'During Exam': 0,
    'Post-Exam Distress / Shifting': 0,
    'Regular Period': 0
  };

  const categoryCounts = {
    'Academic Distress & Anxiety': 0,
    'Program Shifting / Career': 0,
    'Relationship & Personal': 0,
    'Special Learning Needs': 0,
    'Other / General Concern': 0
  };

  let completedCount = 0;
  let noShowCount = 0;
  let walkInCount = walkins.length;
  let scheduledCount = 0;

  appointments.forEach(a => {
    if (a.isWalkIn) walkInCount++;
    else scheduledCount++;

    if (a.status === 'Completed') completedCount++;
    if (a.status === 'No-Show') noShowCount++;

    const cycle = a.academicCycle || 'Regular Period';
    if (cycleCounts[cycle] !== undefined) cycleCounts[cycle]++;
    else cycleCounts['Regular Period']++;

    const cat = a.concernCategory || '';
    if (cat.includes('Academic') || cat.includes('Anxiety') || cat.includes('Coaching')) {
      categoryCounts['Academic Distress & Anxiety']++;
    } else if (cat.includes('Shifting') || cat.includes('Career')) {
      categoryCounts['Program Shifting / Career']++;
    } else if (cat.includes('Relationship') || cat.includes('Personal')) {
      categoryCounts['Relationship & Personal']++;
    } else if (cat.includes('Special') || cat.includes('Needs')) {
      categoryCounts['Special Learning Needs']++;
    } else {
      categoryCounts['Other / General Concern']++;
    }
  });

  walkins.forEach(w => {
    if (w.status === 'Completed') completedCount++;
  });

  let highRiskCases = 0;
  cases.forEach(c => {
    if (
      c.status === 'High Risk' ||
      (c.riskFlags && (c.riskFlags.selfHarm || c.riskFlags.abuseHarmFromOthers || c.riskFlags.threatToOthers))
    ) {
      highRiskCases++;
    }
  });

  const totalSessions = completedCount + noShowCount;
  const noShowRate = totalSessions > 0 ? ((noShowCount / totalSessions) * 100).toFixed(1) : '0.0';

  return {
    totalAppointments: appointments.length,
    completedSessions: completedCount,
    totalReferrals: referrals.length,
    highRiskCases,
    noShowRate: `${noShowRate}%`,
    walkInRatio: {
      walkIn: walkInCount,
      scheduled: scheduledCount
    },
    cycleTrends: cycleCounts,
    concernBreakdown: categoryCounts
  };
}

export function getAnalyticsDataset() {
  const state = getLocalState();
  return computeAnalyticsFromCollections(
    Object.values(state.appointments),
    Object.values(state.referrals),
    Object.values(state.cases),
    Object.values(state.walkinQueue)
  );
}

export function subscribeAnalyticsDataset(callback) {
  const state = getLocalState();
  let liveAppointments = Object.values(state.appointments);
  let liveReferrals = Object.values(state.referrals);
  let liveCases = Object.values(state.cases);
  let liveWalkins = Object.values(state.walkinQueue);

  const emit = () => {
    callback(computeAnalyticsFromCollections(liveAppointments, liveReferrals, liveCases, liveWalkins));
  };

  if (db) {
    const unsubs = [];
    try {
      unsubs.push(
        onSnapshot(collection(db, 'appointments'), snap => {
          if (!snap.empty) liveAppointments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          emit();
        })
      );
      unsubs.push(
        onSnapshot(collection(db, 'referrals'), snap => {
          if (!snap.empty) liveReferrals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          emit();
        })
      );
      unsubs.push(
        onSnapshot(collection(db, 'cases'), snap => {
          if (!snap.empty) liveCases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          emit();
        })
      );
      unsubs.push(
        onSnapshot(collection(db, 'walkin_queue'), snap => {
          if (!snap.empty) liveWalkins = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          emit();
        })
      );
      return () => unsubs.forEach(u => u && u());
    } catch (e) {
      console.warn('subscribeAnalyticsDataset fallback:', e.message);
    }
  }

  window.addEventListener('guidehub_data_changed', emit);
  emit();
  return () => window.removeEventListener('guidehub_data_changed', emit);
}
