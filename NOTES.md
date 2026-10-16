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
