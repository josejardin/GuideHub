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
import { getRoleCategory, formatTimeSlot12h, normalizeTimeSlot, isSamePersonName, normalizePersonName } from '../utils/validation.js';

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
    counselorLeaves: {},
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

export async function saveUserProfile(uid, data = {}) {
  const state = getLocalState();
  const existing = state.users[uid] || {};
  const category = getRoleCategory(data.role || existing.role || 'student');

  const profileData = {
    ...existing,
    ...data,
    uid,
    // Strictly preserve permanent credentials
    email: existing.email || data.email || '',
    studentOrEmpId: existing.studentOrEmpId || data.studentOrEmpId || '',
    role: existing.role || data.role || 'student',
    fullName: (data.fullName || existing.fullName || 'User').trim(),
    program: data.program || existing.program || 'General',
    yearLevel: data.yearLevel !== undefined ? data.yearLevel : (existing.yearLevel || ''),
    department: data.department !== undefined ? data.department : (existing.department || ''),
    subjectArea: data.subjectArea !== undefined ? data.subjectArea : (existing.subjectArea || ''),
    gender: data.gender || existing.gender || 'Prefer not to say',
    contactNumber: data.contactNumber !== undefined ? data.contactNumber : (existing.contactNumber || ''),
    updatedAt: new Date().toISOString()
  };

  try {
    if (db) {
      // Strictly store inside users/{category} -> [uid]: profile (NO nested users subcollection)
      await setDoc(doc(db, 'users', category), { [uid]: profileData, roleCategory: category }, { merge: true });
    }
  } catch (err) {
    console.warn('Firestore saveUserProfile fallback:', err.message);
  }

  state.users[uid] = profileData;
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
        const normTargetSlot = normalizeTimeSlot(timeSlot);
        activeApts = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(apt => normalizeTimeSlot(apt.timeSlot) === normTargetSlot && apt.status !== 'Cancelled' && apt.status !== 'No-Show');
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

    // Check scheduled multi-day leave/absence
    const leaves = Object.values(state.counselorLeaves || {}).filter(
      l => l && l.counselorId === cId && l.status !== 'Cancelled'
    );
    const isOnLeave = leaves.some(l => {
      if (l.dates && Array.isArray(l.dates)) return l.dates.includes(date);
      return l.startDate && l.endDate && date >= l.startDate && date <= l.endDate;
    });
    if (isOnLeave) return true;

    const normSlot = normalizeTimeSlot(timeSlot);
    const slot12h = formatTimeSlot12h(timeSlot);

    // 2. Local State Block Check using latest timestamp
    const scheds = Object.values(state.counselorSchedules || {}).filter(
      s => s && s.counselorId === cId && (s.dayOfWeek === dayOfWeek || s.date === date)
    );
    let latestSched = null;
    scheds.forEach(s => {
      if (normalizeTimeSlot(s.timeSlot) === normSlot || formatTimeSlot12h(s.timeSlot) === slot12h) {
        if (!latestSched || new Date(s.updatedAt || 0) >= new Date(latestSched.updatedAt || 0)) {
          latestSched = s;
        }
      }
    });

    if (latestSched !== null) {
      if (latestSched.isBlocked === true) return true;
    }

    // 3. Firestore Block Check
    if (db) {
      try {
        if (dayOfWeek) {
          const daySnap = await getDoc(doc(db, 'counselorSchedules', `${cId}_${dayOfWeek}_${normSlot}`));
          if (daySnap.exists()) return daySnap.data().isBlocked === true;

          const daySnap12 = await getDoc(doc(db, 'counselorSchedules', `${cId}_${dayOfWeek}_${slot12h}`));
          if (daySnap12.exists()) return daySnap12.data().isBlocked === true;
        }
        if (date) {
          const dateSnap = await getDoc(doc(db, 'counselorSchedules', `${cId}_${date}_${normSlot}`));
          if (dateSnap.exists()) return dateSnap.data().isBlocked === true;
        }
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
  const cleanNum = (studentNumber || 'unknown').trim();
  const cleanName = (studentName || '').trim();

  let existingCase = null;

  try {
    if (db) {
      // 1. Fetch all cases from Firestore to perform robust automatic name & ID matching
      const snap = await getDocs(collection(db, 'cases'));
      if (!snap.empty) {
        const allList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Match by student name (handles case-insensitivity, shifted ID, missing/middle names)
        if (cleanName && cleanName !== 'Student') {
          existingCase = allList.find(c => isSamePersonName(c.studentName, cleanName));
        }
        // Fallback match by current student number or previous student numbers
        if (!existingCase && cleanNum && cleanNum !== 'unknown') {
          existingCase = allList.find(
            c =>
              (c.studentNumber && c.studentNumber.toLowerCase() === cleanNum.toLowerCase()) ||
              ((c.previousStudentNumbers || []).some(pn => String(pn).toLowerCase() === cleanNum.toLowerCase()))
          );
        }
      }
    }
  } catch (err) {
    console.warn('Firestore getOrCreateCase lookup notice:', err.message);
  }

  // Check local state fallback
  if (!existingCase) {
    const state = getLocalState();
    const localList = Object.values(state.cases || {});
    if (cleanName && cleanName !== 'Student') {
      existingCase = localList.find(c => isSamePersonName(c.studentName, cleanName));
    }
    if (!existingCase && cleanNum && cleanNum !== 'unknown') {
      existingCase = localList.find(
        c =>
          (c.studentNumber && c.studentNumber.toLowerCase() === cleanNum.toLowerCase()) ||
          ((c.previousStudentNumbers || []).some(pn => String(pn).toLowerCase() === cleanNum.toLowerCase()))
      );
    }
  }

  // If existing case is found: automatic match without manual linking!
  if (existingCase) {
    const caseId = existingCase.id;
    const updates = { updatedAt: new Date().toISOString() };
    let hasUpdates = false;

    // Track previous student number if student has shifted or changed ID number
    if (cleanNum && cleanNum !== 'unknown' && cleanNum !== existingCase.studentNumber) {
      const prevNumbers = new Set(existingCase.previousStudentNumbers || []);
      if (existingCase.studentNumber && existingCase.studentNumber !== 'unknown') {
        prevNumbers.add(existingCase.studentNumber);
      }
      existingCase.previousStudentNumbers = Array.from(prevNumbers);
      existingCase.studentNumber = cleanNum;
      updates.previousStudentNumbers = existingCase.previousStudentNumbers;
      updates.studentNumber = cleanNum;
      hasUpdates = true;
    }

    if (program && program !== existingCase.program && program !== 'Student' && program !== 'N/A') {
      existingCase.program = program;
      updates.program = program;
      hasUpdates = true;
    }

    if (cleanName && cleanName !== 'Student' && cleanName !== existingCase.studentName) {
      existingCase.studentName = cleanName;
      updates.studentName = cleanName;
      hasUpdates = true;
    }

    if (hasUpdates) {
      try {
        if (db) {
          await setDoc(doc(db, 'cases', caseId), updates, { merge: true });
        }
      } catch (e) {
        console.warn('Firestore case update fallback notice:', e.message);
      }
      const state = getLocalState();
      state.cases[caseId] = { ...existingCase, ...updates };
      saveLocalState(state);
    }

    return existingCase;
  }

  // Create new case if none exists
  const cleanIdKey = cleanName
    ? 'case_' + cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_')
    : 'case_' + cleanNum.replace(/[^a-zA-Z0-9]/g, '_');

  const newCase = {
    studentNumber: cleanNum,
    studentName: cleanName || 'Student',
    program: program || 'General',
    assignedCounselorId: counselorId,
    status: 'Active',
    riskFlags: {
      selfHarm: false,
      abuseHarmFromOthers: false,
      threatToOthers: false
    },
    category: 'General Counseling',
    previousStudentNumbers: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    if (db) {
      const caseRef = doc(db, 'cases', cleanIdKey);
      await setDoc(caseRef, newCase, { merge: true });
    }
  } catch (err) {
    console.warn('Firestore getOrCreateCase fallback:', err.message);
  }

  const state = getLocalState();
  state.cases[cleanIdKey] = { id: cleanIdKey, ...newCase };
  saveLocalState(state);
  return { id: cleanIdKey, ...newCase };
}

export function subscribeAllCases(callback) {
  function deduplicateCasesByName(rawList) {
    const merged = [];
    for (const c of rawList) {
      const existing = merged.find(m => isSamePersonName(m.studentName, c.studentName));
      if (!existing) {
        merged.push({ ...c });
      } else {
        const allPrev = new Set([
          ...(existing.previousStudentNumbers || []),
          ...(c.previousStudentNumbers || [])
        ]);
        if (c.studentNumber && c.studentNumber !== existing.studentNumber) {
          allPrev.add(c.studentNumber);
        }
        existing.previousStudentNumbers = Array.from(allPrev);
        if (new Date(c.updatedAt || c.createdAt) > new Date(existing.updatedAt || existing.createdAt)) {
          existing.status = c.status || existing.status;
          existing.program = c.program || existing.program;
          existing.studentNumber = c.studentNumber || existing.studentNumber;
        }
      }
    }
    return merged;
  }

  try {
    if (db) {
      const q = query(collection(db, 'cases'));
      const unsubscribe = onSnapshot(q, snap => {
        let list = [];
        if (!snap.empty) {
          list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } else {
          const state = getLocalState();
          list = Object.values(state.cases || {});
        }
        const deduped = deduplicateCasesByName(list);
        deduped.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
        callback(deduped);
      });
      return unsubscribe;
    }
  } catch (e) {
    console.warn('subscribeAllCases firestore exception', e);
  }

  const handler = () => {
    const state = getLocalState();
    const list = Object.values(state.cases || {});
    const deduped = deduplicateCasesByName(list);
    deduped.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    callback(deduped);
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
  const fetchAndMergeNotes = async (directList = []) => {
    const state = getLocalState();
    const currentCase = state.cases[caseId] || {};
    const linkedCaseIds = currentCase.linkedCaseIds || [];

    const merged = directList.map(n => ({ ...n, isLinkedRecord: false }));

    if (linkedCaseIds.length > 0) {
      for (const lId of linkedCaseIds) {
        const linkedCase = state.cases[lId] || {};
        const linkedInfo = (currentCase.linkedCasesInfo || []).find(i => i.caseId === lId) || {};
        let lNotes = [];

        if (db) {
          try {
            const lSnap = await getDocs(query(collection(db, 'cases', lId, 'notes'), orderBy('createdAt', 'desc')));
            if (!lSnap.empty) {
              lNotes = lSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            }
          } catch (e) {}
        }
        if (lNotes.length === 0) {
          lNotes = state.caseNotes[lId] || [];
        }

        lNotes.forEach(note => {
          merged.push({
            ...note,
            isLinkedRecord: true,
            sourceStudentNumber: linkedInfo.studentNumber || linkedCase.studentNumber || 'Previous ID',
            sourceProgram: linkedInfo.program || linkedCase.program || 'Previous Program'
          });
        });
      }
    }

    merged.sort((a, b) => new Date(b.createdAt || b.sessionDate || 0) - new Date(a.createdAt || a.sessionDate || 0));
    return merged;
  };

  try {
    if (db) {
      const q = query(collection(db, 'cases', caseId, 'notes'), orderBy('createdAt', 'desc'));
      const unsubscribe = onSnapshot(q, async snap => {
        let directList = [];
        if (!snap.empty) {
          directList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } else {
          const state = getLocalState();
          directList = state.caseNotes[caseId] || [];
        }
        const fullNotes = await fetchAndMergeNotes(directList);
        callback(fullNotes);
      });
      return unsubscribe;
    }
  } catch (e) {
    console.warn('subscribeCaseNotes firestore exception', e);
  }

  const handler = async () => {
    const state = getLocalState();
    const directList = state.caseNotes[caseId] || [];
    const fullNotes = await fetchAndMergeNotes(directList);
    callback(fullNotes);
  };
  window.addEventListener('guidehub_data_changed', handler);
  handler();
  return () => window.removeEventListener('guidehub_data_changed', handler);
}

export async function linkPreviousCase(currentCaseId, previousStudentNumberOrCaseId, counselorUid = '', counselorName = '') {
  const state = getLocalState();
  let currentCase = state.cases[currentCaseId];
  if (!currentCase && db) {
    try {
      const cSnap = await getDoc(doc(db, 'cases', currentCaseId));
      if (cSnap.exists()) {
        currentCase = { id: cSnap.id, ...cSnap.data() };
      }
    } catch (e) {}
  }
  if (!currentCase) {
    throw new Error('Target active case folder not found.');
  }

  const cleanQuery = (previousStudentNumberOrCaseId || '').trim();
  if (!cleanQuery) {
    throw new Error('Please enter a valid previous Student ID number.');
  }

  const queryLower = cleanQuery.toLowerCase();
  const normalizedQueryId = 'case_' + cleanQuery.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

  let prevCase = Object.values(state.cases).find(
    c => (c.id || '').toLowerCase() === queryLower ||
         (c.studentNumber || '').trim().toLowerCase() === queryLower ||
         (c.id || '').toLowerCase() === normalizedQueryId
  );

  if (!prevCase && db) {
    try {
      const snapDirect = await getDoc(doc(db, 'cases', cleanQuery));
      if (snapDirect.exists()) {
        prevCase = { id: snapDirect.id, ...snapDirect.data() };
      } else {
        const snapNorm = await getDoc(doc(db, 'cases', 'case_' + cleanQuery.replace(/[^a-zA-Z0-9]/g, '_')));
        if (snapNorm.exists()) {
          prevCase = { id: snapNorm.id, ...snapNorm.data() };
        } else {
          const qPrev = query(collection(db, 'cases'), where('studentNumber', '==', cleanQuery));
          const qSnap = await getDocs(qPrev);
          if (!qSnap.empty) {
            prevCase = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
          }
        }
      }
    } catch (e) {
      console.warn('Firestore previous case query:', e.message);
    }
  }

  if (!prevCase) {
    throw new Error(`Previous case record for "${cleanQuery}" was not found in the confidential case directory.`);
  }

  if (prevCase.id === currentCase.id || prevCase.studentNumber === currentCase.studentNumber) {
    throw new Error('Cannot link a student case folder to itself.');
  }

  currentCase.linkedCaseIds = currentCase.linkedCaseIds || [];
  currentCase.previousStudentNumbers = currentCase.previousStudentNumbers || [];
  currentCase.linkedCasesInfo = currentCase.linkedCasesInfo || [];

  if (currentCase.linkedCaseIds.includes(prevCase.id) || currentCase.previousStudentNumbers.includes(prevCase.studentNumber)) {
    throw new Error(`Student ID ${prevCase.studentNumber} is already linked to this case folder.`);
  }

  currentCase.linkedCaseIds.push(prevCase.id);
  currentCase.previousStudentNumbers.push(prevCase.studentNumber);
  currentCase.linkedCasesInfo.push({
    caseId: prevCase.id,
    studentNumber: prevCase.studentNumber,
    studentName: prevCase.studentName,
    program: prevCase.program || 'Previous Program',
    linkedAt: new Date().toISOString(),
    linkedBy: counselorName || counselorUid || 'Guidance Counselor'
  });
  currentCase.updatedAt = new Date().toISOString();

  // Mark previous case as closed/transferred to prevent orphaned active cases
  prevCase.transferredToCaseId = currentCase.id;
  prevCase.transferredToStudentNumber = currentCase.studentNumber;
  prevCase.status = 'Closed';
  prevCase.updatedAt = new Date().toISOString();

  if (db) {
    try {
      await setDoc(doc(db, 'cases', currentCase.id), {
        linkedCaseIds: currentCase.linkedCaseIds,
        previousStudentNumbers: currentCase.previousStudentNumbers,
        linkedCasesInfo: currentCase.linkedCasesInfo,
        updatedAt: currentCase.updatedAt
      }, { merge: true });

      await setDoc(doc(db, 'cases', prevCase.id), {
        transferredToCaseId: currentCase.id,
        transferredToStudentNumber: currentCase.studentNumber,
        status: 'Closed',
        updatedAt: prevCase.updatedAt
      }, { merge: true });
    } catch (err) {
      console.warn('Firestore linkPreviousCase fallback:', err.message);
    }
  }

  state.cases[currentCase.id] = currentCase;
  state.cases[prevCase.id] = prevCase;
  saveLocalState(state);

  await logAuditEvent(
    counselorUid || 'counselor',
    counselorName || 'Guidance Counselor',
    'counselor',
    'CASE_LINKED',
    `Linked past records from ${prevCase.studentNumber} (${prevCase.program}) to active case ${currentCase.studentNumber} (${currentCase.program})`
  ).catch(() => {});

  window.dispatchEvent(new CustomEvent('guidehub_data_changed'));
  return { success: true, linkedCase: prevCase };
}

export async function unlinkPreviousCase(currentCaseId, previousStudentNumber, counselorUid = '', counselorName = '') {
  const state = getLocalState();
  const currentCase = state.cases[currentCaseId];
  if (!currentCase) throw new Error('Active case not found.');

  const targetLinkedInfo = (currentCase.linkedCasesInfo || []).find(i => i.studentNumber === previousStudentNumber);
  const targetCaseId = targetLinkedInfo ? targetLinkedInfo.caseId : null;

  currentCase.linkedCaseIds = (currentCase.linkedCaseIds || []).filter(id => id !== targetCaseId);
  currentCase.previousStudentNumbers = (currentCase.previousStudentNumbers || []).filter(num => num !== previousStudentNumber);
  currentCase.linkedCasesInfo = (currentCase.linkedCasesInfo || []).filter(info => info.studentNumber !== previousStudentNumber);
  currentCase.updatedAt = new Date().toISOString();

  if (db) {
    try {
      await setDoc(doc(db, 'cases', currentCase.id), {
        linkedCaseIds: currentCase.linkedCaseIds,
        previousStudentNumbers: currentCase.previousStudentNumbers,
        linkedCasesInfo: currentCase.linkedCasesInfo,
        updatedAt: currentCase.updatedAt
      }, { merge: true });
    } catch (e) {}
  }

  state.cases[currentCase.id] = currentCase;
  saveLocalState(state);

  await logAuditEvent(
    counselorUid || 'counselor',
    counselorName || 'Guidance Counselor',
    'counselor',
    'CASE_UNLINKED',
    `Unlinked past record ${previousStudentNumber} from case ${currentCase.studentNumber}`
  ).catch(() => {});

  window.dispatchEvent(new CustomEvent('guidehub_data_changed'));
  return { success: true };
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

export async function updateCaseStatus(caseId, status, extra = {}) {
  try {
    if (db) {
      const caseRef = doc(db, 'cases', caseId);
      await setDoc(caseRef, { status, ...extra, updatedAt: new Date().toISOString() }, { merge: true });
    }
  } catch (err) {
    console.warn('Firestore updateCaseStatus fallback:', err.message);
  }

  const state = getLocalState();
  if (state.cases[caseId]) {
    state.cases[caseId].status = status;
    Object.assign(state.cases[caseId], extra);
    state.cases[caseId].updatedAt = new Date().toISOString();
    saveLocalState(state);
  }
}

export async function getCounselorBlockedSlots(counselorId) {
  let allRecords = [];
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
        allRecords = snap.docs.map(d => d.data());
      }
    }
  } catch (err) {
    console.warn('Firestore getCounselorBlockedSlots fallback:', err.message);
  }

  const state = getLocalState();
  const localList = Object.values(state.counselorSchedules || {}).filter(s => s && s.counselorId === counselorId);
  const combined = [...localList, ...allRecords];

  // Deduplicate by dayOfWeek + normalizeTimeSlot(timeSlot), taking the record with the newest updatedAt
  const slotMap = new Map();
  combined.forEach(rec => {
    if (!rec || !rec.dayOfWeek || !rec.timeSlot) return;
    const norm = normalizeTimeSlot(rec.timeSlot);
    const key = `${rec.dayOfWeek}_${norm}`;
    const existing = slotMap.get(key);
    if (!existing || new Date(rec.updatedAt || 0) >= new Date(existing.updatedAt || 0)) {
      slotMap.set(key, rec);
    }
  });

  return Array.from(slotMap.values()).filter(s => s.isBlocked === true);
}

export async function toggleCounselorBlockedSlot(counselorId, dayOfWeek, timeSlot, isBlocked) {
  const normSlot = normalizeTimeSlot(timeSlot);
  const slot12h = formatTimeSlot12h(timeSlot);
  const nowIso = new Date().toISOString();

  const slotVariants = Array.from(
    new Set([
      timeSlot,
      normSlot,
      slot12h,
      timeSlot.replace(/\s+/g, ''),
      normSlot.replace(/\s+/g, ''),
      slot12h.replace(/\s+/g, '')
    ].filter(Boolean))
  );

  const canonicalKey = `${counselorId}_${dayOfWeek}_${normSlot || timeSlot}`;
  const key12h = `${counselorId}_${dayOfWeek}_${slot12h || timeSlot}`;
  const record = {
    counselorId,
    dayOfWeek,
    timeSlot: normSlot || timeSlot,
    timeSlot12h: slot12h,
    isBlocked: !!isBlocked,
    updatedAt: nowIso
  };

  const state = getLocalState();
  if (!state.counselorSchedules) state.counselorSchedules = {};

  // Clean and synchronize all matching keys in local state
  Object.keys(state.counselorSchedules).forEach(k => {
    const s = state.counselorSchedules[k];
    if (s && s.counselorId === counselorId && s.dayOfWeek === dayOfWeek) {
      const sNorm = normalizeTimeSlot(s.timeSlot || '');
      const s12 = formatTimeSlot12h(s.timeSlot || '');
      if (sNorm === normSlot || s12 === slot12h || slotVariants.includes(s.timeSlot)) {
        s.isBlocked = !!isBlocked;
        s.updatedAt = nowIso;
      }
    }
  });

  state.counselorSchedules[canonicalKey] = record;
  state.counselorSchedules[key12h] = { ...record, timeSlot: slot12h };
  saveLocalState(state);

  try {
    if (db) {
      const schedRef = doc(db, 'counselorSchedules', canonicalKey);
      await setDoc(schedRef, record, { merge: true });

      if (key12h !== canonicalKey) {
        const sched12Ref = doc(db, 'counselorSchedules', key12h);
        await setDoc(sched12Ref, { ...record, timeSlot: slot12h }, { merge: true });
      }

      // Synchronize any existing Firestore variant documents for this counselor & day
      try {
        const q = query(
          collection(db, 'counselorSchedules'),
          where('counselorId', '==', counselorId),
          where('dayOfWeek', '==', dayOfWeek)
        );
        const snap = await getDocs(q);
        const updates = [];
        snap.forEach(d => {
          const dData = d.data();
          const dNorm = normalizeTimeSlot(dData.timeSlot || '');
          const d12 = formatTimeSlot12h(dData.timeSlot || '');
          if (dNorm === normSlot || d12 === slot12h || slotVariants.includes(dData.timeSlot)) {
            if (d.id !== canonicalKey && d.id !== key12h) {
              updates.push(
                setDoc(doc(db, 'counselorSchedules', d.id), {
                  isBlocked: !!isBlocked,
                  updatedAt: nowIso
                }, { merge: true })
              );
            }
          }
        });
        if (updates.length > 0) {
          await Promise.allSettled(updates);
        }
      } catch (scanErr) {
        console.warn('Firestore variant sync warning:', scanErr.message);
      }
    }
  } catch (err) {
    console.warn('Firestore toggleCounselorBlockedSlot fallback:', err.message);
  }

  return record;
}

export function subscribeAllCounselorSchedules(callback) {
  let firestoreMap = {};
  let unsubFirestore = null;

  const deliver = () => {
    const state = getLocalState();
    const merged = { ...(state.counselorSchedules || {}), ...firestoreMap };
    const slotMap = new Map();
    Object.values(merged).forEach(rec => {
      if (!rec || !rec.counselorId || !rec.dayOfWeek || !rec.timeSlot) return;
      const norm = normalizeTimeSlot(rec.timeSlot);
      const key = `${rec.counselorId}_${rec.dayOfWeek}_${norm}`;
      const existing = slotMap.get(key);
      if (!existing || new Date(rec.updatedAt || 0) >= new Date(existing.updatedAt || 0)) {
        slotMap.set(key, rec);
      }
    });
    callback(Array.from(slotMap.values()));
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

export function getBusinessDatesInRange(startDateStr, endDateStr) {
  const dates = [];
  if (!startDateStr || !endDateStr) return dates;
  let curr = new Date(startDateStr + 'T00:00:00');
  const end = new Date(endDateStr + 'T00:00:00');
  if (isNaN(curr.getTime()) || isNaN(end.getTime()) || curr > end) return dates;

  while (curr <= end) {
    const day = curr.getDay();
    if (day !== 0 && day !== 6) {
      // Monday to Friday
      const y = curr.getFullYear();
      const m = String(curr.getMonth() + 1).padStart(2, '0');
      const d = String(curr.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
    }
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

export async function blockCounselorLeave(counselorId, counselorName, leaveData) {
  const dates = getBusinessDatesInRange(leaveData.startDate, leaveData.endDate);
  if (dates.length === 0) {
    throw new Error('Please select valid dates that include regular weekdays (Monday to Friday).');
  }

  const leaveId = 'leave_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  const nowIso = new Date().toISOString();

  const leaveRecord = {
    id: leaveId,
    counselorId,
    counselorName: counselorName || 'Guidance Counselor',
    leaveType: leaveData.leaveType || 'Scheduled Leave',
    startDate: leaveData.startDate,
    endDate: leaveData.endDate,
    dates,
    totalDays: dates.length,
    remarks: leaveData.remarks || '',
    status: 'Active',
    createdAt: nowIso,
    updatedAt: nowIso
  };

  const state = getLocalState();
  if (!state.counselorLeaves) state.counselorLeaves = {};
  if (!state.counselorSchedules) state.counselorSchedules = {};

  state.counselorLeaves[leaveId] = leaveRecord;

  // Block all consultation slots for every date in range
  const standardSlots = [
    '08:00 - 09:00',
    '09:00 - 10:00',
    '10:00 - 11:00',
    '11:00 - 12:00',
    '13:00 - 14:00',
    '14:00 - 15:00',
    '15:00 - 16:00',
    '16:00 - 17:00'
  ];

  const scheduleUpdates = [];
  dates.forEach(d => {
    standardSlots.forEach(slot => {
      const slot12 = formatTimeSlot12h(slot);
      const canonicalKey = `${counselorId}_${d}_${slot}`;
      const key12 = `${counselorId}_${d}_${slot12}`;
      const schedRec = {
        counselorId,
        date: d,
        timeSlot: slot,
        timeSlot12h: slot12,
        isBlocked: true,
        leaveId,
        leaveType: leaveRecord.leaveType,
        updatedAt: nowIso
      };
      state.counselorSchedules[canonicalKey] = schedRec;
      state.counselorSchedules[key12] = { ...schedRec, timeSlot: slot12 };
      scheduleUpdates.push(schedRec);
    });
  });

  saveLocalState(state);

  // Firestore sync
  try {
    if (db) {
      await setDoc(doc(db, 'counselorLeaves', leaveId), leaveRecord);
      const batchPromises = scheduleUpdates.map(sr => {
        const cKey = `${sr.counselorId}_${sr.date}_${sr.timeSlot}`;
        return setDoc(doc(db, 'counselorSchedules', cKey), sr, { merge: true });
      });
      await Promise.allSettled(batchPromises);
    }
  } catch (err) {
    console.warn('Firestore blockCounselorLeave fallback:', err.message);
  }

  return leaveRecord;
}

export async function unblockCounselorLeave(counselorId, leaveId, actorName = 'Counselor') {
  const state = getLocalState();
  const leave = (state.counselorLeaves || {})[leaveId];
  const nowIso = new Date().toISOString();

  if (leave) {
    leave.status = 'Cancelled';
    leave.updatedAt = nowIso;
    leave.cancelledAt = nowIso;
    leave.cancelledBy = actorName;
  }

  // Unblock all date-slot records associated with this leaveId
  const schedUpdates = [];
  if (state.counselorSchedules) {
    Object.keys(state.counselorSchedules).forEach(k => {
      const s = state.counselorSchedules[k];
      if (s && s.counselorId === counselorId) {
        if (s.leaveId === leaveId || (leave && leave.dates && leave.dates.includes(s.date))) {
          s.isBlocked = false;
          s.updatedAt = nowIso;
          schedUpdates.push({ key: k, record: s });
        }
      }
    });
  }

  saveLocalState(state);

  try {
    if (db) {
      if (leave) {
        await setDoc(
          doc(db, 'counselorLeaves', leaveId),
          {
            status: 'Cancelled',
            cancelledAt: nowIso,
            cancelledBy: actorName,
            updatedAt: nowIso
          },
          { merge: true }
        );
      }
      const batchPromises = schedUpdates.map(u => {
        return setDoc(
          doc(db, 'counselorSchedules', u.key),
          {
            isBlocked: false,
            updatedAt: nowIso
          },
          { merge: true }
        );
      });
      await Promise.allSettled(batchPromises);
    }
  } catch (err) {
    console.warn('Firestore unblockCounselorLeave fallback:', err.message);
  }

  return leave;
}

export async function getCounselorLeaves(counselorId) {
  let allLeaves = [];
  try {
    if (db && counselorId) {
      const q = query(collection(db, 'counselorLeaves'), where('counselorId', '==', counselorId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const state = getLocalState();
        if (!state.counselorLeaves) state.counselorLeaves = {};
        snap.docs.forEach(d => {
          state.counselorLeaves[d.id] = d.data();
        });
        try {
          localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(state));
        } catch (e) {}
        allLeaves = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    }
  } catch (err) {
    console.warn('Firestore getCounselorLeaves fallback:', err.message);
  }

  if (allLeaves.length === 0) {
    const state = getLocalState();
    allLeaves = Object.values(state.counselorLeaves || {}).filter(l => l && l.counselorId === counselorId);
  }

  return allLeaves.filter(l => l.status !== 'Cancelled');
}

export function subscribeCounselorLeaves(counselorId, callback) {
  let unsubFirestore = null;
  const deliver = () => {
    const state = getLocalState();
    const list = Object.values(state.counselorLeaves || {}).filter(
      l => l && l.counselorId === counselorId && l.status !== 'Cancelled'
    );
    list.sort((a, b) => new Date(b.startDate || b.createdAt) - new Date(a.startDate || a.createdAt));
    callback(list);
  };

  try {
    if (db && counselorId) {
      const q = query(collection(db, 'counselorLeaves'), where('counselorId', '==', counselorId));
      unsubFirestore = onSnapshot(
        q,
        snap => {
          const state = getLocalState();
          if (!state.counselorLeaves) state.counselorLeaves = {};
          snap.docs.forEach(d => {
            state.counselorLeaves[d.id] = d.data();
          });
          deliver();
        },
        err => {
          console.warn('subscribeCounselorLeaves snapshot err:', err);
          deliver();
        }
      );
    }
  } catch (e) {
    console.warn('subscribeCounselorLeaves exception:', e);
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
