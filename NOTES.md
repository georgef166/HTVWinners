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
- Shared tokens live in `public/theme.js` (Tailwind config) and `public/styles.css`. Reduced motion turns off the alarm flash (solid red instead) and the breathing/route animations.
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
- One Switch per server; it follows the most recently armed session (in memory, so restarting the server unlinks it until the next arm). Auth is a shared `SWITCH_KEY` header.
- Joystick PIN uses digits 1 to 4 only (up/right/down/left), so a PIN with 0 or 5 to 9 can't be entered on the Switch; the phone keypad still works.
- NFC home tag resolves the night with no PIN; in demo mode any tag works unless `SWITCH_HOME_TAG` is set.
- Temperature at or below 5°C within the last minute (demo) / 5 min (real) adds a "cold" signal (weight 1). Pressure is logged but not used for prediction yet (too noisy for fall detection without more work).
- `POST /api/demo/:id/cold` toggles a fake −2°C reading for demos. `npm run switch-sim` speaks the same protocol from the keyboard or piped commands.
- Ideas not built: pairing several Switches to sessions (e.g. by tapping the Switch's NFC tag on the phone), a "panic" long-press that skips straight to CONTACT, using pressure changes for fall detection, running the Switch's own countdown offline if WiFi drops.
