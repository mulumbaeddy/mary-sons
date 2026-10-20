// App shell: authentication, navigation, routing.
import { supabase, isConfigured } from './supabase.js';
import { session, role, roleLabel, isPartner } from './store.js';
import { loadProfile } from './api.js';
import { status, onChange, sync, saveUser, loadUser, clearCache, getFailed, clearFailed } from './offline.js';
import { $, $$, esc, toast, friendlyError, today } from './utils.js';
import { icon } from './icons.js';
import { openModal, formGrid, skeleton } from './ui.js';

const ROUTES = {
  dashboard: { label: 'Dashboard', icon: 'dashboard', load: () => import('./pages/dashboard.js') },
  sales:     { label: 'Sales', icon: 'sales', load: () => import('./pages/sales.js') },
  products:  { label: 'Products & Stock', icon: 'products', load: () => import('./pages/products.js') },
  purchases: { label: 'Purchases', icon: 'purchases', allow: isPartner, load: () => import('./pages/purchases.js') },
  payments:  { label: 'Payments & Debts', icon: 'payments', load: () => import('./pages/payments.js') },
  expenses:  { label: 'Expenses', icon: 'expenses', load: () => import('./pages/expenses.js') },
  reports:   { label: 'Reports', icon: 'reports', allow: isPartner, load: () => import('./pages/reports.js') },
};
const allowed = (k) => !ROUTES[k].allow || ROUTES[k].allow();

const loginView = $('#loginView'), appView = $('#appView'), content = $('#pageContent');
let shownFor = null, navToken = 0;

const loginMessage = (text, ok = false) => { const m = $('#loginMessage'); m.textContent = text || ''; m.className = 'message' + (ok ? ' success' : ''); };

// ---------- routing ----------
function parseHash() {
  const [path, query] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  return { key: path in ROUTES && allowed(path) ? path : 'dashboard', params: new URLSearchParams(query || '') };
}

async function route() {
  if (!session.user) return;
  const { key, params } = parseHash();
  const token = ++navToken;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === key));
  closeMenu();
  content.innerHTML = skeleton();
  try {
    const page = await ROUTES[key].load();
    $('#pageEyebrow').textContent = page.meta.eyebrow; $('#pageTitle').textContent = page.meta.title;
    document.title = `${page.meta.title} · INV SYSTEM`;
    const el = document.createElement('div');
    await page.render(el, params);
    if (token !== navToken) return;          // user already navigated elsewhere
    content.replaceChildren(el);
    if (params.has('new')) history.replaceState(null, '', `#/${key}`);
    window.scrollTo(0, 0);
  } catch (err) {
    if (token !== navToken) return;
    console.error(err);
    content.innerHTML = `<div class="panel error-panel"><h2>Could not load this page</h2><p>${esc(friendlyError(err))}</p>
      <p class="muted">If this is a new setup, make sure both SQL files in the <code>sql/</code> folder have been run.</p><button class="primary" id="retry">Try again</button></div>`;
    $('#retry').onclick = route;
  }
}
window.addEventListener('hashchange', route);

// ---------- shell ----------
function buildNav() {
  $('#mainNav').innerHTML = Object.entries(ROUTES).filter(([k]) => allowed(k))
    .map(([k, r]) => `<a class="nav-item" data-page="${k}" href="#/${k}">${icon(r.icon, 19)}<span>${r.label}</span></a>`).join('');
}
const closeMenu = () => document.body.classList.remove('menu-open');
$('#menuBtn').onclick = () => document.body.classList.toggle('menu-open');
$('#scrim').onclick = closeMenu;
$('#logoutBtn').onclick = async () => {
  if (status().pending && !confirm(`${status().pending} entr${status().pending === 1 ? 'y has' : 'ies have'} not been sent yet. Sign out anyway? They stay saved on this device and will send after you sign in again with internet.`)) return;
  clearCache(); supabase.auth.signOut();
};
$('#todayLabel').textContent = new Date().toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

async function showApp(user) {
  if (shownFor === user.id) return;
  shownFor = user.id;
  try {
    const profile = await loadProfile(user.id);
    if (!profile || profile.active === false) {
      shownFor = null; await supabase.auth.signOut();
      loginMessage('This account is not approved for the business system. Contact the owner.');
      return;
    }
    session.user = user; session.profile = profile; saveUser({ id: user.id, email: user.email });
    const name = profile.full_name || user.email;
    $('#userName').textContent = name; $('#userRole').textContent = roleLabel(); $('#userInitial').textContent = name.slice(0, 1).toUpperCase();
    buildNav();
    loginView.classList.add('hidden'); appView.classList.remove('hidden');
    route();
  } catch (err) {
    console.error(err); shownFor = null;
    loginMessage('Signed in, but your profile could not be loaded. Run both SQL files in the sql/ folder, then try again.');
    await supabase.auth.signOut();
  }
}

function showLogin() {
  shownFor = null; session.user = null; session.profile = null; navToken++;
  appView.classList.add('hidden'); loginView.classList.remove('hidden'); content.innerHTML = '';
  $('#password').value = '';
}

// ---------- account actions ----------
function passwordModal(title) {
  openModal({
    eyebrow: 'ACCOUNT', title, submitLabel: 'Save password',
    body: formGrid([
      { name: 'p1', label: 'New password', type: 'password', required: true, help: 'At least 8 characters.' },
      { name: 'p2', label: 'Repeat new password', type: 'password', required: true },
    ]),
    onSubmit: async (v) => {
      if (v.p1.length < 8) throw new Error('Password must be at least 8 characters.');
      if (v.p1 !== v.p2) throw new Error('The two passwords do not match.');
      const { error } = await supabase.auth.updateUser({ password: v.p1 });
      if (error) throw error;
      toast('Password changed');
    },
  });
}
$('#changePwBtn').onclick = () => passwordModal('Change password');

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); loginMessage('');
  const btn = e.currentTarget.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
    if (error) throw error;
  } catch (err) { loginMessage(/Invalid login/i.test(err.message) ? 'Wrong email or password.' : friendlyError(err)); }
  finally { btn.disabled = false; btn.textContent = 'Sign in'; }
});
$('#forgotBtn').onclick = async () => {
  const email = $('#email').value.trim();
  if (!email) return loginMessage('Type your email above first, then press “Forgot password”.');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  error ? loginMessage(friendlyError(error)) : loginMessage('If that email has an account, a reset link has been sent.', true);
};

// ---------- offline status bar ----------
const bar = $('#netBar');
function drawBar(st = status()) {
  const n = st.pending, plural = `${n} change${n === 1 ? '' : 's'}`;
  let html = '', cls = 'net-bar';
  if (st.failed) { cls += ' problem'; html = `${st.failed} saved entr${st.failed === 1 ? 'y' : 'ies'} could not be sent <button id="reviewBtn">Review</button>`; }
  else if (!st.online) { cls += ' offline'; html = `Offline — working from saved data${n ? ` · ${plural} waiting` : ''}`; }
  else if (st.syncing) html = `Sending ${plural}…`;
  else if (n) html = `${plural} waiting to send <button id="syncBtn">Send now</button>`;
  bar.className = html ? cls : 'net-bar hidden'; bar.innerHTML = html;
  const rb = $('#reviewBtn'), sb = $('#syncBtn');
  if (rb) rb.onclick = () => openModal({ eyebrow: 'OFFLINE ENTRIES', title: 'Not saved to the system', submitLabel: 'OK, clear this list',
    body: `<p>The server refused these entries when internet returned. Please enter them again if needed.</p><ul class="list">${getFailed().map((f) => `<li><span><b>${esc(f.label)}</b><br><small class="muted">${esc(f.reason)}</small></span></li>`).join('')}</ul>`,
    onSubmit: async () => { clearFailed(); } });
  if (sb) sb.onclick = sync;
}
onChange(drawBar); drawBar();
window.addEventListener('inv:synced', (e) => { toast(`${e.detail.done} saved entr${e.detail.done === 1 ? 'y' : 'ies'} sent to the system`); if (session.user && !$('#modal').open) route(); });

// ---------- start ----------
function init() {
  if (!isConfigured) {
    loginMessage('Setup needed: open config.js and add your Supabase Project URL and anon/public key.');
    $('#loginForm').querySelectorAll('input,button').forEach((x) => (x.disabled = true));
    return;
  }
  // Opened with no internet? Go straight in with the last signed-in user.
  setTimeout(() => { const u = loadUser(); if (!session.user && !navigator.onLine && u) showApp(u); }, 1500);
  supabase.auth.onAuthStateChange((event, s) => {
    // Never await Supabase calls directly inside this callback (can deadlock) — defer them.
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY' && s?.user) { showApp(s.user).then(() => passwordModal('Set a new password')); }
      else if (s?.user && event !== 'SIGNED_OUT') showApp(s.user);
      else if (!s) showLogin();
    }, 0);
  });
}
init();
