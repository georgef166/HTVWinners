// Plain-language summary for the trusted contact. Gemini when configured, template otherwise.
import { GoogleGenAI } from '@google/genai';

const INSTRUCTION = `Write 2–3 short factual sentences for a trusted friend about this person's night, using ONLY the events given: when they armed it, the last time they responded, how long since, the last known location time, and battery. Then one line starting "Suggested next step:" (call them; if no answer and you are nearby, go to the last location; if you believe they are in danger, call 911). Never guess at causes, substances, intoxication or intent. Never say "drugged" or "drunk". Say "hasn't responded".`;

const TIMEOUT_MS = 3000;

const fmtTime = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const minutesBetween = (a, b) => Math.max(0, Math.floor((b - a) / 60000));

function facts(session, events, now) {
  const responses = events.filter((e) => e.kind === 'checkin_ack' || e.kind === 'stand_down');
  const lastResponse = responses.length ? new Date(responses.at(-1).time) : new Date(session.armed_at);
  const beats = events.filter((e) => e.kind === 'heartbeat');
  const lastBeat = beats.at(-1);
  const lastLoc = [...beats].reverse().find((e) => e.lat != null && e.lng != null);
  return {
    name: session.user_name,
    armedAt: new Date(session.armed_at),
    lastResponse,
    minutesSince: minutesBetween(lastResponse, now),
    lastLocationAt: lastLoc ? new Date(lastLoc.time) : null,
    battery: lastBeat && lastBeat.battery != null ? Math.round(lastBeat.battery * 100) : null,
  };
}

export function templateSummary(session, events, now = new Date()) {
  const f = facts(session, events, now);
  const mins = f.minutesSince < 1 ? 'under a minute' : f.minutesSince === 1 ? '1 minute' : `${f.minutesSince} minutes`;
  const parts = [
    `${f.name} armed Night Out Switch at ${fmtTime(f.armedAt)} and last responded at ${fmtTime(f.lastResponse)}; ${f.name} hasn't responded for ${mins}.`,
    f.lastLocationAt
      ? `The last known location was recorded at ${fmtTime(f.lastLocationAt)}${f.battery != null ? ` with battery at ${f.battery}%` : ''}.`
      : `No location has been shared${f.battery != null ? `; battery was last at ${f.battery}%` : ''}.`,
    `Suggested next step: call ${f.name}; if there is no answer and you are nearby, go to the last location; if you believe ${f.name} is in danger, call 911.`,
  ];
  return parts.join(' ');
}

function compactEvents(session, events) {
  return {
    person: session.user_name,
    armed_at: session.armed_at,
    now: new Date().toISOString(),
    events: events.map((e) => ({
      t: new Date(e.time).toISOString(),
      kind: e.kind,
      ...(e.lat != null ? { lat: +Number(e.lat).toFixed(4), lng: +Number(e.lng).toFixed(4) } : {}),
      ...(e.battery != null ? { battery: e.battery } : {}),
      ...(e.detail ? { detail: e.detail } : {}),
    })),
  };
}

export async function summarize(session, events, now = new Date()) {
  const fallback = () => templateSummary(session, events, now);
  if (!process.env.GEMINI_API_KEY) return fallback();
  let timer;
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const call = ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: `${INSTRUCTION}\n\nEvents (JSON):\n${JSON.stringify(compactEvents(session, events))}`,
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Gemini timeout')), TIMEOUT_MS);
    });
    const res = await Promise.race([call, timeout]);
    const text = (res.text || '').trim();
    if (!text) throw new Error('Empty Gemini response');
    return text;
  } catch (err) {
    console.warn('[summary] falling back to template:', err.message);
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}
