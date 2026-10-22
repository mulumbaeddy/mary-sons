// Product-lines editor shared by the Sale and Purchase forms.
// Quantities are entered in cartons or pieces and always sent to the database as pieces.
import { esc, num, money, stockText } from './utils.js';

export const label = (p) => (p.sku ? `${p.name} — ${p.sku}` : p.name);
export const lineItemsMarkup = (kind) => `
  <div class="lines-head"><span>Product</span><span>Unit</span><span>Quantity</span><span>${kind === 'sale' ? 'Amount (UGX)' : 'Cost paid (UGX)'}</span><span></span></div>
  <div data-lines></div>
  <div class="lines-foot"><button type="button" class="outline sm" data-add-line>+ Add another product</button>
    <strong>Total: <span data-grand>${money(0)}</span></strong></div>`;

export function mountLineItems(form, products, kind, onTotal) {
  const box = form.querySelector('[data-lines]');
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const options = `<option value="">Select product…</option>` +
    products.map((p) => `<option value="${p.id}">${esc(label(p))}</option>`).join('');

  const piecesOf = (row) => {
    const p = byId[row.querySelector('.l-prod').value];
    const q = Number(row.querySelector('.l-qty').value || 0);
    if (!p) return 0;
    return row.querySelector('.l-unit').value === 'carton' ? q * Number(p.pieces_per_bundle) : q; // pieces stay as entered
  };
  const total = () => [...box.children].reduce((s, r) => s + Number(r.querySelector('.l-total').value || 0), 0);

  function refresh(row, autofill) {
    const p = byId[row.querySelector('.l-prod').value];
    const pcs = piecesOf(row);
    const hint = row.querySelector('.l-hint');
    if (p && autofill && !row.dataset.manual) {
      const unitPrice = kind === 'sale' ? p.selling_price_per_piece : p.cost_per_piece;
      row.querySelector('.l-total').value = pcs ? Math.round(pcs * Number(unitPrice)) : '';
    }
    if (!p) hint.textContent = '';
    else if (kind === 'sale') {
      const over = pcs > Number(p.stock_pieces);
      hint.className = 'l-hint' + (over ? ' bad' : '');
      hint.textContent = `${num(pcs)} pieces · price ${money(p.selling_price_per_piece)} / piece · in stock: ${stockText(p.stock_pieces, p.pieces_per_bundle)}${over ? ' — not enough stock!' : ''}`;
    } else hint.textContent = `${num(pcs)} pieces · current cost ${money(Number(p.cost_per_piece) * Number(p.pieces_per_bundle))} / carton`;
    form.querySelector('[data-grand]').textContent = money(total());
    onTotal?.(total());
  }

  function addRow() {
    const row = document.createElement('div');
    row.className = 'line';
    row.innerHTML = `<select class="l-prod" aria-label="Product">${options}</select>
      <select class="l-unit" aria-label="Unit">${kind === 'sale' ? '<option value="piece">Pieces</option><option value="carton">Cartons</option>' : '<option value="carton">Cartons</option><option value="piece">Pieces</option>'}</select>
      <input class="l-qty" type="number" min="0" step="any" placeholder="Qty" aria-label="Quantity">
      <input class="l-total" type="number" min="0" step="any" placeholder="0" aria-label="Amount">
      <button type="button" class="icon-btn l-del" aria-label="Remove line">×</button><small class="l-hint"></small>`;
    box.append(row);
  }

  box.addEventListener('input', (e) => {
    const row = e.target.closest('.line'); if (!row) return;
    if (e.target.classList.contains('l-total')) row.dataset.manual = '1';
    refresh(row, !e.target.classList.contains('l-total'));
  });
  box.addEventListener('change', (e) => { const row = e.target.closest('.line'); if (row && !e.target.classList.contains('l-total')) refresh(row, true); });
  box.addEventListener('click', (e) => {
    if (!e.target.closest('.l-del')) return;
    if (box.children.length > 1) { e.target.closest('.line').remove(); refresh(box.children[0], false); }
  });
  form.querySelector('[data-add-line]').addEventListener('click', addRow);
  addRow();

  return {
    total,
    // Returns [{product_id, quantity_pieces, line_total}] or throws a readable error.
    items() {
      const merged = new Map();   // same product on several lines (cartons + loose pieces) is added together
      for (const row of box.children) {
        const id = row.querySelector('.l-prod').value, pcs = piecesOf(row), amt = Number(row.querySelector('.l-total').value || 0);
        if (!id && !pcs && !amt) continue;
        if (!id) throw new Error('Choose a product on every line.');
        if (pcs <= 0) throw new Error(`Enter a quantity for ${label(byId[id])}.`);
        if (amt <= 0) throw new Error(`Enter the amount for ${label(byId[id])}.`);
        const m = merged.get(id) || { product_id: id, quantity_pieces: 0, line_total: 0 };
        m.quantity_pieces = +(m.quantity_pieces + pcs).toFixed(4); m.line_total = +(m.line_total + amt).toFixed(2);
        merged.set(id, m);
      }
      const out = [...merged.values()];
      for (const m of out) if (kind === 'sale' && m.quantity_pieces > Number(byId[m.product_id].stock_pieces)) throw new Error(`Not enough stock for ${label(byId[m.product_id])}.`);
      if (!out.length) throw new Error('Add at least one product.');
      return out;
    },
  };
}
