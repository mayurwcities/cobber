/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef2fb',
          100: '#d6deef',
          200: '#aebde0',
          300: '#7f95cc',
          400: '#536fb5',
          500: '#34529a',
          600: '#243f7f',
          700: '#192f66',
          800: '#132557',
          900: '#0d1b42',
          950: '#070f29',
        },
        accent: {
          50:  '#ecfeff',
          100: '#cffafe',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
        },
        ink: {
          900: '#0b1430',
          700: '#1f2a4a',
          500: '#54618a',
          400: '#7b87ab',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        'brand-glow': '0 10px 30px -10px rgba(25, 47, 102, 0.45)',
        'card': '0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px -12px rgba(15, 23, 42, 0.08)',
        'card-hover': '0 2px 4px rgba(15, 23, 42, 0.06), 0 16px 40px -16px rgba(25, 47, 102, 0.25)',
      },
      backgroundImage: {
        'brand-radial':
          'radial-gradient(1200px 500px at 0% 0%, rgba(56,189,248,0.18), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(125,211,252,0.14), transparent 55%), linear-gradient(135deg, #192f66 0%, #0d1b42 100%)',
        'brand-soft':
          'linear-gradient(180deg, rgba(238,242,251,0.7) 0%, rgba(255,255,255,0) 100%)',
      },
      borderRadius: {
        xl: '0.9rem',
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
};
