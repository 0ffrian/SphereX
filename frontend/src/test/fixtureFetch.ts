// Test helper (src/test/ is test-only code): a `fetch` that answers from the synthetic fixture handler. Test code only.
import { handleFixtureRequest } from '../../fixtures/handler';

export const fixtureFetch: typeof fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const reply = handleFixtureRequest('GET', url);
  if (!reply) return new Response('not found', { status: 404 });
  return new Response(reply.body as BodyInit, { status: reply.status, headers: reply.headers });
};
