import { requireRole, initNavbar, showToast } from './auth.js';
import { db, doc, setDoc, updateDoc, collection, query, where, getDocs } from './firebase-config.js';
import {
  subscribeAllAppointments,
  updateAppointmentStatus,
  subscribeLiveWalkInQueue,
  updateWalkInStatus,
  generateWalkInTicket,
  subscribeAllReferrals,
  updateReferralStatus,
  subscribeAllCases,
  getOrCreateCase,
  addSessionNote,
  subscribeCaseNotes,
  updateCaseRiskFlags,
  getCounselorBlockedSlots,
  toggleCounselorBlockedSlot,
  logAuditEvent
} from './db.js';

document.addEventListener('DOMContentLoaded', () => {
  const currentUser = requireRole(['counselor', 'head', 'admin']);
  if (!currentUser) return;

  initNavbar('navbar-container', 'counselor');

  const welcomeText = document.getElementById('counselor-welcome-text');
  if (welcomeText) {
    welcomeText.textContent = `${currentUser.fullName} (${currentUser.studentOrEmpId || 'Counselor'}) • Clinical Workspace`;
  }

  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = {
    agenda: document.getElementById('tab-content-agenda'),
    walkin: document.getElementById('tab-content-walkin'),
    referrals: document.getElementById('tab-content-referrals'),
    cases: document.getElementById('tab-content-cases'),
    availability: document.getElementById('tab-content-availability')
  };

  function switchTab(targetTab) {
    tabButtons.forEach(btn => {
      const isTarget = btn.getAttribute('data-tab') === targetTab;
      if (isTarget) {
        btn.className =
          'tab-btn flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold border-b-2 border-slate-900 text-slate-900 whitespace-nowrap transition';
      } else {
        btn.className =
          'tab-btn flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-900 whitespace-nowrap transition';
      }
    });

    Object.keys(tabContents).forEach(key => {
      if (tabContents[key]) {
        if (key === targetTab) tabContents[key].classList.remove('hidden');
        else tabContents[key].classList.add('hidden');
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  let allAppointments = [];
  let activeViewFilter = 'selected_date';

  const agendaList = document.getElementById('agenda-list');
  const agendaDatePicker = document.getElementById('agenda-date-picker');
  const badgeAgendaCount = document.getElementById('badge-agenda-count');
  const badgeAllPendingCount = document.getElementById('badge-all-pending-count');
  const btnViewDate = document.getElementById('btn-view-date');
  const btnViewPending = document.getElementById('btn-view-pending');
  const agendaDateWrapper = document.getElementById('agenda-date-wrapper');

  const todayIso = new Date().toISOString().split('T')[0];
  if (agendaDatePicker && !agendaDatePicker.value) {
    agendaDatePicker.value = todayIso;
  }
  agendaDatePicker?.addEventListener('change', () => {
    activeViewFilter = 'selected_date';
    updateFilterUI();
    renderAgenda();
  });

  btnViewDate?.addEventListener('click', () => {
    activeViewFilter = 'selected_date';
    updateFilterUI();
    renderAgenda();
  });

  btnViewPending?.addEventListener('click', () => {
    activeViewFilter = 'all_pending';
    updateFilterUI();
    renderAgenda();
  });

  function updateFilterUI() {
    if (activeViewFilter === 'selected_date') {
      btnViewDate?.classList.add('bg-white', 'text-[#00205B]', 'font-bold', 'shadow-xs');
      btnViewDate?.classList.remove('text-slate-600');
      btnViewPending?.classList.remove('bg-white', 'text-[#00205B]', 'font-bold', 'shadow-xs');
      btnViewPending?.classList.add('text-slate-600');
      agendaDateWrapper?.classList.remove('opacity-50');
    } else {
      btnViewPending?.classList.add('bg-white', 'text-[#00205B]', 'font-bold', 'shadow-xs');
      btnViewPending?.classList.remove('text-slate-600');
      btnViewDate?.classList.remove('bg-white', 'text-[#00205B]', 'font-bold', 'shadow-xs');
      btnViewDate?.classList.add('text-slate-600');
      agendaDateWrapper?.classList.add('opacity-50');
    }
  }

  subscribeAllAppointments(appointments => {
    allAppointments = appointments;
    renderAgenda();
  });

  function renderAgenda() {
    if (!agendaList) return;

    const currentCounselorId = currentUser.uid;
    const accessibleAppointments = allAppointments.filter(apt => {
      return (
        !apt.counselorId ||
        apt.counselorId === 'any' ||
        apt.counselorId === currentCounselorId ||
        apt.counselorGenderPreference === 'Any' ||
        apt.counselorName === 'Any Available Counselor'
      );
    });

    const pendingCount = accessibleAppointments.filter(a => (a.status || '').toLowerCase() === 'pending').length;
    if (badgeAllPendingCount) badgeAllPendingCount.textContent = pendingCount;

    const selectedDate = agendaDatePicker?.value || todayIso;
    const filtered = accessibleAppointments.filter(item => {
      const itemStatus = (item.status || '').toLowerCase();
      if (activeViewFilter === 'all_pending') {
        return itemStatus === 'pending';
      }
      return item.date === selectedDate;
    });

    if (badgeAgendaCount) {
      badgeAgendaCount.textContent = accessibleAppointments.filter(
        a => a.date === todayIso || (a.status || '').toLowerCase() === 'pending'
      ).length;
    }

    filtered.sort((a, b) => {
      const isAPending = (a.status || '').toLowerCase() === 'pending';
      const isBPending = (b.status || '').toLowerCase() === 'pending';
      if (isAPending && !isBPending) return -1;
      if (!isAPending && isBPending) return 1;
      return (a.timeSlot || '').localeCompare(b.timeSlot || '');
    });

    if (filtered.length === 0) {
      const emptyMsg =
        activeViewFilter === 'all_pending'
          ? 'No pending appointment requests currently.'
          : `No scheduled counseling sessions for ${selectedDate}.`;
      agendaList.innerHTML = `
 <div class="p-8 text-center text-slate-400 text-xs bg-white">
 ${emptyMsg}
 </div>
 `;
      return;
    }

    agendaList.innerHTML = filtered
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

        return `
 <div class="p-4 bg-white flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:bg-slate-50/60 transition ${isPending ? 'border-l-4 border-amber-400 bg-amber-50/20' : ''}">
 <div class="flex items-start gap-3">
 <div class="w-16 py-1.5 rounded bg-[#00205B] text-white flex flex-col items-center justify-center flex-shrink-0 text-center font-mono">
 <span class="text-xs font-bold leading-tight">${apt.timeSlot ? apt.timeSlot.split(' - ')[0] : 'TBD'}</span>
 <span class="text-[9px] text-[#F5B800]">${apt.timeSlot ? apt.timeSlot.split(' - ')[1] : ''}</span>
 </div>
 
 <div class="space-y-0.5">
 <div class="flex items-center gap-2">
 <span class="font-bold text-xs text-slate-900">${apt.studentName}</span>
 <span class="text-[11px] text-slate-500 font-mono">(${apt.studentNumber} • ${apt.program})</span>
 <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${badgeStyles[statusLower] || badgeStyles.pending}">
 ${apt.status}
 </span>
 ${apt.date !== todayIso ? `<span class="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">${apt.date}</span>` : ''}
 </div>
 
 <div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3">
 <span class="font-medium text-[#00205B]">${apt.concernCategory}</span>
 <span>Counselor: <strong class="text-slate-700">${apt.counselorName || 'Any Available'}</strong></span>
 <span>Pref: <strong>${apt.counselorGenderPreference || 'Any'}</strong></span>
 </div>

 ${apt.specificConcern ? `<p class="text-[11px] text-slate-600 italic mt-0.5">"${apt.specificConcern}"</p>` : ''}
 </div>
 </div>

 <!-- Actions -->
 <div class="flex items-center gap-1.5 self-end md:self-center">
 ${
   isPending
     ? `
 <button data-action="Confirmed" data-id="${apt.id}" class="btn-apt-status px-3 py-1.5 rounded-lg bg-[#00205B] hover:bg-[#0A192F] text-white text-xs font-semibold shadow-xs transition flex items-center gap-1">
 <span>Accept & Confirm</span>
 </button>
 <button data-action="Cancelled" data-id="${apt.id}" class="btn-apt-status px-2.5 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-medium transition">
 Decline
 </button>
 `
     : ''
 }

 ${
   isConfirmed
     ? `
 <button data-action="Completed" data-id="${apt.id}" class="btn-apt-status px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-xs transition">
 Mark Completed
 </button>
 <button data-action="No-Show" data-id="${apt.id}" class="btn-apt-status px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium transition">
 No-Show
 </button>
 `
     : ''
 }

 <button data-student-num="${apt.studentNumber}" data-student-name="${apt.studentName}" data-program="${apt.program}" class="btn-open-case-direct px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition">
 Open Case
 </button>
 </div>
 </div>
 `;
      })
      .join('');

    document.querySelectorAll('.btn-apt-status').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const status = btn.getAttribute('data-action');
        const extra = {};
        if (status === 'Confirmed') {
          extra.counselorId = currentUser.uid;
          extra.counselorName = currentUser.fullName;
        }
        await updateAppointmentStatus(id, status, extra);
        await logAuditEvent(
          currentUser.uid,
          currentUser.fullName,
          currentUser.role,
          `APPOINTMENT_${status.toUpperCase()}`,
          `Updated appointment ${id} to ${status}`
        );
        showToast(`Appointment status updated to ${status}.`, 'success');
      });
    });

    document.querySelectorAll('.btn-open-case-direct').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sNum = btn.getAttribute('data-student-num');
        const sName = btn.getAttribute('data-student-name');
        const sProg = btn.getAttribute('data-program');

        const caseRecord = await getOrCreateCase(sNum, sName, sProg, currentUser.uid);
        switchTab('cases');
        selectCaseFolder(caseRecord.id);
      });
    });

    if (window.lucide) window.lucide.createIcons();
  }

  let allWalkinQueue = [];
  const listWaiting = document.getElementById('queue-list-waiting');
  const listCalling = document.getElementById('queue-list-calling');
  const listInSession = document.getElementById('queue-list-insession');
  const countWaiting = document.getElementById('count-waiting');
  const countCalling = document.getElementById('count-calling');
  const countInSession = document.getElementById('count-insession');
  const badgeWalkinCount = document.getElementById('badge-walkin-count');

  subscribeLiveWalkInQueue(queueList => {
    allWalkinQueue = queueList;
    renderWalkInQueue();
  });

  function renderWalkInQueue() {
    const waiting = allWalkinQueue.filter(t => t.status === 'Waiting');
    const calling = allWalkinQueue.filter(t => t.status === 'Calling');
    const insession = allWalkinQueue.filter(t => t.status === 'In-Session');

    if (countWaiting) countWaiting.textContent = waiting.length;
    if (countCalling) countCalling.textContent = calling.length;
    if (countInSession) countInSession.textContent = insession.length;
    if (badgeWalkinCount) badgeWalkinCount.textContent = waiting.length + calling.length;

    if (listWaiting) {
      if (waiting.length === 0) {
        listWaiting.innerHTML = `<p class="text-[11px] text-slate-400 py-4 text-center">No students waiting</p>`;
      } else {
        listWaiting.innerHTML = waiting
          .map(
            t => `
 <div class="bg-white p-2.5 rounded border border-slate-200 shadow-xs flex items-center justify-between gap-2">
 <div>
 <div class="flex items-center gap-1.5">
 <span class="font-mono font-bold text-slate-900 text-xs">${t.ticketNumber}</span>
 <span class="text-xs font-semibold text-slate-800">${t.studentName}</span>
 </div>
 <div class="text-[10px] text-slate-500">${t.program}</div>
 </div>
 <button data-call-id="${t.id}" class="btn-call-walkin px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition">
 Call
 </button>
 </div>
 `
          )
          .join('');
      }
    }

    if (listCalling) {
      if (calling.length === 0) {
        listCalling.innerHTML = `<p class="text-[11px] text-slate-400 py-4 text-center">No active calls</p>`;
      } else {
        listCalling.innerHTML = calling
          .map(
            t => `
 <div class="bg-white p-2.5 rounded border border-emerald-200 shadow-xs space-y-1.5">
 <div class="flex items-center justify-between">
 <span class="font-mono font-bold text-emerald-800 text-xs">${t.ticketNumber}</span>
 <span class="text-[9px] font-bold uppercase text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">Calling</span>
 </div>
 <div class="text-xs font-bold text-slate-900">${t.studentName}</div>
 <div class="text-[10px] text-slate-500">${t.program}</div>
 <div class="pt-1 flex gap-1.5">
 <button data-start-id="${t.id}" class="btn-start-walkin flex-1 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition">
 Start Session
 </button>
 </div>
 </div>
 `
          )
          .join('');
      }
    }

    if (listInSession) {
      if (insession.length === 0) {
        listInSession.innerHTML = `<p class="text-[11px] text-slate-400 py-4 text-center">No active consultations</p>`;
      } else {
        listInSession.innerHTML = insession
          .map(
            t => `
 <div class="bg-white p-2.5 rounded border border-slate-200 shadow-xs space-y-1.5">
 <div class="flex items-center justify-between">
 <span class="font-mono font-bold text-slate-900 text-xs">${t.ticketNumber}</span>
 <span class="text-[9px] font-bold uppercase text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">In Session</span>
 </div>
 <div class="text-xs font-bold text-slate-900">${t.studentName}</div>
 <div class="text-[10px] text-slate-500">${t.program}</div>
 <div class="pt-1">
 <button data-complete-id="${t.id}" data-snum="${t.studentNumber}" data-sname="${t.studentName}" data-sprog="${t.program}" class="btn-complete-walkin w-full py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition">
 Complete & Open Case
 </button>
 </div>
 </div>
 `
          )
          .join('');
      }
    }

    document.querySelectorAll('.btn-call-walkin').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-call-id');
        await updateWalkInStatus(id, 'Calling', currentUser.uid);
        showToast('Calling student to counselor room.', 'info');
      });
    });

    document.querySelectorAll('.btn-start-walkin').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-start-id');
        await updateWalkInStatus(id, 'In-Session', currentUser.uid);
        showToast('Session started.', 'success');
      });
    });

    document.querySelectorAll('.btn-complete-walkin').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-complete-id');
        const snum = btn.getAttribute('data-snum');
        const sname = btn.getAttribute('data-sname');
        const sprog = btn.getAttribute('data-sprog');

        await updateWalkInStatus(id, 'Completed', currentUser.uid);
        showToast('Walk-in completed. Opening case...', 'success');

        const caseRecord = await getOrCreateCase(snum, sname, sprog, currentUser.uid);
        switchTab('cases');
        selectCaseFolder(caseRecord.id);
      });
    });
  }

  const offlineIntakeModal = document.getElementById('offline-intake-modal');
  const btnOpenOfflineIntake = document.getElementById('btn-open-offline-intake');
  const btnCloseOfflineIntake = document.getElementById('btn-close-offline-intake');
  const offlineIntakeForm = document.getElementById('offline-intake-form');

  btnOpenOfflineIntake?.addEventListener('click', () => {
    offlineIntakeModal?.classList.remove('hidden');
  });

  btnCloseOfflineIntake?.addEventListener('click', () => {
    offlineIntakeModal?.classList.add('hidden');
  });

  offlineIntakeForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('off-name')?.value.trim();
    const num = document.getElementById('off-num')?.value.trim();
    const program = document.getElementById('off-program')?.value.trim();
    const concern = document.getElementById('off-concern')?.value;

    try {
      const ticket = await generateWalkInTicket({
        studentId: 'offline_' + num,
        studentName: name,
        studentNumber: num,
        program,
        gender: 'Not Specified',
        concernCategory: concern
      });

      await updateWalkInStatus(ticket.id, 'In-Session', currentUser.uid);
      await logAuditEvent(
        currentUser.uid,
        currentUser.fullName,
        currentUser.role,
        'OFFLINE_INTAKE_INITIATED',
        `Direct intake initiated for ${name} (${num})`
      );

      offlineIntakeModal?.classList.add('hidden');
      offlineIntakeForm.reset();
      showToast(`Walk-In intake started for ${name}.`, 'success');
      switchTab('walkin');
    } catch (err) {
      showToast(err.message || 'Failed to register offline intake', 'error');
    }
  });

  let allReferrals = [];
  const referralsTbody = document.getElementById('counselor-referrals-tbody');
  const badgeReferralCount = document.getElementById('badge-referral-count');

  subscribeAllReferrals(referrals => {
    allReferrals = referrals;
    renderReferralInbox();
  });

  function renderReferralInbox() {
    if (!referralsTbody) return;
    if (badgeReferralCount) {
      badgeReferralCount.textContent = allReferrals.filter(r => r.status !== 'Closed').length;
    }

    if (allReferrals.length === 0) {
      referralsTbody.innerHTML = `
 <tr>
 <td colspan="6" class="p-8 text-center text-slate-400 text-xs">
 No faculty referrals in inbox.
 </td>
 </tr>
 `;
      return;
    }

    referralsTbody.innerHTML = allReferrals
      .map(r => {
        const stageStyles = {
          Referred: 'bg-amber-50 text-amber-700 border-amber-200/80',
          'Call Slip Issued': 'bg-blue-50 text-blue-700 border-blue-200/80',
          'Intake Conducted': 'bg-purple-50 text-purple-700 border-purple-200/80',
          Closed: 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
        };

        return `
 <tr class="hover:bg-slate-50/60 transition">
 <td class="py-2.5 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">${(r.createdAt || '').split('T')[0]}</td>
 <td class="py-2.5 px-4">
 <div class="font-bold text-slate-900">${r.studentName}</div>
 <div class="text-[11px] text-slate-500">${r.studentNumber} • ${r.program}</div>
 </td>
 <td class="py-2.5 px-4">
 <div class="font-semibold text-slate-800">${r.facultyName}</div>
 <div class="text-[11px] text-slate-500">${r.subjectCourse || 'General'}</div>
 </td>
 <td class="py-2.5 px-4">
 <span class="font-medium text-slate-800">${r.reasonCategory}</span>
 </td>
 <td class="py-2.5 px-4">
 <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${stageStyles[r.status] || stageStyles.Referred}">
 ${r.status}
 </span>
 </td>
 <td class="py-2.5 px-4 text-right space-x-1 whitespace-nowrap">
 <button data-cs-id="${r.id}" class="btn-issue-callslip px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition">
 Call Slip
 </button>
 
 ${
   r.status === 'Call Slip Issued'
     ? `
 <button data-intake-id="${r.id}" data-snum="${r.studentNumber}" data-sname="${r.studentName}" data-sprog="${r.program}" class="btn-intake-conducted px-2 py-1 rounded bg-purple-700 hover:bg-purple-800 text-white text-xs font-medium transition">
 Intake
 </button>
 `
     : ''
 }

 ${
   r.status !== 'Closed'
     ? `
 <button data-close-ref-id="${r.id}" class="btn-close-referral px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium transition">
 Close
 </button>
 `
     : ''
 }
 </td>
 </tr>
 `;
      })
      .join('');

    document.querySelectorAll('.btn-issue-callslip').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-cs-id');
        const ref = allReferrals.find(r => r.id === id);
        if (ref) openCallSlipModal(ref);
      });
    });

    document.querySelectorAll('.btn-intake-conducted').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-intake-id');
        const snum = btn.getAttribute('data-snum');
        const sname = btn.getAttribute('data-sname');
        const sprog = btn.getAttribute('data-sprog');

        await updateReferralStatus(id, 'Intake Conducted');
        await logAuditEvent(
          currentUser.uid,
          currentUser.fullName,
          currentUser.role,
          'REFERRAL_INTAKE_CONDUCTED',
          `Conducted intake for referral ${id}`
        );
        showToast('Status updated to Intake Conducted.', 'success');

        const caseRecord = await getOrCreateCase(snum, sname, sprog, currentUser.uid);
        switchTab('cases');
        selectCaseFolder(caseRecord.id);
      });
    });

    document.querySelectorAll('.btn-close-referral').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-close-ref-id');
        if (confirm('Mark referral as Closed?')) {
          await updateReferralStatus(id, 'Closed');
          showToast('Referral closed.', 'info');
        }
      });
    });
  }

  const callslipModal = document.getElementById('callslip-modal');
  const btnCloseCallslip = document.getElementById('btn-close-callslip');
  const btnPrintCallslipPreview = document.getElementById('btn-print-callslip-preview');
  let activeReferralForCallSlip = null;

  function openCallSlipModal(referral) {
    activeReferralForCallSlip = referral;
    const studentInput = document.getElementById('cs-student');
    const counselorInput = document.getElementById('cs-counselor');
    const dateInput = document.getElementById('cs-date');

    if (studentInput) studentInput.value = `${referral.studentName} (${referral.studentNumber} - ${referral.program})`;
    if (counselorInput) counselorInput.value = currentUser.fullName;

    if (dateInput) {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      dateInput.value = tomorrow;
    }

    callslipModal?.classList.remove('hidden');
  }

  btnCloseCallslip?.addEventListener('click', () => callslipModal?.classList.add('hidden'));

  btnPrintCallslipPreview?.addEventListener('click', async () => {
    if (!activeReferralForCallSlip) return;
    const appDate = document.getElementById('cs-date')?.value;
    const appTime = document.getElementById('cs-time')?.value;

    await updateReferralStatus(activeReferralForCallSlip.id, 'Call Slip Issued', {
      callSlipIssuedAt: new Date().toISOString().split('T')[0],
      callSlipAppointmentDate: appDate,
      callSlipAppointmentTime: appTime,
      assignedCounselor: currentUser.fullName
    });

    await logAuditEvent(
      currentUser.uid,
      currentUser.fullName,
      currentUser.role,
      'CALL_SLIP_ISSUED',
      `Issued Call Slip for ${activeReferralForCallSlip.studentName} on ${appDate} ${appTime}`
    );

    document.getElementById('print-cs-issued-date').textContent = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    document.getElementById('print-cs-slip-id').textContent = `CS-${Date.now().toString().slice(-6)}`;
    document.getElementById('print-cs-name').textContent = activeReferralForCallSlip.studentName;
    document.getElementById('print-cs-id').textContent = activeReferralForCallSlip.studentNumber;
    document.getElementById('print-cs-program').textContent = activeReferralForCallSlip.program;
    document.getElementById('print-cs-time').textContent = `${appDate} at ${appTime}`;
    document.getElementById('print-cs-counselor-sig').textContent = currentUser.fullName;

    callslipModal?.classList.add('hidden');
    showToast('Call Slip issued. Opening print dialog...', 'success');

    setTimeout(() => {
      window.print();
    }, 300);
  });

  let allCases = [];
  let selectedCaseId = null;
  const caseFolderList = document.getElementById('case-folder-list');
  const caseDetailPanel = document.getElementById('case-detail-panel');
  const caseSearchInput = document.getElementById('case-search-input');

  subscribeAllCases(cases => {
    allCases = cases;
    renderCaseFolders();
    if (selectedCaseId) {
      const active = allCases.find(c => c.id === selectedCaseId);
      if (active) renderCaseDetail(active);
    }
  });

  caseSearchInput?.addEventListener('input', renderCaseFolders);

  function renderCaseFolders() {
    if (!caseFolderList) return;
    const query = (caseSearchInput?.value || '').toLowerCase();
    const filtered = allCases.filter(
      c =>
        (c.studentName || '').toLowerCase().includes(query) ||
        (c.studentNumber || '').toLowerCase().includes(query) ||
        (c.program || '').toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      caseFolderList.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">No matching cases.</div>`;
      return;
    }

    const badgeStyles = {
      'High Risk': 'bg-rose-50 text-rose-700 border-rose-200 font-bold',
      Active: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold',
      Monitoring: 'bg-amber-50 text-amber-700 border-amber-200 font-semibold',
      Closed: 'bg-slate-100 text-slate-500 border-slate-200 font-medium'
    };

    caseFolderList.innerHTML = filtered
      .map(c => {
        const isSelected = c.id === selectedCaseId;
        const isHighRisk =
          c.status === 'High Risk' ||
          (c.riskFlags &&
            (c.riskFlags.selfHarm ||
              c.riskFlags.abuseHarmFromOthers ||
              c.riskFlags.threatToOthers ||
              c.riskFlags.abuse ||
              c.riskFlags.threat));
        const displayStatus = isHighRisk ? 'High Risk' : c.status || 'Active';
        const badgeClass = badgeStyles[displayStatus] || badgeStyles.Active;

        return `
 <div data-case-id="${c.id}" class="case-item p-3 cursor-pointer transition border-l-2 ${isSelected ? 'bg-slate-100 border-[#00205B]' : 'hover:bg-slate-50 border-transparent'}">
 <div class="flex items-center justify-between">
 <span class="font-bold text-xs text-slate-900">${c.studentName}</span>
 <span class="px-1.5 py-0.2 rounded text-[9px] border ${badgeClass}">
 ${displayStatus.toUpperCase()}
 </span>
 </div>
 <div class="text-[11px] text-slate-500 font-mono mt-0.5">${c.studentNumber} • ${c.program}</div>
 </div>
 `;
      })
      .join('');

    document.querySelectorAll('.case-item').forEach(item => {
      item.addEventListener('click', () => {
        selectCaseFolder(item.getAttribute('data-case-id'));
      });
    });
  }

  function selectCaseFolder(caseId) {
    selectedCaseId = caseId;
    renderCaseFolders();
    const targetCase = allCases.find(c => c.id === caseId);
    if (targetCase) renderCaseDetail(targetCase);
  }

  function renderCaseDetail(caseRecord) {
    if (!caseDetailPanel) return;

    const risk = caseRecord.riskFlags || { selfHarm: false, abuseHarmFromOthers: false, threatToOthers: false };
    const selfHarmChecked = !!risk.selfHarm;
    const abuseChecked = !!(risk.abuseHarmFromOthers || risk.abuse);
    const threatChecked = !!(risk.threatToOthers || risk.threat);

    const isHighRisk = caseRecord.status === 'High Risk' || selfHarmChecked || abuseChecked || threatChecked;
    const currentStatus = isHighRisk ? 'High Risk' : caseRecord.status || 'Active';

    const badgeStyles = {
      'High Risk': 'bg-rose-50 text-rose-700 border-rose-200 font-bold',
      Active: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold',
      Monitoring: 'bg-amber-50 text-amber-700 border-amber-200 font-semibold',
      Closed: 'bg-slate-100 text-slate-500 border-slate-200 font-medium'
    };

    caseDetailPanel.innerHTML = `
 <!-- Case Header -->
 <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
 <div>
 <div class="flex items-center gap-2">
 <h3 class="text-base font-bold text-slate-900">${caseRecord.studentName}</h3>
 <span class="text-xs text-slate-500 font-mono">(${caseRecord.studentNumber})</span>
 <span id="case-header-badge" class="px-2 py-0.5 rounded text-[10px] border ${badgeStyles[currentStatus] || badgeStyles.Active}">
 ${currentStatus}
 </span>
 </div>
 <p class="text-xs text-slate-500 mt-0.5">${caseRecord.program} • ${caseRecord.category || 'Clinical Record'}</p>
 </div>

 <div class="flex items-center gap-2">
 <span class="text-xs text-slate-500 font-semibold">Status:</span>
 <select id="case-status-select" class="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white font-bold text-slate-800 focus:border-[#00205B] focus:outline-none shadow-2xs">
 <option value="Active" ${currentStatus === 'Active' ? 'selected' : ''}>Active</option>
 <option value="High Risk" ${currentStatus === 'High Risk' ? 'selected' : ''}>High Risk</option>
 <option value="Monitoring" ${currentStatus === 'Monitoring' ? 'selected' : ''}>Monitoring</option>
 <option value="Closed" ${currentStatus === 'Closed' ? 'selected' : ''}>Closed</option>
 </select>
 </div>
 </div>

 <!-- CRISIS & MANDATORY REPORTING PROTOCOL FLAGS -->
 <div class="bg-rose-50/50 border border-rose-200/80 rounded-lg p-3 space-y-2">
 <div class="flex items-center gap-1.5 text-xs font-bold text-rose-900 uppercase tracking-wider">
 <i data-lucide="shield-alert" class="w-3.5 h-3.5 text-rose-600"></i>
 <span>Mandatory Reporting & Crisis Flags (RA 9258)</span>
 </div>

 <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
 <label class="flex items-center gap-2 text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 cursor-pointer hover:border-rose-300 transition">
 <input type="checkbox" id="flag-self-harm" ${selfHarmChecked ? 'checked' : ''} class="crisis-flag-checkbox w-3.5 h-3.5 text-rose-600 rounded">
 <span class="font-medium">Self-Harm Alert</span>
 </label>

 <label class="flex items-center gap-2 text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 cursor-pointer hover:border-rose-300 transition">
 <input type="checkbox" id="flag-abuse" ${abuseChecked ? 'checked' : ''} class="crisis-flag-checkbox w-3.5 h-3.5 text-rose-600 rounded">
 <span class="font-medium">Abuse / Harm from Others</span>
 </label>

 <label class="flex items-center gap-2 text-xs text-slate-800 bg-white p-2 rounded border border-slate-200 cursor-pointer hover:border-rose-300 transition">
 <input type="checkbox" id="flag-threat" ${threatChecked ? 'checked' : ''} class="crisis-flag-checkbox w-3.5 h-3.5 text-rose-600 rounded">
 <span class="font-medium">Threat to Others</span>
 </label>
 </div>
 </div>

 <!-- SESSION NOTES EDITOR -->
 <div class="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
 <div class="flex items-center justify-between">
 <h4 class="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
 <i data-lucide="edit-3" class="w-3.5 h-3.5 text-slate-500"></i>
 <span>Log Confidential Session Note</span>
 </h4>
 <span class="text-[10px] text-slate-400">Strictly Isolated Clinical Record</span>
 </div>

 <form id="add-note-form" class="space-y-2.5 text-xs">
 <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
 <div>
 <label class="block font-semibold text-slate-700 mb-0.5">Note Type</label>
 <select id="note-type" class="w-full px-2 py-1.5 border border-slate-300 rounded bg-white">
 <option value="Individual Counseling">Individual Counseling</option>
 <option value="Intake Assessment">Intake Assessment</option>
 <option value="Crisis Intervention">Crisis Intervention</option>
 <option value="Follow-Up Consultation">Follow-Up Consultation</option>
 </select>
 </div>
 <div>
 <label class="block font-semibold text-slate-700 mb-0.5">Date</label>
 <input type="date" id="note-date" value="${new Date().toISOString().split('T')[0]}" class="w-full px-2 py-1.5 border border-slate-300 rounded bg-white">
 </div>
 <div>
 <label class="block font-semibold text-slate-700 mb-0.5">Follow-Up Date (Optional)</label>
 <input type="date" id="note-followup" class="w-full px-2 py-1.5 border border-slate-300 rounded bg-white">
 </div>
 </div>

 <div>
 <label class="block font-semibold text-slate-700 mb-0.5">Subjective Observation & Student Disclosures</label>
 <textarea id="note-subjective" required rows="2" placeholder="Observable behaviors, mood, affect, and direct student disclosures..." class="w-full p-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"></textarea>
 </div>

 <div>
 <label class="block font-semibold text-slate-700 mb-0.5">Counselor Clinical Remarks</label>
 <textarea id="note-remarks" required rows="2" placeholder="Clinical interventions applied, assessment, coping techniques..." class="w-full p-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"></textarea>
 </div>

 <div>
 <label class="block font-semibold text-slate-700 mb-0.5">Action Plan & Next Steps</label>
 <textarea id="note-action" required rows="2" placeholder="1. Homework coping tasks; 2. Department check..." class="w-full p-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"></textarea>
 </div>

 <div class="pt-1 flex justify-end">
 <button type="submit" class="px-3.5 py-1.5 rounded-lg bg-[#00205B] hover:bg-[#0A192F] text-white font-semibold shadow-xs transition">
 Save Session Note
 </button>
 </div>
 </form>
 </div>

 <!-- CASE TIMELINE -->
 <div class="space-y-2">
 <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">Case Timeline & Past Visits</h4>
 <div id="case-notes-feed" class="space-y-2">
 <div class="p-4 text-center text-xs text-slate-400">Loading timeline...</div>
 </div>
 </div>
 `;

    if (window.lucide) window.lucide.createIcons();

    const caseStatusSelect = document.getElementById('case-status-select');
    const flagSelfHarm = document.getElementById('flag-self-harm');
    const flagAbuse = document.getElementById('flag-abuse');
    const flagThreat = document.getElementById('flag-threat');
    const caseHeaderBadge = document.getElementById('case-header-badge');

    caseStatusSelect?.addEventListener('change', async e => {
      const newStatus = e.target.value;
      if (!caseRecord.id) return;

      const updatePayload = {
        status: newStatus,
        updatedAt: new Date().toISOString()
      };

      if (newStatus === 'Closed') {
        updatePayload.riskFlags = {
          selfHarm: false,
          abuseHarmFromOthers: false,
          threatToOthers: false
        };
        if (flagSelfHarm) flagSelfHarm.checked = false;
        if (flagAbuse) flagAbuse.checked = false;
        if (flagThreat) flagThreat.checked = false;
      }

      try {
        if (db) {
          await setDoc(
            doc(db, 'cases', caseRecord.id),
            {
              caseId: caseRecord.id,
              studentId: caseRecord.studentId || caseRecord.id,
              studentName: caseRecord.studentName || 'Student',
              studentNumber: caseRecord.studentNumber || 'N/A',
              program: caseRecord.program || 'N/A',
              counselorId: currentUser.uid,
              counselorName: currentUser.fullName || 'Guidance Counselor',
              ...updatePayload
            },
            { merge: true }
          );
        }
        caseRecord.status = newStatus;
        if (updatePayload.riskFlags) caseRecord.riskFlags = updatePayload.riskFlags;

        if (caseHeaderBadge) {
          caseHeaderBadge.className = `px-2 py-0.5 rounded text-[10px] border ${badgeStyles[newStatus] || badgeStyles.Active}`;
          caseHeaderBadge.textContent = newStatus;
        }

        await logAuditEvent(
          currentUser.uid,
          currentUser.fullName,
          currentUser.role,
          'CASE_STATUS_UPDATED',
          `Updated status for case ${caseRecord.studentNumber} to ${newStatus}`
        );
        showToast(`Case status updated to ${newStatus}`, 'success');
      } catch (err) {
        console.error('Error updating case status:', err);
        showToast(`Failed to update case status: ${err.message}`, 'error');
      }
    });

    const updateFlags = async () => {
      const selfHarm = flagSelfHarm?.checked || false;
      const abuse = flagAbuse?.checked || false;
      const threat = flagThreat?.checked || false;
      const isAnyFlagActive = selfHarm || abuse || threat;

      const currentSelectVal = caseStatusSelect?.value || caseRecord.status || 'Active';
      const newStatus = isAnyFlagActive ? 'High Risk' : currentSelectVal === 'High Risk' ? 'Active' : currentSelectVal;

      const newFlags = {
        selfHarm,
        abuseHarmFromOthers: abuse,
        threatToOthers: threat
      };

      if (caseStatusSelect) caseStatusSelect.value = newStatus;
      if (caseHeaderBadge) {
        caseHeaderBadge.className = `px-2 py-0.5 rounded text-[10px] border ${badgeStyles[newStatus] || badgeStyles.Active}`;
        caseHeaderBadge.textContent = newStatus;
      }

      try {
        if (db) {
          await setDoc(
            doc(db, 'cases', caseRecord.id),
            {
              caseId: caseRecord.id,
              studentId: caseRecord.studentId || caseRecord.id,
              studentName: caseRecord.studentName || 'Student',
              studentNumber: caseRecord.studentNumber || 'N/A',
              program: caseRecord.program || 'N/A',
              counselorId: currentUser.uid,
              counselorName: currentUser.fullName || 'Guidance Counselor',
              riskFlags: newFlags,
              status: newStatus,
              updatedAt: new Date().toISOString()
            },
            { merge: true }
          );
        }
        await updateCaseRiskFlags(caseRecord.id, newFlags);
        caseRecord.riskFlags = newFlags;
        caseRecord.status = newStatus;

        await logAuditEvent(
          currentUser.uid,
          currentUser.fullName,
          currentUser.role,
          'CASE_RISK_FLAGS_UPDATED',
          `Updated risk flags for case ${caseRecord.studentNumber} (Status: ${newStatus})`
        );
        showToast(
          isAnyFlagActive ? 'Crisis flag logged: Status set to High Risk' : 'Crisis flags updated.',
          isAnyFlagActive ? 'warning' : 'info'
        );
      } catch (err) {
        console.error('Error saving crisis flags:', err);
        showToast('Failed to update crisis flags.', 'error');
      }
    };

    flagSelfHarm?.addEventListener('change', updateFlags);
    flagAbuse?.addEventListener('change', updateFlags);
    flagThreat?.addEventListener('change', updateFlags);

    const addNoteForm = document.getElementById('add-note-form');
    addNoteForm?.addEventListener('submit', async e => {
      e.preventDefault();
      const noteType = document.getElementById('note-type')?.value;
      const sessionDate = document.getElementById('note-date')?.value;
      const followUpDate = document.getElementById('note-followup')?.value || null;
      const subjectiveObservation = document.getElementById('note-subjective')?.value.trim();
      const counselorRemarks = document.getElementById('note-remarks')?.value.trim();
      const actionPlan = document.getElementById('note-action')?.value.trim();
      const currentStatusVal = caseStatusSelect?.value || caseRecord.status || 'Active';

      try {
        await addSessionNote(caseRecord.id, {
          sessionDate,
          counselorId: currentUser.uid,
          counselorName: currentUser.fullName,
          noteType,
          subjectiveObservation,
          counselorRemarks,
          actionPlan,
          followUpDate,
          riskFlags: {
            selfHarm: flagSelfHarm?.checked || false,
            abuseHarmFromOthers: flagAbuse?.checked || false,
            threatToOthers: flagThreat?.checked || false
          }
        });

        if (db) {
          await setDoc(
            doc(db, 'cases', caseRecord.id),
            {
              caseId: caseRecord.id,
              studentId: caseRecord.studentId || caseRecord.id,
              studentName: caseRecord.studentName || 'Student',
              studentNumber: caseRecord.studentNumber || 'N/A',
              program: caseRecord.program || 'N/A',
              status: currentStatusVal,
              lastSessionDate: sessionDate,
              updatedAt: new Date().toISOString()
            },
            { merge: true }
          );
        }

        if (followUpDate && db) {
          try {
            let studentUid = caseRecord.studentId;
            if (!studentUid || studentUid === 'walkin_guest') {
              const qStudent = query(collection(db, 'users'), where('studentOrEmpId', '==', caseRecord.studentNumber));
              const snap = await getDocs(qStudent);
              if (!snap.empty) {
                studentUid = snap.docs[0].id;
              }
            }

            if (studentUid) {
              const studentRef = doc(db, 'users', studentUid);
              await updateDoc(studentRef, {
                activeFollowUp: {
                  date: followUpDate,
                  counselorName: currentUser.fullName || 'Guidance Counselor',
                  counselorId: currentUser.uid,
                  status: 'scheduled',
                  caseId: caseRecord.id,
                  createdAt: new Date().toISOString()
                }
              });
            }
          } catch (syncErr) {
            console.warn('Follow-up student sync notice:', syncErr.message);
          }
        }

        await logAuditEvent(
          currentUser.uid,
          currentUser.fullName,
          currentUser.role,
          'CASE_NOTE_RECORDED',
          `Recorded session note for case ${caseRecord.studentNumber} (Follow-up: ${followUpDate || 'None'})`
        );
        addNoteForm.reset();
        showToast(
          followUpDate
            ? `Session note saved & follow-up scheduled for ${followUpDate}.`
            : 'Clinical session note saved successfully.',
          'success'
        );
      } catch (err) {
        showToast(err.message || 'Failed to save note', 'error');
      }
    });

    subscribeCaseNotes(caseRecord.id, notes => {
      const feed = document.getElementById('case-notes-feed');
      if (!feed) return;

      if (notes.length === 0) {
        feed.innerHTML = `<div class="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded border border-slate-200">No session notes recorded yet.</div>`;
        return;
      }

      feed.innerHTML = notes
        .map(
          n => `
 <div class="bg-white p-3.5 rounded border border-slate-200 space-y-1.5 text-xs">
 <div class="flex items-center justify-between border-b border-slate-100 pb-1.5">
 <span class="font-bold text-slate-900">${n.noteType} • ${n.sessionDate}</span>
 <span class="text-[11px] text-slate-400">${n.counselorName}</span>
 </div>
 
 <div class="space-y-1 text-slate-700 pt-1">
 <p><strong class="text-slate-900 text-[11px] uppercase">Observations:</strong> ${n.subjectiveObservation}</p>
 <p><strong class="text-slate-900 text-[11px] uppercase">Remarks:</strong> ${n.counselorRemarks}</p>
 <p><strong class="text-slate-900 text-[11px] uppercase">Action Plan:</strong> ${n.actionPlan}</p>
 ${n.followUpDate ? `<div class="text-[11px] font-semibold text-slate-900 pt-0.5">Follow-Up: ${n.followUpDate}</div>` : ''}
 </div>
 </div>
 `
        )
        .join('');
    });
  }

  const availabilityGrid = document.getElementById('availability-slots-grid');
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const SLOTS = [
    '08:00 - 09:00',
    '09:00 - 10:00',
    '10:00 - 11:00',
    '11:00 - 12:00',
    '13:00 - 14:00',
    '14:00 - 15:00',
    '15:00 - 16:00',
    '16:00 - 17:00'
  ];

  async function renderAvailabilityGrid() {
    if (!availabilityGrid) return;
    const blockedRecords = await getCounselorBlockedSlots(currentUser.uid);
    const blockedSet = new Set(blockedRecords.map(b => `${b.dayOfWeek}_${b.timeSlot}`));

    let html = '';
    DAYS.forEach(day => {
      html += `
 <div class="col-span-2 sm:col-span-4 mt-2 font-bold text-xs text-slate-800 border-b border-slate-200 pb-1">
 ${day}
 </div>
 `;
      SLOTS.forEach(slot => {
        const isBlocked = blockedSet.has(`${day}_${slot}`);
        html += `
 <button data-day="${day}" data-slot="${slot}" data-blocked="${isBlocked}" class="btn-toggle-slot p-2 rounded border text-xs text-center transition ${isBlocked ? 'bg-rose-50 border-rose-200 text-rose-700 font-semibold' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}">
 <div class="text-[10px] text-slate-400">${slot}</div>
 <div class="text-xs mt-0.5">${isBlocked ? 'BLOCKED' : 'AVAILABLE'}</div>
 </button>
 `;
      });
    });

    availabilityGrid.innerHTML = html;

    document.querySelectorAll('.btn-toggle-slot').forEach(btn => {
      btn.addEventListener('click', async () => {
        const day = btn.getAttribute('data-day');
        const slot = btn.getAttribute('data-slot');
        const currentlyBlocked = btn.getAttribute('data-blocked') === 'true';
        const newBlockedState = !currentlyBlocked;

        await toggleCounselorBlockedSlot(currentUser.uid, day, slot, newBlockedState);
        showToast(`${day} (${slot}) ${newBlockedState ? 'BLOCKED' : 'AVAILABLE'}.`, 'info');
        renderAvailabilityGrid();
      });
    });
  }

  renderAvailabilityGrid();
});
