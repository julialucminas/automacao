import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // caminhos relativos: o build funciona em qualquer pasta/subdomínio
  base: './',
  // nomes de componentes e funções preservados no build: quando algo quebra, a mensagem diz onde
  esbuild: { keepNames: true },
  server: {
    // quando a API existir, as chamadas /api vão para ela
    proxy: { '/api': 'http://localhost:3333' },
  },
});
