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
        ink: { DEFAULT: '#141414', 2: '#3D3D3D', 3: '#5E5E5E' },
        line: { DEFAULT: '#E5E3DC', soft: '#F0EEE8', strong: '#CCC9BF' },
        canvas: '#F6F5F1',
        noite: { DEFAULT: '#111111', 2: '#1F1F1F' },
        // amarelo Lucminas: sempre com texto preto por cima (amarelo + branco não tem contraste)
        brand: { DEFAULT: '#FFC400', dark: '#E6AE00', soft: '#FFF3C4', tint: '#FFFAE5', text: '#5C4200' },
        info: { DEFAULT: '#1A3FAF', soft: '#E8EEFC' },
        ok: { DEFAULT: '#0B5C4E', soft: '#E2F2EE' },
        warn: { DEFAULT: '#9A3A00', strong: '#7A2E00', soft: '#FFE8DA', line: '#E8B394' },
        bad: { DEFAULT: '#9B2318', strong: '#7E1C13', soft: '#FCE8E6' },
      },
    },
  },
  plugins: [],
};
