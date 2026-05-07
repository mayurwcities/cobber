// POST /api/voucher-token
// Body: { type: 'booking' | 'ticket', id: string | number }
// Response: { success: true, data: { token } }
//
// Mints a short-lived signed token the browser can use to open
// /api/voucher/{token} without leaking the booking/ticket id in the URL.
// See lib/voucher-token.js for the signing scheme.

import { signVoucherToken } from '@/lib/voucher-token';

function fail(code, message, status = 400) {
  return Response.json({ success: false, error: { code, message } }, { status });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return fail('bad_json', 'Invalid JSON body'); }

  const rawType = body?.type;
  const type = rawType === 'ticket' ? 't' : rawType === 'booking' ? 'b' : null;
  if (!type) return fail('invalid_type', 'type must be "booking" or "ticket"');

  const id = body?.id;
  if (id == null || id === '') return fail('invalid_id', 'id is required');

  let token;
  try { token = signVoucherToken({ type, id }); }
  catch (err) {
    // VOUCHER_TOKEN_SECRET missing in env — surface a generic 500 so we
    // don't reveal which env var is missing to the browser.
    // eslint-disable-next-line no-console
    console.error('[voucher-token] sign failed:', err?.message || err);
    return fail('token_error', 'Could not generate voucher token', 500);
  }

  return Response.json({ success: true, data: { token } });
}
