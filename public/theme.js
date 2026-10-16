// Shared Tailwind theme (loaded right after the Tailwind CDN script) + small UI helpers.
tailwind.config = {
  theme: {
    extend: {
      colors: {
        ink: '#0E1430',     // night sky
        dusk: '#18204A',    // raised surface
        line: '#2C3670',    // hairlines, tracks
        sodium: '#FFB547',  // streetlight amber: armed, primary action
        signal: '#E5303A',  // alarm red
        mint: '#5BE3B0',    // OK
        mist: '#AEB5DA',    // secondary text
        paper: '#F4F5FB',   // primary text
      },
      fontFamily: {
        display: ['Unbounded', 'system-ui', 'sans-serif'],
        sans: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
      },
    },
  },
};

window.NOS = {
  STOPS: [
    { level: 'ARMED', name: 'Armed', desc: 'Your phone checks in on a timer you choose.' },
    { level: 'NUDGE', name: 'Nudge', desc: 'A check-in comes due. One tap says you’re fine.' },
    { level: 'ALARM', name: 'Alarm', desc: 'No tap, so your phone gets loud. Your PIN stops it.' },
    { level: 'CONTACT', name: 'Contact', desc: 'Still quiet. Your friend gets your last location and a short summary.' },
    { level: 'WIDER', name: 'Wider', desc: 'If they don’t confirm they’re on it, your backup gets the link too.' },
  ],

  logo(size = 'md') {
    const w = size === 'sm' ? 30 : 38;
    return `<svg width="${w}" height="${w * 0.58}" viewBox="0 0 38 22" aria-hidden="true">
      <rect x="1.5" y="1.5" width="35" height="19" rx="9.5" fill="none" stroke="currentColor" stroke-width="2.5"/>
      <circle class="logo-knob" cx="27" cy="11" r="5.5" fill="currentColor"/>
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
