// Diamond cuts + fake-diamond refraction shader (owner: 3D DEV). No external assets.
//  - cutGeometry(): non-indexed, flat-shaded brilliant-style cut built from stacked rings along any convex outline.
//  - createDiamondMaterial(): ShaderMaterial that refracts the view ray at the front facet (IOR ~2.42), bounces it
//    through a baked cube map of the gem's own back-face normals (object space), and looks up an environment cube
//    along the exit ray once per colour channel (dispersion).
import * as THREE from 'three';

// Environment cube used by the gem shader (filled by materials.js setupLighting).
export const gemEnv = { texture: null };

const PI = Math.PI;

/**
 * Brilliant-style cut. Outline function s in [0,1) -> [x,y] (convex, centred near `center`).
 * M main points (N = 2M girdle vertices): table (M), star (M), kite (M), upper girdle (2M), girdle band,
 * lower girdle (3M), pavilion mains (M) and a pointed culet.
 */
export function cutGeometry({ outline, M = 8, center = [0, 0], tableK = 0.58, starK = 0.84, crownH = 0.2, girdleH = 0.04, pavD = 0.3, lowerK = 0.5, phase = 0 }) {
  const [cx, cy] = center;
  const zt = girdleH / 2, zb = -girdleH / 2;
  const main = (j) => outline(((j % M) + M) % M / M + phase);
  const mid = (j) => outline((((j % M) + M) % M + 0.5) / M + phase);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const scaled = (p, k, z) => V(cx + (p[0] - cx) * k, cy + (p[1] - cy) * k, z);
  const gT = (p) => V(p[0], p[1], zt), gB = (p) => V(p[0], p[1], zb);
  const tri = [];
  const add = (a, b, c) => tri.push([a, b, c]);
  const tableC = V(cx, cy, zt + crownH), culet = V(cx, cy - 0.0, zb - pavD);
  const T = (j) => scaled(main(j), tableK, zt + crownH);
  const S = (j) => scaled(mid(j), starK, zt + crownH * 0.5);
  const L = (j) => scaled(mid(j), lowerK, zb - pavD * 0.72);
  for (let j = 0; j < M; j++) {
    add(tableC, T(j), T(j + 1));                          // table
    add(T(j), T(j + 1), S(j));                            // star
    add(T(j), S(j - 1), gT(main(j)));                     // kite (2 tris)
    add(T(j), gT(main(j)), S(j));
    add(S(j), gT(main(j)), gT(mid(j)));                   // upper girdle halves
    add(S(j), gT(mid(j)), gT(main(j + 1)));
    // girdle band
    add(gT(main(j)), gT(mid(j)), gB(mid(j))); add(gT(main(j)), gB(mid(j)), gB(main(j)));
    add(gT(mid(j)), gT(main(j + 1)), gB(main(j + 1))); add(gT(mid(j)), gB(main(j + 1)), gB(mid(j)));
    // lower girdle halves
    add(gB(main(j)), gB(mid(j)), L(j));
    add(gB(mid(j)), gB(main(j + 1)), L(j));
    add(gB(main(j + 1)), L(j + 1), L(j));
    add(culet, L(j), L(j + 1));                           // pavilion main
  }
  const c3 = V(cx, cy, 0), pos = [], ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), f = new THREE.Vector3();
  tri.forEach(([a, b, c]) => {
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    f.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(c3);
    if (n.dot(f) < 0) { const t = b; b = c; c = t; } // outward winding
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals(); // non-indexed: one normal per facet triangle
  geo.userData.center = new THREE.Vector3(cx, cy, 0);
  return geo;
}

// Pear outline (point up, round bottom): matches the pendant's bezel outline.
export function pearOutline(hw, h) {
  return (s) => {
    s = ((s % 1) + 1) % 1;
    const side = s < 0.5 ? 1 : -1, u = s < 0.5 ? 2 * s : 2 * (1 - s);
    return [side * hw * Math.pow(Math.sin(PI * Math.pow(u, 1.45)), 0.7), h / 2 - u * h];
  };
}

export function pearGemGeometry(low) {
  return cutGeometry({
    outline: pearOutline(0.75, 2.2), M: low ? 10 : 14, center: [0, -0.2],
    tableK: 0.58, starK: 0.84, crownH: 0.22, girdleH: 0.045, pavD: 0.25, lowerK: 0.5,
  });
}

export function roundStoneGeometry(low) {
  const r = 0.28;
  return cutGeometry({
    outline: (s) => [r * Math.cos(2 * PI * s), r * Math.sin(2 * PI * s)], M: 8, center: [0, 0],
    tableK: 0.57, starK: 0.82, crownH: 0.09, girdleH: 0.017, pavD: 0.24, lowerK: 0.45,
  });
}

// Tiny round brilliant for the pave stones (8-fold, flat shaded, +Z up, girdle at z=0).
export function paveStoneGeometry() {
  const r = 0.06;
  return cutGeometry({
    outline: (s) => [r * Math.cos(2 * PI * s), r * Math.sin(2 * PI * s)], M: 8, center: [0, 0],
    tableK: 0.56, starK: 0.8, crownH: 0.03, girdleH: 0.008, pavD: 0.05, lowerK: 0.45,
  });
}

// ---------------------------------------------------------------------------------------------
const VERT = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNrm;
  void main() {
    vPos = position;
    vNrm = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform samplerCube tBack;
  uniform samplerCube tEnv;
  uniform vec3 uCam;      // camera position in object space
  uniform mat3 uModel;    // object -> world (rotation * scale)
  uniform float uOpacity;
  uniform float uBoost;
  uniform vec3 uIor;
  uniform vec3 uKey;
  uniform float uFloor;
  varying vec3 vPos;
  varying vec3 vNrm;

  vec3 toWorld(vec3 d) { return normalize(uModel * d); }

  uniform vec3 uCenter;
  uniform float uRadius;

  // intersect a ray inside the stone with the baked back surface (cube map of normal + distance from centre)
  void hitBack(vec3 p, vec3 d, out vec3 n, out vec3 q) {
    vec3 dir = normalize(p - uCenter + d * uRadius);
    vec4 s = textureCube(tBack, dir);
    float t = max(dot(uCenter + dir * s.a - p, d), 0.0);
    q = p + d * t;
    dir = normalize(q - uCenter);
    s = textureCube(tBack, dir);
    q = uCenter + dir * s.a;
    n = s.xyz / max(length(s.xyz), 1e-4);
  }

  // follow a ray inside the stone: bounce off the back facets, leave when refraction succeeds
  vec3 traceExit(vec3 p, vec3 rd, float ior) {
    float k = 1.0;
    for (int i = 0; i < BOUNCES; i++) {
      vec3 nb, q;
      hitBack(p, rd, nb, q);
      vec3 rr = refract(rd, -nb, ior);
      if (dot(rr, rr) > 1e-4) { rd = rr; break; }
      rd = reflect(rd, -nb);   // total internal reflection
      p = q - rd * 0.002;
      k *= 0.985;
    }
    return rd * k;
  }

  void main() {
    vec3 N = normalize(vNrm);
    vec3 V = normalize(vPos - uCam);
    if (dot(N, V) > 0.0) N = -N; // safety for grazing back faces
    float cosT = clamp(dot(-V, N), 0.0, 1.0);

    vec3 col;
    for (int c = 0; c < 3; c++) {
      float ior = c == 0 ? uIor.x : (c == 1 ? uIor.y : uIor.z);
      vec3 rd = refract(V, N, 1.0 / ior);
      vec3 ex = traceExit(vPos, rd, ior);
      float k = length(ex);
      vec3 s = textureLod(tEnv, toWorld(ex / max(k, 1e-4)), 1.2).rgb * k;
      col[c] = c == 0 ? s.r : (c == 1 ? s.g : s.b);
    }
    col *= uBoost;
    // bright "white room": a heavily blurred environment term so total-internal-reflection facets are never dark
    vec3 R0 = reflect(V, N);
    vec3 room = textureLod(tEnv, toWorld(refract(V, N, 1.0 / uIor.y)), 5.0).rgb;
    col += room * 0.8;

    // Fresnel surface reflection of the environment from the front facet
    vec3 refl = textureLod(tEnv, toWorld(R0), 0.8).rgb;
    float F = 0.17 + 0.83 * pow(1.0 - cosT, 5.0);
    col = col * (1.0 - F) + refl * F * 1.3;

    // flat table: soft white sheen so the top reads clear and luminous
    float tbl = smoothstep(0.96, 0.995, N.z);
    col += vec3(0.3, 0.31, 0.33) * tbl * (0.6 + 0.8 * pow(1.0 - cosT, 2.0)) + refl * tbl * 0.35;

    // facet glints
    vec3 Rw = toWorld(R0);
    float glint = pow(max(dot(Rw, uKey), 0.0), 90.0) * 5.0 + pow(max(dot(Rw, vec3(-0.6, 0.3, 0.74)), 0.0), 120.0) * 3.0;
    col += vec3(1.0, 0.98, 0.95) * glint;

    // icy tint, luminance floor (no facet near black) with facet contrast kept above it
    col *= vec3(0.985, 0.992, 1.0);
    col = vec3(uFloor) * vec3(0.97, 0.985, 1.0) + pow(max(col, vec3(0.0)), vec3(1.18)) * 0.85;
    gl_FragColor = vec4(col, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const _tmpV = new THREE.Vector3(), _inv = new THREE.Matrix4();

function bakeBackNormals(renderer, geometry, size = 512) {
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, toneMapped: false, uniforms: { uC: { value: (geometry.userData.center || new THREE.Vector3()).clone() } },
    vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normal; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vN; varying vec3 vP; uniform vec3 uC; void main(){ gl_FragColor = vec4(normalize(vN), length(vP - uC)); }',
  });
  scene.add(new THREE.Mesh(geometry, mat));
  const cam = new THREE.CubeCamera(0.01, 20, rt);
  cam.position.copy(geometry.userData.center || new THREE.Vector3());
  scene.add(cam);
  cam.update(renderer, scene);
  mat.dispose();
  return rt;
}

/**
 * Returns a Mesh using the diamond shader. The back-face normal cube map is baked once, lazily, on the first
 * draw (needs the renderer). Object-space ray maths, so any rotation of the pendant is fine.
 */
export function createDiamondMesh(geometry, { bounces = 4, boost = 2.2, floorLevel = 0.42 } = {}) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { BOUNCES: bounces },
    uniforms: {
      tBack: { value: null },
      tEnv: { value: null },
      uCam: { value: new THREE.Vector3() },
      uModel: { value: new THREE.Matrix3() },
      uOpacity: { value: 1 },
      uBoost: { value: boost },
      uIor: { value: new THREE.Vector3(2.405, 2.42, 2.435) },
      uCenter: { value: (geometry.userData.center || new THREE.Vector3()).clone() },
      uRadius: { value: (geometry.boundingSphere || (geometry.computeBoundingSphere(), geometry.boundingSphere)).radius * 0.75 },
      uFloor: { value: floorLevel },
      uKey: { value: new THREE.Vector3(4, 6, 9).normalize() },
    },
  });
  const mesh = new THREE.Mesh(geometry, mat);
  const state = { back: null };
  mesh.onBeforeRender = function (renderer, scene, camera, geo, material) {
    if (!state.back) state.back = bakeBackNormals(renderer, geometry);
    const u = material.uniforms;
    u.tBack.value = state.back.texture;
    u.tEnv.value = gemEnv.texture || state.back.texture;
    u.uOpacity.value = material.opacity;
    u.uModel.value.setFromMatrix4(this.matrixWorld);
    _inv.copy(this.matrixWorld).invert();
    u.uCam.value.copy(_tmpV.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv));
  };
  mesh.userData.diamond = true;
  return mesh;
}
