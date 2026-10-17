// Sample data: a week of Maya's nights out, so the Tiger Data / Grafana dashboards have history to show.
// Clearly marked sample rows (contact_token starts with "samplewk"), replaced on every run.
// Run on the server:  docker compose exec -T app node --input-type=module - < scripts/seed-week.js
import pg from 'pg';
import crypto from 'node:crypto';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params) => pool.query(text, params);
const hashPin = (pin) => crypto.createHash('sha256').update(pin).digest('hex');

// Deterministic randomness so the week looks the same every time it's seeded.
let seed = 20261017;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a, b) => a + rand() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const VENUES = [
  { name: 'Queen West', lat: 43.6465, lng: -79.4111 },
  { name: 'Ossington', lat: 43.6489, lng: -79.4200 },
  { name: 'Kensington', lat: 43.6547, lng: -79.4005 },
  { name: 'King West', lat: 43.6443, lng: -79.4004 },
  { name: 'Scarborough Town Centre', lat: 43.7756, lng: -79.2578 },
];

// One plan per night, newest first (1 = last night). Durations in hours.
const NIGHTS = [
  { ago: 1, start: 21.5, hours: 4.8, loud: 1.0, venue: 0, missed: true, distress: 0.7, coldWalk: false, battery: [0.86, 0.31] },
  { ago: 2, start: 20.5, hours: 2.6, loud: 0.5, venue: 4, battery: [0.74, 0.52] },
  { ago: 3, start: 22.0, hours: 3.4, loud: 0.7, venue: 2, falseAlarm: 0.3, battery: [0.48, 0.07] },
  { ago: 4, start: 21.0, hours: 2.2, loud: 0.4, venue: 4, battery: [0.91, 0.70] },
  { ago: 5, start: 22.25, hours: 3.0, loud: 0.6, venue: 3, coldWalk: true, battery: [0.80, 0.44] },
  { ago: 6, start: 21.75, hours: 4.3, loud: 0.95, venue: 1, battery: [0.88, 0.28] },
  { ago: 7, start: 22.0, hours: 3.6, loud: 0.85, venue: 0, battery: [0.83, 0.39] },
];

async function clearSample() {
  const { rows } = await q("SELECT id FROM sessions WHERE contact_token LIKE 'samplewk%'");
  const ids = rows.map((r) => r.id);
  if (!ids.length) return 0;
  await q('DELETE FROM metrics WHERE session_id = ANY($1)', [ids]);
  await q('DELETE FROM events WHERE session_id = ANY($1)', [ids]);
  await q('DELETE FROM sessions WHERE id = ANY($1)', [ids]);
  return ids.length;
}

async function insertMany(table, cols, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const vals = [];
    const ph = chunk.map((r, j) => `(${cols.map((_, k) => `$${j * cols.length + k + 1}`).join(',')})`);
    chunk.forEach((r) => vals.push(...r));
    await q(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph.join(',')}`, vals);
  }
}

function nightStart(ago, startHour) {
  const d = new Date();
  d.setDate(d.getDate() - ago);
  d.setHours(Math.floor(startHour), Math.round((startHour % 1) * 60), 0, 0);
  return d;
}

async function seedNight(plan, index) {
  const id = crypto.randomUUID();
  const start = nightStart(plan.ago, plan.start);
  const end = new Date(start.getTime() + plan.hours * 3600e3);
  const venue = VENUES[plan.venue];
  const events = [];
  const metrics = [];
  const ev = (t, kind, detail = null, extra = {}) => events.push([t, id, kind, extra.lat ?? null, extra.lng ?? null, extra.battery ?? null, detail ? JSON.stringify(detail) : null]);
  const m = (t, metric, value, source = 'phone') => metrics.push([t, id, metric, value, source]);
  const at = (minutes) => new Date(start.getTime() + minutes * 60e3);
  const totalMin = plan.hours * 60;
  const walkIn = 18, walkOut = 25;

  await q(
    `INSERT INTO sessions (id, user_name, contact_name, contact_phone, backup_phone, contact_token, pin_hash, checkin_every_s,
       home_by, level, level_deadline, next_checkin_at, contact_acked, summary, armed_at, resolved_at)
     VALUES ($1, 'Maya', 'Jordan', '+15555550123', '+15555550199', $2, $3, 1200, NULL, 'RESOLVED', NULL, NULL, false, NULL, $4, $5)`,
    [id, `samplewk${String(index).padStart(2, '0')}${crypto.randomBytes(8).toString('hex')}`.slice(0, 24), hashPin('1234'), start, end],
  );
  ev(start, 'level_change', { from: null, to: 'ARMED' });

  // Heartbeats every 30 s: walking in, the venue, walking home.
  for (let min = 0; min <= totalMin; min += 0.5) {
    const t = at(min);
    const phase = min < walkIn ? 'walk' : min > totalMin - walkOut ? 'walk' : 'venue';
    const progress = min / totalMin;
    const battery = clamp(plan.battery[0] + (plan.battery[1] - plan.battery[0]) * progress + between(-0.004, 0.004), 0.02, 1);
    const peakHour = Math.exp(-((progress - 0.55) ** 2) / 0.06); // loudest a bit after midnight
    let movement, soundDb;
    if (phase === 'walk') { movement = between(1.2, 2.2); soundDb = between(-50, -42); }
    else {
      const dancing = rand() < 0.18 + 0.25 * peakHour * plan.loud;
      movement = dancing ? between(2.2, 4.6) : between(0.2, 1.1);
      soundDb = -40 + 20 * plan.loud * peakHour + between(-4, 4);
    }
    const peak = soundDb + between(6, 14);
    const lat = (phase === 'walk' ? venue.lat + between(-0.004, 0.004) : venue.lat + between(-0.0002, 0.0002));
    const lng = (phase === 'walk' ? venue.lng + between(-0.004, 0.004) : venue.lng + between(-0.0002, 0.0002));
    ev(t, 'heartbeat', null, { lat, lng, battery });
    m(t, 'battery_pct', Math.round(battery * 100));
    m(t, 'movement', +movement.toFixed(2));
    m(t, 'sound_db', +clamp(soundDb, -70, -6).toFixed(1));
    m(t, 'sound_peak_db', +clamp(peak, -60, -2).toFixed(1));
    // Switch temperature/pressure each minute: warm inside, cold outside.
    if (min % 1 === 0) {
      const outside = phase === 'walk';
      const temp = outside ? (plan.coldWalk ? between(1.5, 3.5) : between(6, 9)) : between(21.5, 24.5);
      m(t, 'temp_c', +temp.toFixed(1), 'switch');
      m(t, 'pressure_hpa', +(1013 + between(-1.5, 1.5)).toFixed(1), 'switch');
    }
  }

  // Check-ins every 20 minutes; replies slow down as the night goes on.
  let missedDone = false;
  for (let min = 20; min < totalMin - 5; min += 20) {
    const t = at(min);
    ev(t, 'checkin_sent', { reason: 'interval' });
    ev(t, 'level_change', { from: 'ARMED', to: 'NUDGE' });
    const late = min / totalMin;
    if (plan.missed && !missedDone && late > 0.6) {
      // Missed one: alarm after 2 minutes, then she cancels with her PIN.
      missedDone = true;
      ev(at(min + 2), 'level_change', { from: 'NUDGE', to: 'ALARM' });
      ev(at(min + 2.7), 'stand_down', { from: 'ALARM' });
      ev(at(min + 2.7), 'level_change', { from: 'ALARM', to: 'ARMED' });
      continue;
    }
    const reply = clamp(between(2, 9) + 40 * late * late * plan.loud * rand(), 1.5, 110);
    const ackT = new Date(t.getTime() + reply * 1000);
    ev(ackT, 'checkin_ack');
    ev(ackT, 'level_change', { from: 'NUDGE', to: 'ARMED' });
    m(ackT, 'reply_s', Math.round(reply));
  }

  // 30-second distress checks (only scores and cues, never audio).
  if (plan.distress) {
    const t = at(totalMin * 0.72);
    ev(t, 'distress_check', { score: plan.distress, cues: ['a sudden loud noise or shouting', 'someone saying stop or get away'], transcribed: true });
    m(t, 'distress_score', plan.distress);
    ev(t, 'checkin_sent', { reason: 'distress' });
    ev(t, 'level_change', { from: 'ARMED', to: 'NUDGE' });
    const ack = new Date(t.getTime() + 6000);
    ev(ack, 'checkin_ack'); ev(ack, 'level_change', { from: 'NUDGE', to: 'ARMED' });
    m(ack, 'reply_s', 6);
  }
  if (plan.falseAlarm) {
    const t = at(totalMin * 0.5);
    ev(t, 'distress_check', { score: plan.falseAlarm, cues: ['a sudden loud noise or shouting'], transcribed: true });
    m(t, 'distress_score', plan.falseAlarm);
  }

  // Home: tapped the NFC tag by the door.
  ev(end, 'device', { type: 'nfc', home: true });
  ev(end, 'resolved', { by: 'home_tag' });
  ev(end, 'level_change', { from: 'ARMED', to: 'RESOLVED' });

  events.sort((a, b) => a[0] - b[0]);
  await insertMany('events', ['time', 'session_id', 'kind', 'lat', 'lng', 'battery', 'detail'], events);
  await insertMany('metrics', ['time', 'session_id', 'metric', 'value', 'source'], metrics);
  return { start, hours: plan.hours, events: events.length, metrics: metrics.length };
}

const removed = await clearSample();
const out = [];
for (const [i, plan] of NIGHTS.entries()) out.push(await seedNight(plan, i));
// Backfill the continuous aggregates: their policies only refresh the last couple of hours.
for (const view of ['metrics_1m', 'heartbeat_1m']) {
  try { await q(`CALL refresh_continuous_aggregate('${view}', now() - interval '8 days', now())`); } catch (err) { console.log(`refresh ${view} skipped: ${err.message}`); }
}
console.log(`removed ${removed} old sample nights`);
for (const n of out) console.log(`${n.start.toString().slice(0, 21)}  ${n.hours}h  events=${n.events} metrics=${n.metrics}`);
console.log(`total metrics rows: ${out.reduce((a, n) => a + n.metrics, 0)}, events: ${out.reduce((a, n) => a + n.events, 0)}`);
await pool.end();
