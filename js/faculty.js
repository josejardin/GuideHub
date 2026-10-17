import { requireRole, initNavbar, showToast } from './auth.js';
import { createReferral, subscribeFacultyReferrals, logAuditEvent } from './db.js';
import { escapeHtml, formatDateIso } from './utils/validation.js';

document.addEventListener('DOMContentLoaded', () => {
  const currentUser = requireRole(['faculty']);
  if (!currentUser) return;

  initNavbar('navbar-container', 'faculty');

  const welcomeText = document.getElementById('faculty-welcome-text');
  if (welcomeText) {
    welcomeText.textContent = `${currentUser.fullName} (${currentUser.studentOrEmpId || 'Faculty'}) • ${currentUser.program || 'Faculty Portal'}`;
  }

  window.addEventListener('guidehub_profile_updated', e => {
    const updated = e.detail?.user;
    if (updated && welcomeText) {
      welcomeText.textContent = `${updated.fullName} (${updated.studentOrEmpId || 'Faculty'}) • ${updated.program || 'Faculty Portal'}`;
    }
  });

  let cachedReferrals = [];
  const referralsTableBody = document.getElementById('referrals-table-body');
  const referralStatusFilter = document.getElementById('referral-status-filter');

  subscribeFacultyReferrals(currentUser.uid, referrals => {
    cachedReferrals = referrals;
    renderReferrals();
  });

  referralStatusFilter?.addEventListener('change', renderReferrals);

  function renderReferrals() {
    if (!referralsTableBody) return;
    const filter = referralStatusFilter?.value || 'ACTIVE';
    const filtered = cachedReferrals.filter(r => {
      if (filter === 'ACTIVE') {
        return r.status !== 'Closed';
      } else if (filter === 'ALL') {
        return true;
      } else {
        return r.status === filter;
      }
    });

    if (filtered.length === 0) {
      const msg =
        filter === 'ACTIVE'
          ? 'No active student referrals found. (Closed referrals can be viewed via status filter)'
          : `No student referrals found matching "${filter}".`;
      referralsTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="p-8 text-center text-slate-400 text-xs">
            ${msg}
          </td>
        </tr>
      `;
      return;
    }

    referralsTableBody.innerHTML = filtered
      .map(r => {
        const stageStyles = {
          Referred: 'bg-amber-50 text-amber-700 border-amber-200/80',
          'Call Slip Issued': 'bg-blue-50 text-blue-700 border-blue-200/80',
          'Intake Conducted': 'bg-purple-50 text-purple-700 border-purple-200/80',
          Closed: 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
        };

        const dateStr = formatDateIso(r.createdAt) || 'Recent';

        return `
 <tr class="hover:bg-slate-50/60 transition">
 <td class="py-3 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">${escapeHtml(dateStr)}</td>
 <td class="py-3 px-4">
 <div class="font-bold text-slate-900">${escapeHtml(r.studentName)}</div>
 <div class="text-[11px] text-slate-500">${escapeHtml(r.studentNumber)} • ${escapeHtml(r.program)}</div>
 </td>
 <td class="py-3 px-4 text-slate-700 font-medium">${escapeHtml(r.subjectCourse || 'General')}</td>
 <td class="py-3 px-4 text-slate-800 font-medium">${escapeHtml(r.reasonCategory)}</td>
 <td class="py-3 px-4">
 <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${stageStyles[r.status] || stageStyles.Referred}">
 ${escapeHtml(r.status)}
 </span>
 </td>
 <td class="py-3 px-4 text-right">
 <button data-view-id="${escapeHtml(r.id)}" class="btn-view-ref px-2.5 py-1 rounded text-xs font-medium text-slate-700 hover:bg-slate-100 border border-slate-200 transition">
 View
 </button>
 </td>
 </tr>
 `;
      })
      .join('');

    document.querySelectorAll('.btn-view-ref').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-view-id');
        const referral = cachedReferrals.find(r => r.id === id);
        if (referral) openViewReferralModal(referral);
      });
    });
  }

  const referralModal = document.getElementById('referral-modal');
  const btnOpenReferralModal = document.getElementById('btn-open-referral-modal');
  const btnCloseReferral = document.getElementById('btn-close-referral');
  const btnCancelReferral = document.getElementById('btn-cancel-referral');
  const referralForm = document.getElementById('referral-form');

  btnOpenReferralModal?.addEventListener('click', () => {
    referralModal?.classList.remove('hidden');
  });

  const refReasonCategory = document.getElementById('ref-reason-category');
  const refReasonOtherContainer = document.getElementById('ref-reason-other-container');
  const refReasonOther = document.getElementById('ref-reason-other');

  refReasonCategory?.addEventListener('change', () => {
    if (refReasonCategory.value === 'Others') {
      refReasonOtherContainer?.classList.remove('hidden');
      if (refReasonOther) {
        refReasonOther.required = true;
        refReasonOther.focus();
      }
    } else {
      refReasonOtherContainer?.classList.add('hidden');
      if (refReasonOther) {
        refReasonOther.required = false;
        refReasonOther.value = '';
      }
    }
  });

  const closeReferralModal = () => {
    referralModal?.classList.add('hidden');
    referralForm?.reset();
    refReasonOtherContainer?.classList.add('hidden');
    if (refReasonOther) {
      refReasonOther.required = false;
      refReasonOther.value = '';
    }
  };

  const refStudentNumberInput = document.getElementById('ref-student-number');
  refStudentNumberInput?.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^0-9-]/g, '');
  });
  refStudentNumberInput?.addEventListener('keydown', e => {
    if (
      ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) ||
      e.ctrlKey ||
      e.metaKey
    )
      return;
    if (!/[0-9-]/.test(e.key)) e.preventDefault();
  });

  btnCloseReferral?.addEventListener('click', closeReferralModal);
  btnCancelReferral?.addEventListener('click', closeReferralModal);

  referralForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const studentName = document.getElementById('ref-student-name')?.value.trim();
    const studentNumber = document.getElementById('ref-student-number')?.value.trim();
    const program = document.getElementById('ref-student-program')?.value.trim();
    const subjectCourse = document.getElementById('ref-subject-course')?.value.trim();
    let reasonCategory = document.getElementById('ref-reason-category')?.value;
    const otherReason = document.getElementById('ref-reason-other')?.value.trim();
    const specificObservations = document.getElementById('ref-observations')?.value.trim();

    if (reasonCategory === 'Others') {
      if (!otherReason) {
        showToast('Please specify the other reason/concern.', 'error');
        document.getElementById('ref-reason-other')?.focus();
        return;
      }
      reasonCategory = `Other: ${otherReason}`;
    }

    try {
      await createReferral({
        facultyId: currentUser.uid,
        facultyName: currentUser.fullName,
        facultyEmail: currentUser.email,
        studentName,
        studentNumber,
        program,
        subjectCourse,
        reasonCategory,
        specificObservations
      });

      await logAuditEvent(
        currentUser.uid,
        currentUser.fullName,
        currentUser.role,
        'REFERRAL_SUBMITTED',
        `Submitted referral for ${studentName} (${studentNumber})`
      );

      closeReferralModal();
      showToast(`Referral for ${studentName} submitted.`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to submit referral', 'error');
    }
  });

  const viewReferralModal = document.getElementById('view-referral-modal');
  const btnCloseViewReferral = document.getElementById('btn-close-view-referral');
  const viewReferralContent = document.getElementById('view-referral-content');

  btnCloseViewReferral?.addEventListener('click', () => {
    viewReferralModal?.classList.add('hidden');
  });

  function openViewReferralModal(referral) {
    if (!viewReferralContent) return;

    viewReferralContent.innerHTML = `
 <div class="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-1.5 text-xs">
 <div class="flex justify-between">
 <span class="text-slate-400">Student:</span>
 <span class="font-bold text-slate-900">${escapeHtml(referral.studentName)} (${escapeHtml(referral.studentNumber)})</span>
 </div>
 <div class="flex justify-between">
 <span class="text-slate-400">Program / Course:</span>
 <span class="font-medium text-slate-700">${escapeHtml(referral.program)} • ${escapeHtml(referral.subjectCourse)}</span>
 </div>
 <div class="flex justify-between">
 <span class="text-slate-400">Category:</span>
 <span class="font-medium text-slate-900">${escapeHtml(referral.reasonCategory)}</span>
 </div>
 <div class="pt-1">
 <span class="text-slate-400 block mb-0.5">Observations:</span>
 <p class="bg-white p-2 rounded border border-slate-200 text-slate-700 italic">
 "${escapeHtml(referral.specificObservations)}"
 </p>
 </div>
 </div>

 <div class="p-3.5 rounded-lg border bg-white border-slate-200 text-xs space-y-1">
 <div class="font-bold text-slate-900 flex items-center justify-between">
 <span>Milestone Stage:</span>
 <span class="text-slate-700">${referral.status}</span>
 </div>
 
 ${
   referral.callSlipAppointmentDate
     ? `
 <div class="text-[11px] text-slate-600 pt-1 space-y-0.5">
 <p><strong>Scheduled Consultation:</strong> ${referral.callSlipAppointmentDate} at ${referral.callSlipAppointmentTime || 'TBD'}</p>
 <p><strong>Counselor:</strong> ${referral.assignedCounselor || 'Registered Counselor'}</p>
 </div>
 `
     : `
 <p class="text-[11px] text-slate-400 pt-0.5">The Guidance Office is evaluating this referral.</p>
 `
 }
 </div>

 <div class="text-[10px] text-slate-400 italic">
 * In compliance with RA 9258, specific clinical session notes are strictly confidential to counselors.
 </div>
 `;

    viewReferralModal?.classList.remove('hidden');
  }
});
