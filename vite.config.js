import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Keep CRA's output dir so the Vercel project config needs no changes.
    outDir: 'build',
  },
  server: {
    // Local dev: proxy API calls to the express server (replaces CRA's "proxy" field)
    proxy: { '/api': 'http://localhost:3456' },
  },
});
