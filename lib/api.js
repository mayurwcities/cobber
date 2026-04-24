// Thin fetch wrapper that talks to our Next.js proxy at /api/livn/*.
// The proxy forwards to the PHP wrapper and returns the same JSON envelope:
//   { success: true,  data: ..., meta: ... }
//   { success: false, error: { code, message, details }, meta: ... }

const BASE = '/api/livn';

function buildUrl(path, params) {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v)) qs.append(k, v.join(','));
      else qs.append(k, String(v));
    }
  }
  const query = qs.toString();
  return `${BASE}${path.startsWith('/') ? path : '/' + path}${query ? '?' + query : ''}`;
}

async function parseEnvelope(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    // Let the caller read raw (PDFs, CSV etc).
    return { raw: res };
  }
  const json = await res.json().catch(() => null);
  if (!json) {
    return {
      ok: false,
      error: { code: 'bad_json', message: `Non-JSON response (HTTP ${res.status})` },
    };
  }
  if (json.success) {
    return { ok: true, data: json.data, meta: json.meta || {} };
  }
  return {
    ok: false,
    error: json.error || { code: 'unknown', message: 'Unknown error' },
    meta: json.meta || {},
    status: res.status,
  };
}

export async function apiGet(path, params) {
  const res = await fetch(buildUrl(path, params), { cache: 'no-store' });
  return parseEnvelope(res);
}

export async function apiPost(path, body, params) {
  const res = await fetch(buildUrl(path, params), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return parseEnvelope(res);
}

export async function apiPut(path, body, params) {
  const res = await fetch(buildUrl(path, params), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return parseEnvelope(res);
}

export async function apiDelete(path, body, params) {
  const res = await fetch(buildUrl(path, params), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return parseEnvelope(res);
}

// Direct URL for raw resources (PDFs etc) — used by <a href=...> or <iframe>.
export function rawUrl(path, params) {
  return buildUrl(path, params);
}

// ---------------- Livn-shape helpers ----------------

/** Format { amount, currency } as "AUD 279" / "AUD 27.90". */
export function formatPrice(p) {
  if (!p || typeof p !== 'object') return '';
  const amount = typeof p.amount === 'number' ? p.amount : null;
  if (amount === null) return '';
  const currency = p.currency || '';
  const hasCents = amount % 1 !== 0;
  const str = amount.toLocaleString(undefined, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${str}` : str;
}

/**
 * Livn quotes carry grossTotal + netTotal. Always prefer grossTotal as the
 * "what the customer sees" number; fall back sensibly. Returns a price object
 * suitable for formatPrice(), or null.
 */
export function pickTotal(quote) {
  if (!quote || typeof quote !== 'object') return null;
  return quote.grossTotal || quote.total || quote.netTotal || null;
}

/** Format an ISO timestamp / date as "5 May 2026". */
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function truncate(str, n = 160) {
  if (!str) return '';
  const s = String(str);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Livn.duration is in minutes. Turn it into a human string:
 *   60   → "1 hour"
 *   90   → "1h 30m"
 *   480  → "8 hours"
 *   2880 → "2 days"
 */
export function formatDuration(minutes) {
  if (minutes == null || minutes === '') return '';
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return '';
  if (m % 1440 === 0) {
    const d = m / 1440;
    return d === 1 ? '1 day' : `${d} days`;
  }
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mins = m % 60;
    if (mins === 0) return h === 1 ? '1 hour' : `${h} hours`;
    return `${h}h ${mins}m`;
  }
  return `${m} min`;
}

/**
 * Format Livn "age min/max" as a range: "5+", "18–39", "all ages".
 */
export function formatAgeRange(min, max) {
  const hasMin = min != null && min !== '' && Number(min) > 0;
  const hasMax = max != null && max !== '' && Number(max) > 0;
  if (!hasMin && !hasMax) return 'All ages';
  if (hasMin && !hasMax) return `${min}+`;
  if (!hasMin && hasMax) return `up to ${max}`;
  return `${min}–${max}`;
}

/**
 * Livn location is: { city, state, country, address1, latitude, longitude, tz, ... }
 * Return something like "Katoomba, NSW, AU".
 */
export function formatLocation(loc) {
  if (!loc || typeof loc !== 'object') return '';
  return [loc.city, loc.state, loc.country].filter(Boolean).join(', ');
}

/**
 * Livn bookings/tickets search returns { bookings|tickets, paging }.
 * Older mocks / edge cases return a flat array. This helper picks the
 * right shape so callers can do `pickList(res.data, 'bookings')`.
 */
export function pickList(data, key) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.products)) return data.products;
  return [];
}
