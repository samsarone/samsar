/** @type {import('tailwindcss').Config} */
module.exports = {
   darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'void-ink': '#0c0d12',
        'void-ink-2': '#20232e',
        'gamer-scarlet': '#ff4655',
        'pulse-violet': '#f6c453',
        'neon-rose': '#ff5f8a',
        'neon-cyan': '#f6c453',
        'ember-amber': '#f4c86b',
      }
    },
  },
  plugins: [],
}
