/* QR codes : affichage, scan, et compression des descriptions de connexion (SDP). */
"use strict";

async function streamBytes(u8, t){ return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(t)).arrayBuffer()); }

/* Description de connexion -> texte court "PV1..." */
async function packSDP(desc){
  const sdp = desc.sdp.split('\r\n').filter(l => !(l.startsWith('a=candidate') && / tcp /i.test(l))).join('\r\n');
  const raw = new TextEncoder().encode(sdp);
  const kind = desc.type === 'offer' ? 'O' : 'A';
  if ('CompressionStream' in window){
    try{ return 'PV1' + kind + 'Z' + b64u(await streamBytes(raw, new CompressionStream('deflate'))); }catch(e){}
  }
  return 'PV1' + kind + 'R' + b64u(raw);
}
async function unpackSDP(str){
  str = (str || '').trim().replace(/\s+/g, '');
  if (!str.startsWith('PV1') || str.length < 10) throw new Error('code invalide');
  const kind = str[3], comp = str[4];
  let bytes = unb64u(str.slice(5));
  if (comp === 'Z') bytes = await streamBytes(bytes, new DecompressionStream('deflate'));
  return { type: kind === 'O' ? 'offer' : 'answer', sdp: new TextDecoder().decode(bytes) };
}

function renderQR(el, text){
  el.innerHTML = '';
  try{
    const q = qrcode(0, 'L'); q.addData(text, 'Byte'); q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }catch(e){
    el.innerHTML = '<p style="color:#555;text-align:center">Code trop long pour un QR. Utilise « Copier le code ».</p>';
  }
}

/* Scanner : renvoie le texte d'un QR qui commence par un des préfixes acceptés */
let scanStream = null, scanTimer = null, scanRes = null, scanRej = null, scanPrefixes = [];
function scanCode(prefixes){
  scanPrefixes = prefixes;
  return new Promise(async (res, rej) => {
    scanRes = res; scanRej = rej;
    $('#scanner').hidden = false; $('#pasteArea').value = ''; $('#pasteBox').open = false;
    $('#scanHint').textContent = "Vise le QR code affiché sur l'autre téléphone";
    try{
      scanStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      const v = $('#scanVideo'); v.srcObject = scanStream; await v.play();
      let det = null;
      if ('BarcodeDetector' in window){ try{ const f = await BarcodeDetector.getSupportedFormats(); if (f.includes('qr_code')) det = new BarcodeDetector({ formats: ['qr_code'] }); }catch(e){} }
      const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
      const tick = async () => {
        if (!scanStream) return;
        let txt = null;
        try{
          if (v.readyState >= 2 && v.videoWidth){
            if (det){ const r = await det.detect(v); if (r.length) txt = r[0].rawValue; }
            if (!txt && (!det || Math.random() < .3)){
              const s = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
              cv.width = v.videoWidth * s | 0; cv.height = v.videoHeight * s | 0;
              cx.drawImage(v, 0, 0, cv.width, cv.height);
              const d = cx.getImageData(0, 0, cv.width, cv.height);
              const r = jsQR(d.data, cv.width, cv.height, { inversionAttempts: 'dontInvert' });
              if (r) txt = r.data;
            }
          }
        }catch(e){}
        if (txt && scanPrefixes.some(p => txt.startsWith(p))) return endScan(txt);
        scanTimer = setTimeout(tick, 120);
      };
      tick();
    }catch(e){
      $('#scanHint').textContent = 'Caméra indisponible. Colle le code reçu ci-dessous.';
      $('#pasteBox').open = true;
    }
  });
}
function stopScan(){ clearTimeout(scanTimer); if (scanStream){ scanStream.getTracks().forEach(t => t.stop()); scanStream = null; } $('#scanner').hidden = true; }
function endScan(t){ stopScan(); if (navigator.vibrate) navigator.vibrate(60); scanRes && scanRes(t); }
$('#scanCancel').onclick = () => { stopScan(); scanRej && scanRej(new Error('cancel')); };
$('#pasteOk').onclick = () => {
  const v = $('#pasteArea').value.trim().replace(/\s+/g, '');
  if (scanPrefixes.some(p => v.startsWith(p))) endScan(v); else $('#scanHint').textContent = "Ce code n'est pas le bon. Vérifie que tu scannes l'autre téléphone.";
};
