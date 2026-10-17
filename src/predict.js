// Predicts trouble before the silence: battery about to die, replies slowing down,
// a phone that stopped reporting. Plain, explainable rules — no guesses about why
// someone is quiet (never substances, intoxication or intent).

const DEMO = process.env.DEMO !== '0';

const T = DEMO
  ? { batteryHorizonMs: 3 * 60e3, minBatterySpanMs: 15e3, slowReplyMs: 5e3, quickReplyMs: 3e3, offlineMs: 25e3, minIntervalS: 8 }
  : { batteryHorizonMs: 60 * 60e3, minBatterySpanMs: 10 * 60e3, slowReplyMs: 60e3, quickReplyMs: 15e3, offlineMs: 3 * 60e3, minIntervalS: 5 * 60 };

const ms = (t) => new Date(t).getTime();
const clock = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const secs = (n) => Math.round(n / 1000);

// Least-squares slope of battery level over time (fraction per ms).
function batterySlope(points) {
  const xs = points.map((p) => ms(p.time));
  const ys = points.map((p) => Number(p.battery));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return den ? num / den : 0;
}

// How long each check-in took to answer, in ms (checkin_sent → checkin_ack).
function replyTimes(events) {
  const out = [];
  let sentAt = null;
  for (const e of events) {
    if (e.kind === 'checkin_sent') sentAt = ms(e.time);
    else if (e.kind === 'checkin_ack' && sentAt != null) { out.push(ms(e.time) - sentAt); sentAt = null; }
    else if (e.kind === 'stand_down') sentAt = null;
  }
  return out;
}

/**
 * @returns {{
 *   level: 'calm'|'watch'|'elevated', score: number,
 *   signals: {key: string, weight: number, you: string, them: string}[],
 *   battery: {pct: number|null, diesAt: Date|null},
 *   phone: {lastSeenAt: Date|null, offline: boolean},
 *   lastReplyS: number|null, nextIntervalS: number, intervalReason: string,
 * }}
 */
export function assess(session, events, now = new Date()) {
  const name = session.user_name;
  const signals = [];
  const beats = events.filter((e) => e.kind === 'heartbeat');

  // Battery: forecast when it hits zero from the recent trend.
  const withBattery = beats.filter((e) => e.battery != null).slice(-12);
  const pct = withBattery.length ? Math.round(Number(withBattery.at(-1).battery) * 100) : null;
  let diesAt = null;
  if (withBattery.length >= 3 && ms(withBattery.at(-1).time) - ms(withBattery[0].time) >= T.minBatterySpanMs) {
    const slope = batterySlope(withBattery);
    if (slope < 0) diesAt = new Date(ms(withBattery.at(-1).time) + Number(withBattery.at(-1).battery) / -slope);
  }
  if (diesAt && diesAt - now < T.batteryHorizonMs) {
    signals.push({
      key: 'battery_forecast', weight: 2,
      you: `Your battery is on track to die around ${clock(diesAt)}. A dead phone looks like silence, so charge it soon.`,
      them: `${name}'s battery was on track to die around ${clock(diesAt)}.`,
    });
  } else if (pct != null && pct <= 15) {
    signals.push({ key: 'battery_low', weight: 1, you: `Your battery is at ${pct}%.`, them: `${name}'s battery was at ${pct}%.` });
  }

  // Replies: slow answers and missed check-ins.
  const replies = replyTimes(events);
  const lastReply = replies.at(-1) ?? null;
  if (lastReply != null && lastReply > T.slowReplyMs) {
    signals.push({
      key: 'slow_reply', weight: 1.5,
      you: `You took ${secs(lastReply)}s to answer the last check-in.`,
      them: `${name} took ${secs(lastReply)}s to answer the last check-in.`,
    });
  }
  // Each PIN stand-down from an alarm is a check-in she missed and recovered from.
  const missedBefore = events.filter((e) => e.kind === 'stand_down' && ['ALARM', 'CONTACT', 'WIDER'].includes(e.detail?.from)).length;
  if (missedBefore > 0) {
    signals.push({
      key: 'missed_before', weight: 1.5,
      you: `You missed ${missedBefore === 1 ? 'a check-in' : `${missedBefore} check-ins`} earlier tonight.`,
      them: `${name} missed ${missedBefore === 1 ? 'a check-in' : `${missedBefore} check-ins`} earlier tonight.`,
    });
  }

  // Late night raises the stakes a little.
  const hour = now.getHours();
  if (hour >= 1 && hour < 6) signals.push({ key: 'late', weight: 0.5, you: 'It’s after 1am.', them: 'It’s after 1am.' });

  // Is the phone still reporting? Tells "not answering" apart from "phone went dark".
  const lastBeat = beats.at(-1);
  const lastSeenAt = lastBeat ? new Date(lastBeat.time) : null;
  const offline = !!lastSeenAt && now - lastSeenAt > T.offlineMs;
  if (offline) {
    const lowPower = pct != null && (pct <= 10 || (diesAt && diesAt <= now));
    signals.push({
      key: 'phone_offline', weight: 1,
      you: `Your phone stopped reporting at ${clock(lastSeenAt)}.`,
      them: `${name}'s phone stopped reporting at ${clock(lastSeenAt)}${lowPower ? `, with ${pct}% battery, so it may have run out of power` : ''}.`,
    });
  }

  const score = signals.reduce((a, s) => a + s.weight, 0);
  const level = score >= 2.5 ? 'elevated' : score >= 1 ? 'watch' : 'calm';

  // Adaptive pacing: quick, calm replies earn fewer interruptions; risk tightens them.
  const base = session.checkin_every_s;
  const quick = lastReply != null && lastReply <= T.quickReplyMs;
  const factor = level === 'elevated' ? 0.5 : level === 'calm' && quick ? 1.5 : 1;
  const nextIntervalS = Math.max(T.minIntervalS, Math.round(base * factor));
  const intervalReason = level === 'elevated'
    ? 'Checking in more often until things settle.'
    : factor > 1 ? 'You’ve been answering quickly, so check-ins are spaced out.' : 'Regular check-ins.';

  return {
    level, score, signals,
    battery: { pct, diesAt },
    phone: { lastSeenAt, offline },
    lastReplyS: lastReply != null ? secs(lastReply) : null,
    nextIntervalS, intervalReason,
  };
}
