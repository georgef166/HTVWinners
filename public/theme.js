// Small shared UI helpers. The Tailwind theme lives in tailwind.config.cjs (compiled to /tw.css).

window.NOS = {
  STOPS: [
    { level: 'ARMED', name: 'Armed', desc: 'Your phone checks in on a timer you choose.' },
    { level: 'NUDGE', name: 'Nudge', desc: 'A check-in comes due. One tap says you’re fine.' },
    { level: 'ALARM', name: 'Alarm', desc: 'No tap, so your phone gets loud. Your PIN stops it.' },
    { level: 'CONTACT', name: 'Contact', desc: 'Still quiet. Your friend gets your last location and a short summary.' },
    { level: 'WIDER', name: 'Wider', desc: 'If they don’t confirm they’re on it, your backup gets the link too.' },
  ],

  // Tenshi wings and halo (asset exported from the Figma design). `w` overrides the width in px.
  logo(size = 'md', w) {
    const width = w || (size === 'sm' ? 44 : 64);
    return `<img src="/assets/logo-mark.svg" width="${width}" height="${(width * 68.9 / 140).toFixed(1)}" alt="" aria-hidden="true" style="display:block;overflow:visible">`;
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
