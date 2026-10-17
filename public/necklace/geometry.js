// Necklace model builders (owner: 3D DEV). Units: cm. Front jewelry on +Z, exposed PCB on -Z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createMaterials, makeTextMaterial, COLORS } from './materials.js';

const PI = Math.PI;
const BZ = -0.41; // back surface of the PCB plate (root z)

// Component layout in "view space" from behind: bx = -root.x, by = root.y.
const LAY = {
  touch: { bx: 1.5, by: 1.2 },
  buzzer: { bx: -1.6, by: 1.0 },
  baro: { bx: 0, by: 1.75 },
  brain: { bx: 0, by: -1.6 },
};

// ---------- small helpers ----------
const box = (w, h, d, mat, x, y, z0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z0 + d / 2);
  return m;
};
const cyl = (r, h, mat, x, y, z0, seg = 16) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.rotation.x = PI / 2;
  m.position.set(x, y, z0 + h / 2);
  return m;
};
const plane = (w, h, mat, x, y, z) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  return m;
};

function registerPart(group, id) {
  group.name = 'part-' + id;
  const map = new Map();
  const mats = [];
  group.traverse((o) => {
    o.userData.id = id;
    if (o.isMesh) {
      let m = map.get(o.material);
      if (!m) {
        m = o.material.clone();
        m.transparent = true;
        m.userData.baseOpacity = m.opacity;
        if (m.emissive) {
          m.userData.baseEmissiveIntensity = m.emissiveIntensity;
          m.userData.baseEmissive = m.emissive.clone();
        }
        map.set(o.material, m);
        mats.push(m);
      }
      o.material = m;
    }
  });
  group.userData.materials = mats;
}

// ---------- pendant outline (view space, symmetric, scalloped by feather tips) ----------
// Back PCB plate outline (independent of the front jewelry; do not change).
const PLATE_TIPS = [[2.0, -1.9], [2.4, -0.9], [2.6, 0.3], [2.65, 1.5], [2.55, 2.6], [2.35, 3.6], [1.75, 3.15], [1.15, 2.9], [0.5, 2.78]];
function outlinePoints() {
  const right = [[0, -3.05], [0.8, -2.95], [1.45, -2.6]];
  PLATE_TIPS.forEach((t, j) => {
    if (j) {
      const p = PLATE_TIPS[j - 1];
      const mx = (p[0] + t[0]) / 2, my = (p[1] + t[1]) / 2;
      const dx = mx, dy = my - 0.3, l = Math.hypot(dx, dy);
      right.push([mx - (dx / l) * 0.1, my - (dy / l) * 0.1]);
    }
    right.push(t);
  });
  const left = right.slice(1).reverse().map(([x, y]) => [-x, y]);
  const pts = [...right.map(([x, y]) => new THREE.Vector3(x, y, 0)), new THREE.Vector3(0, 2.7, 0), ...left.map(([x, y]) => new THREE.Vector3(x, y, 0))];
  const c = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const out = c.getPoints(320).map((p) => new THREE.Vector2(p.x, p.y));
  out.pop();
  return out;
}

// ---------- PCB texture ----------
function drawBoard(outline, lowPower) {
  const S = lowPower ? 190 : 380;
  const W = 5.4, H = 6.6, BYMAX = 3.4;
  const cw = Math.round(W * S), ch = Math.round(H * S);
  const mk = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
  const A = mk(), E = mk();
  const a = A.getContext('2d'), e = E.getContext('2d');
  const X = (bx) => (bx + W / 2) * S;
  const Y = (by) => (BYMAX - by) * S;
  const gold = '#D1B896', silk = '#C9D3E6', aqua = '#5FD0D8';

  const grad = a.createLinearGradient(0, 0, cw, ch);
  grad.addColorStop(0, '#0f1f3b'); grad.addColorStop(0.5, '#0E1A33'); grad.addColorStop(1, '#0c2a3a');
  a.fillStyle = grad; a.fillRect(0, 0, cw, ch);
  e.fillStyle = '#000'; e.fillRect(0, 0, cw, ch);

  const path = (ctx) => {
    ctx.beginPath();
    outline.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    ctx.closePath();
  };

  // blueprint grid
  a.save(); path(a); a.clip();
  a.strokeStyle = 'rgba(95,208,216,0.07)'; a.lineWidth = 1.2;
  for (let g = -2.75; g <= 2.76; g += 0.25) { a.beginPath(); a.moveTo(X(g), 0); a.lineTo(X(g), ch); a.stroke(); }
  for (let g = -3.25; g <= 3.4; g += 0.25) { a.beginPath(); a.moveTo(0, Y(g)); a.lineTo(cw, Y(g)); a.stroke(); }
  // board edge ring
  a.lineJoin = 'round'; a.strokeStyle = 'rgba(209,184,150,0.75)'; a.lineWidth = 0.1 * S; path(a); a.stroke();
  e.save(); path(e); e.clip(); e.lineJoin = 'round'; e.strokeStyle = 'rgba(90,75,50,1)'; e.lineWidth = 0.1 * S; path(e); e.stroke(); e.restore();
  a.restore();

  const poly = (ctx, pts, color, wCm) => {
    ctx.strokeStyle = color; ctx.lineWidth = wCm * S; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
  };
  const dot = (ctx, x, y, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(x), Y(y), r * S, 0, PI * 2); ctx.fill(); };

  // routes: [startX, startY, targetX, bendY]
  const PADY = LAY.brain.by + 0.72;
  const route = (px, py, tx, yb) => [[px, py], [px, yb], [tx, yb - Math.abs(px - tx)], [tx, PADY]];
  const routes = [
    route(1.3, 0.78, 0.8, 0.5), route(1.5, 0.78, 1.0, 0.35), route(1.7, 0.78, 1.2, 0.2), // touch SIG VCC GND
    route(-1.95, 0.55, -1.0, 0.3), route(-1.25, 0.55, -0.8, 0.1), // buzzer legs
    ...[-0.375, -0.125, 0.125, 0.375].map((x) => [[x, LAY.baro.by - 0.38], [x, PADY]]), // baro I2C bus
  ];
  const tracePink = [];
  routes.forEach((r) => {
    poly(a, r, 'rgba(0,0,0,0.35)', 0.075);
    poly(a, r, gold, 0.05);
    poly(e, r, 'rgb(70,58,38)', 0.05);
    tracePink.push(r);
  });
  // vias at the diagonal ends
  routes.forEach((r) => {
    if (r.length === 4) {
      const [x, y] = r[2];
      dot(a, x, y, 0.07, gold); dot(a, x, y, 0.028, '#050a14'); dot(e, x, y, 0.07, 'rgb(100,85,55)');
    }
  });
  // scattered vias
  [[-2.1, 2.2], [2.1, 2.3], [-2.0, -1.9], [2.0, -1.9], [0.0, -2.85], [-0.9, 1.4], [0.9, 1.3]].forEach(([x, y]) => {
    dot(a, x, y, 0.06, gold); dot(a, x, y, 0.025, '#050a14'); dot(e, x, y, 0.06, 'rgb(90,75,50)');
  });
  // solder pads at every pin
  const pads = [];
  routes.forEach((r) => { pads.push(r[0], r[r.length - 1]); });
  pads.forEach(([x, y]) => { dot(a, x, y, 0.09, gold); dot(a, x, y, 0.035, '#10182a'); dot(e, x, y, 0.09, 'rgb(150,125,85)'); });

  // footprint outlines (aqua, dashed)
  a.save(); a.setLineDash([0.07 * S, 0.05 * S]); a.strokeStyle = aqua; a.lineWidth = 0.022 * S;
  e.save(); e.setLineDash([0.07 * S, 0.05 * S]); e.strokeStyle = aqua; e.lineWidth = 0.022 * S;
  const frame = (cx, cy, w, h) => { [a, e].forEach((c) => c.strokeRect(X(cx - w / 2), Y(cy + h / 2), w * S, h * S)); };
  frame(LAY.touch.bx, LAY.touch.by, 1.14, 1.14);
  frame(LAY.baro.bx, LAY.baro.by, 1.14, 1.04);
  frame(LAY.brain.bx, LAY.brain.by, 2.52, 1.82);
  [a, e].forEach((c) => { c.beginPath(); c.arc(X(LAY.buzzer.bx), Y(LAY.buzzer.by), 0.66 * S, 0, PI * 2); c.stroke(); });
  a.restore(); e.restore();

  // mounting holes
  [[-2.05, -0.4], [2.05, -0.4], [-1.95, 2.45], [1.95, 2.45]].forEach(([x, y]) => {
    dot(a, x, y, 0.2, gold); dot(a, x, y, 0.115, '#03070f'); dot(e, x, y, 0.2, 'rgb(130,108,72)'); dot(e, x, y, 0.115, '#000');
    a.strokeStyle = aqua; a.lineWidth = 0.015 * S; a.beginPath(); a.arc(X(x), Y(y), 0.27 * S, 0, PI * 2); a.stroke();
    e.strokeStyle = aqua; e.lineWidth = 0.015 * S; e.beginPath(); e.arc(X(x), Y(y), 0.27 * S, 0, PI * 2); e.stroke();
  });

  // silkscreen
  const text = (str, x, y, size, align = 'center') => {
    [[a, silk], [e, '#5b6678']].forEach(([c, col]) => {
      c.fillStyle = col; c.textAlign = align; c.textBaseline = 'middle';
      c.font = `700 ${Math.round(size * S)}px Menlo, "SF Mono", Consolas, "Courier New", monospace`;
      c.fillText(str, X(x), Y(y));
    });
  };
  text('TOUCH D4', LAY.touch.bx, 1.9, 0.15);
  text('BUZZER D8', LAY.buzzer.bx, 1.78, 0.15);
  text('BARO I2C', 0, 2.47, 0.15);
  text('UNO R4', 1.82, -1.05, 0.17);
  text('WiFi', 1.82, -1.28, 0.13);
  text('tenshi', -1.82, -1.05, 0.2);
  text('REV A', -1.82, -1.3, 0.11);

  const mkTex = (cv, color) => {
    const t = new THREE.CanvasTexture(cv);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: mkTex(A, true), emissiveMap: mkTex(E, true), bbox: { W, H, BYMAX } };
}

// Drop triangles facing +Z so the plate does not show as a solid shield behind the front jewelry.
function stripFrontFaces(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  const P = [], N = [], U = [];
  for (let i = 0; i < pos.count; i += 3) {
    if (nor.getZ(i) + nor.getZ(i + 1) + nor.getZ(i + 2) > 0.9) continue;
    for (let k = 0; k < 3; k++) {
      P.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      N.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
      if (uv) U.push(uv.getX(i + k), uv.getY(i + k));
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.clearGroups();
}

function buildPcb(M, lowPower) {
  const g = new THREE.Group();
  const outline = outlinePoints();
  const shape = new THREE.Shape(outline);

  // plate body (neat navy board edge)
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 1 });
  stripFrontFaces(bodyGeo);
  const body = new THREE.Mesh(bodyGeo, M.maskEdge);
  body.position.z = BZ + 0.02;
  g.add(body);
  // depth-only occluder on the plate front: hides the mounted hardware from the front view without drawing a shield
  const occ = new THREE.Mesh(new THREE.ShapeGeometry(shape, 1), new THREE.MeshBasicMaterial({ colorWrite: false }));
  occ.position.z = BZ + 0.15;
  occ.renderOrder = -10;
  occ.userData.id = null;
  g.add(occ);

  // textured back face
  const tex = drawBoard(outline, lowPower);
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateY(PI); // normal -> -Z, vertex x -> -bx
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const bx = -pos.getX(i), by = pos.getY(i);
    uv[i * 2] = (bx + tex.bbox.W / 2) / tex.bbox.W;
    uv[i * 2 + 1] = 1 - (tex.bbox.BYMAX - by) / tex.bbox.H;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map, emissive: 0xffffff, emissiveMap: tex.emissiveMap, emissiveIntensity: 0.9,
    roughness: 0.62, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const face = new THREE.Mesh(geo, mat);
  face.position.z = BZ - 0.003;
  g.add(face);
  return { group: g, outline };
}

// ---------- components (local frame: x right-from-behind, y up, +z away from board) ----------
function buildTouch(M) {
  const g = new THREE.Group();
  g.add(box(1, 1, 0.06, M.modBlue, 0, 0, 0));
  g.add(cyl(0.35, 0.012, M.maskDark, 0, 0.14, 0.06, 40));
  g.add(cyl(0.3, 0.035, M.copper, 0, 0.14, 0.06, 40));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 36), M.goldLightPin || M.pin);
  ring.position.set(0, 0.14, 0.098); g.add(ring);
  g.add(box(0.18, 0.13, 0.05, M.black, -0.38, 0.4, 0.06)); // TTP223 IC
  g.add(box(0.07, 0.05, 0.02, M.aqua, 0.38, 0.4, 0.06)); // power LED
  g.add(box(0.66, 0.1, 0.09, M.black, 0, -0.42, 0.06)); // header housing
  [-0.2, 0, 0.2].forEach((x) => g.add(box(0.035, 0.035, 0.3, M.pin, x, -0.42, 0.06)));
  g.add(plane(0.9, 0.2, makeTextMaterial([
    { text: 'SIG', x: -0.2, y: 0, size: 0.07 }, { text: 'VCC', x: 0, y: 0, size: 0.07 }, { text: 'GND', x: 0.2, y: 0, size: 0.07 },
  ], 0.9, 0.2), 0, -0.29, 0.062));
  return g;
}

function buildBuzzer(M) {
  const g = new THREE.Group();
  g.add(cyl(0.52, 0.42, M.canBlack, 0, 0, 0.02, 40));
  g.add(cyl(0.45, 0.012, M.canTop, 0, 0, 0.44, 40));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.014, 6, 40), M.silver);
  rim.position.z = 0.44; g.add(rim);
  g.add(cyl(0.085, 0.014, M.hole, 0, 0, 0.452, 20));
  const hr = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.012, 6, 24), M.silver);
  hr.position.z = 0.456; g.add(hr);
  g.add(plane(0.2, 0.2, makeTextMaterial([{ text: '+', x: 0, y: 0, size: 0.18 }], 0.2, 0.2), -0.3, 0.27, 0.454));
  [-1, 1].forEach((s) => {
    g.add(cyl(0.032, 0.18, M.pin, s * 0.35, -0.45, 0, 10));
    g.add(box(0.05, 0.16, 0.02, M.pin, s * 0.34, -0.38, 0.03));
  });
  return g;
}

function buildBaro(M) {
  const g = new THREE.Group();
  g.add(box(1, 0.9, 0.05, M.modTeal, 0, 0, 0));
  g.add(box(0.36, 0.36, 0.08, M.silver, 0, 0.05, 0.05)); // DPS310 LGA lid
  g.add(cyl(0.05, 0.012, M.hole, 0.09, 0.14, 0.13, 14)); // pressure port
  // gold pad outline
  const o = 0.48, t = 0.022;
  g.add(box(o, t, 0.012, M.pin, 0, 0.05 + o / 2, 0.05));
  g.add(box(o, t, 0.012, M.pin, 0, 0.05 - o / 2, 0.05));
  g.add(box(t, o, 0.012, M.pin, -o / 2, 0.05, 0.05));
  g.add(box(t, o, 0.012, M.pin, o / 2, 0.05, 0.05));
  g.add(box(1.06, 0.1, 0.09, M.black, 0, -0.38, 0.05)); // header housing
  [-0.375, -0.125, 0.125, 0.375].forEach((x) => g.add(box(0.035, 0.035, 0.28, M.pin, x, -0.38, 0.05)));
  g.add(plane(1.0, 0.16, makeTextMaterial([
    { text: 'VCC', x: -0.375, y: 0, size: 0.065 }, { text: 'GND', x: -0.125, y: 0, size: 0.065 },
    { text: 'SCL', x: 0.125, y: 0, size: 0.065 }, { text: 'SDA', x: 0.375, y: 0, size: 0.065 },
  ], 1.0, 0.16), 0, -0.27, 0.0505));
  g.add(plane(0.6, 0.12, makeTextMaterial([{ text: 'DPS310', x: 0, y: 0, size: 0.075 }], 0.6, 0.12), 0, 0.37, 0.0505));
  return g;
}

function buildBrain(M, lowPower) {
  const g = new THREE.Group();
  const board = new THREE.Mesh(new RoundedBoxGeometry(2.4, 1.7, 0.07, 2, 0.12), M.unoTeal);
  board.position.z = 0.035; g.add(board);
  // USB-C connector on the left end
  g.add(box(0.5, 0.62, 0.2, M.silver, -1.12, 0.3, 0.07));
  g.add(box(0.02, 0.42, 0.08, M.black, -1.375, 0.3, 0.13));
  // LED matrix 12x8
  g.add(box(1.0, 0.72, 0.03, M.black, -0.15, 0.05, 0.07));
  const pat = [
    '............', '..........1.', '.........11.', '1.......11..', '11.....11...', '.11...11....', '..11.11.....', '...111......',
  ];
  const on = [], off = [];
  for (let j = 0; j < 8; j++) for (let i = 0; i < 12; i++) {
    const p = new THREE.Vector3(-0.15 + (i - 5.5) * 0.075, 0.05 + (3.5 - j) * 0.075, 0.1 + 0.006);
    (pat[j][i] === '1' ? on : off).push(p);
  }
  const dotG = new THREE.BoxGeometry(0.05, 0.05, 0.012);
  [[on, M.ledOn], [off, M.ledOff]].forEach(([arr, mat]) => {
    const im = new THREE.InstancedMesh(dotG, mat, arr.length);
    const m4 = new THREE.Matrix4();
    arr.forEach((p, k) => im.setMatrixAt(k, m4.makeTranslation(p.x, p.y, p.z)));
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  });
  // square MCU + ESP module
  g.add(box(0.46, 0.46, 0.06, M.black, 0.82, 0.25, 0.07));
  g.add(cyl(0.03, 0.01, M.silver, 0.64, 0.43, 0.13, 10));
  g.add(box(0.52, 0.4, 0.04, M.silver, 0.82, -0.28, 0.07));
  g.add(box(0.52, 0.1, 0.05, M.black, 0.82, -0.4, 0.07));
  // headers
  g.add(box(2.3, 0.1, 0.12, M.black, 0, 0.72, 0.07));
  [-1.0, -0.8, -0.375, -0.125, 0.125, 0.375, 0.8, 1.0, 1.2].forEach((x) => g.add(box(0.035, 0.035, 0.22, M.pin, x, 0.72, 0.07)));
  g.add(box(2.0, 0.1, 0.12, M.black, 0, -0.72, 0.07));
  for (let k = 0; k < 8; k++) g.add(box(0.035, 0.035, 0.22, M.pin, -0.875 + k * 0.25, -0.72, 0.07));
  // reset button, status LED, label
  g.add(box(0.16, 0.16, 0.05, M.silver, -0.92, -0.42, 0.07));
  g.add(cyl(0.045, 0.03, M.black, -0.92, -0.42, 0.12, 12));
  g.add(box(0.06, 0.04, 0.02, M.aqua, -0.92, -0.18, 0.07));
  g.add(plane(1.1, 0.3, makeTextMaterial([
    { text: 'UNO R4 WiFi', x: 0, y: 0.05, size: 0.115 }, { text: 'ARDUINO', x: 0, y: -0.08, size: 0.07, color: '#5FD0D8' },
  ], 1.1, 0.3), -0.1, -0.5, 0.0705));
  return g;
}

// ---------- front jewelry ----------
// Two mirrored angel wings (4 stacked feathers each), a brilliant centre stone, and a large hanging pear gem.
// Right-wing feather specs (wing space: x outward, y up). root, angle (deg above horizontal), length, half-width, upward bend.
const WING_FEATHERS = [
  { rx: 0.45, ry: 0.15, ang: 38, L: 2.6, W: 0.36, bend: 0.13, z: 0.15, pave: [0.26, 0.9, 3] },
  { rx: 0.42, ry: 0.0, ang: 21, L: 2.3, W: 0.35, bend: 0.12, z: 0.1, pave: [0.4, 0.86, 2] },
  { rx: 0.4, ry: -0.13, ang: 4, L: 1.9, W: 0.33, bend: 0.11, z: 0.05, barbs: true },
  { rx: 0.36, ry: -0.26, ang: -17, L: 1.4, W: 0.3, bend: 0.1, z: 0.0, barbs: true },
];
const F_DEPTH = 0.04, F_BEVEL = 0.02;

function featherCurve(f, sx) {
  const a = (f.ang * PI) / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
  const c = (t) => {
    const u = f.bend * f.L * t * t;
    return [sx * (f.rx + dx * f.L * t + nx * u), f.ry + dy * f.L * t + ny * u];
  };
  const nrm = (t) => { // unit normal (left of travel), mirrored for sx
    const s = f.bend * f.L * 2 * t; // d/dt of bend term, perpendicular
    const tx = dx * f.L + nx * s, ty = dy * f.L + ny * s, l = Math.hypot(tx, ty);
    return [sx * (-ty / l), tx / l, sx * (tx / l), ty / l]; // [nx, ny, tx, ty]
  };
  const w = (t) => f.W * Math.pow(Math.sin(PI * Math.pow(t, 0.78)), 0.9);
  return { c, nrm, w };
}

function featherGeo(f, sx, low) {
  const { c, nrm, w } = featherCurve(f, sx);
  const n = low ? 8 : 16;
  const A = [], B = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, [px, py] = c(t), [nx, ny] = nrm(t), ww = w(t);
    A.push(new THREE.Vector2(px + nx * ww, py + ny * ww));
    B.push(new THREE.Vector2(px - nx * ww, py - ny * ww));
  }
  const pts = [...A, ...B.reverse().slice(1, -1)];
  return new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
    depth: F_DEPTH, bevelEnabled: true, bevelThickness: F_BEVEL, bevelSize: 0.02, bevelSegments: low ? 1 : 2, curveSegments: 1,
  });
}

function buildWings(M, lowPower) {
  const g = new THREE.Group();
  const pave = [], barbs = [];
  const mats = [M.goldLight, M.gold, M.goldDeep, M.gold];
  [1, -1].forEach((sx) => {
    WING_FEATHERS.forEach((f, i) => {
      const m = new THREE.Mesh(featherGeo(f, sx, lowPower), f.pave ? M.goldLight : i === 2 ? M.gold : M.goldDeep);
      m.position.z = f.z;
      g.add(m);
      const { c, nrm, w } = featherCurve(f, sx);
      const zTop = f.z + F_DEPTH + F_BEVEL;
      // midrib
      const rib = [];
      for (let k = 0; k <= 10; k++) { const t = 0.08 + (0.84 * k) / 10, p = c(t); rib.push(new THREE.Vector3(p[0], p[1], zTop + 0.004)); }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rib), lowPower ? 8 : 16, 0.012, 4, false), M.goldDeep));
      // engraved barbs on the plain lower feathers
      if (f.barbs && !lowPower) {
        for (let t = 0.16; t < 0.86; t += 0.07) {
          const p = c(t), [nx, ny, tx, ty] = nrm(t), ww = w(t);
          [1, -1].forEach((side) => {
            const th = 0.62, dxv = tx * Math.cos(th) + side * nx * Math.sin(th), dyv = ty * Math.cos(th) + side * ny * Math.sin(th);
            const len = ww * 0.9;
            barbs.push([p[0] + side * nx * ww * 0.45 + dxv * 0.0, p[1] + side * ny * ww * 0.45, zTop + 0.003, Math.atan2(dyv, dxv), len]);
          });
        }
      }
      // pave rows: top feather fully, second feather partly
      if (f.pave && !lowPower) {
        const [t0, t1, rows] = f.pave;
        const step = 0.235 / f.L;
        for (let t = t0; t <= t1; t += step) {
          const p = c(t), [nx, ny] = nrm(t), ww = w(t);
          if (ww < 0.09) continue;
          const offs = rows === 3 && ww > 0.26 ? [-0.62, 0, 0.62] : [-0.5, 0.5];
          offs.forEach((o) => pave.push([p[0] + nx * ww * o, p[1] + ny * ww * o, zTop + 0.028]));
        }
      }
    });
  });
  if (pave.length) {
    const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.045, 1), M.pave, pave.length);
    const m4 = new THREE.Matrix4();
    pave.forEach(([x, y, z], k) => im.setMatrixAt(k, m4.makeTranslation(x, y, z)));
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
  if (barbs.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.012, 0.01), M.goldDeep, barbs.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), ax = new THREE.Vector3(0, 0, 1), sc = new THREE.Vector3(), pp = new THREE.Vector3();
    barbs.forEach(([x, y, z, a, len], k) => {
      q.setFromAxisAngle(ax, a); sc.set(len, 1, 1); pp.set(x, y, z);
      im.setMatrixAt(k, m4.compose(pp, q, sc));
    });
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
  // small gold hub where the wings meet, below the centre stone
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), M.gold);
  hub.scale.set(1.5, 1, 0.55); hub.position.set(0, -0.02, 0.14);
  g.add(hub);
  return g;
}

function buildCenterStone(M) {
  const g = new THREE.Group();
  // round brilliant: table, crown, girdle, pavilion (8 flat-shaded facet columns)
  const prof = [[0, 0.1], [0.15, 0.1], [0.28, 0.01], [0.28, -0.01], [0.14, -0.14], [0, -0.22]].map(([r, y]) => new THREE.Vector2(r, y));
  const stone = new THREE.Mesh(new THREE.LatheGeometry(prof, 8), M.centerStone);
  stone.rotation.x = PI / 2; // table faces +Z
  stone.position.z = 0.06;
  g.add(stone);
  // four prongs at 45 degrees + a collar cup
  for (let k = 0; k < 4; k++) {
    const a = PI / 4 + (k * PI) / 2, x = Math.cos(a) * 0.29, y = Math.sin(a) * 0.29;
    const pr = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.2, 8), M.gold);
    pr.rotation.x = PI / 2; pr.position.set(x, y, 0.0);
    g.add(pr);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), M.gold);
    tip.position.set(x * 0.97, y * 0.97, 0.1);
    g.add(tip);
  }
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.12, 0.14, 16), M.gold);
  cup.rotation.x = PI / 2; cup.position.z = -0.08;
  g.add(cup);
  return g;
}

// Pear point at loop parameter s in [0,1): tip -> down the right side -> bottom -> up the left side
function pearPt(hw, h, s) {
  const side = s < 0.5 ? 1 : -1, u = s < 0.5 ? 2 * s : 2 * (1 - s);
  return [side * hw * Math.pow(Math.sin(PI * Math.pow(u, 1.45)), 0.7), h / 2 - u * h];
}

// Cut-stone geometry: table + star/crown facets (zig-zag rings) above the girdle, culet fan below.
function pearGemGeo(M_, low) {
  const m = low ? 8 : 14; // facets per half
  const N = m * 2;
  const ring = (hw, h, z, phase) => Array.from({ length: N }, (_, i) => { const [x, y] = pearPt(hw, h, (i + phase) / N); return new THREE.Vector3(x, y, z); });
  const G = ring(0.74, 2.2, 0, 0), C = ring(0.6, 1.75, 0.17, 0.5), T = ring(0.4, 1.3, 0.27, 0);
  const tri = [];
  const add = (a, b, c) => tri.push(a, b, c);
  const tc = new THREE.Vector3(0, -0.02, 0.27), cul = new THREE.Vector3(0, -0.05, -0.55);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    add(G[j], G[i], C[i]); add(C[i], C[j], G[j]); // kite between girdle and crown ring
    add(C[i], T[j], T[i]); add(C[i], C[j], T[j]); // crown to table
    add(T[j], T[i], tc); // table
    add(G[i], G[j], cul); // pavilion
  }
  const pos = [];
  tri.forEach((v) => pos.push(v.x, v.y, v.z));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function buildPear(M, lowPower) {
  const g = new THREE.Group();
  const gem = new THREE.Mesh(pearGemGeo(M, lowPower), M.gem);
  g.add(gem);
  // thin smooth bezel hugging the girdle
  const o = Array.from({ length: lowPower ? 40 : 72 }, (_, i) => { const [x, y] = pearPt(0.78, 2.3, i / (lowPower ? 40 : 72)); return new THREE.Vector3(x, y, 0); });
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(o, true, 'centripetal'), lowPower ? 40 : 80, 0.045, 6, true), M.gold));
  // collar at the tip, threaded by the bail
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.22, 12), M.gold);
  collar.position.y = 1.2; g.add(collar);
  return g;
}

function buildChain(M, lowPower) {
  // open chain hanging from the outer top tips of the two wings, looping up and behind the neck
  const half = [[2.55, 2.12, 0.15], [3.0, 3.6, -0.1], [3.45, 5.4, -0.8], [3.7, 7.5, -2.3], [3.05, 9.2, -4.5], [0, 9.6, -5.6]];
  // build symmetric list: right tip ... top ... left tip
  const right = half.map((p) => new THREE.Vector3(...p));
  const left = half.slice(0, -1).reverse().map(([x, y, z]) => new THREE.Vector3(-x, y, z));
  const curve = new THREE.CatmullRomCurve3([...right, ...left], false, 'centripetal');
  const N = lowPower ? 54 : 100;
  const len = curve.getLength();
  const spacing = len / (N - 1);
  const geo = new THREE.TorusGeometry(0.1, 0.03, lowPower ? 4 : 6, lowPower ? 10 : 14);
  geo.scale(1.7, 1, 1);
  const s = Math.min(1.5, (spacing * 1.5) / 0.46);
  const im = new THREE.InstancedMesh(geo, M.chain, N);
  const T = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), ref = new THREE.Vector3(0, 0, 1);
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), nb = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    curve.getPointAt(u, p);
    curve.getTangentAt(u, T).normalize();
    ref.set(0, 0, 1);
    if (Math.abs(T.dot(ref)) > 0.9) ref.set(0, 1, 0);
    n.copy(ref).addScaledVector(T, -T.dot(ref)).normalize();
    b.crossVectors(T, n);
    if (i % 2) { nb.copy(n).negate(); m4.makeBasis(T, b, nb); } else m4.makeBasis(T, n, b);
    m4.scale(new THREE.Vector3(s, s, s));
    m4.setPosition(p);
    im.setMatrixAt(i, m4);
  }
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  const g = new THREE.Group();
  g.add(im);
  // small jump rings at the wing tips
  [1, -1].forEach((sx) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 20), M.gold);
    r.position.set(sx * 2.55, 2.12, 0.2);
    g.add(r);
  });
  return g;
}

function countTris(root) {
  let t = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    t += n * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(t);
}

export function buildNecklace({ lowPower = false } = {}) {
  const M = createMaterials({ lowPower });
  const root = new THREE.Group();
  root.name = 'necklace';

  // ---- front jewelry (+Z) ----
  root.add(buildChain(M, lowPower));
  const pcb = buildPcb(M, lowPower);
  root.add(pcb.group);

  root.add(buildWings(M, lowPower));
  const cs = buildCenterStone(M);
  cs.position.set(0, 0.68, 0.22);
  root.add(cs);
  const pear = buildPear(M, lowPower);
  pear.position.set(0, -1.45, 0.2);
  root.add(pear);
  // bail ring threading the hub and the pear collar
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.028, 8, 20), M.gold);
  bail.rotation.y = PI / 2; bail.position.set(0, -0.2, 0.2);
  root.add(bail);

  // ---- hardware components (-Z) ----
  const builders = { touch: () => buildTouch(M), buzzer: () => buildBuzzer(M), baro: () => buildBaro(M), brain: () => buildBrain(M, lowPower) };
  const topH = { touch: 0.12, buzzer: 0.46, baro: 0.14, brain: 0.14 };
  const dist = { touch: 5.0, buzzer: 5.5, baro: 5.0, brain: 8.0 };
  const parts = {}, anchors = {};
  for (const id of Object.keys(LAY)) {
    const part = builders[id]();
    part.position.set(-LAY[id].bx, LAY[id].by, BZ - 0.004);
    part.rotation.y = PI; // local x -> view-right (root -x), local +z -> root -z
    registerPart(part, id);
    root.add(part);
    parts[id] = part;

    const anchor = new THREE.Object3D();
    anchor.name = 'anchor-' + id;
    anchor.position.set(-LAY[id].bx, LAY[id].by, BZ - topH[id]);
    const d = dist[id];
    // offset = camera position relative to lookAt, in root-local space (negative z = behind the board)
    const off = new THREE.Vector3(0.1, 0.22, -1).normalize().multiplyScalar(d);
    anchor.userData.focus = { offset: off, distance: d, lookAt: anchor.position.clone() };
    root.add(anchor);
    anchors[id] = anchor;
  }

  root.traverse((o) => { if (o.userData.id === undefined) o.userData.id = null; });
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  root.userData.triangleCount = countTris(root);
  root.userData.lowPower = lowPower;
  return { root, anchors, parts, bounds };
}
