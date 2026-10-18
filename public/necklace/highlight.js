// highlight.js (ANIMATOR): dim / glow / hover emissive effects + idle sway of the root.
//
// Conventions:
//  - Anchor lookup for the glow sprite: options.anchors?.[id], else root.userData.anchors?.[id], else the
//    first object under root with userData.focus whose userData.id === id, userData.anchorId === id or
//    whose name contains the id; else falls back to the centre of parts[id]'s bounding box.
//  - Glow sprite is a child of the anchor with userData.isGlowSprite = true.
//  - Materials shared between different parts / non-components are cloned per owner once at creation so
//    effects never leak (originals stay on the first owner; clones are visually identical).
//  - Call idle(t) EVERY frame (t in seconds). It sways only when not focused/hovered (and 2 s after
//    release); otherwise it eases back to rest. It writes root.rotation.y = baseRotY + sway and
//    root.userData.swayRotY = sway (camera.js adds swayRotY during flips). Float uses root.userData.baseY.
import * as THREE from 'three';

const AQUA = new THREE.Color('#5FD0D8');
const approach = (v, t, step) => (v < t ? Math.min(t, v + step) : Math.max(t, v - step));

let glowTex = null;
function getGlowTex() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(180,245,250,1)');
  gr.addColorStop(0.3, 'rgba(95,208,216,0.55)');
  gr.addColorStop(1, 'rgba(95,208,216,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export function createHighlighter({ root, parts, anchors: anchorOpt, reducedMotion = false }) {
  const rm = !!reducedMotion;
  const partIds = Object.keys(parts);

  // ---- collect materials per owner ----------------------------------------------------------
  const states = new Map(); // material -> state
  const ownerOf = new Map(); // original material -> owner key
  const cloneCache = new Map(); // `${uuid}|${owner}` -> clone

  const partMeshes = new Map(); // object -> owner id
  partIds.forEach((id) => parts[id].traverse((o) => partMeshes.set(o, id)));
  const _box = new THREE.Box3(), _c = new THREE.Vector3();
  // Non-component meshes on the front side (root-space bbox centre z > -0.2) get owner '*F' and are
  // faded to ~0.03 when focused so they don't ghost through the translucent PCB; the rest dim to 0.25.
  const frontMeshes = [];
  function ownerFor(o) {
    const p = partMeshes.get(o);
    if (p) return p;
    // PCB plate (flagged in geometry.js) dims to 0.25; everything else non-component is front jewelry and fades out
    for (let a = o; a && a !== root; a = a.parent) if (a.userData && a.userData.pcb) return '*P';
    return '*F';
  }

  function register(mat, owner) {
    if (states.has(mat)) return mat;
    states.set(mat, {
      mat, owner,
      orig: {
        opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite,
        col: mat.color && mat.color.isColor ? mat.color.clone() : null,
        hasEm: !!(mat.emissive && mat.emissive.isColor),
        em: mat.emissive && mat.emissive.isColor ? mat.emissive.clone() : null,
        emI: mat.emissiveIntensity,
      },
      level: owner === '*F' ? 0.03 : 0.25, dimK: 0, dimT: 0, emK: 1, emT: 1,
      applied: { dim: 0, em: 1 },
    });
    return mat;
  }
  root.traverse((o) => {
    if (!(o.isMesh || o.isLine || o.isPoints) || !o.material || o.userData.isGlowSprite) return;
    const owner = ownerFor(o);
    if (owner === '*F') frontMeshes.push(o);
    const fix = (m) => {
      const prev = ownerOf.get(m);
      if (prev === undefined) { ownerOf.set(m, owner); return register(m, owner); }
      if (prev === owner) return m;
      const key = `${m.uuid}|${owner}`;
      if (!cloneCache.has(key)) cloneCache.set(key, register(m.clone(), owner));
      return cloneCache.get(key);
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  });

  // ---- anchors / glow ------------------------------------------------------------------------
  const anchorCache = {};
  function findAnchor(id) {
    if (anchorCache[id]) return anchorCache[id];
    let a = (anchorOpt && anchorOpt[id]) || (root.userData.anchors && root.userData.anchors[id]) || null;
    if (!a) {
      root.traverse((o) => {
        if (a || !o.userData || !o.userData.focus) return;
        if (o.userData.id === id || o.userData.anchorId === id || (o.name || '').toLowerCase().includes(id)) a = o;
      });
    }
    if (!a) {
      root.updateWorldMatrix(true, true);
      const c = new THREE.Box3().setFromObject(parts[id]).getCenter(new THREE.Vector3());
      a = new THREE.Object3D();
      a.position.copy(root.worldToLocal(c));
      root.add(a);
    }
    return (anchorCache[id] = a);
  }
  const glows = {}; // id -> {sprite, k}
  function glowFor(id) {
    if (glows[id]) return glows[id];
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, toneMapped: false,
    }));
    s.userData.isGlowSprite = true; s.userData.id = null;
    s.renderOrder = 998; s.scale.setScalar(2.4); s.visible = false;
    s.raycast = () => {};
    findAnchor(id).add(s);
    return (glows[id] = { sprite: s, k: 0 });
  }

  // ---- focus / hover state ------------------------------------------------------------------
  let focusId = null, hoverId = null, now = 0, releasedAt = -10, time = 0, frontK = 0;
  const applyFront = () => { const v = frontK < 0.99; for (const m of frontMeshes) m.visible = v; };

  function retarget() {
    for (const s of states.values()) {
      s.dimT = focusId && s.owner !== focusId ? 1 : 0;
      s.emT = s.owner === focusId ? 1.5 : s.owner === hoverId ? 1.25 : 1;
    }
    if (rm) settle();
  }
  function settle() { // reduced motion: jump straight to targets
    for (const s of states.values()) { s.dimK = s.dimT; s.emK = s.emT; apply(s); }
    for (const id in glows) { glows[id].k = id === focusId ? 1 : 0; applyGlow(id, 0); }
    frontK = focusId ? 1 : 0; applyFront();
  }

  function apply(s) {
    const m = s.mat, o = s.orig;
    if (s.owner === '*P') { // PCB plate: darken instead of fading, so overlapping coplanar shapes never show through each other
      if (s.applied.dim !== s.dimK) {
        s.applied.dim = s.dimK;
        const f = THREE.MathUtils.lerp(1, 0.3, s.dimK);
        if (o.col) m.color.copy(o.col).multiplyScalar(f);
        if (o.hasEm) m.emissiveIntensity = o.emI * f;
      }
      return;
    }
    if (s.applied.dim !== s.dimK) {
      s.applied.dim = s.dimK;
      const was = m.transparent;
      if (s.dimK > 0) {
        m.transparent = true; m.depthWrite = false;
        m.opacity = THREE.MathUtils.lerp(o.opacity, Math.min(o.opacity, s.level), s.dimK);
      } else { m.transparent = o.transparent; m.depthWrite = o.depthWrite; m.opacity = o.opacity; }
      if (was !== m.transparent) m.needsUpdate = true;
    }
    if (o.hasEm && s.applied.em !== s.emK) {
      s.applied.em = s.emK;
      const boost = s.emK - 1;
      if (boost <= 0) { m.emissive.copy(o.em); m.emissiveIntensity = o.emI; }
      else if (o.em.r + o.em.g + o.em.b > 0.03) { m.emissive.copy(o.em); m.emissiveIntensity = o.emI * s.emK; }
      else { m.emissive.copy(AQUA); m.emissiveIntensity = boost * 0.6; } // no emissive of its own: aqua tint
    }
  }
  function applyGlow(id, t) {
    const g = glows[id];
    const pulse = rm ? 1 : 0.9 + 0.1 * Math.sin(t * 4);
    g.sprite.material.opacity = 0.65 * g.k * pulse;
    g.sprite.scale.setScalar(rm ? 2.4 : 2.4 * (0.95 + 0.08 * Math.sin(t * 3)));
    g.sprite.visible = g.k > 0.005;
  }

  // ---- idle -----------------------------------------------------------------------------------
  let amp = 0;
  function idle(t) {
    time = t;
    const active = !rm && !focusId && !hoverId && now - releasedAt >= 2;
    const step = rm ? 1 : 0.025;
    amp = approach(amp, active ? 1 : 0, step);
    const baseRot = root.userData.baseRotY ?? 0, baseY = root.userData.baseY ?? 0;
    if (rm || amp === 0) {
      if (root.userData.swayRotY) { root.userData.swayRotY = 0; root.rotation.y = baseRot; root.position.y = baseY; }
      return;
    }
    const sway = 0.25 * Math.sin(2 * Math.PI * 0.15 * t) * amp;
    root.userData.swayRotY = sway;
    root.rotation.y = baseRot + sway;
    root.position.y = baseY + 0.15 * Math.sin(2 * Math.PI * 0.15 * t + 1.3) * amp;
  }

  return {
    focus(id) {
      if (!parts[id]) return;
      focusId = id; glowFor(id); retarget();
    },
    clear() {
      if (focusId || hoverId) releasedAt = now;
      focusId = null; hoverId = null; retarget();
    },
    hover(id) {
      const nid = id && parts[id] ? id : null;
      if (nid === hoverId) return;
      if (!nid) releasedAt = now;
      hoverId = nid; retarget();
    },
    update(dt) {
      now += dt;
      if (rm) { for (const id in glows) applyGlow(id, now); return; }
      const step = dt / 0.4;
      frontK = approach(frontK, focusId ? 1 : 0, step); applyFront();
      for (const s of states.values()) {
        if (s.dimK === s.dimT && s.emK === s.emT) continue;
        s.dimK = approach(s.dimK, s.dimT, step);
        s.emK = approach(s.emK, s.emT, step * 0.5 * 2);
        apply(s);
      }
      for (const id in glows) {
        const g = glows[id];
        g.k = approach(g.k, id === focusId ? 1 : 0, step);
        applyGlow(id, now);
      }
    },
    idle,
  };
}
