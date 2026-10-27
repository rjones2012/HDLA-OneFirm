/** @type {import('tailwindcss').Config} */
// OneFirm visual system: black / white / gray base (HDLA document standards),
// #E00087 as the single accent, red and amber for status only.
// The old Hub's named colors are kept as aliases that resolve to the new palette, so
// ported pages restyle themselves without a rewrite: hdla-green → ink, blue → accent,
// purple/indigo/violet → ink or accent tints, pink → accent, green → ink.
const INK = '#141414';
const MUTED = '#5C5C58';
const RULE = '#E3E3E0';
const HAIR = '#EDEDEB';
const GROUND = '#F7F7F5';
const ACCENT = '#E00087';
const ACCENT_TINT = '#FDF2F8';
const RED = '#B42318';
const AMBER = '#8A6D00';
const DONE = '#8A8A86';

const inkScale = { 50: GROUND, 100: HAIR, 200: RULE, 300: '#CFCFCB', 400: '#A8A8A4', 500: DONE, 600: MUTED, 700: '#3A3A38', 800: '#262625', 900: INK, 950: '#0B0B0B' };
const accentScale = { 50: ACCENT_TINT, 100: ACCENT_TINT, 200: '#F9CCE3', 300: '#F29BC9', 400: '#EA5BA9', 500: ACCENT, 600: ACCENT, 700: '#B8006E', 800: '#8F0056', 900: '#66003D' };
const redScale = { 50: '#FDF3F2', 100: '#FBE4E2', 200: '#F5C4C0', 300: '#E89590', 400: '#D4605A', 500: RED, 600: RED, 700: '#8E1B12', 800: '#6B140E', 900: '#4A0E0A' };
const amberScale = { 50: '#FBF7EA', 100: '#F5ECC9', 200: '#EBDB97', 300: '#DCC55F', 400: '#C4A82E', 500: AMBER, 600: AMBER, 700: '#6E5700', 800: '#524100', 900: '#372B00' };

module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: INK,
        muted: MUTED,
        rule: RULE,
        hair: HAIR,
        ground: GROUND,
        accent: ACCENT,
        'accent-tint': ACCENT_TINT,
        done: DONE,
        status: { red: RED, amber: AMBER },
        // ── aliases for ported pages ──
        'hdla-green': INK,
        'hdla-green-light': MUTED,
        'hdla-text': INK,
        'hdla-muted': MUTED,
        gray: inkScale,
        slate: inkScale,
        neutral: inkScale,
        zinc: inkScale,
        stone: inkScale,
        green: { 50: GROUND, 100: HAIR, 200: RULE, 300: '#CFCFCB', 400: DONE, 500: INK, 600: INK, 700: INK, 800: INK, 900: INK },
        emerald: { 50: GROUND, 100: HAIR, 200: RULE, 300: '#CFCFCB', 400: DONE, 500: INK, 600: INK, 700: INK, 800: INK, 900: INK },
        blue: accentScale,
        sky: accentScale,
        indigo: accentScale,
        violet: accentScale,
        purple: accentScale,
        fuchsia: accentScale,
        pink: accentScale,
        rose: accentScale,
        red: redScale,
        orange: amberScale,
        amber: amberScale,
        yellow: amberScale,
      },
      fontFamily: {
        flecha: ['Flecha M', 'Georgia', 'serif'],
        lato: ['Lato', 'system-ui', 'sans-serif'],
        sans: ['Lato', 'system-ui', 'sans-serif'],
        serif: ['Flecha M', 'Georgia', 'serif'],
      },
      borderRadius: {
        hdla: '4px',
        '2xl': '6px',
        xl: '5px',
        lg: '4px',
        md: '3px',
      },
      boxShadow: {
        // the system has no shadows; neutralise anything ported
        sm: 'none', DEFAULT: 'none', md: 'none', lg: 'none', xl: 'none', '2xl': 'none',
      },
    },
  },
  plugins: [],
};
