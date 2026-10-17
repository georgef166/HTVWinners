// Sound kit: every cue is synthesized, but voiced like real instruments instead of raw beeps.
// Bells are built from a fundamental plus a few partials with natural decay, run through a
// soft room reverb and a compressor. The alarm uses the dual tone of wireless emergency alerts.
(function () {
  const S = {};
  let ctx = null, master = null, wet = null, alarmTimer = null;

  function impulse(c, seconds, decay) {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function build(c) {
    ctx = c;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.25;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    const room = ctx.createConvolver(); room.buffer = impulse(ctx, 1.8, 3);
    wet = ctx.createGain(); wet.gain.value = 0.2;
    wet.connect(room); room.connect(master);
  }

  // Use a context someone else already unlocked (the demo stage), or make our own on a user gesture.
  S.attach = (c) => { if (c && ctx !== c) build(c); };
  S.unlock = () => {
    try { if (!ctx) build(new (window.AudioContext || window.webkitAudioContext)()); ctx.resume(); } catch {}
    return ctx;
  };

  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  // One bell-like note: a soft 6 ms attack, partials that fade faster the higher they are.
  function bell(freq, t, { gain = 0.3, decay = 1.6, bright = 1, reverb = true } = {}) {
    const out = ctx.createGain(); out.gain.value = gain;
    out.connect(master); if (reverb) out.connect(wet);
    for (const [ratio, amp] of [[1, 1], [2, 0.38 * bright], [3, 0.16 * bright], [4.16, 0.07 * bright]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * ratio;
      const g = ctx.createGain();
      const end = t + decay / Math.sqrt(ratio);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(g); g.connect(out); o.start(t); o.stop(end + 0.05);
    }
  }
  const play = (notes) => {
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    for (const [midi, dt, opts] of notes) bell(hz(midi), t0 + dt, opts);
  };

  // Arming: a rising C–G–C, like something powering on.
  S.arm = () => play([[72, 0, { gain: 0.24 }], [79, 0.085, { gain: 0.24 }], [84, 0.17, { gain: 0.26, decay: 2.2 }]]);
  // "Still good?": a gentle two-note question, falling.
  S.nudge = () => play([[81, 0, { gain: 0.28 }], [76, 0.15, { gain: 0.26, decay: 1.9 }]]);
  // Check-in received: one soft bell.
  S.ok = () => play([[84, 0, { gain: 0.18, decay: 0.9 }]]);
  // Alarm cancelled / she's OK: a warm major arpeggio that resolves.
  S.resolve = () => play([[72, 0, { gain: 0.2 }], [76, 0.07, { gain: 0.2 }], [79, 0.14, { gain: 0.2 }], [84, 0.22, { gain: 0.24, decay: 2.4 }]]);
  // Wrong PIN: a soft, low knock (no harsh buzz).
  S.error = () => {
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(95, t + 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.3);
  };
  // The trusted contact's alert: clear, bright and urgent, a falling phrase played twice.
  S.alert = () => play([
    [88, 0, { gain: 0.32, bright: 1.3 }], [84, 0.15, { gain: 0.32, bright: 1.3 }], [79, 0.3, { gain: 0.34, decay: 1.8, bright: 1.3 }],
    [88, 0.95, { gain: 0.32, bright: 1.3 }], [84, 1.1, { gain: 0.32, bright: 1.3 }], [79, 1.25, { gain: 0.34, decay: 2.2, bright: 1.3 }],
  ]);

  // Alarm: the 853 + 960 Hz dual tone used by wireless emergency alerts, with smooth edges
  // so it's loud and unmistakable without clicking or sounding like a toy.
  function burst(t, dur) {
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.42, t + 0.03);
    out.gain.setValueAtTime(0.42, t + dur - 0.06);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(master);
    for (const f of [853, 960]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      o.connect(out); o.start(t); o.stop(t + dur + 0.02);
    }
  }
  S.alarmStart = () => {
    if (!ctx || alarmTimer) return;
    const cycle = () => { const t = ctx.currentTime + 0.02; burst(t, 0.5); burst(t + 0.65, 0.5); };
    cycle();
    alarmTimer = setInterval(cycle, 1500);
  };
  S.alarmStop = () => { clearInterval(alarmTimer); alarmTimer = null; };
  S.alarmOn = () => !!alarmTimer;

  window.NOS_SOUND = S;
})();
