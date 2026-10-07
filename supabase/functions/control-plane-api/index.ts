const SERVICE = 'ai-control-plane-api';
const VERSION = '0.1.0';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

Deno.serve((request: Request) => {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '');

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed', allowedMethods: ['GET', 'HEAD'] }, 405);
  }

  if (pathname.endsWith('/control-plane-api') || pathname.endsWith('/health') || pathname.endsWith('/ready')) {
    const payload = {
      status: 'ok',
      service: SERVICE,
      version: VERSION,
      runtime: 'supabase-edge-function',
      timestamp: new Date().toISOString(),
    };
    return request.method === 'HEAD' ? new Response(null, { status: 200 }) : json(payload);
  }

  return json({ error: 'not_found', path: url.pathname }, 404);
});
