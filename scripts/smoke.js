// End-to-end check of the escalation ladder against the API.
// Uses PUBLIC_URL if a server is already running there; otherwise starts one with DEMO=1 and no DB.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let child = null;
let base = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

function fail(msg) {
  console.error(`SMOKE FAIL: ${msg}`);
  if (child) child.kill();
  process.exit(1);
}

async function up(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function call(method, p, body) {
  const r = await fetch(base + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function level(id) {
  const { status, data } = await call('GET', `/api/sessions/${id}`);
  if (status !== 200) fail(`GET /api/sessions/${id} returned ${status}`);
  return data.level;
}

async function waitFor(id, target, deadline) {
  while (Date.now() < deadline) {
    const l = await level(id);
    if (l === target) return;
    if (l === 'WIDER' || l === 'RESOLVED') fail(`expected ${target}, got ${l}`);
    await sleep(500);
  }
  fail(`did not reach ${target} in time (last level: ${await level(id)})`);
}

async function main() {
  if (await up(base)) {
    console.log(`Using running server at ${base}`);
  } else {
    const port = 3000 + Math.floor(Math.random() * 1000) + 1000;
    base = `http://localhost:${port}`;
    console.log(`Starting server on ${base} (DEMO=1, in-memory store)`);
    child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), PUBLIC_URL: base, DEMO: '1', DATABASE_URL: '' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (d) => process.env.SMOKE_VERBOSE && process.stdout.write(d));
    child.on('exit', (code) => code && fail(`server exited with code ${code}`));
    const until = Date.now() + 10_000;
    while (!(await up(base))) {
      if (Date.now() > until) fail('server did not start');
      await sleep(200);
    }
  }

  // 1. Create the demo session.
  const { status, data: demo } = await call('POST', '/api/demo');
  if (status !== 200 || !demo.id || !demo.contactToken) fail(`POST /api/demo returned ${status}`);
  if ((await level(demo.id)) !== 'ARMED') fail('new session is not ARMED');
  console.log('✓ demo session ARMED');

  // 2. Stay silent: the server-side ladder must climb on its own.
  const deadline = Date.now() + 60_000;
  for (const target of ['NUDGE', 'ALARM', 'CONTACT']) {
    await waitFor(demo.id, target, deadline);
    console.log(`✓ reached ${target}`);
  }

  // 3. The contact sees a summary.
  const contact = await call('GET', `/api/contact/${demo.contactToken}`);
  if (contact.status !== 200) fail(`GET /api/contact returned ${contact.status}`);
  if (!contact.data.summary || !contact.data.summary.trim()) fail('contact summary is empty');
  console.log(`✓ summary: ${contact.data.summary.slice(0, 80)}…`);

  // 4. Contact acks; the ladder must not climb to WIDER.
  const ack = await call('POST', `/api/contact/${demo.contactToken}/ack`);
  if (ack.status !== 200 || !ack.data.contact_acked) fail('contact ack failed');
  console.log('✓ contact acked, waiting past the CONTACT window…');
  await sleep(34_000);
  const after = await level(demo.id);
  if (after !== 'CONTACT') fail(`expected CONTACT after ack, got ${after}`);
  console.log('✓ still CONTACT (did not climb to WIDER)');

  // 5. Stand-down needs the right PIN.
  const wrong = await call('POST', `/api/sessions/${demo.id}/stand-down`, { pin: '0000' });
  if (wrong.status !== 403) fail(`wrong PIN returned ${wrong.status}, expected 403`);
  const right = await call('POST', `/api/sessions/${demo.id}/stand-down`, { pin: '1234' });
  if (right.status !== 200) fail(`correct PIN returned ${right.status}`);
  if ((await level(demo.id)) !== 'ARMED') fail('not ARMED after stand-down');
  const okView = await call('GET', `/api/contact/${demo.contactToken}`);
  if (!okView.data.stood_down) fail('contact page does not show the stand-down');
  console.log('✓ wrong PIN 403, correct PIN back to ARMED');

  console.log('SMOKE PASS');
  if (child) child.kill();
  process.exit(0);
}

main().catch((err) => fail(err.stack || err.message));
