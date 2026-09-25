import {
  db,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
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
      // 1. Direct root lookup (handles bridge docs and canonicalDocId)
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data.canonicalDocId) {
          const canonicalSnap = await getDoc(doc(db, 'users', data.canonicalDocId));
          if (canonicalSnap.exists()) {
            return { uid: canonicalSnap.id, ...canonicalSnap.data() };
          }
        }
        // If not a container category doc, return it
        if (data.email || data.fullName) {
          return { uid: snap.id, ...data };
        }
      }

      // 2. Direct lookup across category subcollections: users/{cat}/users/{uid}
      const categories = ['students', 'counselors', 'faculty', 'head', 'admin'];
      for (const cat of categories) {
        try {
          const catDocRef = doc(db, 'users', cat, 'users', uid);
          const catSnap = await getDoc(catDocRef);
          if (catSnap.exists()) {
            return { uid: catSnap.id, ...catSnap.data() };
          }
        } catch (e) {}
      }

      // 3. Direct lookup across root role collections: {cat}/{uid}
      for (const cat of categories) {
        try {
          const catDocRef = doc(db, cat, uid);
          const catSnap = await getDoc(catDocRef);
          if (catSnap.exists()) {
            return { uid: catSnap.id, ...catSnap.data() };
          }
        } catch (e) {}
      }

      // 4. Check role document maps: users/{cat} contains [uid]
      for (const cat of categories) {
        try {
          const catDocRef = doc(db, 'users', cat);
          const catSnap = await getDoc(catDocRef);
          if (catSnap.exists()) {
            const catData = catSnap.data();
            if (catData[uid] && typeof catData[uid] === 'object') {
              return { uid, ...catData[uid] };
            }
          }
        } catch (e) {}
      }

      // 5. Query root users collection by authUid
      const qAuth = query(collection(db, 'users'), where('authUid', '==', uid));
      const authSnap = await getDocs(qAuth);
      if (!authSnap.empty) {
        return { uid: authSnap.docs[0].id, ...authSnap.docs[0].data() };
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
      // 1. Role document map field: users/{category} -> [uid]: profile
      await setDoc(doc(db, 'users', category), { [uid]: profileData }, { merge: true });

      // 2. Role subcollection: users/{category}/users/{uid}
      await setDoc(doc(db, 'users', category, 'users', uid), profileData, { merge: true });

      // 3. Root users document: users/{uid}
      await setDoc(doc(db, 'users', uid), profileData, { merge: true });

      // 4. Role collection at root: {category}/{uid}
      await setDoc(doc(db, category, uid), profileData, { merge: true });
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
      const categories = ['students', 'counselors', 'faculty', 'head', 'admin'];

      // Read root users collection (skip category container docs)
      try {
        const rootSnap = await getDocs(collection(db, 'users'));
        rootSnap.forEach(d => {
          if (!categories.includes(d.id)) {
            const data = d.data();
            if (data.email || data.fullName) {
              usersMap.set(d.id, { uid: d.id, ...data });
            }
          }
        });
      } catch (e) {}

      // Read from all category subcollections
      await Promise.all(
        categories.map(async cat => {
          try {
            const snap = await getDocs(collection(db, 'users', cat, 'users'));
            snap.forEach(d => usersMap.set(d.id, { uid: d.id, ...d.data() }));
          } catch (e) {}
        })
      );

      // Read from role doc maps
      await Promise.all(
        categories.map(async cat => {
          try {
            const snap = await getDoc(doc(db, 'users', cat));
            if (snap.exists()) {
              const data = snap.data();
              for (const [key, val] of Object.entries(data)) {
                if (val && typeof val === 'object' && val.email && !usersMap.has(key)) {
                  usersMap.set(key, { uid: key, ...val });
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
      const category = getRoleCategory(newRole);
      // Update in root
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, { role: newRole }).catch(() => {});

      // Update in category subcollection if present
      const categories = ['students', 'counselors', 'faculty', 'head', 'admin'];
      for (const cat of categories) {
        try {
          const catRef = doc(db, 'users', cat, 'users', uid);
          const snap = await getDoc(catRef);
          if (snap.exists()) {
            await updateDoc(catRef, { role: newRole });
            break;
          }
        } catch (e) {}
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
    studentName: data.studentName,
    studentNumber: data.studentNumber,
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

export function subscribeStudentAppointments(studentId, callback) {
  try {
    if (db) {
      const q = query(collection(db, 'appointments'), where('studentId', '==', studentId));
      const unsubscribe = onSnapshot(
        q,
        snap => {
          if (!snap.empty) {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            list.sort(
              (a, b) =>
                new Date(b.date + ' ' + (b.timeSlot || '00:00')) - new Date(a.date + ' ' + (a.timeSlot || '00:00'))
            );
            callback(list);
          } else {
            const state = getLocalState();
            const list = Object.values(state.appointments).filter(a => a.studentId === studentId);
            list.sort(
              (a, b) =>
                new Date(b.date + ' ' + (b.timeSlot || '00:00')) - new Date(a.date + ' ' + (a.timeSlot || '00:00'))
            );
            callback(list);
          }
        },
        err => {
          console.warn('Snapshot error student appointments:', err);
        }
      );
      return unsubscribe;
    }
  } catch (e) {
    console.warn('subscribeStudentAppointments firestore exception', e);
  }

  const handler = () => {
    const state = getLocalState();
    const list = Object.values(state.appointments).filter(a => a.studentId === studentId);
    list.sort(
      (a, b) => new Date(b.date + ' ' + (b.timeSlot || '00:00')) - new Date(a.date + ' ' + (a.timeSlot || '00:00'))
    );
    callback(list);
  };
  window.addEventListener('guidehub_data_changed', handler);
  handler();
  return () => window.removeEventListener('guidehub_data_changed', handler);
}

export function subscribeAllAppointments(callback) {
  try {
    if (db) {
      const q = query(collection(db, 'appointments'));
      const unsubscribe = onSnapshot(q, snap => {
        if (!snap.empty) {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          list.sort(
            (a, b) =>
              new Date(b.date + ' ' + (b.timeSlot || '00:00')) - new Date(a.date + ' ' + (a.timeSlot || '00:00'))
          );
          callback(list);
        } else {
          const state = getLocalState();
          const list = Object.values(state.appointments);
          list.sort(
            (a, b) =>
              new Date(b.date + ' ' + (b.timeSlot || '00:00')) - new Date(a.date + ' ' + (a.timeSlot || '00:00'))
          );
          callback(list);
        }
      });
      return unsubscribe;
    }
  } catch (e) {
    console.warn('subscribeAllAppointments firestore exception', e);
  }

  const handler = () => {
    const state = getLocalState();
    const list = Object.values(state.appointments);
    list.sort(
      (a, b) => new Date(b.date + ' ' + (b.timeSlot || '00:00')) - new Date(a.date + ' ' + (a.timeSlot || '00:00'))
    );
    callback(list);
  };
  window.addEventListener('guidehub_data_changed', handler);
  handler();
  return () => window.removeEventListener('guidehub_data_changed', handler);
}

export async function updateAppointmentStatus(appointmentId, status, extraFields = {}) {
  try {
    if (db) {
      const aptRef = doc(db, 'appointments', appointmentId);
      await updateDoc(aptRef, { status, ...extraFields, updatedAt: new Date().toISOString() });
    }
  } catch (err) {
    console.warn('Firestore updateAppointmentStatus fallback:', err.message);
  }

  const state = getLocalState();
  if (state.appointments[appointmentId]) {
    state.appointments[appointmentId] = {
      ...state.appointments[appointmentId],
      status,
      ...extraFields,
      updatedAt: new Date().toISOString()
    };
    saveLocalState(state);
  }
}

export async function checkSlotAvailable(date, timeSlot, counselorId = 'any') {
  const state = getLocalState();
  const activeApts = Object.values(state.appointments).filter(
    apt => apt.date === date && apt.timeSlot === timeSlot && apt.status !== 'Cancelled' && apt.status !== 'No-Show'
  );

  if (counselorId && counselorId !== 'any') {
    const hasCollision = activeApts.some(apt => apt.counselorId === counselorId || apt.counselorId === 'any');
    const isBlocked = (state.counselorSchedules[`${counselorId}_${date}_${timeSlot}`] || {}).isBlocked;
    return !hasCollision && !isBlocked;
  }

  return activeApts.length < 4;
}

export async function generateWalkInTicket(studentData) {
  const today = new Date().toISOString().split('T')[0];
  const state = getLocalState();

  const todayTickets = Object.values(state.walkinQueue).filter(t => t.date === today);
  const queueSeq = todayTickets.length + 101;
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

  let id = 'case_' + studentNumber.replace(/[^a-zA-Z0-9]/g, '_');

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

export function getAnalyticsDataset() {
  const state = getLocalState();
  const appointments = Object.values(state.appointments);
  const referrals = Object.values(state.referrals);
  const cases = Object.values(state.cases);
  const walkins = Object.values(state.walkinQueue);

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
    if (cat.includes('Academic') || cat.includes('Anxiety')) categoryCounts['Academic Distress & Anxiety']++;
    else if (cat.includes('Shifting') || cat.includes('Career')) categoryCounts['Program Shifting / Career']++;
    else if (cat.includes('Relationship') || cat.includes('Personal')) categoryCounts['Relationship & Personal']++;
    else if (cat.includes('Special') || cat.includes('Needs')) categoryCounts['Special Learning Needs']++;
    else categoryCounts['Other / General Concern']++;
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
