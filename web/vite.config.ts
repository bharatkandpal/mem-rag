import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies the API routes to the running Nest app so the browser
// talks same-origin in dev — no CORS (design guide §9). `/query` is a prefix
// match, so it also covers `/query/general` (the opt-in ungrounded route).
//
// `publicDir` is disabled on purpose: the repo already has `web/public/`, the
// hand-built prototype Nest serves today (main.ts useStaticAssets). Leaving
// Vite's default would make it claim that folder. GO-21e-g rewires Nest to
// serve this app's build output instead.
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  publicDir: false,
  server: {
    port: 5173,
    proxy: {
      '/query': API_TARGET,
      '/healthz': API_TARGET,
      '/metrics': API_TARGET,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
