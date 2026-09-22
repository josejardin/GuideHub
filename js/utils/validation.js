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
