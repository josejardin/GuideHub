import { requireRole, initNavbar, showToast, getRoleBadge } from './auth.js';
import { getAllUsers, updateUserRole, subscribeAuditLogs, logAuditEvent } from './db.js';
import { escapeHtml } from './utils/validation.js';

document.addEventListener('DOMContentLoaded', async () => {
  const currentUser = requireRole(['admin']);
  if (!currentUser) return;

  initNavbar('navbar-container', 'admin');

  const welcomeText = document.getElementById('admin-welcome-text');
  if (welcomeText) {
    welcomeText.textContent = `${currentUser.fullName} • System Administrator Control`;
  }

  let cachedUsers = [];
  const usersTableBody = document.getElementById('users-table-body');
  const userSearchInput = document.getElementById('user-search-input');

  async function loadUsers() {
    cachedUsers = await getAllUsers();
    renderUsers();
  }

  userSearchInput?.addEventListener('input', renderUsers);

  function renderUsers() {
    if (!usersTableBody) return;
    const query = (userSearchInput?.value || '').toLowerCase();
    const filtered = cachedUsers.filter(
      u =>
        (u.fullName || '').toLowerCase().includes(query) ||
        (u.email || '').toLowerCase().includes(query) ||
        (u.studentOrEmpId || '').toLowerCase().includes(query) ||
        (u.role || '').toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      usersTableBody.innerHTML = `
 <tr>
 <td colspan="5" class="p-8 text-center text-slate-400 text-xs">No users found matching query.</td>
 </tr>
 `;
      return;
    }

    usersTableBody.innerHTML = filtered
      .map(u => {
        const currentRole = (u.role || 'student').toLowerCase();

        return `
 <tr class="hover:bg-slate-50/60 transition">
 <td class="py-2.5 px-4">
 <div class="font-bold text-slate-900">${escapeHtml(u.fullName)}</div>
 <div class="text-[11px] text-slate-500 font-mono">${escapeHtml(u.email)}</div>
 </td>
 <td class="py-2.5 px-4 font-mono text-slate-700 font-medium">${escapeHtml(u.studentOrEmpId || 'N/A')}</td>
 <td class="py-2.5 px-4 text-slate-600">${escapeHtml(u.program || u.department || 'General')}</td>
 <td class="py-2.5 px-4">
 ${getRoleBadge(u.role)}
 </td>
 <td class="py-2.5 px-4 text-right">
 <select data-uid="${escapeHtml(u.uid)}" data-uname="${escapeHtml(u.fullName)}" class="role-select text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700 font-medium focus:outline-none focus:border-slate-900">
 <option value="student" ${currentRole === 'student' ? 'selected' : ''}>Student</option>
 <option value="faculty" ${currentRole === 'faculty' ? 'selected' : ''}>Faculty</option>
 <option value="counselor" ${currentRole === 'counselor' ? 'selected' : ''}>Counselor</option>
 <option value="head" ${currentRole === 'head' ? 'selected' : ''}>Guidance Head</option>
 <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>Administrator</option>
 </select>
 </td>
 </tr>
 `;
      })
      .join('');

    document.querySelectorAll('.role-select').forEach(select => {
      select.addEventListener('change', async e => {
        const uid = select.getAttribute('data-uid');
        const uname = select.getAttribute('data-uname');
        const newRole = e.target.value;

        try {
          await updateUserRole(uid, newRole);
          await logAuditEvent(
            currentUser.uid,
            currentUser.fullName,
            currentUser.role,
            'ROLE_UPDATED',
            `Changed ${uname} role to ${newRole}`
          );
          showToast(`Updated role for ${uname} to ${newRole.toUpperCase()}.`, 'success');
          loadUsers();
        } catch (err) {
          showToast(err.message || 'Failed to update role', 'error');
        }
      });
    });
  }

  loadUsers();
  window.addEventListener('guidehub_data_changed', loadUsers);

  let cachedLogs = [];
  const auditLogsTbody = document.getElementById('audit-logs-tbody');
  const auditActionFilter = document.getElementById('audit-action-filter');

  subscribeAuditLogs(logs => {
    cachedLogs = logs;
    renderAuditLogs();
  });

  auditActionFilter?.addEventListener('change', renderAuditLogs);

  function renderAuditLogs() {
    if (!auditLogsTbody) return;
    const filter = auditActionFilter?.value || 'ALL';
    const filtered = cachedLogs.filter(l => filter === 'ALL' || l.action === filter);

    if (filtered.length === 0) {
      auditLogsTbody.innerHTML = `
 <tr>
 <td colspan="5" class="p-8 text-center text-slate-400 text-xs">No audit logs found.</td>
 </tr>
 `;
      return;
    }

    auditLogsTbody.innerHTML = filtered
      .map(log => {
        const rawTs = log.timestamp?.toDate ? log.timestamp.toDate() : log.timestamp ? new Date(log.timestamp) : null;
        const timeStr =
          rawTs && !isNaN(rawTs.getTime())
            ? rawTs.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })
            : 'N/A';

        return `
 <tr class="hover:bg-slate-50/60 transition">
 <td class="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">${escapeHtml(timeStr)}</td>
 <td class="py-2.5 px-4 font-bold text-slate-900">${escapeHtml(log.actorName)}</td>
 <td class="py-2.5 px-4">
 ${getRoleBadge(log.actorRole)}
 </td>
 <td class="py-2.5 px-4 font-mono text-[11px] font-bold text-slate-700">
 ${escapeHtml(log.action)}
 </td>
 <td class="py-2.5 px-4 text-slate-600">
 ${escapeHtml(log.details)}
 </td>
 </tr>
 `;
      })
      .join('');
  }

  // --- Provision Staff Modal Logic ---
  const staffModal = document.getElementById('create-staff-modal');
  const btnOpenStaffModal = document.getElementById('btn-open-create-staff-modal');
  const btnCloseStaffModal = document.getElementById('btn-close-staff-modal');
  const btnCancelStaffModal = document.getElementById('btn-cancel-staff-modal');
  const createStaffForm = document.getElementById('create-staff-form');
  const btnSubmitStaff = document.getElementById('btn-submit-staff');

  function openStaffModal() {
    if (!staffModal) return;
    createStaffForm?.reset();
    const pwdInput = document.getElementById('staff-password');
    if (pwdInput) pwdInput.value = 'Password123!';
    staffModal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
    document.getElementById('staff-fullname')?.focus();
  }

  function closeStaffModal() {
    if (!staffModal) return;
    staffModal.classList.add('hidden');
  }

  btnOpenStaffModal?.addEventListener('click', openStaffModal);
  btnCloseStaffModal?.addEventListener('click', closeStaffModal);
  btnCancelStaffModal?.addEventListener('click', closeStaffModal);

  staffModal?.addEventListener('click', e => {
    if (e.target === staffModal) closeStaffModal();
  });

  createStaffForm?.addEventListener('submit', async e => {
    e.preventDefault();

    const fullName = document.getElementById('staff-fullname')?.value.trim();
    const emailPrefix = document.getElementById('staff-email-prefix')?.value.trim();
    const studentOrEmpId = document.getElementById('staff-empid')?.value.trim();
    const role = document.getElementById('staff-role')?.value;
    const department = document.getElementById('staff-department')?.value;
    const gender = document.getElementById('staff-gender')?.value;
    const password = document.getElementById('staff-password')?.value.trim();

    if (!fullName || !emailPrefix || !studentOrEmpId || !password) {
      showToast('Please fill out all required fields.', 'warning');
      return;
    }

    const cleanEmail = `${emailPrefix}@nu-fairview.edu.ph`;

    try {
      if (btnSubmitStaff) {
        btnSubmitStaff.disabled = true;
        btnSubmitStaff.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span> Provisioning...`;
      }

      const res = await fetch('/api/admin/create-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email: cleanEmail,
          studentOrEmpId,
          role,
          department,
          gender,
          password
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create staff account.');
      }

      showToast(`Success! Provisioned ${role.toUpperCase()} account for ${fullName}.`, 'success');
      closeStaffModal();
      await loadUsers();
    } catch (err) {
      showToast(err.message || 'Error provisioning account', 'error');
    } finally {
      if (btnSubmitStaff) {
        btnSubmitStaff.disabled = false;
        btnSubmitStaff.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5 text-[#F5B800]"></i><span>Create Staff Account</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  });
});
