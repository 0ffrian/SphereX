// DEV/TEST FIXTURES ONLY. Vite dev-server plugin that answers `/v1/*` from the synthetic fixtures,
// and `/data/textures/*` and `/data/shapes/*` from the committed fixture textures and shape models.
// `apply: 'serve'`: it never runs in `vite build` or `vite preview`. vite.config.ts adds it only
// in `--mode fixtures` (npm run dev:fixtures), and then sets no proxy.
import type { Plugin } from 'vite';
import { handleFixtureRequest } from './handler';

export function sxFixtures(): Plugin {
  return {
    name: 'sx-fixtures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reply = req.url
          ? handleFixtureRequest(req.method ?? 'GET', req.url, { cookie: req.headers.cookie })
          : null;
        if (!reply) {
          next();
          return;
        }
        const send = () => {
          res.statusCode = reply.status;
          for (const [k, v] of Object.entries(reply.headers)) res.setHeader(k, v);
          res.end(req.method === 'HEAD' ? undefined : reply.body);
        };
        // A progressive part waits, so the load can be watched (handler.ts PROGRESSIVE_DELAY_MS).
        if (reply.delayMs) setTimeout(send, reply.delayMs);
        else send();
      });
      server.config.logger.info(
        '  [sx-fixtures] /v1 and /data are served from SYNTHETIC fixtures',
        {
          timestamp: true,
        },
      );
    },
  };
}
