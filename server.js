import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
import { createStore, newId, newToken, hashPin } from './src/store.js';
import {
  DEMO, TIMINGS, LadderError, startTicker, contactLink, lastResponseAt, secondsLeft,
  checkinAck, standDown, disarm, contactAck, resolve,
} from './src/ladder.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PLACEHOLDER_PHONE = '+15555550123';

const store = await createStore();
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));

// ---- Simple in-memory rate limit on POST routes: 60 req/min per IP ----
const hits = new Map();
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const now = Date.now();
  const h = hits.get(req.ip);
  if (!h || now - h.start > 60_000) {
    hits.set(req.ip, { start: now, count: 1 });
    return next();
  }
  if (++h.count > 60) return res.status(429).json({ error: 'Too many requests' });
  next();
});
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, h] of hits) if (h.start < cutoff) hits.delete(ip);
}, 60_000).unref();

// ---- Validation helpers ----
class BadRequest extends LadderError {
  constructor(msg) { super(400, msg); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{24}$/;

function str(v, name, { max = 60, required = true } = {}) {
  if (v == null || v === '') {
    if (required) throw new BadRequest(`${name} is required`);
    return null;
  }
  if (typeof v !== 'string' || v.trim().length > max) throw new BadRequest(`${name} is invalid`);
  return v.trim();
}
function phone(v, name) {
  const p = str(v, name, { max: 20, required: false });
  if (p && !/^\+?[0-9 ()-]{7,20}$/.test(p)) throw new BadRequest(`${name} is invalid`);
  return p ? p.replace(/[ ()-]/g, '') : null;
}
function pinOf(v) {
  const p = String(v ?? '');
  if (!/^\d{4,8}$/.test(p)) throw new BadRequest('PIN must be 4–8 digits');
  return p;
}
function num(v, min, max) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  if (err instanceof LadderError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

async function loadSession(id) {
  if (!UUID.test(id)) throw new LadderError(404, 'Not found');
  const s = await store.getSession(id);
  if (!s) throw new LadderError(404, 'Not found');
  return s;
}
async function loadByToken(token) {
  if (!TOKEN.test(token)) throw new LadderError(404, 'Not found');
  const s = await store.getSessionByToken(token);
  if (!s) throw new LadderError(404, 'Not found');
  return s;
}

async function arm(fields) {
  const now = new Date();
  const s = await store.createSession({
    id: newId(),
    contact_token: newToken(),
    level: 'ARMED',
    level_deadline: null,
    next_checkin_at: new Date(now.getTime() + fields.checkin_every_s * 1000),
    contact_acked: false,
    summary: null,
    armed_at: now,
    resolved_at: null,
    ...fields,
  });
  await store.addEvent({ session_id: s.id, kind: 'level_change', detail: { from: null, to: 'ARMED' } });
  return s;
}

const links = (s) => ({
  id: s.id,
  contactToken: s.contact_token,
  meUrl: `${PUBLIC_URL}/me.html?id=${s.id}`,
  contactUrl: contactLink(s),
});

// ---- API ----

app.get('/api/health', (req, res) => res.json({ app: 'night-out-switch', demo: DEMO, store: store.kind }));

app.post('/api/demo', wrap(async (req, res) => {
  const s = await arm({
    user_name: 'Maya',
    contact_name: 'Jordan',
    contact_phone: PLACEHOLDER_PHONE,
    backup_phone: '+15555550199',
    pin_hash: hashPin('1234'),
    checkin_every_s: 15,
    home_by: null,
  });
  res.json(links(s));
}));

// Links + QR for demo.html. The session id is the capability, same as me.html.
app.get('/api/demo/:id', wrap(async (req, res) => {
  const s = await loadSession(req.params.id);
  const l = links(s);
  res.json({ ...l, qr: await QRCode.toDataURL(l.contactUrl, { margin: 1, width: 480 }) });
}));

app.post('/api/sessions', wrap(async (req, res) => {
  const b = req.body || {};
  const everyMin = num(b.checkin_every_min, 1, 240);
  const homeBy = b.home_by ? new Date(b.home_by) : null;
  if (homeBy && Number.isNaN(homeBy.getTime())) throw new BadRequest('home_by is invalid');
  const s = await arm({
    user_name: str(b.user_name, 'Your name', { max: 40 }),
    contact_name: str(b.contact_name, 'Contact name', { max: 40 }),
    contact_phone: phone(b.contact_phone, 'Contact phone'),
    backup_phone: phone(b.backup_phone, 'Backup phone'),
    pin_hash: hashPin(pinOf(b.pin)),
    checkin_every_s: everyMin ? Math.round(everyMin * 60) : TIMINGS.interval,
    home_by: homeBy,
  });
  res.json(links(s));
}));

app.get('/api/sessions/:id', wrap(async (req, res) => {
  const s = await loadSession(req.params.id);
  res.json({
    level: s.level,
    seconds_left: secondsLeft(s),
    contact_acked: s.contact_acked,
    user_name: s.user_name,
    contact_name: s.contact_name,
    checkin_every_s: s.checkin_every_s,
    demo: DEMO,
  });
}));

app.post('/api/sessions/:id/heartbeat', wrap(async (req, res) => {
  const s = await loadSession(req.params.id);
  if (s.level === 'RESOLVED') return res.json({ ok: true });
  const b = req.body || {};
  let lat = num(b.lat, -90, 90);
  let lng = num(b.lng, -180, 180);
  if (lat == null || lng == null) lat = lng = null;
  await store.addEvent({ session_id: s.id, kind: 'heartbeat', lat, lng, battery: num(b.battery, 0, 1) });
  res.json({ ok: true });
}));

app.post('/api/sessions/:id/checkin-ack', wrap(async (req, res) => {
  const s = await checkinAck(store, await loadSession(req.params.id));
  res.json({ level: s.level });
}));

app.post('/api/sessions/:id/stand-down', wrap(async (req, res) => {
  const s = await standDown(store, await loadSession(req.params.id), pinOf(req.body?.pin));
  res.json({ level: s.level });
}));

app.post('/api/sessions/:id/disarm', wrap(async (req, res) => {
  const s = await disarm(store, await loadSession(req.params.id), pinOf(req.body?.pin));
  res.json({ level: s.level });
}));

app.get('/api/contact/:token', wrap(async (req, res) => {
  const s = await loadByToken(req.params.token);
  const alerting = s.level === 'CONTACT' || s.level === 'WIDER';
  const now = new Date();
  const lastResp = await lastResponseAt(store, s);
  const standDownEvt = await store.lastEvent(s.id, ['stand_down']);
  const out = {
    user_name: s.user_name,
    contact_name: s.contact_name,
    user_phone: PLACEHOLDER_PHONE,
    level: s.level,
    contact_acked: s.contact_acked,
    minutes_since_response: Math.max(0, Math.floor((now - lastResp) / 60000)),
    seconds_since_response: Math.max(0, Math.floor((now - lastResp) / 1000)),
    // Green "says they're OK" only if the contact was alerted at some point and the person stood down.
    stood_down: !alerting && !!s.summary && !!standDownEvt,
    summary: null,
    last_heartbeat: null,
  };
  // Location and the summary are only shared once the person has stopped responding.
  if (alerting) {
    out.summary = s.summary;
    const beat = await store.lastEvent(s.id, ['heartbeat']);
    if (beat) {
      out.last_heartbeat = {
        lat: beat.lat, lng: beat.lng, battery: beat.battery, time: beat.time,
      };
    }
  }
  res.json(out);
}));

app.post('/api/contact/:token/ack', wrap(async (req, res) => {
  const s = await contactAck(store, await loadByToken(req.params.token));
  res.json({ level: s.level, contact_acked: s.contact_acked });
}));

app.post('/api/contact/:token/resolve', wrap(async (req, res) => {
  const s = await resolve(store, await loadByToken(req.params.token), 'contact');
  res.json({ level: s.level });
}));

startTicker(store);
app.listen(PORT, () => {
  console.log(`Night Out Switch on ${PUBLIC_URL} (store: ${store.kind}, demo: ${DEMO ? 'on' : 'off'})`);
});
