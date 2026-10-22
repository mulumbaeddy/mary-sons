// Small shared helpers: formatting, dates, escaping, toasts, CSV.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const moneyFmt = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 2 });
export const money = (v) => 'UGX ' + moneyFmt.format(Math.round(Number(v || 0)));
export const num = (v) => numFmt.format(Number(v || 0));

// Local-date helpers (toISOString() is UTC and gives the wrong day after midnight in Uganda).
export const toISO = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
export const today = () => toISO(new Date());
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return toISO(d); };
export const fmtDate = (iso) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fmtDateTime = (ts) =>
  ts ? new Date(ts).toLocaleString('en-UG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const startOfWeek = (iso) => { const d = new Date(iso + 'T00:00:00'); const diff = (d.getDay() + 6) % 7; d.setDate(d.getDate() - diff); return toISO(d); };
export const startOfMonth = (iso) => iso.slice(0, 8) + '01';

// Stock is counted in pieces (the database column is still called "pieces").
// Show it the way the business counts: cartons and pieces.
export const stockText = (pieces, perBundle) => {
  const p = Number(pieces || 0), b = Number(perBundle || 1);
  if (b <= 1) return `${num(p)} piece${p === 1 ? '' : 's'}`;
  const cartons = Math.floor(p / b), rest = +(p - cartons * b).toFixed(2);
  const parts = [];
  if (cartons) parts.push(`${num(cartons)} carton${cartons === 1 ? '' : 's'}`);
  if (rest) parts.push(`${num(rest)} piece${rest === 1 ? '' : 's'}`);
  return parts.join(' + ') || '0';
};

export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function toast(text, type = 'success') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = text;
  box.append(el);
  setTimeout(() => el.classList.add('out'), type === 'error' ? 6000 : 3000);
  setTimeout(() => el.remove(), type === 'error' ? 6400 : 3400);
}

// Turn database / network errors into messages a shop owner can act on.
export function friendlyError(err) {
  const msg = err?.message || String(err || '');
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'No internet connection. Check your network and try again.';
  if (/JWT expired|not authenticated/i.test(msg)) return 'Your session expired. Please sign in again.';
  if (/violates foreign key/i.test(msg)) return 'This record is used elsewhere and cannot be deleted.';
  if (/duplicate key/i.test(msg)) return 'A record with the same unique value (for example SKU) already exists.';
  if (/permission denied|row-level security/i.test(msg)) return 'You do not have permission to do that.';
  return msg || 'Something went wrong. Please try again.';
}

export function downloadCSV(filename, rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(['\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Print any HTML via the hidden #printArea (used by receipts and reports).
export function printHtml(html) {
  const area = document.getElementById('printArea');
  area.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}
