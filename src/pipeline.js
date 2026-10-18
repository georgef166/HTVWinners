// What the stage shows under the hood: a short in-memory log per night of what Vultr and Tiger Data just did
// (words recognised, Llama wrote a summary, a row landed in a hypertable). Live words live here only,
// a few lines in memory, and are never written to the database.
import { EventEmitter } from 'node:events';

const KEEP = 40;
const logs = new Map();
const bus = new EventEmitter();
bus.setMaxListeners(0);
let seq = 0;

// Live-only updates (words as they're spoken): pushed to whoever is watching, never kept.
export function flash(sessionId, entry) {
  bus.emit(sessionId, { at: Date.now(), ...entry });
}

// Push every update for one night to the stage as it happens (Server-Sent Events).
export function watch(sessionId, send) {
  bus.on(sessionId, send);
  return () => bus.off(sessionId, send);
}

export function note(sessionId, entry) {
  if (!sessionId) return;
  let log = logs.get(sessionId);
  if (!log) logs.set(sessionId, (log = { entries: [], writes: 0, rows: 0, touched: 0 }));
  log.entries.push({ seq: ++seq, at: Date.now(), ...entry });
  if (log.entries.length > KEEP) log.entries.shift();
  if (entry.kind === 'tiger') { log.writes++; log.rows += entry.rows || 1; }
  log.touched = Date.now();
  bus.emit(sessionId, { ...log.entries.at(-1), writes: log.writes, rows: log.rows });
}

export function since(sessionId, after = 0) {
  const log = logs.get(sessionId);
  if (!log) return { entries: [], writes: 0, rows: 0 };
  return { entries: log.entries.filter((e) => e.seq > after), writes: log.writes, rows: log.rows };
}

// Time every write the app makes, so the stage can show rows landing in Tiger Data as they happen.
export function instrument(store) {
  const wrap = (fn, table, sessionOf, rowsOf, whatOf) => {
    const orig = store[fn].bind(store);
    store[fn] = async (...args) => {
      const t = performance.now();
      const out = await orig(...args);
      note(sessionOf(args, out), { kind: 'tiger', table, rows: rowsOf(args), ms: Math.round(performance.now() - t), what: whatOf(args) });
      return out;
    };
  };
  wrap('addEvent', 'events', ([e]) => e.session_id, () => 1, ([e]) => e.kind);
  wrap('addMetrics', 'metrics', ([id]) => id, ([, rows]) => rows.length, ([, rows]) => [...new Set(rows.map((r) => r.metric))].join(', '));
  wrap('updateSession', 'sessions', ([id]) => id, () => 1, ([, patch]) => Object.keys(patch).join(', '));
  wrap('createSession', 'sessions', (args, out) => out?.id, () => 1, () => 'new night');
  return store;
}

setInterval(() => {
  const cutoff = Date.now() - 3 * 3600_000;
  for (const [id, log] of logs) if (log.touched < cutoff) logs.delete(id);
}, 600_000).unref();
