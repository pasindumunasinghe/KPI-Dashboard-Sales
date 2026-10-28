import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs on :4000; in Docker, nginx does this proxying.
    proxy: { '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:4000', changeOrigin: true } }
  },
  test: { environment: 'node' }
});
