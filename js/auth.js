import {
  auth,
  db,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  getDocs,
  collectionGroup
} from './firebase-config.js';
import { generateUserDocId, getRoleCategory, escapeHtml } from './utils/validation.js';
import { logAuditEvent, saveUserProfile } from './db.js';

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
  const empIdRegex = /^(?:\d{2,3}-\d{2,7}|(?:EMP|FAC|STAFF|GC|GCO)-\d{2,4}(?:-\d{2,7})?)$/i;

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
        message: 'Invalid Faculty/Employee ID format. Expected format: XX-XXXX or XXX-XXXX (e.g., 24-0102 or 102-0451).'
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

function escapeToastHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function showToast(message, type = 'info', customTitle = null) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const defaultTitles = {
    success: 'Success',
    error: 'Notice',
    warning: 'Reminder',
    info: 'GuideHub Update'
  };

  const iconMap = {
    success: '<i data-lucide="check-circle-2" class="w-4 h-4"></i>',
    error: '<i data-lucide="alert-circle" class="w-4 h-4"></i>',
    warning: '<i data-lucide="alert-triangle" class="w-4 h-4"></i>',
    info: '<i data-lucide="info" class="w-4 h-4"></i>'
  };

  const title = customTitle || defaultTitles[type] || 'GuideHub';

  toast.innerHTML = `
    <div class="toast-icon-box">
      ${iconMap[type] || iconMap.info}
    </div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${escapeToastHtml(message)}</div>
    </div>
    <button type="button" class="toast-close-btn" aria-label="Close notification">
      <i data-lucide="x" class="w-3.5 h-3.5"></i>
    </button>
    <div class="toast-progress-bar"></div>
  `;

  function dismiss() {
    if (toast.classList.contains('toast-closing')) return;
    toast.classList.add('toast-closing');
    setTimeout(() => {
      toast.remove();
    }, 250);
  }

  const closeBtn = toast.querySelector('.toast-close-btn');
  closeBtn?.addEventListener('click', e => {
    e.stopPropagation();
    dismiss();
  });

  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  setTimeout(dismiss, 4500);
}

export function showConfirmDialog({
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Proceed',
  cancelText = 'Cancel',
  type = 'warning'
} = {}) {
  return new Promise(resolve => {
    let backdrop = document.getElementById('guidehub-confirm-modal');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'guidehub-confirm-modal';
      backdrop.className =
        'fixed inset-0 z-[100000] flex items-center justify-center p-4 modal-backdrop animate-in fade-in duration-200';
      document.body.appendChild(backdrop);
    }

    const typeIcons = {
      warning:
        '<div class="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center mb-3"><i data-lucide="alert-triangle" class="w-6 h-6"></i></div>',
      danger:
        '<div class="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center mb-3"><i data-lucide="alert-octagon" class="w-6 h-6"></i></div>',
      info:
        '<div class="w-12 h-12 rounded-2xl bg-blue-50 text-[#00205B] border border-blue-200 flex items-center justify-center mb-3"><i data-lucide="help-circle" class="w-6 h-6"></i></div>'
    };

    const confirmBtnClasses = {
      danger: 'bg-rose-600 hover:bg-rose-700 text-white',
      warning: 'bg-[#00205B] hover:bg-[#0A192F] text-white',
      info: 'bg-[#00205B] hover:bg-[#0A192F] text-white'
    };

    backdrop.innerHTML = `
      <div class="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 text-center animate-in zoom-in-95 duration-150">
        <div class="flex justify-center">
          ${typeIcons[type] || typeIcons.warning}
        </div>
        <h3 class="text-base font-bold text-slate-900">${escapeToastHtml(title)}</h3>
        <p class="text-xs text-slate-600 mt-2 leading-relaxed">${escapeToastHtml(message)}</p>
        <div class="grid grid-cols-2 gap-2.5 mt-5">
          <button type="button" id="btn-guidehub-confirm-cancel" class="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition">
            ${escapeToastHtml(cancelText)}
          </button>
          <button type="button" id="btn-guidehub-confirm-ok" class="px-4 py-2.5 rounded-xl text-xs font-semibold ${confirmBtnClasses[type] || confirmBtnClasses.warning} shadow-sm transition">
            ${escapeToastHtml(confirmText)}
          </button>
        </div>
      </div>
    `;

    backdrop.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();

    function cleanUp(result) {
      backdrop.classList.add('hidden');
      resolve(result);
    }

    backdrop.querySelector('#btn-guidehub-confirm-ok')?.addEventListener('click', () => cleanUp(true));
    backdrop.querySelector('#btn-guidehub-confirm-cancel')?.addEventListener('click', () => cleanUp(false));
  });
}

export function getRolePortalPath(role) {
  const normalized = (role || '').toLowerCase();
  const validRoles = ['student', 'faculty', 'counselor', 'head', 'admin'];
  const targetRole = validRoles.includes(normalized) ? normalized : 'student';

  const pathname = typeof window !== 'undefined' ? window.location.pathname || '' : '';
  if (pathname.includes('/portals/') || pathname.endsWith('portals')) {
    return `${targetRole}.html`;
  } else if (pathname.includes('/auth/') || pathname.endsWith('auth')) {
    return `../portals/${targetRole}.html`;
  } else {
    return `portals/${targetRole}.html`;
  }
}

export function getLoginPath() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname || '' : '';
  if (pathname.includes('/auth/') || pathname.endsWith('auth')) {
    return 'login.html';
  } else if (pathname.includes('/portals/') || pathname.endsWith('portals')) {
    return '../auth/login.html';
  } else {
    return 'auth/login.html';
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

    const finalOtp = result.otp || otp;

    // 2. Only save OTP verification record to Firestore upon confirmed successful dispatch
    if (db) {
      try {
        const otpDocRef = doc(db, 'otpVerifications', cleanEmail);
        await setDoc(otpDocRef, {
          code: finalOtp,
          createdAt: now,
          expiresAt: expiresAt,
          attempts: 0,
          purpose: purpose,
          recipientName: recipientName,
          simulated: !!result.simulated
        });
      } catch (fsErr) {
        console.warn('Firestore record notice:', fsErr.message);
      }
    }

    return {
      email: cleanEmail,
      expiresAt: expiresAt,
      simulated: !!result.simulated,
      otp: finalOtp
    };
  } catch (apiErr) {
    throw new Error(apiErr.message || 'Failed to connect to email dispatch service.');
  }
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

  let user = null;
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    user = userCredential.user;
  } catch (authErr) {
    if (authErr.code === 'auth/email-already-in-use') {
      // Account was previously deleted from Firestore but remained in Firebase Auth: sync password and sign in
      try {
        await fetch('/api/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            otp: cleanCode,
            newPassword: password
          })
        });
      } catch (e) {}
      const signInCred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      user = signInCred.user;
    } else {
      throw authErr;
    }
  }

  try {
    await deleteDoc(otpDocRef);
  } catch (delErr) {
    console.warn('Could not delete OTP record:', delErr.message);
  }

  await updateProfile(user, { displayName: profileData.fullName }).catch(() => {});

  const userDocId = generateUserDocId(profileData.role, profileData.fullName, cleanEmail.split('@')[0]);

  const category = getRoleCategory(profileData.role);
  const completeProfile = {
    uid: userDocId,
    authUid: user.uid,
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

  // Store strictly inside users/{category} -> [userDocId]: completeProfile (NO nested users subcollection)
  await setDoc(
    doc(db, 'users', category),
    {
      [userDocId]: completeProfile,
      roleCategory: category
    },
    { merge: true }
  );

  // Dispatch Administrative Security & Registration Audit Alert
  dispatchAdminAlert('REGISTRATION_SUCCESS', {
    fullName: completeProfile.fullName,
    email: completeProfile.email,
    role: completeProfile.role,
    studentOrEmpId: completeProfile.studentOrEmpId,
    departmentOrProgram: completeProfile.program || completeProfile.department || 'General',
    timestamp: new Date().toISOString()
  });

  await logAuditEvent(
    completeProfile.uid,
    completeProfile.fullName,
    completeProfile.role,
    'USER_REGISTERED',
    `Registered verified ${completeProfile.role} account (${completeProfile.email})`
  );

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
    await deleteDoc(otpDocRef).catch(() => {});
    throw new Error('Maximum failed attempts exceeded (3). Please request a new recovery code.');
  }

  if (Date.now() > data.expiresAt) {
    await deleteDoc(otpDocRef).catch(() => {});
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

  await deleteDoc(otpDocRef).catch(() => {});
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
        const categories = isStudentDomain(cleanEmail)
          ? ['students', 'counselors', 'faculty', 'head', 'admin']
          : ['counselors', 'faculty', 'head', 'admin', 'students'];

        // Check role document maps: users/{category} contains docId fields
        for (const cat of categories) {
          try {
            const catDoc = await getDoc(doc(db, 'users', cat));
            if (catDoc.exists()) {
              const data = catDoc.data();
              for (const [key, val] of Object.entries(data)) {
                if (
                  val &&
                  typeof val === 'object' &&
                  ((val.email && val.email.toLowerCase() === cleanEmail) || val.authUid === user.uid)
                ) {
                  profileData = { uid: key, ...val };
                  break;
                }
              }
              if (profileData) break;
            }
          } catch (catDocErr) {}
        }
      } catch (fsErr) {
        console.warn('Firestore profile fetch error:', fsErr.message);
      }
    }

    if (!profileData) {
      const isStudent = isStudentDomain(cleanEmail);
      const generatedDocId = generateUserDocId(
        isStudent ? 'student' : 'faculty',
        user.displayName || cleanEmail.split('@')[0],
        cleanEmail.split('@')[0]
      );
      const category = getRoleCategory(isStudent ? 'student' : 'faculty');
      profileData = {
        uid: generatedDocId,
        authUid: user.uid,
        email: cleanEmail,
        fullName: user.displayName || cleanEmail.split('@')[0],
        role: isStudent ? 'student' : 'faculty',
        studentOrEmpId: 'N/A',
        program: 'General',
        isVerified: true,
        emailVerified: true,
        createdAt: new Date().toISOString()
      };
      if (db) {
        try {
          await setDoc(doc(db, 'users', category), { [generatedDocId]: profileData, roleCategory: category }, { merge: true });
        } catch (e) {}
      }
    }

    setCurrentUser(profileData, remember);
    logAuditEvent(
      profileData.uid,
      profileData.fullName,
      profileData.role,
      'USER_LOGIN',
      `Authenticated into ${profileData.role} portal (${profileData.email})`
    ).catch(() => {});
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
  setCurrentUser(null);
  try {
    await signOut(auth);
  } catch (e) {
    console.error('Sign out error', e);
  }
  if (typeof window !== 'undefined') {
    window.history.replaceState({ guidehubLoggedOut: true }, '', getLoginPath());
    window.location.replace(getLoginPath());
  }
}

export function requireRole(allowedRoles = []) {
  const cachedUser = getCurrentUser();

  if (!cachedUser) {
    if (typeof document !== 'undefined') {
      document.documentElement.style.visibility = 'hidden';
    }
    window.location.replace(getLoginPath());
    return null;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(cachedUser.role)) {
    showToast('Access restricted. Redirecting to your assigned workspace.', 'warning');
    setTimeout(() => {
      window.location.replace(getRolePortalPath(cachedUser.role));
    }, 600);
    return null;
  }

  // Lock browser history so pressing Back while inside a portal does not return to Login/Signup,
  // and pressing Back after Logout never restores cached portal views
  if (typeof window !== 'undefined' && !window.__guidehubPortalHistoryLocked) {
    window.__guidehubPortalHistoryLocked = true;
    window.history.pushState({ guidehubPortalGuard: true }, '', window.location.href);

    window.addEventListener('popstate', () => {
      const activeUser = getCurrentUser();
      if (!activeUser) {
        document.documentElement.style.visibility = 'hidden';
        window.location.replace(getLoginPath());
      } else {
        window.history.pushState({ guidehubPortalGuard: true }, '', window.location.href);
      }
    });

    window.addEventListener('pageshow', event => {
      const activeUser = getCurrentUser();
      if (!activeUser || event.persisted) {
        if (!activeUser) {
          document.documentElement.style.visibility = 'hidden';
          window.location.replace(getLoginPath());
        }
      }
    });

    window.addEventListener('storage', () => {
      if (!getCurrentUser()) {
        document.documentElement.style.visibility = 'hidden';
        window.location.replace(getLoginPath());
      }
    });
  }

  onAuthStateChanged(auth, async firebaseUser => {
    if (!firebaseUser) {
      setCurrentUser(null);
      if (typeof document !== 'undefined') {
        document.documentElement.style.visibility = 'hidden';
      }
      window.location.replace(getLoginPath());
    }
  });

  return cachedUser;
}

// Automatically guard auth/public pages against Back-button navigation across auth states
if (typeof window !== 'undefined') {
  const enforceAuthPageHistoryGuard = () => {
    const path = (window.location.pathname || '').toLowerCase();
    const isAuthPage =
      path.includes('/auth/login') ||
      path.includes('/auth/signup') ||
      path.includes('/auth/forgot-password') ||
      path.endsWith('login.html') ||
      path.endsWith('signup.html') ||
      path.endsWith('forgot-password.html');

    if (isAuthPage) {
      const activeUser = getCurrentUser();
      if (activeUser) {
        window.location.replace(getRolePortalPath(activeUser.role));
        return;
      }

      if (!window.__guidehubAuthHistoryLocked) {
        window.__guidehubAuthHistoryLocked = true;
        window.history.pushState({ guidehubAuthGuard: true }, '', window.location.href);

        window.addEventListener('popstate', () => {
          const usr = getCurrentUser();
          if (usr) {
            window.location.replace(getRolePortalPath(usr.role));
          } else {
            // Stay on the auth page so Back button after logout cannot go back to the portal
            window.history.pushState({ guidehubAuthGuard: true }, '', window.location.href);
          }
        });
      }
    }
  };

  enforceAuthPageHistoryGuard();
  window.addEventListener('pageshow', enforceAuthPageHistoryGuard);
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

  const pathname = typeof window !== 'undefined' ? window.location.pathname || '' : '';
  const isSubdir = pathname.includes('/portals/') || pathname.includes('/auth/');
  const logoSrc = isSubdir ? '../assets/nu-logo.png' : 'assets/nu-logo.png';

  container.innerHTML = `
  <nav class="bg-[#00205B] text-white border-b border-white/10 sticky top-0 z-30 shadow-md">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-14 sm:h-16">
        
        <!-- Brand Logo & Official NU Crest Image -->
        <div class="flex items-center space-x-2 sm:space-x-3 min-w-0">
          <a href="${getRolePortalPath(user.role)}" class="flex items-center space-x-2 sm:space-x-3 group min-w-0">
            <img src="${logoSrc}" alt="National University" class="h-8 sm:h-10 w-auto object-contain flex-shrink-0 group-hover:scale-105 transition transform drop-shadow-sm" />
            <div class="min-w-0">
              <div class="flex items-center gap-1 sm:gap-1.5">
                <span class="text-sm font-bold tracking-tight text-white">GuideHub</span>
                <span class="text-[9px] sm:text-[10px] bg-[#F5B800] text-[#00205B] font-extrabold px-1 sm:px-1.5 py-0.2 rounded">FAIRVIEW</span>
              </div>
              <span class="text-[10px] text-slate-300 font-medium hidden sm:block truncate">Guidance & Counseling Center</span>
              <span class="text-[9px] text-slate-300 font-medium sm:hidden block truncate">Guidance Center</span>
            </div>
          </a>
        </div>

        <!-- User Identity, Profile & Logout -->
        <div class="flex items-center space-x-1.5 sm:space-x-3 shrink-0">
          <button id="nav-profile-pill-btn" type="button" class="flex items-center space-x-1.5 sm:space-x-2.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl border border-white/10 transition cursor-pointer text-left group" title="Click to view & edit Profile Dashboard">
            <div class="hidden sm:block text-right">
              <div id="nav-user-fullname" class="text-xs font-bold text-white leading-tight group-hover:text-amber-300 transition">${escapeHtml(user.fullName)}</div>
              <div class="text-[10px] text-slate-300 font-mono">${escapeHtml(user.studentOrEmpId || user.email)}</div>
            </div>
            <div>${getRoleBadge(user.role)}</div>
            <div class="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center text-[#F5B800] group-hover:bg-[#F5B800] group-hover:text-[#00205B] transition">
              <i data-lucide="user-cog" class="w-3.5 h-3.5"></i>
            </div>
          </button>

          <button id="nav-logout-btn" class="inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold text-[#00205B] bg-[#F5B800] hover:bg-[#D99B00] shadow-sm transition active:scale-95" title="Sign Out">
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

  document.getElementById('nav-profile-pill-btn')?.addEventListener('click', () => {
    openProfileModal();
  });

  // Attach any page buttons with data-action="open-profile" or specific profile IDs
  setTimeout(() => {
    document.querySelectorAll('[data-action="open-profile"], #btn-open-student-profile, #btn-open-counselor-profile, #btn-open-faculty-profile, #btn-open-head-profile, #btn-open-admin-profile').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openProfileModal();
      });
    });
  }, 50);

  initProfileModal();

  if (window.lucide) window.lucide.createIcons();
}

export function initProfileModal() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('guidehub-profile-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'guidehub-profile-modal';
  modal.className = 'hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs transition-opacity duration-200';
  modal.innerHTML = `
    <div class="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
      
      <!-- Modal Header -->
      <div class="px-6 py-4 bg-[#00205B] text-white flex items-center justify-between border-b border-white/10 shrink-0">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-[#F5B800] border border-white/10">
            <i data-lucide="user-cog" class="w-5 h-5"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-white tracking-tight">Institutional Profile Dashboard</h3>
            <p class="text-[11px] text-slate-300">National University Fairview Identity Management</p>
          </div>
        </div>
        <button id="close-profile-modal-btn" type="button" class="text-slate-300 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition" title="Close Profile Modal">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>

      <!-- Modal Body (Scrollable) -->
      <div class="p-6 space-y-4 overflow-y-auto flex-1">
        
        <!-- User Identity Ribbon -->
        <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div id="profile-modal-avatar" class="w-10 h-10 rounded-full bg-[#00205B] text-[#F5B800] font-bold text-sm flex items-center justify-center uppercase shadow-xs">
              NU
            </div>
            <div>
              <div id="profile-modal-display-name" class="text-xs font-bold text-slate-900">User Profile</div>
              <div id="profile-modal-display-role" class="text-[10px] text-slate-500 font-medium">Verified Account</div>
            </div>
          </div>
          <div id="profile-modal-role-badge"></div>
        </div>

        <!-- Strict Immutability & RA 9258 Advisory Notice -->
        <div class="p-3.5 rounded-xl bg-amber-50/90 border border-amber-200 text-amber-950 text-xs">
          <div class="flex items-start gap-2.5">
            <i data-lucide="shield-alert" class="w-4 h-4 text-amber-600 shrink-0 mt-0.5"></i>
            <div class="space-y-1">
              <span class="font-bold text-amber-900 block">Permanent Identity Credentials Notice:</span>
              <p class="text-[11px] text-amber-800 leading-relaxed">
                To uphold university audit integrity, student identity verification, and clinical confidentiality (RA 9258), your <strong>ID Number</strong> and <strong>Official Institutional Email</strong> are strictly locked and cannot be edited. Other profile details can be updated below.
              </p>
            </div>
          </div>
        </div>

        <!-- Form Inputs -->
        <form id="profile-edit-form" class="space-y-3.5 text-xs">
          
          <!-- Locked ID Number -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="font-bold text-slate-700" id="profile-label-id">Student / Employee ID Number</label>
              <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                <i data-lucide="lock" class="w-3 h-3 text-slate-400"></i> Locked / Permanent Record
              </span>
            </div>
            <input type="text" id="profile-input-id" disabled readonly
              class="w-full px-3.5 py-2.5 text-xs bg-slate-100 border border-slate-200 text-slate-500 rounded-xl cursor-not-allowed select-none font-mono font-medium focus:outline-none" />
          </div>

          <!-- Locked Institutional Email -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="font-bold text-slate-700">Official Institutional Email</label>
              <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                <i data-lucide="lock" class="w-3 h-3 text-slate-400"></i> Locked / University Registered
              </span>
            </div>
            <input type="text" id="profile-input-email" disabled readonly
              class="w-full px-3.5 py-2.5 text-xs bg-slate-100 border border-slate-200 text-slate-500 rounded-xl cursor-not-allowed select-none font-mono font-medium focus:outline-none" />
          </div>

          <!-- Editable Full Legal Name -->
          <div>
            <label class="block font-bold text-slate-700 mb-1">
              Full Legal Name <span class="text-rose-500">*</span>
            </label>
            <input type="text" id="profile-input-fullname" required placeholder="e.g. Maria Clara Santos"
              class="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-xl focus:border-[#00205B] focus:ring-1 focus:ring-[#00205B] focus:outline-none" />
          </div>

          <!-- Editable Gender Identity -->
          <div>
            <label class="block font-bold text-slate-700 mb-1">Gender Identity</label>
            <select id="profile-input-gender"
              class="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-xl focus:border-[#00205B] focus:outline-none bg-white font-medium text-slate-700">
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>
          </div>

          <!-- Dynamic Academic Program / Department -->
          <div id="profile-program-container">
            <label class="block font-bold text-slate-700 mb-1" id="profile-label-program">
              Academic Strand / Degree Program
            </label>
            <select id="profile-input-program"
              class="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-xl focus:border-[#00205B] focus:outline-none bg-white font-medium text-slate-700">
            </select>
          </div>

          <!-- Year / Grade Level (Student only) -->
          <div id="profile-year-container">
            <label class="block font-bold text-slate-700 mb-1">Year / Grade Level</label>
            <select id="profile-input-year"
              class="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-xl focus:border-[#00205B] focus:outline-none bg-white font-medium text-slate-700">
              <option value="Grade 11">Grade 11 (SHS)</option>
              <option value="Grade 12">Grade 12 (SHS)</option>
              <option value="1st Year">1st Year (College)</option>
              <option value="2nd Year">2nd Year (College)</option>
              <option value="3rd Year">3rd Year (College)</option>
              <option value="4th Year">4th Year (College)</option>
            </select>
          </div>

          <!-- Contact Phone (Student only) -->
          <div id="profile-contact-container">
            <div class="flex items-center justify-between mb-1">
              <label class="font-bold text-slate-700">Contact Phone Number <span class="text-rose-500">*</span></label>
              <span class="text-[10px] text-slate-400">e.g. 0917-123-4567</span>
            </div>
            <input type="text" id="profile-input-contact" inputmode="tel" placeholder="0917-123-4567"
              class="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-xl focus:border-[#00205B] focus:ring-1 focus:ring-[#00205B] focus:outline-none" />
            <p class="text-[10px] text-slate-500 mt-1">Counselors utilize this for urgent consultation notices and triage updates.</p>
          </div>

          <!-- Staff Phone Exemption Notice (Staff only) -->
          <div id="profile-staff-exemption-note" class="hidden p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-[11px] flex items-center gap-2">
            <i data-lucide="info" class="w-4 h-4 text-slate-400 shrink-0"></i>
            <span>Staff / Counselor Exemption: Contact numbers are not required for guidance counselors or faculty. Institutional communication is routed via official university email.</span>
          </div>

        </form>

      </div>

      <!-- Modal Actions Footer -->
      <div class="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 shrink-0">
        <button type="button" id="btn-cancel-profile-modal"
          class="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-200 bg-slate-100 transition">
          Cancel
        </button>
        <button type="button" id="btn-save-profile-modal"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-[#00205B] bg-[#F5B800] hover:bg-[#D99B00] shadow-sm transition">
          <i data-lucide="check" class="w-3.5 h-3.5"></i>
          <span>Save Profile Changes</span>
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(modal);

  // Close triggers
  document.getElementById('close-profile-modal-btn')?.addEventListener('click', closeProfileModal);
  document.getElementById('btn-cancel-profile-modal')?.addEventListener('click', closeProfileModal);
  modal.addEventListener('click', e => {
    if (e.target === modal) closeProfileModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeProfileModal();
    }
  });

  // Save handler
  document.getElementById('btn-save-profile-modal')?.addEventListener('click', handleSaveProfile);
}

export function openProfileModal() {
  const user = getCurrentUser();
  if (!user) return;

  initProfileModal();

  const modal = document.getElementById('guidehub-profile-modal');
  if (!modal) return;

  const isStudent = user.role === 'student';

  // Avatar & Basic Info
  const avatar = document.getElementById('profile-modal-avatar');
  if (avatar) {
    const initials = (user.fullName || 'NU')
      .split(' ')
      .filter(Boolean)
      .map(n => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    avatar.textContent = initials || 'NU';
  }

  const dispName = document.getElementById('profile-modal-display-name');
  if (dispName) dispName.textContent = user.fullName || 'User Profile';

  const dispRole = document.getElementById('profile-modal-display-role');
  if (dispRole) {
    dispRole.textContent = `${(user.role || 'user').toUpperCase()} • ${user.studentOrEmpId || user.email}`;
  }

  const badgeContainer = document.getElementById('profile-modal-role-badge');
  if (badgeContainer) badgeContainer.innerHTML = getRoleBadge(user.role);

  // Locked Fields
  const inputId = document.getElementById('profile-input-id');
  if (inputId) inputId.value = user.studentOrEmpId || 'N/A';

  const labelId = document.getElementById('profile-label-id');
  if (labelId) labelId.textContent = isStudent ? 'Student ID Number' : 'Employee / Faculty ID';

  const inputEmail = document.getElementById('profile-input-email');
  if (inputEmail) inputEmail.value = user.email || '';

  // Editable Fields
  const inputName = document.getElementById('profile-input-fullname');
  if (inputName) inputName.value = user.fullName || '';

  const inputGender = document.getElementById('profile-input-gender');
  if (inputGender) inputGender.value = user.gender || 'Prefer not to say';

  // Dynamic Program/Department
  const programSelect = document.getElementById('profile-input-program');
  const programLabel = document.getElementById('profile-label-program');
  const yearContainer = document.getElementById('profile-year-container');
  const contactContainer = document.getElementById('profile-contact-container');
  const staffExemptionNote = document.getElementById('profile-staff-exemption-note');

  if (isStudent) {
    if (programLabel) programLabel.textContent = 'Academic Strand or Degree Program';
    if (programSelect) {
      programSelect.innerHTML = `
        <optgroup label="Senior High School (SHS Strands)">
          <option value="SHS - STEM (Science, Technology, Engineering & Math)">SHS - STEM (Science, Technology, Engineering & Math)</option>
          <option value="SHS - ABM (Accountancy, Business & Management)">SHS - ABM (Accountancy, Business & Management)</option>
          <option value="SHS - HUMSS (Humanities & Social Sciences)">SHS - HUMSS (Humanities & Social Sciences)</option>
          <option value="SHS - GAS (General Academic Strand)">SHS - GAS (General Academic Strand)</option>
          <option value="SHS - TVL (Technical-Vocational-Livelihood)">SHS - TVL (Technical-Vocational-Livelihood)</option>
        </optgroup>
        <optgroup label="Higher Education Degree Programs">
          <option value="BS Accountancy">BS Accountancy</option>
          <option value="BSBA Major in Financial Management">BSBA Major in Financial Management</option>
          <option value="BSBA Major in Marketing Management">BSBA Major in Marketing Management</option>
          <option value="BS Hospitality Management">BS Hospitality Management</option>
          <option value="BS Tourism Management">BS Tourism Management</option>
          <option value="BS Architecture">BS Architecture</option>
          <option value="BS Civil Engineering">BS Civil Engineering</option>
          <option value="BS Computer Engineering">BS Computer Engineering</option>
          <option value="BS Information Technology">BS Information Technology</option>
          <option value="BS Psychology">BS Psychology</option>
          <option value="AB Communication">AB Communication</option>
        </optgroup>
      `;
      if (user.program) programSelect.value = user.program;
    }

    if (yearContainer) yearContainer.classList.remove('hidden');
    const inputYear = document.getElementById('profile-input-year');
    if (inputYear && user.yearLevel) inputYear.value = user.yearLevel;

    if (contactContainer) contactContainer.classList.remove('hidden');
    const inputContact = document.getElementById('profile-input-contact');
    if (inputContact) inputContact.value = user.contactNumber || '';

    if (staffExemptionNote) staffExemptionNote.classList.add('hidden');
  } else {
    // Counselor / Faculty / Head / Admin
    if (programLabel) programLabel.textContent = 'University Department / College';
    if (programSelect) {
      programSelect.innerHTML = `
        <option value="Guidance and Counseling Center">Guidance and Counseling Center</option>
        <option value="Senior High School Department (SHS)">Senior High School Department (SHS)</option>
        <option value="College of Computing and Information Technology">College of Computing and Information Technology</option>
        <option value="College of Engineering and Architecture">College of Engineering and Architecture</option>
        <option value="College of Business and Accountancy">College of Business and Accountancy</option>
        <option value="College of Arts and Sciences">College of Arts and Sciences</option>
        <option value="General Education Department">General Education Department</option>
        <option value="Administration & Student Affairs">Administration & Student Affairs</option>
      `;
      if (user.department || user.program) {
        programSelect.value = user.department || user.program;
      }
    }

    if (yearContainer) yearContainer.classList.add('hidden');
    if (contactContainer) contactContainer.classList.add('hidden');
    if (staffExemptionNote) staffExemptionNote.classList.remove('hidden');
  }

  modal.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
  inputName?.focus();
}

export function closeProfileModal() {
  const modal = document.getElementById('guidehub-profile-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleSaveProfile() {
  const user = getCurrentUser();
  if (!user) return;

  const saveBtn = document.getElementById('btn-save-profile-modal');
  const newName = (document.getElementById('profile-input-fullname')?.value || '').trim();
  const newGender = document.getElementById('profile-input-gender')?.value || 'Prefer not to say';
  const newProgram = document.getElementById('profile-input-program')?.value || 'General';
  const newYear = document.getElementById('profile-input-year')?.value || '';
  const newContact = (document.getElementById('profile-input-contact')?.value || '').trim();

  if (!newName || newName.length < 3) {
    showToast('Please enter your official full name (minimum 3 characters).', 'warning');
    return;
  }

  const isStudent = user.role === 'student';
  if (isStudent && !newContact) {
    showToast('Please enter a contact phone number.', 'warning');
    return;
  }

  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span>Saving Changes...</span>`;
    }

    const updatedProfile = {
      ...user,
      fullName: newName,
      gender: newGender,
      program: newProgram,
      department: isStudent ? (user.department || '') : newProgram,
      yearLevel: isStudent ? newYear : (user.yearLevel || ''),
      contactNumber: isStudent ? newContact : (user.contactNumber || ''),
      // STRICT IMMUTABILITY: ID Number, Email, Role, UID cannot be changed
      studentOrEmpId: user.studentOrEmpId,
      email: user.email,
      role: user.role,
      uid: user.uid
    };

    // Save to Firestore and LocalState
    await saveUserProfile(user.uid, updatedProfile);

    // Update active user in session / localStorage
    setCurrentUser(updatedProfile, true);

    // Update Navbar DOM elements
    const navNameEl = document.getElementById('nav-user-fullname');
    if (navNameEl) navNameEl.textContent = updatedProfile.fullName;

    // Update Welcome Text on active portal if present
    const studentWelcome = document.getElementById('student-welcome-text');
    if (studentWelcome) {
      studentWelcome.textContent = `${updatedProfile.fullName} (${updatedProfile.studentOrEmpId || 'Student'}) • ${updatedProfile.program || 'Student Workspace'}`;
    }
    const counselorWelcome = document.getElementById('counselor-welcome-text');
    if (counselorWelcome) {
      counselorWelcome.textContent = `${updatedProfile.fullName} (${updatedProfile.studentOrEmpId || 'Counselor'}) • Clinical Workspace`;
    }
    const facultyWelcome = document.getElementById('faculty-welcome-text');
    if (facultyWelcome) {
      facultyWelcome.textContent = `${updatedProfile.fullName} (${updatedProfile.studentOrEmpId || 'Faculty'}) • Department of ${updatedProfile.department || updatedProfile.program || 'Faculty'}`;
    }

    // Audit log
    await logAuditEvent(
      user.uid,
      updatedProfile.fullName,
      user.role,
      'USER_PROFILE_UPDATED',
      `Updated institutional profile details (${updatedProfile.email}, ID: ${updatedProfile.studentOrEmpId})`
    ).catch(() => {});

    // Dispatch global event for active portal listeners
    window.dispatchEvent(new CustomEvent('guidehub_profile_updated', { detail: { user: updatedProfile } }));

    showToast('Profile updated successfully!', 'success');
    closeProfileModal();
  } catch (err) {
    console.error('Failed to update profile:', err);
    showToast(err.message || 'Failed to update profile.', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5"></i><span>Save Profile Changes</span>`;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}
