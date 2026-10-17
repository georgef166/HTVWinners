# Deploy on Vultr: app, model and Tiger Data in one place

The pitch line: **Maya's night never leaves our servers.** The app, the AI model that writes the contact's summary, and the Tiger Data database all run on Vultr. No third-party AI company sees where she is or when she went quiet.

```
            Vultr Cloud GPU (one box)
 ┌────────────────────────────────────────────┐
 │ Caddy (HTTPS)  →  Node app (:3000)         │
 │                     │            │         │
 │       Ollama (:11434, private)   TimescaleDB (:5432, private)
 │       llama3.1:8b                Tiger Data  │
 └────────────────────────────────────────────┘
        Arduino Switch and phones talk to Caddy over HTTPS
```

## Why Vultr and not Vercel

Vercel runs code as short-lived serverless functions. Night Out Switch's promise is that **the timer lives on the server**: every 2 seconds it checks every night and escalates, even if her phone is dead. On serverless nothing runs between requests, so a silent phone would never trigger an alert, which is exactly the case the app exists for. That needs an always-on server, and Vultr gives you one (and has its own prize).

## Quick deploy (Docker Compose, about 10 minutes)

On a fresh Vultr Ubuntu server (Cloud Compute is fine; Cloud GPU if you want our own model):

```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
curl -fsSL https://get.docker.com | sh
git clone <your-repo-url> night-out-switch && cd night-out-switch
cp .env.example .env
nano .env   # set SITE_HOST, DB_PASSWORD, SWITCH_KEY (and DEMO=1 for demo timings)
docker compose up -d                      # app + Tiger Data + HTTPS
# On a GPU server, also run our own model:
docker compose --profile model up -d
docker compose exec ollama ollama pull llama3.1:8b
```

- `SITE_HOST`: no domain needed. Use sslip.io: server IP `203.0.113.7` → `203-0-113-7.sslip.io`. Caddy gets a real HTTPS certificate for it automatically.
- Open `https://<SITE_HOST>`. `https://<SITE_HOST>/api/health` should show `"store":"postgres","timescale":true`, and `"model":"self-hosted"` with the GPU profile.
- Phones: anyone can open it. Each person who taps **Start the demo** gets their own night; the stage has QR codes to be Maya or Jordan on your own phone.
- The Switch: point `SERVER_HOST` at `SITE_HOST`, `SERVER_PORT` 80. Caddy serves `/api/switch/*` over plain HTTP for it and redirects everything else to HTTPS. Link it to a night from the stage (automatic) or the links page.

The manual steps below do the same thing without Docker.

## 1. Create the server

- Vultr → **Cloud GPU**. An NVIDIA A16 or L40S slice is plenty for an 8B model. Ubuntu 24.04.
- Add your SSH key, then `ssh root@<server-ip>`.
- Firewall: allow only 22, 80, 443. The model (11434) and database (5432) stay private.

```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 2. Our own model with Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1:8b
curl http://127.0.0.1:11434/v1/models
```

Ollama listens on 127.0.0.1 by default, which is what we want. It serves the OpenAI-compatible API the app uses (`/v1/chat/completions`). Any model works: `qwen2.5:7b` is a good alternative.

> No GPU budget? **Vultr Serverless Inference** also speaks the OpenAI API. Set `LLM_BASE_URL` to its endpoint and `LLM_API_KEY` to your key. It's still on Vultr, but managed rather than self-hosted.

## 3. Tiger Data (TimescaleDB)

Choose one:

**A. Self-hosted on the same Vultr box** (everything in one place):

```bash
apt-get install -y docker.io
docker run -d --name tiger --restart unless-stopped -p 127.0.0.1:5432:5432 \
  -e POSTGRES_PASSWORD='<strong-password>' -v tiger-data:/home/postgres/pgdata/data \
  timescale/timescaledb-ha:pg17
```

`DATABASE_URL=postgresql://postgres:<strong-password>@127.0.0.1:5432/postgres?sslmode=disable`

**B. Tiger Cloud** (managed): create a free service at tigerdata.com and copy its connection string into `DATABASE_URL`.

On startup the app turns on the Tiger Data features automatically and logs anything it skips:
- `events` becomes a **hypertable**
- **compression** after 1 day (segmented by session)
- **retention**: events, including location, delete themselves after 7 days
- a **continuous aggregate** `heartbeat_1m` (heartbeats per minute) that feeds the contact's signal trace on a real night

Check it with `curl https://<host>/api/health`, which should report `"store":"postgres","timescale":true`.

## 4. The app

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs git
git clone <your-repo-url> /opt/night-out-switch && cd /opt/night-out-switch
npm ci --omit=dev
cp .env.example .env   # then edit it, see below
```

`.env` on the server:

```
PORT=3000
PUBLIC_URL=https://<server-ip-with-dashes>.sslip.io
DEMO=1
DATABASE_URL=<from step 3>
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=llama3.1:8b
LLM_TIMEOUT_MS=4000
SWITCH_KEY=<random string, also in the Arduino's arduino_secrets.h>
```

Run it as a service:

```bash
cat > /etc/systemd/system/night-out-switch.service <<'EOF'
[Unit]
Description=Night Out Switch
After=network.target ollama.service
[Service]
WorkingDirectory=/opt/night-out-switch
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now night-out-switch
```

## 5. HTTPS (phones need it for location and battery)

Browsers only share location from secure pages, so HTTPS isn't optional. [sslip.io](https://sslip.io) gives you a hostname for your IP with no domain needed. A GoDaddy domain also works, and has its own MLH prize.

```bash
apt-get install -y caddy
cat > /etc/caddy/Caddyfile <<'EOF'
<server-ip-with-dashes>.sslip.io {
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy
```

## 6. Point the Switch at it

In `hardware/night-out-switch/arduino_secrets.h`, set `SERVER_HOST` to the sslip.io hostname and `SERVER_PORT` to 80. The firmware speaks plain HTTP, so either add an `http://` site block in Caddy for `/api/switch/*`, or keep the Switch on the venue network against the laptop. HTTPS on the R4 needs `WiFiSSLClient`, a small follow-up.

## Check the privacy claim

- `curl https://<host>/api/health` reports `"model":"self-hosted"`.
- When a contact is alerted, their page says the summary was written by our own model.
- `journalctl -u night-out-switch` shows no calls to outside AI providers. Leave `GEMINI_API_KEY` unset to guarantee it.
