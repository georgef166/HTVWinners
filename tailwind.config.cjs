// Tailwind is compiled ahead of time into public/tw.css (npm run build:css), so pages don't run a JIT compiler.
// Colors are CSS-variable tokens (see public/styles.css): light theme by default, .theme-dark for the stage.
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
      },
      fontFamily: {
        display: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
};
