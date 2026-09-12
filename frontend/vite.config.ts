import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The API is proxied under the same origin in development so cookies are
    // first-party — exactly as they will be in production behind one domain.
    proxy: {
      '/api': {
        target: 'https://guddisilai-backend.onrender.com',
        // Dev-only: skip TLS certificate verification when proxying to the
        // remote backend (Node's trust store can reject Render's chain).
        secure: false,
        // Rewrite the Host header to the target — Render's edge rejects a
        // mismatched Host (localhost:5173) with a 403.
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keeps the initial parse small on cheap Android phones (README §55).
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
