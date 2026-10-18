// One command for demo day: npm run live
// Checks every live service, proves the audio alert works end to end with a spoken clip,
// starts the USB bridge if the Switch is plugged in, and opens the stage.
//   LIVE_URL=https://... npm run live     another server
//   npm run live -- --no-open             skip opening the browser
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.env.LIVE_URL || 'https://155-138-145-175.sslip.io').replace(/\/$/, '');
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
let failures = 0;

async function call(method, url, body, headers = { 'content-type': 'application/json' }) {
  const res = await fetch(base + url, { method, headers, body: body && !Buffer.isBuffer(body) ? JSON.stringify(body) : body, signal: AbortSignal.timeout(60_000) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

console.log(`\ntenshi live check · ${base}\n`);

// 1. Services
try {
  const { data: h } = await call('GET', '/api/health');
  const checks = [
    [h.app, 'App is up'],
    [h.store === 'postgres' && h.timescale, 'Database is TimescaleDB'],
    [h.tiger_cloud, 'Data lives on Tiger Cloud'],
    [h.model === 'self-hosted', 'Summary model (Llama on Vultr)'],
    [/whisper/.test(h.audio || ''), 'Audio model (Whisper on Vultr)'],
    [h.grafana, 'Grafana'],
  ];
  for (const [pass, label] of checks) pass ? ok(label) : (bad(label), failures++);
} catch (e) {
  bad(`Can't reach ${base} (${e.message})`);
  process.exit(1);
}

// 2. Audio: speak a clip, send it the way Maya's phone does, read back what Whisper heard.
async function clip(text, expectDanger) {
  const wav = path.join(os.tmpdir(), `tenshi-${Date.now()}.wav`);
  if (spawnSync('say', ['-o', wav, '--data-format=LEI16@16000', text]).status !== 0) return bad('Audio test skipped (needs macOS "say")');
  const { data: night } = await call('POST', '/api/demo');
  const t = Date.now();
  const { status, data: r } = await call('POST', `/api/sessions/${night.id}/audio-check?peak_db=-8&baseline_db=-40`,
    fs.readFileSync(wav), { 'content-type': 'audio/wav' });
  fs.rmSync(wav, { force: true });
  await call('POST', `/api/sessions/${night.id}/disarm`, { pin: '1234' }).catch(() => {});
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  if (status !== 200) { failures++; return bad(`Audio check failed (${status} ${r.error || ''})`); }
  const heard = r.spoken?.length ? `heard "${r.spoken.join('", "')}"` : 'heard nothing alarming';
  const pass = expectDanger ? r.alerted && r.danger === 'high' : !r.alerted;
  const what = expectDanger ? `Yell → ${heard}, danger ${r.danger}, Jordan ${r.alerted ? 'alerted' : 'NOT alerted'}` : `Calm talk → ${heard}, no alert`;
  pass ? ok(`${what} (${secs}s)`) : (bad(what), failures++);
}
console.log('\n  Audio (spoken clips through Whisper):');
await clip('Help! Help me! Get away from me!', true);
await clip("Hey, I'm heading home now, see you tomorrow.", false);

// 3. Live voice (the stage): stream speech the way Maya's phone does and time the alert from Vosk on Vultr.
function speech(text, gainDb) {
  const wav = path.join(os.tmpdir(), `tenshi-live-${Date.now()}.wav`);
  if (spawnSync('say', ['-o', wav, '--data-format=LEI16@16000', text]).status !== 0) return null;
  const buf = fs.readFileSync(wav); fs.rmSync(wav, { force: true });
  const at = buf.indexOf('data') + 8;  // say adds extra header chunks, so find the samples
  const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + at, buf.byteOffset + buf.length - ((buf.length - at) % 2)));
  const g = 10 ** (gainDb / 20);
  return pcm.map((v) => Math.max(-32768, Math.min(32767, v * g)));
}
async function stream(id, pcm) {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/sessions/${id}/stream`);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  ws.send(JSON.stringify({ room: -48 }));
  const send = async (a) => { for (let i = 0; i < a.length; i += 1365) { ws.send(Buffer.from(a.slice(i, i + 1365).buffer)); await new Promise((r) => setTimeout(r, 85)); } };
  const started = Date.now();
  await send(pcm);
  await send(new Int16Array(16000));  // a second of quiet ends the utterance
  ws.close();
  return started;
}
async function levelWithin(id, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) {
    const { data } = await call('GET', `/api/sessions/${id}`);
    if (data.danger) return { level: data.level, at: data.danger.at };
  }
  return null;
}
console.log('\n  Live voice on stage (Vosk streaming on Vultr):');
try {
  const calm = speech("Can you stop by the store on the way home?", -18), shout = speech('Get away from me! Somebody help!', 0);
  if (!calm || !shout) bad('Live voice test skipped (needs macOS "say")');
  else {
    const { data: night } = await call('POST', '/api/demo');
    await stream(night.id, calm);
    (await levelWithin(night.id, 800)) ? (bad('Talking volume alerted Jordan (should not)'), failures++) : ok('Talking volume → no alert');
    const t0 = await stream(night.id, shout);
    const hit = await levelWithin(night.id, 3000);
    hit ? ok(`Shouted "Somebody help!" → Jordan alerted ${((hit.at - t0) / 1000).toFixed(1)}s after the shout began`) : (bad('Shout did not alert Jordan'), failures++);
    await call('POST', `/api/sessions/${night.id}/disarm`, { pin: '1234' }).catch(() => {});
  }
} catch (e) { bad(`Live voice test failed (${e.message})`); failures++; }

// 4. Hardware
console.log();
const board = fs.readdirSync('/dev').find((f) => f.startsWith('cu.usbmodem'));
let bridge;
if (board) {
  ok(`Switch found on /dev/${board}, starting the USB bridge`);
  bridge = spawn(process.execPath, [path.join(root, 'scripts/switch-bridge.js')], { stdio: 'inherit', env: { ...process.env, SWITCH_URL: base } });
} else {
  console.log('  · No Switch plugged in (that\'s fine, the stage works without it)');
}

// 5. Stage
const stage = `${base}/stage.html`;
if (!process.argv.includes('--no-open')) spawnSync('open', [stage]);
console.log(`
${failures ? `\x1b[31m${failures} check(s) failed.\x1b[0m` : '\x1b[32mEverything is live.\x1b[0m'}

  Stage      ${stage}
  Grafana    ${base}/grafana/d/nos-week

  Test the audio yourself: on the stage, flip the switch to start the night and
  allow the microphone. Talk near the laptop and the bottom strip shows each word
  as Vosk on Vultr hears it, plus every row landing in Tiger Data. Yell "Help me!"
  and Jordan's phone turns red about a second later.
  No mic handy? Press h on the stage (presenter shortcut) to fake it.
${bridge ? '\n  Bridge is running. Ctrl+C to stop.\n' : ''}`);
if (!bridge) process.exit(failures ? 1 : 0);
process.on('SIGINT', () => { bridge.kill(); process.exit(0); });
