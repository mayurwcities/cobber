// Stream the CSV catalog from the PHP backend's /catalog.php down to the
// browser as a same-origin download. No CORS, no cross-origin pop-ups.

const BACKEND = (process.env.LIVN_BACKEND_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const KEY = process.env.LIVN_BACKEND_KEY || '';

export async function GET(request) {
  const incoming = new URL(request.url);
  const target = `${BACKEND}/catalog.php${incoming.search}`;

  const headers = {};
  if (KEY) headers['X-Api-Key'] = KEY;

  let upstream;
  try {
    upstream = await fetch(target, { headers });
  } catch (err) {
    return new Response('Catalog export upstream unreachable: ' + (err?.message || err), {
      status: 502,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Copy through the original headers we care about (esp. the filename).
  const out = new Headers();
  out.set('Content-Type', upstream.headers.get('content-type') || 'text/csv; charset=utf-8');
  const disp = upstream.headers.get('content-disposition');
  if (disp) out.set('Content-Disposition', disp);
  const len = upstream.headers.get('content-length');
  if (len) out.set('Content-Length', len);
  const rows = upstream.headers.get('x-livn-rows');
  if (rows) out.set('X-Livn-Rows', rows);
  out.set('Cache-Control', 'no-store');

  return new Response(upstream.body, { status: upstream.status, headers: out });
}
