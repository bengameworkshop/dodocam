/* Outils communs : sélecteurs, écrans, stockage, encodage, écran allumé, petites fenêtres. */
"use strict";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const show = id => { $$('.screen').forEach(e => e.hidden = e.id !== id); window.scrollTo(0, 0); };
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hhmm = (d = new Date()) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/* Stockage local (préfixé, sans planter si indisponible) */
const store = {
  get(k, d){ try{ const v = localStorage.getItem('dc_' + k); return v === null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('dc_' + k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem('dc_' + k); }catch(e){} }
};

/* Base64 "URL" */
function b64u(bytes){ let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(str){ str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; const s = atob(str); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function randomId(n = 12){ const a = new Uint8Array(n); crypto.getRandomValues(a); return b64u(a); }

/* Garder l'écran allumé */
let wakeLock = null, wantAwake = false;
async function keepAwake(){
  wantAwake = true;
  try{ if ('wakeLock' in navigator && (!wakeLock || wakeLock.released)) wakeLock = await navigator.wakeLock.request('screen'); }catch(e){}
}
const awakeOk = () => !!wakeLock && !wakeLock.released;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantAwake) keepAwake(); });

/* Petit message en bas de l'écran */
let toastTimer = null;
function toast(txt, ms = 3500){
  const t = $('#toast'); t.textContent = txt; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms);
}

/* Fenêtre de confirmation (remplace confirm()) */
function ask(title, txt, okLabel = 'OK', cancel = true){
  return new Promise(res => {
    $('#dlgTitle').textContent = title; $('#dlgTxt').textContent = txt; $('#dlgOk').textContent = okLabel;
    $('#dlgCancel').hidden = !cancel; $('#dialog').hidden = false;
    $('#dlgOk').onclick = () => { $('#dialog').hidden = true; res(true); };
    $('#dlgCancel').onclick = () => { $('#dialog').hidden = true; res(false); };
  });
}
const info = (title, txt) => ask(title, txt, 'OK', false);

/* Boutons "segmentés" : un seul choix actif */
function segInit(id, value, cb){
  const btns = $$('#' + id + ' button');
  const set = v => btns.forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
  set(value);
  btns.forEach(b => b.onclick = () => { set(b.dataset.v); cb(b.dataset.v); });
  return set;
}

/* Boutons "Copier" */
$$('[data-copy]').forEach(b => b.onclick = async () => {
  const ta = $('#' + b.dataset.copy);
  try{ await navigator.clipboard.writeText(ta.value); b.textContent = 'Copié ✓'; }
  catch(e){ ta.select(); try{ document.execCommand('copy'); b.textContent = 'Copié ✓'; }catch(_){ b.textContent = 'Sélectionné, copie-le'; } }
  setTimeout(() => b.textContent = 'Copier', 2000);
});
