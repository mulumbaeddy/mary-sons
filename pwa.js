// Registers the service worker and wires the "Install app" button.
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
let deferred = null;
const btn = () => document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (btn()) btn().hidden = false; });
window.addEventListener('appinstalled', () => { deferred = null; if (btn()) btn().hidden = true; });
window.addEventListener('DOMContentLoaded', () => {
  btn().onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; btn().hidden = true; };
});
