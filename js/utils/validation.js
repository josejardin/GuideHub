// GuideHub Client Validation Utilities
export const STUDENT_DOMAIN = 'students.nu-fairview.edu.ph';
export const STAFF_DOMAIN = 'nu-fairview.edu.ph';

export const STUDENT_ID_REGEX = /^20[1-2][0-9]-(SHS-)?\d{4,7}$/i;
export const EMPLOYEE_ID_REGEX = /^(EMP|FAC|STAFF|GC|GCO)-\d{3,4}(-\d{3,4})?$/i;
export const EMAIL_PREFIX_REGEX = /^[a-zA-Z0-9]+([._]?[a-zA-Z0-9]+)*$/;

export function isStudentDomain(email = '') {
  return email.toLowerCase().endsWith(`@${STUDENT_DOMAIN}`);
}

export function isStaffDomain(email = '') {
  return email.toLowerCase().endsWith(`@${STAFF_DOMAIN}`);
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
        message: 'Invalid Faculty/Employee ID format. Expected format: FAC-XXXX or EMP-YYYY-XXXX (e.g., FAC-0123).'
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
  return `users/${category}/accounts/${docId}`;
}
