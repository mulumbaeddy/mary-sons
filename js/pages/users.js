import * as api from '../api.js';
import { session, roleLabel } from '../store.js';
import { esc, fmtDate, toast, friendlyError } from '../utils.js';
import { panel, iconBtn, badge, mountTable, openModal, formGrid } from '../ui.js';

export const meta = { eyebrow: 'ACCESS CONTROL', title: 'Users' };

export async function render(el) {
  let users = await api.listUsers(), table;
  const load = async () => { users = await api.listUsers(); table.setRows(users); };

  el.innerHTML = `<div class="content-grid"><div>${panel('Team members', 'People who can sign in. Change roles or switch access off here.', '<div id="tbl"></div>')}</div>
    <div>${panel('Adding a new person', '', `<ol class="steps"><li>Supabase Dashboard → <b>Authentication → Users → Add user</b>.</li><li>Enter their email and a password, tick <i>Auto confirm</i>.</li><li>They appear in this list as <b>Staff</b>. Set their role here.</li></ol>
      <p class="field-help"><b>Owner</b>: everything. <b>Partner</b>: stock, purchases, reports. <b>Staff</b>: sales, expenses and customer payments only.</p>`)}</div></div>`;
  table = mountTable(el.querySelector('#tbl'), {
    columns: [
      { label: 'Name / email', render: (u) => `<b>${esc(u.full_name || '—')}</b><br><small class="muted">${esc(u.email)}</small>` },
      { label: 'Role', render: (u) => roleLabel(u.role) }, { label: 'Access', render: (u) => badge(u.active ? 'Active' : 'Disabled', u.active ? 'ok' : 'bad') },
      { label: 'Added', render: (u) => fmtDate(u.created_at.slice(0, 10)) }, { label: '', align: 'right', render: (u) => iconBtn('edit', 'edit', u.id, 'Edit user') }],
  });
  table.setRows(users);

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action=edit]'); if (!b) return;
    const u = users.find((x) => x.id === b.dataset.id), self = u.id === session.user.id;
    openModal({
      eyebrow: 'EDIT USER', title: u.email,
      body: formGrid([
        { name: 'full_name', label: 'Full name', value: u.full_name, required: true },
        { name: 'role', label: 'Role', type: 'select', value: u.role, options: [['owner', 'Owner'], ['mother', 'Partner'], ['staff', 'Staff']] },
        { name: 'active', label: 'Access', type: 'select', value: String(u.active), options: [['true', 'Active'], ['false', 'Disabled']] },
      ]) + (self ? '<p class="field-help">You cannot remove your own owner access.</p>' : ''),
      onSubmit: async (v) => { await api.updateUser(u.id, { full_name: v.full_name, role: v.role, active: v.active === 'true' }); toast('User updated'); await load(); },
    });
  });
}
