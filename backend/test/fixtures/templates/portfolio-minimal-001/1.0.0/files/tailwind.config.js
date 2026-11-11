/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        'on-brand': 'rgb(var(--on-brand) / <alpha-value>)',
        brand: {
          500: 'rgb(var(--brand) / <alpha-value>)',
          600: 'rgb(var(--brand) / <alpha-value>)',
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)'
        }
      },
      borderRadius: {
        card: 'var(--radius-card)',
        button: 'var(--radius-button)'
      },
      fontFamily: {
        sans: ['ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif'],
        heading: ['ui-serif, Georgia, Cambria, Times New Roman, serif']
      }
    }
  },
  plugins: []
};
