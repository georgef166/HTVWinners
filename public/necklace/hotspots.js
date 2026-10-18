// hotspots.js (ANIMATOR): camera-facing marker sprites, picking, hover/select/background events,
// occlusion-aware screen projection.
//
// Notes:
//  - Marker sprites live in a Group added to `scene` (userData.isMarker = true, userData.id = null,
//    userData.markerId = <component id>). Their raycast is disabled so they never hit generic raycasts.
//  - Markers are constant screen size (sizeAttenuation=false) and picked in screen space (20 px mouse,
//    28 px touch radius) before falling back to a mesh raycast against everything under root.
//  - When setVisible(false): markers hidden, pick() returns null and hover/select are not emitted
//    ('background' still is, for taps on empty space).
//  - 'select' callbacks receive (id, {pointerType, clientX, clientY}) so the UI can do two-tap on touch.
import * as THREE from 'three';

const AQUA = '#5FD0D8', GOLD = '#D1B896', NAVY = 'rgba(14,26,51,0.95)';

function canvasTex(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const coreTex = (color) => canvasTex((g) => {
  g.beginPath(); g.arc(64, 64, 40, 0, Math.PI * 2);
  g.fillStyle = NAVY; g.fill();
  g.beginPath(); g.arc(64, 64, 32, 0, Math.PI * 2);
  const gr = g.createRadialGradient(56, 54, 4, 64, 64, 32);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, color); gr.addColorStop(1, color);
  g.fillStyle = gr; g.fill();
});
const ringTex = () => canvasTex((g) => {
  g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2);
  g.lineWidth = 6; g.strokeStyle = AQUA; g.stroke();
});

export function createHotspots({ scene, camera, canvas, anchors, parts, reducedMotion = false }) {
  const rm = !!reducedMotion;
  const ids = Object.keys(anchors);
  const listeners = { hover: [], select: [], background: [] };
  const emit = (ev, ...a) => listeners[ev].forEach((cb) => { try { cb(...a); } catch (e) { console.error(e); } });

  const group = new THREE.Group();
  group.name = 'hotspot-markers';
  scene.add(group);

  const goldTex = coreTex(GOLD), aquaTex = coreTex(AQUA), ring = ringTex();
  const mk = (map, order) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false,
    }));
    s.renderOrder = order; s.frustumCulled = false;
    s.userData.isMarker = true; s.userData.id = null;
    s.raycast = () => {};
    group.add(s);
    return s;
  };
  const markers = {};
  ids.forEach((id, i) => {
    const core = mk(goldTex, 1001), rg = mk(ring, 1000);
    core.userData.markerId = rg.userData.markerId = id;
    markers[id] = { id, core, ring: rg, phase: i * 0.37, fade: 0, hoverK: 0, occluded: false };
  });

  let visible = true, activeId = null, hoverId = null, pointerType = 'mouse';
  const root = (ids.length && anchors[ids[0]].parent) || scene;

  // ---- projection / occlusion -------------------------------------------------------------
  const _p = new THREE.Vector3(), _d = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  let occluders = [], occStamp = -1e9, listStamp = -1e9;
  const now = () => performance.now();

  function refreshOccluders(force) {
    if (!force && now() - listStamp < 400) return;
    listStamp = now();
    occluders = [];
    root.updateWorldMatrix(true, true);
    root.traverseVisible((o) => {
      if (o.isMesh && !o.userData.isGlowSprite && !o.userData.isMarker) occluders.push(o);
    });
  }
  const cache = {};
  function project(id) {
    anchors[id].getWorldPosition(_p);
    _d.copy(_p).project(camera);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return {
      x: (_d.x * 0.5 + 0.5) * w, y: (-_d.y * 0.5 + 0.5) * h, world: _p.clone(),
      inView: _d.z < 1 && _d.z > -1 && Math.abs(_d.x) < 1.05 && Math.abs(_d.y) < 1.05,
    };
  }
  function refreshOcclusion(force) {
    if (!force && now() - occStamp < 80) return;
    occStamp = now();
    camera.updateMatrixWorld();
    refreshOccluders(force);
    ids.forEach((id) => {
      const r = project(id);
      let occ = !r.inView;
      if (!occ) {
        const dir = r.world.clone().sub(camera.position);
        const dist = dir.length();
        ray.set(camera.position, dir.divideScalar(dist));
        ray.near = 0; ray.far = Math.max(0, dist - 0.25);
        occ = ray.intersectObjects(occluders, false).length > 0;
      }
      cache[id] = r; markers[id].occluded = occ;
    });
  }

  function screenPos(id) {
    if (!anchors[id]) return { x: 0, y: 0, visible: false };
    refreshOcclusion(false);
    const c = project(id); // fresh x/y every call, occlusion refreshed at ~12 Hz
    return { x: c.x, y: c.y, visible: c.inView && !markers[id].occluded };
  }

  // ---- picking ----------------------------------------------------------------------------
  function pick(clientX, clientY) {
    if (!visible) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    refreshOcclusion(false);
    const rad = pointerType === 'touch' ? 28 : 20;
    let best = null, bd = rad;
    for (const id of ids) {
      const sp = screenPos(id);
      if (!sp.visible) continue;
      const d = Math.hypot(sp.x - x, sp.y - y);
      if (d < bd) { bd = d; best = id; }
    }
    if (best) return best;
    ray.setFromCamera(new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1), camera);
    ray.near = 0; ray.far = Infinity;
    refreshOccluders(false);
    const hit = ray.intersectObjects(occluders, false)[0];
    if (!hit) return null;
    for (let o = hit.object; o; o = o.parent) {
      const oid = o.userData && o.userData.id;
      if (typeof oid === 'string' && parts[oid]) return oid;
      if (o === root) break;
    }
    return null;
  }

  // ---- pointer events ---------------------------------------------------------------------
  let down = null, hoverRaf = 0, lastMove = null;
  const setHoverInternal = (id) => {
    if (id === hoverId) return;
    hoverId = id;
    canvas.style.cursor = id ? 'pointer' : '';
    emit('hover', id);
  };
  const onDown = (e) => {
    pointerType = e.pointerType || 'mouse';
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, t: now() };
  };
  const onMove = (e) => {
    pointerType = e.pointerType || 'mouse';
    if (down && down.id === e.pointerId) {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > (pointerType === 'touch' ? 10 : 6)) down.moved = true;
    }
    if (e.buttons || pointerType === 'touch') return; // dragging/orbiting or touch: no hover
    lastMove = e;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (lastMove) setHoverInternal(visible ? pick(lastMove.clientX, lastMove.clientY) : null);
    });
  };
  const onUp = (e) => {
    if (!down || down.id !== e.pointerId) return;
    const d = down; down = null;
    pointerType = e.pointerType || 'mouse';
    if (d.moved || e.type === 'pointercancel') return;
    const id = pick(e.clientX, e.clientY);
    if (id) emit('select', id, { pointerType, clientX: e.clientX, clientY: e.clientY });
    else emit('background', { pointerType, clientX: e.clientX, clientY: e.clientY });
  };
  const onLeave = () => { if (!down) setHoverInternal(null); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);

  // ---- per-frame --------------------------------------------------------------------------
  function update(t, dt) {
    refreshOcclusion(false);
    const h = canvas.clientHeight || 1;
    const k = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / h; // px -> sprite scale
    for (const id of ids) {
      const m = markers[id];
      m.core.position.copy(cache[id] ? cache[id].world : anchors[id].getWorldPosition(_p));
      m.ring.position.copy(m.core.position);
      const target = visible && !m.occluded ? 1 : 0;
      m.fade = rm ? target : m.fade + (target - m.fade) * Math.min(1, dt * 10);
      if (Math.abs(m.fade - target) < 0.01) m.fade = target;
      const on = id === activeId, hov = id === hoverId;
      m.hoverK = rm ? (hov ? 1 : 0) : m.hoverK + ((hov ? 1 : 0) - m.hoverK) * Math.min(1, dt * 12);
      const coreScale = 1 + 0.15 * m.hoverK;
      m.core.material.map = on ? aquaTex : goldTex;
      m.core.scale.setScalar(26 * coreScale * k);
      let rs, ro;
      if (rm) { rs = 1.3; ro = 0.6; }
      else {
        const ph = (((t / 1.6) + m.phase) % 1 + 1) % 1;
        rs = 1 + 0.6 * ph; ro = 1 - ph;
      }
      m.ring.scale.setScalar(44 * rs * coreScale * k);
      m.ring.material.opacity = ro * m.fade;
      m.core.material.opacity = m.fade;
      m.core.visible = m.ring.visible = m.fade > 0.01;
    }
    group.visible = visible;
  }

  return {
    setVisible(v) { visible = !!v; group.visible = visible; if (!visible) setHoverInternal(null); },
    setActive(id) { activeId = id || null; },
    setHover(id) { hoverId = id || null; },
    update, pick, screenPos,
    on(event, cb) {
      (listeners[event] || (listeners[event] = [])).push(cb);
      return () => { listeners[event] = listeners[event].filter((f) => f !== cb); };
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      scene.remove(group);
    },
  };
}
