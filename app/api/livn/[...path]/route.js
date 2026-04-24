// Server-side proxy to the PHP wrapper. The browser only ever talks to
// /api/livn/* on the same origin, which keeps CORS simple and keeps our
// server-only X-Api-Key out of the client bundle.

const BACKEND = (process.env.LIVN_BACKEND_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const KEY = process.env.LIVN_BACKEND_KEY || '';

async function proxy(request, ctx) {
  // Next 14 passes params directly; Next 15 wraps them in a promise.
  const raw = ctx?.params;
  const params = raw && typeof raw.then === 'function' ? await raw : raw;
  const segs = params?.path || [];
  const suffix = Array.isArray(segs) ? segs.join('/') : String(segs);
  const incoming = new URL(request.url);
  const target = `${BACKEND}/api/v1/${suffix}${incoming.search}`;

  const headers = {
    Accept: request.headers.get('accept') || 'application/json',
  };
  const ct = request.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;
  if (KEY) headers['X-Api-Key'] = KEY;

  const init = { method: request.method, headers };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    init.body = await request.text();
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(target, init);
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: { code: 'proxy_unreachable', message: String(err?.message || err) },
      meta: { timestamp: new Date().toISOString() },
    }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await upstreamResponse.arrayBuffer();
  const outHeaders = new Headers();
  const copyKeys = ['content-type', 'content-disposition', 'cache-control'];
  for (const k of copyKeys) {
    const v = upstreamResponse.headers.get(k);
    if (v) outHeaders.set(k, v);
  }

  return new Response(body, {
    status: upstreamResponse.status,
    headers: outHeaders,
  });
}

export async function GET(req, ctx)    { return proxy(req, ctx); }
export async function POST(req, ctx)   { return proxy(req, ctx); }
export async function PUT(req, ctx)    { return proxy(req, ctx); }
export async function DELETE(req, ctx) { return proxy(req, ctx); }
export async function PATCH(req, ctx)  { return proxy(req, ctx); }
