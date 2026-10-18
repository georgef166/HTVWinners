# NOTES

## Choices made (where the spec was open)

- **`DEMO` defaults to on.** Demo timings apply unless `DEMO=0`, so `npm start` with an empty `.env` still gives a seconds-long demo. The NUDGE/ALARM/CONTACT windows are global (set by `DEMO`), not per session. `POST /api/demo` always uses a 15 s check-in interval.
- **`home_by` fires once.** When it passes, the session goes to NUDGE and `home_by` is cleared, so acking doesn't instantly re-trigger. Regular check-ins continue after that.
- **ALARM needs the PIN.** `checkin-ack` only works in ARMED/NUDGE (409 otherwise). "Tap if you're OK" in ALARM is the PIN keypad. An ack in ARMED (the "I'm fine, reset the timer" link) just pushes the next check-in back.
- **Stand-down resets `contact_acked`** to false, so if the ladder climbs again the contact has to ack again.
- **Heartbeats don't count as "responding".** "Last response" is the last `checkin_ack` / `stand_down`, or `armed_at`. Silence means no human interaction, even if the phone is still pinging.
- **Privacy:** `GET /api/contact/:token` only returns location and summary while the level is CONTACT/WIDER. Before that the contact sees a neutral card; after a stand-down the location is hidden again.
- **"Maya says she's OK"** is rendered as `Maya says: "I'm OK."`, and the template summary uses the person's name instead of pronouns, because real users' pronouns aren't collected.
- **Demo location fallback:** in demo mode, if the browser has no geolocation (or it's denied), `me.html` sends a fixed demo location (UTSC, Toronto) so the contact map still shows a pin. Real (DEMO=0) sessions never fake a location.
- **Call Maya** uses a placeholder number (`+15555550123`). The data model has no user phone yet.
- **Twilio** is called with `fetch` against the REST API rather than the `twilio` package (one less dependency).
- **Extra route** `GET /api/demo/:id` returns the links and a QR data URL for `demo.html` (the session id is already the capability for `me.html`).
- **Rate limit:** 60 POSTs/min per IP, in memory. Heartbeats (6/min) fit comfortably.
- **Real-night arm form** redirects to `demo.html?id=…` too, since that page already shows the phone link, the contact link and the QR.
- **Tokens:** contact token is 18 random bytes as base64url (24 chars). PIN is stored as an unsalted sha256, per the spec ("fine" for an MVP).
- **Contact alert sound** needs the "Tap to enable alerts" overlay first (browser autoplay rules). Vibration only works on Android Chrome; iOS Safari ignores `navigator.vibrate`.

## Ideas not built

- Salted/slow PIN hashing (scrypt) and lockout after repeated wrong PINs.
- Per-session timing windows stored in the DB, so demo and real sessions can share one server.
- Web Push / service worker so check-ins and alarms fire with the screen locked. Right now `me.html` has to stay open in the foreground.
- Store the user's phone number for the real "Call Maya" button.
- Contact-side SMS reply ("ON IT") via a Twilio webhook instead of opening the link.
- Share a live location trail (the hypertable already stores it) instead of only the last point.
- Let the contact see the WIDER escalation status and who else was alerted.
- An events-retention policy on the hypertable (drop location data after 24 h).
- Distinguish "phone offline" (heartbeats stopped) from "phone online but no response" in the summary and on the contact page.

## Design

- Visual language comes from the street at night: indigo night sky (`#0E1430`), sodium streetlight amber (`#FFB547`) for "armed" and primary actions, signal red for alarm, mint for "OK".
- Type: Unbounded (wide, flyer-style display and numbers) + Hanken Grotesk (body), from Google Fonts.
- The escalation ladder is drawn as a night-bus route (`NOS.route` in `public/theme.js`) on the landing page, Jordan's waiting screen, and as a "you are here" line on Maya's phone.
- Shared tokens live in `tailwind.config.cjs` (compiled into `public/tw.css` with `npm run build:css`) and `public/styles.css`. Reduced motion turns off the alarm flash (solid red instead) and the breathing/route animations.
- Second pass, using the "what would make you wince" test from obra/superpowers' brainstorming skill, aimed at the contact at 2am:
  - Call and "I'm on it" stay pinned to the bottom of the alert screen. After acking, the second button becomes Directions (Google Maps link to the last location).
  - The summary's "Suggested next step" is split out and leads as a numbered "What to do now" list; the rest is "What we know".
  - The contact sees a countdown before the backup contact is alerted (`seconds_to_wider` on `GET /api/contact/:token`), then a note once it happens.
  - Last location shows clock time and "N seconds/minutes ago"; battery at 20% or below gets a "Low" tag.
  - Maya gets a confirmation toast after checking in or cancelling the alarm, and the alarm screen has a draining bar showing time until the contact is alerted.
  - The landing hero shows the product: Maya's armed phone and Jordan's alert phone (static HTML mockup; Jordan's screen turns red once on load).
- Spec deviations kept on purpose: demo.html says "Open Jordan's link" rather than "Contact link"; the alarm heading reads "Tap your PIN if you're OK".

## Prediction (`src/predict.js`)

- Predicts *going quiet*, never *why*: no guesses about substances, intoxication or intent.
- Signals and weights: battery on track to die within the horizon (2; least-squares trend over the last 12 readings), battery ≤ 15% (1), last check-in answered slowly (1.5), a check-in missed and recovered earlier tonight (1.5, counted from PIN stand-downs out of an alarm), after 1am (0.5), phone stopped reporting (1).
- Level: calm under 1, watch from 1, elevated from 2.5. Pacing: elevated halves the gap, calm with a quick last reply stretches it 1.5×, never below 8 s (demo) / 5 min (real).
- Demo thresholds are compressed (3 min battery horizon, 5 s "slow" reply, 25 s offline). `POST /api/demo/:id/drain-battery` (demo only) fakes a 10-points-a-minute drain from 32%.
- The contact sees phone status only once alerting: "still on and has signal" vs "gone dark", which tells "not answering" apart from "dead phone".
- Ideas not built: personal baselines (reply speed vs this person's usual), learning from past nights, movement signals (stationary for long, heading away from home), a weather/temperature signal from hardware.

## Hardware Switch (`hardware/`)

- Uno R4 WiFi talks straight to the server over WiFi. Assumed common kit parts: RC522 NFC, KY-023 joystick, TTP223 touch, BMP280, a single LED and a passive buzzer, plus the R4's built-in LED matrix. Firmware compiles with arduino-cli for `arduino:renesas_uno:unor4wifi` (35% flash); it has not been run on a real board yet.
- One Switch per server; it's linked to one night explicitly (`POST /api/sessions/:id/link-switch`, done automatically by the stage). The link is in memory, so a restart unlinks it. Auth is a shared `SWITCH_KEY` header.
- Joystick PIN uses digits 1 to 4 only (up/right/down/left), so a PIN with 0 or 5 to 9 can't be entered on the Switch; the phone keypad still works.
- NFC home tag resolves the night with no PIN; in demo mode any tag works unless `SWITCH_HOME_TAG` is set.
- Temperature at or below 5°C within the last minute (demo) / 5 min (real) adds a "cold" signal (weight 1). Pressure is logged but not used for prediction yet (too noisy for fall detection without more work).
- `POST /api/demo/:id/cold` toggles a fake −2°C reading for demos. `npm run switch-sim` speaks the same protocol from the keyboard or piped commands.
- Ideas not built: pairing several Switches to sessions (e.g. by tapping the Switch's NFC tag on the phone), a "panic" long-press that skips straight to CONTACT, using pressure changes for fall detection, running the Switch's own countdown offline if WiFi drops.

## Demo wow pass + Vultr / Tiger Data

- Landing intro (about 3.7 s, skippable, off with reduced motion): check-ins drawn as heartbeat spikes, then a red flatline races to "Jordan" and a shockwave reveals the page. One rAF clock drives it so lines and labels never drift.
- `stage.html`: both phones in iframes with `?stage=1` (they borrow the stage's AudioContext, unlocked by its Start click), a status line, the signal trace, the route, a live event feed, and packets on the wires driven by real events (heartbeats, check-ins, the alert to Jordan, acks).
- Signal trace (`public/trace.js`, `GET /api/sessions/:id/trace`, and `trace` on the contact API while alerting): calm wave while answering, spikes on responses, flat red when silent, phone heartbeat dots underneath. No location in the trace.
- Jordan's takeover: white shockwave, headline slam, OSM tiles darkened with a CSS filter (CARTO dark tiles now want an API key), map flies from city level to street level, radar rings on the pin.
- Summary providers: self-hosted OpenAI-compatible model (`LLM_BASE_URL`) → Gemini → template. The source is logged as a `summary` event and shown on Jordan's page.
- Tiger Data: extension, hypertable, compression (1 day), retention (7 days), continuous aggregate `heartbeat_1m` used for the 45-minute real-night trace. Tested on plain Postgres 14 (features skipped cleanly, smoke passes); the TimescaleDB-only SQL has not been run against a real Timescale instance yet.

## Multi-phone + deploy

- Fixed an endless alarm: a Maya page whose session disappeared (server restart) kept beeping in ALARM forever. Now a 404 ends the night on the page, and the local alarm stops after 20 s without server contact.
- Rate limit raised to 240 POST/min per IP, with heartbeats and Switch routes exempt, because a whole venue shares one public IP.
- The stage has QR codes to be Maya or Jordan on your own phone; every Start the demo is its own night.
- Deploy target is Vultr, not Vercel: the escalation ticker must run continuously, and serverless doesn't. `docker compose up -d` brings up the app, TimescaleDB and Caddy (HTTPS via sslip.io); `--profile model` adds Ollama on a GPU. Compose config validates; the images haven't been built here (no Docker daemon locally).

## Dashboard, Grafana, distress checks (MLH coach feedback)

- "Biometrics" are honest signals: phone motion (DeviceMotion), ambient loudness (mic level only), battery, reply times, Switch temperature/pressure. No heart-rate sensor in the kit (a MAX30102 would add one).
- `metrics` hypertable (long format: time, session_id, metric, value, source), compression segmented by session+metric, 7-day retention, `metrics_1m` continuous aggregate (30 s refresh).
- Distress checks: rolling 30 s PCM ring buffer at 16 kHz on the phone; trigger = 18 dB over a slow-moving baseline for ~0.5 s; clip sent 3 s later; server transcribes with Speaches (faster-whisper base.en, CPU) and matches a narrow phrase list. Verified on Vultr: a calm clip scored 0.3 (no prompt), "stop, get away from me, somebody help me" scored 1.0 and prompted a check-in, ~1.5–2 s per clip. Verified the DB holds only score + cues, logs hold no words, and no audio files exist.
- Bystander privacy: opt-in per night (on by default only in demo sessions), audio never stored, only phrases indicating distress are matched, nothing is sent to a third party.
- Grafana 11.3 with anonymous Viewer access for the demo (the dashboard shows names and signals but no location). Lock it down (disable anonymous, or use public dashboard links) before any real use.
- Listening stops when the phone locks (browser limitation); a native app would fix this.
- Sample week: `scripts/seed-week.js` writes 7 sample nights for Maya (sessions marked with a `samplewk` contact token, replaced on every run) and backfills the continuous aggregates. Re-run it on the server (`node deploy/vultr.mjs ssh 'cd /opt/nos && docker compose exec -T app node --input-type=module -' < scripts/seed-week.js`) to shift the week forward; the 7-day retention policy drops the oldest night as days pass.
- Grafana "the week" (`/grafana/d/nos-week`) counts real nights only (check-in interval of 5 minutes or more), so demo runs don't skew it. Both dashboards are generated by `scripts/build-grafana.py`.
