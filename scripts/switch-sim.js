// A stand-in for the hardware Switch: speaks the same protocol as the Arduino firmware.
// Use it to demo without the board, or to test the server.
//
//   npm run switch-sim                 interactive keys (t touch, arrows/wasd joystick, enter send, c cold, q quit)
//   echo "touch" | npm run switch-sim  line commands: touch | code 1234 | cold | warm | state | wait <s>
import 'dotenv/config';
import readline from 'node:readline';

const BASE = (process.env.SWITCH_URL || process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
const KEY = process.env.SWITCH_KEY || 'demo-switch';
const headers = { 'X-Switch-Key': KEY, 'Content-Type': 'application/json' };

let tempC = 21.5;
let code = '';
let lastLine = '';

async function state() {
  const r = await fetch(`${BASE}/api/switch/state`, { headers });
  return { status: r.status, text: (await r.text()).trim() };
}
async function event(body) {
  const r = await fetch(`${BASE}/api/switch/event`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = (await r.text()).trim();
  console.log(`  ${body.type}${body.code ? ` ${body.code}` : ''} -> ${r.status} ${text}`);
  return r.status;
}
const reading = () => event({ type: 'reading', temp_c: tempC, pressure_hpa: 1013.2 });

const commands = {
  touch: () => event({ type: 'touch' }),
  code: (c) => event({ type: 'code', code: c || code }),
  cold: () => { tempC = -2; return reading(); },
  warm: () => { tempC = 21.5; return reading(); },
  state: async () => console.log(`  ${(await state()).text}`),
  wait: (s) => new Promise((r) => setTimeout(r, Number(s || 1) * 1000)),
};

async function pollLoop() {
  try {
    const { status, text } = await state();
    const line = status === 200 ? text : `HTTP ${status} ${text}`;
    if (line.replace(/S=\d+;/, '') !== lastLine.replace(/S=\d+;/, '')) console.log(`[switch] ${line}`);
    lastLine = line;
  } catch (err) {
    console.log(`[switch] can't reach ${BASE}: ${err.message}`);
  }
}

console.log(`Switch simulator -> ${BASE}`);
await pollLoop();
const poller = setInterval(pollLoop, 1000);
const readings = setInterval(() => reading().catch(() => {}), 10000);
await reading().catch(() => {});

if (process.stdin.isTTY) {
  console.log('Keys: t touch | arrows or w/a/s/d joystick (up=1 right=2 down=3 left=4) | enter send code | c cold/warm | q quit');
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  const dirs = { up: '1', w: '1', right: '2', d: '2', down: '3', s: '3', left: '4', a: '4' };
  process.stdin.on('keypress', async (_, key) => {
    if (!key) return;
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) process.exit(0);
    if (key.name === 't') await commands.touch();
    else if (dirs[key.name]) { code += dirs[key.name]; console.log(`  code: ${'•'.repeat(code.length)}`); }
    else if (key.name === 'return') { if (code.length >= 4) await commands.code(code); else console.log('  code too short, cleared'); code = ''; }
    else if (key.name === 'c') await (tempC > 5 ? commands.cold() : commands.warm());
  });
} else {
  // Line commands from a pipe, for scripted tests.
  const rl = readline.createInterface({ input: process.stdin });
  for await (const raw of rl) {
    const [cmd, arg] = raw.trim().split(/\s+/);
    if (!cmd) continue;
    if (!commands[cmd]) { console.log(`  unknown command: ${cmd}`); continue; }
    await commands[cmd](arg);
  }
  clearInterval(poller);
  clearInterval(readings);
}
