'use client';
import { useState } from 'react';

// Open a voucher PDF without leaking the booking/ticket id in the URL.
// Mints a short-lived signed token via /api/voucher-token, then redirects a
// pre-opened tab to /api/voucher/{token}. window.open has to be called
// synchronously inside the click handler — popup blockers reject async
// window.open calls — so we open about:blank first, then set its location
// after the fetch resolves.

export default function VoucherButton({
  type,           // 'booking' | 'ticket'
  id,             // Livn booking/ticket id
  className = 'btn-secondary',
  children,
  disabled = false,
  ...rest
}) {
  const [busy, setBusy] = useState(false);

  async function open() {
    if (busy || disabled) return;
    setBusy(true);
    const win = typeof window !== 'undefined'
      ? window.open('about:blank', '_blank', 'noopener,noreferrer')
      : null;
    let failure = null;
    try {
      const res = await fetch('/api/voucher-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id }),
      });
      const json = await res.json().catch(() => null);
      if (json?.success && json.data?.token) {
        const url = '/api/voucher/' + json.data.token;
        if (win) win.location.href = url;
        else if (typeof window !== 'undefined') window.location.href = url;
      } else {
        failure = json?.error?.message || 'Could not generate voucher link.';
      }
    } catch (_) {
      failure = 'Could not generate voucher link.';
    } finally {
      setBusy(false);
    }
    if (failure) {
      if (win) { try { win.close(); } catch (_) {} }
      // eslint-disable-next-line no-alert
      alert('Sorry — we couldn\'t open the voucher. Please refresh the page and try again.');
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={open}
      disabled={busy || disabled}
      {...rest}
    >
      {busy ? 'Preparing…' : children}
    </button>
  );
}
