// Materials and lighting for the necklace (owner: 3D DEV).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const COLORS = {
  gold: 0xd8c08a,
  goldDeep: 0xb99d62,
  goldLight: 0xe8d7a8,
  mask: 0x0e1a33,
  trace: 0xd1b896,
  silk: 0xc9d3e6,
  aqua: 0x5fd0d8,
};

/** PMREM room environment, key + rim lights, ACES tone mapping, sRGB output. */
export function setupLighting(scene, renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envTex = pmrem.fromScene(envScene, 0.04).texture;
  scene.environment = envTex;
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
  const gold = std({ color: COLORS.gold, roughness: 0.25, metalness: 1, envMapIntensity: 1.2 });
  const M = {
    gold,
    goldBase: std({ color: 0x8f7544, roughness: 0.4, metalness: 1, envMapIntensity: 1.0 }),
    goldDeep: std({ color: COLORS.goldDeep, roughness: 0.3, metalness: 1, envMapIntensity: 1.1 }),
    goldLight: std({ color: COLORS.goldLight, roughness: 0.2, metalness: 1, envMapIntensity: 1.3 }),
    chain: std({ color: COLORS.gold, roughness: 0.22, metalness: 1, envMapIntensity: 1.3 }),
    pave: std({ color: 0xffffff, roughness: 0.06, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.18, envMapIntensity: 2.2, flatShading: true }),
    centerStone: std({ color: 0xf6faff, roughness: 0.03, metalness: 0.1, emissive: 0xdde8ff, emissiveIntensity: 0.12, envMapIntensity: 2.6, flatShading: true }),
    gem: lowPower
      ? new THREE.MeshPhysicalMaterial({ color: 0xe6f4ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.62, envMapIntensity: 2.2, flatShading: true, clearcoat: 1 })
      : new THREE.MeshPhysicalMaterial({
          color: 0xffffff, roughness: 0.02, metalness: 0, transmission: 0.9, thickness: 1.5, ior: 1.5,
          envMapIntensity: 2.2, flatShading: true, clearcoat: 1, clearcoatRoughness: 0.03,
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
