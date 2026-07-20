/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', panel: 'var(--panel)', rail: 'var(--rail)', card: 'var(--card)',
        line: 'var(--line)', line2: 'var(--line-2)',
        txt: 'var(--txt)', txt2: 'var(--txt-2)', txt3: 'var(--txt-3)',
        clay: 'var(--clay)', claysoft: 'var(--clay-soft)',
        ok: 'var(--ok)', oksoft: 'var(--ok-soft)',
        warn: 'var(--warn)', warnsoft: 'var(--warn-soft)',
        danger: 'var(--danger)', dangersoft: 'var(--danger-soft)',
      },
      fontFamily: { serif: 'var(--serif)', sans: 'var(--sans)', mono: 'var(--mono)' },
      borderRadius: { DEFAULT: '9px' },
    },
  },
  plugins: [],
};
