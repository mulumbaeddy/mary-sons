// Reusable UI building blocks: cards, tables, modal, confirm, form fields.
import { icon } from './icons.js';
import { esc, friendlyError } from './utils.js';

export const statCard = (label, value, note = '', ic = 'dashboard', tone = '') =>
  `<article class="stat-card ${tone}"><div class="stat-top"><span>${esc(label)}</span><span class="stat-icon">${icon(ic, 18)}</span></div>
   <div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`;

export const panel = (title, sub, body, action = '') =>
  `<section class="panel"><div class="panel-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${action}</div>${body}</section>`;

export const btn = (label, action, cls = 'primary', extra = '') =>
  `<button type="button" class="${cls}" data-action="${action}" ${extra}>${label}</button>`;

export const iconBtn = (name, action, id, title, cls = '') =>
  `<button type="button" class="icon-btn ${cls}" data-action="${action}" data-id="${esc(id)}" title="${esc(title)}" aria-label="${esc(title)}">${icon(name, 16)}</button>`;

export const emptyState = (text) => `<div class="empty">${text}</div>`;

const STATUS_TONE = { paid: 'ok', partial: 'warn', unpaid: 'bad', ok: 'ok', low: 'bad', out: 'bad' };
export const badge = (text, tone) => `<span class="badge ${tone || STATUS_TONE[String(text).toLowerCase()] || ''}">${esc(text)}</span>`;

export const skeleton = () => `<div class="skeleton"><div></div><div></div><div></div></div>`;

// ---------- form fields ----------
export function field(f) {
  const id = 'f_' + f.name, req = f.required ? 'required' : '', full = f.full ? ' field-full' : '';
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.name}" ${req} placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`;
  else if (f.type === 'select')
    input = `<select id="${id}" name="${f.name}" ${req}>${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else
    input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${req} ${f.readonly ? 'readonly' : ''} ${f.list ? `list="${f.list}"` : ''}>`;
  return `<div class="${full}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.help ? `<small class="field-help">${esc(f.help)}</small>` : ''}</div>`;
}
export const formGrid = (fields) => `<div class="form-grid">${fields.map(field).join('')}</div>`;
export const formValues = (form) => Object.fromEntries(new FormData(form).entries());

// ---------- modal ----------
// onSubmit(values, form) may be async; throw to show an error inside the modal.
export function openModal({ title, eyebrow = '', body, submitLabel = 'Save', onSubmit = null, onOpen = null, wide = false, extraActions = '' }) {
  const dlg = document.getElementById('modal');
  dlg.className = 'modal' + (wide ? ' wide' : '');
  dlg.innerHTML = `<div class="modal-head"><div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h2>${esc(title)}</h2></div>
      <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    <form class="modal-body" novalidate>${body}
      <p class="form-error" role="alert"></p>
      <div class="modal-actions">${extraActions}<span class="spacer"></span>
        <button type="button" class="outline" data-close>${onSubmit ? 'Cancel' : 'Close'}</button>
        ${onSubmit ? `<button type="submit" class="primary">${esc(submitLabel)}</button>` : ''}</div></form>`;
  const form = dlg.querySelector('form'), errEl = dlg.querySelector('.form-error');
  const close = () => dlg.open && dlg.close();
  dlg.onclick = (e) => { if (e.target === dlg || e.target.closest('[data-close]')) close(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true; const old = submit.textContent; submit.textContent = 'Saving…'; errEl.textContent = '';
    try { await onSubmit(formValues(form), form); close(); }
    catch (err) { console.error(err); errEl.textContent = friendlyError(err); submit.disabled = false; submit.textContent = old; }
  };
  if (!dlg.open) dlg.showModal();
  onOpen?.(form, close);
  return { close, form };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal small';
    dlg.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2></div><div class="modal-body"><p>${message}</p>
      <div class="modal-actions"><span class="spacer"></span><button class="outline" data-v="0">Cancel</button>
      <button class="${danger ? 'danger-solid' : 'primary'}" data-v="1">${esc(confirmLabel)}</button></div></div>`;
    dlg.onclick = (e) => {
      const b = e.target.closest('[data-v]');
      if (b) { resolve(b.dataset.v === '1'); dlg.close(); } else if (e.target === dlg) dlg.close();
    };
    dlg.onclose = () => { resolve(false); dlg.remove(); };
    document.body.append(dlg); dlg.showModal();
  });
}

// ---------- paginated table ----------
// Returns { setRows(rows) }. Columns: { label, render(row), align }
export function mountTable(el, { columns, pageSize = 15, empty = 'No records yet.' }) {
  let rows = [], page = 1;
  const draw = () => {
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    page = Math.min(page, pages);
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);
    el.innerHTML = `<div class="table-wrap"><table><thead><tr>${columns.map((c) => `<th class="${c.align || ''}">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${slice.length ? slice.map((r) => `<tr>${columns.map((c) => `<td class="${c.align || ''}" data-label="${esc(c.label)}">${c.render(r)}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${columns.length}">${emptyState(empty)}</td></tr>`}</tbody></table></div>
      ${rows.length > pageSize ? `<div class="pager"><span>${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, rows.length)} of ${rows.length}</span>
        <span><button class="outline sm" data-pg="-1" ${page === 1 ? 'disabled' : ''}>Previous</button>
        <button class="outline sm" data-pg="1" ${page === pages ? 'disabled' : ''}>Next</button></span></div>` : ''}`;
  };
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (b) { page += Number(b.dataset.pg); draw(); } });
  return { setRows(r) { rows = r; page = 1; draw(); } };
}
