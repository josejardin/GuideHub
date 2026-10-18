import { requireRole, initNavbar, showToast, showConfirmDialog } from './auth.js';
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

  function parseTimeSlotTo24hParts(timeSlot = '') {
    let startHour = '09', startMin = '00', endHour = '10', endMin = '00';
    if (!timeSlot) return { startHour, startMin, endHour, endMin };

    function parseSingle(str) {
      if (!str) return null;
      const match = String(str).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
      if (!match) return null;
      let h = parseInt(match[1], 10);
      const m = match[2];
      const meridiem = (match[3] || '').toUpperCase();
      if (meridiem === 'PM' && h < 12) h += 12;
      if (meridiem === 'AM' && h === 12) h = 0;
      return { h: String(h).padStart(2, '0'), m };
    }

    if (timeSlot.includes('-')) {
      const [startPart, endPart] = timeSlot.split('-');
      const s = parseSingle(startPart);
      const e = parseSingle(endPart);
      if (s) {
        startHour = s.h;
        startMin = s.m;
      }
      if (e) {
        endHour = e.h;
        endMin = e.m;
      }
    } else {
      const s = parseSingle(timeSlot);
      if (s) {
        startHour = s.h;
        startMin = s.m;
        endHour = String(Math.min(23, parseInt(startHour, 10) + 1)).padStart(2, '0');
        endMin = startMin;
      }
    }
    return { startHour, startMin, endHour, endMin };
  }

  function generateGoogleCalendarUrl(apt) {
    if (!apt || !apt.date) return '#';
    try {
      const cleanDate = apt.date.replace(/-/g, '');
      const { startHour, startMin, endHour, endMin } = parseTimeSlotTo24hParts(apt.timeSlot);
      const startIso = `${cleanDate}T${startHour}${startMin}00`;
      const endIso = `${cleanDate}T${endHour}${endMin}00`;
      const title = encodeURIComponent(`NU Fairview Guidance Consultation with ${apt.counselorName || 'Guidance Counselor'}`);
      const details = encodeURIComponent(
        `Focus / Concern: ${apt.concernCategory || 'General Guidance'}\nVenue: Guidance & Counseling Center (2nd Floor, Main Building)\nReference Code: ${apt.id || 'N/A'}\n\nNote: Please arrive 5-10 minutes before your scheduled session.`
      );
      const location = encodeURIComponent('National University Fairview Guidance & Counseling Office, 2nd Floor, Main Building');
      return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startIso}/${endIso}&ctz=Asia/Manila&details=${details}&location=${location}`;
    } catch (_) {
      return '#';
    }
  }

  function downloadIcsCalendar(apt) {
    if (!apt || !apt.date) return;
    try {
      const cleanDate = apt.date.replace(/-/g, '');
      const { startHour, startMin, endHour, endMin } = parseTimeSlotTo24hParts(apt.timeSlot);
      const startIso = `${cleanDate}T${startHour}${startMin}00`;
      const endIso = `${cleanDate}T${endHour}${endMin}00`;
      const summary = `NU Fairview Guidance Consultation - ${apt.counselorName || 'Guidance Counselor'}`;
      const description = `Consultation Focus: ${apt.concernCategory || 'General Guidance'}\\nVenue: Guidance & Counseling Center (2nd Floor, Main Building)\\nReference Code: ${apt.id || 'N/A'}\\n\\nPlease arrive 5-10 minutes early.`;
      const location = `National University Fairview Guidance & Counseling Office, 2nd Floor, Main Building`;

      const icsLines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//NU Fairview//GuideHub Care Portal//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${apt.id || Date.now()}@guidehub.nu-fairview.edu.ph`,
        `DTSTAMP:${cleanDate}T000000Z`,
        `DTSTART;TZID=Asia/Manila:${startIso}`,
        `DTEND;TZID=Asia/Manila:${endIso}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        `LOCATION:${location}`,
        'STATUS:CONFIRMED',
        'BEGIN:VALARM',
        'TRIGGER:-PT30M',
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder: NU Fairview Guidance Consultation in 30 minutes',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const blob = new Blob([icsLines], { type: 'text/calendar;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `Guidance_Consultation_${apt.date}.ics`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      showToast('Calendar event (.ics) downloaded! Ready to add to Apple Calendar, Outlook, or mobile calendar.', 'success', 'Calendar Ready');
    } catch (e) {
      console.warn('ICS generation error:', e);
      showToast('Could not download calendar file. Please use Google Calendar option.', 'error');
    }
  }

  function renderProgressTracker(statusLower) {
    if (statusLower === 'cancelled') {
      return `
        <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center gap-2 text-[11px] text-rose-700">
          <span class="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
          <span><strong>Consultation Cancelled</strong> • You may book another schedule whenever you feel ready.</span>
        </div>
      `;
    }

    const isStep1Done = true;
    const isStep2Done = statusLower === 'confirmed' || statusLower === 'completed';
    const isStep3Done = statusLower === 'completed';

    return `
      <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 max-w-xs sm:max-w-sm">
        <div class="flex items-center gap-1 ${isStep1Done ? 'text-[#00205B] font-bold' : ''}">
          <span class="w-3.5 h-3.5 rounded-full bg-[#00205B] text-[#F5B800] flex items-center justify-center text-[8px]">✓</span>
          <span>Request Sent</span>
        </div>
        <div class="h-0.5 flex-1 mx-1.5 ${isStep2Done ? 'bg-emerald-500' : 'bg-slate-200'}"></div>
        <div class="flex items-center gap-1 ${isStep2Done ? 'text-emerald-700 font-bold' : (statusLower === 'pending' ? 'text-amber-700 font-bold animate-pulse' : '')}">
          <span class="w-3.5 h-3.5 rounded-full ${isStep2Done ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-800 border border-amber-300'} flex items-center justify-center text-[8px]">
            ${isStep2Done ? '✓' : '2'}
          </span>
          <span>${isStep2Done ? 'Confirmed' : 'In Review'}</span>
        </div>
        <div class="h-0.5 flex-1 mx-1.5 ${isStep3Done ? 'bg-slate-700' : 'bg-slate-200'}"></div>
        <div class="flex items-center gap-1 ${isStep3Done ? 'text-slate-900 font-bold' : ''}">
          <span class="w-3.5 h-3.5 rounded-full ${isStep3Done ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-400'} flex items-center justify-center text-[8px]">
            ${isStep3Done ? '✓' : '3'}
          </span>
          <span>Session Done</span>
        </div>
      </div>
    `;
  }

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
      appointmentsListEl.innerHTML = `
        <div class="p-8 text-center flex flex-col items-center justify-center max-w-md mx-auto space-y-3">
          <div class="w-12 h-12 rounded-2xl bg-blue-50 text-[#00205B] flex items-center justify-center shadow-xs border border-blue-200/60">
            <i data-lucide="heart-handshake" class="w-6 h-6 text-[#00205B]"></i>
          </div>
          <div>
            <h4 class="text-xs font-bold text-slate-800">
              ${filter === 'ACTIVE' ? "You don't have any active appointments right now" : `No records found matching "${filter}"`}
            </h4>
            <p class="text-[11px] text-slate-500 mt-1 leading-relaxed">
              Whenever you're ready to share what's on your mind, our counselors are always here to listen with zero judgment.
            </p>
          </div>
          <button
            type="button"
            id="btn-empty-book-now"
            class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#00205B] hover:bg-[#001845] text-[#F5B800] text-xs font-bold shadow-sm transition active:scale-95"
          >
            <i data-lucide="calendar-plus" class="w-3.5 h-3.5"></i>
            <span>Schedule a Consultation</span>
          </button>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      document.getElementById('btn-empty-book-now')?.addEventListener('click', () => {
        document.getElementById('btn-open-wizard-modal')?.click();
      });
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
            <div class="space-y-1 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
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

              <!-- Visual Progress Stepper -->
              ${renderProgressTracker(statusLower)}

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
            <div class="flex flex-col items-end gap-1.5 self-end sm:self-center shrink-0">
              <div class="flex items-center gap-2">
                ${
                  isConfirmed
                    ? `
                  <a
                    href="${generateGoogleCalendarUrl(apt)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 hover:bg-blue-100 text-[#00205B] border border-blue-200 transition shadow-2xs"
                    title="Add to Google Calendar with automatic reminder"
                  >
                    <i data-lucide="calendar-plus" class="w-3.5 h-3.5 text-blue-600"></i>
                    <span>Google Calendar</span>
                  </a>
                  <button
                    type="button"
                    data-ics-id="${escapeHtml(apt.id)}"
                    class="btn-download-ics inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition shadow-2xs"
                    title="Download .ics file (Apple Calendar, Outlook, Mobile)"
                  >
                    <i data-lucide="download" class="w-3.5 h-3.5 text-slate-600"></i>
                    <span>.ICS Calendar</span>
                  </button>
                  `
                    : ''
                }
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
                  <button data-cancel-id="${escapeHtml(apt.id)}" class="btn-cancel-apt px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-50 border border-rose-200 transition shadow-sm" title="Cancel this confirmed appointment (Requires reason)">
                    Cancel Appointment
                  </button>
                  `
                    : ''
                }
                ${
                  isLockedConfirmed
                    ? `
                  <div class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium" title="Cancellations are locked within 24 hours of the session.">
                    <i data-lucide="lock" class="w-3.5 h-3.5 text-amber-600 shrink-0"></i>
                    <span>Locked (Within 24h)</span>
                  </div>
                  `
                    : ''
                }
              </div>
              ${
                canCancelConfirmed
                  ? `<span class="text-[10px] text-slate-400">Can cancel until 24h prior</span>`
                  : ''
              }
              ${
                isLockedConfirmed
                  ? `<span class="text-[10px] text-slate-400">For urgent concerns, contact Guidance</span>`
                  : ''
              }
            </div>
          </div>
        `;
      })
      .join('');

    if (window.lucide) window.lucide.createIcons();

    document.querySelectorAll('.btn-download-ics').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-ics-id');
        const apt = cachedAppointments.find(a => a.id === id);
        if (apt) downloadIcsCalendar(apt);
      });
    });

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
    if (activeUserTicket && ['Waiting', 'Calling', 'In-Session'].includes(activeUserTicket.status)) {
      showToast(
        `You currently have an active ticket (${activeUserTicket.ticketNumber}) with status "${activeUserTicket.status}". You may only request a new ticket once your current session is completed by the counselor.`,
        'warning',
        'Active Ticket in Progress'
      );
      const activeCard = document.getElementById('active-queue-card');
      if (activeCard) activeCard.scrollIntoView({ behavior: 'smooth' });
      return;
    }

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

    if (activeUserTicket && ['Waiting', 'Calling', 'In-Session'].includes(activeUserTicket.status)) {
      showToast(
        `You currently have an active ticket (${activeUserTicket.ticketNumber}). Please wait for the counselor to complete your session.`,
        'warning',
        'Active Ticket Found'
      );
      walkinModal?.classList.add('hidden');
      return;
    }

    const concernCategory =
      document.getElementById('walkin-concern')?.value ||
      document.getElementById('walkin-concern-type')?.value ||
      'General Guidance Inquiry';

    try {
      const ticket = await generateWalkInTicket({
        studentId: currentUser.uid,
        studentName: currentUser.fullName,
        studentNumber: currentUser.studentOrEmpId || 'N/A',
        studentEmail: currentUser.email || '',
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
        const cName = myTicket.assignedCounselorName ? `Counselor ${myTicket.assignedCounselorName}` : 'Your assigned counselor';
        if (queueStatusText) queueStatusText.textContent = `NOW CALLING: Please proceed to Counselor Room`;
        if (queueDetailText) queueDetailText.textContent = `${cName} is ready to see you. Please proceed to the Guidance Office.`;
      } else if (myTicket.status === 'In-Session') {
        const cName = myTicket.assignedCounselorName ? `with Counselor ${myTicket.assignedCounselorName}` : 'underway';
        if (queueStatusText) queueStatusText.textContent = 'Session In Progress';
        if (queueDetailText) queueDetailText.textContent = `Consultation currently ${cName}.`;
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
    if (!activeUserTicket) return;
    const confirmed = await showConfirmDialog({
      title: 'Cancel Walk-In Ticket?',
      message: 'Are you sure you want to cancel your place in the digital queue? You can request a new ticket anytime.',
      confirmText: 'Yes, Cancel Ticket',
      cancelText: 'Keep Ticket',
      type: 'danger'
    });
    if (confirmed) {
      await updateWalkInStatus(activeUserTicket.id, 'Cancelled');
      showToast('Your walk-in ticket has been cancelled.', 'info', 'Queue Notice');
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

  let lastLoadedDate = null;

  const dateInputInit = document.getElementById('wiz-schedule-date');
  dateInputInit?.addEventListener('change', () => {
    selectedSlot = null;
    lastLoadedDate = null;
    validateDateAndLoadSlots(true);
  });

  function openWizard() {
    currentStep = 1;
    selectedSlot = null;
    lastLoadedDate = null;
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

  async function validateDateAndLoadSlots(forceRefresh = false) {
    const dateInput = document.getElementById('wiz-schedule-date');
    const slotContainer = document.getElementById('slot-container');
    if (!dateInput || !slotContainer) return;

    const chosenDate = new Date(dateInput.value + 'T00:00:00');
    const dayOfWeek = chosenDate.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      showToast('Guidance Office is closed on weekends. Select Mon-Fri.', 'warning');
      slotContainer.innerHTML = `<p class="col-span-4 text-[11px] text-rose-500 py-1.5">Office is closed on weekends.</p>`;
      selectedSlot = null;
      lastLoadedDate = null;
      return;
    }

    // High-speed re-render: if date hasn't changed, instantly sync visual state with 0ms delay
    if (!forceRefresh && lastLoadedDate === dateInput.value && slotContainer.querySelectorAll('.btn-slot').length > 0) {
      document.querySelectorAll('.btn-slot').forEach(b => {
        const isSelected = b.getAttribute('data-slot') === selectedSlot;
        b.className = `btn-slot p-2 rounded text-xs border transition ${
          isSelected
            ? 'bg-[#00205B] text-[#F5B800] border-[#00205B] font-bold shadow-xs'
            : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 font-medium'
        }`;
      });
      return;
    }

    slotContainer.innerHTML = `<div class="col-span-4 text-[11px] text-slate-400 py-2">Checking schedule availability...</div>`;

    try {
      const slotChecks = await Promise.all(
        TIME_SLOTS.map(async slot => {
          const isAvailable = await checkSlotAvailable(dateInput.value, slot, 'any', 'Any');
          return { slot, isAvailable };
        })
      );

      let html = '';
      for (const { slot, isAvailable } of slotChecks) {
        const isSelected = selectedSlot === slot;
        const slotDisplay = formatTimeSlot12h(slot);

        if (isAvailable) {
          html += `
            <button type="button" data-slot="${slot}" class="btn-slot p-2 rounded text-xs font-medium border transition ${
            isSelected
              ? 'bg-[#00205B] text-[#F5B800] border-[#00205B] font-bold shadow-xs'
              : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
          }">
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
      lastLoadedDate = dateInput.value;

      document.querySelectorAll('.btn-slot').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedSlot = btn.getAttribute('data-slot');
          // Instantly highlight selected slot button with zero lag and zero network re-fetch
          document.querySelectorAll('.btn-slot').forEach(b => {
            const isSelected = b.getAttribute('data-slot') === selectedSlot;
            b.className = `btn-slot p-2 rounded text-xs border transition ${
              isSelected
                ? 'bg-[#00205B] text-[#F5B800] border-[#00205B] font-bold shadow-xs'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 font-medium'
            }`;
          });
        });
      });
    } catch (err) {
      console.error('Error checking availability:', err);
      slotContainer.innerHTML = `<div class="col-span-4 text-[11px] text-rose-500 py-2">Could not check schedule availability. Please retry.</div>`;
    }
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
          noticeEl.textContent = `No ${prefDesc}guidance counselors are available at ${formatTimeSlot12h(selectedSlot)} on ${dateInput.value} (counselor may have blocked this time slot in their availability schedule, on scheduled leave, or fully booked). Please select another time slot or counselor preference.`;
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

    if (currentStep === 1) {
      if (selectedSlot) {
        const stillFree = await checkSlotAvailable(dateInput.value, selectedSlot, 'any', 'Any');
        if (!stillFree) {
          selectedSlot = null;
          showToast('A counselor just blocked or updated your selected slot. Please select an available slot.', 'warning');
        }
      }
      validateDateAndLoadSlots(true);
    } else if (currentStep === 2) {
      updateCounselorsForChosenSlot();
    }
  });

  // Real-time synchronization when other appointments are booked
  subscribeAllAppointments(async () => {
    if (!wizardModal || wizardModal.classList.contains('hidden')) return;
    const dateInput = document.getElementById('wiz-schedule-date');
    if (!dateInput || !dateInput.value) return;

    if (currentStep === 1) {
      if (selectedSlot) {
        const stillFree = await checkSlotAvailable(dateInput.value, selectedSlot, 'any', 'Any');
        if (!stillFree) {
          selectedSlot = null;
          showToast('The selected time slot was just booked. Please select an available slot.', 'warning');
        }
      }
      validateDateAndLoadSlots(true);
    } else if (currentStep === 2) {
      updateCounselorsForChosenSlot();
    }
  });

  // Guided Onboarding Banner (Dismissible with Local Storage persistence)
  const onboardingBanner = document.getElementById('student-onboarding-banner');
  const btnDismissOnboarding = document.getElementById('btn-dismiss-onboarding');
  if (onboardingBanner) {
    const isDismissed = localStorage.getItem('guidehub_student_tour_dismissed');
    if (!isDismissed) {
      onboardingBanner.classList.remove('hidden');
    }
    btnDismissOnboarding?.addEventListener('click', () => {
      onboardingBanner.classList.add('hidden');
      localStorage.setItem('guidehub_student_tour_dismissed', 'true');
    });
  }

  // 24/7 Crisis & Immediate Care Modal Handlers
  const crisisModal = document.getElementById('crisis-modal');
  const btnOpenCrisis = document.getElementById('btn-open-crisis-modal');
  const btnCloseCrisis = document.getElementById('btn-close-crisis-modal');
  btnOpenCrisis?.addEventListener('click', () => {
    crisisModal?.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  });
  btnCloseCrisis?.addEventListener('click', () => {
    crisisModal?.classList.add('hidden');
  });

  // Mobile Bottom Navigation Bar Actions
  document.getElementById('mob-nav-home')?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('mob-nav-consultations')?.addEventListener('click', () => {
    appointmentsListEl?.scrollIntoView({ behavior: 'smooth' });
  });
  document.getElementById('mob-nav-book')?.addEventListener('click', () => {
    document.getElementById('btn-open-wizard-modal')?.click();
  });
  document.getElementById('mob-nav-walkin')?.addEventListener('click', () => {
    document.getElementById('btn-open-walkin-modal')?.click();
  });
  document.getElementById('mob-nav-profile')?.addEventListener('click', () => {
    document.getElementById('btn-open-student-profile')?.click();
  });
});
