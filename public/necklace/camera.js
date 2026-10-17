// camera.js (ANIMATOR): tween helper + camera rig (OrbitControls glue, fly-to, flip).
//
// Conventions shared with highlight.js:
//   root.userData.baseRotY  - the flip angle (0 front / PI back), animated live by flip().
//   root.userData.baseY     - root's resting y (captured at rig creation).
//   root.userData.swayRotY  - extra idle sway (radians) written by highlight.js; flip() adds it so
//                             the two never fight: root.rotation.y = baseRotY + swayRotY.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const easeInOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/**
 * tween(from, to, ms, ease = easeInOutCubic, onUpdate(value, k)) -> Promise<boolean> with .cancel()
 *  - from/to: both numbers, OR both THREE.Vector3 (copied; onUpdate receives ONE reused Vector3,
 *    do not keep it - copy it).
 *  - onUpdate is always called with the end value on completion (also when ms <= 0, synchronously).
 *  - Promise resolves true when finished, false when cancel()led (never rejects).
 *  - Driven by requestAnimationFrame + performance.now, with a timer fallback for hidden tabs.
 */
export function tween(from, to, ms, ease = easeInOutCubic, onUpdate = () => {}) {
  ease = ease || easeInOutCubic;
  const isVec = !!(from && from.isVector3);
  const a = isVec ? from.clone() : from;
  const b = isVec ? to.clone() : to;
  const out = isVec ? new THREE.Vector3() : 0;
  const emit = (k) => {
    const e = k >= 1 ? 1 : ease(k);
    if (isVec) { out.lerpVectors(a, b, e); onUpdate(out, k); } else onUpdate(a + (b - a) * e, k);
  };
  let state = 'run', resolveFn, raf = 0, timer = 0;
  const p = new Promise((res) => { resolveFn = res; });
  const finish = (ok) => {
    if (state !== 'run') return;
    state = ok ? 'done' : 'cancelled';
    cancelAnimationFrame(raf); clearTimeout(timer);
    if (ok) emit(1);
    resolveFn(ok);
  };
  p.cancel = () => finish(false);
  if (!(ms > 0)) { finish(true); return p; }
  const t0 = performance.now();
  const step = () => {
    if (state !== 'run') return;
    const k = (performance.now() - t0) / ms;
    if (k >= 1) return finish(true);
    emit(k);
    raf = requestAnimationFrame(step);
  };
  emit(0);
  raf = requestAnimationFrame(step);
  timer = setTimeout(() => finish(true), ms + 60);
  return p;
}

const DEG = Math.PI / 180;
const HOME_POS = new THREE.Vector3(0, -1, 16);
const HOME_TARGET = new THREE.Vector3(0, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export function createCameraRig({ camera, renderer, root, reducedMotion = false }) {
  const rm = !!reducedMotion;
  camera.fov = 35;
  camera.position.copy(HOME_POS);
  camera.updateProjectionMatrix();
  camera.lookAt(HOME_TARGET);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !rm;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.target.copy(HOME_TARGET);

  root.userData.baseRotY = root.userData.baseRotY ?? root.rotation.y;
  root.userData.baseY = root.userData.baseY ?? root.position.y;
  let side = Math.cos(root.userData.baseRotY) < 0 ? 'back' : 'front';
  let mode = 'overview';

  function setLimits(m) {
    if (m === 'focus') {
      controls.minDistance = 2; controls.maxDistance = 8;
      controls.minPolarAngle = 30 * DEG; controls.maxPolarAngle = 150 * DEG;
    } else if (m === 'overview') {
      controls.minDistance = 8; controls.maxDistance = 24;
      controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI;
    } else { // 'free' while tweening, so controls.update() never snaps the camera
      controls.minDistance = 0.1; controls.maxDistance = 100;
      controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI;
    }
    controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
  }
  setLimits('overview');
  controls.update();

  // Two independent tween slots; a new call in a slot cancels the previous one in that slot.
  const slots = { cam: null, flip: null };
  const refresh = () => { controls.enabled = !(slots.cam || slots.flip); }; // derived => never stuck

  function run(name, ms, onUpdate, onEnd) {
    if (slots[name]) slots[name].cancel();
    ms = rm ? 0 : ms;
    if (!(ms > 0)) {
      slots[name] = null; onUpdate(1); onEnd(); refresh();
      return Promise.resolve(true);
    }
    const p = tween(0, 1, ms, easeInOutCubic, onUpdate);
    slots[name] = p; refresh();
    return p.then((ok) => {
      if (slots[name] === p) slots[name] = null;
      if (ok) onEnd();
      refresh();
      return ok;
    });
  }

  function moveCamera(pos, target, ms, newMode) {
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const p1 = pos.clone(), t1 = target.clone();
    setLimits('free');
    return run('cam', ms, (k) => {
      // k is already eased (run() uses tween(0,1,...,easeInOutCubic))
      camera.position.lerpVectors(p0, p1, k);
      controls.target.lerpVectors(t0, t1, k);
      camera.lookAt(controls.target);
    }, () => {
      camera.position.copy(p1); controls.target.copy(t1);
      mode = newMode; setLimits(mode); camera.lookAt(controls.target); controls.update();
    });
  }

  // Root transform at the *target* flip side with no sway/float, so fly-to is exact even mid-flip/sway.
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
  function canonicalMatrix() {
    _q.setFromAxisAngle(Y_AXIS, side === 'back' ? Math.PI : 0);
    _v.set(root.position.x, root.userData.baseY, root.position.z);
    _m.compose(_v, _q, root.scale);
    if (root.parent) { root.parent.updateWorldMatrix(true, false); _m.premultiply(root.parent.matrixWorld); }
    return _m;
  }

  /** flyTo(id, anchor, {duration}) -> Promise<boolean>. anchor.userData.focus = {offset, distance, lookAt}
   *  (root-local). Camera ends at lookAt + normalize(offset) * clamp(distance, 2, 8), looking at lookAt. */
  function flyTo(id, anchor, { duration = 1000 } = {}) {
    const f = (anchor && anchor.userData && anchor.userData.focus) || {};
    let look = f.lookAt ? f.lookAt.clone() : null;
    if (!look) {
      if (anchor) { root.updateWorldMatrix(true, true); look = root.worldToLocal(anchor.getWorldPosition(new THREE.Vector3())); }
      else look = new THREE.Vector3();
    }
    const dir = f.offset && f.offset.lengthSq() > 1e-8 ? f.offset.clone().normalize() : new THREE.Vector3(0, 0, -1);
    const dist = THREE.MathUtils.clamp(f.distance ?? (f.offset ? f.offset.length() : 4), 2, 8);
    const M = canonicalMatrix();
    const wLook = look.applyMatrix4(M);
    const wDir = dir.transformDirection(M);
    const sph = new THREE.Spherical().setFromVector3(wDir);
    sph.phi = THREE.MathUtils.clamp(sph.phi, 30 * DEG, 150 * DEG);
    wDir.setFromSpherical(sph);
    return moveCamera(wLook.clone().addScaledVector(wDir, dist), wLook, duration, 'focus');
  }

  /** flyHome({duration}) -> Promise<boolean>: default camera (0,-1,16), keeps current flip side. */
  function flyHome({ duration = 1000 } = {}) {
    return moveCamera(HOME_POS, HOME_TARGET, duration, 'overview');
  }

  /** flip('front'|'back', {duration=700}) -> Promise<boolean>. Rotates root about Y; camera fixed. */
  function flip(to, { duration = 700 } = {}) {
    side = to === 'back' ? 'back' : 'front';
    const a0 = root.userData.baseRotY, a1 = side === 'back' ? Math.PI : 0;
    const apply = (a) => {
      root.userData.baseRotY = a;
      root.rotation.y = a + (root.userData.swayRotY || 0);
    };
    return run('flip', duration, (k) => apply(a0 + (a1 - a0) * k), () => apply(a1));
  }

  // ---- view inset (shifts the projection centre to the unobstructed area) --------------------
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  let insetTween = null, appliedSize = '';
  const _sz = new THREE.Vector2();
  function applyInset(force) {
    renderer.getSize(_sz);
    const W = _sz.x, H = _sz.y;
    const key = `${W}x${H}|${inset.top}|${inset.right}|${inset.bottom}|${inset.left}`;
    if (!force && key === appliedSize) return;
    appliedSize = key;
    if (!(W > 0 && H > 0)) return;
    if (!inset.top && !inset.right && !inset.bottom && !inset.left) {
      if (camera.view && camera.view.enabled) camera.clearViewOffset();
      return;
    }
    const cx = (inset.left + (W - inset.right)) / 2, cy = (inset.top + (H - inset.bottom)) / 2;
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
  }
  /** setViewInset({top,right,bottom,left}, {duration=400}) in CSS px -> Promise<boolean>. */
  function setViewInset({ top = 0, right = 0, bottom = 0, left = 0 } = {}, { duration = 400 } = {}) {
    if (insetTween) insetTween.cancel();
    const a = { ...inset }, b = { top, right, bottom, left };
    const set = (k) => { for (const n in b) inset[n] = a[n] + (b[n] - a[n]) * k; applyInset(false); };
    if (rm || !(duration > 0)) { insetTween = null; set(1); return Promise.resolve(true); }
    const p = insetTween = tween(0, 1, duration, easeInOutCubic, set);
    return p.then((ok) => { if (insetTween === p) insetTween = null; return ok; });
  }

  return {
    controls,
    setViewInset,
    flyTo,
    flyHome,
    flip,
    getSide: () => side,
    getMode: () => mode,
    isBusy: () => !!(slots.cam || slots.flip),
    update(dt) { applyInset(false); if (!slots.cam) controls.update(); },
  };
}
