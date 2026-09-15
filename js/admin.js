import { requireRole, initNavbar, showToast, getRoleBadge } from './auth.js';
import { getAllUsers, updateUserRole, subscribeAuditLogs, logAuditEvent } from './db.js';

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
 <div class="font-bold text-slate-900">${u.fullName}</div>
 <div class="text-[11px] text-slate-500 font-mono">${u.email}</div>
 </td>
 <td class="py-2.5 px-4 font-mono text-slate-700 font-medium">${u.studentOrEmpId || 'N/A'}</td>
 <td class="py-2.5 px-4 text-slate-600">${u.program || 'General'}</td>
 <td class="py-2.5 px-4">
 ${getRoleBadge(u.role)}
 </td>
 <td class="py-2.5 px-4 text-right">
 <select data-uid="${u.uid}" data-uname="${u.fullName}" class="role-select text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700 font-medium focus:outline-none focus:border-slate-900">
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
        const timeStr = log.timestamp
          ? new Date(log.timestamp).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })
          : 'N/A';

        return `
 <tr class="hover:bg-slate-50/60 transition">
 <td class="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">${timeStr}</td>
 <td class="py-2.5 px-4 font-bold text-slate-900">${log.actorName}</td>
 <td class="py-2.5 px-4">
 ${getRoleBadge(log.actorRole)}
 </td>
 <td class="py-2.5 px-4 font-mono text-[11px] font-bold text-slate-700">
 ${log.action}
 </td>
 <td class="py-2.5 px-4 text-slate-600">
 ${log.details}
 </td>
 </tr>
 `;
      })
      .join('');
  }
});
