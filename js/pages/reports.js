import * as api from '../api.js';
import { esc, money, num, today, addDays, startOfWeek, startOfMonth, fmtDate, toast, friendlyError, printHtml, downloadCSV } from '../utils.js';
import { panel, statCard, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { session } from '../store.js';

export const meta = { eyebrow: 'BUSINESS INTELLIGENCE', title: 'Reports' };

export const calc = (r) => {
  const gross = Number(r.sales_total) - Number(r.cogs);
  return { gross, net: gross - Number(r.expenses_total), margin: Number(r.sales_total) ? (gross / Number(r.sales_total)) * 100 : 0 };
};

// Used for both the on-screen report and the printable weekly report.
export function reportBody(r, from, to) {
  const { gross, net, margin } = calc(r);
  const row = (a, b, cls = '') => `<tr class="${cls}"><td>${a}</td><td class="right">${b}</td></tr>`;
  return `
    <div class="stats-grid">
      ${statCard('Sales', money(r.sales_total), `${r.sales_count} sale${r.sales_count === 1 ? '' : 's'}`, 'sales')}
      ${statCard('Gross profit', money(gross), `${margin.toFixed(1)}% margin`, 'reports')}
      ${statCard('Expenses', money(r.expenses_total), 'Running costs', 'expenses')}
      ${statCard('Net profit', money(net), 'Gross profit − expenses', 'payments', net < 0 ? 'bad' : 'good')}</div>
    <div class="content-grid">
      <section class="panel"><div class="panel-head"><h2>Profit summary</h2></div><table class="plain"><tbody>
        ${row('Sales (invoiced)', money(r.sales_total))}${row('Cost of goods sold', '− ' + money(r.cogs))}${row('<b>Gross profit</b>', `<b>${money(gross)}</b>`, 'sum')}
        ${row('Expenses', '− ' + money(r.expenses_total))}${row('<b>Net profit</b>', `<b class="${net < 0 ? 'neg' : 'pos'}">${money(net)}</b>`, 'sum')}</tbody></table></section>
      <section class="panel"><div class="panel-head"><h2>Cash &amp; balances</h2></div><table class="plain"><tbody>
        ${row('Cash received from customers', money(r.cash_received))}${row('Purchases this period', money(r.purchases_total))}${row('Paid to suppliers', money(r.supplier_paid))}
        ${row('Customers still owe (all time)', `<b class="neg">${money(r.customer_debt)}</b>`)}${row('We owe suppliers (all time)', money(r.supplier_debt))}
        ${row('Stock value now', money(r.stock_value))}${row('Products low on stock', r.low_stock_count)}</tbody></table></section></div>
    <div class="content-grid">
      <section class="panel"><div class="panel-head"><h2>Best-selling products</h2></div>${r.top_products.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th class="right">Pieces</th><th class="right">Sales</th><th class="right">Profit</th></tr></thead><tbody>
        ${r.top_products.map((p) => `<tr><td>${esc(p.name)}</td><td class="right">${num(p.pieces)}</td><td class="right">${money(p.revenue)}</td><td class="right">${money(p.revenue - p.cost)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No sales in this period.')}</section>
      <section class="panel"><div class="panel-head"><h2>Expenses by category</h2></div>${r.expenses_by_category.length ? `<table class="plain"><tbody>
        ${r.expenses_by_category.map((e) => row(esc(e.category), money(e.total))).join('')}</tbody></table>` : emptyState('No expenses in this period.')}</section></div>
    <section class="panel"><div class="panel-head"><h2>Daily sales</h2></div>${r.daily.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th class="right">Sales made</th><th class="right">Total</th></tr></thead><tbody>
      ${r.daily.map((d) => `<tr><td>${fmtDate(d.day)}</td><td class="right">${d.count}</td><td class="right">${money(d.sales)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No sales in this period.')}</section>`;
}

export async function render(el) {
  let from = addDays(today(), -6), to = today(), data = null;
  const presets = {
    week: ['This week', () => [startOfWeek(today()), today()]],
    last: ['Last week', () => { const s = addDays(startOfWeek(today()), -7); return [s, addDays(s, 6)]; }],
    seven: ['Last 7 days', () => [addDays(today(), -6), today()]],
    month: ['This month', () => [startOfMonth(today()), today()]],
  };
  el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Choose a period</h2><p>Quick weekly report for your partner: pick “Last week” and print.</p></div></div>
    <div class="chips">${Object.entries(presets).map(([k, [l]]) => `<button class="chip" data-preset="${k}">${l}</button>`).join('')}</div>
    <div class="report-controls"><div><label for="from">From</label><input type="date" id="from" value="${from}"></div><div><label for="to">To</label><input type="date" id="to" value="${to}"></div>
      <button class="primary" data-action="run">Generate report</button>
      <button class="outline" data-action="print" disabled>${icon('printer', 16)} Print / Save PDF</button>
      <button class="outline" data-action="csv" disabled>${icon('download', 16)} CSV</button></div></section>
    <div id="out" style="margin-top:16px"></div>`;
  const out = el.querySelector('#out');

  async function run() {
    from = el.querySelector('#from').value; to = el.querySelector('#to').value;
    if (!from || !to || from > to) return toast('Choose a valid date range', 'error');
    out.innerHTML = '<div class="skeleton"><div></div><div></div></div>';
    try {
      data = await api.reportSummary(from, to);
      out.innerHTML = `<p class="period">Report for <b>${fmtDate(from)}</b> to <b>${fmtDate(to)}</b></p>` + reportBody(data, from, to);
      el.querySelectorAll('[data-action=print],[data-action=csv]').forEach((b) => (b.disabled = false));
    } catch (err) { out.innerHTML = ''; toast(friendlyError(err), 'error'); }
  }

  el.addEventListener('click', (e) => {
    const p = e.target.closest('[data-preset]');
    if (p) { [from, to] = presets[p.dataset.preset][1](); el.querySelector('#from').value = from; el.querySelector('#to').value = to; return run(); }
    const b = e.target.closest('[data-action]'); if (!b || !data) return b?.dataset.action === 'run' && run();
    if (b.dataset.action === 'run') return run();
    if (b.dataset.action === 'print') {
      const cfg = window.APP_CONFIG || {};
      printHtml(`<div class="print-report"><div class="print-head"><h1>${esc(cfg.BUSINESS_NAME || 'Business report')}</h1>
        <p>Business report · ${fmtDate(from)} – ${fmtDate(to)}<br><small>Prepared ${fmtDate(today())} by ${esc(session.profile?.full_name || session.user?.email || '')}</small></p></div>${reportBody(data, from, to)}</div>`);
    }
    if (b.dataset.action === 'csv') {
      const { gross, net } = calc(data);
      downloadCSV(`report-${from}-to-${to}.csv`, [['Metric', 'Amount'], ['Sales', data.sales_total], ['Cost of goods sold', data.cogs], ['Gross profit', gross],
        ['Expenses', data.expenses_total], ['Net profit', net], ['Cash received', data.cash_received], ['Customer debt', data.customer_debt], ['Supplier debt', data.supplier_debt], ['Stock value', data.stock_value]]);
    }
  });
  run();
}
