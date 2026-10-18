#!/usr/bin/env node
// Provision and manage the Night Out Switch server on Vultr through its API.
//
//   node deploy/vultr.mjs plans            cheap plans in Toronto with monthly/hourly prices
//   node deploy/vultr.mjs up [plan]        create the server (default vc2-4c-8gb) and start everything
//   node deploy/vultr.mjs status           server state + live health check
//   node deploy/vultr.mjs ssh [command]    shell into the server (or run one command)
//   node deploy/vultr.mjs logs             app logs
//   node deploy/vultr.mjs update           pull the latest code from GitHub and restart
//   node deploy/vultr.mjs tiger            move the data to Tiger Cloud (TIGER_DATABASE_URL in .env), reseed the week
//   node deploy/vultr.mjs destroy --yes    delete the server (stops billing)
//
// Needs VULTR_API_KEY in .env or the environment (Vultr → Account → API, and allow your IP).
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'deploy', '.vultr-state.json'); // gitignored
const REPO = process.env.DEPLOY_REPO || 'https://github.com/georgef166/HTVWinners.git';
const REGION = process.env.VULTR_REGION || 'yto'; // Toronto
const DEFAULT_PLAN = 'vc2-4c-8gb'; // 4 vCPU / 8 GB: room for the app, Tiger Data and a 3B model on CPU
const MODEL = process.env.DEPLOY_MODEL || 'llama3.2:3b';
const KEY_PATH = path.join(homedir(), '.ssh', 'htv_vultr');

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const state = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null);
const save = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const key = process.env.VULTR_API_KEY;
  if (!key) die('VULTR_API_KEY is not set. Add it to .env (it is gitignored).');
  const res = await fetch(`https://api.vultr.com/v2${p}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) die('Vultr rejected the API key. Check it, and allow your IP under Account → API → Access Control.');
    die(`Vultr API ${method} ${p} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

function setupScript({ dbPassword, switchKey }) {
  // Runs once on first boot (cloud-init). Log: /var/log/nos-setup.log
  return `#!/bin/bash
set -eux
exec > /var/log/nos-setup.log 2>&1
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
curl -fsSL https://get.docker.com | sh
git clone ${REPO} /opt/nos
cd /opt/nos
IP=$(curl -fs http://169.254.169.254/v1/interfaces/0/ipv4/address || hostname -I | awk '{print $1}')
cat > .env <<ENV
SITE_HOST=$(echo "$IP" | tr . -).sslip.io
DB_PASSWORD=${dbPassword}
SWITCH_KEY=${switchKey}
DEMO=1
LLM_BASE_URL=http://ollama:11434/v1
LLM_MODEL=${MODEL}
LLM_TIMEOUT_MS=90000
WHISPER_URL=http://whisper:8000
WHISPER_MODEL=Systran/faster-whisper-base.en
GRAFANA_URL=/grafana
GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 12)
ENV
docker compose --profile model up -d --build
for i in $(seq 1 30); do docker compose exec -T ollama ollama pull ${MODEL} && break; sleep 5; done
touch /var/log/nos-setup.done
`;
}

function ensureSshKey() {
  if (!existsSync(`${KEY_PATH}.pub`)) {
    mkdirSync(path.dirname(KEY_PATH), { recursive: true });
    const r = spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'htv-vultr', '-f', KEY_PATH], { stdio: 'inherit' });
    if (r.status !== 0) die('ssh-keygen failed');
  }
  return readFileSync(`${KEY_PATH}.pub`, 'utf8').trim();
}

function ssh(ip, command, { capture = false } = {}) {
  const args = ['-i', KEY_PATH, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', `root@${ip}`];
  if (command) args.push(command);
  return spawnSync('ssh', args, { stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
}

async function plans() {
  const { plans: list } = await api('GET', '/plans?per_page=500');
  const rows = list
    .filter((p) => p.locations.includes(REGION) && ['vc2', 'vhp', 'vhf', 'vcg'].includes(p.type) && p.monthly_cost <= 200)
    .sort((a, b) => a.monthly_cost - b.monthly_cost);
  console.log(`Plans available in ${REGION} (Toronto), up to $200/month:\n`);
  for (const p of rows) {
    console.log(`${p.id.padEnd(26)} ${String(p.vcpu_count).padStart(2)} vCPU ${String(Math.round(p.ram / 1024)).padStart(3)} GB  $${String(p.monthly_cost).padStart(6)}/mo  ~$${(p.monthly_cost / 730).toFixed(3)}/hr${p.gpu_type ? `  GPU ${p.gpu_type}` : ''}`);
  }
}

async function up(plan = DEFAULT_PLAN) {
  if (state()) die(`A server already exists (${state().id}). Run "status", or "destroy --yes" first.`);
  const pub = ensureSshKey();
  const { ssh_keys: keys } = await api('GET', '/ssh-keys?per_page=500');
  const sshKey = keys.find((k) => k.ssh_key.trim() === pub) || (await api('POST', '/ssh-keys', { name: 'htv-vultr', ssh_key: pub })).ssh_key;

  const { os } = await api('GET', '/os?per_page=500');
  const ubuntu = os.find((o) => o.name === 'Ubuntu 24.04 LTS x64') || os.find((o) => /^Ubuntu 2\d\.04 LTS x64$/.test(o.name));
  if (!ubuntu) die('Could not find an Ubuntu LTS image');

  const secrets = { dbPassword: randomBytes(18).toString('hex'), switchKey: randomBytes(12).toString('hex') };
  console.log(`Creating ${plan} in ${REGION} with ${ubuntu.name}…`);
  const { instance } = await api('POST', '/instances', {
    region: REGION, plan, os_id: ubuntu.id, label: 'night-out-switch', hostname: 'night-out-switch',
    sshkey_id: [sshKey.id], backups: 'disabled', enable_ipv6: false,
    user_data: Buffer.from(setupScript(secrets)).toString('base64'),
    tags: ['htv'],
  });
  save({ id: instance.id, plan, region: REGION, switchKey: secrets.switchKey, created: new Date().toISOString() });

  process.stdout.write('Waiting for the server to boot');
  let inst = instance;
  for (let i = 0; i < 90; i++) {
    await sleep(5000);
    inst = (await api('GET', `/instances/${instance.id}`)).instance;
    process.stdout.write('.');
    if (inst.status === 'active' && inst.power_status === 'running' && inst.main_ip !== '0.0.0.0') break;
  }
  const site = `${inst.main_ip.replaceAll('.', '-')}.sslip.io`;
  save({ ...state(), ip: inst.main_ip, site });
  console.log(`\n✓ Server running at ${inst.main_ip}`);
  console.log(`  Setup (Docker, app, Tiger Data, HTTPS, model download) takes ~5–10 min.`);
  console.log(`  Watch it:   node deploy/vultr.mjs status`);
  console.log(`  Site:       https://${site}`);
  console.log(`  Switch key: ${secrets.switchKey}  (put this in arduino_secrets.h)`);
}

async function status() {
  const s = state();
  if (!s) die('No server yet. Run "up".');
  const { instance } = await api('GET', `/instances/${s.id}`);
  console.log(`Server ${instance.label}: ${instance.status}/${instance.power_status}/${instance.server_status} at ${instance.main_ip} (${s.plan}, ${s.region})`);
  const done = ssh(s.ip, 'test -f /var/log/nos-setup.done && echo done || tail -n 3 /var/log/nos-setup.log', { capture: true });
  console.log(`Setup: ${(done.stdout || done.stderr || '').trim()}`);
  try {
    const r = await fetch(`https://${s.site}/api/health`, { signal: AbortSignal.timeout(8000) });
    console.log(`Health: ${r.status} ${await r.text()}`);
  } catch (err) {
    console.log(`Health: not reachable yet (${err.message})`);
  }
  console.log(`Site: https://${s.site}`);
}

async function destroy(flag) {
  const s = state();
  if (!s) die('No server to destroy.');
  if (flag !== '--yes') die('This deletes the server and its data. Re-run with --yes to confirm.');
  await api('DELETE', `/instances/${s.id}`);
  writeFileSync(STATE + '.destroyed', JSON.stringify({ ...s, destroyed: new Date().toISOString() }, null, 2));
  spawnSync('rm', [STATE]);
  console.log(`✓ Deleted ${s.id}. Billing for it stops now.`);
}

// Point the live server at Tiger Cloud. The connection string goes from your local .env to the server's
// .env over ssh stdin, so the password never appears in a command line, a log or this terminal.
function tiger(ip) {
  const url = process.env.TIGER_DATABASE_URL;
  if (!url) die('Add TIGER_DATABASE_URL=postgres://... to .env (Tiger Cloud console → your service → Connect).');
  const u = new URL(url);
  const vars = {
    TIGER_DATABASE_URL: url, TIGER_HOST: u.hostname, TIGER_PORT: u.port || '5432', TIGER_USER: decodeURIComponent(u.username),
    TIGER_PASSWORD: decodeURIComponent(u.password), TIGER_DB: u.pathname.slice(1) || 'tsdb', TIGER_SSLMODE: 'require',
  };
  const lines = Object.entries(vars).map(([k, v]) => `${k}='${v.replaceAll("'", "")}'`).join('\n') + '\n';
  const sshArgs = ['-i', KEY_PATH, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', `root@${ip}`];
  console.log(`Pointing the server at Tiger Cloud (${u.hostname})…`);
  let r = spawnSync('ssh', [...sshArgs, 'cd /opt/nos && grep -v "^TIGER_" .env > .env.new; cat >> .env.new && mv .env.new .env && chmod 600 .env && docker compose --profile model up -d'],
    { input: lines, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) die('Could not update the server.');
  console.log('Waiting for the app to set up the hypertables on Tiger Cloud…');
  r = spawnSync('ssh', [...sshArgs, 'cd /opt/nos && for i in $(seq 1 30); do curl -sf localhost:3000/api/health >/dev/null 2>&1 || docker compose exec -T app wget -qO- localhost:3000/api/health >/dev/null 2>&1 && break; sleep 2; done; docker compose exec -T app node --input-type=module - < scripts/seed-week.js'],
    { stdio: 'inherit' });
  if (r.status !== 0) die('Seeding the sample week failed.');
  console.log('✓ On Tiger Cloud. Check: node deploy/vultr.mjs status');
}

const [cmd, ...rest] = process.argv.slice(2);
const s = state();
switch (cmd) {
  case 'plans': await plans(); break;
  case 'up': await up(rest[0]); break;
  case 'status': await status(); break;
  case 'ssh': if (!s) die('No server yet.'); process.exit(ssh(s.ip, rest.join(' ') || undefined).status ?? 0);
  case 'logs': if (!s) die('No server yet.'); ssh(s.ip, 'cd /opt/nos && docker compose logs --tail 80 app'); break;
  case 'update': if (!s) die('No server yet.'); ssh(s.ip, 'cd /opt/nos && git pull && docker compose --profile model up -d --build'); break;
  case 'tiger': if (!s) die('No server yet.'); tiger(s.ip); break;
  case 'destroy': await destroy(rest[0]); break;
  default: console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}
