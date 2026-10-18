// Small shared UI helpers. The Tailwind theme lives in tailwind.config.cjs (compiled to /tw.css).

window.NOS = {
  // One clock for every screen: the server sends its time with each response, deadlines are absolute,
  // and every countdown rounds the same way, so the stage and both phones always show the same second.
  clock: {
    offset: 0,
    sync(serverNow) { if (serverNow) this.offset = serverNow - Date.now(); },
    now() { return Date.now() + this.offset; },
    left(deadlineMs) { return deadlineMs == null ? null : Math.max(0, Math.ceil((deadlineMs - this.now()) / 1000)); },
  },

  STOPS: [
    { level: 'ARMED', name: 'Armed', desc: 'Your phone checks in on a timer you choose.' },
    { level: 'NUDGE', name: 'Nudge', desc: 'A check-in comes due. One tap says you’re fine.' },
    { level: 'ALARM', name: 'Alarm', desc: 'No tap, so your phone gets loud. Your PIN stops it.' },
    { level: 'CONTACT', name: 'Contact', desc: 'Still quiet. Your friend gets your last location and a short summary.' },
    { level: 'WIDER', name: 'Wider', desc: 'If they don’t confirm they’re on it, your backup gets the link too.' },
  ],

  // tenshi mark: the Figma wings, redrawn as smooth symmetric curves (gold) under an elliptical halo
  // (accent). Flat vector, so it stays crisp at any size and follows the theme. `w` overrides the width.
  logo(size = 'md', w) {
    const width = w || (size === 'sm' ? 60 : 78);
    return `<svg width="${width}" height="${(width * 51.5 / 122).toFixed(1)}" viewBox="9 8.5 122 51.5" aria-hidden="true" style="display:block;overflow:visible">
      <path style="fill:var(--gold)" fill-rule="evenodd" d="M10.00,10.00 C11.35,10.97 15.38,14.19 18.07,15.83 C20.77,17.48 23.50,18.75 26.15,19.87 C28.80,20.99 30.04,21.51 34.00,22.56 C37.96,23.61 45.74,24.84 49.93,26.15 C54.11,27.46 56.95,29.07 59.12,30.41 C61.29,31.76 61.74,32.58 62.93,34.23 C64.13,35.87 65.36,37.81 66.30,40.28 C67.23,42.75 68.09,45.93 68.54,49.03 C68.99,52.13 68.92,57.26 68.99,58.90 C68.65,58.30 67.76,56.21 66.97,55.31 C66.19,54.41 65.21,53.78 64.28,53.52 C63.35,53.25 62.90,53.11 61.36,53.74 C59.83,54.38 56.69,56.69 55.08,57.33 C53.48,57.97 52.28,57.52 51.72,57.55 C51.68,57.48 51.53,57.18 51.50,57.11 C51.98,56.81 53.51,56.10 54.41,55.31 C55.31,54.53 56.47,52.88 56.88,52.40 C55.57,53.03 50.82,55.54 49.03,56.21 C47.23,56.88 47.35,56.58 46.11,56.43 C44.88,56.28 42.37,55.50 41.63,55.31 C41.63,55.24 41.63,54.94 41.63,54.86 C42.86,54.45 47.20,53.25 49.03,52.40 C50.86,51.54 52.02,50.15 52.62,49.70 C51.05,50.23 46.07,52.51 43.20,52.84 C40.32,53.18 37.25,52.32 35.35,51.72 C33.44,51.12 32.36,49.67 31.76,49.25 C33.14,49.18 37.36,49.33 40.06,48.81 C42.75,48.28 46.60,46.56 47.91,46.11 C46.79,46.34 43.35,47.24 41.18,47.46 C39.01,47.68 37.18,47.87 34.90,47.46 C32.62,47.05 29.48,46.11 27.50,44.99 C25.51,43.87 23.76,41.44 23.01,40.73 C24.24,40.96 27.76,41.85 30.41,42.08 C33.07,42.30 36.69,42.23 38.93,42.08 C41.18,41.93 43.05,41.33 43.87,41.18 C41.78,41.07 34.37,40.88 31.31,40.51 C28.24,40.13 27.35,39.68 25.48,38.94 C23.61,38.19 21.59,37.29 20.09,36.02 C18.60,34.75 17.10,32.09 16.50,31.31 C18.22,31.87 22.93,33.96 26.82,34.67 C30.71,35.38 37.66,35.42 39.83,35.57 C37.89,35.24 31.12,34.26 28.17,33.55 C25.21,32.84 24.02,32.24 22.11,31.31 C20.21,30.37 18.19,29.18 16.73,27.95 C15.27,26.71 14.11,25.18 13.36,23.91 C12.62,22.64 12.43,20.92 12.24,20.32 C12.88,20.77 14.04,21.93 16.06,23.01 C18.07,24.09 21.81,25.85 24.36,26.82 C26.90,27.80 29.25,28.43 31.31,28.84 C33.36,29.25 35.79,29.22 36.69,29.29 C34.90,28.77 29.07,27.42 25.93,26.15 C22.79,24.88 20.06,23.27 17.85,21.66 C15.64,20.06 14.00,18.45 12.69,16.50 C11.38,14.56 10.45,11.08 10.00,10.00 Z M130.00,10.00 C129.55,11.08 128.62,14.56 127.31,16.50 C126.00,18.45 124.36,20.06 122.15,21.66 C119.94,23.27 117.21,24.88 114.07,26.15 C110.93,27.42 105.10,28.77 103.31,29.29 C104.21,29.22 106.64,29.25 108.69,28.84 C110.75,28.43 113.10,27.80 115.64,26.82 C118.19,25.85 121.93,24.09 123.94,23.01 C125.96,21.93 127.12,20.77 127.76,20.32 C127.57,20.92 127.38,22.64 126.64,23.91 C125.89,25.18 124.73,26.71 123.27,27.95 C121.81,29.18 119.79,30.37 117.89,31.31 C115.98,32.24 114.79,32.84 111.83,33.55 C108.88,34.26 102.11,35.24 100.17,35.57 C102.34,35.42 109.29,35.38 113.18,34.67 C117.07,33.96 121.78,31.87 123.50,31.31 C122.90,32.09 121.40,34.75 119.91,36.02 C118.41,37.29 116.39,38.19 114.52,38.94 C112.65,39.68 111.76,40.13 108.69,40.51 C105.63,40.88 98.22,41.07 96.13,41.18 C96.95,41.33 98.82,41.93 101.07,42.08 C103.31,42.23 106.93,42.30 109.59,42.08 C112.24,41.85 115.76,40.96 116.99,40.73 C116.24,41.44 114.49,43.87 112.50,44.99 C110.52,46.11 107.38,47.05 105.10,47.46 C102.82,47.87 100.99,47.68 98.82,47.46 C96.65,47.24 93.21,46.34 92.09,46.11 C93.40,46.56 97.25,48.28 99.94,48.81 C102.64,49.33 106.86,49.18 108.24,49.25 C107.64,49.67 106.56,51.12 104.65,51.72 C102.75,52.32 99.68,53.18 96.80,52.84 C93.93,52.51 88.95,50.23 87.38,49.70 C87.98,50.15 89.14,51.54 90.97,52.40 C92.80,53.25 97.14,54.45 98.37,54.86 C98.37,54.94 98.37,55.24 98.37,55.31 C97.63,55.50 95.12,56.28 93.89,56.43 C92.65,56.58 92.77,56.88 90.97,56.21 C89.18,55.54 84.43,53.03 83.12,52.40 C83.53,52.88 84.69,54.53 85.59,55.31 C86.49,56.10 88.02,56.81 88.50,57.11 C88.47,57.18 88.32,57.48 88.28,57.55 C87.72,57.52 86.52,57.97 84.92,57.33 C83.31,56.69 80.17,54.38 78.64,53.74 C77.10,53.11 76.65,53.25 75.72,53.52 C74.79,53.78 73.81,54.41 73.03,55.31 C72.24,56.21 71.35,58.30 71.01,58.90 C71.08,57.26 71.01,52.13 71.46,49.03 C71.91,45.93 72.77,42.75 73.70,40.28 C74.64,37.81 75.87,35.87 77.07,34.23 C78.26,32.58 78.71,31.76 80.88,30.41 C83.05,29.07 85.89,27.46 90.07,26.15 C94.26,24.84 102.04,23.61 106.00,22.56 C109.96,21.51 111.20,20.99 113.85,19.87 C116.50,18.75 119.23,17.48 121.93,15.83 C124.62,14.19 128.65,10.97 130.00,10.00 Z"/>
      <ellipse cx="70" cy="16.17" rx="14.45" ry="4.6" fill="none" style="stroke:var(--sodium)" stroke-width="2.7"/>
    </svg>`;
  },

  // The escalation ladder drawn as a night-bus route. variant: 'full' (with descriptions) or 'mini'.
  // Descriptions as the trusted contact reads them.
  STOPS_FOR: {
    ARMED: (n) => `${n}'s phone checks in on a timer.`,
    NUDGE: (n) => `A check-in comes due. One tap from ${n} says all's fine.`,
    ALARM: (n) => `No tap, so ${n}'s phone gets loud. Only ${n}'s PIN stops it.`,
    CONTACT: (n) => `Still quiet. This page turns red and shows ${n}'s last location.`,
    WIDER: () => 'If you don’t confirm you’re on it, the backup contact gets the link too.',
  },

  route(el, { level = null, variant = 'mini', who = null } = {}) {
    const idx = this.STOPS.findIndex((s) => s.level === level);
    el.classList.remove('route-mini', 'route-full');
    el.classList.add('route', `route-${variant}`);
    el.innerHTML = `<ol>${this.STOPS.map((s, i) => `
      <li class="stop ${i < idx ? 'is-past' : ''} ${i === idx ? 'is-here' : ''}" ${i === idx ? 'aria-current="step"' : ''}>
        <span class="stop-dot" aria-hidden="true"></span>
        <span class="stop-name">${s.name}</span>
        ${variant === 'full' ? `<span class="stop-desc">${who ? this.STOPS_FOR[s.level](who) : s.desc}</span>` : ''}
      </li>`).join('')}</ol>`;
  },
};
