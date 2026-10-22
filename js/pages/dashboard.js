import * as api from '../api.js';
import { isPartner } from '../store.js';
import { esc, money, today, addDays, fmtDate, stockText, toast } from '../utils.js';
import { statCard, panel, badge, emptyState } from '../ui.js';
import { icon } from '../icons.js';

export const meta = { eyebrow: 'OVERVIEW', title: 'Dashboard' };

export async function render(el) {
  const to = today(), from = addDays(to, -29);
  const [products, sales, todays, report] = await Promise.all([
    api.listProducts(), api.listSales(), api.salesOn(to),
    isPartner() ? api.reportSummary(from, to).catch(() => null) : null,
  ]);
  const todayTotal = todays.reduce((s, x) => s + Number(x.total_amount), 0);
  const owed = sales.reduce((s, x) => s + Math.max(0, Number(x.total_amount) - Number(x.amount_paid)), 0);
  const low = products.filter((p) => Number(p.stock_pieces) <= Number(p.reorder_level));
  const net = report ? Number(report.sales_total) - Number(report.cogs) - Number(report.expenses_total) : 0;

  // 14-day bar chart
  let chart = '';
  if (report) {
    const map = Object.fromEntries(report.daily.map((d) => [d.day, Number(d.sales)]));
    const days = Array.from({ length: 14 }, (_, i) => addDays(to, i - 13));
    const max = Math.max(1, ...days.map((d) => map[d] || 0));
    chart = panel('Sales — last 14 days', 'Daily sales value', `<div class="bars">${days.map((d) =>
      `<div class="bar" title="${fmtDate(d)}: ${money(map[d] || 0)}"><span style="height:${Math.max(2, ((map[d] || 0) / max) * 100)}%"></span><small>${d.slice(8)}</small></div>`).join('')}</div>`);
  }

  el.innerHTML = `<div class="stats-grid">
      ${statCard("Today's sales", money(todayTotal), `${todays.length} sale${todays.length === 1 ? '' : 's'} today`, 'sales')}
      ${report ? statCard('Net profit (30 days)', money(net), `Sales ${money(report.sales_total)}`, 'reports', net < 0 ? 'bad' : 'good') : statCard('Products', products.length, 'In your catalogue', 'products')}
      ${statCard('Customers owe', money(owed), 'Unpaid sale balances', 'payments', owed ? 'warn' : '')}
      ${report ? statCard('Stock value', money(report.stock_value), `${low.length} item${low.length === 1 ? '' : 's'} low`, 'products') : statCard('Low stock', low.length, 'Items to restock', 'alert', low.length ? 'warn' : '')}</div>
    <div class="content-grid">${chart || ''}
      ${panel('Low stock alerts', 'Items at or below their alert level', low.length ? `<ul class="list">${low.slice(0, 8).map((p) => `<li><span><b>${esc(p.name)}</b><br><small class="muted">Alert at ${p.reorder_level} pieces</small></span>${badge(stockText(p), Number(p.stock_pieces) <= 0 ? 'bad' : 'warn')}</li>`).join('')}</ul>` : emptyState('All products are above their alert level.'))}</div>
    ${panel('Recent sales', 'Latest five', sales.length ? `<div class="table-wrap"><table><thead><tr><th>Sale</th><th>Date</th><th>Customer</th><th class="right">Total</th><th>Status</th></tr></thead><tbody>
      ${sales.slice(0, 5).map((s) => `<tr><td><b>${esc(s.sale_no)}</b></td><td>${fmtDate(s.sale_date)}</td><td>${esc(s.customer_name)}</td><td class="right">${money(s.total_amount)}</td><td>${badge(s.payment_status)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No sales yet. Record your first sale to see it here.'),
      `<a class="outline link-btn" href="#/sales">View all ${icon('sales', 14)}</a>`)}`;
}
