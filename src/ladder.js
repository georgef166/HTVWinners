// Escalation ladder: ARMED → NUDGE → ALARM → CONTACT → WIDER, plus RESOLVED.
// The timer lives here on the server, so the ladder climbs even if the phone goes silent.
import { hashPin } from './store.js';
import { summarize, templateSummary } from './summary.js';
import { sendSms } from './notify.js';
import { assess } from './predict.js';

// Demo timings unless DEMO=0, so an empty .env still gives a seconds-long demo.
export const DEMO = process.env.DEMO !== '0';

export const TIMINGS = DEMO
  ? { interval: 10, nudge: 10, alarm: 10, contact: 15 } // each phase holds long enough to read; Jordan is alerted at about 30 s
  : { interval: 20 * 60, nudge: 2 * 60, alarm: 60, contact: 5 * 60 };

const ALERTING = ['ALARM', 'CONTACT', 'WIDER'];
const RESPONSE_KINDS = ['checkin_ack', 'stand_down'];

const at = (now, s) => new Date(now.getTime() + s * 1000);
const publicUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
export const contactLink = (s) => `${publicUrl()}/contact.html?t=${s.contact_token}`;

export class LadderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function setLevel(store, s, level, now, extra = {}) {
  const deadlines = { NUDGE: TIMINGS.nudge, ALARM: TIMINGS.alarm, CONTACT: TIMINGS.contact };
  const patch = {
    level,
    level_deadline: deadlines[level] ? at(now, deadlines[level]) : null,
    ...extra,
  };
  const updated = await store.updateSession(s.id, patch);
  await store.addEvent({ session_id: s.id, kind: 'level_change', detail: { from: s.level, to: level } });
  return updated;
}

// Time of the last thing the person actively did (armed, acked, stood down).
export async function lastResponseAt(store, s) {
  const e = await store.lastEvent(s.id, RESPONSE_KINDS);
  return e ? new Date(e.time) : new Date(s.armed_at);
}

async function stepSession(store, s, now) {
  const past = (t) => t && now > new Date(t);
  switch (s.level) {
    case 'ARMED': {
      const homeByPassed = past(s.home_by);
      if (past(s.next_checkin_at) || homeByPassed) {
        await store.addEvent({ session_id: s.id, kind: 'checkin_sent', detail: { reason: homeByPassed ? 'home_by' : 'interval' } });
        // home_by fires once; after that, regular check-ins continue.
        await setLevel(store, s, 'NUDGE', now, homeByPassed ? { home_by: null } : {});
      }
      break;
    }
    case 'NUDGE':
      if (past(s.level_deadline)) await setLevel(store, s, 'ALARM', now);
      break;
    case 'ALARM':
      if (past(s.level_deadline)) {
        // The alert never waits for AI: send it now with the factual summary,
        // then let the model's version replace it when it's ready.
        const events = await store.listEvents(s.id);
        const summary = templateSummary(s, events, now);
        await store.addEvent({ session_id: s.id, kind: 'summary', detail: { source: 'template' } });
        await setLevel(store, s, 'CONTACT', now, { summary });
        await sendSms(
          s.contact_phone,
          `tenshi: ${s.user_name} hasn't responded to check-ins. ${summary}\nDetails: ${contactLink(s)}`,
        );
        upgradeSummary(store, s, events, now);
      }
      break;
    case 'CONTACT':
      if (past(s.level_deadline) && !s.contact_acked) {
        await setLevel(store, s, 'WIDER', now);
        await sendSms(
          s.backup_phone,
          `tenshi: ${s.user_name} hasn't responded and ${s.contact_name} hasn't confirmed they're on it. Details: ${contactLink(s)}`,
        );
      }
      break;
  }
}

// Background: ask the model for a better-written summary and swap it in if it answers.
function upgradeSummary(store, s, events, now) {
  summarize(s, events, now)
    .then(async ({ text, source }) => {
      if (source === 'template') return;
      await store.updateSession(s.id, { summary: text });
      await store.addEvent({ session_id: s.id, kind: 'summary', detail: { source } });
    })
    .catch((err) => console.warn('[ladder] summary upgrade failed:', err.message));
}

let ticking = false;
export async function tick(store, now = new Date()) {
  if (ticking) return; // a slow summary call shouldn't stack ticks
  ticking = true;
  try {
    for (const s of await store.listActiveSessions()) {
      try {
        await stepSession(store, s, now);
      } catch (err) {
        console.error(`[ladder] session ${s.id}:`, err.message);
      }
    }
  } finally {
    ticking = false;
  }
}

export function startTicker(store) {
  const every = DEMO ? 2000 : 5000;
  return setInterval(() => tick(store), every);
}

// ---- Actions ----

function requireActive(s) {
  if (s.level === 'RESOLVED') throw new LadderError(409, 'Session is resolved');
}

function checkPin(s, pin) {
  if (hashPin(pin) !== s.pin_hash) throw new LadderError(403, 'Wrong PIN');
}

// The prediction engine sets the pace of the next check-in.
async function nextIntervalS(store, s, now) {
  return assess(s, await store.listEvents(s.id), now).nextIntervalS;
}

// Something sounded wrong: send a check-in now instead of waiting for the timer.
// It doesn't alert anyone by itself; if she doesn't answer, the normal ladder takes over.
export async function promptCheckin(store, s, reason, now = new Date()) {
  if (s.level !== 'ARMED') return s;
  await store.addEvent({ session_id: s.id, kind: 'checkin_sent', detail: { reason } });
  return setLevel(store, s, 'NUDGE', now);
}

export async function checkinAck(store, s, now = new Date()) {
  requireActive(s);
  if (ALERTING.includes(s.level)) throw new LadderError(409, 'PIN required to stand down');
  await store.addEvent({ session_id: s.id, kind: 'checkin_ack' });
  const next = at(now, await nextIntervalS(store, s, now));
  if (s.level === 'NUDGE') return setLevel(store, s, 'ARMED', now, { next_checkin_at: next });
  return store.updateSession(s.id, { next_checkin_at: next });
}

export async function standDown(store, s, pin, now = new Date()) {
  requireActive(s);
  checkPin(s, pin);
  await store.addEvent({ session_id: s.id, kind: 'stand_down', detail: { from: s.level } });
  const extra = { next_checkin_at: at(now, await nextIntervalS(store, s, now)), contact_acked: false };
  if (s.level === 'ARMED') return store.updateSession(s.id, extra);
  return setLevel(store, s, 'ARMED', now, extra);
}

export async function disarm(store, s, pin, now = new Date()) {
  requireActive(s);
  checkPin(s, pin);
  return resolve(store, s, 'user_disarm', now);
}

export async function contactAck(store, s) {
  requireActive(s);
  await store.addEvent({ session_id: s.id, kind: 'contact_ack' });
  return store.updateSession(s.id, { contact_acked: true });
}

export async function resolve(store, s, by, now = new Date()) {
  requireActive(s);
  await store.addEvent({ session_id: s.id, kind: 'resolved', detail: { by } });
  return setLevel(store, s, 'RESOLVED', now, { resolved_at: now });
}

export function secondsLeft(s, now = new Date()) {
  const t = s.level === 'ARMED' ? s.next_checkin_at : s.level_deadline;
  if (!t) return null;
  return Math.max(0, Math.round((new Date(t) - now) / 1000));
}
