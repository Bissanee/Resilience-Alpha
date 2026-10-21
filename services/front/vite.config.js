import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement local uniquement : redirige /api et /auth vers les services (s'ils sont publiés en local).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', rewrite: (p) => p.replace(/^\/api/, '') },
      '/auth': { target: 'http://localhost:4001' },
    },
  },
});
