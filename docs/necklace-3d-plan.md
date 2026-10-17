# Plan: interactive 3D necklace page (`/necklace.html`)

Goal: an interactive three.js model of the tenshi necklace so we can show which sensors it has. Hover a component for a tooltip, click to fly the camera in, highlight it and open a detail panel. All copy comes from `hardware/README.md`; do not invent specs.

Branch: `necklace-3d` (do not switch branches). `server.js` stays untouched.

## Amendment from the user (overrides anything below that conflicts)

**The back of the necklace must look like exposed hardware.** The front is the jewelry (gold chain, swept angel wings with pave stones, small round center stone, pear-cut gem). The back of the pendant is a visible sensor board: a dark navy solder-mask PCB shaped like the pendant outline, with gold traces, solder pads and vias, silkscreen labels (tiny text such as `TOUCH D4`, `BUZZER D8`, `BARO I2C`, `UNO R4`), a mounting-hole ring, and the four components mounted on it as real-looking parts:

- Touch sensor: a small square capacitive touch module (TTP223 style) with a round copper pad and 3 header pins (SIG / VCC / GND)
- Buzzer: a black round piezo can with a sound-hole on top and two legs
- Barometer / temperature: a tiny square chip (DPS310 style) with a pin row and a small gold pad outline
- Arduino Uno R4 WiFi: a larger board-style module (rounded rectangle, USB-C connector end, the 12x8 LED matrix as a grid of small emissive dots, a square chip, a row of header pins)

Because the components are on the back:
- Add a **Front / Back toggle** (a glass pill button, also bound to the `F` key) that rotates the pendant 180 degrees about Y with an eased 700 ms tween (instant under reduced motion).
- Hotspot markers live on the back PCB anchors. When the user selects a component (click, tap or list button) and the model is showing the front, flip to the back first, then fly in.
- OrbitControls may orbit freely (full azimuth) in overview so the back is reachable by dragging too. The Front / Back toggle just snaps to the two canonical views.
- Back view default camera: same as the front view, looking at the back (flip the root, keep the camera fixed).
- The back must read as a hardware visualization: thin gold trace lines routing from each component to the Arduino, slightly emissive pads, subtle blueprint-style grid or scan shimmer is optional.
- Front-facing teaser: in the front view the four markers are hidden; show a small hint chip "Flip to see the sensors".

## 1. Architecture and files

Vendor three.js r160 (offline-safe; no CDN at demo time) into `public/vendor/three/` and load with an import map in `necklace.html`:

```html
<script type="importmap">{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three/jsm/"}}</script>
```

Files to vendor from the `three@0.160.0` npm tarball (use `curl` + `tar`):
- `build/three.module.js` -> `public/vendor/three/three.module.js`
- `examples/jsm/controls/OrbitControls.js`
- `examples/jsm/environments/RoomEnvironment.js`
- `examples/jsm/geometries/RoundedBoxGeometry.js`
- `examples/jsm/utils/BufferGeometryUtils.js`
- also copy `examples/jsm/geometries/` or `utils/` files only if an addon imports them; keep the `jsm` folder structure under `public/vendor/three/jsm/`.

New files (exact paths):
- `public/necklace.html`: shell, import map, module entry `/necklace/main.js` (SOFTWARE ENG)
- `public/necklace/data.js`: sensor copy (SOFTWARE ENG)
- `public/necklace/ui.js`: tooltip, panel, list, state machine, Front/Back toggle UI (SOFTWARE ENG)
- `public/necklace/main.js`: wiring, WebGL check, resize, render loop (SOFTWARE ENG)
- `public/necklace/necklace.css`: plain CSS, linked after `styles.css` (SOFTWARE ENG)
- `public/necklace/smoke.mjs`: smoke script (SOFTWARE ENG)
- `public/necklace/geometry.js`: model builders incl. the PCB back (3D DEV)
- `public/necklace/materials.js`: materials and lights (3D DEV)
- `public/necklace/hotspots.js`: marker sprites, pulsing, projection, picking (ANIMATOR)
- `public/necklace/camera.js`: tween, fly-to, flip, OrbitControls glue (ANIMATOR)
- `public/necklace/highlight.js`: dim and glow effects, idle float (ANIMATOR)
- `public/vendor/three/**`: MANAGER (step 0)
- `public/me.html`: SOFTWARE ENG adds one nav link only if there is a natural spot

No new Tailwind classes (plain CSS in `necklace.css`). If any are added, run `npm run build:css`.

## 2. Shared contracts

Units: 1 unit = 1 cm. Pendant centered at the origin. +Y up, +X the necklace's right, +Z faces the viewer **when showing the front**. Pendant about 4 wide by 6 tall; chain loops up and back to about y=+9. Default camera (0, -1, 16) looking at (0,0,0), FOV 35. "Back" = rotate `root` by PI about Y.

IDs: `export const IDS = ['touch','buzzer','baro','brain']` in `data.js`.

### 3D DEV exports (`geometry.js`)
```js
buildNecklace({ lowPower }): { root, anchors, parts, bounds }
```
- `root`: Group of the whole necklace (front jewelry on +Z side, PCB back on -Z side of the pendant plate).
- `parts[id]`: the component Object3D, `name = 'part-<id>'`, `userData.id = id`, every child mesh also `userData.id = id`, `userData.materials = [...]`.
- `anchors[id]`: empty Object3D child of `root` on the **back** surface of the component, local +Z... note: anchors on the back face outward toward -Z in root space. `anchors[id].userData.focus = { offset: Vector3, distance: number, lookAt: Vector3 }` in `root` local space, framing the component from behind (offset has negative z).
- Layout on the back plate (root space, z negative): touch about (-1.5, 1.2), buzzer about (1.6, 1.0), baro about (0.0, 2.4), brain (Arduino) about (0, -1.6), all on a PCB plate at z about -0.35. Trace lines connect them.
- Non-component meshes: `userData.id = null`. Glow sprites set `userData.isGlowSprite`.
- `materials.js`: `setupLighting(scene, renderer)` (PMREM of RoomEnvironment, key + rim light, ACES tone mapping, sRGB). Pear gem uses `MeshPhysicalMaterial` (transmission 0.9, thickness 1.5, ior 1.5 on desktop; `lowPower` turns transmission off, fewer links, skips pave detail). `lowPower` = `matchMedia('(pointer:coarse)')` or (`devicePixelRatio > 2.5` and width < 768).
- Metal: warm pale gold `#D8C08A`, roughness 0.25, metalness 1. PCB: solder mask `#0E1A33` with teal tint, traces and pads gold `#D1B896`, silkscreen `#C9D3E6`, aqua `#5FD0D8` emissive accents.
- Chain: about 90 links as an `InstancedMesh` of flattened `TorusGeometry` with alternating 90-degree twists along a CatmullRom curve. Wings: `ExtrudeGeometry` from feather `Shape`s layered 3 deep with bevel. Pave: `InstancedMesh` of small icospheres. Center stone: faceted. Pear gem: `LatheGeometry` flat-shaded in a thin bezel torus.
- Under 150k triangles total.

### ANIMATOR exports
```js
// camera.js
createCameraRig({ camera, renderer, root, reducedMotion }): { controls, flyTo(id, anchor, { duration=1000 }), flyHome({ duration }), flip(side:'front'|'back', { duration=700 }), getSide(), update(dt), isBusy() }
tween(from, to, ms, ease, onUpdate): Promise   // easeInOutCubic default
// hotspots.js
createHotspots({ scene, camera, canvas, anchors, parts, reducedMotion }): { setVisible(bool), setActive(id|null), setHover(id|null), update(t, dt), pick(clientX, clientY): ID|null, screenPos(id): {x,y,visible}, on(event, cb) } // events: 'hover', 'select', 'background'
// highlight.js
createHighlighter({ root, parts, reducedMotion }): { focus(id), clear(), hover(id|null), update(dt), idle(t) }
```
- `focus(id)`: tween non-focused materials to opacity 0.25 (400 ms), focused emissive 1.5x, add an additive glow sprite at the anchor. `hover(id)`: emissive 1.25x, marker 1.15x, never dims.
- Markers: camera-facing `Sprite` per anchor, aqua `#5FD0D8` pulsing ring (scale 1 to 1.6, opacity 1 to 0, 1.6 s loop, staggered), gold core idle, aqua when active. `screenPos().visible` is computed by raycasting to the anchor (false if occluded or on the far side).
- Reduced motion: no pulse (static ring), no float, `flyTo` / `flip` jump with duration 0, dim is instant.
- Idle: slow Y sway of +/-0.25 rad at 0.15 Hz and +/-0.15 float, stops on hover/focus, resumes 2 s after returning to overview. The sway is applied around whichever side is showing.
- Fly-to: 1000 ms. Controls disabled during tweens, a new call cancels the previous one. Focus range: distance 2 to 8, polar 30 to 150 degrees. Overview: distance 8 to 24, pan off.

### SOFTWARE ENG state machine (`ui.js`)
`createUI({ root, data })` returns `{ setState(s), on(evt, cb), setLabelPos(id, pos), setSide(side), showError(msg) }`. States `overview | hover | focused` with `{ state, hoverId, focusedId, side }`. UI emits `select(id)`, `back`, `hover(id|null)`, `flip(side)`. `main.js` connects them: `select(id)` -> flip to back if needed, `highlighter.focus(id)`, `hotspots.setActive(id)`, `await rig.flyTo(...)`; `back` reverses.
- Touch: first tap on a hotspot = hover + tooltip, second tap on the same = select; tap elsewhere clears.
- DOM: `<main id="stage">` with `<canvas id="gl">`, `#labels` layer (one `<button class="hs-label" data-id>` per component positioned from `screenPos`, keyboard focusable), `#tooltip` (role=tooltip), `<aside id="panel" class="glass-card" aria-live="polite">`; `<nav id="list">` with four `<button aria-pressed>`; a `#flip` toggle button (Front / Back); `#fallback` ordered list (shown if WebGL fails); `#loading` overlay with the logo.
- Esc exits focus and returns focus to the originating button.
- Desktop: canvas fills the viewport, panel is a right-side glass card 380 px wide. Mobile (<720 px): panel is a bottom sheet (max-height 45vh), list is a bottom row of icon-only pills, use `100dvh` and safe-area insets.
- Use existing classes (`.glass-card`, `.btn`, `.pill`, `.icon-btn`, `.eyebrow`, `.mono`) and tokens only; no drop shadow on buttons.

### Data (`data.js`)
```js
export const COMPONENTS = { touch: { id, name, short, tag, body:[...], facts:[{k,v}] }, ... }
```
All claims from `hardware/README.md`:
- **Touch sensor** (D4): tooltip "Tap to check in 'I'm OK'. During an alarm, the phone PIN is needed instead." The optional joystick can enter a gesture PIN.
- **Buzzer** (D8): tooltip "Chirps on a nudge, sounds a loud alarm, then beeps every 6 s until your contact says they're on it." Can be muted with `SILENT 1` for quiet rooms.
- **Barometer / temperature** (I2C; DPS310, or BMP280/BME280): tooltip "Reads temperature and pressure every 10 s." At 5 C or below the server adds a "likely outside in the cold" signal.
- **Arduino Uno R4 WiFi**: tooltip "The brain. Talks to the server over WiFi or a USB link and drives the LED matrix." LED matrix: a fuse burning down to the next check-in, `?` on a nudge, `!` on alarm, an arrow once the contact is on the way, a check when cancelled. USB link: `npm run switch-bridge` relays when there is no WiFi.
Do not invent battery life, sizes or other specs.

## 3. Workstreams and acceptance

Strict file ownership; nobody edits another workstream's files. Cross-issues go through the MANAGER.

**3D DEV** (`geometry.js`, `materials.js`; may add and later delete `public/necklace/_dev3d.html`): chain, wings, pave, center stone, pear gem, the PCB back with traces/pads/silkscreen and the four mounted components, anchors with focus data, lighting, `lowPower`. Acceptance: all four parts/anchors exist and are named correctly; front view reads as the reference jewelry (wings swept up, pear gem below, center stone at top); back view clearly reads as a hardware sensor board with the four components visible; each component visible and un-occluded from the back view; under 150k triangles; no console errors.

**ANIMATOR** (`camera.js`, `hotspots.js`, `highlight.js`): tween, camera rig, flip, markers, picking, highlight/dim, idle, reduced motion. Acceptance: `flyTo` resolves in at most 1.1 s with the anchor within 15% of viewport centre; `flip` takes about 700 ms; `flyHome` returns to default; dim/glow visible and reversed by `clear()`; markers pulse and occluded markers report `visible:false`; with `prefers-reduced-motion` nothing animates over time; controls never stuck disabled after interrupted tweens.

**SOFTWARE ENG** (`necklace.html`, `data.js`, `ui.js`, `main.js`, `necklace.css`, `smoke.mjs`, nav link): shell, import map, header with `NOS.logo` and a Back link to `/me.html`, state machine, tooltips (flip at viewport edges), detail panel, keyboard list and aria, Front/Back toggle and `F` key, mobile layout and two-tap, loading and WebGL fallback, main wiring (`renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`, pause on `visibilitychange`), smoke script (fetch `/necklace.html`, `/vendor/three/three.module.js` and each `/necklace/*.js`, assert 200 and all four IDs in `data.js`). Acceptance: correct tooltip text for each of the four; click/tap zooms under 1.2 s and opens the panel with that component's content and dims the rest; Back, Esc and background click return to overview; keyboard Tab/Enter/Esc work; 375 px wide with no horizontal scroll; fallback shows with WebGL disabled and no uncaught errors; no console errors.

**MANAGER**
- Step 0 (sequential): vendor three r160 files into `public/vendor/three/` (verify r160 and that imports resolve); confirm the contracts are in all three workstream briefs.
- Step 1 (parallel): launch the three specialists. ANIMATOR and SOFTWARE ENG develop against a stub `buildNecklace()` returning simple parts at the anchor positions, behind a `?stub=1` flag inside `main.js`; remove it at the end.
- Step 2: integrate; swap stub for real `geometry.js`; tune `focus` offsets with the 3D DEV (only the 3D DEV edits them).
- Step 3: QA in a browser at desktop and 375 px, and once with `prefers-reduced-motion`; send fixes back to the owner.
- Step 4: run the smoke script; commit on `necklace-3d` with the `Co-Authored-By` attribution line.

## 4. Risks
Refraction cost on mobile (use `lowPower`); label occlusion (`screenPos().visible`, list buttons always available); hotspots hidden at some angles (anchors on the back plate, click always flies to a facing offset); CDN offline (vendored); import map ordering (put in `<head>` before any module script); OrbitControls fighting tweens (disable and cancel); touch ambiguity (44 px targets, two-tap); performance (InstancedMesh, pixel ratio cap 2, pause when hidden).

## 5. Decisions made
Vendor three r160 with an import map; cm units with +Y up, +Z toward the viewer; ids `touch|buzzer|baro|brain`; hand-written easeInOutCubic tween, no tween library; no post-processing outline (emissive + dim + glow sprite); DOM labels, not CSS2DRenderer; plain CSS; page at `/necklace.html`, linked from `me.html`; mobile uses a bottom sheet and two-tap; the back is an exposed PCB with the components mounted on it.
