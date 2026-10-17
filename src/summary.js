// Plain-language summary for the trusted contact. Gemini when configured, template otherwise.
import { GoogleGenAI } from '@google/genai';
import { assess } from './predict.js';

const INSTRUCTION = `Write 2–3 short factual sentences for a trusted friend about this person's night, using ONLY the facts below: when they turned on Night Out Switch, the last time they responded, how long since, the phone's status and battery, and whether a location is on the map. Then one line starting "Suggested next step:" (call them; if no answer and you are nearby, go to the last location; if you believe they are in danger, call 911). Never guess at causes, substances, intoxication or intent. Never say "drugged" or "drunk". Say "hasn't responded". Do not add facts that are not listed. Do not include coordinates. Never say "armed". Reply with only the sentences, no introduction.`;

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 3000;

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
    outlook: assess(session, events, now),
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
    f.outlook.phone.offline
      ? `The phone stopped reporting at ${fmtTime(f.outlook.phone.lastSeenAt)}${f.battery != null && f.battery <= 10 ? `, with ${f.battery}% battery, so it may have run out of power` : ''}.`
      : f.outlook.phone.lastSeenAt ? 'The phone is still reporting, so it has power and signal.' : '',
    `Suggested next step: call ${f.name}; if there is no answer and you are nearby, go to the last location; if you believe ${f.name} is in danger, call 911.`,
  ];
  return parts.filter(Boolean).join(' ');
}

// Small models invent things when handed raw events, so give them facts that are already true,
// in local time and plain words.
function factsForModel(session, events, now) {
  const f = facts(session, events, now);
  const o = f.outlook;
  const mins = (d) => Math.max(0, Math.floor((now - d) / 60000));
  const located = [...events].reverse().find((e) => e.kind === 'heartbeat' && e.lat != null);
  const lines = [
    `Person: ${f.name}`,
    `Turned on Night Out Switch at: ${fmtTime(f.armedAt)}`,
    `Last responded at: ${fmtTime(f.lastResponse)} (${mins(f.lastResponse)} minutes ago)`,
    `Phone: ${!o.phone.lastSeenAt ? 'has not reported' : o.phone.offline ? `stopped reporting at ${fmtTime(o.phone.lastSeenAt)}` : 'still reporting, so it has power and signal'}`,
    `Battery: ${f.battery != null ? `${f.battery}%` : 'unknown'}${o.battery.diesAt ? `, on track to run out around ${fmtTime(o.battery.diesAt)}` : ''}`,
    `Location: ${located ? `shown on the map, last updated ${fmtTime(located.time)}` : 'not shared'}`,
  ];
  const extra = o.signals.filter((x) => !['phone_offline', 'battery_forecast', 'battery_low'].includes(x.key)).map((x) => x.them);
  if (extra.length) lines.push(`Other facts: ${extra.join(' ')}`);
  return lines.join('\n');
}

// Reject anything that doesn't look like a clean, safe summary; the template stays in that case.
function cleanModelText(text) {
  let t = (text || '').trim().replace(/^(here (are|is)|sure|okay)[^\n]*\n+/i, '').trim();
  if (!/suggested next step:/i.test(t)) throw new Error('missing "Suggested next step"');
  if (/-?\d{1,3}\.\d{3,}/.test(t)) throw new Error('contains coordinates');
  if (/drunk|drugged|intoxicat|spiked/i.test(t)) throw new Error('speculates about causes');
  return t;
}

// Race a model call against the timeout so a slow model never delays the alert.
async function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

// Our own model, self-hosted on Vultr (Ollama or vLLM) or Vultr Serverless Inference.
// Both speak the OpenAI-compatible chat API, so one client covers them.
async function selfHosted(prompt) {
  const base = process.env.LLM_BASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'llama3.1:8b',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 220,
    }),
  });
  if (!res.ok) throw new Error(`model server ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function gemini(prompt) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await ai.models.generateContent({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash', contents: prompt });
  return res.text;
}

/**
 * Summary for the trusted contact. Tries our self-hosted model first (private: her night never
 * leaves our servers), then Gemini, then a factual template. Returns { text, source }.
 */
export async function summarize(session, events, now = new Date()) {
  const prompt = `${INSTRUCTION}\n\nFacts:\n${factsForModel(session, events, now)}`;
  const providers = [
    process.env.LLM_BASE_URL && ['vultr', selfHosted],
    process.env.GEMINI_API_KEY && ['gemini', gemini],
  ].filter(Boolean);
  for (const [source, call] of providers) {
    try {
      return { text: cleanModelText(await withTimeout(call(prompt))), source };
    } catch (err) {
      console.warn(`[summary] ${source} failed (${err.message}), trying the next option`);
    }
  }
  return { text: templateSummary(session, events, now), source: 'template' };
}
