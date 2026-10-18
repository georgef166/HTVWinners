// Live listening on stage. Maya's phone streams its mic over a WebSocket; we relay the audio to the Kaldi
// recognizer (Vosk) on this server and look for distress phrases in the words as they arrive, usually before
// the sentence is even finished. Nothing is stored: audio is relayed and dropped, words go to the stage only.
import { WebSocketServer, WebSocket } from 'ws';
import { spotCues, dangerOf } from './distress.js';
import { flash, note } from './pipeline.js';

const MAX_STREAMS = 6;  // Kaldi shares the CPU with Whisper and Llama
const MODEL = 'vosk-small-en';
let streams = 0;
const dbOf = (pcm) => {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2;
  return 20 * Math.log10(Math.sqrt(sum / (pcm.length || 1)) + 1e-9);
};

export function attachListening(server, { loadSession, recordDistress, enabled }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const m = /^\/api\/sessions\/([\w-]+)\/stream$/.exec(new URL(req.url, 'http://local').pathname);
    if (!m || !enabled || !process.env.VOSK_URL || wss.clients.size >= MAX_STREAMS) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (phone) => stream(phone, m[1]).catch(() => phone.close()));
  });

  async function stream(phone, id) {
    let s = await loadSession(id);
    const src = ++streams;
    const asr = new WebSocket(process.env.VOSK_URL);
    const sentAt = [];  // Vosk answers every chunk in order, so this gives its delay behind live audio
    // The phone only streams while someone talks, so it also reports the room's usual level for "was it shouted?".
    let lag = 0, room = null, baseline = null, peak = -120, partial = '', fired = false, alertedNow = false;

    const close = () => { try { asr.readyState === WebSocket.OPEN && asr.send('{"eof": 1}'); asr.close(); } catch {} try { phone.close(); } catch {} };
    phone.on('close', close);
    asr.on('error', close);
    asr.on('close', close);

    phone.on('message', (data, isBinary) => {
      if (!isBinary) { try { const r = JSON.parse(data).room; if (Number.isFinite(r)) room = r; } catch {} return; }
      if (asr.readyState !== WebSocket.OPEN) return;
      const buf = Buffer.from(data);
      const pcm = new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1);
      const db = dbOf(pcm);
      if (db > -100) {  // skip the padding of pure silence
        if (baseline == null) baseline = db;
        if (db < baseline + 8) baseline = baseline * 0.98 + db * 0.02;
      }
      peak = Math.max(peak, db);
      sentAt.push(Date.now());
      asr.send(buf);
    });

    asr.on('message', async (raw) => {
      const t = sentAt.shift();
      if (t) lag = Math.round(lag ? lag * 0.8 + (Date.now() - t) * 0.2 : Date.now() - t);
      let r;
      try { r = JSON.parse(raw); } catch { return; }
      const final = r.text !== undefined;
      const text = (final ? r.text : r.partial || '').trim();
      if (!final && (text === partial || !text)) return;
      partial = final ? '' : text;

      const heard = spotCues(text, { final });
      const danger = dangerOf(heard.spoken);
      const loud = peak - (room ?? baseline ?? peak) >= 10 || peak > -15;
      let alerted = alertedNow;
      if (danger && loud && !fired) {
        fired = true;
        s = await loadSession(id);
        ({ alerted } = await recordDistress(s, {
          score: Math.min(1, 0.3 + heard.score), cues: ['a sudden loud noise or shouting', ...heard.cues],
          spoken: heard.spoken, danger, transcribed: true,
        }, { live: true }));
        alertedNow = alerted;
      }
      const entry = { kind: 'words', src, text, final, spoken: heard.spoken, danger, loud, alerted, lag, model: MODEL };
      if (final) {
        // Kaldi scores each word; a line it isn't sure of is usually room noise, so it's dropped (unless it mattered).
        const words = r.result || [];
        const conf = words.length ? words.reduce((n, w) => n + w.conf, 0) / words.length : 0;
        if (text && (conf >= 0.6 || danger)) note(id, entry);
        else flash(id, { ...entry, text: '', dropped: true });
        fired = false; alertedNow = false; peak = -120;
      } else {
        flash(id, entry);
      }
    });
  }
}
