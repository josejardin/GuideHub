import { requireRole, initNavbar, showToast, showConfirmDialog } from './auth.js';
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
  updateCaseStatus,
  addSessionNote,
  subscribeCaseNotes,
  updateCaseRiskFlags,
  getCounselorBlockedSlots,
  toggleCounselorBlockedSlot,
  subscribeAllCounselorSchedules,
  blockCounselorLeave,
  unblockCounselorLeave,
  getCounselorLeaves,
  subscribeCounselorLeaves,
  getBusinessDatesInRange,
  logAuditEvent
} from './db.js';
import { escapeHtml, formatDateIso, formatTime12h, formatTimeSlot12h, normalizeTimeSlot } from './utils/validation.js';

document.addEventListener('DOMContentLoaded', () => {
  const currentUser = requireRole(['counselor', 'head', 'admin']);
  if (!currentUser) return;

  initNavbar('navbar-container', 'counselor');

  const welcomeText = document.getElementById('counselor-welcome-text');
  if (welcomeText) {
    welcomeText.textContent = `${currentUser.fullName} (${currentUser.studentOrEmpId || 'Counselor'}) • Clinical Workspace`;
  }

  window.addEventListener('guidehub_profile_updated', e => {
    const updated = e.detail?.user;
    if (updated && welcomeText) {
      welcomeText.textContent = `${updated.fullName} (${updated.studentOrEmpId || 'Counselor'}) • Clinical Workspace`;
    }
  });

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

    if (targetTab === 'availability') {
      renderAvailabilityGrid();
    }

    if (window.lucide) window.lucide.createIcons();
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  let allAppointments = [];
  let activeViewFilter = 'all_confirmed';

  const agendaList = document.getElementById('agenda-list');
  const agendaDatePicker = document.getElementById('agenda-date-picker');
  const agendaSearchInput = document.getElementById('agenda-search-input');
  const badgeAgendaCount = document.getElementById('badge-agenda-count');
  const badgeTodayCount = document.getElementById('badge-today-count');
  const badgeAllConfirmedCount = document.getElementById('badge-all-confirmed-count');
  const badgeAllPendingCount = document.getElementById('badge-all-pending-count');
  const badgeAllCancelledCount = document.getElementById('badge-all-cancelled-count');
  const btnViewToday = document.getElementById('btn-view-today');
  const btnViewConfirmed = document.getElementById('btn-view-confirmed');
  const btnViewDate = document.getElementById('btn-view-date');
  const btnViewPending = document.getElementById('btn-view-pending');
  const btnViewCancelled = document.getElementById('btn-view-cancelled');
  const agendaDateWrapper = document.getElementById('agenda-date-wrapper');
  const agendaStatusWrapper = document.getElementById('agenda-status-wrapper');

  const todayIso = new Date().toISOString().split('T')[0];
  if (agendaDatePicker && !agendaDatePicker.value) {
    agendaDatePicker.value = todayIso;
  }
  const agendaStatusFilter = document.getElementById('agenda-status-filter');
  agendaStatusFilter?.addEventListener('change', () => {
    renderAgenda();
  });

  agendaSearchInput?.addEventListener('input', () => {
    renderAgenda();
  });

  agendaDatePicker?.addEventListener('change', () => {
    activeViewFilter = 'selected_date';
    updateFilterUI();
    renderAgenda();
  });

  btnViewToday?.addEventListener('click', () => {
    activeViewFilter = 'today';
    updateFilterUI();
    renderAgenda();
  });

  btnViewConfirmed?.addEventListener('click', () => {
    activeViewFilter = 'all_confirmed';
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

  btnViewCancelled?.addEventListener('click', () => {
    activeViewFilter = 'all_cancelled';
    updateFilterUI();
    renderAgenda();
  });

  document.getElementById('btn-jump-confirmed')?.addEventListener('click', () => {
    activeViewFilter = 'all_confirmed';
    updateFilterUI();
    renderAgenda();
  });

  document.getElementById('btn-jump-pending')?.addEventListener('click', () => {
    activeViewFilter = 'all_pending';
    updateFilterUI();
    renderAgenda();
  });

  document.getElementById('btn-jump-cancelled')?.addEventListener('click', () => {
    activeViewFilter = 'all_cancelled';
    updateFilterUI();
    renderAgenda();
  });

  function updateFilterUI() {
    [btnViewToday, btnViewConfirmed, btnViewDate, btnViewPending, btnViewCancelled].forEach(btn => {
      btn?.classList.remove('bg-white', 'text-[#00205B]', 'font-bold', 'shadow-sm');
      btn?.classList.add('text-slate-600');
    });

    if (activeViewFilter === 'today') {
      btnViewToday?.classList.add('bg-white', 'text-[#00205B]', 'font-bold', 'shadow-sm');
      btnViewToday?.classList.remove('text-slate-600');
      agendaDateWrapper?.classList.add('opacity-50');
      agendaStatusWrapper?.classList.add('opacity-50', 'pointer-events-none');
      if (agendaStatusFilter) agendaStatusFilter.disabled = true;
    } else if (activeViewFilter === 'all_confirmed') {
      btnViewConfirmed?.classList.add('bg-white', 'text-[#00205B]', 'font-bold', 'shadow-sm');
      btnViewConfirmed?.classList.remove('text-slate-600');
      agendaDateWrapper?.classList.add('opacity-50');
      agendaStatusWrapper?.classList.add('opacity-50', 'pointer-events-none');
      if (agendaStatusFilter) agendaStatusFilter.disabled = true;
    } else if (activeViewFilter === 'selected_date') {
      btnViewDate?.classList.add('bg-white', 'text-[#00205B]', 'font-bold', 'shadow-sm');
      btnViewDate?.classList.remove('text-slate-600');
      agendaDateWrapper?.classList.remove('opacity-50');
      agendaStatusWrapper?.classList.remove('opacity-50', 'pointer-events-none');
      if (agendaStatusFilter) agendaStatusFilter.disabled = false;
    } else if (activeViewFilter === 'all_pending') {
      btnViewPending?.classList.add('bg-white', 'text-[#00205B]', 'font-bold', 'shadow-sm');
      btnViewPending?.classList.remove('text-slate-600');
      agendaDateWrapper?.classList.add('opacity-50');
      agendaStatusWrapper?.classList.add('opacity-50', 'pointer-events-none');
      if (agendaStatusFilter) agendaStatusFilter.disabled = true;
    } else if (activeViewFilter === 'all_cancelled') {
      btnViewCancelled?.classList.add('bg-white', 'text-[#00205B]', 'font-bold', 'shadow-sm');
      btnViewCancelled?.classList.remove('text-slate-600');
      agendaDateWrapper?.classList.add('opacity-50');
      agendaStatusWrapper?.classList.add('opacity-50', 'pointer-events-none');
      if (agendaStatusFilter) agendaStatusFilter.disabled = true;
    }
  }

  updateFilterUI();

  subscribeAllAppointments(appointments => {
    allAppointments = appointments;
    renderAgenda();
  });

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const SLOTS = [
    '8:00 AM - 9:00 AM',
    '9:00 AM - 10:00 AM',
    '10:00 AM - 11:00 AM',
    '11:00 AM - 12:00 PM',
    '1:00 PM - 2:00 PM',
    '2:00 PM - 3:00 PM',
    '3:00 PM - 4:00 PM',
    '4:00 PM - 5:00 PM'
  ];

  async function renderAgenda() {
    if (!agendaList) return;

    const currentCounselorId = currentUser.uid;
    const currentEmail = (currentUser.email || '').toLowerCase();
    const currentName = (currentUser.fullName || '').toLowerCase();

    // Fetch this counselor's blocked slots (support both 12h and 24h formats)
    const blockedRecords = await getCounselorBlockedSlots(currentUser.uid);
    const blockedSet = new Set();
    blockedRecords.forEach(b => {
      blockedSet.add(`${b.dayOfWeek}_${b.timeSlot}`);
      blockedSet.add(`${b.dayOfWeek}_${normalizeTimeSlot(b.timeSlot)}`);
      blockedSet.add(`${b.dayOfWeek}_${formatTimeSlot12h(b.timeSlot)}`);
    });

    const accessibleAppointments = allAppointments.filter(apt => {
      const aptCId = apt.counselorId;
      const aptCName = (apt.counselorName || '').toLowerCase();

      // 1. Explicitly assigned to ME (Mark)
      const isAssignedToMe =
        aptCId === currentCounselorId ||
        aptCId === currentEmail ||
        (aptCName && currentName && (aptCName.includes(currentName) || currentName.includes(aptCName)));

      if (isAssignedToMe) {
        return true;
      }

      // 2. Explicitly assigned to ANOTHER specific counselor (e.g. Claire)
      const isAssignedToOther = aptCId && aptCId !== 'any' && !isAssignedToMe;
      if (isAssignedToOther) {
        return false; // Other counselor's scheduled consultation! Never show to Mark!
      }

      // 3. Unassigned / Pending appointment ('any'):
      // Exclude if student's gender preference does not match my gender
      if (apt.counselorGenderPreference && apt.counselorGenderPreference !== 'Any' && currentUser.gender) {
        if (apt.counselorGenderPreference.toLowerCase() !== currentUser.gender.toLowerCase()) {
          return false;
        }
      }

      // Exclude if I have BLOCKED this day/date & time slot
      const aptDay = apt.date ? DAY_NAMES[new Date(`${apt.date}T00:00:00`).getDay()] : '';
      const normAptSlot = normalizeTimeSlot(apt.timeSlot);
      const slot12h = formatTimeSlot12h(apt.timeSlot);
      const isMyBlockedSlot =
        blockedSet.has(`${aptDay}_${apt.timeSlot}`) ||
        blockedSet.has(`${aptDay}_${normAptSlot}`) ||
        blockedSet.has(`${aptDay}_${slot12h}`) ||
        blockedSet.has(`${apt.date}_${apt.timeSlot}`) ||
        blockedSet.has(`${apt.date}_${normAptSlot}`) ||
        blockedSet.has(`${apt.date}_${slot12h}`);

      if (isMyBlockedSlot) {
        // I have blocked this schedule, so this pending unassigned request is not for me
        return false;
      }

      return true;
    });

    const confirmedCount = accessibleAppointments.filter(a => (a.status || '').toLowerCase() === 'confirmed').length;
    const pendingCount = accessibleAppointments.filter(a => (a.status || '').toLowerCase() === 'pending').length;
    const cancelledCount = accessibleAppointments.filter(a => (a.status || '').toLowerCase() === 'cancelled').length;
    const todayApts = accessibleAppointments.filter(
      a => a.date === todayIso && (a.status || '').toLowerCase() !== 'cancelled'
    );
    const todayCount = todayApts.length;

    if (badgeTodayCount) badgeTodayCount.textContent = todayCount;
    if (badgeAllConfirmedCount) badgeAllConfirmedCount.textContent = confirmedCount;
    if (badgeAllPendingCount) badgeAllPendingCount.textContent = pendingCount;
    if (badgeAllCancelledCount) badgeAllCancelledCount.textContent = cancelledCount;

    // Confirmed Consultations Action Alert Banner
    const agendaConfirmedAlert = document.getElementById('agenda-confirmed-alert');
    const confirmedAlertCount = document.getElementById('confirmed-alert-count');
    if (agendaConfirmedAlert) {
      if (confirmedCount > 0 && activeViewFilter !== 'all_confirmed') {
        if (confirmedAlertCount) confirmedAlertCount.textContent = confirmedCount;
        agendaConfirmedAlert.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
      } else {
        agendaConfirmedAlert.classList.add('hidden');
      }
    }

    const agendaPendingAlert = document.getElementById('agenda-pending-alert');
    const pendingAlertCount = document.getElementById('pending-alert-count');
    if (agendaPendingAlert) {
      if (pendingCount > 0 && activeViewFilter !== 'all_pending') {
        if (pendingAlertCount) pendingAlertCount.textContent = pendingCount;
        agendaPendingAlert.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
      } else {
        agendaPendingAlert.classList.add('hidden');
      }
    }

    const agendaCancelledAlert = document.getElementById('agenda-cancelled-alert');
    const cancelledAlertCount = document.getElementById('cancelled-alert-count');
    if (agendaCancelledAlert) {
      if (cancelledCount > 0 && activeViewFilter !== 'all_cancelled') {
        if (cancelledAlertCount) cancelledAlertCount.textContent = cancelledCount;
        agendaCancelledAlert.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
      } else {
        agendaCancelledAlert.classList.add('hidden');
      }
    }

    const selectedDate = agendaDatePicker?.value || todayIso;

    // Render Banner for Blocked Slots on the Selected Date
    const agendaBlockedBanner = document.getElementById('agenda-blocked-banner');
    if (agendaBlockedBanner) {
      const selectedDayOfWeek = selectedDate ? DAY_NAMES[new Date(`${selectedDate}T00:00:00`).getDay()] : '';
      const blockedSlotsOnDate = SLOTS.filter(slot => {
        const norm = normalizeTimeSlot(slot);
        const slot12 = formatTimeSlot12h(slot);
        return (
          blockedSet.has(`${selectedDayOfWeek}_${slot}`) ||
          blockedSet.has(`${selectedDayOfWeek}_${norm}`) ||
          blockedSet.has(`${selectedDayOfWeek}_${slot12}`) ||
          blockedSet.has(`${selectedDate}_${slot}`) ||
          blockedSet.has(`${selectedDate}_${norm}`) ||
          blockedSet.has(`${selectedDate}_${slot12}`)
        );
      }).map(s => formatTimeSlot12h(s));

      if (blockedSlotsOnDate.length > 0 && activeViewFilter === 'selected_date') {
        const isAllSlotsBlocked = blockedSlotsOnDate.length >= SLOTS.length;
        agendaBlockedBanner.innerHTML = `
          <div class="flex items-center gap-2.5">
            <i data-lucide="${isAllSlotsBlocked ? 'calendar-off' : 'shield-alert'}" class="w-4 h-4 text-amber-600 shrink-0"></i>
            <div>
              <span class="font-bold text-amber-900">${isAllSlotsBlocked ? 'Scheduled Leave / Absence Active on ' : 'Your Availability on '}${escapeHtml(selectedDayOfWeek)} (${escapeHtml(selectedDate)}):</span>
              <span class="text-amber-800">${isAllSlotsBlocked ? 'All 8 consultation slots are blocked for this date.' : ' You have blocked '}</span>
              ${!isAllSlotsBlocked ? `<strong class="text-amber-950 font-mono">${escapeHtml(blockedSlotsOnDate.join(', '))}</strong>.` : ''}
              <span class="text-amber-700 block text-[11px] mt-0.5">Students cannot book appointments with you during these blocked hours.</span>
            </div>
          </div>
        `;
        agendaBlockedBanner.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
      } else {
        agendaBlockedBanner.classList.add('hidden');
      }
    }
    const statusFilterVal = agendaStatusFilter?.value || 'ACTIVE';
    const searchQuery = (agendaSearchInput?.value || '').trim().toLowerCase();

    const filtered = accessibleAppointments.filter(item => {
      const itemStatus = (item.status || 'pending').toLowerCase();

      // Instant text search filter
      if (searchQuery) {
        const match =
          (item.studentName || '').toLowerCase().includes(searchQuery) ||
          (item.studentNumber || '').toLowerCase().includes(searchQuery) ||
          (item.program || '').toLowerCase().includes(searchQuery) ||
          (item.concernCategory || '').toLowerCase().includes(searchQuery) ||
          (item.date || '').toLowerCase().includes(searchQuery);
        if (!match) return false;
      }

      // Check view mode:
      if (activeViewFilter === 'all_confirmed') {
        return itemStatus === 'confirmed';
      }
      if (activeViewFilter === 'all_pending') {
        return itemStatus === 'pending';
      }
      if (activeViewFilter === 'all_cancelled') {
        return itemStatus === 'cancelled';
      }
      if (activeViewFilter === 'today') {
        return item.date === todayIso && itemStatus !== 'cancelled';
      }

      // Selected date mode:
      if (item.date !== selectedDate) return false;

      // Check status filter (only applies when viewing selected date):
      if (statusFilterVal === 'ACTIVE') {
        return itemStatus === 'pending' || itemStatus === 'confirmed';
      } else if (statusFilterVal === 'ALL') {
        return true;
      } else {
        return itemStatus === statusFilterVal.toLowerCase();
      }
    });

    if (badgeAgendaCount) {
      badgeAgendaCount.textContent = accessibleAppointments.filter(
        a => (a.date === todayIso && ((a.status || '').toLowerCase() === 'pending' || (a.status || '').toLowerCase() === 'confirmed')) || (a.status || '').toLowerCase() === 'pending'
      ).length;
    }

    // Update Today's Agenda At-a-Glance Widget
    const widgetTodayDate = document.getElementById('widget-today-date');
    const widgetTodaySummary = document.getElementById('widget-today-summary');
    const widgetCountToday = document.getElementById('widget-count-today');
    const widgetCountConfirmed = document.getElementById('widget-count-confirmed');
    const widgetCountPending = document.getElementById('widget-count-pending');

    const todayConfirmedApts = todayApts.filter(a => (a.status || '').toLowerCase() === 'confirmed');

    if (widgetTodayDate) {
      try {
        const todayObj = new Date();
        const formattedToday = todayObj.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric'
        });
        widgetTodayDate.textContent = `Today's Schedule: ${formattedToday}`;
      } catch (_) {
        widgetTodayDate.textContent = `Today's Schedule`;
      }
    }
    if (widgetTodaySummary) {
      widgetTodaySummary.innerHTML = `<strong>${todayApts.length} session(s)</strong> scheduled today (${todayConfirmedApts.length} confirmed) • <strong class="text-emerald-700">${confirmedCount} total confirmed</strong> session(s) ready • <strong class="text-[#00205B]">${pendingCount}</strong> pending request(s).`;
    }
    if (widgetCountToday) widgetCountToday.textContent = todayApts.length;
    if (widgetCountConfirmed) widgetCountConfirmed.textContent = confirmedCount;
    if (widgetCountPending) widgetCountPending.textContent = pendingCount;

    const btnQuickViewToday = document.getElementById('btn-quick-view-today');
    const btnQuickViewConfirmed = document.getElementById('btn-quick-view-confirmed');
    const btnQuickViewPending = document.getElementById('btn-quick-view-pending');
    if (btnQuickViewToday && !btnQuickViewToday._bound) {
      btnQuickViewToday._bound = true;
      btnQuickViewToday.addEventListener('click', () => {
        activeViewFilter = 'today';
        updateFilterUI();
        renderAgenda();
      });
    }
    if (btnQuickViewConfirmed && !btnQuickViewConfirmed._bound) {
      btnQuickViewConfirmed._bound = true;
      btnQuickViewConfirmed.addEventListener('click', () => {
        activeViewFilter = 'all_confirmed';
        updateFilterUI();
        renderAgenda();
      });
    }
    if (btnQuickViewPending && !btnQuickViewPending._bound) {
      btnQuickViewPending._bound = true;
      btnQuickViewPending.addEventListener('click', () => {
        activeViewFilter = 'all_pending';
        updateFilterUI();
        renderAgenda();
      });
    }

    filtered.sort((a, b) => {
      if (activeViewFilter === 'all_cancelled') {
        return new Date(b.cancelledAt || b.date) - new Date(a.cancelledAt || a.date);
      }
      if (activeViewFilter === 'all_confirmed' || activeViewFilter === 'all_pending') {
        const dateComp = (a.date || '').localeCompare(b.date || '');
        if (dateComp !== 0) return dateComp;
        return normalizeTimeSlot(a.timeSlot || '').localeCompare(normalizeTimeSlot(b.timeSlot || ''));
      }
      if (activeViewFilter === 'today') {
        return normalizeTimeSlot(a.timeSlot || '').localeCompare(normalizeTimeSlot(b.timeSlot || ''));
      }
      const isAPending = (a.status || '').toLowerCase() === 'pending';
      const isBPending = (b.status || '').toLowerCase() === 'pending';
      if (isAPending && !isBPending) return -1;
      if (!isAPending && isBPending) return 1;
      return normalizeTimeSlot(a.timeSlot || '').localeCompare(normalizeTimeSlot(b.timeSlot || ''));
    });

    if (filtered.length === 0) {
      let emptyMsg = `No scheduled counseling sessions for ${selectedDate}.`;
      if (searchQuery) {
        emptyMsg = `No consultation records found matching "${escapeHtml(searchQuery)}".`;
      } else if (activeViewFilter === 'today') {
        emptyMsg = `No consultations scheduled for today (${todayIso}). Check "Confirmed" tab for upcoming sessions.`;
      } else if (activeViewFilter === 'all_confirmed') {
        emptyMsg = 'No confirmed consultations currently. Accept pending requests to schedule sessions.';
      } else if (activeViewFilter === 'all_pending') {
        emptyMsg = 'No pending appointment requests currently.';
      } else if (activeViewFilter === 'all_cancelled') {
        emptyMsg = 'No cancelled appointments on record.';
      } else if (statusFilterVal === 'ACTIVE') {
        emptyMsg = `No active consultations (Pending/Confirmed) for ${selectedDate}. Check status filter or Cancelled tab to view other appointments.`;
      } else if (statusFilterVal !== 'ALL') {
        emptyMsg = `No ${statusFilterVal} consultations found for ${selectedDate}.`;
      }
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
        const isCancelled = statusLower === 'cancelled';

        const aptDay = apt.date ? DAY_NAMES[new Date(`${apt.date}T00:00:00`).getDay()] : '';
        const normAptSlot = normalizeTimeSlot(apt.timeSlot);
        const slot12h = formatTimeSlot12h(apt.timeSlot);
        const isConflict =
          blockedSet.has(`${aptDay}_${apt.timeSlot}`) ||
          blockedSet.has(`${aptDay}_${normAptSlot}`) ||
          blockedSet.has(`${aptDay}_${slot12h}`) ||
          blockedSet.has(`${apt.date}_${apt.timeSlot}`) ||
          blockedSet.has(`${apt.date}_${normAptSlot}`) ||
          blockedSet.has(`${apt.date}_${slot12h}`);

        const formattedSlot = formatTimeSlot12h(apt.timeSlot || '');
        const slotParts = formattedSlot.includes('-')
          ? formattedSlot.split('-').map(s => s.trim())
          : [formattedSlot, ''];

        const concernText = `${apt.concernCategory || ''} ${apt.specificConcern || ''}`.toLowerCase();
        const isUrgent =
          concernText.includes('crisis') ||
          concernText.includes('depress') ||
          concernText.includes('suicid') ||
          concernText.includes('grief') ||
          concernText.includes('probation') ||
          concernText.includes('failing') ||
          concernText.includes('emergency') ||
          concernText.includes('urgent');

        return `
          <div class="p-4 bg-white flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:bg-slate-50/60 transition ${isPending ? 'border-l-4 border-amber-400 bg-amber-50/20' : ''} ${isCancelled ? 'border-l-4 border-rose-500 bg-rose-50/20' : ''} ${isConflict ? 'border-r-4 border-rose-500' : ''}">
            <div class="flex items-center gap-3">
              <div class="w-20 py-2 px-1 rounded-lg bg-[#00205B] text-white flex flex-col items-center justify-center flex-shrink-0 text-center font-mono shadow-2xs">
                <span class="text-xs font-bold leading-tight">${escapeHtml(slotParts[0] || 'TBD')}</span>
                <span class="text-[10px] text-[#F5B800] font-medium leading-tight">${escapeHtml(slotParts[1] || '')}</span>
              </div>
              
              <div class="space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-bold text-xs text-slate-900">${escapeHtml(apt.studentName)}</span>
                  <span class="text-[11px] text-slate-500 font-mono">(${escapeHtml(apt.studentNumber)} • ${escapeHtml(apt.program)})</span>
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${badgeStyles[statusLower] || badgeStyles.pending}">
                    ${escapeHtml(apt.status)}
                  </span>
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 font-mono">
                    <i data-lucide="calendar" class="w-3 h-3 text-slate-500"></i>
                    ${escapeHtml(apt.date || 'TBD')}
                  </span>
                  ${isConfirmed && apt.date <= todayIso ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs"><i data-lucide="clock" class="w-3 h-3 text-emerald-600"></i>Ready for Session / Done</span>` : ''}
                  ${isConflict ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">BLOCKED SLOT CONFLICT</span>` : ''}
                  ${isUrgent ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-300 shadow-2xs animate-pulse"><i data-lucide="alert-circle" class="w-3 h-3 text-amber-600"></i>Priority Triage</span>` : ''}
                </div>
                
                <div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span class="font-semibold text-[#00205B]">${escapeHtml(apt.concernCategory)}</span>
                  <span>Counselor: <strong class="text-slate-700">${escapeHtml(apt.counselorName || 'Any Available')}</strong></span>
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-1.5 self-end md:self-center flex-wrap">
              <button data-id="${escapeHtml(apt.id)}" class="btn-view-apt-details px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition flex items-center gap-1 shadow-2xs" title="View complete details, contact info, notes, and cancellation reason">
                <i data-lucide="eye" class="w-3.5 h-3.5 text-slate-500"></i>
                <span>Details</span>
              </button>

              ${
                isPending
                  ? `
              <button data-action="Confirmed" data-id="${escapeHtml(apt.id)}" class="btn-apt-status px-3 py-1.5 rounded-lg bg-[#00205B] hover:bg-[#0A192F] text-white text-xs font-semibold shadow-sm transition flex items-center gap-1" title="Accept consultation and dispatch confirmation email to student">
                <i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400"></i>
                <span>Accept</span>
              </button>
              <button data-action="Cancelled" data-id="${escapeHtml(apt.id)}" class="btn-apt-status px-2.5 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-medium transition">
                Decline
              </button>
              `
                  : ''
              }

              ${
                isConfirmed
                  ? `
              <button data-action="Completed" data-id="${escapeHtml(apt.id)}" class="btn-apt-status px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-sm transition flex items-center gap-1.5" title="Mark this counseling session as completed and log clinical notes">
                <i data-lucide="check-check" class="w-3.5 h-3.5"></i>
                <span>Complete Session</span>
              </button>
              <button data-student-num="${escapeHtml(apt.studentNumber)}" data-student-name="${escapeHtml(apt.studentName)}" data-program="${escapeHtml(apt.program)}" data-date="${escapeHtml(apt.date)}" data-time="${escapeHtml(apt.timeSlot)}" class="btn-quick-callslip px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold transition flex items-center gap-1 shadow-2xs" title="Generate institutional call slip for this student">
                <i data-lucide="file-badge-2" class="w-3.5 h-3.5"></i>
                <span>Call Slip</span>
              </button>
              <button data-action="No-Show" data-id="${escapeHtml(apt.id)}" class="btn-apt-status px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium transition">
                No-Show
              </button>
              `
                  : ''
              }

              <button data-student-num="${escapeHtml(apt.studentNumber)}" data-student-name="${escapeHtml(apt.studentName)}" data-program="${escapeHtml(apt.program)}" class="btn-open-case-direct px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition">
                Open Case
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    if (window.lucide) window.lucide.createIcons();
  }

  agendaList?.addEventListener('click', async e => {
    const detailsBtn = e.target.closest('.btn-view-apt-details');
    if (detailsBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = detailsBtn.getAttribute('data-id');
      const apt = allAppointments.find(a => a.id === id);
      if (apt) {
        openAppointmentDetailsModal(apt);
      }
      return;
    }

    const quickCsBtn = e.target.closest('.btn-quick-callslip');
    if (quickCsBtn) {
      e.preventDefault();
      e.stopPropagation();
      openCallSlipModal({
        studentName: quickCsBtn.getAttribute('data-student-name'),
        studentNumber: quickCsBtn.getAttribute('data-student-num'),
        program: quickCsBtn.getAttribute('data-program'),
        date: quickCsBtn.getAttribute('data-date'),
        timeSlot: quickCsBtn.getAttribute('data-time')
      });
      return;
    }

    const statusBtn = e.target.closest('.btn-apt-status');
    if (statusBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = statusBtn.getAttribute('data-id');
      const status = statusBtn.getAttribute('data-action');
      if (!id || !status || statusBtn.disabled) return;

      statusBtn.disabled = true;
      statusBtn.classList.add('opacity-70', 'cursor-wait');
      statusBtn.innerHTML = `<span>Updating...</span>`;

      try {
        const extra = {};
        if (status === 'Confirmed') {
          extra.counselorId = currentUser.uid;
          extra.counselorName = currentUser.fullName || 'Guidance Counselor';
        }

        // Optimistic UI update for instant response
        const targetApt = allAppointments.find(a => a.id === id);
        if (targetApt) {
          targetApt.status = status;
          if (status === 'Confirmed') {
            targetApt.counselorId = currentUser.uid;
            targetApt.counselorName = currentUser.fullName || 'Guidance Counselor';
          }
        }
        renderAgenda();

        await updateAppointmentStatus(id, status, extra);

        // Automated Email Notification when Counselor Confirms Booking
        if (status === 'Confirmed') {
          const targetStudentEmail = targetApt?.studentEmail || targetApt?.email || '';
          fetch('/api/send-appointment-confirmation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              studentEmail: targetStudentEmail,
              studentName: targetApt?.studentName || 'Student',
              studentNumber: targetApt?.studentNumber || '',
              counselorName: currentUser.fullName || 'Guidance Counselor',
              date: targetApt?.date || '',
              timeSlot: targetApt?.timeSlot || '',
              concernCategory: targetApt?.concernCategory || '',
              appointmentId: id
            })
          })
            .then(res => res.json())
            .then(data => {
              if (data.success && data.recipient) {
                showToast(`Confirmation email dispatched to ${data.recipient}.`, 'success', 'Email Delivered');
              } else if (!data.success) {
                console.warn('Confirmation email dispatch warning:', data.error);
              }
            })
            .catch(err => console.warn('Confirmation email dispatch notice:', err));
        }

        await logAuditEvent(
          currentUser.uid,
          currentUser.fullName,
          currentUser.role,
          `APPOINTMENT_${status.toUpperCase()}`,
          `Updated appointment ${id} to ${status}`
        );

        showToast(
          status === 'Confirmed'
            ? 'Appointment confirmed! Official confirmation email sent to student. Session is in "Confirmed / Action" tab.'
            : status === 'Completed'
            ? 'Consultation session marked as Completed! Click "Open Case" anytime to log session notes.'
            : `Appointment status updated to ${status}.`,
          'success',
          status === 'Confirmed' ? 'Confirmed & Scheduled' : status === 'Completed' ? 'Session Completed' : 'Status Updated'
        );
      } catch (err) {
        console.error('Error updating appointment:', err);
        showToast(err.message || 'Failed to update appointment.', 'error');
        renderAgenda();
      }
      return;
    }

    const caseBtn = e.target.closest('.btn-open-case-direct');
    if (caseBtn) {
      e.preventDefault();
      e.stopPropagation();
      const sNum = caseBtn.getAttribute('data-student-num');
      const sName = caseBtn.getAttribute('data-student-name');
      const sProg = caseBtn.getAttribute('data-program');

      const caseRecord = await getOrCreateCase(sNum, sName, sProg, currentUser.uid);
      if (caseRecord.status === 'Closed') {
        await updateCaseStatus(caseRecord.id, 'Active');
        caseRecord.status = 'Active';
        showToast(`Retrieved past clinical records for ${sName}. Case reopened as Active.`, 'info');
      }
      switchTab('cases');
      selectCaseFolder(caseRecord.id);
    }
  });

  // --- Appointment Details Modal Controller ---
  const modalAptDetails = document.getElementById('modal-appointment-details');
  const btnCloseAptDetails = document.getElementById('btn-close-apt-details');
  const btnDismissAptDetails = document.getElementById('btn-dismiss-apt-details');
  const aptModalOpenCase = document.getElementById('apt-modal-btn-open-case');

  function closeAppointmentDetailsModal() {
    if (modalAptDetails) modalAptDetails.classList.add('hidden');
  }

  btnCloseAptDetails?.addEventListener('click', closeAppointmentDetailsModal);
  btnDismissAptDetails?.addEventListener('click', closeAppointmentDetailsModal);
  modalAptDetails?.addEventListener('click', e => {
    if (e.target === modalAptDetails) closeAppointmentDetailsModal();
  });

  function openAppointmentDetailsModal(apt) {
    if (!modalAptDetails || !apt) return;

    const nameEl = document.getElementById('apt-modal-student-name');
    const idEl = document.getElementById('apt-modal-student-id');
    const progEl = document.getElementById('apt-modal-student-prog');
    const statusBadge = document.getElementById('apt-modal-status-badge');
    const phoneEl = document.getElementById('apt-modal-student-phone');
    const emailEl = document.getElementById('apt-modal-student-email');
    const genderEl = document.getElementById('apt-modal-student-gender');
    const dateEl = document.getElementById('apt-modal-date');
    const timeEl = document.getElementById('apt-modal-time');
    const counselorEl = document.getElementById('apt-modal-counselor');
    const prefEl = document.getElementById('apt-modal-pref');
    const concernCatEl = document.getElementById('apt-modal-concern-cat');
    const specificConcernEl = document.getElementById('apt-modal-specific-concern');
    const cancelBox = document.getElementById('apt-modal-cancel-box');
    const cancelReasonEl = document.getElementById('apt-modal-cancel-reason');
    const cancelTimeEl = document.getElementById('apt-modal-cancel-time');

    if (nameEl) nameEl.textContent = apt.studentName || 'Student';
    if (idEl) idEl.textContent = apt.studentNumber || 'N/A';
    if (progEl) progEl.textContent = apt.program || 'N/A';

    const statusLower = (apt.status || 'pending').toLowerCase();
    const badgeStyles = {
      pending: 'bg-amber-50 text-amber-700 border-amber-200',
      confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      completed: 'bg-slate-100 text-slate-700 border-slate-200',
      cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
      'no-show': 'bg-slate-100 text-slate-500 border-slate-200'
    };

    if (statusBadge) {
      statusBadge.textContent = apt.status || 'Pending';
      statusBadge.className = `px-2.5 py-1 rounded-full text-[10px] font-bold border ${badgeStyles[statusLower] || badgeStyles.pending}`;
    }

    if (phoneEl) phoneEl.textContent = apt.contactNumber || 'None provided';
    if (emailEl) emailEl.textContent = apt.studentEmail || 'None provided';
    if (genderEl) genderEl.textContent = apt.gender || 'Not specified';
    if (dateEl) dateEl.textContent = apt.date || 'TBD';
    if (timeEl) timeEl.textContent = formatTimeSlot12h(apt.timeSlot) || 'TBD';
    if (counselorEl) counselorEl.textContent = apt.counselorName || 'Any Available Counselor';
    if (prefEl) prefEl.textContent = apt.counselorGenderPreference || 'Any';
    if (concernCatEl) concernCatEl.textContent = apt.concernCategory || 'General Guidance Consultation';

    if (specificConcernEl) {
      if (apt.specificConcern && apt.specificConcern.trim()) {
        specificConcernEl.textContent = `"${apt.specificConcern.trim()}"`;
        specificConcernEl.classList.remove('text-slate-400');
        specificConcernEl.classList.add('text-slate-700');
      } else {
        specificConcernEl.textContent = 'No additional notes or disclosures provided by student.';
        specificConcernEl.classList.remove('text-slate-700');
        specificConcernEl.classList.add('text-slate-400');
      }
    }

    if (cancelBox) {
      if (statusLower === 'cancelled') {
        cancelBox.classList.remove('hidden');
        if (cancelReasonEl) cancelReasonEl.textContent = `"${apt.cancellationReason || 'No detailed reason provided.'}"`;
        if (cancelTimeEl) {
          cancelTimeEl.textContent = apt.cancelledAt ? `Recorded: ${formatDateIso(apt.cancelledAt)}` : '';
        }
      } else {
        cancelBox.classList.add('hidden');
      }
    }

    if (aptModalOpenCase) {
      aptModalOpenCase.onclick = async () => {
        closeAppointmentDetailsModal();
        const caseRecord = await getOrCreateCase(apt.studentNumber, apt.studentName, apt.program, currentUser.uid);
        if (caseRecord.status === 'Closed') {
          await updateCaseStatus(caseRecord.id, 'Active');
          caseRecord.status = 'Active';
          showToast(`Retrieved past clinical records for ${apt.studentName}. Case reopened as Active.`, 'info');
        }
        switchTab('cases');
        selectCaseFolder(caseRecord.id);
      };
    }

    modalAptDetails.classList.remove('hidden');
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
 <div class="bg-white p-2.5 rounded border border-slate-200 shadow-sm flex items-center justify-between gap-2">
 <div>
 <div class="flex items-center gap-1.5">
 <span class="font-mono font-bold text-slate-900 text-xs">${escapeHtml(t.ticketNumber)}</span>
 <span class="text-xs font-semibold text-slate-800">${escapeHtml(t.studentName)}</span>
 </div>
 <div class="text-[10px] text-slate-500">${escapeHtml(t.program)}</div>
 </div>
 <button data-call-id="${escapeHtml(t.id)}" class="btn-call-walkin px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition">
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
 <div class="bg-white p-2.5 rounded border border-emerald-200 shadow-sm space-y-1.5">
 <div class="flex items-center justify-between">
 <span class="font-mono font-bold text-emerald-800 text-xs">${escapeHtml(t.ticketNumber)}</span>
 <span class="text-[9px] font-bold uppercase text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">Calling</span>
 </div>
 <div class="text-xs font-bold text-slate-900">${escapeHtml(t.studentName)}</div>
 <div class="text-[10px] text-slate-500">${escapeHtml(t.program)}</div>
 <div class="pt-1 flex gap-1.5">
 <button data-start-id="${escapeHtml(t.id)}" class="btn-start-walkin flex-1 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition">
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
 <div class="bg-white p-2.5 rounded border border-slate-200 shadow-sm space-y-1.5">
 <div class="flex items-center justify-between">
 <span class="font-mono font-bold text-slate-900 text-xs">${escapeHtml(t.ticketNumber)}</span>
 <span class="text-[9px] font-bold uppercase text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">In Session</span>
 </div>
 <div class="text-xs font-bold text-slate-900">${escapeHtml(t.studentName)}</div>
 <div class="text-[10px] text-slate-500">${escapeHtml(t.program)}</div>
 <div class="pt-1">
 <button data-complete-id="${escapeHtml(t.id)}" data-snum="${escapeHtml(t.studentNumber)}" data-sname="${escapeHtml(t.studentName)}" data-sprog="${escapeHtml(t.program)}" class="btn-complete-walkin w-full py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition">
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
        if (caseRecord.status === 'Closed') {
          await updateCaseStatus(caseRecord.id, 'Active');
          caseRecord.status = 'Active';
          showToast(`Retrieved past clinical records for ${sname}. Case reopened as Active.`, 'info');
        }
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
  const referralStatusFilter = document.getElementById('referral-status-filter');

  referralStatusFilter?.addEventListener('change', renderReferralInbox);

  subscribeAllReferrals(referrals => {
    allReferrals = referrals;
    renderReferralInbox();
  });

  function renderReferralInbox() {
    if (!referralsTbody) return;
    const openReferralsCount = allReferrals.filter(r => r.status !== 'Closed').length;
    if (badgeReferralCount) {
      badgeReferralCount.textContent = openReferralsCount;
    }

    const filterVal = referralStatusFilter?.value || 'ACTIVE';
    const filteredReferrals = allReferrals.filter(r => {
      if (filterVal === 'ACTIVE') {
        return r.status !== 'Closed';
      } else if (filterVal === 'ALL') {
        return true;
      } else {
        return (r.status || '').toLowerCase() === filterVal.toLowerCase();
      }
    });

    if (filteredReferrals.length === 0) {
      const msg =
        filterVal === 'ACTIVE'
          ? 'No active faculty referrals in inbox. (Closed referrals can be viewed via status filter)'
          : `No referrals found with status "${filterVal}".`;
      referralsTbody.innerHTML = `
        <tr>
          <td colspan="6" class="p-8 text-center text-slate-400 text-xs">
            ${msg}
          </td>
        </tr>
      `;
      return;
    }

    const referralCountsByStudent = {};
    allReferrals.forEach(ref => {
      const num = (ref.studentNumber || '').trim().toLowerCase();
      if (num) referralCountsByStudent[num] = (referralCountsByStudent[num] || 0) + 1;
    });

    referralsTbody.innerHTML = filteredReferrals
      .map(r => {
        const stageStyles = {
          Referred: 'bg-amber-50 text-amber-700 border-amber-200/80',
          'Call Slip Issued': 'bg-blue-50 text-blue-700 border-blue-200/80',
          'Intake Conducted': 'bg-purple-50 text-purple-700 border-purple-200/80',
          Closed: 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
        };

        const studentKey = (r.studentNumber || '').trim().toLowerCase();
        const repeatCount = referralCountsByStudent[studentKey] || 1;
        const hasExistingCase = allCases.some(c => (c.studentNumber || '').trim().toLowerCase() === studentKey);

        return `
        <tr class="hover:bg-slate-50/60 transition">
          <td class="py-2.5 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">${escapeHtml(formatDateIso(r.createdAt) || 'Recent')}</td>
          <td class="py-2.5 px-4">
            <div class="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
              <span>${escapeHtml(r.studentName)}</span>
              ${repeatCount > 1 ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300" title="This student has ${repeatCount} referral endorsements on record."><i data-lucide="repeat" class="w-3 h-3 text-amber-700"></i> ${repeatCount}x Referral</span>` : ''}
              ${hasExistingCase ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-semibold bg-blue-50 text-[#00205B] border border-blue-200" title="Central clinical case folder exists for this student"><i data-lucide="folder-check" class="w-3 h-3 text-blue-600"></i> Case Exists</span>` : ''}
            </div>
            <div class="text-[11px] text-slate-500">${escapeHtml(r.studentNumber)} • ${escapeHtml(r.program)}</div>
          </td>
          <td class="py-2.5 px-4">
            <div class="font-semibold text-slate-800">${escapeHtml(r.facultyName)}</div>
            <div class="text-[11px] text-slate-500">${escapeHtml(r.subjectCourse || 'General')}</div>
          </td>
          <td class="py-2.5 px-4">
            <span class="font-medium text-slate-800">${escapeHtml(r.reasonCategory)}</span>
          </td>
          <td class="py-2.5 px-4">
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${stageStyles[r.status] || stageStyles.Referred}">
              ${escapeHtml(r.status)}
            </span>
          </td>
          <td class="py-2.5 px-4 text-right space-x-1 whitespace-nowrap">
            <button data-cs-id="${escapeHtml(r.id)}" class="btn-issue-callslip px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition" title="Generate guidance call slip">
              Call Slip
            </button>
            
            ${
              r.status === 'Call Slip Issued'
                ? `
            <button data-intake-id="${escapeHtml(r.id)}" data-snum="${escapeHtml(r.studentNumber)}" data-sname="${escapeHtml(r.studentName)}" data-sprog="${escapeHtml(r.program)}" class="btn-intake-conducted px-2 py-1 rounded bg-purple-700 hover:bg-purple-800 text-white text-xs font-medium transition" title="Start clinical intake and open case folder">
              Intake
            </button>
            `
                : ''
            }

            <button data-snum="${escapeHtml(r.studentNumber)}" data-sname="${escapeHtml(r.studentName)}" data-sprog="${escapeHtml(r.program)}" class="btn-open-case-from-ref px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition" title="Open central clinical case folder">
              Case Folder
            </button>

            ${
              r.status !== 'Closed'
                ? `
            <button data-close-ref-id="${escapeHtml(r.id)}" class="btn-close-referral px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium transition" title="Archive referral">
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
    if (window.lucide) window.lucide.createIcons();
  }

  referralsTbody?.addEventListener('click', async e => {
    const openCaseBtn = e.target.closest('.btn-open-case-from-ref');
    if (openCaseBtn) {
      e.preventDefault();
      const snum = openCaseBtn.getAttribute('data-snum');
      const sname = openCaseBtn.getAttribute('data-sname');
      const sprog = openCaseBtn.getAttribute('data-sprog');
      const caseRecord = await getOrCreateCase(snum, sname, sprog, currentUser.uid);
      if (caseRecord.status === 'Closed') {
        await updateCaseStatus(caseRecord.id, 'Active');
        caseRecord.status = 'Active';
        showToast(`Retrieved past clinical records for ${sname}. Case reopened as Active.`, 'info');
      }
      switchTab('cases');
      selectCaseFolder(caseRecord.id);
      return;
    }

    const csBtn = e.target.closest('.btn-issue-callslip');
    if (csBtn) {
      e.preventDefault();
      const id = csBtn.getAttribute('data-cs-id');
      const ref = allReferrals.find(r => r.id === id);
      if (ref) openCallSlipModal(ref);
      return;
    }

    const intakeBtn = e.target.closest('.btn-intake-conducted');
    if (intakeBtn) {
      e.preventDefault();
      if (intakeBtn.disabled) return;
      intakeBtn.disabled = true;

      const id = intakeBtn.getAttribute('data-intake-id');
      const snum = intakeBtn.getAttribute('data-snum');
      const sname = intakeBtn.getAttribute('data-sname');
      const sprog = intakeBtn.getAttribute('data-sprog');

      try {
        await updateReferralStatus(id, 'Intake Conducted');
        const targetRef = allReferrals.find(r => r.id === id);
        if (targetRef) targetRef.status = 'Intake Conducted';
        renderReferralInbox();

        await logAuditEvent(
          currentUser.uid,
          currentUser.fullName,
          currentUser.role,
          'REFERRAL_INTAKE_CONDUCTED',
          `Conducted intake for referral ${id}`
        );
        showToast('Status updated to Intake Conducted.', 'success');

        const caseRecord = await getOrCreateCase(snum, sname, sprog, currentUser.uid);
        if (caseRecord.status === 'Closed') {
          await updateCaseStatus(caseRecord.id, 'Active');
          caseRecord.status = 'Active';
          showToast(`Retrieved past clinical records for ${sname}. Case reopened as Active.`, 'info');
        }
        switchTab('cases');
        selectCaseFolder(caseRecord.id);
      } catch (err) {
        intakeBtn.disabled = false;
        showToast(err.message || 'Failed to update referral.', 'error');
      }
      return;
    }

    const closeBtn = e.target.closest('.btn-close-referral');
    if (closeBtn) {
      e.preventDefault();
      if (closeBtn.disabled) return;
      const id = closeBtn.getAttribute('data-close-ref-id');
      const confirmed = await showConfirmDialog({
        title: 'Close Referral?',
        message: 'Are you sure you want to mark this referral as Closed? It will be archived from your active inbox.',
        confirmText: 'Yes, Close',
        cancelText: 'Cancel',
        type: 'warning'
      });
      if (confirmed) {
        closeBtn.disabled = true;
        const targetRef = allReferrals.find(r => r.id === id);
        if (targetRef) targetRef.status = 'Closed';
        renderReferralInbox();

        try {
          await updateReferralStatus(id, 'Closed');
          await logAuditEvent(
            currentUser.uid,
            currentUser.fullName,
            currentUser.role,
            'REFERRAL_CLOSED',
            `Closed referral ${id}`
          );
          showToast('Referral closed and archived.', 'info');
        } catch (err) {
          showToast(err.message || 'Failed to close referral.', 'error');
          renderReferralInbox();
        }
      }
      return;
    }
  });

  const callslipModal = document.getElementById('callslip-modal');
  const btnCloseCallslip = document.getElementById('btn-close-callslip');
  const btnPrintCallslipPreview = document.getElementById('btn-print-callslip-preview');
  let activeReferralForCallSlip = null;

  function openCallSlipModal(referral) {
    activeReferralForCallSlip = referral;
    const studentInput = document.getElementById('cs-student');
    const counselorInput = document.getElementById('cs-counselor');
    const dateInput = document.getElementById('cs-date');
    const timeInput = document.getElementById('cs-time');

    if (studentInput) {
      studentInput.value = `${referral.studentName || 'Student'} (${referral.studentNumber || ''} - ${referral.program || ''})`;
    }
    if (counselorInput) counselorInput.value = currentUser.fullName;

    if (dateInput) {
      if (referral.date) {
        dateInput.value = referral.date;
      } else {
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        dateInput.value = tomorrow;
      }
    }

    if (timeInput && referral.timeSlot) {
      timeInput.value = referral.timeSlot;
    }

    callslipModal?.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  btnCloseCallslip?.addEventListener('click', () => callslipModal?.classList.add('hidden'));

  btnPrintCallslipPreview?.addEventListener('click', async () => {
    if (!activeReferralForCallSlip) return;
    const appDate = document.getElementById('cs-date')?.value;
    const appTime = document.getElementById('cs-time')?.value;

    if (activeReferralForCallSlip.id && String(activeReferralForCallSlip.id).startsWith('ref_')) {
      await updateReferralStatus(activeReferralForCallSlip.id, 'Call Slip Issued', {
        callSlipIssuedAt: new Date().toISOString().split('T')[0],
        callSlipAppointmentDate: appDate,
        callSlipAppointmentTime: appTime,
        assignedCounselor: currentUser.fullName
      });
    }

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
  const caseStatusFilter = document.getElementById('case-status-filter');
  const caseProgramFilter = document.getElementById('case-program-filter');

  function updateProgramFilterOptions() {
    if (!caseProgramFilter) return;
    const currentVal = caseProgramFilter.value || 'ALL';
    const knownPrograms = new Set([
      'BS Psychology',
      'BS Information Technology',
      'BS Computer Science',
      'BS Business Administration',
      'BS Accountancy',
      'BS Hospitality Management',
      'BS Tourism Management',
      'BS Medical Technology',
      'BS Nursing',
      'SHS STEM',
      'SHS ABM',
      'SHS HUMSS',
      'SHS GAS'
    ]);

    allCases.forEach(c => {
      if (c.program && c.program.trim()) {
        knownPrograms.add(c.program.trim());
      }
    });

    const sorted = Array.from(knownPrograms).sort((a, b) => a.localeCompare(b));
    let html = '<option value="ALL">All Programs</option>';
    sorted.forEach(p => {
      html += `<option value="${escapeHtml(p)}" ${p.toLowerCase() === currentVal.toLowerCase() ? 'selected' : ''}>${escapeHtml(p)}</option>`;
    });
    caseProgramFilter.innerHTML = html;
    caseProgramFilter.value = currentVal;
  }

  subscribeAllCases(cases => {
    allCases = cases;
    updateProgramFilterOptions();
    renderCaseFolders();
    if (selectedCaseId) {
      const active = allCases.find(c => c.id === selectedCaseId);
      if (active) renderCaseDetail(active);
    }
  });

  caseSearchInput?.addEventListener('input', renderCaseFolders);
  caseStatusFilter?.addEventListener('change', renderCaseFolders);
  caseProgramFilter?.addEventListener('change', renderCaseFolders);

  caseFolderList?.addEventListener('click', e => {
    const item = e.target.closest('.case-item');
    if (item) {
      selectCaseFolder(item.getAttribute('data-case-id'));
    }
  });

  function renderCaseFolders() {
    if (!caseFolderList) return;
    const query = (caseSearchInput?.value || '').trim().toLowerCase();
    const statusFilter = caseStatusFilter?.value || 'ACTIVE';
    const programFilter = caseProgramFilter?.value || 'ALL';

    const filtered = allCases.filter(c => {
      // 1. Search text filter (Student Name OR Student Number / ID)
      if (query) {
        const nameMatch = (c.studentName || '').toLowerCase().includes(query);
        const numberMatch = (c.studentNumber || '').toLowerCase().includes(query);
        if (!nameMatch && !numberMatch) return false;
      }

      // 2. Program filter (e.g. BS Psychology)
      if (programFilter !== 'ALL') {
        const progLower = (c.program || '').toLowerCase();
        const targetProg = programFilter.toLowerCase();
        if (!progLower.includes(targetProg) && !targetProg.includes(progLower)) {
          return false;
        }
      }

      // 3. Status filter
      const isHighRisk =
        c.status === 'High Risk' ||
        (c.riskFlags &&
          (c.riskFlags.selfHarm ||
            c.riskFlags.abuseHarmFromOthers ||
            c.riskFlags.threatToOthers ||
            c.riskFlags.abuse ||
            c.riskFlags.threat));
      const displayStatus = isHighRisk ? 'High Risk' : c.status || 'Active';

      if (statusFilter === 'ACTIVE') {
        return displayStatus !== 'Closed';
      } else if (statusFilter === 'ALL') {
        return true;
      } else {
        return displayStatus.toLowerCase() === statusFilter.toLowerCase();
      }
    });

    if (filtered.length === 0) {
      let emptyMsg = 'No matching cases found.';
      if (query) {
        emptyMsg = `No cases matching "${escapeHtml(query)}".`;
      } else if (programFilter !== 'ALL') {
        emptyMsg = `No cases found for ${escapeHtml(programFilter)}.`;
      } else if (statusFilter === 'ACTIVE') {
        emptyMsg = 'No active student cases. (Closed cases can be viewed via status filter)';
      } else if (statusFilter !== 'ALL') {
        emptyMsg = `No cases found with status "${escapeHtml(statusFilter)}".`;
      }
      caseFolderList.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">${emptyMsg}</div>`;
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
          <div data-case-id="${escapeHtml(c.id)}" class="case-item p-3 cursor-pointer transition border-l-2 ${isSelected ? 'bg-slate-100 border-[#00205B]' : 'hover:bg-slate-50 border-transparent'}">
            <div class="flex items-center justify-between">
              <span class="font-bold text-xs text-slate-900">${escapeHtml(c.studentName)}</span>
              <span class="px-1.5 py-0.2 rounded text-[9px] border ${badgeClass}">
                ${escapeHtml(displayStatus.toUpperCase())}
              </span>
            </div>
            <div class="text-[11px] text-slate-500 font-mono mt-0.5 flex items-center justify-between">
              <span>${escapeHtml(c.studentNumber)}</span>
              <span class="font-sans font-semibold text-[#00205B] truncate max-w-[125px]" title="${escapeHtml(c.program)}">${escapeHtml(c.program)}</span>
            </div>
          </div>
        `;
      })
      .join('');
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
    const isClosed = currentStatus === 'Closed';

    const badgeStyles = {
      'High Risk': 'bg-rose-50 text-rose-700 border-rose-200 font-bold',
      Active: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold',
      Monitoring: 'bg-amber-50 text-amber-700 border-amber-200 font-semibold',
      Closed: 'bg-slate-100 text-slate-500 border-slate-200 font-medium'
    };

    let studentPhone = caseRecord.contactNumber || '';
    let studentEmail = caseRecord.email || '';
    const matchedApt = allAppointments.find(a => a.studentNumber === caseRecord.studentNumber);
    if (matchedApt) {
      if (!studentPhone) studentPhone = matchedApt.contactNumber || '';
      if (!studentEmail) studentEmail = matchedApt.studentEmail || '';
    }

    caseDetailPanel.innerHTML = `
      <!-- Case Header -->
      <div class="pb-3 border-b border-slate-200 space-y-2.5">
        <!-- Top Row: Student Name, ID, Header Badge (Left) & Status Dropdown (Right, inline with name) -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-base font-bold text-slate-900">${escapeHtml(caseRecord.studentName)}</h3>
            <span class="text-xs text-slate-500 font-mono">(${escapeHtml(caseRecord.studentNumber)})</span>
            <span id="case-header-badge" class="px-2 py-0.5 rounded text-[10px] border ${badgeStyles[currentStatus] || badgeStyles.Active}">
              ${escapeHtml(currentStatus)}
            </span>
          </div>

          <div class="flex items-center gap-2 self-start sm:self-center shrink-0">
            <label for="case-status-select" class="text-xs text-slate-500 font-semibold">Status:</label>
            <select id="case-status-select" class="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white font-bold text-slate-800 focus:border-[#00205B] focus:outline-none shadow-sm">
              <option value="Active" ${currentStatus === 'Active' ? 'selected' : ''}>Active</option>
              <option value="High Risk" ${currentStatus === 'High Risk' ? 'selected' : ''}>High Risk</option>
              <option value="Monitoring" ${currentStatus === 'Monitoring' ? 'selected' : ''}>Monitoring</option>
              <option value="Closed" ${currentStatus === 'Closed' ? 'selected' : ''}>Closed</option>
            </select>
          </div>
        </div>

        <!-- Row 2: Program, Category, Phone, Email -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>${escapeHtml(caseRecord.program)} • ${escapeHtml(caseRecord.category || 'Clinical Record')}</span>
          ${studentPhone ? `<a href="tel:${escapeHtml(studentPhone)}" class="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-[#00205B] transition"><i data-lucide="phone" class="w-3.5 h-3.5 text-emerald-600"></i><span>${escapeHtml(studentPhone)}</span></a>` : ''}
          ${studentEmail ? `<a href="mailto:${escapeHtml(studentEmail)}" class="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-[#00205B] transition"><i data-lucide="mail" class="w-3.5 h-3.5 text-blue-600"></i><span>${escapeHtml(studentEmail)}</span></a>` : ''}
        </div>

        <!-- Row 3: Automatically Unified Past Student IDs / Shift History (Read-Only) -->
        ${
          caseRecord.previousStudentNumbers && caseRecord.previousStudentNumbers.length > 0
            ? `
            <div class="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 text-xs">
              <span class="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
                <i data-lucide="history" class="w-3.5 h-3.5 text-blue-600"></i> Previous Student ID(s):
              </span>
              ${caseRecord.previousStudentNumbers
                .map(
                  oldNum => `
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                  ${escapeHtml(oldNum)}
                </span>
              `
                )
                .join('')}
            </div>
            `
            : ''
        }
      </div>

      ${
        isClosed
          ? `
      <!-- CLOSED CASE REOPEN BANNER -->
      <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-amber-900">
        <div class="flex items-center gap-2">
          <i data-lucide="archive" class="w-4 h-4 text-amber-600 shrink-0"></i>
          <div>
            <span class="font-bold text-amber-950">This Student Case Folder is Marked as Closed.</span>
            <span class="text-amber-800 block text-[11px]">All past clinical session notes and history are safely preserved below. You can reopen this case if the student returns for a new concern.</span>
          </div>
        </div>
        <button type="button" id="btn-reopen-case" class="px-3 py-1.5 bg-[#00205B] text-white rounded-md font-bold hover:bg-[#0A192F] transition text-xs shrink-0 shadow-sm flex items-center gap-1.5">
          <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
          <span>Reopen Case (Set to Active)</span>
        </button>
      </div>
      `
          : ''
      }

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
 <button type="submit" class="px-3.5 py-1.5 rounded-lg bg-[#00205B] hover:bg-[#0A192F] text-white font-semibold shadow-sm transition">
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
        renderCaseFolders();
      } catch (err) {
        console.error('Error updating case status:', err);
        showToast(`Failed to update case status: ${err.message}`, 'error');
      }
    });

    document.getElementById('btn-reopen-case')?.addEventListener('click', async () => {
      await updateCaseStatus(caseRecord.id, 'Active');
      caseRecord.status = 'Active';
      await logAuditEvent(
        currentUser.uid,
        currentUser.fullName,
        currentUser.role,
        'CASE_REOPENED',
        `Reopened case for ${caseRecord.studentName} (${caseRecord.studentNumber}) as Active`
      );
      showToast(`Case for ${caseRecord.studentName} reopened as Active.`, 'success');
      renderCaseFolders();
      renderCaseDetail(caseRecord);
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
        renderCaseFolders();
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
      let currentStatusVal = caseStatusSelect?.value || caseRecord.status || 'Active';

      // If logging a session note on a previously Closed case, automatically reactivate it to Active
      if (caseRecord.status === 'Closed' && currentStatusVal === 'Closed') {
        currentStatusVal = 'Active';
      }

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

        if (caseRecord.status !== currentStatusVal) {
          caseRecord.status = currentStatusVal;
          renderCaseFolders();
          renderCaseDetail(caseRecord);
        }
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
          <div class="${n.isLinkedRecord ? 'bg-blue-50/50 border-blue-200' : 'bg-white border-slate-200'} p-3.5 rounded border space-y-1.5 text-xs transition">
            <div class="flex items-center justify-between border-b ${n.isLinkedRecord ? 'border-blue-100' : 'border-slate-100'} pb-1.5 flex-wrap gap-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-bold text-slate-900">${escapeHtml(n.noteType || 'Clinical Session')} • ${escapeHtml(n.sessionDate || formatDateIso(n.createdAt) || 'Recent')}</span>
                ${
                  n.isLinkedRecord
                    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-[#00205B] border border-blue-200">
                         <i data-lucide="history" class="w-3 h-3 text-blue-600"></i> Past Record (${escapeHtml(n.sourceStudentNumber || 'Previous ID')} • ${escapeHtml(n.sourceProgram || 'Past Program')})
                       </span>`
                    : ''
                }
              </div>
              <span class="text-[10px] font-medium text-slate-600 ${n.isLinkedRecord ? 'bg-white' : 'bg-slate-100'} px-2 py-0.5 rounded border border-slate-200">
                Counselor: <strong class="text-slate-900">${escapeHtml(n.counselorName || 'Guidance Counselor')}</strong>
              </span>
            </div>
            
            <div class="space-y-1 text-slate-700 pt-1">
              <p><strong class="text-slate-900 text-[11px] uppercase">Observations:</strong> ${escapeHtml(n.subjectiveObservation || n.note || 'N/A')}</p>
              <p><strong class="text-slate-900 text-[11px] uppercase">Remarks:</strong> ${escapeHtml(n.counselorRemarks || 'Standard guidance consultation conducted.')}</p>
              <p><strong class="text-slate-900 text-[11px] uppercase">Action Plan:</strong> ${escapeHtml(n.actionPlan || 'Continue monitoring academic and personal adjustment.')}</p>
              ${n.followUpDate ? `<div class="text-[11px] font-semibold text-slate-900 pt-0.5">Follow-Up: ${escapeHtml(n.followUpDate)}</div>` : ''}
            </div>
          </div>
          `
        )
        .join('');
      if (window.lucide) window.lucide.createIcons();
    });
  }

  const availabilityGrid = document.getElementById('availability-slots-grid');
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  async function renderAvailabilityGrid() {
    if (!availabilityGrid) return;
    const blockedRecords = await getCounselorBlockedSlots(currentUser.uid);
    const blockedSet = new Set();
    blockedRecords.forEach(b => {
      blockedSet.add(`${b.dayOfWeek}_${b.timeSlot}`);
      blockedSet.add(`${b.dayOfWeek}_${normalizeTimeSlot(b.timeSlot)}`);
      blockedSet.add(`${b.dayOfWeek}_${formatTimeSlot12h(b.timeSlot)}`);
    });

    let html = '';
    DAYS.forEach(day => {
      html += `
        <div class="col-span-2 sm:col-span-4 mt-2 font-bold text-xs text-slate-800 border-b border-slate-200 pb-1">
          ${day}
        </div>
      `;
      SLOTS.forEach(slot => {
        const norm = normalizeTimeSlot(slot);
        const slot12 = formatTimeSlot12h(slot);
        const isBlocked =
          blockedSet.has(`${day}_${slot}`) ||
          blockedSet.has(`${day}_${norm}`) ||
          blockedSet.has(`${day}_${slot12}`);

        html += `
          <button data-day="${day}" data-slot="${slot}" data-blocked="${isBlocked}" class="btn-toggle-slot p-2 rounded border text-xs text-center transition ${isBlocked ? 'bg-rose-50 border-rose-200 text-rose-700 font-semibold' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}">
            <div class="text-[10px] text-slate-400 font-mono">${formatTimeSlot12h(slot)}</div>
            <div class="text-xs mt-0.5">${isBlocked ? 'BLOCKED' : 'AVAILABLE'}</div>
          </button>
        `;
      });
    });

    availabilityGrid.innerHTML = html;
  }

  availabilityGrid?.addEventListener('click', async e => {
    const btn = e.target.closest('.btn-toggle-slot');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    const day = btn.getAttribute('data-day');
    const slot = btn.getAttribute('data-slot');
    const currentlyBlocked = btn.getAttribute('data-blocked') === 'true';
    const newBlockedState = !currentlyBlocked;

    btn.disabled = true;
    // Optimistic UI state toggle
    btn.setAttribute('data-blocked', String(newBlockedState));
    btn.className = `btn-toggle-slot p-2 rounded border text-xs text-center transition ${newBlockedState ? 'bg-rose-50 border-rose-200 text-rose-700 font-semibold' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`;
    const statusTextEl = btn.querySelector('.text-xs');
    if (statusTextEl) statusTextEl.textContent = newBlockedState ? 'BLOCKED' : 'AVAILABLE';

    try {
      await toggleCounselorBlockedSlot(currentUser.uid, day, slot, newBlockedState);
      await renderAvailabilityGrid();
      renderAgenda();
      showToast(`${day} ${formatTimeSlot12h(slot)} marked as ${newBlockedState ? 'Blocked' : 'Available'}.`, 'info');
    } catch (err) {
      console.warn('Toggle slot error:', err);
      showToast('Failed to update slot availability.', 'error');
      await renderAvailabilityGrid();
    } finally {
      btn.disabled = false;
    }
  });

  renderAvailabilityGrid();

  // --- Leave / Multi-Day Absence Management ---
  const formCounselorLeave = document.getElementById('form-counselor-leave');
  const leaveStartDate = document.getElementById('leave-start-date');
  const leaveDaysCount = document.getElementById('leave-days-count');
  const btnSubmitLeave = document.getElementById('btn-submit-leave');
  const previewDateRange = document.getElementById('preview-date-range');
  const previewSlotsTotal = document.getElementById('preview-slots-total');
  const previewDateChips = document.getElementById('preview-date-chips');
  const activeLeavesCount = document.getElementById('active-leaves-count');
  const activeLeavesContainer = document.getElementById('active-leaves-container');

  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let currentActiveLeaves = [];

  function toYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function calculateLeaveDates(startStr, daysCount) {
    let curr = new Date(startStr + 'T00:00:00');
    if (isNaN(curr.getTime())) curr = new Date();
    // If starting on a weekend, automatically shift forward to Monday
    if (curr.getDay() === 0) curr.setDate(curr.getDate() + 1);
    if (curr.getDay() === 6) curr.setDate(curr.getDate() + 2);

    let added = 0;
    const dates = [];
    let endCurr = new Date(curr);

    while (added < daysCount) {
      const d = endCurr.getDay();
      if (d !== 0 && d !== 6) {
        added++;
        const ymd = toYmd(endCurr);
        const dayLabel = DAY_SHORT[d] || 'Day';
        const mLabel = MONTH_SHORT[endCurr.getMonth()] || '';
        const dateNum = endCurr.getDate();
        dates.push({
          dateStr: ymd,
          dayName: DAYS[d - 1] || 'Weekday',
          label: `${dayLabel}, ${mLabel} ${dateNum}`
        });
        if (added === daysCount) break;
      }
      endCurr.setDate(endCurr.getDate() + 1);
    }

    return {
      startDate: dates.length > 0 ? dates[0].dateStr : toYmd(curr),
      endDate: dates.length > 0 ? dates[dates.length - 1].dateStr : toYmd(endCurr),
      dates
    };
  }

  function findLeaveConflict(datesToCheck) {
    if (!currentActiveLeaves || currentActiveLeaves.length === 0) return null;
    return currentActiveLeaves.find(leave => {
      const leaveDates =
        leave.dates && Array.isArray(leave.dates)
          ? leave.dates
          : getBusinessDatesInRange(leave.startDate, leave.endDate);
      return datesToCheck.some(d => leaveDates.includes(d));
    });
  }

  function updateLeavePreview() {
    if (!previewDateRange || !previewSlotsTotal || !previewDateChips) return;
    const startVal = leaveStartDate?.value || toYmd(new Date());
    const count = Math.max(1, parseInt(leaveDaysCount?.value || '1', 10));

    const calc = calculateLeaveDates(startVal, count);
    const rangeText = calc.startDate === calc.endDate ? calc.startDate : `${calc.startDate} to ${calc.endDate}`;
    const dateStrings = calc.dates.map(d => d.dateStr);
    const conflict = findLeaveConflict(dateStrings);

    previewDateRange.textContent = rangeText;

    if (conflict) {
      const conflictRange =
        conflict.startDate === conflict.endDate ? conflict.startDate : `${conflict.startDate} to ${conflict.endDate}`;
      previewSlotsTotal.className =
        'px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300';
      previewSlotsTotal.innerHTML = `<span class="flex items-center gap-1"><i data-lucide="alert-octagon" class="w-3 h-3 text-rose-600"></i> Date Conflict</span>`;
      previewDateChips.innerHTML = `
        <div class="w-full p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
          <i data-lucide="alert-circle" class="w-4 h-4 text-rose-600 shrink-0"></i>
          <span>Conflict: Selected date range overlaps with an already blocked leave (${conflictRange}). You cannot override an existing blocked schedule.</span>
        </div>
      `;
      if (btnSubmitLeave) {
        btnSubmitLeave.disabled = true;
        btnSubmitLeave.classList.add('opacity-50', 'cursor-not-allowed');
      }
    } else {
      previewSlotsTotal.className =
        'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300';
      previewSlotsTotal.textContent = `${calc.dates.length} Business Day${calc.dates.length > 1 ? 's' : ''} (${calc.dates.length * 8} slots)`;
      previewDateChips.innerHTML = calc.dates
        .map(
          d =>
            `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-[#00205B] border border-blue-200 shadow-2xs">
              <i data-lucide="calendar" class="w-3 h-3 text-blue-600"></i>
              <span>${d.label}</span>
            </span>`
        )
        .join('');
      if (btnSubmitLeave) {
        btnSubmitLeave.disabled = false;
        btnSubmitLeave.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }

    if (window.lucide) window.lucide.createIcons();
  }

  if (leaveStartDate) {
    const today = toYmd(new Date());
    if (!leaveStartDate.value) leaveStartDate.value = today;
    leaveStartDate.min = today;
    updateLeavePreview();
  }

  leaveStartDate?.addEventListener('change', updateLeavePreview);
  leaveDaysCount?.addEventListener('input', updateLeavePreview);

  document.querySelectorAll('.btn-leave-quick-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = btn.getAttribute('data-days');
      if (leaveDaysCount && days) {
        leaveDaysCount.value = days;
        updateLeavePreview();
      }
    });
  });

  formCounselorLeave?.addEventListener('submit', async e => {
    e.preventDefault();
    const startVal = leaveStartDate?.value || toYmd(new Date());
    const daysCount = parseInt(leaveDaysCount?.value || '1', 10);
    if (!daysCount || daysCount < 1) {
      showToast('Please specify the number of days absent/on leave (minimum 1 day).', 'warning', 'Missing Details');
      return;
    }

    const calc = calculateLeaveDates(startVal, daysCount);
    const dateStrings = calc.dates.map(d => d.dateStr);
    const conflict = findLeaveConflict(dateStrings);

    if (conflict) {
      const conflictRange =
        conflict.startDate === conflict.endDate ? conflict.startDate : `${conflict.startDate} to ${conflict.endDate}`;
      showToast(
        `Cannot block schedule: Selected start date or dates overlap with an active blocked leave (${conflictRange}). You cannot override an existing blocked schedule.`,
        'error',
        'Schedule Conflict'
      );
      return;
    }

    if (btnSubmitLeave) {
      btnSubmitLeave.disabled = true;
      btnSubmitLeave.innerHTML = '<span>Blocking Schedule...</span>';
    }

    try {
      const leaveRec = await blockCounselorLeave(currentUser.uid, currentUser.fullName, {
        startDate: calc.startDate,
        endDate: calc.endDate,
        leaveType: 'Leave / Absent'
      });

      await logAuditEvent(
        currentUser.uid,
        currentUser.fullName,
        currentUser.role,
        'COUNSELOR_LEAVE_FILED',
        `Blocked schedule for ${daysCount} day(s) from ${calc.startDate} to ${calc.endDate}`
      );

      showToast(
        `Schedule successfully blocked for ${daysCount} business day(s) (${calc.startDate} to ${calc.endDate}).`,
        'success',
        'Schedule Blocked'
      );
      await renderAvailabilityGrid();
      renderAgenda();
    } catch (err) {
      console.error('Leave filing error:', err);
      showToast(err.message || 'Failed to block schedule.', 'error', 'Error');
    } finally {
      if (btnSubmitLeave) {
        btnSubmitLeave.disabled = false;
        btnSubmitLeave.innerHTML =
          '<i data-lucide="calendar-off" class="w-4 h-4 text-[#F5B800]"></i><span>Block Schedule</span>';
        if (window.lucide) window.lucide.createIcons();
      }
    }
  });

  function renderActiveLeaves(leaves = []) {
    currentActiveLeaves = (leaves || []).filter(l => l.status === 'Active');
    if (activeLeavesCount) activeLeavesCount.textContent = `${currentActiveLeaves.length} active`;

    if (!activeLeavesContainer) return;

    if (currentActiveLeaves.length === 0) {
      activeLeavesContainer.innerHTML = `
        <div class="p-4 text-center text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
          No active leaves currently logged. Your consultation slots remain available.
        </div>
      `;
      updateLeavePreview();
      return;
    }

    activeLeavesContainer.innerHTML = currentActiveLeaves
      .map(l => {
        const datesLabel = l.startDate === l.endDate ? l.startDate : `${l.startDate} to ${l.endDate}`;
        const total = l.totalDays || (l.dates ? l.dates.length : 1);
        const chips = (l.dates || [])
          .map(d => `<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 font-mono">${escapeHtml(d)}</span>`)
          .join(' ');

        return `
          <div class="p-4 bg-white rounded-xl border-2 border-blue-100 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div class="space-y-1.5">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-bold text-slate-900 flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                  <span class="text-[#00205B]">Blocked Leave Period</span>
                </span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                  ${total} Business Day${total > 1 ? 's' : ''} (${total * 8} slots blocked)
                </span>
              </div>
              <div class="text-xs text-slate-700 flex items-center gap-2">
                <strong class="font-mono text-[#00205B] text-sm">${escapeHtml(datesLabel)}</strong>
              </div>
              ${chips ? `<div class="flex flex-wrap gap-1 pt-0.5">${chips}</div>` : ''}
            </div>
            <button
              type="button"
              data-leave-id="${escapeHtml(l.id)}"
              data-start="${escapeHtml(l.startDate)}"
              data-end="${escapeHtml(l.endDate)}"
              class="btn-unblock-leave inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition shrink-0 shadow-2xs active:scale-95"
            >
              <i data-lucide="rotate-ccw" class="w-3.5 h-3.5 text-rose-600"></i>
              <span>Unblock / Restore Schedule</span>
            </button>
          </div>
        `;
      })
      .join('');

    if (window.lucide) window.lucide.createIcons();

    activeLeavesContainer.querySelectorAll('.btn-unblock-leave').forEach(btn => {
      btn.addEventListener('click', async () => {
        const leaveId = btn.getAttribute('data-leave-id');
        const start = btn.getAttribute('data-start');
        const end = btn.getAttribute('data-end');
        if (!leaveId) return;

        const confirmed = await showConfirmDialog({
          title: 'Unblock Schedule?',
          message: `Restore all consultation slots back to Available for ${start} to ${end}? Students will be able to book these hours again.`,
          confirmText: 'Yes, Unblock',
          cancelText: 'Cancel',
          type: 'danger'
        });

        if (!confirmed) return;

        btn.disabled = true;
        try {
          await unblockCounselorLeave(currentUser.uid, leaveId, currentUser.fullName);
          await logAuditEvent(
            currentUser.uid,
            currentUser.fullName,
            currentUser.role,
            'COUNSELOR_LEAVE_CANCELLED',
            `Unblocked leave ${leaveId} (${start} to ${end})`
          );
          showToast('Schedule unblocked and consultation slots restored to available.', 'success', 'Schedule Restored');
          await renderAvailabilityGrid();
          renderAgenda();
        } catch (err) {
          showToast(err.message || 'Failed to unblock leave.', 'error', 'Error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    updateLeavePreview();
  }

  subscribeCounselorLeaves(currentUser.uid, leaves => {
    renderActiveLeaves(leaves);
  });
});
