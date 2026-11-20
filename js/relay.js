/* Relais de mise en relation via ntfy.sh (gratuit, sans compte).
   Il ne transporte que la "poignée de main" de connexion, chiffrée avec la clé partagée
   au moment du scan (AES-GCM). L'image et le son ne passent jamais par là. */
"use strict";

const RELAY_URL = new URLSearchParams(location.search).get('relay') || 'https://ntfy.sh';

class Relay {
  constructor(keyB64, myId){
    this.keyB64 = keyB64; this.myId = myId;
    this.onMessage = () => {}; this.onOpen = () => {};
    this.es = null; this.watch = null; this.closed = false;
  }
  async open(){
    this.key = await crypto.subtle.importKey('raw', unb64u(this.keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dodocam:' + this.keyB64)));
    this.topic = 'dodocam_' + [...h.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
    this.connect();
    // Si la connexion au relais est fermée pour de bon, on la rouvre.
    this.watch = setInterval(() => { if (!this.closed && (!this.es || this.es.readyState === 2)) this.connect(); }, 8000);
  }
  connect(){
    if (this.es) try{ this.es.close(); }catch(e){}
    const es = this.es = new EventSource(`${RELAY_URL}/${this.topic}/sse`);
    es.onopen = () => this.onOpen();
    es.onmessage = async e => {
      let d; try{ d = JSON.parse(e.data); }catch(_){ return; }
      if (d.event && d.event !== 'message') return;
      try{
        const m = await this.decrypt(d.message);
        if (m.from === this.myId) return;
        if (m.to && m.to !== this.myId) return;
        if (Math.abs(Date.now() - m.ts) > 10 * 60000) return; // message trop vieux
        this.onMessage(m);
      }catch(_){ /* pas pour nous, ou illisible */ }
    };
  }
  get ready(){ return !!this.es && this.es.readyState === 1; }
  async send(obj){
    obj.from = this.myId; obj.ts = Date.now();
    const body = await this.encrypt(obj);
    const r = await fetch(`${RELAY_URL}/${this.topic}?cache=no&firebase=no`, { method: 'POST', body });
    if (!r.ok) throw new Error('relais ' + r.status);
  }
  async encrypt(obj){
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, new TextEncoder().encode(JSON.stringify(obj))));
    return 'E1.' + b64u(iv) + '.' + b64u(ct);
  }
  async decrypt(txt){
    const [v, iv, ct] = String(txt).split('.');
    if (v !== 'E1') throw new Error('format');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, this.key, unb64u(ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  close(){ this.closed = true; clearInterval(this.watch); if (this.es) try{ this.es.close(); }catch(e){} }
}

/* Code d'appairage affiché par le téléphone bébé : "DC1" + clé secrète */
const pairCode = key => 'DC1' + key;
const pairKeyFrom = code => { const k = code.trim().slice(3); if (!code.startsWith('DC1') || unb64u(k).length !== 32) throw new Error("code d'appairage invalide"); return k; };
