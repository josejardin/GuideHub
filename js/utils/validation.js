// GuideHub Client Validation Utilities
export const STUDENT_DOMAIN = 'students.nu-fairview.edu.ph';
export const STAFF_DOMAIN = 'nu-fairview.edu.ph';

export const STUDENT_ID_REGEX = /^20[1-2][0-9]-(SHS-)?\d{4,7}$/i;
export const EMPLOYEE_ID_REGEX = /^(?:\d{2,3}-\d{2,7}|(?:EMP|FAC|STAFF|GC|GCO)-\d{2,4}(?:-\d{2,7})?)$/i;
export const EMAIL_PREFIX_REGEX = /^[a-zA-Z0-9]+([._]?[a-zA-Z0-9]+)*$/;

export function isStudentDomain(email = '') {
  return email.toLowerCase().endsWith(`@${STUDENT_DOMAIN}`);
}

export function isStaffDomain(email = '') {
  const lower = email.toLowerCase();
  return lower.endsWith(`@${STAFF_DOMAIN}`) && !lower.endsWith(`@${STUDENT_DOMAIN}`);
}

export function escapeHtml(str = '') {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDateIso(val) {
  if (!val) return 'Recent';
  if (typeof val === 'string') {
    return val.split('T')[0] || val;
  }
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      return val.toDate().toISOString().split('T')[0];
    }
    if (typeof val.seconds === 'number') {
      return new Date(val.seconds * 1000).toISOString().split('T')[0];
    }
  }
  try {
    return new Date(val).toISOString().split('T')[0];
  } catch (e) {
    return 'Recent';
  }
}

export function formatTime12h(timeStr = '') {
  if (!timeStr) return '';
  const trimmed = String(timeStr).trim();
  if (/am|pm/i.test(trimmed)) return trimmed;
  if (!trimmed.includes(':')) return trimmed;
  const parts = trimmed.split(':');
  let h = parseInt(parts[0], 10);
  if (isNaN(h)) return trimmed;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  const m = (parts[1] || '00').substring(0, 2);
  return `${h}:${m} ${ampm}`;
}

export function formatTimeSlot12h(slot = '') {
  if (!slot) return '';
  const str = String(slot).trim();
  if (str.includes('-')) {
    const parts = str.split('-');
    return `${formatTime12h(parts[0])} - ${formatTime12h(parts[1])}`;
  }
  return formatTime12h(str);
}

export function normalizeTimeSlot(slot = '') {
  if (!slot) return '';
  function to24h(t) {
    const match = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
    if (!match) return String(t).trim();
    let h = parseInt(match[1], 10);
    const m = match[2];
    const ampm = match[3] ? match[3].toLowerCase() : null;
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  if (slot.includes('-')) {
    const [p1, p2] = slot.split('-');
    return `${to24h(p1)} - ${to24h(p2)}`;
  }
  return to24h(slot);
}

export function validateIdentityFormat({ fullName, emailPrefix, idNumber, role }) {
  const isStudent = role === 'student' || role === 'college_student' || role === 'shs_student';

  if (!fullName || fullName.trim().length < 3) {
    return { valid: false, message: 'Please enter your full official name.' };
  }

  if (isStudent && idNumber && !STUDENT_ID_REGEX.test(idNumber)) {
    return {
      valid: false,
      message: 'Invalid Student ID format. Expected format: YYYY-XXXXXX (e.g., 2024-10892 or 2024-1039005).'
    };
  }

  if (!isStudent && idNumber) {
    if (STUDENT_ID_REGEX.test(idNumber)) {
      return {
        valid: false,
        message: 'Student ID numbers cannot be used for Faculty registration. Please use your official Employee ID.'
      };
    }
    if (!EMPLOYEE_ID_REGEX.test(idNumber)) {
      return {
        valid: false,
        message: 'Invalid Faculty/Employee ID format. Expected format: XX-XXXX or XXX-XXXX (e.g., 24-0102 or 102-0451).'
      };
    }
  }

  if (emailPrefix && (!EMAIL_PREFIX_REGEX.test(emailPrefix) || emailPrefix.length < 3)) {
    return { valid: false, message: 'Invalid institutional email username. Must be at least 3 characters.' };
  }

  return { valid: true };
}

export function generateUserDocId(role = 'student', fullName = '', emailPrefix = '') {
  let cleanRole = (role || 'student').toLowerCase();
  if (cleanRole.includes('counselor')) cleanRole = 'counselor';
  else if (cleanRole.includes('faculty')) cleanRole = 'faculty';
  else if (cleanRole.includes('head')) cleanRole = 'head';
  else if (cleanRole.includes('admin')) cleanRole = 'admin';
  else cleanRole = 'student';

  if (fullName && fullName.trim()) {
    // Strip common academic/professional titles and credentials
    let cleanName = fullName
      .replace(/^(ms\.|mr\.|mrs\.|dr\.|engr\.|atty\.|prof\.)\s+/i, '')
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/,\s*(rgc|phd|ma|ms|rn|lpt|cpa).*$/i, '')
      .trim();

    const parts = cleanName.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const firstName = parts[0].replace(/[^a-z0-9]/g, '');
      const lastInitial = parts[parts.length - 1].charAt(0).replace(/[^a-z0-9]/g, '');
      if (firstName && lastInitial) {
        return `usr_${cleanRole}_${firstName}_${lastInitial}`;
      }
    } else if (parts.length === 1) {
      const firstName = parts[0].replace(/[^a-z0-9]/g, '');
      if (firstName) {
        return `usr_${cleanRole}_${firstName}`;
      }
    }
  }

  if (emailPrefix) {
    const cleanPrefix = emailPrefix.toLowerCase().replace(/[^a-z0-9_]/g, '');
    return `usr_${cleanRole}_${cleanPrefix}`;
  }

  return `usr_${cleanRole}_${Date.now()}`;
}

export function getRoleCategory(role = 'student') {
  const r = (role || 'student').toLowerCase();
  if (r.includes('counselor')) return 'counselors';
  if (r.includes('faculty')) return 'faculty';
  if (r.includes('head')) return 'head';
  if (r.includes('admin')) return 'admin';
  return 'students';
}

export function getUserDocPath(role, docId) {
  const category = getRoleCategory(role);
  return `users/${category}/users/${docId}`;
}
