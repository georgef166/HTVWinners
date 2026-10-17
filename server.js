import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
import { createStore, newId, newToken, hashPin } from './src/store.js';
import { assess } from './src/predict.js';
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
  if (req.method !== 'POST' || req.path.startsWith('/api/switch/')) return next();
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
  sw.sessionId = s.id; // the Switch follows the most recently armed night
  return s;
}

const links = (s) => ({
  id: s.id,
  contactToken: s.contact_token,
  meUrl: `${PUBLIC_URL}/me.html?id=${s.id}`,
  contactUrl: contactLink(s),
});

// ---- API ----

app.get('/api/health', (req, res) => res.json({
  app: 'night-out-switch', demo: DEMO, store: store.kind, timescale: !!store.timescale,
  model: process.env.LLM_BASE_URL ? 'self-hosted' : process.env.GEMINI_API_KEY ? 'gemini' : 'template',
}));

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
  res.json({ ...l, qr: await QRCode.toDataURL(l.contactUrl, { margin: 1, width: 480 }), switch: switchInfo(s), cold: sw.coldDemo });
}));

// Demo only: make Maya's battery drain fast so the battery forecast can be shown live.
const batteryDrains = new Map();
app.post('/api/demo/:id/drain-battery', wrap(async (req, res) => {
  if (!DEMO) throw new LadderError(404, 'Not found');
  const s = await loadSession(req.params.id);
  batteryDrains.set(s.id, { start: 0.32, perMin: 0.1, at: Date.now() }); // 32%, losing 10 points a minute
  res.json({ ok: true });
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
  const outlook = assess(s, await store.listEvents(s.id));
  const sinceResponse = await lastResponseAt(store, s);
  res.json({
    level: s.level,
    seconds_left: secondsLeft(s),
    contact_acked: s.contact_acked,
    user_name: s.user_name,
    contact_name: s.contact_name,
    checkin_every_s: s.checkin_every_s,
    // Length of the current window, so the phone can draw a draining ring.
    window_s: s.level === 'ARMED' ? Math.max(1, Math.round((new Date(s.next_checkin_at) - sinceResponse) / 1000)) : ({ NUDGE: TIMINGS.nudge, ALARM: TIMINGS.alarm, CONTACT: TIMINGS.contact })[s.level] ?? null,
    demo: DEMO,
    switch: switchInfo(s),
    outlook: {
      level: outlook.level,
      signals: outlook.signals.filter((x) => x.key !== 'phone_offline').map((x) => ({ key: x.key, text: x.you })),
      interval_s: outlook.nextIntervalS,
      reason: outlook.intervalReason,
      battery_dies_at: outlook.battery.diesAt,
    },
  });
}));

// The signal trace: her night as a time series (responses, phone heartbeats, level changes).
// No location in here, just timing.
const TRACE_WINDOW_S = DEMO ? 120 : 45 * 60;
const TRACE_KINDS = ['heartbeat', 'checkin_sent', 'checkin_ack', 'level_change', 'contact_ack', 'stand_down', 'resolved', 'device'];
async function traceFor(s) {
  const now = new Date();
  const since = now.getTime() - TRACE_WINDOW_S * 1000;
  const all = await store.listEvents(s.id);
  let levelAtStart = null;
  const events = [];
  for (const e of all) {
    const t = new Date(e.time).getTime();
    if (t < since) {
      if (e.kind === 'level_change') levelAtStart = e.detail?.to ?? levelAtStart;
      continue;
    }
    if (!TRACE_KINDS.includes(e.kind) || (e.kind === 'device' && e.detail?.type === 'reading')) continue;
    events.push({ t: new Date(t).toISOString(), kind: e.kind, detail: e.detail?.from || e.detail?.to || e.detail?.type ? { from: e.detail.from, to: e.detail.to, type: e.detail.type } : null });
  }
  // Over a real night (45 min), phone heartbeats come from the per-minute continuous aggregate
  // instead of every raw row. The demo's 2-minute window keeps raw heartbeats.
  if (!DEMO) {
    const beats = await store.heartbeatBuckets(s.id, new Date(since));
    for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === 'heartbeat') events.splice(i, 1);
    for (const b of beats) events.push({ t: new Date(b.time).toISOString(), kind: 'heartbeat', detail: { beats: Number(b.beats) } });
    events.sort((a, b) => a.t.localeCompare(b.t));
  }
  return {
    now: now.toISOString(), window_s: TRACE_WINDOW_S, level: s.level, level_at_start: levelAtStart,
    user_name: s.user_name, contact_name: s.contact_name, events,
  };
}

app.get('/api/sessions/:id/trace', wrap(async (req, res) => {
  res.json(await traceFor(await loadSession(req.params.id)));
}));

app.post('/api/sessions/:id/heartbeat', wrap(async (req, res) => {
  const s = await loadSession(req.params.id);
  if (s.level === 'RESOLVED') return res.json({ ok: true });
  const b = req.body || {};
  let lat = num(b.lat, -90, 90);
  let lng = num(b.lng, -180, 180);
  if (lat == null || lng == null) lat = lng = null;
  let battery = num(b.battery, 0, 1);
  // Demo only: a simulated fast battery drain replaces the real reading.
  const drain = DEMO && batteryDrains.get(s.id);
  if (drain) battery = Math.max(0.02, drain.start - ((Date.now() - drain.at) / 60000) * drain.perMin);
  await store.addEvent({ session_id: s.id, kind: 'heartbeat', lat, lng, battery });
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
    // Countdown until the backup contact is alerted, so the contact knows to confirm.
    seconds_to_wider: s.level === 'CONTACT' && !s.contact_acked && s.backup_phone ? secondsLeft(s, now) : null,
    summary: null,
    last_heartbeat: null,
  };
  // Location, summary and phone status are only shared once the person has stopped responding.
  if (alerting) {
    out.summary = s.summary;
    const outlook = assess(s, await store.listEvents(s.id), now);
    out.outlook = {
      level: outlook.level,
      signals: outlook.signals.map((x) => ({ key: x.key, text: x.them })),
      phone_reporting: outlook.phone.lastSeenAt ? !outlook.phone.offline : null,
      phone_last_seen: outlook.phone.lastSeenAt,
    };
    out.trace = await traceFor(s);
    const summaryEvt = await store.lastEvent(s.id, ['summary']);
    out.summary_source = summaryEvt?.detail?.source || 'template';
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

// ---- Hardware Switch (Arduino Uno R4 WiFi) ----
// One Switch per server, authenticated with SWITCH_KEY. It follows the most recently armed session.
const SWITCH_KEY = process.env.SWITCH_KEY || (DEMO ? 'demo-switch' : null);
const HOME_TAGS = (process.env.SWITCH_HOME_TAG || '').split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
const sw = { sessionId: null, lastSeen: 0, tempC: null, pressureHpa: null, coldDemo: false };
const switchConnected = () => Date.now() - sw.lastSeen < 10_000;
const switchInfo = (s) => (sw.sessionId === s.id
  ? { linked: true, connected: switchConnected(), temp_c: sw.tempC }
  : { linked: false, connected: false, temp_c: null });

function requireSwitch(req) {
  if (!SWITCH_KEY) throw new LadderError(404, 'Not found');
  if (req.get('X-Switch-Key') !== SWITCH_KEY) throw new LadderError(401, 'Bad switch key');
  sw.lastSeen = Date.now();
}
async function switchSession() {
  const s = sw.sessionId && (await store.getSession(sw.sessionId));
  return s && s.level !== 'RESOLVED' ? s : null;
}

// Plain text so the Arduino can parse it without a JSON library:
// L=level;S=seconds left;W=window;A=contact acked;O=outlook;C=contact name
app.get('/api/switch/state', wrap(async (req, res) => {
  requireSwitch(req);
  res.type('text/plain');
  const s = await switchSession();
  if (!s) return res.send('L=NONE\n');
  const outlook = assess(s, await store.listEvents(s.id));
  const since = await lastResponseAt(store, s);
  const window = s.level === 'ARMED'
    ? Math.max(1, Math.round((new Date(s.next_checkin_at) - since) / 1000))
    : ({ NUDGE: TIMINGS.nudge, ALARM: TIMINGS.alarm, CONTACT: TIMINGS.contact })[s.level] ?? 0;
  res.send(`L=${s.level};S=${secondsLeft(s) ?? 0};W=${window};A=${s.contact_acked ? 1 : 0};O=${outlook.level};C=${s.contact_name.replace(/[;=\n]/g, '')}\n`);
}));

app.post('/api/switch/event', wrap(async (req, res) => {
  requireSwitch(req);
  res.type('text/plain');
  const b = req.body || {};
  const s = await switchSession();
  if (!s) return res.status(409).send('ERR;NOSESSION\n');
  const log = (detail) => store.addEvent({ session_id: s.id, kind: 'device', detail });

  switch (b.type) {
    case 'touch': {
      // A touch is the check-in. Once the alarm is going, it takes the joystick code.
      if (['ALARM', 'CONTACT', 'WIDER'].includes(s.level)) return res.status(409).send('ERR;NEEDCODE\n');
      await log({ type: 'touch' });
      const out = await checkinAck(store, s);
      return res.send(`OK;L=${out.level}\n`);
    }
    case 'code': {
      // Joystick directions map to digits: up=1, right=2, down=3, left=4.
      const code = String(b.code ?? '');
      if (!/^[1-4]{4,8}$/.test(code)) throw new BadRequest('Code must be 4–8 joystick moves');
      await log({ type: 'code' });
      try {
        const out = await standDown(store, s, code);
        return res.send(`OK;L=${out.level}\n`);
      } catch (err) {
        if (err.status === 403) return res.status(403).send('ERR;WRONGCODE\n');
        throw err;
      }
    }
    case 'nfc': {
      // Tapping the home tag by the front door ends the night, no PIN needed.
      const tag = String(b.tag ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
      if (!tag) throw new BadRequest('tag is required');
      const isHome = HOME_TAGS.length ? HOME_TAGS.includes(tag) : DEMO;
      await log({ type: 'nfc', tag, home: isHome });
      if (!isHome) return res.status(403).send('ERR;UNKNOWNTAG\n');
      await resolve(store, s, 'home_tag');
      return res.send('OK;L=RESOLVED\n');
    }
    case 'reading': {
      let tempC = num(b.temp_c, -40, 85);
      const pressureHpa = num(b.pressure_hpa, 300, 1100);
      if (DEMO && sw.coldDemo) tempC = -2; // demo: pretend it's freezing outside
      sw.tempC = tempC;
      sw.pressureHpa = pressureHpa;
      await log({ type: 'reading', temp_c: tempC, pressure_hpa: pressureHpa });
      return res.send('OK\n');
    }
    default:
      throw new BadRequest('Unknown event type');
  }
}));

// Demo only: pretend the Switch is reading freezing temperatures.
app.post('/api/demo/:id/cold', wrap(async (req, res) => {
  if (!DEMO) throw new LadderError(404, 'Not found');
  await loadSession(req.params.id);
  sw.coldDemo = !sw.coldDemo;
  res.json({ cold: sw.coldDemo });
}));

startTicker(store);
app.listen(PORT, () => {
  console.log(`Night Out Switch on ${PUBLIC_URL} (store: ${store.kind}, demo: ${DEMO ? 'on' : 'off'})`);
});
