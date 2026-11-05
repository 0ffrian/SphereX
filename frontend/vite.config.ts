import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type PluginOption, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { sxFixtures } from './fixtures/vitePlugin';

// `npm run dev:phone` runs `vite --host --mode phone`. WebGPU (and navigator.vibrate on some
// builds) needs a secure context, so phone testing over the LAN uses a self-signed HTTPS cert.
// VITE_HTTPS=1 enables the same thing in any mode.
//
// API (D-16): `/v1` is proxied to the backend, `http://localhost:8000` by default; set
// SX_API_TARGET to point elsewhere. `npm run dev:fixtures` (`--mode fixtures`) instead answers
// `/v1` from the SYNTHETIC fixtures in ./fixtures (dev server only; never in a build).
export default defineConfig(({ mode }) => {
  const https = mode === 'phone' || process.env.VITE_HTTPS === '1';
  const fixtures = mode === 'fixtures';
  const plugins: PluginOption[] = [react(), tailwindcss()];
  if (https) plugins.push(basicSsl());
  if (fixtures) plugins.push(sxFixtures());

  const proxy: Record<string, ProxyOptions> = {
    '/v1': { target: process.env.SX_API_TARGET ?? 'http://localhost:8000', changeOrigin: true },
  };

  return {
    plugins,
    // Listen on every interface so phones and laptops on the same Wi-Fi can open the dev and
    // preview servers (http://<this-PC's-LAN-IP>:5173). Plain HTTP over the LAN runs three.js on
    // its WebGL2 fallback; use `npm run dev:phone` (HTTPS) for WebGPU.
    server: { host: true, port: 5173, ...(fixtures ? {} : { proxy }) },
    preview: { host: true, port: 4173, proxy },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  };
});
