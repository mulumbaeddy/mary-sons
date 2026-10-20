import * as api from '../api.js';
import { isOwner } from '../store.js';
import { esc, money, num, today, fmtDate, toast, friendlyError, downloadCSV, printHtml } from '../utils.js';
import { panel, btn, iconBtn, badge, mountTable, openModal, formGrid, formValues, confirmDialog, statCard } from '../ui.js';
import { lineItemsMarkup, mountLineItems } from '../lineitems.js';
import { openPaymentModal } from '../payment-modal.js';
import { icon } from '../icons.js';

export const meta = { eyebrow: 'REVENUE', title: 'Sales' };

const cfg = () => window.APP_CONFIG || {};

function receiptHtml(sale, lines) {
  const bal = Number(sale.total_amount) - Number(sale.amount_paid);
  return `<div class="receipt"><h2>${esc(cfg().BUSINESS_NAME || 'Receipt')}</h2>${cfg().BUSINESS_PHONE ? `<p>${esc(cfg().BUSINESS_PHONE)}</p>` : ''}
    <p><b>Receipt ${esc(sale.sale_no)}</b><br>${fmtDate(sale.sale_date)} · ${esc(sale.customer_name)}</p>
    <table><thead><tr><th>Item</th><th class="right">Packets</th><th class="right">Amount</th></tr></thead><tbody>
    ${lines.map((l) => `<tr><td>${esc(l.product_name)}</td><td class="right">${num(l.quantity_pieces)}</td><td class="right">${money(l.line_total)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td class="right">${money(sale.total_amount)}</td></tr>
    <tr><td colspan="2">Paid</td><td class="right">${money(sale.amount_paid)}</td></tr>
    <tr><td colspan="2"><b>Balance due</b></td><td class="right"><b>${money(bal)}</b></td></tr></tfoot></table>
    <p class="center">Thank you for your business.</p></div>`;
}

export async function render(el, params) {
  let [sales, products] = await Promise.all([api.listSales(), api.listProducts()]);
  let term = '', status = 'all', table;
  const balanceOf = (s) => Number(s.total_amount) - Number(s.amount_paid);

  const filtered = () => sales.filter((s) =>
    `${s.sale_no} ${s.customer_name}`.toLowerCase().includes(term.toLowerCase()) && (status === 'all' || s.payment_status === status));

  const summary = () => {
    const f = filtered();
    el.querySelector('#summary').innerHTML =
      statCard('Sales shown', f.length, 'Matching the filters', 'sales') +
      statCard('Total value', money(f.reduce((a, s) => a + Number(s.total_amount), 0)), 'Invoiced', 'payments') +
      statCard('Outstanding', money(f.reduce((a, s) => a + balanceOf(s), 0)), 'Still owed by customers', 'alert', 'warn');
  };
  const refresh = () => { table.setRows(filtered()); summary(); };
  const reload = async () => { [sales, products] = await Promise.all([api.listSales(), api.listProducts()]); refresh(); };

  el.innerHTML = `<div id="summary" class="stats-grid three"></div>
    <div class="toolbar"><div class="search">${icon('search', 16)}<input id="q" placeholder="Search sale no. or customer…"></div>
      <select id="st" aria-label="Payment status"><option value="all">All statuses</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option></select>
      <span class="spacer"></span><button class="outline" data-action="export">${icon('download', 16)} Export CSV</button>
      ${btn(`${icon('plus', 16)} New sale`, 'new')}</div>
    ${panel('Sales history', 'Most recent 500 sales. Each sale reduces stock automatically.', '<div id="tbl"></div>')}`;
  table = mountTable(el.querySelector('#tbl'), {
    empty: 'No sales found.',
    columns: [
      { label: 'Sale no.', render: (s) => `<b>${esc(s.sale_no)}</b>` },
      { label: 'Date', render: (s) => fmtDate(s.sale_date) },
      { label: 'Customer', render: (s) => esc(s.customer_name) },
      { label: 'Total', align: 'right', render: (s) => money(s.total_amount) },
      { label: 'Paid', align: 'right', render: (s) => money(s.amount_paid) },
      { label: 'Balance', align: 'right', render: (s) => balanceOf(s) > 0 ? `<b class="neg">${money(balanceOf(s))}</b>` : '—' },
      { label: 'Status', render: (s) => badge(s.payment_status) },
      { label: '', align: 'right', render: (s) => `<div class="row-actions">${iconBtn('eye', 'view', s.id, 'View / print receipt')}
        ${balanceOf(s) > 0 ? iconBtn('payments', 'pay', s.id, 'Receive payment') : ''}
        ${isOwner() ? iconBtn('trash', 'void', s.id, 'Cancel sale', 'danger') : ''}</div>` },
    ],
  });
  refresh();

  async function view(s) {
    const lines = await api.saleLines(s.id);
    openModal({
      eyebrow: 'SALE', title: `${s.sale_no} — ${s.customer_name}`, wide: true,
      extraActions: `<button type="button" class="outline" data-print>${icon('printer', 16)} Print receipt</button>`,
      body: `<p class="muted">${fmtDate(s.sale_date)} · ${esc(s.payment_method.replace('_', ' '))}${s.notes ? ` · ${esc(s.notes)}` : ''}</p>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th class="right">Packets</th><th class="right">Amount</th></tr></thead><tbody>
        ${lines.map((l) => `<tr><td>${esc(l.product_name)}</td><td class="right">${num(l.quantity_pieces)}</td><td class="right">${money(l.line_total)}</td></tr>`).join('')
          || '<tr><td colspan="3"><div class="empty">No item details were recorded for this sale.</div></td></tr>'}</tbody></table></div>
        <div class="totals"><span>Total</span><b>${money(s.total_amount)}</b><span>Paid</span><b>${money(s.amount_paid)}</b><span>Balance</span><b class="${balanceOf(s) > 0 ? 'neg' : ''}">${money(balanceOf(s))}</b></div>`,
      onOpen: (form) => form.querySelector('[data-print]').addEventListener('click', () => printHtml(receiptHtml(s, lines))),
    });
  }

  function newSale() {
    const customers = [...new Set(sales.map((s) => s.customer_name).filter((n) => n !== 'Walk-in'))];
    const available = products.filter((p) => Number(p.stock_pieces) > 0);
    if (!available.length) { toast('Add products and stock before recording a sale.', 'error'); return; }
    let editor, paidTouched = false;
    openModal({
      eyebrow: 'NEW SALE', title: 'Record sale', wide: true, submitLabel: 'Save sale',
      body: `<datalist id="custList">${customers.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>` +
        formGrid([
          { name: 'customer', label: 'Customer', value: 'Walk-in', required: true, list: 'custList' },
          { name: 'date', label: 'Date', type: 'date', value: today(), required: true },
        ]) + lineItemsMarkup('sale') + formGrid([
          { name: 'method', label: 'Payment method', type: 'select', value: 'cash', options: [['cash', 'Cash'], ['mobile_money', 'Mobile money'], ['credit', 'Credit (pay later)']] },
          { name: 'paid', label: 'Amount received now (UGX)', type: 'number', min: 0, step: 'any', value: 0, required: true },
          { name: 'notes', label: 'Notes', type: 'textarea', full: true },
        ]) + '<p class="balance-line" data-balance></p>',
      onOpen: (form) => {
        const paid = form.elements.paid, method = form.elements.method;
        const sync = (total) => {
          if (!paidTouched) paid.value = method.value === 'credit' ? 0 : total;
          form.querySelector('[data-balance]').textContent = `Balance left on credit: ${money(Math.max(0, total - Number(paid.value || 0)))}`;
        };
        editor = mountLineItems(form, available, 'sale', sync);
        paid.addEventListener('input', () => { paidTouched = true; sync(editor.total()); });
        method.addEventListener('change', () => { paidTouched = false; sync(editor.total()); });
        sync(0);
      },
      onSubmit: async (v, form) => {
        const items = editor.items(), total = editor.total(), paid = Number(v.paid || 0);
        if (paid > total) throw new Error('Amount received is more than the sale total.');
        const id = await api.createSale({ customer: v.customer, date: v.date, method: v.method, paid, notes: v.notes, items });
        toast('Sale saved'); await reload();
        const s = sales.find((x) => x.id === id);
        if (s && await confirmDialog({ title: 'Sale saved', message: 'Print a receipt for this sale?', confirmLabel: 'Print receipt' })) {
          printHtml(receiptHtml(s, await api.saleLines(id)));
        }
      },
    });
  }

  el.addEventListener('input', (e) => { if (e.target.id === 'q') { term = e.target.value; refresh(); } });
  el.addEventListener('change', (e) => { if (e.target.id === 'st') { status = e.target.value; refresh(); } });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    const s = sales.find((x) => x.id === b.dataset.id);
    try {
      switch (b.dataset.action) {
        case 'new': return newSale();
        case 'view': return await view(s);
        case 'pay': return openPaymentModal('sale', s, reload);
        case 'export': return downloadCSV('sales.csv', [['Sale no', 'Date', 'Customer', 'Total', 'Paid', 'Balance', 'Status', 'Method'],
          ...filtered().map((x) => [x.sale_no, x.sale_date, x.customer_name, x.total_amount, x.amount_paid, balanceOf(x), x.payment_status, x.payment_method])]);
        case 'void':
          if (await confirmDialog({ title: 'Cancel this sale?', message: `<b>${esc(s.sale_no)}</b> will be removed, its payments deleted and the stock returned. This cannot be undone.`, confirmLabel: 'Cancel sale', danger: true })) {
            await api.voidSale(s.id); toast('Sale cancelled and stock returned'); await reload();
          }
      }
    } catch (err) { toast(friendlyError(err), 'error'); }
  });
  if (params?.get('new')) newSale();
}
