# Prompt: make tenshi look designed, not generated

You're improving the UI of **tenshi**, a hackathon app: a dead man's switch for a night out. The phone checks in on a timer ("Still good?"). No answer → the phone sounds an alarm → still no answer → the trusted friend (Jordan) gets the last location and a summary → then a backup contact. Demo persona: Maya (out) and Jordan (friend). Live site: https://155-138-145-175.sslip.io/

Code: plain HTML + precompiled Tailwind (`npm run build:css` after changing classes) + vanilla JS in `public/`. Pages: `index.html` (landing), `stage.html` (live demo for judges: Maya's phone left, Jordan's right, narration in the middle, both phones are live iframes), `me.html` (Maya's phone), `contact.html` (Jordan's phone), `night.html` (Maya's dashboard), `demo.html` (links page). Shared: `styles.css` (tokens), `theme.js` (logo, route stepper), `trace.js` (signal chart), `tailwind.config.cjs`. Server timing lives in `server.js` and `src/ladder.js`.

## Keep (these are decisions, don't undo them)
- Brand: name "tenshi", the wings-and-halo mark (gold wings, teal halo) from `NOS.logo()`, Plus Jakarta Sans only.
- Flat styling: no gradients, glows, glass, textures, or drop-shadow decoration.
- The landing page stays light; the stage, phones and dashboard stay dark navy.
- The "I'm OK" button and its countdown ring are red (owner's choice).
- The stage format: two live phones + narration. The intro animation (black screen, ECG line, "Then she stops answering.").
- Copy with voice: "Help starts when you stop answering.", "A dead phone can't stop the climb. Your PIN can.", "Two phones. One night. No one presses a button."

## 1. Fix the contradictions first (these are bugs, not taste)
- Drive every countdown from the single server deadline and round the same way (ceil) on the stage, Maya's phone and Jordan's phone. They currently disagree by a second ("0:01" vs "0:02", "Jordan in 2s" vs "alerted in 3s").
- Never show a dead timer: when a countdown reaches 0, swap the copy ("Alerting Jordan now…", "Alerting your backup now…") instead of "Tap within 0 seconds" or "within 0:00".
- Jordan's summary must not say "phone has gone dark" while also saying "still reporting a signal and has 95% battery". Only say "gone dark" when heartbeats have actually stopped.
- `night.html` eyebrow ("Armed and watching") and `demo.html` H1 ("Maya is armed.") must follow the live level (e.g. "Jordan and your backup were alerted").
- Flipping "Start the night" on `stage.html?id=…` must start a fresh night, not reopen the finished one.
- Jordan's page: if the night is already escalated, skip the calm "Stand by for Maya" gate and show the alert (use that first tap to unlock sound). Make the gate a real `<button>`.
- Fix the 502 resource errors on `stage.html`; no layout may scroll on a 375×812 phone (Maya's alarm screen overflows by ~36px and clips the stepper; the stage phone clips "Wider" to "Wide").

## 2. One color system, applied everywhere
- Teal = safe / armed / confirmed. Amber (use the wing gold family) = waiting for an answer (check-in). Red = alarm, contact and backup alerted (and the I'm OK button, per the owner). Navy/grey = neutral.
- The 5-step stepper uses the same colors on every surface (stage, Maya, Jordan, landing). Rename "Wider" to "Backup".
- Remove off-system colors: green "I'm OK" labels in the intro, the separate orange chart markers, the red-to-gold gradient border on the stage header group.

## 3. Stage: readable from 2 meters
- Center column = one big state readout: the phase name at 72–96px in its color ("Check-in", "Alarm", "Jordan alerted", "Backup alerted") and one countdown at 120px+ tabular numerals. Below it, one large 5-step track with 20px+ labels. Feed: last 3 events at 18–20px.
- Delete the "Maya's signal, last 2 minutes" chart, or replace it with an unmistakable heartbeat that flatlines red; the current one is mostly empty with tiny overlapping labels.
- Header: keep only the logo, "Live", and "Try it on your phone". Move "Drain battery", "Switch reads −2°C", "Phone hears 'help'", "Her dashboard" and "Restart" into a presenter tray (small menu bottom-left plus keyboard shortcuts).
- Put the logo on the start screen; cut the ~5s of letterboxed black before content appears. Make the start control look like the toggle the copy describes ("Flip the switch"), or change the copy to match a slider.
- Remove the decorative dashed connectors unless they animate real events.
- Slow demo pacing so each phase holds 10–12s (check-in is visible for only ~8s now); demo timings are in `src/ladder.js`.

## 4. Phones: feel like a real iOS app
- Layout each screen as content top, flexible space, primary action pinned bottom, with safe-area padding. One primary and at most one secondary action per screen. Armed screen currently stacks three differently styled actions ("Disarm, I'm home", "Your night so far ›", "I'm fine, reset the timer").
- PIN keypad: 72×72 circular keys, 28px digits, backspace icon instead of "Clear", auto-submit on the 4th digit (drop "Done").
- No fake "0:00" while loading; show a skeleton. Remove the "Contact: Jordan" chip where the copy already names Jordan.
- Jordan's alert: headline uses an absolute time ("Maya hasn't answered since 8:57 PM"), not a ticking count that re-wraps. Order: state, map, steps, then a sticky bar where "Call Maya" is the dominant button and "I'm on it" is secondary. Put "What to do now" on the dark surface (no white card), remove the duplicated 911 line, the "line: Maya dots: her phone" chart, and the AI disclaimer from the emergency view. Replace "False alarm / resolved" with "It was a false alarm".

## 5. Landing: one idea, not a template
- Stop repeating the section formula (ECG divider, centered 56px H2, centered grey subtitle, white rounded card). Use the ECG line once, as the page's spine: it runs through the hero and flatlines in red under "Help starts when you stop answering."
- Hero: left-aligned headline and one CTA, phones to the right, everything above the fold at 1440×900. Merge "Try the demo" / "Start the demo" / "See how it works" into one primary CTA plus the nav link.
- Replace the three equal feature cards ("Battery forecast", "Check-ins that adapt", "Phone status for your friend") with one annotated phone or an asymmetric layout.
- The phone mockups must not contain sub-11px text; render them larger or as images. Show the low-battery story consistently (mockup says 18%, live demo shows 95%).
- Use `text-wrap: balance` on headings and subtitles (no orphaned "location." or "minute").
- At most one eyebrow label per screen.

## 6. Dashboard and links page
- `night.html`: lead with a state banner ("Jordan and your backup were alerted at 8:58 PM"), make the timeline the main column, hide empty charts until they have data, move "Open in Grafana" and "Stored in Tiger Data…" to a small footer for judges.
- `demo.html`: give "Open Maya's phone" and "Open Jordan's link" equal weight, one style for "Open the live stage", hide `npm run switch-sim` behind a "Hardware setup" disclosure.

## System rules
- Radii: only 8px, 16px and full. Type scale: 12/14/16/20/28/40/64/96 (one scale, no 7.5–10px text). Two weights for body (400/500) and one for display (700).
- Every button has hover, pressed, focus and disabled states. Tap targets ≥ 44px.

## Done means
- At 1440×900 and 375×812: no overflow, no clipped labels, no orphans, no sub-11px text, no console errors.
- Run a stage night start to finish: every timer agrees, no "0 seconds", the summary is consistent, and colors mean the same thing on every screen.
- `npm run smoke` passes. Screenshots of each page, before and after.
