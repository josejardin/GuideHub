import {
  auth,
  db,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc
} from './firebase-config.js';

const CURRENT_USER_KEY = 'guidehub_active_user';

export const STUDENT_DOMAIN = 'students.nu-fairview.edu.ph';
export const STAFF_DOMAIN = 'nu-fairview.edu.ph';

export function isStudentDomain(email = '') {
  return email.toLowerCase().endsWith(`@${STUDENT_DOMAIN}`);
}

export function isStaffDomain(email = '') {
  const lower = email.toLowerCase();
  return lower.endsWith(`@${STAFF_DOMAIN}`) && !lower.endsWith(`@${STUDENT_DOMAIN}`);
}

// Institutional Identity Validation Helpers & Troll/Dummy Account Filter
export function validateInstitutionalIdentity(data = {}) {
  const fullName = (data.fullName || '').trim();
  const emailPrefix = (data.emailPrefix || (data.email ? data.email.split('@')[0] : '')).trim().toLowerCase();
  const idNumber = (data.idNumber || data.studentOrEmpId || '').trim();
  const role = (data.role || 'student').toLowerCase();

  // 1. Check for blank or overly short values
  if (!fullName || fullName.length < 3) {
    return { valid: false, message: 'Please enter your official full name (minimum 3 characters).' };
  }

  // 2. Reject obvious troll / dummy keyboard mashes
  const trollPatterns = /^(test|temp|dummy|admin|fake|asdf|qwerty|sample|none|null|undefined|12345|user)/i;
  const repetitiveChars = /(.)\1{4,}/; // e.g. "aaaaa" or "11111"

  if (
    trollPatterns.test(emailPrefix) ||
    trollPatterns.test(fullName) ||
    repetitiveChars.test(emailPrefix) ||
    repetitiveChars.test(fullName)
  ) {
    return {
      valid: false,
      message: 'Invalid account details detected. Please use your official NU Fairview credentials.'
    };
  }

  // 3. Validate Student / Employee ID Pattern
  const isStudent = role === 'student' || role === 'college_student' || role === 'shs_student';
  const studentIdRegex = /^20[1-2][0-9]-(SHS-)?\d{4,7}$/i;
  const empIdRegex = /^(EMP|FAC|STAFF|GC|GCO)-\d{3,4}(-\d{3,4})?$/i;

  if (isStudent && idNumber && !studentIdRegex.test(idNumber)) {
    return {
      valid: false,
      message: 'Invalid Student ID format. Expected format: YYYY-XXXXXX (e.g., 2024-10892 or 2024-1039005).'
    };
  }

  if (!isStudent && idNumber) {
    if (studentIdRegex.test(idNumber)) {
      return {
        valid: false,
        message: 'Student ID numbers cannot be used for Faculty registration. Please use your official Employee ID.'
      };
    }
    if (!empIdRegex.test(idNumber)) {
      return {
        valid: false,
        message: 'Invalid Faculty/Employee ID format. Expected format: FAC-XXXX or EMP-YYYY-XXXX (e.g., FAC-0123).'
      };
    }
  }

  // 4. Validate Email Prefix (Letters, periods, numbers - no random special characters)
  const emailPrefixRegex = /^[a-zA-Z0-9]+([._]?[a-zA-Z0-9]+)*$/;
  if (!emailPrefixRegex.test(emailPrefix) || emailPrefix.length < 3) {
    return { valid: false, message: 'Invalid institutional email username. Must be at least 3 characters.' };
  }

  return { valid: true };
}

// Administrative Security & Registration Alert Dispatcher
export async function dispatchAdminAlert(eventType, details = {}) {
  try {
    await fetch('/api/admin-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, details })
    });
  } catch (err) {
    console.warn('Admin security alert notice:', err.message);
  }
}

export function validateInstitutionalEmail(email = '', role = 'student', extraDetails = {}) {
  const cleanEmail = (email || '').trim().toLowerCase();
  if (role === 'student' && !isStudentDomain(cleanEmail)) {
    dispatchAdminAlert('REGISTRATION_BLOCKED', {
      fullName: extraDetails.fullName || 'Student Applicant',
      email: cleanEmail,
      role: 'student',
      studentOrEmpId: extraDetails.studentOrEmpId || 'N/A',
      departmentOrProgram: extraDetails.departmentOrProgram || extraDetails.program || 'N/A',
      reason: `Blocked non-institutional email domain. Student accounts must use @${STUDENT_DOMAIN}.`
    });
    throw new Error(`Student accounts must use an official @${STUDENT_DOMAIN} email address.`);
  }
  if (role === 'faculty' && !isStaffDomain(cleanEmail)) {
    dispatchAdminAlert('REGISTRATION_BLOCKED', {
      fullName: extraDetails.fullName || 'Faculty Applicant',
      email: cleanEmail,
      role: 'faculty',
      studentOrEmpId: extraDetails.studentOrEmpId || 'N/A',
      departmentOrProgram: extraDetails.departmentOrProgram || extraDetails.department || 'N/A',
      reason: `Blocked non-institutional email domain. Faculty accounts must use @${STAFF_DOMAIN}.`
    });
    throw new Error(`Faculty accounts must use an official @${STAFF_DOMAIN} email address.`);
  }
  return cleanEmail;
}

export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: '<i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600 flex-shrink-0"></i>',
    error: '<i data-lucide="alert-circle" class="w-4 h-4 text-rose-600 flex-shrink-0"></i>',
    warning: '<i data-lucide="alert-triangle" class="w-4 h-4 text-amber-600 flex-shrink-0"></i>',
    info: '<i data-lucide="info" class="w-4 h-4 text-[#00205B] flex-shrink-0"></i>'
  };

  toast.innerHTML = `
 ${iconMap[type] || iconMap.info}
 <span class="flex-1">${message}</span>
 `;

  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(1rem) scale(0.95)';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

export function getRolePortalPath(role) {
  const normalized = (role || '').toLowerCase();
  switch (normalized) {
    case 'student':
      return 'student.html';
    case 'faculty':
      return 'faculty.html';
    case 'counselor':
      return 'counselor.html';
    case 'head':
      return 'head.html';
    case 'admin':
      return 'admin.html';
    default:
      return 'student.html';
  }
}

export function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem(CURRENT_USER_KEY) || localStorage.getItem(CURRENT_USER_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Error reading cached user', e);
  }
  return null;
}

export function setCurrentUser(user, remember = true) {
  if (user) {
    const serialized = JSON.stringify(user);
    if (remember) localStorage.setItem(CURRENT_USER_KEY, serialized);
    sessionStorage.setItem(CURRENT_USER_KEY, serialized);
  } else {
    localStorage.removeItem(CURRENT_USER_KEY);
    sessionStorage.removeItem(CURRENT_USER_KEY);
  }
}

export function generate6DigitOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendInstitutionalOTP(
  fullEmail,
  recipientName = 'Nationalian',
  purpose = 'registration',
  extraData = {}
) {
  const cleanEmail = (fullEmail || '').trim().toLowerCase();
  if (!cleanEmail) throw new Error('Please enter a valid institutional email address.');

  const otp = generate6DigitOTP();
  const now = Date.now();
  const expiresAt = now + 5 * 60 * 1000; // 5-minute strict expiry

  // 1. Dispatch Email via API first to verify deliverability with strict 200 OK check
  try {
    const res = await fetch('/api/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: cleanEmail,
        name: recipientName,
        otp: otp,
        purpose: purpose,
        role: extraData.role,
        idNumber: extraData.studentOrEmpId || extraData.idNumber,
        departmentOrProgram: extraData.program || extraData.department || extraData.departmentOrProgram
      })
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(result.error || `Email delivery failed for ${cleanEmail} (Status: ${res.status}).`);
    }
  } catch (apiErr) {
    throw new Error(apiErr.message || 'Failed to connect to email dispatch service.');
  }

  // 2. Only save OTP verification record to Firestore upon confirmed successful dispatch
  if (db) {
    try {
      const otpDocRef = doc(db, 'otpVerifications', cleanEmail);
      await setDoc(otpDocRef, {
        code: otp,
        createdAt: now,
        expiresAt: expiresAt,
        attempts: 0,
        purpose: purpose,
        recipientName: recipientName
      });
    } catch (fsErr) {
      console.warn('Firestore record notice:', fsErr.message);
    }
  }

  return { email: cleanEmail, expiresAt: expiresAt };
}

export async function verifyOTPAndCreateUser(email, enteredCode, profileData, password) {
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanCode = (enteredCode || '').trim();

  if (!cleanCode || cleanCode.length !== 6) {
    throw new Error('Please enter all 6 digits of the OTP code.');
  }

  if (!db) {
    throw new Error('Database service is unavailable.');
  }

  const otpDocRef = doc(db, 'otpVerifications', cleanEmail);
  const otpSnap = await getDoc(otpDocRef);

  if (!otpSnap.exists()) {
    throw new Error('No active verification code found for this email. Please request a new OTP code.');
  }

  const data = otpSnap.data();

  // Check maximum failed OTP attempts
  if ((data.attempts || 0) >= 3) {
    await deleteDoc(otpDocRef);
    dispatchAdminAlert('REGISTRATION_BLOCKED', {
      fullName: profileData?.fullName || 'Applicant',
      email: cleanEmail,
      role: profileData?.role || 'student',
      studentOrEmpId: profileData?.studentOrEmpId || 'N/A',
      departmentOrProgram: profileData?.program || profileData?.department || 'General',
      reason: 'Maximum failed OTP verification attempts exceeded (3).'
    });
    throw new Error('Maximum failed attempts exceeded (3). For security, please request a new OTP code.');
  }

  // Check 5-minute expiry
  if (Date.now() > data.expiresAt) {
    await deleteDoc(otpDocRef);
    throw new Error('Verification code has expired (5-minute limit). Please click Resend Code.');
  }

  // Verify entered code against stored OTP
  if (data.code !== cleanCode) {
    const nextAttempts = (data.attempts || 0) + 1;
    await updateDoc(otpDocRef, { attempts: nextAttempts });
    throw new Error(`Incorrect verification code. ${3 - nextAttempts} attempt(s) remaining.`);
  }

  try {
    await deleteDoc(otpDocRef);
  } catch (delErr) {
    console.warn('Could not delete OTP record:', delErr.message);
  }

  const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  const user = userCredential.user;

  await updateProfile(user, { displayName: profileData.fullName });

  const completeProfile = {
    uid: user.uid,
    fullName: profileData.fullName,
    email: cleanEmail,
    role: profileData.role || 'student',
    studentOrEmpId: profileData.studentOrEmpId || '',
    program: profileData.program || 'General',
    yearLevel: profileData.yearLevel || '',
    department: profileData.department || '',
    subjectArea: profileData.subjectArea || '',
    gender: profileData.gender || 'Prefer not to say',
    contactNumber: profileData.contactNumber || '',
    isVerified: true,
    emailVerified: true,
    createdAt: new Date().toISOString()
  };

  const userDocRef = doc(db, 'users', user.uid);
  await setDoc(userDocRef, completeProfile);

  // Dispatch Administrative Security & Registration Audit Alert
  dispatchAdminAlert('REGISTRATION_SUCCESS', {
    fullName: completeProfile.fullName,
    email: completeProfile.email,
    role: completeProfile.role,
    studentOrEmpId: completeProfile.studentOrEmpId,
    departmentOrProgram: completeProfile.program || completeProfile.department || 'General',
    timestamp: new Date().toISOString()
  });

  setCurrentUser(completeProfile, true);

  return completeProfile;
}

export async function verifyPasswordResetOTP(email, enteredCode, newPassword) {
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanCode = (enteredCode || '').trim();

  if (!cleanCode || cleanCode.length !== 6) {
    throw new Error('Please enter all 6 digits of the recovery OTP.');
  }

  if (!newPassword || newPassword.length < 6) {
    throw new Error('New password must contain at least 6 characters.');
  }

  if (!db) throw new Error('Database service is unavailable.');

  const otpDocRef = doc(db, 'otpVerifications', cleanEmail);
  const otpSnap = await getDoc(otpDocRef);

  if (!otpSnap.exists()) {
    throw new Error('No active recovery code found for this email. Please request a new OTP code.');
  }

  const data = otpSnap.data();

  if ((data.attempts || 0) >= 3) {
    await deleteDoc(otpDocRef);
    throw new Error('Maximum failed attempts exceeded (3). Please request a new recovery code.');
  }

  if (Date.now() > data.expiresAt) {
    await deleteDoc(otpDocRef);
    throw new Error('Recovery code has expired (5-minute limit). Please request a new code.');
  }

  if (data.code !== cleanCode) {
    const nextAttempts = (data.attempts || 0) + 1;
    await updateDoc(otpDocRef, { attempts: nextAttempts });
    throw new Error(`Incorrect recovery code. ${3 - nextAttempts} attempt(s) remaining.`);
  }

  // Call Server-side API to update password directly in Firebase Authentication
  try {
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: cleanEmail,
        otp: cleanCode,
        newPassword: newPassword
      })
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Failed to update Firebase Authentication credentials.');
    }
  } catch (apiErr) {
    throw new Error(apiErr.message || 'Failed to connect to password reset service.');
  }

  await deleteDoc(otpDocRef);
  return { success: true, email: cleanEmail };
}

export async function loginUser(email, password, remember = true) {
  const cleanEmail = (email || '').trim().toLowerCase();

  try {
    const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
    const user = userCredential.user;

    let profileData = null;
    if (db) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userDocRef);
        if (snap.exists()) {
          profileData = { uid: user.uid, ...snap.data() };
        }
      } catch (fsErr) {
        console.warn('Firestore profile fetch error:', fsErr.message);
      }
    }

    if (!profileData) {
      const isStudent = isStudentDomain(cleanEmail);
      profileData = {
        uid: user.uid,
        email: cleanEmail,
        fullName: user.displayName || cleanEmail.split('@')[0],
        role: isStudent ? 'student' : 'faculty',
        studentOrEmpId: 'N/A',
        program: 'General',
        isVerified: true,
        createdAt: new Date().toISOString()
      };
      if (db) {
        try {
          await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
        } catch (e) {}
      }
    }

    setCurrentUser(profileData, remember);
    return profileData;
  } catch (error) {
    let msg = error.message;
    if (
      error.code === 'auth/invalid-credential' ||
      error.code === 'auth/wrong-password' ||
      error.code === 'auth/user-not-found'
    ) {
      msg = 'Invalid institutional email or password. Please verify your credentials.';
    } else if (error.code === 'auth/too-many-requests') {
      msg = 'Too many failed attempts. Please try again in a few moments.';
    }
    throw new Error(msg);
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
  } catch (e) {
    console.error('Sign out error', e);
  }
  setCurrentUser(null);
  window.location.href = 'login.html';
}

export function requireRole(allowedRoles = []) {
  const cachedUser = getCurrentUser();

  if (!cachedUser) {
    window.location.href = 'login.html';
    return null;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(cachedUser.role)) {
    showToast('Access restricted. Redirecting to your assigned workspace.', 'warning');
    setTimeout(() => {
      window.location.href = getRolePortalPath(cachedUser.role);
    }, 1000);
    return null;
  }

  onAuthStateChanged(auth, async firebaseUser => {
    if (!firebaseUser) {
      setCurrentUser(null);
      window.location.href = 'login.html';
    }
  });

  return cachedUser;
}

export function getRoleBadge(role) {
  const map = {
    student: { label: 'Student', class: 'bg-blue-50 text-[#00205B] border-blue-200' },
    faculty: { label: 'Faculty', class: 'bg-amber-50 text-amber-800 border-amber-200' },
    counselor: { label: 'Counselor', class: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    head: { label: 'Guidance Head', class: 'bg-indigo-50 text-indigo-900 border-indigo-200' },
    admin: { label: 'Administrator', class: 'bg-[#00205B] text-[#F5B800] border-[#00205B]' }
  };

  const info = map[(role || '').toLowerCase()] || map.student;
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${info.class}">${info.label}</span>`;
}

export function initNavbar(containerId = 'navbar-container', activePortal = '') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const user = getCurrentUser();
  if (!user) return;

  container.innerHTML = `
 <nav class="bg-[#00205B] text-white border-b border-white/10 sticky top-0 z-30 shadow-md">
 <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
 <div class="flex items-center justify-between h-16">
 
 <!-- Brand Logo & Official NU Crest Image -->
 <div class="flex items-center space-x-3">
 <a href="${getRolePortalPath(user.role)}" class="flex items-center space-x-3 group">
 <img src="assets/nu-logo.png" alt="National University" class="h-10 w-auto object-contain flex-shrink-0 group-hover:scale-105 transition transform drop-shadow-sm" />
 <div>
 <div class="flex items-center gap-1.5">
 <span class="text-sm font-bold tracking-tight text-white">GuideHub</span>
 <span class="text-[10px] bg-[#F5B800] text-[#00205B] font-extrabold px-1.5 py-0.2 rounded">FAIRVIEW</span>
 </div>
 <span class="text-[10px] text-slate-300 font-medium block">Guidance & Counseling Center</span>
 </div>
 </a>
 </div>

 <!-- User Identity & Logout -->
 <div class="flex items-center space-x-3">
 <div class="hidden sm:flex items-center space-x-2.5 px-3.5 py-1.5 bg-white/10 backdrop-blur-xs rounded-xl border border-white/10">
 <div class="text-right">
 <div class="text-xs font-bold text-white leading-tight">${user.fullName}</div>
 <div class="text-[10px] text-slate-300 font-mono">${user.studentOrEmpId || user.email}</div>
 </div>
 <div class="ml-1">${getRoleBadge(user.role)}</div>
 </div>

 <button id="nav-logout-btn" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#00205B] bg-[#F5B800] hover:bg-[#D99B00] shadow-xs transition">
 <i data-lucide="log-out" class="w-3.5 h-3.5"></i>
 <span class="hidden sm:inline">Sign Out</span>
 </button>
 </div>

 </div>
 </div>
 </nav>
 `;

  document.getElementById('nav-logout-btn')?.addEventListener('click', () => {
    logoutUser();
  });

  if (window.lucide) window.lucide.createIcons();
}
