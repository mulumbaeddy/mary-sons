import * as api from '../api.js';
import { isOwner } from '../store.js';
import { esc, money, num, today, fmtDate, toast, friendlyError, downloadCSV } from '../utils.js';
import { panel, btn, iconBtn, badge, mountTable, openModal, formGrid, confirmDialog, statCard } from '../ui.js';
import { lineItemsMarkup, mountLineItems } from '../lineitems.js';
import { openPaymentModal } from '../payment-modal.js';
import { icon } from '../icons.js';

export const meta = { eyebrow: 'SUPPLY', title: 'Purchases' };

export async function render(el) {
  let [purchases, products] = await Promise.all([api.listPurchases(), api.listProducts()]);
  let term = '', table;
  const balanceOf = (p) => Number(p.total_amount) - Number(p.amount_paid);
  const filtered = () => purchases.filter((p) => `${p.purchase_no} ${p.supplier_name}`.toLowerCase().includes(term.toLowerCase()));

  const refresh = () => {
    const f = filtered();
    el.querySelector('#summary').innerHTML =
      statCard('Purchases shown', f.length, 'Matching the search', 'purchases') +
      statCard('Total bought', money(f.reduce((a, p) => a + Number(p.total_amount), 0)), 'Invoiced by suppliers', 'payments') +
      statCard('We still owe', money(f.reduce((a, p) => a + balanceOf(p), 0)), 'Unpaid supplier balances', 'alert', 'warn');
    table.setRows(f);
  };
  let names = [];
  api.partyNames().then((n) => { names = n; });
  const reload = async () => { [purchases, products] = await Promise.all([api.listPurchases(), api.listProducts()]); names = await api.partyNames(); refresh(); };

  el.innerHTML = `<div id="summary" class="stats-grid three"></div>
    <div class="toolbar"><div class="search">${icon('search', 16)}<input id="q" placeholder="Search purchase no. or supplier…"></div><span class="spacer"></span>
      <button class="outline" data-action="export">${icon('download', 16)} Export CSV</button>${btn(`${icon('plus', 16)} Record purchase`, 'new')}</div>
    ${panel('Purchase history', 'Each purchase adds stock and updates the average cost of the product.', '<div id="tbl"></div>')}`;
  table = mountTable(el.querySelector('#tbl'), {
    empty: 'No purchases yet.',
    columns: [
      { label: 'No.', render: (p) => `<b>${esc(p.purchase_no)}</b>` },
      { label: 'Date', render: (p) => fmtDate(p.purchase_date) },
      { label: 'Supplier', render: (p) => esc(p.supplier_name) },
      { label: 'Total', align: 'right', render: (p) => money(p.total_amount) },
      { label: 'Paid', align: 'right', render: (p) => money(p.amount_paid) },
      { label: 'Balance', align: 'right', render: (p) => balanceOf(p) > 0 ? `<b class="neg">${money(balanceOf(p))}</b>` : '—' },
      { label: 'Status', render: (p) => badge(p.payment_status) },
      { label: '', align: 'right', render: (p) => `<div class="row-actions">${iconBtn('eye', 'view', p.id, 'View items')}
        ${balanceOf(p) > 0 ? iconBtn('payments', 'pay', p.id, 'Pay supplier') : ''}
        ${isOwner() ? iconBtn('trash', 'void', p.id, 'Cancel purchase', 'danger') : ''}</div>` },
    ],
  });
  refresh();

  async function view(p) {
    const lines = await api.purchaseLines(p.id);
    openModal({
      eyebrow: 'PURCHASE', title: `${p.purchase_no} — ${p.supplier_name}`, wide: true,
      body: `<p class="muted">${fmtDate(p.purchase_date)}${p.notes ? ` · ${esc(p.notes)}` : ''}</p>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th class="right">Pieces</th><th class="right">Cost / piece</th><th class="right">Amount</th></tr></thead><tbody>
        ${lines.map((l) => `<tr><td>${esc(l.product_name)}</td><td class="right">${num(l.quantity_pieces)}</td><td class="right">${money(l.unit_cost)}</td><td class="right">${money(l.line_total)}</td></tr>`).join('')
          || '<tr><td colspan="4"><div class="empty">No item details recorded.</div></td></tr>'}</tbody></table></div>
        <div class="totals"><span>Total</span><b>${money(p.total_amount)}</b><span>Paid</span><b>${money(p.amount_paid)}</b><span>Balance</span><b class="${balanceOf(p) > 0 ? 'neg' : ''}">${money(balanceOf(p))}</b></div>`,
    });
  }

  function newPurchase() {
    if (!products.length) { toast('Add a product first, then record the purchase.', 'error'); return; }
    const suppliers = names;
    let editor, paidTouched = false;
    openModal({
      eyebrow: 'NEW PURCHASE', title: 'Record purchase', wide: true, submitLabel: 'Save purchase',
      body: `<datalist id="supList">${suppliers.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>` +
        formGrid([
          { name: 'supplier', label: 'Supplier', required: true, list: 'supList' },
          { name: 'date', label: 'Date', type: 'date', value: today(), required: true },
        ]) + lineItemsMarkup('purchase') + formGrid([
          { name: 'paid', label: 'Amount paid now (UGX)', type: 'number', min: 0, step: 'any', value: 0, required: true },
          { name: 'notes', label: 'Notes', type: 'textarea', full: true },
        ]) + '<p class="balance-line" data-balance></p>',
      onOpen: (form) => {
        const paid = form.elements.paid;
        const sync = (total) => {
          if (!paidTouched) paid.value = total;
          form.querySelector('[data-balance]').textContent = `Balance owed to supplier: ${money(Math.max(0, total - Number(paid.value || 0)))}`;
        };
        editor = mountLineItems(form, products, 'purchase', sync);
        paid.addEventListener('input', () => { paidTouched = true; sync(editor.total()); });
        sync(0);
      },
      onSubmit: async (v) => {
        const items = editor.items(), total = editor.total(), paid = Number(v.paid || 0);
        if (paid > total) throw new Error('Amount paid is more than the purchase total.');
        await api.createPurchase({ supplier: v.supplier, date: v.date, paid, notes: v.notes, items });
        toast('Purchase saved and stock updated'); await reload();
      },
    });
  }

  el.addEventListener('input', (e) => { if (e.target.id === 'q') { term = e.target.value; refresh(); } });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    const p = purchases.find((x) => x.id === b.dataset.id);
    try {
      switch (b.dataset.action) {
        case 'new': return newPurchase();
        case 'view': return await view(p);
        case 'pay': return openPaymentModal('purchase', p, reload);
        case 'export': return downloadCSV('purchases.csv', [['No', 'Date', 'Supplier', 'Total', 'Paid', 'Balance', 'Status'],
          ...filtered().map((x) => [x.purchase_no, x.purchase_date, x.supplier_name, x.total_amount, x.amount_paid, balanceOf(x), x.payment_status])]);
        case 'void':
          if (await confirmDialog({ title: 'Cancel this purchase?', message: `<b>${esc(p.purchase_no)}</b> will be removed and its stock taken out again. This only works if that stock has not been sold.`, confirmLabel: 'Cancel purchase', danger: true })) {
            await api.voidPurchase(p.id); toast('Purchase cancelled'); await reload();
          }
      }
    } catch (err) { toast(friendlyError(err), 'error'); }
  });
}
