/* ================= CÔTÉ PARENT =================
   Retrouve le téléphone bébé, affiche l'image et le son, et déclenche les alertes. */
"use strict";

/* Réglages mémorisés */
const S = {
  thr: store.get('thr', 55), dur: store.get('dur', 3), det: store.get('det', 'cry'),
  motion: store.get('motion', false), msens: store.get('msens', 'mid'),
  ring: store.get('ring', 'chime'), vol: store.get('vol', 80), vib: store.get('vib', false),
  bright: store.get('bright', 0), bw: store.get('bw', false),
  sound: true, image: true, alert: true
};
const save = k => store.set(k, S[k]);
const MSENS = { low: 45, mid: 28, high: 15 };      // % de l'image qui doit bouger
const CRY_MIN = 35;                                 // score de pleurs minimum

/* État de la connexion */
const C = {
  manual: false, relay: null, pc: null, dc: null, sid: null, remote: new MediaStream(),
  live: false, everLive: false, lastMsg: 0, dropAt: null, timer: null, tries: 0, lastAttempt: 0,
  babyMode: 'av', babyWake: null, bat: null, lastLevelAt: 0
};
/* État des alertes */
const A = { loudMs: 0, moveMs: 0, kind: null, loop: null, snoozeUntil: 0, softUntil: 0, lostAlarmed: false, lowBat: false };
let hist = [], sessionStart = null, calib = null;
const myId = store.get('parentId', null) || (() => { const id = randomId(9); store.set('parentId', id); return id; })();

/* ---------- Démarrer ---------- */
$('#goParent').onclick = () => {
  audioCtx(); keepAwake(); askNotif();
  const key = store.get('parentKey', null);
  if (key) startParent(key); else show('parentPair');
};
$('#parentScanPair').onclick = async () => {
  let code; try{ code = await scanCode(['DC1']); }catch(e){ return; }
  let key; try{ key = pairKeyFrom(code); }catch(e){ info('Oups', "Ce QR code n'est pas un code d'appairage Dodocam."); return; }
  store.set('parentKey', key);
  toast('Téléphone appairé ✓');
  startParent(key);
};
async function startParent(key){
  enterLive();
  C.relay = new Relay(key, myId);
  C.relay.onMessage = parentRelayMsg;
  C.relay.onOpen = () => { if (!C.live) attempt(); };
  await C.relay.open();
  setTimeout(() => { if (!C.everLive) $('#searchHint').hidden = false; }, 12000);
}
function enterLive(){
  show('parentLive');
  sessionStart = new Date(); updateSessTitle();
  addLog('Session démarrée');
  setPill('wait', 'Recherche…');
  updateStage();
}

/* ---------- Connexion et reconnexion automatique ---------- */
async function attempt(){
  if (C.manual || !C.relay || C.live) return;
  clearTimeout(C.timer);
  if (Date.now() - C.lastAttempt < 3000){ C.timer = setTimeout(attempt, 3000); return; }
  C.lastAttempt = Date.now();
  closePC();
  const sid = C.sid = randomId(6);
  try{
    const { pc, dc, offer } = await makeParentPC();
    if (sid !== C.sid){ pc.close(); return; }
    wirePC(pc, dc);
    await C.relay.send({ type: 'offer', sid, sdp: await packSDP(offer) });
  }catch(e){ console.warn('tentative', e); }
  // On réessaie de plus en plus doucement (le relais limite le nombre de messages).
  const wait = Math.min(15000, 6000 + C.tries * 3000); C.tries++;
  C.timer = setTimeout(() => { if (!C.live) attempt(); }, wait);
}
function closePC(){ if (C.pc) try{ C.pc.close(); }catch(e){} C.pc = null; C.dc = null; }
function wirePC(pc, dc){
  C.pc = pc; C.dc = dc; C.remote = new MediaStream();
  pc.ontrack = e => { if (pc !== C.pc) return; C.remote.addTrack(e.track); attachRemote(); };
  dc.onopen = () => { if (pc === C.pc) onLive(); };
  dc.onmessage = e => { if (pc === C.pc) onBabyMsg(e.data); };
  dc.onclose = () => { if (pc === C.pc && C.live) onDrop(); };
  pc.onconnectionstatechange = () => { if (pc === C.pc && C.live && ['failed', 'closed'].includes(pc.connectionState)) onDrop(); };
}
async function parentRelayMsg(m){
  if (m.type === 'answer' && m.sid === C.sid && C.pc && C.pc.signalingState === 'have-local-offer'){
    try{ await C.pc.setRemoteDescription(await unpackSDP(m.sdp)); }catch(e){ console.warn(e); }
  } else if (m.type === 'babyup' && !C.live){
    C.tries = 0; C.lastAttempt = 0; attempt();
  }
}
function onLive(){
  const again = C.dropAt !== null;
  C.live = true; C.everLive = true; C.tries = 0; clearTimeout(C.timer);
  C.lastMsg = Date.now(); C.dropAt = null; A.lostAlarmed = false;
  setPill('ok', 'Connecté'); $('#searchHint').hidden = true;
  addLog(again ? 'Reconnecté' : 'Connecté au téléphone bébé');
  if (A.kind === 'lost') stopAlarm();
  sendJSON(C.dc, { t: 'video', on: S.image });
  attachRemote();
  if (!store.get('checkedOnce', false)){ store.set('checkedOnce', true); setTimeout(openCheck, 1500); }
}
function onDrop(){
  if (!C.live) return;
  C.live = false; C.dropAt = Date.now();
  setPill('wait', C.manual ? 'Connexion coupée' : 'Reconnexion…');
  addLog('Connexion coupée, reconnexion…');
  updateStage();
  if (!C.manual){ C.tries = 0; C.lastAttempt = 0; attempt(); }
}
/* Surveillance : messages du bébé toutes les 250 ms ; silence = coupure */
setInterval(() => {
  const now = Date.now();
  if (C.live && now - C.lastMsg > 5000) onDrop();
  const limit = C.manual ? 6000 : 20000;
  if (!C.live && C.dropAt && now - C.dropAt > limit && !A.lostAlarmed){
    A.lostAlarmed = true; setPill('bad', 'Connexion perdue'); addLog('Connexion perdue', true); triggerAlarm('lost');
  }
  if (sessionStart) updateSessTitle();
}, 1000);

/* ---------- Messages du téléphone bébé ---------- */
function onBabyMsg(data){
  let m; try{ m = JSON.parse(data); }catch(_){ return; }
  C.lastMsg = Date.now();
  if (m.t === 'hello'){ C.babyMode = m.mode; C.babyWake = m.w; if (m.bat) onBattery(m.bat); updateStage(); }
  else if (m.t === 'l') onLevel(m.v, m.c || 0, m.m || 0);
  else if (m.t === 'b'){ onBattery(m); if ('w' in m) C.babyWake = m.w; }
  else if (m.t === 's') C.babyWake = m.w;
}
function onBattery(b){
  const prev = C.bat; C.bat = { l: b.l, c: b.c };
  const p = $('#batPill'); p.hidden = false; p.textContent = (b.c ? '⚡ ' : '🔋 ') + b.l + ' %';
  if (prev && prev.c && !b.c){ addLog('Téléphone bébé débranché', true); triggerAlarm('unplugged'); }
  if (!b.c && b.l <= 20 && !A.lowBat){ A.lowBat = true; addLog('Batterie faible (' + b.l + ' %)', true); triggerAlarm('lowbat', b.l); }
  if (b.c) A.lowBat = false;
}
function onLevel(v, c, mv){
  C.lastLevelAt = Date.now();
  hist.push(v); if (hist.length > 240) hist.shift();
  $('#parentFill').style.width = v + '%';
  const g = $('#glow'); g.style.transform = 'scale(' + (1 + v / 160) + ')';
  drawSpark();
  if (calib) calib.vals.push(v);

  const cryOn = c >= CRY_MIN, moveOn = C.babyMode !== 'a' && mv >= MSENS[S.msens];
  $('#pCry').classList.toggle('on', cryOn); $('#pMove').classList.toggle('on', moveOn);
  // Compteurs tolérants : un pleur a des pauses pour respirer.
  const loud = v >= S.thr && (S.det === 'all' || cryOn);
  A.loudMs = loud ? A.loudMs + 250 : Math.max(0, A.loudMs - 90);
  A.moveMs = S.motion && moveOn ? A.moveMs + 250 : Math.max(0, A.moveMs - 90);

  const now = Date.now(), need = S.dur * 1000, early = Math.max(600, need * 0.35);
  if (!S.alert || A.kind || calib || now < A.snoozeUntil) return;
  if (A.loudMs >= need){ A.loudMs = 0; triggerAlarm(cryOn || S.det === 'cry' ? 'cry' : 'noise'); }
  else if (A.moveMs >= need){ A.moveMs = 0; triggerAlarm('motion'); }
  else if ((A.loudMs >= early || A.moveMs >= early) && now >= A.softUntil){
    // Alerte progressive : d'abord un petit signal discret.
    A.softUntil = now + 30000;
    addLog("Bébé s'agite"); toast("👶 Bébé s'agite…", 4000);
    if (!S.vib) playRing(S.ring, S.vol / 100, true);
    if (navigator.vibrate) navigator.vibrate(200);
  }
}

/* ---------- Alarmes ---------- */
const ALARMS = {
  noise: ['👶', 'Bébé se réveille', 'Du bruit dans la chambre depuis quelques secondes.'],
  cry: ['😢', 'Bébé pleure', 'Des pleurs depuis quelques secondes.'],
  motion: ['🧸', 'Bébé bouge', 'Du mouvement dans le lit depuis quelques secondes.'],
  lost: ['📡', 'Connexion perdue', "Impossible de joindre le téléphone bébé depuis {x}. Vérifie qu'il est allumé, sur le Wi‑Fi, et que Dodocam est ouverte."],
  unplugged: ['🔌', 'Téléphone bébé débranché', "Il n'est plus en charge. Rebranche-le pour qu'il tienne jusqu'au bout."],
  lowbat: ['🪫', 'Batterie faible', 'Le téléphone bébé est à {x} %. Branche-le vite.']
};
function triggerAlarm(kind, x){
  if (A.kind) return;
  A.kind = kind;
  const [ico, title, raw] = ALARMS[kind];
  const txt = raw.replace('{x}', kind === 'lost' ? (C.manual ? 'quelques secondes' : '20 secondes') : x);
  $('#alarmIco').textContent = ico; $('#alarmTitle').textContent = title; $('#alarmTxt').textContent = txt;
  $('#alarm').hidden = false;
  if (['noise', 'cry', 'motion'].includes(kind)) addLog(title, true);
  const ring = () => { if (!S.vib) playRing(S.ring, S.vol / 100); if (navigator.vibrate) navigator.vibrate([500, 200, 500]); };
  ring(); clearInterval(A.loop); A.loop = setInterval(ring, 2400);
  notify(title, txt);
}
function stopAlarm(){ clearInterval(A.loop); A.loop = null; A.kind = null; $('#alarm').hidden = true; if (navigator.vibrate) navigator.vibrate(0); }
$('#alarmOk').onclick = () => {
  const k = A.kind; stopAlarm();
  if (['noise', 'cry', 'motion'].includes(k)){ A.snoozeUntil = Date.now() + 30000; A.loudMs = A.moveMs = 0; }
};
function askNotif(){ try{ if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); }catch(e){} }
function notify(title, body){
  try{
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'dodocam', renotify: true, requireInteraction: true, vibrate: [500, 200, 500] };
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(r => r.showNotification(title, opts)).catch(() => {});
    else new Notification(title, opts);
  }catch(e){}
}

/* ---------- Image et son ---------- */
function setPill(k, t){ const p = $('#parentPill'); p.className = 'pill ' + k; p.textContent = t; }
async function attachRemote(){
  const v = $('#remoteVideo');
  if (v.srcObject !== C.remote) v.srcObject = C.remote;
  v.muted = !S.sound;
  try{ await v.play(); $('#unmuteBtn').hidden = true; }
  catch(e){ v.muted = true; try{ await v.play(); }catch(_){} if (S.sound) $('#unmuteBtn').hidden = false; }
  applyFilter(); updateStage();
}
$('#unmuteBtn').onclick = async () => { const v = $('#remoteVideo'); v.muted = false; try{ await v.play(); $('#unmuteBtn').hidden = true; }catch(e){} };
function updateStage(){
  const noVideo = C.babyMode === 'a';
  const showVid = !noVideo && S.image && C.live;
  $('#remoteVideo').style.visibility = showVid ? 'visible' : 'hidden';
  $('#audioViz').hidden = showVid;
  $('#stageTag').textContent = !C.live ? 'En attente…' : noVideo ? 'Son seulement' : S.image ? 'En direct' : 'Image en pause';
  $('#motionSet').hidden = noVideo; $('#imgSet').hidden = noVideo; $('#pMove').hidden = noVideo;
}
function applyFilter(){
  $('#remoteVideo').style.filter = `brightness(${(1 + S.bright / 40).toFixed(2)}) contrast(${(1 + S.bright / 150).toFixed(2)})${S.bw ? ' grayscale(1)' : ''}`;
  $('#brightVal').textContent = S.bright ? '+' + S.bright + ' %' : 'Normal';
}
function drawSpark(){
  const c = $('#spark'), dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  if (c.width !== w * dpr){ c.width = w * dpr; c.height = h * dpr; }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const ty = h - (S.thr / 100) * h;
  x.strokeStyle = '#ffffff55'; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(0, ty); x.lineTo(w, ty); x.stroke(); x.setLineDash([]);
  const n = 240, step = w / (n - 1), off = n - hist.length;
  x.beginPath();
  hist.forEach((v, i) => { const px = (i + off) * step, py = h - (v / 100) * (h - 2) - 1; i ? x.lineTo(px, py) : x.moveTo(px, py); });
  const grad = x.createLinearGradient(0, h, 0, 0); grad.addColorStop(0, '#9be7c4'); grad.addColorStop(.6, '#ffe08a'); grad.addColorStop(1, '#ff8fab');
  x.strokeStyle = grad; x.lineWidth = 2.5; x.lineJoin = 'round'; x.stroke();
}
window.addEventListener('resize', drawSpark);

/* ---------- Journal de la session (nuit ou sieste) ---------- */
const logged = [];
function addLog(txt, strong){
  logged.unshift({ t: hhmm(), txt, strong }); if (logged.length > 40) logged.pop();
  $('#log').innerHTML = logged.map(l => '<li>' + (l.strong ? '<b>' + l.txt + '</b>' : l.txt) + '<span>' + l.t + '</span></li>').join('');
}
function updateSessTitle(){
  const min = Math.floor((Date.now() - sessionStart) / 60000);
  const d = min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0');
  $('#sessTitle').textContent = 'Session depuis ' + hhmm(sessionStart) + ' · ' + d;
}

/* ---------- Réglages ---------- */
const thr = $('#thr');
function applyThr(){ thr.value = S.thr; $('#thrVal').textContent = S.thr + ' %'; $('#thrMark').style.left = 'calc(' + S.thr + '% - 1.5px)'; drawSpark(); }
thr.oninput = () => { S.thr = +thr.value; save('thr'); applyThr(); };
applyThr();
$$('#durChips button').forEach(b => { b.classList.toggle('on', +b.dataset.v === S.dur); b.onclick = () => { S.dur = +b.dataset.v; save('dur'); $$('#durChips button').forEach(x => x.classList.toggle('on', x === b)); }; });
const DET_HINT = {
  cry: "Seulement les sons qui ressemblent à des pleurs (voix aiguë). Moins de fausses alertes (porte, toux, voiture), mais un petit gazouillis calme ne déclenche rien.",
  all: 'Tout bruit fort qui dure : pleurs, mais aussi toux, porte, voix…'
};
segInit('detSeg', S.det, v => { S.det = v; save('det'); $('#detHint').textContent = DET_HINT[v]; });
$('#detHint').textContent = DET_HINT[S.det];
$('#motionChk').checked = S.motion; $('#msensSeg').hidden = !S.motion;
$('#motionChk').onchange = e => { S.motion = e.target.checked; save('motion'); $('#msensSeg').hidden = !S.motion; };
segInit('msensSeg', S.msens, v => { S.msens = v; save('msens'); });
segInit('ringSeg', S.ring, v => { S.ring = v; save('ring'); playRing(S.ring, S.vol / 100); });
const vol = $('#vol'); vol.value = S.vol; $('#volVal').textContent = S.vol + ' %';
vol.oninput = () => { S.vol = +vol.value; save('vol'); $('#volVal').textContent = S.vol + ' %'; };
vol.onchange = () => playRing(S.ring, S.vol / 100, true);
$('#vibChk').checked = S.vib; $('#vibChk').onchange = e => { S.vib = e.target.checked; save('vib'); };
$('#ringTest').onclick = () => { if (!S.vib) playRing(S.ring, S.vol / 100); if (navigator.vibrate) navigator.vibrate([500, 200, 500]); };
const bright = $('#bright'); bright.value = S.bright;
bright.oninput = () => { S.bright = +bright.value; save('bright'); applyFilter(); };
$('#bwChk').checked = S.bw; $('#bwChk').onchange = e => { S.bw = e.target.checked; save('bw'); applyFilter(); };
applyFilter();

const togSet = (id, on) => $(id).classList.toggle('on', on);
togSet('#togSound', S.sound); togSet('#togImage', S.image); togSet('#togAlert', S.alert);
$('#togSound').onclick = () => { S.sound = !S.sound; togSet('#togSound', S.sound); const v = $('#remoteVideo'); v.muted = !S.sound; if (S.sound) v.play().catch(() => $('#unmuteBtn').hidden = false); else $('#unmuteBtn').hidden = true; };
$('#togImage').onclick = () => { S.image = !S.image; togSet('#togImage', S.image); sendJSON(C.dc, { t: 'video', on: S.image }); updateStage(); };
$('#togAlert').onclick = () => { S.alert = !S.alert; togSet('#togAlert', S.alert); toast(S.alert ? 'Alertes activées' : 'Alertes de réveil coupées (les alertes de connexion restent)'); };
$('#parentStop').onclick = () => location.reload();

/* ---------- Seuil automatique ---------- */
$('#calibBtn').onclick = () => {
  if (!C.live){ toast("Connecte d'abord le téléphone bébé"); return; }
  if (calib) return;
  calib = { vals: [], t0: Date.now() };
  const btn = $('#calibBtn'), label = btn.textContent;
  $('#calibProg').hidden = false; btn.disabled = true; btn.textContent = '🤫 Mesure du calme… évite de faire du bruit';
  const iv = setInterval(() => {
    const k = (Date.now() - calib.t0) / 20000;
    $('#calibProg i').style.width = Math.min(100, k * 100) + '%';
    if (k < 1) return;
    clearInterval(iv);
    const v = calib.vals.slice().sort((a, b) => a - b);
    const p95 = v.length ? v[Math.floor(v.length * 0.95)] : 30;
    calib = null;
    S.thr = clamp(Math.round(p95 + 15), 20, 90); save('thr'); applyThr();
    store.set('calibrated', true);
    btn.disabled = false; btn.textContent = label; $('#calibProg').hidden = true;
    toast('Seuil réglé à ' + S.thr + ' % ✓'); addLog('Seuil réglé automatiquement (' + S.thr + ' %)');
  }, 250);
};

/* ---------- Vérification avant de laisser bébé ---------- */
let ringHeard = false, ringTried = false, checkTimer = null, lastChecks = '';
function openCheck(){ $('#check').hidden = false; lastChecks = ''; refreshCheck(); clearInterval(checkTimer); checkTimer = setInterval(refreshCheck, 700); }
$('#checkBtn').onclick = openCheck;
$('#checkClose').onclick = () => { $('#check').hidden = true; clearInterval(checkTimer); };
function refreshCheck(){
  const v = $('#remoteVideo'), now = Date.now(), cal = store.get('calibrated', false);
  const items = [
    ['Connexion', C.live ? 'ok' : 'no', C.live ? 'Les deux téléphones sont reliés.' : 'Pas encore connecté.'],
    ['Image', C.babyMode === 'a' ? 'ok' : v.videoWidth > 0 ? 'ok' : 'no', C.babyMode === 'a' ? "Mode son seul : pas d'image." : v.videoWidth > 0 ? "L'image arrive." : "Pas encore d'image."],
    ['Son et bruit', now - C.lastLevelAt < 2000 ? 'ok' : 'no', now - C.lastLevelAt < 2000 ? 'Le micro de la chambre est bien mesuré.' : 'Aucune mesure du micro pour le moment.'],
    ['Écran allumé, ici', awakeOk() ? 'ok' : 'warn', awakeOk() ? 'Ce téléphone ne se mettra pas en veille.' : 'Mets la mise en veille automatique sur « jamais » pendant la surveillance.'],
    ['Écran allumé, côté bébé', C.babyWake ? 'ok' : C.babyWake === false ? 'warn' : 'no', C.babyWake ? 'Le téléphone bébé reste allumé.' : 'Sur le téléphone bébé, mets la mise en veille automatique sur « jamais ».'],
    ['Téléphone bébé en charge', C.bat ? (C.bat.c ? 'ok' : 'warn') : 'warn', C.bat ? (C.bat.c ? 'Branché (' + C.bat.l + ' %).' : 'Pas branché (' + C.bat.l + ' %) : branche-le.') : "Info indisponible sur iPhone : vérifie qu'il est bien branché."],
    ['Sonnerie', ringHeard ? 'ok' : 'no', ringHeard ? "Tu entends bien l'alerte." : 'Teste-la, et monte le volume du téléphone.', 'ring'],
    ["Seuil d'alerte", cal ? 'ok' : 'warn', cal ? 'Réglé à ' + S.thr + ' %.' : 'Laisse Dodocam mesurer le calme de la chambre (20 s).', 'calib']
  ];
  const icon = { ok: '✓', warn: '!', no: '…' };
  const html = items.map(([title, st, txt, act]) => {
    let btn = '';
    if (act === 'ring' && !ringHeard) btn = ringTried ? '<button class="btn small" data-act="heard">Je l\'entends ✓</button> <button class="btn ghost small" data-act="ring">Rejouer</button>' : '<button class="btn ghost small" data-act="ring">▶︎ Tester la sonnerie</button>';
    if (act === 'calib' && !cal && C.live) btn = calib ? '<small>Mesure en cours…</small>' : '<button class="btn ghost small" data-act="calib">✨ Régler (20 s)</button>';
    return `<li class="st-${st}"><span class="st">${icon[st]}</span><div><b>${title}</b><small>${txt}</small>${btn}</div></li>`;
  }).join('');
  if (html !== lastChecks){
    lastChecks = html; $('#checks').innerHTML = html;
    $$('#checks [data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'ring'){ ringTried = true; if (!S.vib) playRing(S.ring, S.vol / 100); if (navigator.vibrate) navigator.vibrate([500, 200, 500]); }
      if (a === 'heard') ringHeard = true;
      if (a === 'calib') $('#calibBtn').click();
      refreshCheck();
    });
  }
  $('#readyTxt').hidden = items.some(i => i[1] === 'no');
}

/* ---------- Mode sans internet ---------- */
$('#manualParent').onclick = async () => {
  audioCtx(); keepAwake(); askNotif();
  C.manual = true;
  show('parentOffer');
  try{
    const { pc, dc, offer } = await makeParentPC();
    wirePC(pc, dc);
    const code = await packSDP(offer);
    renderQR($('#parentQr'), code); $('#parentCode').value = code;
  }catch(e){ $('#parentQr').innerHTML = '<p style="color:#555">Impossible de démarrer : ' + (e.message || e) + '</p>'; }
};
$('#parentScanAnswer').onclick = async () => {
  let code; try{ code = await scanCode(['PV1A']); }catch(e){ return; }
  try{ await C.pc.setRemoteDescription(await unpackSDP(code)); enterLive(); }
  catch(e){ info('Oups', 'Ce code ne marche pas : ' + (e.message || e)); }
};
