import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:phone` runs `vite --host --mode phone`. WebGPU (and navigator.vibrate on some
// builds) needs a secure context, so phone testing over the LAN uses a self-signed HTTPS cert.
// VITE_HTTPS=1 enables the same thing in any mode.
export default defineConfig(({ mode }) => {
  const https = mode === 'phone' || process.env.VITE_HTTPS === '1';
  const plugins: PluginOption[] = [react(), tailwindcss()];
  if (https) plugins.push(basicSsl());

  return {
    plugins,
    // Listen on every interface so phones and laptops on the same Wi-Fi can open the dev and
    // preview servers (http://<this-PC's-LAN-IP>:5173). Plain HTTP over the LAN runs three.js on
    // its WebGL2 fallback; use `npm run dev:phone` (HTTPS) for WebGPU.
    server: { host: true, port: 5173 },
    preview: { host: true, port: 4173 },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  };
});
