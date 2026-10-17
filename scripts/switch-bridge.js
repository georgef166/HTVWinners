// USB link for the hardware Switch: relays the board's requests to the server over the USB cable,
// so the Switch works without WiFi (handy when venue WiFi blocks devices).
//
//   npm run switch-bridge                 server and key from hardware/night-out-switch/arduino_secrets.h
//   SWITCH_URL=http://localhost:3100 SWITCH_KEY=demo-switch npm run switch-bridge
//   SWITCH_PORT=/dev/cu.usbmodem1234 npm run switch-bridge
//
// The board sends ">>METHOD PATH BODY" lines; this answers "<<STATUS BODY". Other lines are its logs.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const secretsPath = fileURLToPath(new URL('../hardware/night-out-switch/arduino_secrets.h', import.meta.url));
const secrets = fs.existsSync(secretsPath) ? fs.readFileSync(secretsPath, 'utf8') : '';
const define = (name) => secrets.match(new RegExp(`#define ${name} "?([^"\\n]*)"?`))?.[1]?.trim();

const host = define('SERVER_HOST');
const port = Number(define('SERVER_PORT')) || 80;
const base = (process.env.SWITCH_URL || (host ? (port === 80 ? `https://${host}` : `http://${host}:${port}`) : 'http://localhost:3000')).replace(/\/$/, '');
const key = process.env.SWITCH_KEY || define('SWITCH_KEY') || 'demo-switch';

const device = process.env.SWITCH_PORT || fs.readdirSync('/dev').filter((f) => f.startsWith('cu.usbmodem')).map((f) => `/dev/${f}`)[0];
if (!device) { console.error('No board found (looked for /dev/cu.usbmodem*). Plug it in or set SWITCH_PORT.'); process.exit(1); }

// Open first, then set raw 115200 on the open port (macOS resets settings when a port closes).
const fd = fs.openSync(device, fs.constants.O_RDWR | fs.constants.O_NOCTTY);
execFileSync('stty', ['115200', 'raw', '-echo', '-hupcl', 'clocal'], { stdio: [fd, 'ignore', 'inherit'] });
const write = (s) => fs.writeSync(fd, s);
console.log(`Switch bridge: ${device} ⇄ ${base}`);

const ALLOWED = /^\/api\/switch\/(state|event)$/;
async function relay(line) {
  const m = line.match(/^>>(GET|POST) (\S+) ?(.*)$/);
  if (!m || !ALLOWED.test(m[2])) return write('<<400 ERR;BADREQ\n');
  const [, method, path, body] = m;
  try {
    const res = await fetch(base + path, {
      method,
      headers: { 'X-Switch-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? body : undefined,
      signal: AbortSignal.timeout(3500),
    });
    const text = (await res.text()).replace(/\s*\n\s*/g, ' ').trim();
    write(`<<${res.status} ${text}\n`);
    if (path.endsWith('/event')) console.log(`  ${body} -> ${res.status} ${text}`);
  } catch (err) {
    write('<<502 ERR;UNREACHABLE\n');
    console.log(`  ${method} ${path} failed: ${err.message}`);
  }
}

let buf = '';
let lastState = '';
const chunk = Buffer.alloc(1024);
function readLoop() {
  fs.read(fd, chunk, 0, chunk.length, null, (err, n) => {
    if (err) { console.error(`Lost the board: ${err.message}`); process.exit(1); }
    if (n > 0) onData(chunk.subarray(0, n));
    readLoop();
  });
}
readLoop();
function onData(data) {
  buf += data.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).replace(/\r$/, '');
    buf = buf.slice(i + 1);
    if (line.startsWith('>>')) {
      relay(line).then(() => {});
      if (!line.includes('/state')) console.log(`board → ${line.slice(2)}`);
    } else if (line.trim()) console.log(`board │ ${line}`);
  }
}

// Show level changes from the server so it's easy to follow along.
setInterval(async () => {
  try {
    const s = await fetch(`${base}/api/switch/state`, { headers: { 'X-Switch-Key': key } }).then((r) => r.text());
    const level = s.match(/L=(\w+)/)?.[1];
    if (level && level !== lastState) { console.log(`server: ${level}`); lastState = level; }
  } catch {}
}, 2000);
