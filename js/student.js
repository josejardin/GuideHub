import { requireRole, initNavbar, showToast } from './auth.js';
import { db, doc, updateDoc, collection, query, where, onSnapshot } from './firebase-config.js';
import {
  createAppointment,
  subscribeStudentAppointments,
  checkSlotAvailable,
  updateAppointmentStatus,
  generateWalkInTicket,
  subscribeLiveWalkInQueue,
  updateWalkInStatus,
  logAuditEvent
} from './db.js';

document.addEventListener('DOMContentLoaded', () => {
  const currentUser = requireRole(['student']);
  if (!currentUser) return;

  initNavbar('navbar-container', 'student');

  const welcomeText = document.getElementById('student-welcome-text');
  if (welcomeText) {
    welcomeText.textContent = `${currentUser.fullName} (${currentUser.studentOrEmpId || 'Student'}) • ${currentUser.program || 'Student Workspace'}`;
  }

  const counselorSelect = document.getElementById('counselorSelect');
  if (counselorSelect && db) {
    const qCounselors = query(collection(db, 'users'), where('role', '==', 'counselor'));
    onSnapshot(
      qCounselors,
      snapshot => {
        counselorSelect.innerHTML = '<option value="any"> Any Available Counselor (Fastest Matching)</option>';
        snapshot.forEach(docSnap => {
          const counselor = docSnap.data();
          const option = document.createElement('option');
          option.value = docSnap.id;
          option.textContent = `${counselor.fullName} (${counselor.department || counselor.subjectArea || 'Guidance Center'})`;
          option.dataset.name = counselor.fullName;
          counselorSelect.appendChild(option);
        });
      },
      err => {
        console.warn('Counselor snapshot notice:', err);
      }
    );
  }

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
      }

      if (counselorSelect && activeFollowUpData.counselorId) {
        counselorSelect.value = activeFollowUpData.counselorId;
      }

      const concernSelect = document.getElementById('wiz-concern-category');
      if (concernSelect) {
        concernSelect.value = 'Personal / Emotional';
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

  subscribeStudentAppointments(currentUser.uid, appointments => {
    cachedAppointments = appointments;
    renderAppointments();
  });

  statusFilterEl?.addEventListener('change', renderAppointments);

  function renderAppointments() {
    if (!appointmentsListEl) return;
    const filter = statusFilterEl?.value || 'ALL';
    const filtered = cachedAppointments.filter(
      a => filter === 'ALL' || (a.status || '').toLowerCase() === filter.toLowerCase()
    );

    if (filtered.length === 0) {
      appointmentsListEl.innerHTML = `
 <div class="p-8 text-center text-slate-400 text-xs">
 No appointments found matching this filter.
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

        const isActionable = statusLower === 'pending' || statusLower === 'confirmed';

        return `
 <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 transition">
 <div class="space-y-1">
 <div class="flex items-center gap-2">
 <span class="font-bold text-xs text-slate-900">${apt.concernCategory}</span>
 <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${badgeStyles[statusLower] || badgeStyles.pending}">
 ${apt.status}
 </span>
 ${apt.isWalkIn ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[#00205B] text-[#F5B800]">Walk-In</span>' : ''}
 ${apt.followUpDate ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">Follow-up: ${apt.followUpDate}</span>` : ''}
 </div>
 
 <div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
 <span>Date: <strong class="text-slate-700">${apt.date}</strong></span>
 <span>Time: <strong class="text-slate-700">${apt.timeSlot}</strong></span>
 <span>Counselor: <strong class="text-slate-700">${apt.counselorName || 'Assigned Counselor'}</strong></span>
 </div>

 ${apt.specificConcern ? `<p class="text-[11px] text-slate-600 italic mt-1">"${apt.specificConcern}"</p>` : ''}
 </div>

 <!-- Actions -->
 <div class="flex items-center gap-2 self-end sm:self-center">
 ${
   isActionable
     ? `
 <button data-cancel-id="${apt.id}" class="btn-cancel-apt px-2.5 py-1 rounded text-xs font-medium text-rose-700 hover:bg-rose-50 border border-rose-200 transition">
 Cancel
 </button>
 `
     : ''
 }
 </div>
 </div>
 `;
      })
      .join('');

    document.querySelectorAll('.btn-cancel-apt').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-cancel-id');
        if (confirm('Are you sure you want to cancel this appointment?')) {
          await updateAppointmentStatus(id, 'Cancelled');
          await logAuditEvent(
            currentUser.uid,
            currentUser.fullName,
            currentUser.role,
            'APPOINTMENT_CANCELLED',
            `Cancelled appointment ${id}`
          );
          showToast('Appointment cancelled.', 'info');
        }
      });
    });
  }

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
    const concernCategory = document.getElementById('walkin-concern-type')?.value || 'General Walk-In';

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
        'WALKIN_JOINED',
        `Generated ticket ${ticket.ticketNumber}`
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

  function openWizard() {
    currentStep = 1;
    selectedSlot = null;
    wizardModal?.classList.remove('hidden');

    const sNum = document.getElementById('wiz-student-number');
    const sName = document.getElementById('wiz-student-name');
    const sProg = document.getElementById('wiz-student-program');
    const sContact = document.getElementById('wiz-student-contact');
    const sGender = document.getElementById('wiz-student-gender');

    if (sNum) sNum.value = currentUser.studentOrEmpId || '2024-10892';
    if (sName) sName.value = currentUser.fullName || 'Student';
    if (sProg) sProg.value = currentUser.program || 'BS Information Technology';
    if (sContact) {
      sContact.value = currentUser.contactNumber || '0917-123-4567';
      sContact.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/[^0-9+-]/g, '');
      });
      sContact.addEventListener('keydown', e => {
        if (
          ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) ||
          e.ctrlKey ||
          e.metaKey
        )
          return;
        if (!/[0-9+-]/.test(e.key)) e.preventDefault();
      });
    }
    if (sGender) sGender.value = currentUser.gender || 'Female';

    const dateInput = document.getElementById('wiz-schedule-date');
    if (dateInput) {
      const today = new Date();
      dateInput.min = today.toISOString().split('T')[0];

      let d = new Date();
      d.setDate(d.getDate() + 1);
      if (d.getDay() === 0) d.setDate(d.getDate() + 1);
      if (d.getDay() === 6) d.setDate(d.getDate() + 2);
      dateInput.value = d.toISOString().split('T')[0];

      dateInput.addEventListener('change', validateDateAndLoadSlots);
    }

    renderStep();
  }

  const TIME_SLOTS = [
    '08:00 - 09:00',
    '09:00 - 10:00',
    '10:00 - 11:00',
    '11:00 - 12:00',
    '13:00 - 14:00',
    '14:00 - 15:00',
    '15:00 - 16:00',
    '16:00 - 17:00'
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

    slotContainer.innerHTML = `<div class="col-span-4 text-[11px] text-slate-400 py-2">Checking availability...</div>`;

    const chosenCounselorId = counselorSelect?.value || 'any';

    let html = '';
    for (const slot of TIME_SLOTS) {
      const isAvailable = await checkSlotAvailable(dateInput.value, slot, chosenCounselorId);
      const isSelected = selectedSlot === slot;

      if (isAvailable) {
        html += `
 <button type="button" data-slot="${slot}" class="btn-slot p-2 rounded text-xs font-medium border transition ${isSelected ? 'bg-[#00205B] text-[#F5B800] border-[#00205B] font-bold' : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'}">
 ${slot}
 </button>
 `;
      } else {
        html += `
 <button type="button" disabled class="p-2 rounded text-xs font-medium bg-slate-50 text-slate-400 border border-slate-100 cursor-not-allowed line-through">
 ${slot}
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

  function renderStep() {
    for (let i = 1; i <= 4; i++) {
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
      btnNext.textContent = currentStep === 4 ? 'Submit Booking' : 'Next Step';
    }

    if (currentStep === 3) {
      validateDateAndLoadSlots();
    }
  }

  document.getElementById('btn-wiz-prev')?.addEventListener('click', () => {
    if (currentStep > 1) {
      currentStep--;
      renderStep();
    }
  });

  document.getElementById('btn-wiz-next')?.addEventListener('click', async () => {
    if (currentStep === 1) {
      const prog = document.getElementById('wiz-student-program')?.value.trim();
      const contact = document.getElementById('wiz-student-contact')?.value.trim();
      if (!prog || !contact) {
        showToast('Please complete program and contact details.', 'warning');
        return;
      }
      currentStep++;
      renderStep();
      return;
    }

    if (currentStep === 2) {
      currentStep++;
      renderStep();
      return;
    }

    if (currentStep === 3) {
      if (!selectedSlot) {
        showToast('Please choose an available 1-hour time slot.', 'warning');
        return;
      }
      currentStep++;
      renderStep();
      return;
    }

    if (currentStep === 4) {
      const studentProgram = document.getElementById('wiz-student-program')?.value;
      const studentContact = document.getElementById('wiz-student-contact')?.value;
      const studentGender = document.getElementById('wiz-student-gender')?.value;
      const counselorPref = document.querySelector('input[name="counselor_pref"]:checked')?.value || 'Any';
      const date = document.getElementById('wiz-schedule-date')?.value;
      const concernCategory = document.getElementById('wiz-concern-category')?.value;
      const academicCycle = document.getElementById('wiz-academic-cycle')?.value;
      const specificConcern = document.getElementById('wiz-concern-details')?.value;

      const chosenCounselorId = counselorSelect?.value || 'any';
      const chosenCounselorOption = counselorSelect?.selectedOptions[0];
      const chosenCounselorName =
        chosenCounselorId === 'any'
          ? 'Any Available Counselor'
          : chosenCounselorOption?.dataset?.name || chosenCounselorOption?.text || 'Assigned Counselor';

      try {
        await createAppointment({
          studentId: currentUser.uid,
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
});
