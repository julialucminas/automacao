/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: { DEFAULT: '#16202B', 2: '#3E4955', 3: '#5A6573' },
        line: { DEFAULT: '#E3E7EC', soft: '#EEF1F4', strong: '#CBD2DA' },
        canvas: '#F4F6F8',
        brand: { DEFAULT: '#1D4ED8', dark: '#1A3FAF', soft: '#E8EEFC', tint: '#F1F5FE' },
        ok: { DEFAULT: '#0B5C4E', soft: '#E2F2EE' },
        warn: { DEFAULT: '#8A4200', strong: '#6E3500', soft: '#FFEFD9', line: '#E0B98A' },
        bad: { DEFAULT: '#9B2318', strong: '#7E1C13', soft: '#FCE8E6' },
      },
    },
  },
  plugins: [],
};
