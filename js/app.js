/* Accueil, installation sur l'écran d'accueil, service worker. */
"use strict";

if (!window.isSecureContext) $('#secureWarn').hidden = false;

/* Sous-titres "Reprendre" quand le téléphone est déjà appairé */
if (store.get('babyKey', null)) $('#babySub').textContent = 'Reprendre : ce téléphone filme la chambre';
if (store.get('parentKey', null)) $('#parentSub').textContent = 'Reprendre : retrouver le téléphone bébé';

$('#goManual').onclick = () => show('manual');
$('#manualBaby').onclick = () => $('#babyManual').click();
$$('[data-home]').forEach(b => b.onclick = () => location.reload());
$('#resetBtn').onclick = async () => {
  if (!await ask('Oublier les appairages ?', "Ce téléphone ne se reconnectera plus tout seul. Il faudra rescanner le QR code du téléphone bébé. Côté bébé, un nouveau code sera créé : tous les parents devront le rescanner.", 'Oublier')) return;
  ['babyKey', 'parentKey', 'babyHasParent', 'checkedOnce', 'calibrated'].forEach(store.del);
  location.reload();
};

/* ---------- Installation (appli sur l'écran d'accueil) ---------- */
let installEvt = null;
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
function renderInstall(){
  const box = $('#installBox');
  if (isStandalone() || !/^https?:$/.test(location.protocol) || store.get('hideInstall', false)){ box.hidden = true; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('#installTxt').textContent = installEvt ? "Elle s'ouvrira comme une vraie appli, avec son icône, en plein écran."
    : ios ? "Dans Safari : touche le bouton Partager (le carré avec une flèche), puis « Sur l'écran d'accueil »."
    : "Ouvre le menu ⋮ du navigateur, puis « Installer l'application » ou « Ajouter à l'écran d'accueil ».";
  $('#installBtn').hidden = !installEvt;
  box.hidden = false;
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderInstall(); });
window.addEventListener('appinstalled', () => { installEvt = null; renderInstall(); });
$('#installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); try{ await installEvt.userChoice; }catch(e){} installEvt = null; renderInstall(); };
$('#installHide').onclick = () => { store.set('hideInstall', true); renderInstall(); };
renderInstall();

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker non enregistré', e));
show('home');
