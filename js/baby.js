/* ================= CÔTÉ BÉBÉ =================
   Filme et écoute la chambre, mesure le bruit, les pleurs et le mouvement,
   et envoie tout ça à un ou plusieurs parents. */
"use strict";

const B = {
  mode: store.get('babyMode', 'av'), cam: store.get('babyCam', 'environment'),
  stream: null, peers: new Map(), relay: null, manual: false,
  lvl: 0, cry: 0, move: 0, bat: null,
  eco: store.get('babyEco', false), dark: false
};

segInit('modeSeg', B.mode, v => { B.mode = v; store.set('babyMode', v); $('#camPick').hidden = v === 'a'; });
segInit('camSeg', B.cam, v => { B.cam = v; store.set('babyCam', v); });
$('#camPick').hidden = B.mode === 'a';

async function babyMedia(){
  if (B.stream) return;
  const wantVideo = B.mode !== 'a';
  B.stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: wantVideo ? { facingMode: { ideal: B.cam }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 } } : false
  });
  const v = B.stream.getVideoTracks()[0];
  $('#localVideo').srcObject = B.stream; $('#localVideo').hidden = !v;
  $('#bMove').hidden = !v;
  startAnalysis();
  startBattery();
  keepAwake();
  setInterval(() => broadcast({ t: 's', w: awakeOk() }), 15000);
  setEco(B.eco, true);
  $('#babyModeTxt').textContent = { av: "Je transmets le son et l'image.", a: 'Je transmets le son uniquement.', v: "Je transmets l'image uniquement (le bruit est quand même mesuré)." }[B.mode];
}

/* ---------- Démarrage normal (avec relais) ---------- */
$('#goBaby').onclick = () => show('babySetup');
$('#babyStart').onclick = async () => {
  audioCtx();
  try{ await babyMedia(); }
  catch(e){ info('Caméra ou micro refusé', "Autorise la caméra et le micro pour Dodocam dans les réglages du navigateur, puis réessaie."); return; }
  let key = store.get('babyKey', null);
  if (!key){ key = randomId(32); store.set('babyKey', key); }
  if (!B.relay){
    B.relay = new Relay(key, 'baby');
    B.relay.onMessage = babyRelayMsg;
    B.relay.onOpen = () => B.relay.send({ type: 'babyup' }).catch(() => {});
    await B.relay.open();
  }
  renderQR($('#pairQr'), pairCode(key));
  updateBabyUI();
  show(store.get('babyHasParent', false) ? 'babyLive' : 'babyPair');
};
$('#pairDone').onclick = () => show('babyLive');
$('#addParent').onclick = () => { show('babyPair'); };

async function babyRelayMsg(m){
  if (m.type !== 'offer' || !m.sdp || !m.from) return;
  try{
    const answer = await babyHandleOffer(m.from, await unpackSDP(m.sdp));
    await B.relay.send({ type: 'answer', to: m.from, sid: m.sid, sdp: await packSDP(answer) });
  }catch(e){ console.warn('offre ignorée', e); }
}

/* Un parent demande à se connecter (nouvelle connexion ou reconnexion) */
async function babyHandleOffer(pid, offer){
  dropPeer(pid);
  const a = B.stream.getAudioTracks()[0], v = B.stream.getVideoTracks()[0];
  // Une copie des pistes par parent : chacun peut couper l'image de son côté.
  const at = a && B.mode !== 'v' ? a.clone() : null, vt = v && B.mode !== 'a' ? v.clone() : null;
  const { pc, answer } = await makeBabyPC(offer, at, vt);
  const peer = { pc, dc: null, at, vt };
  B.peers.set(pid, peer);
  pc.ondatachannel = e => {
    peer.dc = e.channel;
    peer.dc.onopen = () => {
      sendJSON(peer.dc, { t: 'hello', mode: B.mode, w: awakeOk(), bat: B.bat, eco: B.eco, dark: B.dark });
      applyQuality();
      store.set('babyHasParent', true); updateBabyUI();
      toast('Parent connecté ✓');
    };
    peer.dc.onmessage = ev => { let o; try{ o = JSON.parse(ev.data); }catch(_){ return; } if (o.t === 'video' && peer.vt) peer.vt.enabled = !!o.on;
      if (o.t === 'cmd'){ if ('eco' in o) setEco(!!o.eco); else if ('dark' in o) setDark(!!o.dark); } };
    peer.dc.onclose = () => { if (B.peers.get(pid) === peer) dropPeer(pid); };
  };
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState) && B.peers.get(pid) === peer) dropPeer(pid); };
  return answer;
}
function dropPeer(pid){
  const p = B.peers.get(pid); if (!p) return;
  B.peers.delete(pid);
  try{ p.pc.close(); }catch(e){}
  [p.at, p.vt].forEach(t => t && t.stop());
  updateBabyUI();
}
const broadcast = o => B.peers.forEach(p => sendJSON(p.dc, o));
const openPeers = () => [...B.peers.values()].filter(p => p.dc && p.dc.readyState === 'open').length;

function updateBabyUI(){
  const n = openPeers(), p = $('#babyPill');
  p.className = 'pill ' + (n ? 'ok' : 'wait');
  p.textContent = n ? 'Connecté' : 'En attente';
  const txt = n === 0 ? "Aucun parent connecté pour l'instant." : n === 1 ? '1 parent connecté.' : n + ' parents connectés.';
  $('#babyParents').textContent = txt;
  $('#pairCount').textContent = n ? txt + ' Tu peux en ajouter d\'autres, ou continuer.' : "En attente d'un parent…";
}

/* ---------- Mode sans internet ---------- */
$('#babyManual').onclick = async () => {
  audioCtx();
  let code; try{ code = await scanCode(['PV1O']); }catch(e){ return; }
  try{
    await sleepMs(250);
    await babyMedia();
    B.manual = true;
    const answer = await babyHandleOffer('manual', await unpackSDP(code));
    const packed = await packSDP(answer);
    renderQR($('#babyQr'), packed); $('#babyCode').value = packed;
    show('babyAnswer');
    const wait = setInterval(() => { if (openPeers()){ clearInterval(wait); show('babyLive'); } }, 500);
  }catch(e){ info('Oups', 'Connexion impossible : ' + (e.message || e) + '. Recommence depuis le téléphone parent.'); show('babySetup'); }
};

/* ---------- Analyse : bruit, pleurs, mouvement ---------- */
function startAnalysis(){
  const ac = audioCtx();
  const at = B.stream.getAudioTracks()[0];
  if (at){
    const an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
    ac.createMediaStreamSource(new MediaStream([at])).connect(an);
    const buf = new Float32Array(an.fftSize), spec = new Float32Array(an.frequencyBinCount);
    const sr = ac.sampleRate, binHz = sr / an.fftSize;
    const minLag = Math.floor(sr / 700), maxLag = Math.ceil(sr / 230), N = 1024;
    let peak = 0, n = 0, cryAvg = 0;
    setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const db = 20 * Math.log10(Math.sqrt(s / buf.length) + 1e-9);
      const lvl = clamp((db + 70) / 60 * 100, 0, 100);
      peak = Math.max(peak, lvl);
      // Pleurs : son assez fort, énergie dans les fréquences d'un pleur, et voix aiguë (230-700 Hz)
      let crying = 0;
      if (lvl > 15){
        an.getFloatFrequencyData(spec);
        let tot = 0, band = 0;
        for (let i = Math.floor(80 / binHz); i < Math.min(spec.length, 8000 / binHz); i++){
          const p = Math.pow(10, spec[i] / 10); tot += p; if (i * binHz >= 300 && i * binHz <= 3000) band += p;
        }
        let best = 0;
        for (let L = minLag; L <= maxLag; L += 2){
          let xy = 0, xx = 0, yy = 0;
          for (let i = 0; i < N; i++){ const a = buf[i], b = buf[i + L]; xy += a * b; xx += a * a; yy += b * b; }
          const r = xy / (Math.sqrt(xx * yy) + 1e-12); if (r > best) best = r;
        }
        crying = (tot > 0 && band / tot > 0.55 && best > 0.45) ? 1 : 0;
      }
      cryAvg = cryAvg * 0.93 + crying * 0.07;
      if (++n >= 5){
        B.lvl = Math.round(peak); B.cry = Math.round(clamp(cryAvg * 160, 0, 100));
        broadcast({ t: 'l', v: B.lvl, c: B.cry, m: B.move });
        $('#babyFill').style.width = B.lvl + '%';
        $('#bCry').classList.toggle('on', B.cry >= 35);
        peak = 0; n = 0;
      }
    }, 50);
  }
  const vt = B.stream.getVideoTracks()[0];
  if (vt){
    const v = $('#anVideo'); v.srcObject = new MediaStream([vt]); v.play().catch(() => {});
    const cv = document.createElement('canvas'); cv.width = 48; cv.height = 36;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    let prev = null, tick = 0;
    setInterval(() => {
      if (v.readyState < 2 || (B.eco && ++tick % 2)) return;
      cx.drawImage(v, 0, 0, 48, 36);
      const d = cx.getImageData(0, 0, 48, 36).data, g = new Uint8Array(48 * 36);
      let changed = 0;
      for (let i = 0; i < g.length; i++){
        g[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
        if (prev && Math.abs(g[i] - prev[i]) > 22) changed++;
      }
      prev = g;
      B.move = Math.round(clamp(changed / g.length * 400, 0, 100));
      $('#bMove').classList.toggle('on', B.move >= 25);
    }, 250);
  }
}

/* ---------- Batterie (Android ; l'iPhone ne la donne pas) ---------- */
async function startBattery(){
  if (!navigator.getBattery) return;
  try{
    const b = await navigator.getBattery();
    const send = () => { B.bat = { l: Math.round(b.level * 100), c: b.charging }; broadcast({ t: 'b', ...B.bat, w: awakeOk() }); };
    b.addEventListener('levelchange', send); b.addEventListener('chargingchange', send);
    send(); setInterval(send, 20000);
  }catch(e){}
}

/* ---------- Écran noir et mode économie (pilotables depuis les parents) ---------- */
const sendState = () => broadcast({ t: 'state', eco: B.eco, dark: B.dark });
function setDark(on){
  B.dark = on;
  $('#sleepTxt').textContent = B.eco ? 'Mode économie · je veille toujours 🌙' : 'Je veille toujours 🌙';
  $('#sleep').hidden = !on;
  sendState();
}
function setEco(on, silent){
  B.eco = on; store.set('babyEco', on); $('#bEco').checked = on;
  applyQuality();
  if (!silent || (on && store.get('babyHasParent', false))) setDark(on); else sendState();
  if (!silent) toast(on ? '🔋 Mode économie activé' : 'Mode économie désactivé');
}
/* Économie : image 320×240 à 8 images/s et débit limité, sinon 640×480 à 15 images/s */
function applyQuality(){
  const c = B.eco ? { width: 320, height: 240, frameRate: 8 } : { width: 640, height: 480, frameRate: 15 };
  const rate = B.eco ? 150000 : 600000;
  const tracks = [B.stream && B.stream.getVideoTracks()[0], ...[...B.peers.values()].map(p => p.vt)].filter(Boolean);
  tracks.forEach(tr => tr.applyConstraints({ width: { ideal: c.width }, height: { ideal: c.height }, frameRate: { ideal: c.frameRate, max: c.frameRate } }).catch(() => {}));
  B.peers.forEach(p => p.pc.getSenders().forEach(s => {
    if (!s.track || s.track.kind !== 'video') return;
    try{ const prm = s.getParameters(); if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}]; prm.encodings[0].maxBitrate = rate; s.setParameters(prm).catch(() => {}); }catch(e){}
  }));
}
$('#bEco').onchange = e => setEco(e.target.checked);
$('#sleepBtn').onclick = () => setDark(true);
// Double-toucher pour rallumer (sur le téléphone bébé comme sur le parent)
const wakeScreen = () => { if (B.stream) setDark(false); else $('#sleep').hidden = true; };
$('#sleep').ondblclick = wakeScreen;
let lastTap = 0;
$('#sleep').addEventListener('touchend', e => { const n = Date.now(); if (n - lastTap < 400){ wakeScreen(); e.preventDefault(); } lastTap = n; });
$('#babyStop').onclick = () => location.reload();
