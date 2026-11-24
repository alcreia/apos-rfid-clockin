import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The API port lives in .env (PORT=…). Read it here too, so `npm run dev` proxies to
// whatever the server is actually listening on instead of a stale hard-coded number.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = Number(env.PORT) || 3000;

  return {
    plugins: [react()],
    build: { outDir: 'dist', emptyOutDir: true },
    server: {
      port: 5173,
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
  };
});
