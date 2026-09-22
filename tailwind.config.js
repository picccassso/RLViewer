/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        rl: {
          blue: '#0088ff',
          'blue-dark': '#0055b3',
          'blue-glow': '#33a3ff',
          orange: '#ff6600',
          'orange-dark': '#b34700',
          'orange-glow': '#ff8533',
          gold: '#f59e0b',
          boost: '#f59e0b',
          dark: '#0d1117',
          panel: 'rgba(15, 23, 42, 0.85)',
          border: 'rgba(255, 255, 255, 0.1)',
        }
      },
      fontFamily: {
        display: ['Rajdhani', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      }
    },
  },
  plugins: [],
}
