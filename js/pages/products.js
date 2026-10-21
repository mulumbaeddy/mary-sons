import * as api from '../api.js';
import { isPartner, isOwner } from '../store.js';
import { esc, money, num, stockText, toast, friendlyError, fmtDateTime, downloadCSV } from '../utils.js';
import { panel, btn, iconBtn, badge, mountTable, openModal, formGrid, confirmDialog, statCard } from '../ui.js';
import { icon } from '../icons.js';

export const meta = { eyebrow: 'INVENTORY', title: 'Products & Stock' };

const costPerPacket = (v) => Math.round((+v.cost_per_bundle / +v.pieces_per_bundle) * 100) / 100;
const stockState = (p) => Number(p.stock_pieces) <= 0 ? ['Out of stock', 'bad'] : Number(p.stock_pieces) <= Number(p.reorder_level) ? ['Low stock', 'warn'] : ['In stock', 'ok'];

export async function render(el) {
  let products = await api.listProducts();
  let term = '';
  const canEdit = isPartner();

  const draw = () => {
    const value = products.reduce((s, p) => s + Number(p.stock_pieces) * Number(p.cost_per_piece), 0);
    const low = products.filter((p) => Number(p.stock_pieces) <= Number(p.reorder_level)).length;
    el.innerHTML = `<div class="stats-grid three">
        ${statCard('Products', products.length, 'Registered items', 'products')}
        ${isPartner() ? statCard('Stock value', money(value), 'At average cost', 'payments') : ''}
        ${statCard('Need restocking', low, 'At or below alert level', 'alert', low ? 'warn' : '')}</div>
      <div class="toolbar"><div class="search">${icon('search', 16)}<input id="q" placeholder="Search products or SKU…" value="${esc(term)}"></div><span class="spacer"></span>
        <button class="outline" data-action="export">${icon('download', 16)} Export CSV</button>
        ${canEdit ? btn(`${icon('plus', 16)} Add product`, 'add') : ''}</div>
      ${panel('Product inventory', 'Stock is counted in packets and shown as bundles + packets.', '<div id="tbl"></div>')}`;
    table = mountTable(el.querySelector('#tbl'), {
      empty: 'No products yet. Add your first product to start tracking stock.',
      columns: [
        { label: 'Product', render: (p) => `<b>${esc(p.name)}</b><br><small class="muted">${esc(p.sku || 'No SKU')}</small>` },
        { label: 'In stock', render: (p) => `<b>${stockText(p.stock_pieces, p.pieces_per_bundle)}</b><br><small class="muted">${num(p.stock_pieces)} packets total</small>` },
        { label: 'Bundle has', render: (p) => `${num(p.pieces_per_bundle)} packets` },
        ...(canEdit ? [{ label: 'Cost / bundle', align: 'right', render: (p) => money(Number(p.cost_per_piece) * Number(p.pieces_per_bundle)) }] : []),
        { label: 'Price / packet', align: 'right', render: (p) => money(p.selling_price_per_piece) },
        { label: 'Status', render: (p) => badge(...stockState(p)) },
        { label: '', align: 'right', render: (p) => `<div class="row-actions">${iconBtn('history', 'history', p.id, 'Stock history')}
          ${canEdit ? iconBtn('edit', 'edit', p.id, 'Edit product') + iconBtn('products', 'adjust', p.id, 'Adjust stock') : ''}
          ${isOwner() ? iconBtn('trash', 'delete', p.id, 'Delete product', 'danger') : ''}</div>` },
      ],
    });
    filter();
  };
  let table;
  const filter = () => table.setRows(products.filter((p) => `${p.name} ${p.sku || ''}`.toLowerCase().includes(term.toLowerCase())));
  const reload = async () => { products = await api.listProducts(); draw(); };

  const productFields = (p = {}) => [
    { name: 'name', label: 'Product name', value: p.name, required: true, full: true, placeholder: 'e.g. Clear bag 8x12' },
    { name: 'sku', label: 'SKU / code (optional)', value: p.sku },
    { name: 'pieces_per_bundle', label: 'Packets in one bundle', type: 'number', min: 1, step: 'any', value: p.pieces_per_bundle ?? 100, required: true },
    { name: 'cost_per_bundle', label: 'Buying price per bundle (UGX)', type: 'number', min: 0, step: 'any', value: p.id ? Math.round(Number(p.cost_per_piece) * Number(p.pieces_per_bundle)) : '', required: true, help: 'What the producer charges you for one bundle.' },
    { name: 'selling_price_per_piece', label: 'Selling price per packet (UGX)', type: 'number', min: 0, step: 'any', value: p.selling_price_per_piece ?? '', required: true },
    { name: 'reorder_level', label: 'Low-stock alert (packets)', type: 'number', min: 0, step: 'any', value: p.reorder_level ?? 0 },
  ];

  const add = () => openModal({
    eyebrow: 'NEW PRODUCT', title: 'Add product', submitLabel: 'Add product',
    body: formGrid([...productFields(), { name: 'opening_bundles', label: 'Opening stock (bundles)', type: 'number', min: 0, step: 'any', value: 0, help: 'Stock you already have today.' }]),
    onSubmit: async (v) => {
      await api.createProduct({ name: v.name.trim(), sku: v.sku.trim(), pieces_per_bundle: +v.pieces_per_bundle,
        opening_pieces: +v.opening_bundles * +v.pieces_per_bundle, cost_per_piece: costPerPacket(v),
        selling_price_per_piece: +v.selling_price_per_piece, reorder_level: +v.reorder_level || 0 });
      toast('Product added'); await reload();
    },
  });

  const edit = (p) => openModal({
    eyebrow: 'EDIT PRODUCT', title: p.name,
    body: formGrid(productFields(p)) + '<p class="field-help">To change the quantity in stock use “Adjust stock” so the change is recorded.</p>',
    onSubmit: async (v) => {
      await api.updateProduct(p.id, { name: v.name.trim(), sku: v.sku.trim() || null, pieces_per_bundle: +v.pieces_per_bundle,
        cost_per_piece: costPerPacket(v), selling_price_per_piece: +v.selling_price_per_piece, reorder_level: +v.reorder_level || 0 });
      toast('Product updated'); await reload();
    },
  });

  const adjust = (p) => openModal({
    eyebrow: 'ADJUST STOCK', title: p.name, submitLabel: 'Save adjustment',
    body: `<p class="muted">Counted stock differs from the system? Enter what you physically have. Current: <b>${num(p.stock_pieces)} packets</b> (${stockText(p.stock_pieces, p.pieces_per_bundle)}).</p>` +
      formGrid([
        { name: 'pieces', label: 'Actual stock (packets)', type: 'number', min: 0, step: 'any', value: p.stock_pieces, required: true },
        { name: 'reason', label: 'Reason', required: true, placeholder: 'e.g. Damaged, stock count, found extra' },
      ]),
    onSubmit: async (v) => { await api.adjustStock(p.id, +v.pieces, v.reason); toast('Stock adjusted'); await reload(); },
  });

  const history = async (p) => {
    const rows = await api.productMovements(p.id);
    const label = { opening: 'Opening stock', purchase: 'Purchase', sale: 'Sale', adjustment: 'Adjustment', return: 'Return' };
    openModal({
      eyebrow: 'STOCK HISTORY', title: p.name, wide: true,
      body: `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th class="right">Change (packets)</th><th>Reference</th></tr></thead><tbody>
        ${rows.length ? rows.map((m) => `<tr><td>${fmtDateTime(m.created_at)}</td><td>${label[m.movement_type] || m.movement_type}</td>
          <td class="right"><b class="${m.quantity_pieces < 0 ? 'neg' : 'pos'}">${m.quantity_pieces > 0 ? '+' : ''}${num(m.quantity_pieces)}</b></td>
          <td>${esc(m.reference || '')}${m.movement_type === 'adjustment' && m.notes ? ` <small class="muted">${esc(m.notes)}</small>` : ''}</td></tr>`).join('')
          : '<tr><td colspan="4"><div class="empty">No stock movement yet.</div></td></tr>'}</tbody></table></div>`,
    });
  };

  el.addEventListener('input', (e) => { if (e.target.id === 'q') { term = e.target.value; filter(); } });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    const p = products.find((x) => x.id === b.dataset.id);
    try {
      switch (b.dataset.action) {
        case 'add': return add();
        case 'edit': return edit(p);
        case 'adjust': return adjust(p);
        case 'history': return history(p);
        case 'export': return downloadCSV('products.csv', [['Product', 'SKU', 'Packets per bundle', 'Stock (packets)', 'Cost per packet', 'Price per packet', 'Reorder level'],
          ...products.map((x) => [x.name, x.sku, x.pieces_per_bundle, x.stock_pieces, x.cost_per_piece, x.selling_price_per_piece, x.reorder_level])]);
        case 'delete':
          if (await confirmDialog({ title: 'Delete product?', message: `Delete <b>${esc(p.name)}</b>? Its stock history is deleted too. A product used in an active sale or purchase cannot be deleted until that sale or purchase is cancelled.`, confirmLabel: 'Delete', danger: true })) {
            await api.deleteProduct(p.id); toast('Product deleted'); await reload();
          }
      }
    } catch (err) { toast(friendlyError(err), 'error'); }
  });
  draw();
}
