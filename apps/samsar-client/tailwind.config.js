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
        'void-ink': '#0b1226',
        'void-ink-2': '#0f1c35',
        'neon-rose': '#ff5f8a',
        'neon-cyan': '#2dd4ff',
        'ember-amber': '#ffb869',
      }
    },
  },
  plugins: [],
}

