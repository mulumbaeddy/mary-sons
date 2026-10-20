import * as api from '../api.js';
import { isPartner } from '../store.js';
import { esc, money, fmtDate, toast, friendlyError } from '../utils.js';
import { panel, iconBtn, badge, mountTable, statCard } from '../ui.js';
import { openPaymentModal } from '../payment-modal.js';

export const meta = { eyebrow: 'CASH FLOW', title: 'Payments & Debts' };

const typeLabel = { customer_receipt: 'Received from customer', supplier_payment: 'Paid to supplier' };

export async function render(el) {
  let sales, purchases, payments;
  let tab = 'customers';
  const load = async () => {
    [sales, purchases, payments] = await Promise.all([api.listSales(), isPartner() ? api.listPurchases() : [], api.listPayments()]);
    draw();
  };
  const owing = (r) => Number(r.total_amount) - Number(r.amount_paid);

  function draw() {
    const openSales = sales.filter((s) => owing(s) > 0), openPurch = purchases.filter((p) => owing(p) > 0);
    const owedToUs = openSales.reduce((a, s) => a + owing(s), 0), weOwe = openPurch.reduce((a, p) => a + owing(p), 0);
    const tabs = [['customers', 'Customer debts'], ...(isPartner() ? [['suppliers', 'Supplier debts']] : []), ['history', 'Payment history']];
    el.innerHTML = `<div class="stats-grid three">
        ${statCard('Customers owe us', money(owedToUs), `${openSales.length} unpaid sale${openSales.length === 1 ? '' : 's'}`, 'sales', owedToUs ? 'warn' : '')}
        ${isPartner() ? statCard('We owe suppliers', money(weOwe), `${openPurch.length} unpaid purchase${openPurch.length === 1 ? '' : 's'}`, 'purchases') : ''}
        ${statCard('Payments recorded', payments.length, 'Latest 500 shown', 'payments')}</div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="tabBody"></div>`;
    const body = el.querySelector('#tabBody');

    if (tab === 'customers') {
      const groups = {};
      openSales.forEach((s) => { const k = s.customer_name.trim().toLowerCase(); (groups[k] ||= { name: s.customer_name, total: 0, count: 0, oldest: s.sale_date }); groups[k].total += owing(s); groups[k].count++; if (s.sale_date < groups[k].oldest) groups[k].oldest = s.sale_date; });
      body.innerHTML = panel('Who owes you', 'Totals by customer', '<div id="t1"></div>') + '<div style="height:16px"></div>' + panel('Unpaid sales', 'Receive a payment against a sale', '<div id="t2"></div>');
      mountTable(body.querySelector('#t1'), { empty: 'No customer owes you anything. 🎉', columns: [
        { label: 'Customer', render: (g) => `<b>${esc(g.name)}</b>` }, { label: 'Unpaid sales', render: (g) => g.count },
        { label: 'Oldest sale', render: (g) => fmtDate(g.oldest) }, { label: 'Owes', align: 'right', render: (g) => `<b class="neg">${money(g.total)}</b>` }] })
        .setRows(Object.values(groups).sort((a, b) => b.total - a.total));
      mountTable(body.querySelector('#t2'), { empty: 'No unpaid sales.', columns: [
        { label: 'Sale', render: (s) => `<b>${esc(s.sale_no)}</b>` }, { label: 'Date', render: (s) => fmtDate(s.sale_date) }, { label: 'Customer', render: (s) => esc(s.customer_name) },
        { label: 'Total', align: 'right', render: (s) => money(s.total_amount) }, { label: 'Balance', align: 'right', render: (s) => `<b class="neg">${money(owing(s))}</b>` },
        { label: 'Status', render: (s) => badge(s.payment_status) },
        { label: '', align: 'right', render: (s) => iconBtn('check', 'paysale', s.id, 'Receive payment') }] }).setRows(openSales);
    } else if (tab === 'suppliers') {
      body.innerHTML = panel('Unpaid purchases', 'Money you still owe suppliers', '<div id="t1"></div>');
      mountTable(body.querySelector('#t1'), { empty: 'You do not owe any supplier.', columns: [
        { label: 'No.', render: (p) => `<b>${esc(p.purchase_no)}</b>` }, { label: 'Date', render: (p) => fmtDate(p.purchase_date) }, { label: 'Supplier', render: (p) => esc(p.supplier_name) },
        { label: 'Total', align: 'right', render: (p) => money(p.total_amount) }, { label: 'Balance', align: 'right', render: (p) => `<b class="neg">${money(owing(p))}</b>` },
        { label: '', align: 'right', render: (p) => iconBtn('check', 'paypurchase', p.id, 'Pay supplier') }] }).setRows(openPurch);
    } else {
      body.innerHTML = panel('Payment history', 'Every receipt and supplier payment', '<div id="t1"></div>');
      mountTable(body.querySelector('#t1'), { empty: 'No payments yet.', columns: [
        { label: 'Date', render: (p) => fmtDate(p.payment_date) }, { label: 'Party', render: (p) => esc(p.party_name) },
        { label: 'Type', render: (p) => `<span class="${p.payment_type === 'customer_receipt' ? 'pos' : 'neg'}">${typeLabel[p.payment_type]}</span>` },
        { label: 'Method', render: (p) => esc(p.method.replace('_', ' ')) }, { label: 'Reference', render: (p) => esc(p.reference || '—') },
        { label: 'Amount', align: 'right', render: (p) => `<b>${money(p.amount)}</b>` }] }).setRows(payments);
    }
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; draw(); return; }
    const b = e.target.closest('[data-action]'); if (!b) return;
    if (b.dataset.action === 'paysale') openPaymentModal('sale', sales.find((s) => s.id === b.dataset.id), load);
    if (b.dataset.action === 'paypurchase') openPaymentModal('purchase', purchases.find((p) => p.id === b.dataset.id), load);
  });
  try { await load(); } catch (err) { toast(friendlyError(err), 'error'); throw err; }
}
