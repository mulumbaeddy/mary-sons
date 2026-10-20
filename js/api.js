// All database access lives here. Pages never talk to Supabase directly.
// Reads fall back to the last saved copy when offline; new entries are queued and synced later (see offline.js).
import { supabase } from './supabase.js';
import { session } from './store.js';
import { isNetError, saveCache, loadCache, getQueue, enqueue, registerExecutor, newLocalId, isLocalId, realId } from './offline.js';

const unwrap = ({ data, error }) => { if (error) throw error; return data; };
const LIMIT = 500;
const sum = (items, k) => items.reduce((a, i) => a + Number(i[k] || 0), 0);
const statusOf = (total, paid) => (paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid');

// ---------- reads (network first, saved copy when offline) ----------
async function cached(key, run) {
  try { const data = await run(); saveCache(key, data); return data; }
  catch (err) { const old = loadCache(key); if (isNetError(err) && old !== undefined) return old; throw err; }
}

// ---------- apply not-yet-synced entries on top of what we read ----------
function overlay(kind, rows) {
  const q = getQueue(); if (!q.length) return rows;
  let out = rows.map((r) => ({ ...r }));
  const byId = (id) => out.find((r) => r.id === id || r.id === realId(id));
  for (const { op, args, localId } of q) {
    const a = args[0];
    if (op === 'createSale') {
      if (kind === 'products') a.items.forEach((i) => { const p = byId(i.product_id); if (p) p.stock_pieces = Number(p.stock_pieces) - Number(i.quantity_pieces); });
      if (kind === 'sales') { const total = sum(a.items, 'line_total'); out.unshift({ id: localId, sale_no: 'PENDING', sale_date: a.date, customer_name: a.customer || 'Walk-in', total_amount: total, amount_paid: a.paid, payment_method: a.method, notes: a.notes, payment_status: statusOf(total, a.paid), pending: true }); }
    } else if (op === 'createPurchase') {
      if (kind === 'products') a.items.forEach((i) => { const p = byId(i.product_id); if (p) p.stock_pieces = Number(p.stock_pieces) + Number(i.quantity_pieces); });
      if (kind === 'purchases') { const total = sum(a.items, 'line_total'); out.unshift({ id: localId, purchase_no: 'PENDING', purchase_date: a.date, supplier_name: a.supplier, total_amount: total, amount_paid: a.paid, notes: a.notes, payment_status: statusOf(total, a.paid), pending: true }); }
    } else if (op === 'recordPayment') {
      const [k, id, amount] = args;
      if ((kind === 'sales' && k === 'sale') || (kind === 'purchases' && k !== 'sale')) { const r = byId(id); if (r) { r.amount_paid = Number(r.amount_paid) + Number(amount); r.payment_status = statusOf(Number(r.total_amount), r.amount_paid); } }
    } else if (op === 'addExpense' && kind === 'expenses') {
      out.unshift({ ...a, id: localId, pending: true });
    } else if (op === 'createProduct' && kind === 'products') {
      out.push({ id: localId, name: a.name, sku: a.sku || null, pieces_per_bundle: a.pieces_per_bundle, stock_pieces: a.opening_pieces || 0, cost_per_piece: a.cost_per_piece, selling_price_per_piece: a.selling_price_per_piece, reorder_level: a.reorder_level, pending: true });
    } else if (op === 'adjustStock' && kind === 'products') {
      const p = byId(args[0]); if (p) p.stock_pieces = Number(args[1]);
    }
  }
  return out;
}

export const listProducts  = () => cached('products', () => supabase.from('products').select('*').order('name').then(unwrap)).then((r) => overlay('products', r));
export const listSales     = () => cached('sales', () => supabase.from('sales').select('*').order('sale_date', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT).then(unwrap)).then((r) => overlay('sales', r));
export const listPurchases = () => cached('purchases', () => supabase.from('purchases').select('*').order('purchase_date', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT).then(unwrap)).then((r) => overlay('purchases', r));
export const listExpenses  = (from, to) => cached(`expenses:${from || ''}:${to || ''}`, () => {
  let q = supabase.from('expenses').select('*').order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT);
  if (from) q = q.gte('expense_date', from);
  if (to) q = q.lte('expense_date', to);
  return q.then(unwrap);
}).then((r) => overlay('expenses', r).filter((x) => (!from || x.expense_date >= from) && (!to || x.expense_date <= to)));
export const listPayments  = () => cached('payments', () => supabase.from('payments').select('*').order('payment_date', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT).then(unwrap));
export const salesOn       = (date) => cached('salesOn:' + date, () => supabase.from('sales').select('total_amount,amount_paid').eq('sale_date', date).then(unwrap))
  .then((r) => [...r, ...getQueue().filter((x) => x.op === 'createSale' && x.args[0].date === date).map((x) => ({ total_amount: sum(x.args[0].items, 'line_total'), amount_paid: x.args[0].paid }))]);
export const saleLines     = async (saleId) => {
  if (isLocalId(saleId)) {
    const item = getQueue().find((x) => x.localId === saleId); if (!item) return [];
    const prods = await listProducts();
    return item.args[0].items.map((i) => ({ product_name: prods.find((p) => p.id === i.product_id)?.name || 'Item', quantity_pieces: i.quantity_pieces, line_total: i.line_total }));
  }
  return cached('saleLines:' + saleId, () => supabase.from('v_sale_lines').select('*').eq('sale_id', saleId).then(unwrap));
};
export const purchaseLines = async (purchaseId) => {
  if (isLocalId(purchaseId)) {
    const item = getQueue().find((x) => x.localId === purchaseId); if (!item) return [];
    const prods = await listProducts();
    return item.args[0].items.map((i) => ({ product_name: prods.find((p) => p.id === i.product_id)?.name || 'Item', quantity_pieces: i.quantity_pieces, line_total: i.line_total }));
  }
  return cached('purchaseLines:' + purchaseId, () => supabase.from('v_purchase_lines').select('*').eq('purchase_id', purchaseId).then(unwrap));
};
export const productMovements = (productId) => isLocalId(productId) ? Promise.resolve([]) :
  cached('moves:' + productId, () => supabase.from('stock_movements').select('*').eq('product_id', productId).order('created_at', { ascending: false }).limit(100).then(unwrap));
export const reportSummary = (from, to) => cached(`report:${from}:${to}`, () => supabase.rpc('report_summary', { p_from: from, p_to: to }).then(unwrap));

// ---------- writes that work offline (queued when there is no connection) ----------
const rawCreateProduct = (v) => supabase.rpc('create_product', {
  p_name: v.name, p_sku: v.sku || null, p_pieces_per_bundle: v.pieces_per_bundle,
  p_opening_pieces: v.opening_pieces, p_cost: v.cost_per_piece, p_price: v.selling_price_per_piece, p_reorder: v.reorder_level,
}).then(unwrap);
const rawAdjustStock = (id, pieces, reason) => supabase.rpc('adjust_stock', { p_product_id: id, p_new_pieces: pieces, p_reason: reason }).then(unwrap);
const rawCreateSale = (v) => supabase.rpc('create_sale', {
  p_customer: v.customer, p_date: v.date, p_method: v.method, p_amount_paid: v.paid, p_notes: v.notes || null, p_items: v.items,
}).then(unwrap);
const rawCreatePurchase = (v) => supabase.rpc('create_purchase', {
  p_supplier: v.supplier, p_date: v.date, p_amount_paid: v.paid, p_notes: v.notes || null, p_items: v.items,
}).then(unwrap);
const rawRecordPayment = (kind, id, amount, method, date, reference) =>
  supabase.rpc('record_payment', { p_kind: kind, p_id: id, p_amount: amount, p_method: method, p_date: date, p_reference: reference || null }).then(unwrap);
const rawAddExpense = (v) => supabase.from('expenses').insert({ ...v, created_by: session.user.id }).then(unwrap);

registerExecutor('createProduct', rawCreateProduct);
registerExecutor('adjustStock', rawAdjustStock);
registerExecutor('createSale', rawCreateSale);
registerExecutor('createPurchase', rawCreatePurchase);
registerExecutor('recordPayment', rawRecordPayment);
registerExecutor('addExpense', rawAddExpense);

// Try now; if the internet is down (or older entries are still waiting), save it on this device instead.
async function writeOrQueue(op, args, label, raw, makesId = false) {
  const localId = makesId ? newLocalId() : undefined;
  if (getQueue().length || !navigator.onLine) { enqueue(op, args, label, localId); return localId; }
  try { return await raw(...args); }
  catch (err) { if (!isNetError(err)) throw err; enqueue(op, args, label, localId); return localId; }
}
const needsOnline = (what) => { if (!navigator.onLine) throw new Error(`${what} needs an internet connection. Please try again when you are online.`); };
const noPending = (id, what) => { if (isLocalId(id)) throw new Error(`${what} — this entry has not been synced yet. Wait for it to sync first.`); };

export const createProduct = (v) => writeOrQueue('createProduct', [v], `Product ${v.name}`, rawCreateProduct, true);
export const adjustStock = (id, pieces, reason) => { noPending(id, 'Cannot adjust stock'); return writeOrQueue('adjustStock', [id, pieces, reason], 'Stock adjustment', rawAdjustStock); };
export const createSale = (v) => writeOrQueue('createSale', [v], `Sale to ${v.customer} (UGX ${Math.round(sum(v.items, 'line_total')).toLocaleString()})`, rawCreateSale, true);
export const createPurchase = (v) => writeOrQueue('createPurchase', [v], `Purchase from ${v.supplier}`, rawCreatePurchase, true);
export const recordPayment = (kind, id, amount, method, date, reference) =>
  writeOrQueue('recordPayment', [kind, id, amount, method, date, reference], `Payment of UGX ${Math.round(amount).toLocaleString()}`, rawRecordPayment);
export const addExpense = (v) => writeOrQueue('addExpense', [v], `Expense ${v.category || ''}`, rawAddExpense, true);

// ---------- changes that need a live connection ----------
export const updateProduct = (id, v) => { needsOnline('Editing a product'); noPending(id, 'Cannot edit'); return supabase.from('products').update(v).eq('id', id).then(unwrap); };
export const deleteProduct = (id) => { needsOnline('Deleting a product'); noPending(id, 'Cannot delete'); return supabase.from('products').delete().eq('id', id).then(unwrap); };
export const voidSale = (id) => { needsOnline('Cancelling a sale'); noPending(id, 'Cannot cancel'); return supabase.rpc('void_sale', { p_sale_id: id }).then(unwrap); };
export const voidPurchase = (id) => { needsOnline('Cancelling a purchase'); noPending(id, 'Cannot cancel'); return supabase.rpc('void_purchase', { p_purchase_id: id }).then(unwrap); };
export const deleteExpense = (id) => { needsOnline('Deleting an expense'); noPending(id, 'Cannot delete'); return supabase.from('expenses').delete().eq('id', id).then(unwrap); };

export const loadProfile = (id) => cached('profile:' + id, () => supabase.from('profiles').select('full_name,role,active').eq('id', id).maybeSingle().then(unwrap));
