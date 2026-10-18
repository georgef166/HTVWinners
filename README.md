# tenshi

**It's a dead man's switch, but for a night out.** (Formerly Night Out Switch; the hardware is still called the Switch.)

**Live demo:** https://stillaliveby.design (tap **Start the demo**, then scan the QR codes to be Maya or Jordan on your own phone)

Help starts when a person *stops answering*. Silence triggers the alert, not a button press. You arm it before you go out. Your phone checks in on a timer. If you stop responding, the server climbs an escalation ladder on its own and eventually sends your trusted contact a link with your last location, your battery, and a plain-language summary.

```
ARMED ──(check-in due)──▶ NUDGE ──(no tap)──▶ ALARM ──(no PIN)──▶ CONTACT ──(contact hasn't acked)──▶ WIDER
  ▲                         │                    │                    │
  └──────── "I'm OK" ───────┘                    └──── PIN stand-down ┘  (also from WIDER)
Disarm (PIN) or the contact's "False alarm / resolved" ──▶ RESOLVED
```

The timer lives on the server. If the phone dies or goes quiet, the ladder still climbs.

## Demo day

```bash
npm run live
```

Checks every live service (app, Tiger Cloud, Llama, Whisper, Grafana), sends a spoken "Help!" and a calm clip through Whisper to prove the instant alert fires only when it should, starts the USB bridge if the Switch is plugged in, and opens the stage.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000, click **Start demo**, then open both links (Maya's phone and the contact link) side by side. Don't touch Maya's phone. In about 40 seconds the contact page turns red.

With an empty `.env` it runs with zero setup: an in-memory store, SMS printed to the console, and a template summary instead of Gemini.

```bash
npm run smoke
```

The smoke test runs the whole ladder against the API (about 80 s) and prints `SMOKE PASS`.

## Where it runs

The app and our own AI models run on Vultr in Toronto: Vosk (Kaldi) streams speech and spots distress phrases mid-sentence on stage, Whisper checks the clip after a scream on a real night, and Llama writes the contact's summary. So so Maya's night never goes to a third-party AI company. Her data lives in a managed **Tiger Cloud** service next door in Canada (Central). Tiger Data stores events as a hypertable with compression, 7-day retention (location deletes itself) and a continuous aggregate behind the signal trace. Step-by-step: [docs/DEPLOY-VULTR.md](docs/DEPLOY-VULTR.md).

## Her dashboard and Grafana

Since the phone is checking in anyway, Maya gets her night back as data: **Your night so far** (`/night.html?id=…`, linked from her phone and the stage) shows movement, sound level, battery, reply times, Switch temperature and a timeline. Every signal lands in a Tiger Data `metrics` hypertable (compressed after a day, deleted after 7, rolled up per minute by the `metrics_1m` continuous aggregate). **Grafana** at `/grafana` reads Tiger Data directly: the escalation ladder as a state timeline, live signals, the per-minute rollup, and a time-stream anomaly panel (z-score of sound peaks against a rolling baseline).

**30-second distress checks (opt-in):** the phone keeps the last 30 seconds of audio in memory and sends a clip only after a sudden loud spike. Our self-hosted Whisper (on Vultr) transcribes it in memory, looks for phrases like "help" or "get away from me", and the clip is wiped. Only a score and plain cues are stored. A positive check asks Maya "Still good?" right away; it never alerts her friend by itself.

## The demo stage

**Start the demo** opens `stage.html`: both phones live side by side, with the server's view between them (a scrolling signal trace, a live event feed, and packets travelling the wires as events happen). It's built for the projector.

## The hardware Switch

An Arduino Uno R4 WiFi Switch lets Maya check in with a touch and cancel an alarm with a joystick gesture (up, right, down, left = PIN 1234). Its LED and buzzer still work if her phone is dead, and its temperature sensor feeds the prediction engine. Wiring, flashing and the protocol are in [hardware/README.md](hardware/README.md). No board? `npm run switch-sim` stands in for it.

## Environment

Copy `.env.example` to `.env`. Every variable is optional.

| Var | What it does |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `PUBLIC_URL` | Base URL used in SMS links and the QR code. Set it to a LAN IP or tunnel URL so a real phone can scan the QR. |
| `DEMO` | `1` (default) uses second-long demo timings; `0` uses real timings (20 min check-ins, 2 min nudge, 1 min alarm, 5 min before widening) |
| `DATABASE_URL` | Postgres connection string. Unset means an in-memory store. On Timescale/Tiger Data, `events` and `metrics` become hypertables. |
| `TIGER_DATABASE_URL` | Tiger Cloud connection string. On the Vultr box it overrides `DATABASE_URL` for the app and Grafana; `node deploy/vultr.mjs tiger` copies it there. |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TIMEOUT_MS` | Our own model, OpenAI-compatible (Ollama or vLLM on Vultr, or Vultr Serverless Inference). Tried first for the summary |
| `GEMINI_API_KEY` | Fallback summary model if the self-hosted one is unset or down |
| `GEMINI_MODEL` | Default `gemini-2.5-flash` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Send real SMS. Unset means messages are logged to the console. |
| `SWITCH_KEY` | Shared key the hardware Switch sends. Unset in demo mode means `demo-switch` |

## How it's built

- `server.js`: Express app, JSON API, rate limiting, and the ticker that starts the ladder
- `src/ladder.js`: the state machine and `tick()` (every 2 s in demo mode, 5 s otherwise)
- `src/store.js`: Postgres via `pg`, with an in-memory store that has the same interface
- `src/predict.js`: predicts trouble before the silence (battery forecast, slow or missed replies, phone gone dark) and sets the pace of the next check-in
- `src/summary.js`: the contact's summary. It tries our own model on Vultr first, then Gemini, then a factual template, each with a timeout. It's told never to guess at causes.
- `src/notify.js`: Twilio REST call, or a console log
- `public/`: plain HTML, Tailwind (precompiled to `public/tw.css`; run `npm run build:css` after changing classes), vanilla JS, Leaflet + OpenStreetMap

## AI tools used

- **Claude Code** (Anthropic) wrote the codebase from the build spec: server, state machine, pages and smoke test.
- **Self-hosted model on Vultr** (Llama 3.1 8B via Ollama by default) writes the contact's summary first, so her data stays on our servers.
- **Gemini** (fallback, `@google/genai`, `gemini-2.5-flash` by default) writes the summary the trusted contact sees at the CONTACT level. It's restricted to the logged events and must not speculate about causes, substances or intent.
