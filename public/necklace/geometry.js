// Necklace model builders (owner: 3D DEV). Units: cm. Front jewelry on +Z, exposed PCB on -Z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createMaterials, makeTextMaterial, COLORS } from './materials.js';
import { pearGemGeometry, roundStoneGeometry, createDiamondMesh } from './gem.js';

const PI = Math.PI;
const BZ = -0.15; // back surface of the PCB plate (root z)
const DEG = PI / 180;

// Component layout in "view space" from behind: bx = -root.x, by = root.y. s = scale, rot = rotation as seen from behind.
const LAY = {
  touch: { bx: 1.3, by: 0.55, rot: -40 * DEG, s: 0.6 },
  baro: { bx: -1.3, by: 0.55, rot: 45 * DEG, s: 0.6 },
  buzzer: { bx: 0, by: 0.62, rot: 0, s: 0.5 },
  brain: { bx: 0, by: -1.8, rot: 0, s: 0.47 },
};
// unscaled footprints (rect w,h or circle r)
const FOOT = { touch: { w: 1, h: 1 }, baro: { w: 1, h: 0.9 }, buzzer: { r: 0.58 }, brain: { w: 2.4, h: 1.7 } };
// local component point -> view space
const T = (id, lx, ly) => {
  const l = LAY[id], c = Math.cos(l.rot), s = Math.sin(l.rot);
  return [l.bx + l.s * (lx * c - ly * s), l.by + l.s * (lx * s + ly * c)];
};
function footprint(id, pad = 0, per = 1) {
  const f = FOOT[id], pts = [];
  if (f.r) {
    for (let i = 0; i < 24; i++) pts.push(T(id, (f.r + pad) * Math.cos((i / 24) * 2 * PI), (f.r + pad) * Math.sin((i / 24) * 2 * PI)));
    return pts;
  }
  const w = f.w / 2 + pad, h = f.h / 2 + pad, n = per;
  for (let i = 0; i < n; i++) pts.push(T(id, -w + (2 * w * i) / n, -h));
  for (let i = 0; i < n; i++) pts.push(T(id, w, -h + (2 * h * i) / n));
  for (let i = 0; i < n; i++) pts.push(T(id, w - (2 * w * i) / n, h));
  for (let i = 0; i < n; i++) pts.push(T(id, -w, h - (2 * h * i) / n));
  return pts;
}

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

// ---------- pendant silhouette (shared by the front jewelry and the back PCB) ----------
// The back plate is the union of the same shapes the front is made of: 8 feather polygons (two mirrored wings),
// a keyhole centre web, a pear lobe behind the hanging gem and an eyelet lug at each top wing tip.
const PEAR_SC = 1.12, PEAR_Y = -1.5;
const LUG_R = 0.17, LUG_HOLE = 0.055;
const RING_R = 0.1, RING_T = 0.024;
const WEB_HALF = [[0, 1.17], [0.25, 1.13], [0.45, 1.0], [0.52, 0.78], [0.52, 0.55], [0.58, 0.35], [0.72, 0.15], [0.78, -0.05], [0.72, -0.3], [0.55, -0.5], [0.3, -0.62]];
const PLATE_D = 0.16; // plate occupies z in [-0.15, 0.01], tucked into the bottom of the wings

function featherPoly(f, sx, n = 24, inset = 0) {
  const { c, nrm, w } = featherCurve(f, sx);
  const A = [], B = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, [px, py] = c(t), [nx, ny] = nrm(t), ww = Math.max(0, w(t) - inset);
    A.push([px + nx * ww, py + ny * ww]);
    B.push([px - nx * ww, py - ny * ww]);
  }
  return [...A, ...B.reverse().slice(1, -1)];
}
function webPoly(k = 1) {
  const m = ([x, y]) => [-x, y];
  const pts = [...WEB_HALF, [0, -0.66], ...WEB_HALF.slice(1).reverse().map(m)];
  const c = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal');
  return c.getPoints(90).map((p) => [p.x * k, 0.3 + (p.y - 0.3) * k]).slice(0, -1);
}
function pearPoly(n = 90, inset = 0) {
  const o = [];
  for (let i = 0; i < n; i++) { const [x, y] = pearPt(0.83 - inset, 2.39 - 2 * inset, i / n); o.push([x * PEAR_SC, y * PEAR_SC + PEAR_Y]); }
  return o;
}
// Geometry of the top wing tip: tip of the upper feather, eyelet centre, jump ring and chain end.
function tipInfo(sx) {
  const { c, nrm } = featherCurve(WING_FEATHERS[0], sx);
  const tip = c(1), r = nrm(1), e = new THREE.Vector3(r[2], r[3], 0).normalize();
  const tipV = new THREE.Vector3(tip[0], tip[1], WING_FEATHERS[0].z);
  const H = tipV.clone().addScaledVector(e, 0.1);              // eyelet (lug) centre
  const C = H.clone().addScaledVector(e, RING_R + 0.03);       // jump ring centre (ring wire sits on the hole rim)
  const apex = C.clone().addScaledVector(e, RING_R);
  const Lc = apex.clone().addScaledVector(e, 0.082);           // end link centre == ring group origin
  return { sx, tip: tipV, e, H, C, Lc };
}
function circlePoly(cx, cy, r, n = 28) {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * PI), cy + r * Math.sin((i / n) * 2 * PI)]);
}
function silhouette() {
  const feathers = [];
  const IN = 0.02; // plate is inset a hair so it hides behind the front jewelry's bevelled edge
  [1, -1].forEach((sx) => WING_FEATHERS.forEach((f) => feathers.push(featherPoly(f, sx, 24, IN))));
  const lugs = [1, -1].map((sx) => { const t = tipInfo(sx); return circlePoly(t.H.x, t.H.y, LUG_R - IN); });
  return [...feathers, webPoly(0.96), pearPoly(90, IN), ...lugs];
}
const pip = (x, y, p) => {
  let r = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [a, b] = p[i], [c, d] = p[j];
    if ((b > y) !== (d > y) && x < ((c - a) * (y - b)) / (d - b) + a) r = !r;
  }
  return r;
};
// coarse distance field of the union (root-space polygons; the union is x-symmetric)
function makeField(polys, R = 0.04) {
  const X0 = -3.2, Y0 = -3.4, NX = Math.round(6.4 / R), NY = Math.round(6.2 / R);
  const D = new Float32Array(NX * NY);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) D[j * NX + i] = polys.some((p) => pip(X0 + i * R, Y0 + j * R, p)) ? 99 : 0;
  const fw = [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]], bw = [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]];
  const relax = (nb) => (i, j) => { let d = D[j * NX + i]; for (const [di, dj, w] of nb) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < NX && b < NY) d = Math.min(d, D[b * NX + a] + w); } D[j * NX + i] = d; };
  const f1 = relax(fw), f2 = relax(bw);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) f1(i, j);
  for (let j = NY - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) f2(i, j);
  // clearance in cm at view-space (bx, by)
  return (bx, by) => {
    const i = Math.round((-bx - X0) / R), j = Math.round((by - Y0) / R);
    if (i < 0 || j < 0 || i >= NX || j >= NY) return -1;
    return D[j * NX + i] * R - R;
  };
}

// ---------- PCB texture ----------
// L = layout, nets = routes (view-space polylines), polys = silhouette polygons (root space).
function drawBoard(polys, L, nets, holes, lowPower, field) {
  const S = lowPower ? 150 : 300;
  const W = 5.6, H = 5.6, BYMAX = 2.6;
  const cw = Math.round(W * S), ch = Math.round(H * S);
  const mk = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
  const A = mk(), E = mk(), MK = mk();
  const a = A.getContext('2d'), e = E.getContext('2d'), mm = MK.getContext('2d');
  const X = (bx) => (bx + W / 2) * S;
  const Y = (by) => (BYMAX - by) * S;
  const gold = '#D1B896', silk = '#C9D3E6', aqua = '#5FD0D8';

  // union mask in view space (x mirrored)
  mm.fillStyle = '#fff';
  polys.forEach((p) => { mm.beginPath(); p.forEach(([x, y], i) => (i ? mm.lineTo(X(-x), Y(y)) : mm.moveTo(X(-x), Y(y)))); mm.closePath(); mm.fill(); });
  const erode = (cm) => {
    const c = mk(), x = c.getContext('2d');
    x.drawImage(MK, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    for (let k = 0; k < 16; k++) { const t = (k / 16) * 2 * PI; x.drawImage(MK, Math.cos(t) * cm * S, Math.sin(t) * cm * S); }
    return c;
  };
  const band = (outer, inner, paint) => { // pixels in `outer` but not in `inner`, painted
    const c = mk(), x = c.getContext('2d');
    x.drawImage(outer, 0, 0); x.globalCompositeOperation = 'destination-out'; x.drawImage(inner, 0, 0);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = paint; x.fillRect(0, 0, cw, ch);
    return c;
  };

  const grad = a.createLinearGradient(0, 0, cw, ch);
  grad.addColorStop(0, '#0f1f3b'); grad.addColorStop(0.5, '#0E1A33'); grad.addColorStop(1, '#0c2a3a');
  a.fillStyle = grad; a.fillRect(0, 0, cw, ch);
  e.fillStyle = '#000'; e.fillRect(0, 0, cw, ch);

  // blueprint grid
  a.strokeStyle = 'rgba(95,208,216,0.07)'; a.lineWidth = 1.2;
  for (let g = -2.8; g <= 2.81; g += 0.25) { a.beginPath(); a.moveTo(X(g), 0); a.lineTo(X(g), ch); a.stroke(); }
  for (let g = -3.0; g <= 2.61; g += 0.25) { a.beginPath(); a.moveTo(0, Y(g)); a.lineTo(cw, Y(g)); a.stroke(); }

  // gold edge line + castellated band following the outline
  const e1 = erode(0.04), e2 = erode(0.11);
  a.drawImage(band(MK, e1, gold), 0, 0);
  e.drawImage(band(MK, e1, 'rgb(90,75,50)'), 0, 0);
  const hatch = document.createElement('canvas'); hatch.width = hatch.height = 16;
  const hx = hatch.getContext('2d'); hx.fillStyle = gold; hx.fillRect(0, 0, 16, 7); // stripes
  const bc = band(e1, e2, '#000'); const bx = bc.getContext('2d'); bx.globalCompositeOperation = 'source-in';
  bx.fillStyle = bx.createPattern(hatch, 'repeat'); bx.fillRect(0, 0, cw, ch);
  a.globalAlpha = 0.85; a.drawImage(bc, 0, 0); a.globalAlpha = 1;
  e.globalAlpha = 0.5; e.drawImage(bc, 0, 0); e.globalAlpha = 1;

  const poly = (ctx, pts, color, wCm) => {
    ctx.strokeStyle = color; ctx.lineWidth = wCm * S; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
  };
  const dot = (ctx, x, y, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(x), Y(y), r * S, 0, PI * 2); ctx.fill(); };

  // traces: they run all the way to the pin pads under the component bodies, so nothing is disconnected
  nets.forEach((r) => { poly(a, r, 'rgba(0,0,0,0.35)', 0.07); poly(a, r, gold, 0.045); poly(e, r, 'rgb(70,58,38)', 0.045); });
  // vias at the corners of the routes
  nets.forEach((r) => {
    for (let k = 2; k < r.length - 1; k += 2) {
      const [x, y] = r[k];
      dot(a, x, y, 0.06, gold); dot(a, x, y, 0.024, '#050a14'); dot(e, x, y, 0.06, 'rgb(100,85,55)');
    }
  });
  // pads at the pin ends
  nets.forEach((r) => [r[0], r[r.length - 1]].forEach(([x, y]) => {
    dot(a, x, y, 0.08, gold); dot(a, x, y, 0.03, '#10182a'); dot(e, x, y, 0.08, 'rgb(150,125,85)');
  }));
  // eyelet pads at the wing tips (where the jump rings are)
  [1, -1].forEach((sx) => {
    const t = tipInfo(sx);
    dot(a, -t.H.x, t.H.y, 0.135, gold); dot(a, -t.H.x, t.H.y, 0.058, '#050a14'); dot(e, -t.H.x, t.H.y, 0.135, 'rgb(130,108,72)');
  });
  // mounting holes (only where they fit)
  holes.forEach(([x, y]) => {
    dot(a, x, y, 0.17, gold); dot(a, x, y, 0.095, '#03070f'); dot(e, x, y, 0.17, 'rgb(130,108,72)'); dot(e, x, y, 0.095, '#000');
    [a, e].forEach((c) => { c.strokeStyle = aqua; c.lineWidth = 0.012 * S; c.beginPath(); c.arc(X(x), Y(y), 0.23 * S, 0, PI * 2); c.stroke(); });
  });

  // footprint outlines (aqua, dashed)
  [a, e].forEach((c) => { c.save(); c.setLineDash([0.06 * S, 0.045 * S]); c.strokeStyle = aqua; c.lineWidth = 0.02 * S; });
  Object.entries(L).forEach(([id, l]) => {
    const pts = footprint(id, 0.07);
    [a, e].forEach((c) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.closePath(); c.stroke(); });
  });
  [a, e].forEach((c) => c.restore());

  // silkscreen
  const text = (str, x, y, size, rot = 0) => {
    [[a, silk], [e, '#5b6678']].forEach(([c, col]) => {
      c.save(); c.translate(X(x), Y(y)); c.rotate(-rot);
      c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `700 ${Math.round(size * S)}px Menlo, "SF Mono", Consolas, "Courier New", monospace`;
      c.fillText(str, 0, 0); c.restore();
    });
  };
  const lblSize = 0.1;
  const place = (str, cx, cy, cands) => {
    const hw = (str.length * lblSize * 0.6) / 2;
    for (const [dx, dy] of cands) {
      const x = cx + dx, y = cy + dy;
      if ([-1, -0.5, 0, 0.5, 1].every((k) => [-0.05, 0.05].every((v) => field(x + k * hw, y + v) > 0.1))) { text(str, x, y, lblSize); return; }
    }
  };
  place('BUZZER D8', L.buzzer.bx, L.buzzer.by, [[0, 0.4], [0, -0.4]]);
  place('TOUCH D4', L.touch.bx, L.touch.by, [[0.1, 0.5], [0.3, 0.45], [0.3, -0.45], [0.5, 0], [0, -0.5]]);
  place('BARO I2C', L.baro.bx, L.baro.by, [[-0.1, 0.5], [-0.3, 0.45], [-0.3, -0.45], [-0.5, 0], [0, -0.5]]);
  place('tenshi  REV A', 0, -2.47, [[0, 0], [0, 0.05]]);

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
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const P = [], N = [];
  for (let i = 0; i < pos.count; i += 3) {
    if (nor.getZ(i) + nor.getZ(i + 1) + nor.getZ(i + 2) > 0.9) continue;
    for (let k = 0; k < 3; k++) {
      P.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      N.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.deleteAttribute('uv');
  geo.clearGroups();
}

function buildPcb(M, lowPower, polys, nets, holes, field) {
  const g = new THREE.Group();
  g.userData.pcb = true; // highlight.js: dims (not hides) with the rest of the back
  const shapes = polys.map((p) => new THREE.Shape(p.map(([x, y]) => new THREE.Vector2(x, y))));

  // plate body (navy board edge), tucked up into the wings so it touches them
  const bodyGeo = new THREE.ExtrudeGeometry(shapes, { depth: PLATE_D, bevelEnabled: false, curveSegments: 1 });
  stripFrontFaces(bodyGeo);
  const body = new THREE.Mesh(bodyGeo, M.maskEdge);
  body.position.z = BZ;
  g.add(body);
  // depth-only occluder just inside the back face: hides the mounted hardware from the front view
  const occ = new THREE.Mesh(new THREE.ShapeGeometry(shapes, 1), new THREE.MeshBasicMaterial({ colorWrite: false }));
  occ.position.z = BZ + 0.06;
  occ.renderOrder = -10;
  occ.userData.id = null;
  g.add(occ);

  // lowPower: the gem is plainly transparent, so give it a dark backing instead of relying on the depth-only occluder
  if (lowPower) {
    const backing = new THREE.Mesh(new THREE.ShapeGeometry(shapes[shapes.length - 3], 1), M.maskEdge);
    backing.position.z = BZ + 0.062;
    backing.userData.id = null;
    g.add(backing);
  }
  // textured back face
  const tex = drawBoard(polys, LAY, nets, holes, lowPower, field);
  const geo = new THREE.ShapeGeometry(shapes, 1);
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
  return { group: g };
}

// ---------- components (local frame: x right-from-behind, y up, +z away from board) ----------
function buildTouch(M) {
  const g = new THREE.Group();
  g.add(box(1, 1, 0.06, M.modBlue, 0, 0, 0));
  g.add(cyl(0.35, 0.012, M.maskDark, 0, 0.14, 0.05, 40));
  g.add(cyl(0.3, 0.035, M.copper, 0, 0.14, 0.045, 40));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 36), M.goldLightPin || M.pin);
  ring.position.set(0, 0.14, 0.085); g.add(ring);
  g.add(box(0.18, 0.13, 0.05, M.black, -0.38, 0.4, 0.04)); // TTP223 IC
  g.add(box(0.07, 0.05, 0.02, M.aqua, 0.38, 0.4, 0.045)); // power LED
  g.add(box(0.66, 0.1, 0.09, M.black, 0, -0.42, 0.04)); // header housing
  [-0.2, 0, 0.2].forEach((x) => g.add(box(0.035, 0.035, 0.3, M.pin, x, -0.42, 0.0)));
  g.add(plane(0.9, 0.2, makeTextMaterial([
    { text: 'SIG', x: -0.2, y: 0, size: 0.07 }, { text: 'VCC', x: 0, y: 0, size: 0.07 }, { text: 'GND', x: 0.2, y: 0, size: 0.07 },
  ], 0.9, 0.2), 0, -0.29, 0.057));
  return g;
}

function buildBuzzer(M) {
  const g = new THREE.Group();
  g.add(cyl(0.52, 0.45, M.canBlack, 0, 0, -0.02, 40));
  g.add(cyl(0.45, 0.012, M.canTop, 0, 0, 0.425, 40));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.014, 6, 40), M.silver);
  rim.position.z = 0.43; g.add(rim);
  g.add(cyl(0.085, 0.014, M.hole, 0, 0, 0.43, 20));
  const hr = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.012, 6, 24), M.silver);
  hr.position.z = 0.44; g.add(hr);
  g.add(plane(0.2, 0.2, makeTextMaterial([{ text: '+', x: 0, y: 0, size: 0.18 }], 0.2, 0.2), -0.3, 0.27, 0.4385));
  [-1, 1].forEach((s) => {
    g.add(cyl(0.032, 0.22, M.pin, s * 0.35, -0.45, -0.03, 10));
    g.add(box(0.05, 0.16, 0.02, M.pin, s * 0.34, -0.38, -0.01));
  });
  return g;
}

function buildBaro(M) {
  const g = new THREE.Group();
  g.add(box(1, 0.9, 0.05, M.modTeal, 0, 0, 0));
  g.add(box(0.36, 0.36, 0.08, M.silver, 0, 0.05, 0.03)); // DPS310 LGA lid
  g.add(cyl(0.05, 0.012, M.hole, 0.09, 0.14, 0.10, 14)); // pressure port
  // gold pad outline
  const o = 0.48, t = 0.022;
  g.add(box(o, t, 0.012, M.pin, 0, 0.05 + o / 2, 0.045));
  g.add(box(o, t, 0.012, M.pin, 0, 0.05 - o / 2, 0.045));
  g.add(box(t, o, 0.012, M.pin, -o / 2, 0.05, 0.045));
  g.add(box(t, o, 0.012, M.pin, o / 2, 0.05, 0.045));
  g.add(box(1.06, 0.1, 0.09, M.black, 0, -0.38, 0.03)); // header housing
  [-0.375, -0.125, 0.125, 0.375].forEach((x) => g.add(box(0.035, 0.035, 0.28, M.pin, x, -0.38, 0.0)));
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
  board.position.z = 0.03; g.add(board);
  // USB-C connector on the left end
  g.add(box(0.5, 0.62, 0.2, M.silver, -1.12, 0.3, 0.05));
  g.add(box(0.02, 0.42, 0.08, M.black, -1.375, 0.3, 0.11));
  // LED matrix 12x8
  g.add(box(1.0, 0.72, 0.03, M.black, -0.15, 0.05, 0.05));
  const pat = [
    '............', '..........1.', '.........11.', '1.......11..', '11.....11...', '.11...11....', '..11.11.....', '...111......',
  ];
  const on = [], off = [];
  for (let j = 0; j < 8; j++) for (let i = 0; i < 12; i++) {
    const p = new THREE.Vector3(-0.15 + (i - 5.5) * 0.075, 0.05 + (3.5 - j) * 0.075, 0.08 + 0.004);
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
  g.add(box(0.46, 0.46, 0.06, M.black, 0.82, 0.25, 0.05));
  g.add(cyl(0.03, 0.01, M.silver, 0.64, 0.43, 0.10, 10));
  g.add(box(0.52, 0.4, 0.04, M.silver, 0.82, -0.28, 0.05));
  g.add(box(0.52, 0.1, 0.05, M.black, 0.82, -0.4, 0.05));
  // headers
  g.add(box(2.3, 0.1, 0.12, M.black, 0, 0.72, 0.05));
  [-1.0, -0.8, -0.375, -0.125, 0.125, 0.375, 0.8, 1.0, 1.2].forEach((x) => g.add(box(0.035, 0.035, 0.22, M.pin, x, 0.72, 0.0)));
  g.add(box(2.0, 0.1, 0.12, M.black, 0, -0.72, 0.05));
  for (let k = 0; k < 8; k++) g.add(box(0.035, 0.035, 0.22, M.pin, -0.875 + k * 0.25, -0.72, 0.0));
  // reset button, status LED, label
  g.add(box(0.16, 0.16, 0.05, M.silver, -0.92, -0.42, 0.05));
  g.add(cyl(0.045, 0.03, M.black, -0.92, -0.42, 0.09, 12));
  g.add(box(0.06, 0.04, 0.02, M.aqua, -0.92, -0.18, 0.05));
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
const F_DEPTH = 0.04, F_BEVEL = 0.03;

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
    depth: F_DEPTH, bevelEnabled: true, bevelThickness: F_BEVEL, bevelSize: 0.025, bevelSegments: low ? 2 : 4, curveSegments: 1,
  });
}

function buildWings(M, lowPower) {
  const g = new THREE.Group();
  const pave = [], barbs = [];
  const mats = [M.goldLight, M.gold, M.goldDeep, M.gold];
  [1, -1].forEach((sx) => {
    WING_FEATHERS.forEach((f, i) => {
      // caps: satin brushed along the feather; sides + bevel: polished
      const angle = sx > 0 ? f.ang : 180 - f.ang;
      const m = new THREE.Mesh(featherGeo(f, sx, lowPower), [M.feather(angle, f.pave ? 1 : i === 2 ? 0 : 2), M.goldBase]);
      m.position.z = f.z;
      g.add(m);
      const { c, nrm, w } = featherCurve(f, sx);
      const zTop = f.z + F_DEPTH + F_BEVEL;
      // midrib
      const rib = [];
      for (let k = 0; k <= 10; k++) { const t = 0.08 + (0.84 * k) / 10, p = c(t); rib.push(new THREE.Vector3(p[0], p[1], zTop + 0.004)); }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rib), lowPower ? 8 : 16, 0.012, 4, false), M.engrave));
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
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.012, 0.01), M.engrave, barbs.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), ax = new THREE.Vector3(0, 0, 1), sc = new THREE.Vector3(), pp = new THREE.Vector3();
    barbs.forEach(([x, y, z, a, len], k) => {
      q.setFromAxisAngle(ax, a); sc.set(len, 1, 1); pp.set(x, y, z);
      im.setMatrixAt(k, m4.compose(pp, q, sc));
    });
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }
  // gold keyhole web joining the two wings under the centre stone (same outline as the back plate's web)
  const web = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(webPoly().map(([x, y]) => new THREE.Vector2(x, y))), {
    depth: 0.05, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: lowPower ? 3 : 6, curveSegments: 1,
  }), M.gold);
  g.add(web);
  // eyelet lugs at the top outer tip of each wing (jump rings pass through these holes)
  [1, -1].forEach((sx) => {
    const t = tipInfo(sx);
    const sh = new THREE.Shape(circlePoly(0, 0, LUG_R, lowPower ? 16 : 28).map(([x, y]) => new THREE.Vector2(x, y)));
    sh.holes.push(new THREE.Path(circlePoly(0, 0, LUG_HOLE, 16).map(([x, y]) => new THREE.Vector2(x, y))));
    const lug = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: F_DEPTH, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: lowPower ? 2 : 4, curveSegments: 1 }), M.goldLight);
    lug.position.set(t.H.x, t.H.y, WING_FEATHERS[0].z);
    g.add(lug);
  });
  return g;
}

function buildNeck(M, lowPower) {
  const g = new THREE.Group();
  const prof = [[0.0, 0.15], [0.07, 0.147], [0.13, 0.13], [0.18, 0.09], [0.2, 0.03], [0.155, -0.06], [0.105, -0.15], [0.09, -0.22], [0.11, -0.3], [0.16, -0.38], [0.2, -0.45], [0.2, -0.5]];
  const pts = new THREE.SplineCurve(prof.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(lowPower ? 18 : 40);
  const neck = new THREE.Mesh(new THREE.LatheGeometry(pts, lowPower ? 16 : 36), M.gold);
  neck.scale.set(1, 1, 0.5);
  g.add(neck);
  // bail band wrapped around the waist
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.04, lowPower ? 8 : 14, lowPower ? 18 : 36), M.gold);
  band.rotation.x = PI / 2; band.scale.set(1, 0.55, 1); band.position.set(0, -0.21, 0);
  g.add(band);
  g.position.set(0, 0, 0.19);
  return g;
}

function buildCenterStone(M, lowPower = false) {
  const g = new THREE.Group();
  // round brilliant (8 star, 8 kite, 16 upper-girdle, girdle, 16 lower-girdle, 8 pavilion, culet), flat shaded
  const sg = roundStoneGeometry(lowPower);
  const stone = lowPower ? new THREE.Mesh(sg, M.centerStone) : createDiamondMesh(sg, { bounces: 4, boost: 2.6, floorLevel: 0.28 });
  stone.position.z = 0.06;
  g.add(stone);
  // flared cast cup (lathe, concave blend) with four tapered prongs that curve out of it and hook over the girdle
  const cupProf = [[0.0, -0.19], [0.09, -0.185], [0.15, -0.15], [0.2, -0.09], [0.265, -0.03], [0.305, 0.02], [0.31, 0.045]];
  const cupPts = new THREE.SplineCurve(cupProf.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(lowPower ? 14 : 28);
  cupPts.push(new THREE.Vector2(0.285, 0.062), new THREE.Vector2(0.0, 0.062)); // rounded rim, flat inside under the stone
  const cup = new THREE.Mesh(new THREE.LatheGeometry(cupPts.reverse(), lowPower ? 16 : 32), M.gold);
  cup.rotation.x = PI / 2;
  g.add(cup);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.292, 0.035, lowPower ? 6 : 10, lowPower ? 24 : 48), M.gold);
  rim.position.z = 0.045; g.add(rim);
  for (let k = 0; k < 4; k++) {
    const a = PI / 4 + (k * PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
    const P = (r, z) => new THREE.Vector3(ca * r, sa * r, z);
    const curve = new THREE.CatmullRomCurve3([P(0.17, -0.12), P(0.27, -0.04), P(0.325, 0.04), P(0.3, 0.12), P(0.235, 0.17)]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, lowPower ? 8 : 16, 0.036, lowPower ? 6 : 10, false), M.gold);
    g.add(tube);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.047, lowPower ? 8 : 12, lowPower ? 6 : 8), M.gold);
    tip.position.copy(P(0.232, 0.172));
    g.add(tip);
    const root = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 8), M.gold); // blends the prong into the cup flare
    root.position.copy(P(0.29, 0.0)); root.scale.set(1, 1, 1.5);
    g.add(root);
  }
  return g;
}

// Pear point at loop parameter s in [0,1): tip -> down the right side -> bottom -> up the left side
function pearPt(hw, h, s) {
  const side = s < 0.5 ? 1 : -1, u = s < 0.5 ? 2 * s : 2 * (1 - s);
  return [side * hw * Math.pow(Math.sin(PI * Math.pow(u, 1.45)), 0.7), h / 2 - u * h];
}

function buildPear(M, lowPower) {
  const g = new THREE.Group();
  const pg = pearGemGeometry(lowPower);
  const gem = lowPower ? new THREE.Mesh(pg, M.gem) : createDiamondMesh(pg, { bounces: 4, boost: 2.4, floorLevel: 0.28 });
  g.add(gem);
  // thin smooth bezel hugging the girdle
  const o = Array.from({ length: lowPower ? 40 : 72 }, (_, i) => { const [x, y] = pearPt(0.78, 2.3, i / (lowPower ? 40 : 72)); return new THREE.Vector3(x, y, 0); });
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(o, true, 'centripetal'), lowPower ? 40 : 96, 0.048, lowPower ? 6 : 12, true), M.gold));
  return g;
}

function buildChain(M, lowPower) {
  // open chain from the jump ring at the top outer tip of one wing, up and around the neck, down to the other wing
  const R = tipInfo(1), Lf = tipInfo(-1);
  const p1 = R.Lc.clone().addScaledVector(R.e, 0.5);
  const mid = [[3.15, 3.9, 0.05], [3.5, 5.4, -0.8], [3.7, 7.5, -2.3], [3.05, 9.2, -4.5], [0, 9.6, -5.6]].map((p) => new THREE.Vector3(...p));
  const right = [R.Lc.clone(), p1, ...mid];
  const left = right.slice(0, -1).reverse().map((v) => new THREE.Vector3(-v.x, v.y, v.z));
  const curve = new THREE.CatmullRomCurve3([...right, ...left], false, 'centripetal');
  const len = curve.getLength();
  const SP = 0.16;
  let N = Math.round(len / SP);
  if (lowPower) N = Math.round(N * 0.8);
  if (N % 2 === 0) N++; // odd count: both end links share the same orientation (flat, hooked on the rings)
  const geo = new THREE.TorusGeometry(0.062, 0.02, lowPower ? 4 : 6, lowPower ? 10 : 14);
  geo.scale(1.7, 1, 1);
  const spacing = len / (N - 1), s = Math.min(1.25, spacing / SP);
  const im = new THREE.InstancedMesh(geo, M.chain, N);
  const T3 = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), ref = new THREE.Vector3();
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), sc = new THREE.Vector3(s, s, s);
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    curve.getPointAt(u, p);
    curve.getTangentAt(u, T3).normalize();
    ref.set(0, 0, 1);
    if (Math.abs(T3.dot(ref)) > 0.9) ref.set(0, 1, 0);
    n.copy(ref).addScaledVector(T3, -T3.dot(ref)).normalize();
    if (i % 2 === 0) { b.crossVectors(n, T3); m4.makeBasis(T3, b, n); } // flat (plane contains T and n x T)
    else { b.crossVectors(T3, n); m4.makeBasis(T3, n, b); }            // turned 90 degrees
    m4.scale(sc);
    m4.setPosition(p);
    im.setMatrixAt(i, m4);
  }
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  const g = new THREE.Group();
  g.add(im);
  // jump rings: threaded through the wing-tip eyelet holes; the end links hang through them.
  // Each ring group sits exactly on the chain end (end link centre).
  const rings = [R, Lf].map((t, k) => {
    const grp = new THREE.Group();
    grp.name = k ? 'jumpring-left' : 'jumpring-right';
    const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R, RING_T, lowPower ? 6 : 8, lowPower ? 18 : 28), M.gold);
    const ez = new THREE.Vector3(0, 0, 1);
    m4.makeBasis(t.e, ez, new THREE.Vector3().crossVectors(t.e, ez));
    ring.quaternion.setFromRotationMatrix(m4);
    ring.position.copy(t.C).sub(t.Lc);
    grp.add(ring);
    grp.position.copy(t.Lc);
    g.add(grp);
    return grp;
  });
  g.userData.chainEnds = { right: R.Lc.clone(), left: Lf.Lc.clone(), rings: rings.map((r) => r.position.clone()) };
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

// polyline offset (miter) by d along n = (-dy, dx)
function offsetLine(pts, d) {
  const seg = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy);
    seg.push([-dy / l, dx / l]);
  }
  return pts.map((p, i) => {
    const n1 = seg[Math.max(0, i - 1)], n2 = seg[Math.min(seg.length - 1, i)];
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my); mx /= ml; my /= ml;
    const k = d / (mx * n1[0] + my * n1[1]);
    return [p[0] + mx * k, p[1] + my * k];
  });
}

// Gold traces between the components and the Arduino header (view space polylines).
function buildNets() {
  const nets = [];
  const HX = [-1.0, -0.8, -0.375, -0.125, 0.125, 0.375, 0.8, 1.0, 1.2]; // Arduino top header pins (local x)
  const brainPin = (k) => T('brain', HX[k], 0.72);
  const PITCH = 0.045, YT = -1.0;
  // pins sorted by their position along the bus normal so the lanes never cross
  const bus = (pins, base, firstTarget) => {
    const dir = [base[1][0] - base[0][0], base[1][1] - base[0][1]];
    const dl = Math.hypot(...dir), nrm = [-dir[1] / dl, dir[0] / dl];
    const sorted = pins.slice().sort((p, q) => p[0] * nrm[0] + p[1] * nrm[1] - (q[0] * nrm[0] + q[1] * nrm[1]));
    sorted.forEach((P, k) => {
      const off = (k - (sorted.length - 1) / 2) * PITCH;
      const lane = offsetLine(base, off);
      const lx = lane[lane.length - 1][0], tp = brainPin(firstTarget + k), tx = tp[0];
      const d = Math.abs(tx - lx);
      const path = [P, ...lane, [lx, YT], [tx, YT - d], tp];
      nets.push(path.filter((q, i) => !i || Math.hypot(q[0] - path[i - 1][0], q[1] - path[i - 1][1]) > 1e-4));
    });
  };
  const mid = (ps) => [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
  const dirOf = (id) => { const l = LAY[id]; return [Math.sin(l.rot), -Math.cos(l.rot)]; }; // local -y in view space
  const exit = (id, pins, dist) => { const m = mid(pins), d = dirOf(id); return [m[0] + d[0] * dist, m[1] + d[1] * dist]; };
  // baro (view left) -> header pins 0..3
  const bp = [-0.375, -0.125, 0.125, 0.375].map((x) => T('baro', x, -0.38));
  bus(bp, [exit('baro', bp, 0.3), [-0.64, -0.2], [-0.4, -0.44], [-0.17, -0.67], [-0.17, -0.75]], 0);
  // touch (view right) -> header pins 6..8
  const tp = [-0.2, 0, 0.2].map((x) => T('touch', x, -0.42));
  bus(tp, [exit('touch', tp, 0.3), [0.62, -0.2], [0.33, -0.49], [0.17, -0.65], [0.17, -0.75]], 6);
  // buzzer legs -> header pins 4..5 (straight down the centre)
  const bz = [-0.35, 0.35].map((x) => T('buzzer', x, -0.45));
  bz.forEach((P, k) => {
    const lx = (k ? 1 : -1) * 0.0225, tpn = brainPin(4 + k), d = Math.abs(tpn[0] - lx);
    const dyv = Math.abs(P[0] - lx);
    nets.push([P, [P[0], 0.05], [lx, 0.05 - dyv], [lx, YT], [tpn[0], YT - d], tpn]);
  });
  return nets;
}

export function buildNecklace({ lowPower = false } = {}) {
  const M = createMaterials({ lowPower });
  const root = new THREE.Group();
  root.name = 'necklace';

  const polys = silhouette();
  const field = makeField(polys);
  const nets = buildNets();
  // mounting holes only where a pad ring fits inside the outline and clear of all components
  const holes = [[1.9, 1.15], [2.05, 0.6], [1.0, 1.9], [1.55, 1.5], [0.0, -2.35], [0.8, -0.85]]
    .flatMap(([x, y]) => [[x, y], [-x, y]])
    .filter(([x, y]) => field(x, y) > 0.3 && Object.keys(LAY).every((id) => Math.hypot(x - LAY[id].bx, y - LAY[id].by) > 0.75 * LAY[id].s * Math.max(FOOT[id].w || 0, FOOT[id].h || 0, (FOOT[id].r || 0) * 2) + 0.35));

  // ---- front jewelry (+Z) ----
  root.add(buildChain(M, lowPower));
  const pcb = buildPcb(M, lowPower, polys, nets, holes, field);
  root.add(pcb.group);

  root.add(buildWings(M, lowPower));
  const cs = buildCenterStone(M, lowPower);
  cs.position.set(0, 0.68, 0.225);
  root.add(cs);
  const pear = buildPear(M, lowPower);
  pear.scale.setScalar(PEAR_SC);
  pear.position.set(0, PEAR_Y, 0.2);
  root.add(pear);
  // one cast neck: flares out of the web, pinches at the bail, flares again into the gem bezel
  root.add(buildNeck(M, lowPower));

  // ---- hardware components (-Z) ----
  const builders = { touch: () => buildTouch(M), buzzer: () => buildBuzzer(M), baro: () => buildBaro(M), brain: () => buildBrain(M, lowPower) };
  const topH = { touch: 0.3, buzzer: 0.45, baro: 0.3, brain: 0.28 };
  const dist = { touch: 4.0, buzzer: 3.8, baro: 4.0, brain: 5.6 };
  const parts = {}, anchors = {};
  const SINK = 0.025; // components sit slightly into the board
  for (const id of Object.keys(LAY)) {
    const l = LAY[id];
    const part = new THREE.Group();
    const inner = builders[id]();
    inner.rotation.z = l.rot;
    inner.scale.setScalar(l.s);
    part.add(inner);
    part.position.set(-l.bx, l.by, BZ + SINK);
    part.rotation.y = PI; // local x -> view-right (root -x), local +z -> root -z
    registerPart(part, id);
    root.add(part);
    parts[id] = part;

    const anchor = new THREE.Object3D();
    anchor.name = 'anchor-' + id;
    anchor.position.set(-l.bx, l.by, BZ + SINK - topH[id] * l.s);
    const d = dist[id];
    // offset = camera position relative to lookAt, in root-local space (negative z = behind the board)
    const off = new THREE.Vector3(0.1, 0.22, -1).normalize().multiplyScalar(d);
    anchor.userData.focus = { offset: off, distance: d, lookAt: anchor.position.clone() };
    root.add(anchor);
    anchors[id] = anchor;
  }

  // fit report: minimum clearance of each footprint to the plate edge (cm)
  const fit = {};
  for (const id of Object.keys(LAY)) fit[id] = +Math.min(...footprint(id, 0, 6).map(([x, y]) => field(x, y))).toFixed(3);
  root.userData.fit = fit;
  root.userData.nets = nets;

  root.traverse((o) => { if (o.userData.id === undefined) o.userData.id = null; });
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  root.userData.triangleCount = countTris(root);
  root.userData.lowPower = lowPower;
  root.userData.chainEnds = root.children[0].userData.chainEnds;
  return { root, anchors, parts, bounds };
}
