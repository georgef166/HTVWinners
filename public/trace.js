// SignalTrace: her night as a live, scrolling signal line.
//  - A calm amber wave while she's answering check-ins
//  - A sharp spike every time she responds (check-in, PIN)
//  - The line goes flat and red when she goes quiet
//  - Dots underneath for her phone's heartbeats (the phone can be fine while she isn't)
(function () {
  const SILENT = { NUDGE: '#FFB547', ALARM: '#E5303A', CONTACT: '#E5303A', WIDER: '#E5303A' };
  const LABELS = {
    NUDGE: 'Check-in', ALARM: 'No answer', CONTACT: 'Contact alerted', WIDER: 'Backup alerted', RESOLVED: 'Night ended',
  };

  class SignalTrace {
    constructor(canvas, { tone = 'night', showLabels = true } = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.tone = tone; // 'night' on dark backgrounds, 'alert' on red
      this.showLabels = showLabels;
      this.data = null;
      this.offset = 0;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
      const loop = () => { this.draw(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.w = Math.max(1, r.width);
      this.h = Math.max(1, r.height);
      this.canvas.width = this.w * dpr;
      this.canvas.height = this.h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    update(trace) {
      if (!trace) return;
      this.data = trace;
      this.offset = Date.now() - new Date(trace.now).getTime(); // server clock vs ours
      this.events = trace.events.map((e) => ({ ...e, ms: new Date(e.t).getTime() }));
    }

    // Level segments over the window: [{from, to, level}]
    segments(t0, now) {
      const segs = [];
      let level = this.data.level_at_start || 'ARMED';
      let start = t0;
      for (const e of this.events) {
        if (e.kind !== 'level_change' || !e.detail?.to) continue;
        segs.push({ from: start, to: e.ms, level });
        level = e.detail.to;
        start = e.ms;
      }
      segs.push({ from: start, to: now, level });
      return segs;
    }

    draw() {
      const { ctx, w, h } = this;
      ctx.clearRect(0, 0, w, h);
      if (!this.data) return;
      const alertTone = this.tone === 'alert';
      const now = Date.now() - this.offset;
      const span = this.data.window_s * 1000;
      const t0 = now - span;
      const x = (t) => ((t - t0) / span) * w;
      const base = h * 0.58;
      const segs = this.segments(t0, now);
      const levelAt = (t) => { for (const s of segs) if (t >= s.from && t <= s.to) return s.level; return segs.at(-1).level; };
      const responses = this.events.filter((e) => e.kind === 'checkin_ack' || e.kind === 'stand_down' || (e.kind === 'level_change' && !e.detail?.from && e.detail?.to === 'ARMED') || (e.kind === 'device' && e.detail?.type === 'touch'));
      const spikeXs = responses.map((e) => x(e.ms));

      // Grid: one faint line per 15 s (demo) or 5 min (real)
      ctx.strokeStyle = alertTone ? 'rgba(255,255,255,.12)' : 'rgba(174,181,218,.08)';
      ctx.lineWidth = 1;
      const step = this.data.window_s <= 300 ? 15000 : 300000;
      for (let t = Math.ceil(t0 / step) * step; t < now; t += step) {
        ctx.beginPath(); ctx.moveTo(x(t), 0); ctx.lineTo(x(t), h); ctx.stroke();
      }

      // Level change markers + labels
      if (this.showLabels) {
        ctx.font = '600 11px "Hanken Grotesk", sans-serif';
        const rowEnds = [-Infinity, -Infinity, -Infinity]; // stagger labels that would overlap
        for (const e of this.events) {
          if (e.kind !== 'level_change' || !LABELS[e.detail?.to] || e.ms < t0) continue;
          const lx = x(e.ms);
          const text = LABELS[e.detail.to];
          const tw = ctx.measureText(text).width;
          const tx = Math.min(lx + 5, w - tw - 4);
          let row = rowEnds.findIndex((end) => tx > end + 6);
          if (row < 0) row = rowEnds.length - 1;
          rowEnds[row] = tx + tw;
          ctx.strokeStyle = alertTone ? 'rgba(255,255,255,.45)' : (SILENT[e.detail.to] || '#AEB5DA') + '99';
          ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(lx, 14); ctx.lineTo(lx, h - 14); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = alertTone ? '#fff' : SILENT[e.detail.to] || '#AEB5DA';
          ctx.fillText(text, tx, 12 + row * 13);
        }
      }

      // The line itself, sampled every 2 px. Nothing is drawn before she armed.
      const armed = this.events.find((e) => e.kind === 'level_change' && !e.detail?.from);
      const startMs = this.data.level_at_start ? -Infinity : armed ? armed.ms : t0;
      const wobble = this.reduced ? 0 : 1;
      let prev = null;
      for (let px = 0; px <= w; px += 2) {
        const t = t0 + (px / w) * span;
        if (t < startMs) continue;
        const level = levelAt(t);
        const silent = !!SILENT[level];
        const ended = level === 'RESOLVED';
        let y = base;
        if (!silent && !ended) {
          // a live signal: gentle breathing wave while she's answering
          y += wobble * (Math.sin(t / 260) * 2.2 + Math.sin(t / 97) * 1.1);
        }
        for (const sx of spikeXs) {
          const d = px - sx;
          if (Math.abs(d) < 18) {
            // ECG-style spike: small dip, tall peak, deep trough, recovery
            y += h * (0.06 * Math.exp(-(((d + 9) / 3) ** 2)) - 0.42 * Math.exp(-((d / 2.4) ** 2)) + 0.16 * Math.exp(-(((d - 5) / 3) ** 2)));
          }
        }
        const color = alertTone ? (silent ? '#fff' : 'rgba(255,255,255,.7)') : silent ? SILENT[level] : ended ? '#5D6699' : '#FFB547';
        if (prev) {
          ctx.strokeStyle = color;
          ctx.lineWidth = silent ? 2.5 : 2;
          ctx.beginPath(); ctx.moveTo(prev.px, prev.y); ctx.lineTo(px, y); ctx.stroke();
        }
        prev = { px, y };
      }

      // Leading edge: a glowing dot where "now" is
      const nowLevel = levelAt(now);
      const edge = alertTone ? '#fff' : SILENT[nowLevel] || (nowLevel === 'RESOLVED' ? '#5D6699' : '#FFB547');
      const pulse = this.reduced ? 1 : 0.6 + 0.4 * Math.sin(now / 180);
      ctx.fillStyle = edge;
      ctx.shadowColor = edge; ctx.shadowBlur = 14 * pulse;
      ctx.beginPath(); ctx.arc(w - 3, prev ? prev.y : base, 4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      // Phone heartbeats lane
      ctx.fillStyle = alertTone ? 'rgba(255,255,255,.75)' : 'rgba(91,227,176,.8)';
      for (const e of this.events) {
        if (e.kind !== 'heartbeat' || e.ms < t0) continue;
        ctx.beginPath(); ctx.arc(x(e.ms), h - 7, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  window.SignalTrace = SignalTrace;
})();
