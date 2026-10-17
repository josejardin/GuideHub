import { requireRole, initNavbar, showToast } from './auth.js';
import { db, doc, updateDoc, collection, query, where, onSnapshot } from './firebase-config.js';
import {
  createAppointment,
  subscribeStudentAppointments,
  checkSlotAvailable,
  getAvailableCounselorsForSlot,
  getCounselors,
  updateAppointmentStatus,
  generateWalkInTicket,
  subscribeLiveWalkInQueue,
  updateWalkInStatus,
  subscribeAllCounselorSchedules,
  subscribeAllAppointments,
  logAuditEvent
} from './db.js';
import { escapeHtml, formatDateIso, formatTimeSlot12h, normalizeTimeSlot } from './utils/validation.js';

document.addEventListener('DOMContentLoaded', () => {
  const currentUser = requireRole(['student']);
  if (!currentUser) return;

  initNavbar('navbar-container', 'student');

  const welcomeText = document.getElementById('student-welcome-text');
  if (welcomeText) {
    welcomeText.textContent = `${currentUser.fullName} (${currentUser.studentOrEmpId || 'Student'}) • ${currentUser.program || 'Student Workspace'}`;
  }

  window.addEventListener('guidehub_profile_updated', e => {
    const updated = e.detail?.user;
    if (updated && welcomeText) {
      welcomeText.textContent = `${updated.fullName} (${updated.studentOrEmpId || 'Student'}) • ${updated.program || 'Student Workspace'}`;
    }
  });

  const counselorSelect = document.getElementById('counselorSelect');

  document.querySelectorAll('input[name="counselor_pref"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (currentStep === 2) {
        updateCounselorsForChosenSlot();
      }
    });
  });

  document.getElementById('btn-edit-schedule')?.addEventListener('click', () => {
    currentStep = 1;
    renderStep();
  });

  const followUpBanner = document.getElementById('followUpBanner');
  const followUpCounselorName = document.getElementById('followUpCounselorName');
  const followUpTargetDate = document.getElementById('followUpTargetDate');
  const btnDismissFollowUp = document.getElementById('btn-dismiss-followup');
  const btnBookFollowUpSlot = document.getElementById('btn-book-followup-slot');

  let activeFollowUpData = null;

  if (db && currentUser.uid) {
    const userDocRef = doc(db, 'users', currentUser.uid);
    onSnapshot(
      userDocRef,
      docSnap => {
        if (docSnap.exists()) {
          const userData = docSnap.data();
          const followUp = userData.activeFollowUp;
          if (followUp && followUp.status === 'scheduled' && followUp.date) {
            activeFollowUpData = followUp;
            if (followUpBanner) {
              followUpBanner.classList.remove('hidden');
              if (followUpCounselorName) {
                followUpCounselorName.textContent = `by ${followUp.counselorName || 'Guidance Counselor'}`;
              }
              if (followUpTargetDate) {
                followUpTargetDate.textContent = followUp.date;
              }
              if (window.lucide) window.lucide.createIcons();
            }
          } else {
            activeFollowUpData = null;
            followUpBanner?.classList.add('hidden');
          }
        }
      },
      err => {
        console.warn('User follow-up listener notice:', err);
      }
    );
  }

  window.dismissFollowUpNotice = async function () {
    if (followUpBanner) followUpBanner.classList.add('hidden');
    if (db && currentUser.uid) {
      try {
        await updateDoc(doc(db, 'users', currentUser.uid), {
          'activeFollowUp.status': 'dismissed'
        });
        showToast('Follow-up reminder dismissed.', 'info');
      } catch (e) {
        console.warn('Dismiss follow-up error:', e);
      }
    }
  };
  btnDismissFollowUp?.addEventListener('click', window.dismissFollowUpNotice);

  window.openBookModalForFollowUp = function () {
    consentModal?.classList.add('hidden');
    openWizard();
    if (activeFollowUpData) {
      const dateInput = document.getElementById('wiz-schedule-date');
      if (dateInput && activeFollowUpData.date) {
        dateInput.value = activeFollowUpData.date;
        validateDateAndLoadSlots();
      }

      if (counselorSelect && activeFollowUpData.counselorId) {
        counselorSelect.value = activeFollowUpData.counselorId;
      }

      const concernSelect = document.getElementById('wiz-concern-category');
      if (concernSelect) {
        concernSelect.value = 'Relationship & Personal';
      }
      const concernDetails = document.getElementById('wiz-concern-details');
      if (concernDetails) {
        concernDetails.value = `Follow-Up Consultation recommended by ${activeFollowUpData.counselorName || 'Counselor'}.`;
      }
    }
  };
  btnBookFollowUpSlot?.addEventListener('click', window.openBookModalForFollowUp);

  let cachedAppointments = [];
  const appointmentsListEl = document.getElementById('appointments-list');
  const statusFilterEl = document.getElementById('appointment-status-filter');

  subscribeStudentAppointments(currentUser, appointments => {
    cachedAppointments = appointments;
    renderAppointments();
  });

  statusFilterEl?.addEventListener('change', renderAppointments);

  function renderAppointments() {
    if (!appointmentsListEl) return;
    const filter = statusFilterEl?.value || 'ACTIVE';
    const filtered = cachedAppointments.filter(a => {
      const s = (a.status || 'pending').toLowerCase();
      if (filter === 'ACTIVE') {
        return s === 'pending' || s === 'confirmed';
      } else if (filter === 'ALL') {
        return true;
      } else {
        return s === filter.toLowerCase();
      }
    });

    if (filtered.length === 0) {
      const msg =
        filter === 'ACTIVE'
          ? "You don't have any active appointments right now. Whenever you need someone to talk to, we're always here to listen."
          : `No conversations found matching "${filter}".`;
      appointmentsListEl.innerHTML = `
        <div class="p-8 text-center text-slate-400 text-xs">
          ${msg}
        </div>
      `;
      return;
    }

    appointmentsListEl.innerHTML = filtered
      .map(apt => {
        const statusLower = (apt.status || 'pending').toLowerCase();
        const badgeStyles = {
          pending: 'bg-amber-50 text-amber-700 border-amber-200/80',
          confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
          completed: 'bg-slate-100 text-slate-700 border-slate-200/80',
          cancelled: 'bg-rose-50 text-rose-700 border-rose-200/80',
          'no-show': 'bg-slate-100 text-slate-500 border-slate-200/80'
        };

        const isPending = statusLower === 'pending';
        const isConfirmed = statusLower === 'confirmed';
        const isCancelled = statusLower === 'cancelled';

        const scheduledTime = getAppointmentScheduledDate(apt);
        const now = new Date();
        const hoursRemaining = scheduledTime ? (scheduledTime.getTime() - now.getTime()) / (1000 * 60 * 60) : 0;

        // Pending can be cancelled anytime (with reason).
        // Confirmed can only be cancelled if more than 24 hours (1 day) remain before the session.
        const canCancelConfirmed = isConfirmed && hoursRemaining >= 24;
        const isLockedConfirmed = isConfirmed && hoursRemaining < 24;

        return `
          <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 transition">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-bold text-xs text-slate-900">${escapeHtml(apt.concernCategory)}</span>
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${badgeStyles[statusLower] || badgeStyles.pending}">
                  ${escapeHtml(apt.status)}
                </span>
                ${apt.isWalkIn ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[#00205B] text-[#F5B800]">Walk-In</span>' : ''}
                ${apt.followUpDate ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">Follow-up: ${escapeHtml(apt.followUpDate)}</span>` : ''}
              </div>
              
              <div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span>Date: <strong class="text-slate-700">${escapeHtml(apt.date)}</strong></span>
                <span>Time: <strong class="text-slate-700">${escapeHtml(formatTimeSlot12h(apt.timeSlot))}</strong></span>
                <span>Counselor: <strong class="text-slate-700">${escapeHtml(apt.counselorName || 'Assigned Counselor')}</strong></span>
              </div>

              ${apt.specificConcern ? `<p class="text-[11px] text-slate-600 italic mt-1">"${escapeHtml(apt.specificConcern)}"</p>` : ''}

              ${
                isCancelled && apt.cancellationReason
                  ? `
                <div class="text-[11px] text-rose-700 bg-rose-50/80 border border-rose-200 rounded-lg p-2 mt-1.5 flex items-start gap-1.5">
                  <i data-lucide="info" class="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5"></i>
                  <div>
                    <strong class="text-rose-900">Cancellation Reason:</strong>
                    <span class="text-rose-800">"${escapeHtml(apt.cancellationReason)}"</span>
                    ${apt.cancelledAt ? `<span class="block text-[10px] text-rose-500 mt-0.5">Recorded: ${escapeHtml(formatDateIso(apt.cancelledAt))}</span>` : ''}
                  </div>
                </div>
                `
                  : ''
              }
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2 self-end sm:self-center">
              ${
                isPending
                  ? `
                <button data-cancel-id="${escapeHtml(apt.id)}" class="btn-cancel-apt px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-50 border border-rose-200 transition shadow-sm" title="Cancel this pending request">
                  Cancel Request
                </button>
                `
                  : ''
              }
              ${
                canCancelConfirmed
                  ? `
                <div class="flex flex-col items-end gap-1">
                  <button data-cancel-id="${escapeHtml(apt.id)}" class="btn-cancel-apt px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-50 border border-rose-200 transition shadow-sm" title="Cancel this confirmed appointment (Requires reason)">
                    Cancel Appointment
                  </button>
                  <span class="text-[10px] text-slate-400">Can cancel until 24h prior</span>
                </div>
                `
                  : ''
              }
              ${
                isLockedConfirmed
                  ? `
                <div class="flex flex-col items-end gap-1">
                  <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium" title="Cancellations are locked within 24 hours of the session.">
                    <i data-lucide="lock" class="w-3.5 h-3.5 text-amber-600 shrink-0"></i>
                    <span>Locked (Within 24h)</span>
                  </div>
                  <span class="text-[10px] text-slate-400">For urgent concerns, contact Guidance</span>
                </div>
                `
                  : ''
              }
            </div>
          </div>
        `;
      })
      .join('');

    if (window.lucide) window.lucide.createIcons();

    document.querySelectorAll('.btn-cancel-apt').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-cancel-id');
        const apt = cachedAppointments.find(a => a.id === id);
        if (apt) openCancelModalFor(apt);
      });
    });
  }

  function getAppointmentScheduledDate(apt) {
    if (!apt || !apt.date) return null;
    const norm = normalizeTimeSlot(apt.timeSlot || '08:00');
    let timeStr = '08:00';
    if (norm.includes('-')) {
      timeStr = norm.split('-')[0].trim();
    } else if (norm) {
      timeStr = norm.trim();
    }
    return new Date(`${apt.date}T${timeStr}:00`);
  }

  // --- Cancel Appointment Modal Logic ---
  const modalCancelApt = document.getElementById('modal-cancel-appointment');
  const formCancelApt = document.getElementById('cancel-appointment-form');
  const btnCloseCancelModal = document.getElementById('btn-close-cancel-modal');
  const btnAbortCancel = document.getElementById('btn-abort-cancel');
  const cancelAptCategory = document.getElementById('cancel-apt-category');
  const cancelAptDateTime = document.getElementById('cancel-apt-datetime');
  const cancelAptCounselor = document.getElementById('cancel-apt-counselor');
  const cancelReasonPreset = document.getElementById('cancel-reason-preset');
  const cancelReasonDetails = document.getElementById('cancel-reason-details');
  const btnConfirmCancelApt = document.getElementById('btn-confirm-cancel-apt');

  let activeCancellingAppointment = null;

  function closeCancelModal() {
    if (!modalCancelApt) return;
    modalCancelApt.classList.add('hidden');
    activeCancellingAppointment = null;
    if (cancelReasonPreset) cancelReasonPreset.value = '';
    if (cancelReasonDetails) cancelReasonDetails.value = '';
  }

  function openCancelModalFor(apt) {
    if (!modalCancelApt || !apt) return;
    activeCancellingAppointment = apt;

    if (cancelAptCategory) cancelAptCategory.textContent = apt.concernCategory || 'Counseling Session';
    if (cancelAptDateTime) cancelAptDateTime.textContent = `${apt.date || 'Scheduled Date'} (${formatTimeSlot12h(apt.timeSlot) || 'Scheduled Time'})`;
    if (cancelAptCounselor) cancelAptCounselor.textContent = apt.counselorName || 'Assigned Counselor';
    if (cancelReasonPreset) cancelReasonPreset.value = '';
    if (cancelReasonDetails) cancelReasonDetails.value = '';

    modalCancelApt.classList.remove('hidden');
    if (cancelReasonPreset) cancelReasonPreset.focus();
    if (window.lucide) window.lucide.createIcons();
  }

  btnCloseCancelModal?.addEventListener('click', closeCancelModal);
  btnAbortCancel?.addEventListener('click', closeCancelModal);
  modalCancelApt?.addEventListener('click', e => {
    if (e.target === modalCancelApt) closeCancelModal();
  });

  formCancelApt?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!activeCancellingAppointment) return;

    const preset = cancelReasonPreset?.value;
    const details = (cancelReasonDetails?.value || '').trim();

    if (!preset) {
      showToast('Please select a reason for cancellation.', 'error');
      cancelReasonPreset?.focus();
      return;
    }

    if (!details) {
      showToast('Please provide a brief explanation for your assigned counselor.', 'error');
      cancelReasonDetails?.focus();
      return;
    }

    const fullReason = `${preset} — ${details}`;

    if (btnConfirmCancelApt) {
      btnConfirmCancelApt.disabled = true;
      btnConfirmCancelApt.innerHTML = '<span>Cancelling...</span>';
    }

    try {
      await updateAppointmentStatus(activeCancellingAppointment.id, 'Cancelled', {
        cancellationReason: fullReason,
        cancelledBy: currentUser.fullName || 'Student',
        cancelledByRole: 'student',
        cancelledAt: new Date().toISOString()
      });

      await logAuditEvent(
        currentUser.uid,
        currentUser.fullName,
        currentUser.role,
        'APPOINTMENT_CANCELLED',
        `Student cancelled appointment ${activeCancellingAppointment.id}. Reason: ${fullReason}`
      );

      showToast('Appointment cancelled successfully.', 'info');
      closeCancelModal();
    } catch (err) {
      console.error('Cancellation error:', err);
      showToast('Failed to cancel appointment. Please try again.', 'error');
    } finally {
      if (btnConfirmCancelApt) {
        btnConfirmCancelApt.disabled = false;
        btnConfirmCancelApt.innerHTML = '<i data-lucide="x-circle" class="w-3.5 h-3.5"></i><span>Confirm Cancellation</span>';
        if (window.lucide) window.lucide.createIcons();
      }
    }
  });

  const walkinModal = document.getElementById('walkin-modal');
  const openWalkinBtn = document.getElementById('btn-open-walkin-modal');
  const closeWalkinBtn = document.getElementById('btn-close-walkin');
  const walkinForm = document.getElementById('walkin-form');
  const activeQueueCard = document.getElementById('active-queue-card');
  const queueTicketNum = document.getElementById('queue-ticket-num');
  const queueStatusText = document.getElementById('queue-status-text');
  const queueDetailText = document.getElementById('queue-detail-text');
  const btnCancelTicket = document.getElementById('btn-cancel-ticket');

  let activeUserTicket = null;

  openWalkinBtn?.addEventListener('click', () => {
    walkinModal?.classList.remove('hidden');
    const sName = document.getElementById('walkin-student-name');
    const sId = document.getElementById('walkin-student-id');
    const sProg = document.getElementById('walkin-student-program');
    const sPhone = document.getElementById('walkin-student-phone');

    if (sName) sName.value = currentUser.fullName;
    if (sId) sId.value = currentUser.studentOrEmpId || '';
    if (sProg) sProg.value = currentUser.program || '';
    if (sPhone) sPhone.value = currentUser.contactNumber || '';
  });

  closeWalkinBtn?.addEventListener('click', () => {
    walkinModal?.classList.add('hidden');
  });

  walkinForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const concernCategory =
      document.getElementById('walkin-concern')?.value ||
      document.getElementById('walkin-concern-type')?.value ||
      'General Guidance Inquiry';

    try {
      const ticket = await generateWalkInTicket({
        studentId: currentUser.uid,
        studentName: currentUser.fullName,
        studentNumber: currentUser.studentOrEmpId || 'N/A',
        program: currentUser.program || 'Student',
        gender: currentUser.gender || 'Not Specified',
        contactNumber: currentUser.contactNumber || '',
        concernCategory
      });

      await logAuditEvent(
        currentUser.uid,
        currentUser.fullName,
        currentUser.role,
        'WALKIN_TICKET_GENERATED',
        `Generated ticket ${ticket.ticketNumber} (${concernCategory})`
      );

      walkinModal?.classList.add('hidden');
      showToast(`Walk-in ticket ${ticket.ticketNumber} generated!`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to join walk-in queue', 'error');
    }
  });

  subscribeLiveWalkInQueue(queueList => {
    const myTicket = queueList.find(
      t =>
        t.studentId === currentUser.uid &&
        (t.status === 'Waiting' || t.status === 'Calling' || t.status === 'In-Session')
    );
    activeUserTicket = myTicket || null;

    if (myTicket) {
      activeQueueCard?.classList.remove('hidden');
      if (queueTicketNum) queueTicketNum.textContent = myTicket.ticketNumber;

      if (myTicket.status === 'Calling') {
        if (queueStatusText) queueStatusText.textContent = 'NOW CALLING: Please proceed to Counselor Room';
        if (queueDetailText) queueDetailText.textContent = 'Your assigned counselor is ready for consultation.';
      } else if (myTicket.status === 'In-Session') {
        if (queueStatusText) queueStatusText.textContent = 'Session In Progress';
        if (queueDetailText) queueDetailText.textContent = 'Consultation currently underway.';
      } else {
        if (queueStatusText) queueStatusText.textContent = 'You are currently waiting in queue';
        const waitingAhead = queueList.filter(
          t => t.status === 'Waiting' && new Date(t.createdAt) < new Date(myTicket.createdAt)
        ).length;
        if (queueDetailText) queueDetailText.textContent = `${waitingAhead} student(s) ahead of you in queue.`;
      }
    } else {
      activeQueueCard?.classList.add('hidden');
    }
  });

  btnCancelTicket?.addEventListener('click', async () => {
    if (activeUserTicket && confirm('Cancel your active walk-in ticket?')) {
      await updateWalkInStatus(activeUserTicket.id, 'Cancelled');
      showToast('Ticket cancelled.', 'info');
    }
  });

  const consentModal = document.getElementById('consent-modal');
  const wizardModal = document.getElementById('wizard-modal');
  const btnOpenWizardModal = document.getElementById('btn-open-wizard-modal');
  const consentCheckbox = document.getElementById('consent-checkbox');
  const btnProceedBooking = document.getElementById('btn-proceed-booking');
  const btnCancelConsent = document.getElementById('btn-cancel-consent');
  const btnCloseWizard = document.getElementById('btn-close-wizard');

  let currentStep = 1;
  let selectedSlot = null;

  btnOpenWizardModal?.addEventListener('click', () => {
    consentModal?.classList.remove('hidden');
    if (consentCheckbox) consentCheckbox.checked = false;
    if (btnProceedBooking) btnProceedBooking.disabled = true;
  });

  consentCheckbox?.addEventListener('change', e => {
    if (btnProceedBooking) btnProceedBooking.disabled = !e.target.checked;
  });

  btnCancelConsent?.addEventListener('click', () => consentModal?.classList.add('hidden'));

  btnProceedBooking?.addEventListener('click', () => {
    consentModal?.classList.add('hidden');
    openWizard();
  });

  btnCloseWizard?.addEventListener('click', () => wizardModal?.classList.add('hidden'));

  document.getElementById('wiz-btn-edit-profile')?.addEventListener('click', () => {
    wizardModal?.classList.add('hidden');
  });

  const dateInputInit = document.getElementById('wiz-schedule-date');
  dateInputInit?.addEventListener('change', () => {
    selectedSlot = null;
    validateDateAndLoadSlots();
  });

  function openWizard() {
    currentStep = 1;
    selectedSlot = null;
    wizardModal?.classList.remove('hidden');

    const displayName = document.getElementById('wiz-display-name');
    const displayId = document.getElementById('wiz-display-id');
    const displayProg = document.getElementById('wiz-display-program');

    if (displayName) displayName.textContent = currentUser.fullName || 'Student';
    if (displayId) displayId.textContent = currentUser.studentOrEmpId || 'N/A';
    if (displayProg) displayProg.textContent = currentUser.program || 'Student';

    const dateInput = document.getElementById('wiz-schedule-date');
    if (dateInput) {
      const today = new Date();
      dateInput.min = today.toISOString().split('T')[0];

      let d = new Date();
      d.setDate(d.getDate() + 1);
      if (d.getDay() === 0) d.setDate(d.getDate() + 1);
      if (d.getDay() === 6) d.setDate(d.getDate() + 2);
      dateInput.value = d.toISOString().split('T')[0];
    }

    renderStep();
  }

  const TIME_SLOTS = [
    '8:00 AM - 9:00 AM',
    '9:00 AM - 10:00 AM',
    '10:00 AM - 11:00 AM',
    '11:00 AM - 12:00 PM',
    '1:00 PM - 2:00 PM',
    '2:00 PM - 3:00 PM',
    '3:00 PM - 4:00 PM',
    '4:00 PM - 5:00 PM'
  ];

  async function validateDateAndLoadSlots() {
    const dateInput = document.getElementById('wiz-schedule-date');
    const slotContainer = document.getElementById('slot-container');
    if (!dateInput || !slotContainer) return;

    const chosenDate = new Date(dateInput.value + 'T00:00:00');
    const dayOfWeek = chosenDate.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      showToast('Guidance Office is closed on weekends. Select Mon-Fri.', 'warning');
      slotContainer.innerHTML = `<p class="col-span-4 text-[11px] text-rose-500 py-1.5">Office is closed on weekends.</p>`;
      selectedSlot = null;
      return;
    }

    slotContainer.innerHTML = `<div class="col-span-4 text-[11px] text-slate-400 py-2">Checking schedule availability...</div>`;

    let html = '';
    for (const slot of TIME_SLOTS) {
      const isAvailable = await checkSlotAvailable(dateInput.value, slot, 'any', 'Any');
      const isSelected = selectedSlot === slot;
      const slotDisplay = formatTimeSlot12h(slot);

      if (isAvailable) {
        html += `
          <button type="button" data-slot="${slot}" class="btn-slot p-2 rounded text-xs font-medium border transition ${isSelected ? 'bg-[#00205B] text-[#F5B800] border-[#00205B] font-bold shadow-xs' : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'}">
            ${slotDisplay}
          </button>
        `;
      } else {
        html += `
          <button type="button" disabled class="p-2 rounded text-xs font-medium bg-rose-50/60 text-rose-400 border border-rose-100 cursor-not-allowed line-through" title="All counselors blocked / unavailable at this time">
            ${slotDisplay}
          </button>
        `;
      }
    }

    slotContainer.innerHTML = html;

    document.querySelectorAll('.btn-slot').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedSlot = btn.getAttribute('data-slot');
        validateDateAndLoadSlots();
      });
    });
  }

  async function updateCounselorsForChosenSlot() {
    const dateInput = document.getElementById('wiz-schedule-date');
    const summaryDateTime = document.getElementById('wiz-summary-datetime');
    const noticeEl = document.getElementById('counselor-availability-notice');
    if (!counselorSelect || !dateInput) return;

    if (summaryDateTime) {
      summaryDateTime.textContent = `${dateInput.value} (${formatTimeSlot12h(selectedSlot) || 'No slot selected'})`;
    }

    if (!selectedSlot) {
      counselorSelect.innerHTML = '<option value="" disabled selected>Please select a time slot first</option>';
      return;
    }

    const chosenPref = document.querySelector('input[name="counselor_pref"]:checked')?.value || 'Any';
    counselorSelect.innerHTML = '<option value="" disabled selected>Loading available counselors...</option>';
    if (noticeEl) noticeEl.classList.add('hidden');

    try {
      const availableCounselors = await getAvailableCounselorsForSlot(dateInput.value, selectedSlot, chosenPref);

      if (availableCounselors.length === 0) {
        counselorSelect.innerHTML = '<option value="" disabled selected>No counselors available for this selection</option>';
        if (noticeEl) {
          const prefDesc = chosenPref !== 'Any' ? `${chosenPref} ` : '';
          noticeEl.textContent = `No ${prefDesc}guidance counselors are available at ${formatTimeSlot12h(selectedSlot)} on ${dateInput.value}. Please choose another schedule or select another gender preference.`;
          noticeEl.classList.remove('hidden');
        }
        return;
      }

      let html = `<option value="any">Any Available Counselor (${availableCounselors.length} available)</option>`;
      availableCounselors.forEach(c => {
        const genderTag = c.gender ? `${c.gender} • ` : '';
        html += `<option value="${c.id || c.uid}" data-name="${escapeHtml(c.fullName)}" data-gender="${c.gender || 'Any'}">${escapeHtml(c.fullName)} (${genderTag}${escapeHtml(c.department || 'Guidance Center')})</option>`;
      });

      counselorSelect.innerHTML = html;
      counselorSelect.value = 'any';
    } catch (err) {
      console.warn('Error loading counselors for slot:', err);
      counselorSelect.innerHTML = '<option value="any">Any Available Counselor (Fastest Matching)</option>';
    }
  }

  function renderStep() {
    for (let i = 1; i <= 3; i++) {
      const content = document.getElementById(`step-content-${i}`);
      const indicator = document.querySelector(`.step-item[data-step="${i}"] span`);
      if (content) {
        if (i === currentStep) content.classList.remove('hidden');
        else content.classList.add('hidden');
      }
      if (indicator) {
        if (i === currentStep) {
          indicator.className = 'text-[10px] font-bold text-[#00205B] block';
        } else if (i < currentStep) {
          indicator.className = 'text-[10px] font-semibold text-emerald-600 block';
        } else {
          indicator.className = 'text-[10px] font-medium text-slate-400 block';
        }
      }
    }

    const btnPrev = document.getElementById('btn-wiz-prev');
    const btnNext = document.getElementById('btn-wiz-next');

    if (btnPrev) btnPrev.disabled = currentStep === 1;
    if (btnNext) {
      btnNext.textContent = currentStep === 3 ? 'Confirm & Book Appointment' : 'Next Step';
    }

    if (currentStep === 1) {
      validateDateAndLoadSlots();
    }

    if (currentStep === 2) {
      updateCounselorsForChosenSlot();
    }

    if (currentStep === 3) {
      const dateInput = document.getElementById('wiz-schedule-date');
      const rDate = document.getElementById('wiz-review-date');
      const rSlot = document.getElementById('wiz-review-slot');
      const rCounselor = document.getElementById('wiz-review-counselor');
      const rStudent = document.getElementById('wiz-review-student');

      const chosenOption = counselorSelect?.selectedOptions[0];
      const counselorLabel =
        counselorSelect?.value === 'any'
          ? 'Any Available Counselor (Auto-assigned)'
          : chosenOption?.dataset?.name || chosenOption?.text || 'Guidance Counselor';

      if (rDate && dateInput) rDate.textContent = dateInput.value;
      if (rSlot) rSlot.textContent = selectedSlot || 'N/A';
      if (rCounselor) rCounselor.textContent = counselorLabel;
      if (rStudent) rStudent.textContent = `${currentUser.fullName} (${currentUser.studentOrEmpId || 'ID'} • ${currentUser.program || 'Student'})`;
    }

    if (window.lucide) window.lucide.createIcons();
  }

  document.getElementById('btn-wiz-prev')?.addEventListener('click', () => {
    if (currentStep > 1) {
      currentStep--;
      renderStep();
    }
  });

  document.getElementById('btn-wiz-next')?.addEventListener('click', async () => {
    if (currentStep === 1) {
      if (!selectedSlot) {
        showToast('Please choose an available 1-hour time slot.', 'warning');
        return;
      }
      currentStep++;
      renderStep();
      return;
    }

    if (currentStep === 2) {
      if (!counselorSelect || !counselorSelect.value) {
        showToast('Please select an available guidance counselor or choose another slot.', 'warning');
        return;
      }
      currentStep++;
      renderStep();
      return;
    }

    if (currentStep === 3) {
      const studentProgram = currentUser.program || 'Student';
      const studentContact = currentUser.contactNumber || '';
      const studentGender = currentUser.gender || 'Not Specified';
      const counselorPref = document.querySelector('input[name="counselor_pref"]:checked')?.value || 'Any';
      const date = document.getElementById('wiz-schedule-date')?.value;
      const concernCategory = document.getElementById('wiz-concern-category')?.value;
      const academicCycle = document.getElementById('wiz-academic-cycle')?.value;
      const specificConcern = document.getElementById('wiz-concern-details')?.value;

      let chosenCounselorId = counselorSelect?.value || 'any';
      const chosenCounselorOption = counselorSelect?.selectedOptions[0];
      let chosenCounselorName =
        chosenCounselorId === 'any'
          ? 'Any Available Counselor'
          : chosenCounselorOption?.dataset?.name || chosenCounselorOption?.text || 'Assigned Counselor';

      if (chosenCounselorId === 'any') {
        const available = await getAvailableCounselorsForSlot(date, selectedSlot, counselorPref);
        if (available.length > 0) {
          chosenCounselorId = available[0].id || available[0].uid;
          chosenCounselorName = available[0].fullName;
        }
      }

      // Final real-time check to prevent booking an emergency-blocked slot
      const isStillAvailable = await checkSlotAvailable(date, selectedSlot, chosenCounselorId, counselorPref);
      if (!isStillAvailable) {
        showToast('Sorry! This time slot was just blocked by the guidance counselor due to an emergency. Please choose another slot.', 'error');
        currentStep = 1;
        renderStep();
        return;
      }

      try {
        await createAppointment({
          studentId: currentUser.uid,
          studentAuthUid: currentUser.authUid || currentUser.uid,
          studentEmail: currentUser.email || '',
          studentName: currentUser.fullName,
          studentNumber: currentUser.studentOrEmpId || 'N/A',
          program: studentProgram,
          gender: studentGender,
          contactNumber: studentContact,
          counselorId: chosenCounselorId,
          counselorName: chosenCounselorName,
          counselorGenderPreference: counselorPref,
          date,
          timeSlot: selectedSlot,
          concernCategory,
          academicCycle,
          specificConcern,
          status: 'Pending'
        });

        await logAuditEvent(
          currentUser.uid,
          currentUser.fullName,
          currentUser.role,
          'APPOINTMENT_BOOKED',
          `Booked ${date} (${selectedSlot}) with ${chosenCounselorName} - ${concernCategory}`
        );

        wizardModal?.classList.add('hidden');
        showToast('Appointment request submitted successfully.', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to submit booking', 'error');
      }
    }
  });

  // Real-time synchronization of counselor schedules & emergency blocks
  subscribeAllCounselorSchedules(async () => {
    if (!wizardModal || wizardModal.classList.contains('hidden')) return;
    const dateInput = document.getElementById('wiz-schedule-date');
    if (!dateInput || !dateInput.value) return;

    if (currentStep === 2) {
      if (selectedSlot) {
        const stillFree = await checkSlotAvailable(dateInput.value, selectedSlot, 'any', 'Any');
        if (!stillFree) {
          selectedSlot = null;
          showToast('A counselor just blocked or updated your selected slot. Please select an available slot.', 'warning');
        }
      }
      validateDateAndLoadSlots();
    } else if (currentStep === 3) {
      updateCounselorsForChosenSlot();
    }
  });

  // Real-time synchronization when other appointments are booked
  subscribeAllAppointments(async () => {
    if (!wizardModal || wizardModal.classList.contains('hidden')) return;
    const dateInput = document.getElementById('wiz-schedule-date');
    if (!dateInput || !dateInput.value) return;

    if (currentStep === 2) {
      if (selectedSlot) {
        const stillFree = await checkSlotAvailable(dateInput.value, selectedSlot, 'any', 'Any');
        if (!stillFree) {
          selectedSlot = null;
          showToast('The selected time slot was just booked. Please select an available slot.', 'warning');
        }
      }
      validateDateAndLoadSlots();
    } else if (currentStep === 3) {
      updateCounselorsForChosenSlot();
    }
  });
});
