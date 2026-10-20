// All database access lives here. Pages never talk to Supabase directly.
import { supabase } from './supabase.js';
import { session } from './store.js';

const unwrap = ({ data, error }) => { if (error) throw error; return data; };
const LIMIT = 500;

// ----- reads -----
export const listProducts  = () => supabase.from('products').select('*').order('name').then(unwrap);
export const listSales     = () => supabase.from('sales').select('*').order('sale_date', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT).then(unwrap);
export const listPurchases = () => supabase.from('purchases').select('*').order('purchase_date', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT).then(unwrap);
export const listExpenses  = (from, to) => {
  let q = supabase.from('expenses').select('*').order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT);
  if (from) q = q.gte('expense_date', from);
  if (to) q = q.lte('expense_date', to);
  return q.then(unwrap);
};
export const listPayments  = () => supabase.from('payments').select('*').order('payment_date', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT).then(unwrap);
export const salesOn       = (date) => supabase.from('sales').select('total_amount,amount_paid').eq('sale_date', date).then(unwrap);
export const saleLines     = (saleId) => supabase.from('v_sale_lines').select('*').eq('sale_id', saleId).then(unwrap);
export const purchaseLines = (purchaseId) => supabase.from('v_purchase_lines').select('*').eq('purchase_id', purchaseId).then(unwrap);
export const productMovements = (productId) =>
  supabase.from('stock_movements').select('*').eq('product_id', productId).order('created_at', { ascending: false }).limit(100).then(unwrap);
export const reportSummary = (from, to) => supabase.rpc('report_summary', { p_from: from, p_to: to }).then(unwrap);

// ----- products -----
export const createProduct = (v) => supabase.rpc('create_product', {
  p_name: v.name, p_sku: v.sku || null, p_pieces_per_bundle: v.pieces_per_bundle,
  p_opening_pieces: v.opening_pieces, p_cost: v.cost_per_piece, p_price: v.selling_price_per_piece, p_reorder: v.reorder_level,
}).then(unwrap);
export const updateProduct = (id, v) => supabase.from('products').update(v).eq('id', id).then(unwrap);
export const deleteProduct = (id) => supabase.from('products').delete().eq('id', id).then(unwrap);
export const adjustStock = (id, pieces, reason) =>
  supabase.rpc('adjust_stock', { p_product_id: id, p_new_pieces: pieces, p_reason: reason }).then(unwrap);

// ----- sales / purchases / payments -----
export const createSale = (v) => supabase.rpc('create_sale', {
  p_customer: v.customer, p_date: v.date, p_method: v.method, p_amount_paid: v.paid, p_notes: v.notes || null, p_items: v.items,
}).then(unwrap);
export const createPurchase = (v) => supabase.rpc('create_purchase', {
  p_supplier: v.supplier, p_date: v.date, p_amount_paid: v.paid, p_notes: v.notes || null, p_items: v.items,
}).then(unwrap);
export const recordPayment = (kind, id, amount, method, date, reference) =>
  supabase.rpc('record_payment', { p_kind: kind, p_id: id, p_amount: amount, p_method: method, p_date: date, p_reference: reference || null }).then(unwrap);
export const voidSale = (id) => supabase.rpc('void_sale', { p_sale_id: id }).then(unwrap);
export const voidPurchase = (id) => supabase.rpc('void_purchase', { p_purchase_id: id }).then(unwrap);

// ----- expenses -----
export const addExpense = (v) =>
  supabase.from('expenses').insert({ ...v, created_by: session.user.id }).then(unwrap);
export const deleteExpense = (id) => supabase.from('expenses').delete().eq('id', id).then(unwrap);

export const loadProfile = (id) =>
  supabase.from('profiles').select('full_name,role,active').eq('id', id).maybeSingle().then(unwrap);
