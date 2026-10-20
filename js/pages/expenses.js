import * as api from '../api.js';
import { isOwner } from '../store.js';
import { esc, money, today, startOfMonth, fmtDate, toast, friendlyError, downloadCSV } from '../utils.js';
import { panel, btn, iconBtn, badge, mountTable, openModal, formGrid, confirmDialog, statCard } from '../ui.js';
import { icon } from '../icons.js';

export const meta = { eyebrow: 'COST CONTROL', title: 'Expenses' };

const CATEGORIES = ['Transport', 'Rent', 'Utilities', 'Labour', 'Packaging', 'Communication', 'Other'];

export async function render(el) {
  let from = startOfMonth(today()), to = today(), cat = 'all', rows = [], table;
  const filtered = () => rows.filter((x) => cat === 'all' || x.category === cat);

  const refresh = () => {
    const f = filtered(), total = f.reduce((a, x) => a + Number(x.amount), 0);
    const by = {}; f.forEach((x) => { by[x.category] = (by[x.category] || 0) + Number(x.amount); });
    const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
    el.querySelector('#summary').innerHTML = statCard('Total expenses', money(total), `${f.length} record${f.length === 1 ? '' : 's'} in this period`, 'expenses') +
      statCard('Biggest category', top ? esc(top[0]) : '—', top ? money(top[1]) : 'No expenses', 'reports');
    table.setRows(f);
  };
  const load = async () => { rows = await api.listExpenses(from, to); refresh(); };

  el.innerHTML = `<div id="summary" class="stats-grid"></div>
    <div class="toolbar"><label class="inline">From <input type="date" id="from" value="${from}"></label><label class="inline">To <input type="date" id="to" value="${to}"></label>
      <select id="cat" aria-label="Category"><option value="all">All categories</option>${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select><span class="spacer"></span>
      <button class="outline" data-action="export">${icon('download', 16)} Export CSV</button>${btn(`${icon('plus', 16)} Add expense`, 'new')}</div>
    ${panel('Expense records', 'Transport, rent, labour and other running costs', '<div id="tbl"></div>')}`;
  table = mountTable(el.querySelector('#tbl'), {
    empty: 'No expenses in this period.',
    columns: [
      { label: 'Date', render: (x) => fmtDate(x.expense_date) }, { label: 'Category', render: (x) => badge(x.category, 'neutral') },
      { label: 'Description', render: (x) => esc(x.description || '—') }, { label: 'Paid by', render: (x) => esc(x.paid_by === 'business' ? 'Business cash' : x.paid_by) },
      { label: 'Amount', align: 'right', render: (x) => `<b>${money(x.amount)}</b>` },
      { label: '', align: 'right', render: (x) => isOwner() ? iconBtn('trash', 'delete', x.id, 'Delete expense', 'danger') : '' },
    ],
  });

  const add = () => openModal({
    eyebrow: 'NEW EXPENSE', title: 'Add expense', submitLabel: 'Save expense',
    body: formGrid([
      { name: 'expense_date', label: 'Date', type: 'date', value: today(), required: true },
      { name: 'category', label: 'Category', type: 'select', value: 'Other', options: CATEGORIES.map((c) => [c, c]) },
      { name: 'amount', label: 'Amount (UGX)', type: 'number', min: 1, step: 'any', required: true },
      { name: 'paid_by', label: 'Paid by', type: 'select', value: 'business', options: [['business', 'Business cash'], ['owner', 'Owner'], ['mother', 'Partner']] },
      { name: 'description', label: 'Description', type: 'textarea', full: true },
    ]),
    onSubmit: async (v) => {
      await api.addExpense({ expense_date: v.expense_date, category: v.category, amount: +v.amount, paid_by: v.paid_by, description: v.description.trim() || null });
      toast('Expense saved'); await load();
    },
  });

  el.addEventListener('change', async (e) => {
    try {
      if (e.target.id === 'cat') { cat = e.target.value; refresh(); }
      if (e.target.id === 'from' || e.target.id === 'to') {
        from = el.querySelector('#from').value; to = el.querySelector('#to').value;
        if (!from || !to || from > to) return toast('Choose a valid date range', 'error');
        await load();
      }
    } catch (err) { toast(friendlyError(err), 'error'); }
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    try {
      if (b.dataset.action === 'new') return add();
      if (b.dataset.action === 'export') return downloadCSV('expenses.csv', [['Date', 'Category', 'Description', 'Paid by', 'Amount'],
        ...filtered().map((x) => [x.expense_date, x.category, x.description, x.paid_by, x.amount])]);
      if (b.dataset.action === 'delete' && await confirmDialog({ title: 'Delete expense?', message: 'This removes the expense from your records.', confirmLabel: 'Delete', danger: true })) {
        await api.deleteExpense(b.dataset.id); toast('Expense deleted'); await load();
      }
    } catch (err) { toast(friendlyError(err), 'error'); }
  });
  await load();
}
