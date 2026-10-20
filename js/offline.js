// Offline support: remembers the last data it saw, queues new entries while there is no internet,
// and sends them to the database (in the same order) when the connection comes back.
import { supabase } from './supabase.js';

const K = { queue: 'inv_queue', failed: 'inv_failed', map: 'inv_idmap', cache: 'inv_cache:', user: 'inv_user' };
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('Storage full', e); } };

// ---------- network errors ----------
export const isNetError = (err) => {
  if (!navigator.onLine) return true;
  const msg = String(err?.message || err || '');
  return !err?.code && /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(msg);
};
const isAuthExpired = (err) => /jwt|not authenticated|refresh token/i.test(String(err?.message || '')) || err?.code === 'PGRST301';

// ---------- read cache ----------
export const saveCache = (key, data) => write(K.cache + key, data);
export const loadCache = (key) => read(K.cache + key, undefined);
export const clearCache = () => { try { Object.keys(localStorage).filter((k) => k.startsWith(K.cache) || k === K.user).forEach((k) => localStorage.removeItem(k)); } catch {} };
export const saveUser = (u) => write(K.user, u);
export const loadUser = () => read(K.user, null);

// ---------- queue ----------
let listeners = [];
let syncing = false;
export const getQueue = () => read(K.queue, []);
export const getFailed = () => read(K.failed, []);
export const clearFailed = () => { write(K.failed, []); notify(); };
export const isLocalId = (id) => String(id || '').startsWith('local-');
const idMap = () => read(K.map, {});
export const realId = (id) => idMap()[id] || id;
export const newLocalId = () => 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const onChange = (fn) => { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; };
const notify = () => listeners.forEach((f) => { try { f({ pending: getQueue().length, failed: getFailed().length, syncing, online: navigator.onLine }); } catch {} });
export const status = () => ({ pending: getQueue().length, failed: getFailed().length, syncing, online: navigator.onLine });

export function enqueue(op, args, label, localId) {
  const q = getQueue(); q.push({ qid: newLocalId(), op, args, label, localId, ts: Date.now() }); write(K.queue, q);
  notify(); if (navigator.onLine) setTimeout(sync, 300);
}

// Executors are registered by api.js (so this file never imports it).
const executors = {};
export const registerExecutor = (op, fn) => { executors[op] = fn; };

export async function sync() {
  if (syncing || !navigator.onLine || !getQueue().length) return;
  syncing = true; notify();
  let done = 0;
  try {
    await supabase.auth.getSession();                      // refreshes an expired login first
    for (;;) {
      const q = getQueue(); if (!q.length) break;
      const item = q[0];
      try {
        const args = JSON.parse(JSON.stringify(item.args), (_, v) => (typeof v === 'string' && isLocalId(v) ? realId(v) : v));
        const result = await executors[item.op](...args);
        if (item.localId && result) { const m = idMap(); m[item.localId] = result; write(K.map, m); }
        write(K.queue, getQueue().slice(1)); done++; notify();
      } catch (err) {
        if (isNetError(err) || isAuthExpired(err)) break;  // try again later
        write(K.queue, getQueue().slice(1));              // the server refused it: keep a note for the user
        const f = getFailed(); f.push({ label: item.label, reason: err.message || String(err), ts: item.ts }); write(K.failed, f); notify();
      }
    }
  } finally {
    syncing = false;
    if (!getQueue().length) write(K.map, {});
    notify();
    if (done) window.dispatchEvent(new CustomEvent('inv:synced', { detail: { done } }));
  }
}

window.addEventListener('online', () => { notify(); sync(); });
window.addEventListener('offline', notify);
setInterval(() => { if (navigator.onLine && getQueue().length) sync(); }, 30000);
