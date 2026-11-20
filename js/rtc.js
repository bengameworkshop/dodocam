/* Connexion directe WebRTC entre téléphones (son, image, et un petit canal de messages). */
"use strict";

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function waitIce(pc, ms = 2500){
  return new Promise(res => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, ms);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete'){ clearTimeout(t); res(); } });
  });
}

/* Garde un seul codec par type : description plus courte, plus fiable entre Android et iPhone */
function preferCodecs(tr, kind){
  try{
    if (!tr.setCodecPreferences || !window.RTCRtpReceiver || !RTCRtpReceiver.getCapabilities) return;
    const caps = RTCRtpReceiver.getCapabilities(kind); if (!caps) return;
    let c = caps.codecs.filter(x => x.mimeType.toLowerCase() === (kind === 'audio' ? 'audio/opus' : 'video/vp8'));
    if (kind === 'video' && !c.length) c = caps.codecs.filter(x => /h264/i.test(x.mimeType)).slice(0, 1);
    if (c.length) tr.setCodecPreferences(c);
  }catch(e){}
}

/* Côté parent : prépare une connexion qui reçoit le son et l'image */
async function makeParentPC(){
  const pc = new RTCPeerConnection(ICE);
  const dc = pc.createDataChannel('ctl');
  preferCodecs(pc.addTransceiver('audio', { direction: 'recvonly' }), 'audio');
  preferCodecs(pc.addTransceiver('video', { direction: 'recvonly' }), 'video');
  await pc.setLocalDescription(await pc.createOffer());
  await waitIce(pc);
  return { pc, dc, offer: pc.localDescription };
}

/* Côté bébé : répond à un parent en lui envoyant les pistes demandées */
async function makeBabyPC(offer, audioTrack, videoTrack){
  const pc = new RTCPeerConnection(ICE);
  await pc.setRemoteDescription(offer);
  for (const t of pc.getTransceivers()){
    const track = t.receiver.track.kind === 'audio' ? audioTrack : videoTrack;
    if (track){ await t.sender.replaceTrack(track); t.direction = 'sendonly'; }
    else t.direction = 'inactive';
  }
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIce(pc);
  return { pc, answer: pc.localDescription };
}

const sendJSON = (dc, o) => { try{ if (dc && dc.readyState === 'open') dc.send(JSON.stringify(o)); }catch(e){} };
