// Tailwind is compiled ahead of time into public/tw.css (npm run build:css), so pages don't run a JIT compiler.
// Colors are CSS-variable tokens (see public/styles.css): light landing page, dark Midnight theme for the demo.
module.exports = {
  content: ['./public/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink-rgb) / <alpha-value>)',       // background
        dusk: 'rgb(var(--dusk-rgb) / <alpha-value>)',     // secondary surface
        line: 'rgb(var(--line-rgb) / <alpha-value>)',     // hairlines
        sodium: 'rgb(var(--sodium-rgb) / <alpha-value>)', // accent
        signal: 'rgb(var(--signal-rgb) / <alpha-value>)', // alert red
        mint: 'rgb(var(--mint-rgb) / <alpha-value>)',     // OK green
        mist: 'rgb(var(--mist-rgb) / <alpha-value>)',     // secondary text
        paper: 'rgb(var(--paper-rgb) / <alpha-value>)',   // primary text
        amber: 'rgb(var(--amber-rgb) / <alpha-value>)',   // check-in due
        gold: 'rgb(var(--gold-rgb) / <alpha-value>)',     // brand sand
      },
      fontFamily: {
        display: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
};
