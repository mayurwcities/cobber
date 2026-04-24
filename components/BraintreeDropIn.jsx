'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/**
 * Braintree Drop-in wrapper. Mounts the Braintree Drop-in UI in a
 * themed card, fetches a client token from /api/braintree/token,
 * and exposes a `requestPaymentMethod()` method via ref that the
 * parent can call to tokenize the card into a nonce.
 *
 * The parent owns the "pay / confirm" button — Drop-in only collects
 * card details. This matches the brief: "either put the braintree
 * layout at the bottom of the where user put their details".
 */
const BraintreeDropIn = forwardRef(function BraintreeDropIn(
  { amount, currency, onReady, onError, onRequestableChange },
  ref,
) {
  const containerRef = useRef(null);
  const wrapperRef = useRef(null);
  const instanceRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useImperativeHandle(ref, () => ({
    async requestPaymentMethod() {
      if (!instanceRef.current) throw new Error('Drop-in is not ready');
      return instanceRef.current.requestPaymentMethod();
    },
    isReady() {
      return !!instanceRef.current;
    },
    isPaymentMethodRequestable() {
      try { return !!instanceRef.current?.isPaymentMethodRequestable(); }
      catch { return false; }
    },
    // Drop-in caches the tokenized nonce after `requestPaymentMethod()`
    // so a second call returns the *same* nonce — which Braintree refuses
    // with "Cannot use a payment_method_nonce more than once". Call this
    // after any /authorize attempt so the next submit gets a fresh nonce.
    async clearSelectedPaymentMethod() {
      const inst = instanceRef.current;
      if (!inst) return;
      try { await inst.clearSelectedPaymentMethod(); } catch {}
    },
    // Scroll the Drop-in into view so inline field errors are visible.
    scrollIntoView() {
      wrapperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    let instance = null;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // 1) fetch client token from our server
        const tokRes = await fetch('/api/braintree/token');
        const tokJson = await tokRes.json().catch(() => null);
        if (!tokJson?.success || !tokJson?.data?.clientToken) {
          throw new Error(tokJson?.error?.message || 'Failed to fetch payment token');
        }
        if (cancelled) return;

        // 2) dynamic-import Drop-in so it only loads in the browser
        const dropinModule = await import('braintree-web-drop-in');
        const dropin = dropinModule.default || dropinModule;
        if (cancelled) return;

        instance = await dropin.create({
          authorization: tokJson.data.clientToken,
          container: containerRef.current,
          card: {
            cardholderName: { required: true },
            overrides: {
              styles: {
                input: {
                  'font-size': '14px',
                  'font-family':
                    'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, sans-serif',
                  color: '#0b1430',
                },
                // No visual change on focus — outer border stays slate-200.
                '.invalid': { color: '#dc2626' },
              },
            },
          },
        });
        if (cancelled) { try { instance.teardown(); } catch {} return; }

        instanceRef.current = instance;
        setLoading(false);

        // Fire an initial state so the parent can enable/disable the
        // submit button before the user has touched any field.
        const emitState = () => {
          try {
            if (onRequestableChange) {
              onRequestableChange(!!instance.isPaymentMethodRequestable());
            }
          } catch {}
        };
        emitState();
        instance.on('paymentMethodRequestable', emitState);
        instance.on('noPaymentMethodRequestable', emitState);

        if (onReady) onReady();
      } catch (e) {
        if (cancelled) return;
        const msg = e?.message || String(e);
        setErr(msg);
        setLoading(false);
        if (onError) onError(msg);
      }
    })();

    return () => {
      cancelled = true;
      const inst = instanceRef.current;
      instanceRef.current = null;
      if (inst) {
        try { inst.teardown(); } catch {}
      }
    };
    // Intentionally only on mount — re-instantiating Drop-in on every
    // amount change would reset the user's typed card details.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapperRef} className="space-y-2 scroll-mt-24">
      <h3 className="font-semibold">Payment details</h3>

      {amount != null ? (
        <div className="text-sm text-slate-500">
          Authorizing <span className="font-semibold text-brand-700 tabular-nums">{amount}</span>
          {currency ? <span className="ml-1">{currency}</span> : null}
        </div>
      ) : null}

      <div className="rounded-lg ring-1 ring-slate-200 bg-white p-3">
        <div ref={containerRef} />
        {loading ? (
          <div className="py-6 text-sm text-slate-500">Loading secure payment form…</div>
        ) : null}
        {err ? (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {err}
          </div>
        ) : null}
      </div>

      <p className="text-[11px] text-slate-500">
        Your card is verified and held now. We only charge you once the booking is confirmed.
      </p>
    </div>
  );
});

export default BraintreeDropIn;
