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
`;

function memoryStore() {
  const sessions = new Map();
  const events = [];
  return {
    kind: 'memory',
    async init() {},
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
  return {
    kind: 'postgres',
    async init() {
      await q(SCHEMA);
      try {
        await q(`SELECT create_hypertable('events','time', if_not_exists => TRUE)`);
      } catch {
        // Only works on Timescale / Tiger Data; plain Postgres is fine without it.
      }
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
