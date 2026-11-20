/* Sonneries générées (pas de fichier audio à charger). */
"use strict";

let actx = null;
function audioCtx(){
  if (!actx){ const C = window.AudioContext || window.webkitAudioContext; actx = new C(); }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function note(ac, out, f, t, len, type = 'sine', peak = 0.35){
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(g).connect(out); o.start(t); o.stop(t + len + 0.05);
}

const RINGS = {
  chime: (ac, out, t, soft) => (soft ? [784, 1175] : [784, 988, 1175, 1568]).forEach((f, i) => note(ac, out, f, t + i * 0.16, 0.9)),
  soft:  (ac, out, t, soft) => (soft ? [523, 659] : [523, 659, 784, 659]).forEach((f, i) => note(ac, out, f, t + i * 0.3, 1.3, 'triangle', 0.4)),
  beep:  (ac, out, t, soft) => (soft ? [0] : [0, 1, 2]).forEach(i => note(ac, out, 1046, t + i * 0.25, 0.14, 'square', 0.12))
};

/* name: chime|soft|beep, vol: 0..1, soft: version courte et plus douce */
function playRing(name = 'chime', vol = 0.8, soft = false){
  try{
    const ac = audioCtx(), out = ac.createGain();
    out.gain.value = vol * (soft ? 0.45 : 1); out.connect(ac.destination);
    (RINGS[name] || RINGS.chime)(ac, out, ac.currentTime + 0.02, soft);
  }catch(e){}
}
