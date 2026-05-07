// GET /api/voucher/{token}
// Verifies the HMAC-signed token (see lib/voucher-token.js), decodes the
// booking/ticket id server-side, and proxies to the matching Livn PDF
// endpoint. The id never appears in the user-visible URL — earlier reviews
// flagged that the previous /api/livn/bookings/{id}/pdf URL let anyone
// change the id and load another customer's voucher.

import { verifyVoucherToken } from '@/lib/voucher-token';

const BACKEND = (process.env.LIVN_BACKEND_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const KEY = process.env.LIVN_BACKEND_KEY || '';

export async function GET(_request, ctx) {
  // Next 14 passes params directly; Next 15+ wraps them in a promise.
  const raw = ctx?.params;
  const params = raw && typeof raw.then === 'function' ? await raw : raw;
  const token = params?.token;

  const claim = verifyVoucherToken(token);
  if (!claim) {
    return new Response('This voucher link is invalid or has expired. Please return to your booking and open the voucher again.', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const segment = claim.type === 'b' ? 'bookings' : 'tickets';
  const target = `${BACKEND}/api/v1/${segment}/${encodeURIComponent(claim.id)}/pdf`;

  const headers = { Accept: 'application/pdf' };
  if (KEY) headers['X-Api-Key'] = KEY;

  let upstream;
  try { upstream = await fetch(target, { method: 'GET', headers }); }
  catch (_err) {
    return new Response('The voucher service is temporarily unreachable. Please try again in a moment.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const body = await upstream.arrayBuffer();
  const out = new Headers();
  for (const k of ['content-type', 'content-disposition', 'cache-control']) {
    const v = upstream.headers.get(k);
    if (v) out.set(k, v);
  }
  return new Response(body, { status: upstream.status, headers: out });
}
