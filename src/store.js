// Postgres store with an in-memory fallback. Both expose the same async functions.
import crypto from 'node:crypto';

const SESSION_COLS = [
  'id', 'user_name', 'contact_name', 'contact_phone', 'backup_phone', 'contact_token',
  'pin_hash', 'checkin_every_s', 'home_by', 'level', 'level_deadline', 'next_checkin_at',
  'contact_acked', 'summary', 'armed_at', 'resolved_at',
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_name text NOT NULL,
  contact_name text NOT NULL,
  contact_phone text,
  backup_phone text,
  contact_token text UNIQUE NOT NULL,
  pin_hash text NOT NULL,
  checkin_every_s integer NOT NULL,
  home_by timestamptz,
  level text NOT NULL,
  level_deadline timestamptz,
  next_checkin_at timestamptz,
  contact_acked boolean NOT NULL DEFAULT false,
  summary text,
  armed_at timestamptz NOT NULL,
  resolved_at timestamptz
);
CREATE TABLE IF NOT EXISTS events (
  time timestamptz NOT NULL,
  session_id uuid NOT NULL,
  kind text NOT NULL,
  lat double precision,
  lng double precision,
  battery double precision,
  detail jsonb
);
CREATE INDEX IF NOT EXISTS events_session_time ON events (session_id, time DESC);
-- Signals over time (movement, sound level, battery, temperature, reply time, distress score).
-- Long format: one row per reading, which is what Grafana and continuous aggregates like best.
CREATE TABLE IF NOT EXISTS metrics (
  time timestamptz NOT NULL,
  session_id uuid NOT NULL,
  metric text NOT NULL,
  value double precision NOT NULL,
  source text
);
CREATE INDEX IF NOT EXISTS metrics_session_metric_time ON metrics (session_id, metric, time DESC);
`;

function memoryStore() {
  const sessions = new Map();
  const events = [];
  const metrics = [];
  return {
    kind: 'memory',
    async init() {},
    async addMetrics(sessionId, rows) {
      const now = new Date();
      for (const r of rows) metrics.push({ time: r.time || now, session_id: sessionId, metric: r.metric, value: r.value, source: r.source || null });
    },
    async metricsSince(sessionId, since) {
      return metrics.filter((m) => m.session_id === sessionId && m.time >= since).sort((a, b) => a.time - b.time);
    },
    async createSession(s) {
      sessions.set(s.id, { ...s });
      return { ...s };
    },
    async getSession(id) {
      const s = sessions.get(id);
      return s ? { ...s } : null;
    },
    async getSessionByToken(token) {
      for (const s of sessions.values()) if (s.contact_token === token) return { ...s };
      return null;
    },
    async updateSession(id, patch) {
      const s = sessions.get(id);
      if (!s) return null;
      Object.assign(s, patch);
      return { ...s };
    },
    async listActiveSessions() {
      return [...sessions.values()].filter((s) => s.level !== 'RESOLVED').map((s) => ({ ...s }));
    },
    async addEvent(e) {
      events.push({ time: new Date(), lat: null, lng: null, battery: null, detail: null, ...e });
    },
    async listEvents(sessionId) {
      return events.filter((e) => e.session_id === sessionId).sort((a, b) => a.time - b.time);
    },
    async heartbeatBuckets(sessionId, since) {
      const buckets = new Map();
      for (const e of events) {
        if (e.session_id !== sessionId || e.kind !== 'heartbeat' || e.time < since) continue;
        const b = Math.floor(e.time.getTime() / 60000) * 60000;
        const cur = buckets.get(b) || { time: new Date(b), beats: 0, min_battery: null };
        cur.beats += 1;
        if (e.battery != null) cur.min_battery = cur.min_battery == null ? e.battery : Math.min(cur.min_battery, e.battery);
        buckets.set(b, cur);
      }
      return [...buckets.values()].sort((a, b) => a.time - b.time);
    },
    async lastEvent(sessionId, kinds) {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e.session_id === sessionId && kinds.includes(e.kind)) return e;
      }
      return null;
    },
  };
}

async function pgStore(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  });
  const q = (text, params) => pool.query(text, params);
  const tryQ = async (text) => { try { await q(text); return true; } catch (err) { console.warn(`[store] skipped: ${err.message}`); return false; } };
  return {
    kind: 'postgres',
    timescale: false,
    async init() {
      await q(SCHEMA);
      // Tiger Data (TimescaleDB) features. Each is optional: plain Postgres skips them and still works.
      await tryQ('CREATE EXTENSION IF NOT EXISTS timescaledb');
      const { rows } = await q(`SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'`);
      this.timescale = rows.length > 0;
      if (!this.timescale) return;
      // Hypertable: events are a time series, partitioned by time.
      await tryQ(`SELECT create_hypertable('events', 'time', if_not_exists => TRUE, migrate_data => TRUE)`);
      // Compression: older nights shrink by ~90%, grouped per session.
      await tryQ(`ALTER TABLE events SET (timescaledb.compress, timescaledb.compress_segmentby = 'session_id', timescaledb.compress_orderby = 'time DESC')`);
      await tryQ(`SELECT add_compression_policy('events', INTERVAL '1 day', if_not_exists => TRUE)`);
      // Retention: her location trail deletes itself after a week. Privacy by default.
      await tryQ(`SELECT add_retention_policy('events', INTERVAL '7 days', if_not_exists => TRUE)`);
      // Continuous aggregate: heartbeats per minute, kept fresh in the background, for the signal trace.
      await tryQ(`CREATE MATERIALIZED VIEW IF NOT EXISTS heartbeat_1m
        WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
        SELECT session_id, time_bucket('1 minute', time) AS bucket, count(*) AS beats, min(battery) AS min_battery
        FROM events WHERE kind = 'heartbeat' GROUP BY session_id, bucket WITH NO DATA`);
      await tryQ(`SELECT add_continuous_aggregate_policy('heartbeat_1m',
        start_offset => INTERVAL '2 hours', end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '1 minute', if_not_exists => TRUE)`);
      // Signals: hypertable, compression per session+metric, the same 7-day retention, and a per-minute rollup
      await tryQ(`SELECT create_hypertable('metrics', 'time', if_not_exists => TRUE, migrate_data => TRUE)`);
      await tryQ(`ALTER TABLE metrics SET (timescaledb.compress, timescaledb.compress_segmentby = 'session_id, metric', timescaledb.compress_orderby = 'time DESC')`);
      await tryQ(`SELECT add_compression_policy('metrics', INTERVAL '1 day', if_not_exists => TRUE)`);
      await tryQ(`SELECT add_retention_policy('metrics', INTERVAL '7 days', if_not_exists => TRUE)`);
      await tryQ(`CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1m
        WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
        SELECT session_id, metric, time_bucket('1 minute', time) AS bucket,
               avg(value) AS avg, min(value) AS min, max(value) AS max, count(*) AS n
        FROM metrics GROUP BY session_id, metric, bucket WITH NO DATA`);
      await tryQ(`SELECT add_continuous_aggregate_policy('metrics_1m',
        start_offset => INTERVAL '2 hours', end_offset => INTERVAL '30 seconds', schedule_interval => INTERVAL '30 seconds', if_not_exists => TRUE)`);
    },
    async addMetrics(sessionId, rows) {
      if (!rows.length) return;
      const vals = [];
      const ph = rows.map((r, i) => {
        vals.push(r.time || new Date(), sessionId, r.metric, r.value, r.source || null);
        return `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`;
      });
      await q(`INSERT INTO metrics (time, session_id, metric, value, source) VALUES ${ph.join(',')}`, vals);
    },
    async metricsSince(sessionId, since) {
      const { rows } = await q('SELECT time, metric, value, source FROM metrics WHERE session_id = $1 AND time >= $2 ORDER BY time', [sessionId, since]);
      return rows;
    },
    async heartbeatBuckets(sessionId, since) {
      if (this.timescale) {
        const { rows } = await q(
          'SELECT bucket AS time, beats, min_battery FROM heartbeat_1m WHERE session_id = $1 AND bucket >= $2 ORDER BY bucket',
          [sessionId, since],
        );
        return rows;
      }
      const { rows } = await q(
        `SELECT date_trunc('minute', time) AS time, count(*)::int AS beats, min(battery) AS min_battery
         FROM events WHERE session_id = $1 AND kind = 'heartbeat' AND time >= $2 GROUP BY 1 ORDER BY 1`,
        [sessionId, since],
      );
      return rows;
    },
    async createSession(s) {
      const vals = SESSION_COLS.map((c) => s[c] ?? null);
      const ph = SESSION_COLS.map((_, i) => `$${i + 1}`).join(',');
      const { rows } = await q(`INSERT INTO sessions (${SESSION_COLS.join(',')}) VALUES (${ph}) RETURNING *`, vals);
      return rows[0];
    },
    async getSession(id) {
      const { rows } = await q('SELECT * FROM sessions WHERE id = $1', [id]);
      return rows[0] || null;
    },
    async getSessionByToken(token) {
      const { rows } = await q('SELECT * FROM sessions WHERE contact_token = $1', [token]);
      return rows[0] || null;
    },
    async updateSession(id, patch) {
      const keys = Object.keys(patch).filter((k) => SESSION_COLS.includes(k));
      if (!keys.length) return this.getSession(id);
      const set = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const { rows } = await q(`UPDATE sessions SET ${set} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => patch[k])]);
      return rows[0] || null;
    },
    async listActiveSessions() {
      const { rows } = await q(`SELECT * FROM sessions WHERE level <> 'RESOLVED'`);
      return rows;
    },
    async addEvent(e) {
      await q(
        'INSERT INTO events (time, session_id, kind, lat, lng, battery, detail) VALUES (now(), $1, $2, $3, $4, $5, $6)',
        [e.session_id, e.kind, e.lat ?? null, e.lng ?? null, e.battery ?? null, e.detail ? JSON.stringify(e.detail) : null],
      );
    },
    async listEvents(sessionId) {
      const { rows } = await q('SELECT * FROM events WHERE session_id = $1 ORDER BY time ASC', [sessionId]);
      return rows;
    },
    async lastEvent(sessionId, kinds) {
      const { rows } = await q(
        'SELECT * FROM events WHERE session_id = $1 AND kind = ANY($2) ORDER BY time DESC LIMIT 1',
        [sessionId, kinds],
      );
      return rows[0] || null;
    },
  };
}

export async function createStore(url = process.env.DATABASE_URL) {
  const store = url ? await pgStore(url) : memoryStore();
  await store.init();
  return store;
}

export const newId = () => crypto.randomUUID();
export const newToken = () => crypto.randomBytes(18).toString('base64url'); // 24 chars
export const hashPin = (pin) => crypto.createHash('sha256').update(String(pin)).digest('hex');
