// HMAC-signed voucher tokens. Each token carries { type, id, exp }, where:
//   type — 'b' (booking) or 't' (ticket)
//   id   — the Livn booking/ticket id this token unlocks
//   exp  — epoch seconds; tokens older than this are rejected
//
// The signing secret (VOUCHER_TOKEN_SECRET) lives only on the server, so the
// browser can't mint or alter tokens. This replaces the earlier voucher URL
// pattern /api/livn/bookings/{id}/pdf — which let anyone change the id in
// the URL and pull another customer's voucher — with /api/voucher/{token},
// where the proxy verifies the signature server-side before forwarding to
// Livn. Tokens default to a 7-day lifetime so a leaked link expires quickly.

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function getSecret() {
  const s = process.env.VOUCHER_TOKEN_SECRET;
  if (!s) throw new Error('VOUCHER_TOKEN_SECRET is not configured');
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromB64url(str) {
  const padded = str + '==='.slice((str.length + 3) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payloadStr, secret) {
  return createHmac('sha256', secret).update(payloadStr).digest();
}

export function signVoucherToken({ type, id, ttlSeconds }) {
  if (type !== 'b' && type !== 't') {
    throw new Error('voucher token: type must be "b" or "t"');
  }
  if (id == null || id === '') {
    throw new Error('voucher token: id is required');
  }
  const exp = Math.floor(Date.now() / 1000) + (ttlSeconds || DEFAULT_TTL_SECONDS);
  const payloadStr = JSON.stringify({ t: type, id: String(id), exp });
  const sigBuf = sign(payloadStr, getSecret());
  return b64url(payloadStr) + '.' + b64url(sigBuf);
}

export function verifyVoucherToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let payloadBuf, sigBuf;
  try { payloadBuf = fromB64url(payloadB64); } catch { return null; }
  try { sigBuf = fromB64url(sigB64); } catch { return null; }

  let expected;
  try { expected = sign(payloadBuf.toString('utf8'), getSecret()); }
  catch { return null; }
  if (sigBuf.length !== expected.length) return null;
  if (!timingSafeEqual(sigBuf, expected)) return null;

  let parsed;
  try { parsed = JSON.parse(payloadBuf.toString('utf8')); } catch { return null; }
  if (!parsed || (parsed.t !== 'b' && parsed.t !== 't')) return null;
  if (!parsed.id) return null;
  if (typeof parsed.exp !== 'number') return null;
  if (Math.floor(Date.now() / 1000) > parsed.exp) return null;

  return { type: parsed.t, id: String(parsed.id), exp: parsed.exp };
}
