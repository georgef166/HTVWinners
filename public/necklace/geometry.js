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
const TIPS = [[2.0, -1.9], [2.4, -0.9], [2.6, 0.3], [2.65, 1.5], [2.55, 2.6], [2.35, 3.6], [1.75, 3.15], [1.15, 2.9], [0.5, 2.78]];
function outlinePoints() {
  const right = [[0, -3.05], [0.8, -2.95], [1.45, -2.6]];
  TIPS.forEach((t, j) => {
    if (j) {
      const p = TIPS[j - 1];
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

function buildPcb(M, lowPower) {
  const g = new THREE.Group();
  const outline = outlinePoints();
  const shape = new THREE.Shape(outline);

  // plate body (neat navy board edge)
  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 1 }),
    M.maskEdge,
  );
  body.position.z = BZ + 0.02;
  g.add(body);

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
const FEATHER_BEND = 0.2;
function featherGeo(L, W, depth, low, sign) {
  const n = low ? 7 : 11;
  const R = [], Lf = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const xc = -sign * FEATHER_BEND * L * t * t;
    const w = W * 0.72 * Math.pow(Math.sin(PI * Math.pow(t, 0.7)), 0.85);
    R.push(new THREE.Vector2(xc + w, t * L));
    Lf.push(new THREE.Vector2(xc - w, t * L));
  }
  const pts = [...R, ...Lf.reverse().slice(1, -1)];
  const s = new THREE.Shape(pts);
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: low ? 1 : 2, curveSegments: 1 });
}

// right wing feather spec: one feather per tip, fanning from a spine on the centre line
const FEATHERS = TIPS.map(([tx, ty], j) => {
  const rx = 0.0, ry = -2.5 + (3.6 * j) / (TIPS.length - 1);
  const dx = tx - rx, dy = ty - ry;
  return { rx, ry, L: Math.hypot(dx, dy) / Math.sqrt(1 + FEATHER_BEND * FEATHER_BEND), th: Math.atan2(dx, dy) + Math.atan(FEATHER_BEND) };
});

function buildWings(M, lowPower) {
  const g = new THREE.Group();
  const rows = [
    { k: 1.0, W: 0.7, z: -0.16, mat: M.goldDeep },
    { k: 0.78, W: 0.6, z: -0.065, mat: M.gold },
    { k: 0.55, W: 0.5, z: 0.03, mat: M.goldLight },
  ];
  const depth = 0.04;
  const pave = [];
  rows.forEach((row, ri) => {
    FEATHERS.forEach((f, i) => {
      const L = f.L * row.k;
      const zz = row.z + i * 0.004;
      [1, -1].forEach((s) => {
        const m = new THREE.Mesh(featherGeo(L, row.W, depth, lowPower, s), row.mat);
        m.position.set(s * f.rx, f.ry, zz);
        m.rotation.z = -s * f.th;
        g.add(m);
      });
      // pave on the upper feathers of rows 1 and 2
      if (!lowPower && ((ri === 1 && i >= 4) || ri === 2) && L > 0.7) {
        const step = 0.17;
        const zTop = zz + depth + 0.02 + 0.025;
        for (let d = 0.3; d < L - 0.15; d += step) {
          const t = d / L;
          const hw = row.W * 0.6 * Math.sin(PI * Math.pow(t, 0.7));
          const offs = hw > 0.2 ? [-0.075, 0.075] : hw > 0.1 ? [0] : [];
          if (hw > 0.28) offs.push(-0.15, 0.15);
          for (const o of offs) {
            const xl = -FEATHER_BEND * d * t + o;
            const px = f.rx + xl * Math.cos(f.th) + d * Math.sin(f.th);
            const py = f.ry - xl * Math.sin(f.th) + d * Math.cos(f.th);
            pave.push([px, py, zTop]);
          }
        }
      }
    });
  });
  if (pave.length) {
    const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.042, 1), M.pave, pave.length * 2);
    const m4 = new THREE.Matrix4();
    let n = 0;
    pave.forEach(([x, y, z]) => {
      im.setMatrixAt(n++, m4.makeTranslation(x, y, z));
      im.setMatrixAt(n++, m4.makeTranslation(-x, y, z));
    });
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
  return g;
}

function buildCenterStone(M) {
  const g = new THREE.Group();
  const prof = [[0, 0.13], [0.15, 0.13], [0.3, 0.02], [0.3, -0.02], [0.14, -0.14], [0, -0.3]].map(([r, y]) => new THREE.Vector2(r, y));
  const stone = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), M.centerStone);
  stone.rotation.x = PI / 2; // table faces +Z
  g.add(stone);
  const bez = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 32), M.gold);
  g.add(bez);
  return g;
}

function buildPear(M, lowPower) {
  const g = new THREE.Group();
  const P = [[0, 1.45], [0.1, 1.2], [0.25, 0.8], [0.45, 0.3], [0.68, -0.2], [0.8, -0.65], [0.78, -1.05], [0.6, -1.35], [0.3, -1.52], [0, -1.58]];
  const gem = new THREE.Mesh(new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(r, y)), 16), M.gem);
  gem.scale.set(1, 1, 0.5);
  g.add(gem);
  // bezel hugging the silhouette
  const side = P.slice(1, -1);
  const loop = [new THREE.Vector3(0, 1.47, 0), ...side.map(([r, y]) => new THREE.Vector3(r * 1.03, y, 0)), new THREE.Vector3(0, -1.6, 0),
    ...side.slice().reverse().map(([r, y]) => new THREE.Vector3(-r * 1.03, y, 0))];
  const curve = new THREE.CatmullRomCurve3(loop, true, 'centripetal');
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, lowPower ? 40 : 80, 0.045, 6, true), M.gold));
  // collar at the tip
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.15, 0.3, 12), M.gold);
  collar.position.y = 1.5; g.add(collar);
  g.scale.setScalar(0.92);
  return g;
}

function buildChain(M, lowPower) {
  const pts = [
    [0, 3.07, 0], [-1.1, 4.5, -0.1], [-2.6, 6.3, -0.9], [-3.6, 8.2, -2.4], [-3.0, 9.3, -4.6], [0, 9.6, -5.6],
    [3.0, 9.3, -4.6], [3.6, 8.2, -2.4], [2.6, 6.3, -0.9], [1.1, 4.5, -0.1],
  ].map((p) => new THREE.Vector3(...p));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const N = lowPower ? 54 : 90;
  const len = curve.getLength();
  const spacing = len / N;
  const geo = new THREE.TorusGeometry(0.1, 0.03, lowPower ? 4 : 6, lowPower ? 10 : 14);
  geo.scale(1.7, 1, 1);
  const s = Math.min(1.5, (spacing * 1.5) / 0.46);
  const im = new THREE.InstancedMesh(geo, M.chain, N);
  const T = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), ref = new THREE.Vector3(0, 0, 1);
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), nb = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const u = i / N;
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
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 8, 24), M.gold);
  bail.rotation.y = PI / 2;
  bail.position.set(0, 2.95, 0);
  g.add(bail);
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

  // gold base silhouette on the plate front
  const baseShape = new THREE.Shape(pcb.outline.map((p) => new THREE.Vector2(p.x * 0.985, p.y * 0.985)));
  const base = new THREE.Mesh(new THREE.ExtrudeGeometry(baseShape, { depth: 0.06, bevelEnabled: false, curveSegments: 1 }), M.goldBase);
  base.position.z = -0.25;
  root.add(base);
  root.add(buildWings(M, lowPower));
  const cs = buildCenterStone(M);
  cs.position.set(0, 2.15, 0.2);
  root.add(cs);
  const pear = buildPear(M, lowPower);
  pear.position.set(0, -2.33, 0.3);
  root.add(pear);

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
