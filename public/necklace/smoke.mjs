// Smoke test: node public/necklace/smoke.mjs   (BASE=http://localhost:3000 by default)
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const FILES = [
  '/necklace.html',
  '/vendor/three/three.module.js',
  '/necklace/main.js', '/necklace/data.js', '/necklace/ui.js', '/necklace/necklace.css',
  '/necklace/geometry.js', '/necklace/materials.js', '/necklace/camera.js', '/necklace/hotspots.js', '/necklace/highlight.js',
];
const IDS = ['touch', 'buzzer', 'baro', 'brain'];
let failed = 0;
const bad = (msg) => { failed++; console.error(`FAIL ${msg}`); };

for (const path of FILES) {
  try {
    const res = await fetch(BASE + path);
    if (res.status !== 200) bad(`${path} -> ${res.status}`);
    else {
      console.log(`ok   ${path}`);
      if (path === '/necklace/data.js') {
        const src = await res.text();
        for (const id of IDS) if (!new RegExp(`['"]${id}['"]`).test(src)) bad(`data.js is missing id "${id}"`);
      }
    }
  } catch (err) { bad(`${path} -> ${err.message}`); }
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all checks passed');
