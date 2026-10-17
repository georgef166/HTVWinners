// Motion engine shared by every page: reveals, word masks, magnetic buttons, 3D tilt,
// living bokeh, the iris page transition and the physical slide-to-arm switch.
(function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const embedded = window.top !== window; // inside the demo stage
  const M = { reduced, embedded };

  // ---- Reveals on scroll / load ----
  M.reveal = (root = document) => {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    root.querySelectorAll('[data-reveal], .words').forEach((el) => io.observe(el));
  };

  // ---- Split a title into masked words that rise in one by one ----
  M.splitWords = (el, baseMs = 0) => {
    const words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words.map((w, i) => `<span class="w"><span style="--i:${i}">${w}</span></span>`).join(' ');
    el.classList.add('words');
    el.style.setProperty('--base', `${baseMs}ms`);
    el.setAttribute('aria-label', words.join(' '));
    return el;
  };

  // ---- Magnetic button: leans toward the pointer ----
  M.magnetic = (el, strength = 12) => {
    if (reduced) return;
    el.classList.add('magnetic');
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - r.left - r.width / 2) / (r.width / 2);
      const dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      el.style.transform = `translate(${dx * strength}px, ${dy * strength * 0.6}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  };

  // ---- 3D tilt toward the pointer, for hero devices ----
  M.tilt = (scene, max = 9) => {
    if (reduced) return;
    scene.style.perspective = '1400px';
    let raf = null;
    addEventListener('pointermove', (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const x = e.clientX / innerWidth - 0.5;
        const y = e.clientY / innerHeight - 0.5;
        scene.style.setProperty('--rx', `${-y * max}deg`);
        scene.style.setProperty('--ry', `${x * max * 1.4}deg`);
      });
    });
  };

  // ---- Living bokeh: out-of-focus streetlights drifting past ----
  M.bokeh = (canvas, { count = 34, warmth = 1 } = {}) => {
    const ctx = canvas.getContext('2d');
    let w, h, dpr;
    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
    const palette = ['255,181,71', '255,150,60', '255,214,140', '229,48,58', '120,140,255'];
    const lights = Array.from({ length: count }, () => ({
      x: Math.random(), y: Math.random() * 0.9, z: 0.2 + Math.random() * 0.8,
      r: 8 + Math.random() * 46, c: palette[Math.random() < 0.82 * warmth ? Math.floor(Math.random() * 3) : 3 + Math.floor(Math.random() * 2)],
      a: 0.08 + Math.random() * 0.22, s: 0.002 + Math.random() * 0.006, f: Math.random() * Math.PI * 2,
    }));
    let px = 0, py = 0, tx = 0, ty = 0, alive = true;
    addEventListener('pointermove', (e) => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; });
    const draw = (t) => {
      if (!alive) return;
      px += (tx - px) * 0.04; py += (ty - py) * 0.04;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const L of lights) {
        if (!reduced) { L.x -= L.s * L.z * 0.12; if (L.x < -0.1) { L.x = 1.1; L.y = Math.random() * 0.9; } }
        const x = (L.x + px * 0.06 * L.z) * w, y = (L.y + py * 0.04 * L.z) * h;
        const flick = reduced ? 1 : 0.85 + 0.15 * Math.sin(t / 900 + L.f);
        const rad = L.r * (0.6 + L.z);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${L.c},${L.a * flick})`);
        g.addColorStop(0.55, `rgba(${L.c},${L.a * 0.45 * flick})`);
        g.addColorStop(1, `rgba(${L.c},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    return { stop: () => { alive = false; } };
  };

  // ---- Iris page transition ----
  function irisEl() {
    let el = document.getElementById('iris');
    if (!el) { el = document.createElement('div'); el.id = 'iris'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); }
    return el;
  }
  M.go = (url, fromEl) => {
    if (reduced) { location.href = url; return; }
    const el = irisEl();
    const r = fromEl ? fromEl.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    el.style.setProperty('--x', `${r.left + r.width / 2}px`);
    el.style.setProperty('--y', `${r.top + r.height / 2}px`);
    requestAnimationFrame(() => el.classList.add('close'));
    try { sessionStorage.setItem('nos_iris', '1'); } catch {}
    setTimeout(() => { location.href = url; }, 720);
  };
  M.irisIn = () => {
    let came = false;
    try { came = sessionStorage.getItem('nos_iris') === '1'; sessionStorage.removeItem('nos_iris'); } catch {}
    if (!came || reduced || embedded) return;
    const el = irisEl();
    el.classList.add('full');
    requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('open'); el.classList.remove('full'); }));
    setTimeout(() => el.remove(), 1100);
  };

  // ---- Physical slide-to-arm switch ----
  // Drag the knob to the end (or press Enter/Space, or click the track) to arm. Calls onArm once.
  M.slideSwitch = (track, onArm) => {
    const knob = track.querySelector('.knob');
    let dragging = false, startX = 0, travel = 0, p = 0, armed = false;
    const measure = () => { travel = track.clientWidth - knob.offsetWidth - 14; };
    const set = (v) => { p = Math.max(0, Math.min(1, v)); track.style.setProperty('--p', p); track.style.setProperty('--x', `${p * travel}px`); };
    const arm = () => {
      if (armed) return; armed = true;
      track.classList.add('snap', 'armed'); set(1);
      track.setAttribute('aria-checked', 'true');
      navigator.vibrate && navigator.vibrate([12, 40, 24]);
      onArm();
    };
    measure(); addEventListener('resize', measure);
    track.addEventListener('pointerdown', (e) => {
      if (armed) return;
      measure(); dragging = true; startX = e.clientX - p * travel;
      track.classList.remove('snap'); track.setPointerCapture(e.pointerId); track.style.cursor = 'grabbing';
    });
    track.addEventListener('pointermove', (e) => { if (dragging) set((e.clientX - startX) / travel); });
    const release = () => {
      if (!dragging) return;
      dragging = false; track.style.cursor = '';
      if (p > 0.82) arm();
      else if (p < 0.04) arm(); // a plain tap on the track arms too (easier when it matters)
      else { track.classList.add('snap'); set(0); }
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
    track.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); arm(); } });
  };

  window.NOS_MOTION = M;
  document.addEventListener('DOMContentLoaded', M.irisIn);
})();
