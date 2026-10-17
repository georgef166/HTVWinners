// Wiring for /necklace.html: renderer, loop, and glue between the UI (ui.js) and the 3D modules.
import * as THREE from 'three';
import * as data from './data.js';
import { createUI } from './ui.js';

const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const { IDS } = data;
const ui = createUI({ root: document.body, data });

const mm = (q) => (window.matchMedia ? matchMedia(q).matches : false);
const reducedMotion = mm('(prefers-reduced-motion: reduce)');
const lowPower = mm('(pointer:coarse)') || (devicePixelRatio > 2.5 && innerWidth < 768);
const stage = $('#stage'), canvas = $('#gl');

async function tryImport(path) {
  try { return await import(path); } catch (err) { console.warn(`[necklace] ${path} not available:`, err.message); return null; }
}

function fail(msg) {
  ui.showError(msg);
  console.warn('[necklace] fallback:', msg);
}

async function boot() {
  // ---- Renderer (WebGL check) ----
  let renderer;
  try {
    if (params.has('nogl')) throw new Error('forced by ?nogl');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    return fail('Your browser could not start 3D graphics, so here are the four sensors as a list.');
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fail('The 3D view was interrupted. Reload the page to try again.'); });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, -1, 16);
  camera.lookAt(0, 0, 0);

  // ---- Modules (real ones, with isolated stand-ins while teammates land) ----
  const [geo, mat, cam, hot, hi] = await Promise.all([
    tryImport('./geometry.js'),
    tryImport('./materials.js'),
    tryImport('./camera.js'),
    tryImport('./hotspots.js'),
    tryImport('./highlight.js'),
  ]);

  let built;
  try { built = geo?.buildNecklace ? geo.buildNecklace({ lowPower }) : null; }
  catch (err) { console.error('[necklace] buildNecklace failed', err); }
  if (!built) return fail('The 3D model could not be built, so here are the four sensors as a list.');
  const { root, anchors, parts } = built;
  scene.add(root);

  if (mat?.setupLighting) { try { mat.setupLighting(scene, renderer); } catch (e) { console.error(e); } }

  const rig = cam.createCameraRig({ camera, renderer, root, reducedMotion });
  const hotspots = hot.createHotspots({ scene, camera, canvas, anchors, parts, reducedMotion });
  const highlighter = hi.createHighlighter({ root, parts, reducedMotion });

  // ---- State ----
  let focusedId = null, hoverId = null, side = 'front', flipping = false, seq = 0;
  let lastPointer = 'mouse';
  canvas.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, true);
  hotspots.setVisible(false);

  function setHover(id) {
    if (focusedId) id = null;
    if (id === hoverId) return;
    hoverId = id;
    highlighter.hover(id);
    hotspots.setHover(id);
    ui.setState({ hoverId: id });
  }

  function applyInset(duration) {
    if (!rig.setViewInset) return;
    if (!focusedId) return rig.setViewInset({}, duration === undefined ? {} : { duration });
    const r = $('#panel').getBoundingClientRect(), m = 16;
    const inset = innerWidth < 720 ? { bottom: Math.round(r.height + m) } : { right: Math.round(r.width + m) };
    rig.setViewInset(inset, duration === undefined ? {} : { duration });
  }
  addEventListener('resize', () => { if (focusedId) applyInset(0); });

  async function select(id) {
    if (!IDS.includes(id)) return;
    const token = ++seq;
    setHover(null);
    focusedId = id;
    ui.setState({ focusedId: id });
    if (side !== 'back') {
      await doFlip('back', token);
      if (token !== seq) return;
    }
    highlighter.focus(id);
    hotspots.setActive(id);
    requestAnimationFrame(() => { if (token === seq) applyInset(); });
    await rig.flyTo(id, anchors[id]);
  }

  async function back() {
    if (!focusedId) return;
    ++seq;
    focusedId = null;
    highlighter.clear();
    hotspots.setActive(null);
    ui.setState({ focusedId: null });
    applyInset();
    await rig.flyHome({});
  }

  async function doFlip(to, token = ++seq) {
    flipping = true;
    hotspots.setVisible(false);
    side = to;
    ui.setSide(to);
    await rig.flip(to, {});
    if (token !== seq) { flipping = false; return; }
    flipping = false;
    hotspots.setVisible(to === 'back');
  }

  async function flip(to) {
    if (to === side && !flipping) return;
    if (focusedId) {
      const token = ++seq;
      focusedId = null; highlighter.clear(); hotspots.setActive(null); ui.setState({ focusedId: null }); applyInset();
      await Promise.all([rig.flyHome({}), to !== side ? doFlip(to, token) : null]);
      return;
    }
    await doFlip(to);
  }

  ui.on('select', select);
  ui.on('back', back);
  ui.on('hover', setHover);
  ui.on('flip', flip);
  hotspots.on('hover', setHover);
  hotspots.on('select', (id) => ui.tap(id, lastPointer));
  hotspots.on('background', () => { setHover(null); if (focusedId) back(); });

  // ---- Sizing ----
  function resize() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Portrait screens: widen the vertical field so the whole pendant and chain fit across.
    camera.fov = camera.aspect < 0.75 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(35 / 2)) * 0.75 / camera.aspect)) : 35;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---- Loop ----
  const clock = new THREE.Clock();
  let t = 0, first = true;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    t += dt;
    rig.update(dt);
    highlighter.update(dt);
    if (!focusedId && !hoverId && !flipping) highlighter.idle(t);
    hotspots.update(t, dt);
    for (const id of IDS) {
      const p = hotspots.screenPos(id);
      ui.setLabelPos(id, p && !flipping && side === 'back' ? p : { x: 0, y: 0, visible: false });
    }
    renderer.render(scene, camera);
    if (first) {
      first = false;
      const l = $('#loading');
      l.classList.add('is-done');
      setTimeout(() => l.setAttribute('hidden', ''), 550);
    }
  }
  renderer.setAnimationLoop(frame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) renderer.setAnimationLoop(null);
    else { clock.getDelta(); renderer.setAnimationLoop(frame); }
  });

  window.__nk = { select, back, flip, getState: () => ({ focusedId, hoverId, side, flipping }), camera, rig, root, anchors, parts, hotspots };
}

boot().catch((err) => {
  console.error('[necklace] boot failed', err);
  fail('Something went wrong starting the 3D view, so here are the four sensors as a list.');
});
