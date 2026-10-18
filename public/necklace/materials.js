// Materials and lighting for the necklace (owner: 3D DEV).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gemEnv } from './gem.js';

export const COLORS = {
  gold: 0xd8c08a,
  goldDeep: 0xb99d62,
  goldLight: 0xe8d7a8,
  mask: 0x0e1a33,
  trace: 0xd1b896,
  silk: 0xc9d3e6,
  aqua: 0x5fd0d8,
};


// Extra bright gradient strips inside the room environment so polished gold shows sweeping reflections.
function addEnvStrips(envScene) {
  const strip = (w, h, rgb, k, x, y, z) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0] * k, rgb[1] * k, rgb[2] * k), side: THREE.DoubleSide, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  strip(0.5, 5.0, [1.0, 0.93, 0.8], 6, -2.6, 0.8, 1.6);   // tall warm softbox, left
  strip(0.35, 5.0, [0.8, 0.92, 1.0], 5, 2.7, 0.6, 1.0);   // tall cool strip, right
  strip(3.2, 0.3, [1.0, 1.0, 1.0], 7, 0.0, 2.9, 1.2);     // overhead bar
  strip(2.4, 0.25, [1.0, 0.85, 0.6], 4, 0.0, -1.8, 2.2);  // low warm bounce
  strip(0.3, 3.5, [1, 1, 1], 5, 0.0, 0.5, -2.8);          // rim strip behind
}

function addGemStrips(envScene) {
  const bar = (w, h, rgb, k, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0] * k, rgb[1] * k, rgb[2] * k), side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m);
  };
  bar(0.35, 4.0, [1, 1, 1], 14, -1.6, 0.4, 2.2);
  bar(0.35, 4.0, [1, 0.95, 0.85], 12, 1.7, 0.2, 2.0);
  bar(2.6, 0.22, [1, 1, 1], 16, 0, 2.5, 1.0);
  bar(2.2, 0.2, [0.85, 0.93, 1], 10, 0, -2.2, 1.6);
  bar(0.3, 3.0, [1, 1, 1], 10, -2.6, 0.2, -1.0);
  bar(0.3, 3.0, [1, 1, 1], 10, 2.6, 0.2, -1.0);
  bar(1.6, 0.25, [1, 1, 1], 12, 0, 0.0, -2.8);
}

// Procedural fine brushed-line map (grey, lines run along +u). Returns a CanvasTexture.
let _brush;
function brushTexture() {
  if (_brush) return _brush;
  const W = 256, H = 256, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  c.fillStyle = '#9a9a9a'; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 520; i++) {
    const y = rnd() * H, x = rnd() * W, len = 30 + rnd() * 150, v = 110 + Math.floor(rnd() * 110);
    c.strokeStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.4})`;
    c.lineWidth = 0.6 + rnd() * 0.9;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y + (rnd() - 0.5) * 0.8); c.stroke();
    if (x + len > W) { c.beginPath(); c.moveTo(x - W, y); c.lineTo(x - W + len, y); c.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.7, 0.7);
  t.anisotropy = 4;
  _brush = t;
  return t;
}

/** PMREM room environment, key + rim lights, ACES tone mapping, sRGB output. */
export function setupLighting(scene, renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  addEnvStrips(envScene);
  const envTex = pmrem.fromScene(envScene, 0.04).texture;
  scene.environment = envTex;
  // Environment cube for the diamond shader: same room + brighter, more numerous strips so facets flash.
  try {
    addGemStrips(envScene);
    const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    new THREE.CubeCamera(0.1, 100, cubeRT).update(renderer, envScene);
    gemEnv.texture = cubeRT.texture;
  } catch (e) { console.error('[necklace] gem environment failed', e); }
  envScene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x1a1f2e, 0.25);
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
  key.position.set(4, 6, 9);
  const rim = new THREE.DirectionalLight(0x9fe8ee, 1.4);
  rim.position.set(-6, 3, -4);
  const fill = new THREE.DirectionalLight(0xffe9d0, 0.7);
  fill.position.set(-5, -2, 8);
  scene.add(hemi, key, rim, fill);
  return { env: envTex, key, rim, fill, hemi };
}

/** Canvas text decal material. items: [{text,x,y,size,color?,align?,weight?}] in cm, centered, y up. */
export function makeTextMaterial(items, wCm, hCm, { pxPerCm = 260, color = '#C9D3E6', glow = 0.45 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(8, Math.ceil(wCm * pxPerCm));
  cv.height = Math.max(8, Math.ceil(hCm * pxPerCm));
  const ctx = cv.getContext('2d');
  ctx.textBaseline = 'middle';
  for (const it of items) {
    ctx.fillStyle = it.color || color;
    ctx.textAlign = it.align || 'center';
    ctx.font = `${it.weight || 700} ${Math.round(it.size * pxPerCm)}px Menlo, "SF Mono", Consolas, "Courier New", monospace`;
    ctx.fillText(it.text, cv.width / 2 + it.x * pxPerCm, cv.height / 2 - it.y * pxPerCm);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.MeshStandardMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: glow,
    transparent: true,
    roughness: 0.7,
    metalness: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export function createMaterials({ lowPower = false } = {}) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const GOLD = 0xe3cc96;
  const phys = (o) => new THREE.MeshPhysicalMaterial(lowPower
    ? { color: o.color, metalness: 1, roughness: Math.max(o.roughness, 0.22), envMapIntensity: o.env }
    : { color: o.color, metalness: 1, roughness: o.roughness, envMapIntensity: o.env, clearcoat: 0.6, clearcoatRoughness: 0.08, anisotropy: 0.35, anisotropyRotation: o.rot || 0.5, sheen: 0 });
  const gold = phys({ color: GOLD, roughness: 0.17, env: 1.25 });
  // satin brushed feather faces; one instance per feather angle so the brushing follows the feather (cached)
  const featherCache = new Map();
  const feather = (angDeg, tone = 0) => {
    const key = angDeg.toFixed(1) + ':' + tone;
    if (featherCache.has(key)) return featherCache.get(key);
    const col = [0xe3cc96, 0xebd9ae, 0xd6bd85][tone] || GOLD;
    const m = phys({ color: col, roughness: lowPower ? 0.25 : 0.34, env: 1.2, rot: (angDeg * Math.PI) / 180 });
    if (!lowPower) {
      const t = brushTexture().clone();
      t.needsUpdate = true;
      t.center.set(0.5, 0.5);
      t.rotation = (angDeg * Math.PI) / 180;
      m.roughnessMap = t;
      m.bumpMap = t;
      m.bumpScale = 0.9;
    }
    featherCache.set(key, m);
    return m;
  };
  const M = {
    gold,
    goldBase: phys({ color: 0xd9c188, roughness: 0.16, env: 1.2 }),
    goldDeep: phys({ color: 0xd6bd85, roughness: 0.2, env: 1.2 }),
    goldLight: phys({ color: 0xedddb4, roughness: 0.18, env: 1.3 }),
    chain: phys({ color: GOLD, roughness: 0.13, env: 1.35 }),
    feather,
    pave: lowPower
      ? std({ color: 0xffffff, roughness: 0.05, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.4, envMapIntensity: 3, flatShading: true })
      : new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, metalness: 0, emissive: 0xeaf1ff, emissiveIntensity: 0.05, envMapIntensity: 2.4, flatShading: true, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.4, iridescenceIOR: 1.8 }),
    centerStone: std({ color: 0xffffff, roughness: 0.04, metalness: 0.05, emissive: 0xeaf1ff, emissiveIntensity: 0.85, envMapIntensity: 2.4, flatShading: true }),
    engrave: phys({ color: 0xb0914f, roughness: 0.38, env: 0.9 }),
    gem: lowPower
      ? new THREE.MeshPhysicalMaterial({ color: 0xf6faff, roughness: 0.04, metalness: 0, emissive: 0xe4eeff, emissiveIntensity: 0.28, transparent: true, opacity: 0.92, envMapIntensity: 3.0, flatShading: true, clearcoat: 1 })
      : new THREE.MeshPhysicalMaterial({
          color: 0xffffff, roughness: 0.02, metalness: 0, transmission: 0.75, thickness: 1.5, ior: 1.5,
          emissive: 0xcfe0ff, emissiveIntensity: 0.0, envMapIntensity: 1.3, side: THREE.DoubleSide, flatShading: true, clearcoat: 1, clearcoatRoughness: 0.03,
          specularIntensity: 1, attenuationColor: new THREE.Color(0xe8f6ff), attenuationDistance: 6,
        }),
    // PCB
    maskEdge: std({ color: COLORS.mask, roughness: 0.4, metalness: 0.1 }),
    modBlue: std({ color: 0x14407a, roughness: 0.45, metalness: 0.1 }),
    modTeal: std({ color: 0x0f4f5e, roughness: 0.45, metalness: 0.1 }),
    unoTeal: std({ color: 0x0b6672, roughness: 0.4, metalness: 0.1 }),
    black: std({ color: 0x0b0b0e, roughness: 0.45, metalness: 0.2 }),
    canBlack: std({ color: 0x1b1b21, roughness: 0.32, metalness: 0.25 }),
    canTop: std({ color: 0x2a2a32, roughness: 0.3, metalness: 0.3 }),
    hole: std({ color: 0x000000, roughness: 1, metalness: 0 }),
    silver: std({ color: 0xc3c8d0, roughness: 0.3, metalness: 1, envMapIntensity: 1.2 }),
    copper: std({ color: 0xc7774b, roughness: 0.3, metalness: 1, envMapIntensity: 1.2 }),
    pin: std({ color: COLORS.trace, roughness: 0.25, metalness: 1, envMapIntensity: 1.2, emissive: 0x8a7548, emissiveIntensity: 0.6 }),
    aqua: std({ color: COLORS.aqua, emissive: COLORS.aqua, emissiveIntensity: 1.6, roughness: 0.5 }),
    ledOn: std({ color: 0x0a2a2e, emissive: COLORS.aqua, emissiveIntensity: 2.2, roughness: 0.5 }),
    ledOff: std({ color: 0x14181c, roughness: 0.6, metalness: 0 }),
    maskDark: std({ color: 0x07101f, roughness: 0.5 }),
  };
  return M;
}
