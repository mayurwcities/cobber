'use client';
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';

/**
 * App-wide currency context.
 *
 * Rates come from Livn's own /api/exchangeRates, fetched through our PHP
 * proxy at /api/livn/exchange-rates (where it's cached 6h). The payload
 * is a nested table: rates[SRC][TGT] = "one unit of SRC expressed in TGT".
 *
 * So to convert price {amount, currency} to USD:
 *   usd = amount * rates[currency].USD
 *
 * localStorage hydrates instantly on return visits.
 */

const STORAGE_KEY = 'fx.livn.v1';
const TTL_MS = 6 * 3600 * 1000; // 6 hours

const MoneyContext = createContext({
  ready: false,
  rates: null,
  toUsd: () => null,
  formatUsd: () => '',
  formatUsdText: (s) => s,
});

export function MoneyProvider({ children }) {
  const [rates, setRates] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Hydrate from localStorage first to avoid a flash of no-price state.
    let cached = null;
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.fetched && Date.now() - parsed.fetched < TTL_MS) {
            cached = parsed.rates;
            setRates(parsed.rates);
          }
        }
      } catch (_) { /* ignore */ }
    }
    if (cached) return;

    // Network fetch — hit our PHP wrapper (which hits Livn with proper auth).
    let cancelled = false;
    fetch('/api/livn/exchange-rates')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (!d || !d.success || !d.data || typeof d.data !== 'object') {
          setError('no_rates');
          return;
        }
        const r = d.data;
        setRates(r);
        if (typeof window !== 'undefined') {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ rates: r, fetched: Date.now() })); } catch (_) {}
        }
      })
      .catch(() => { if (!cancelled) setError('network'); });

    return () => { cancelled = true; };
  }, []);

  const toUsd = useCallback((price) => {
    if (!price || typeof price !== 'object') return null;
    const amount = Number(price.amount);
    if (!Number.isFinite(amount)) return null;
    const ccy = String(price.currency || 'USD').toUpperCase();
    if (ccy === 'USD') return amount;
    if (!rates || !rates[ccy] || !rates[ccy].USD) return null;
    // rates[SRC][TGT] = one SRC expressed in TGT.
    return amount * rates[ccy].USD;
  }, [rates]);

  const formatUsd = useCallback((price) => {
    const n = toUsd(price);
    if (n == null) {
      // Rates haven't loaded or we can't convert this currency → show a
      // placeholder rather than a foreign-currency string.
      if (!price || typeof price !== 'object') return '';
      return Number.isFinite(Number(price.amount)) ? '$—' : '';
    }
    return '$' + formatNumber(n);
  }, [toUsd]);

  /**
   * Convert inline currency mentions inside prose to USD. Handles both
   * "10 AUD" / "10.50 AUD" and "AUD 10" orderings. Only letter codes that
   * appear in the rates table are touched, so random uppercase words
   * ("CEO", "USA") are left alone.
   */
  const formatUsdText = useCallback((text) => {
    if (text == null || text === '') return text;
    const s = String(text);
    if (!rates) return s;
    const pattern =
      /(?:(\d+(?:[.,]\d+)?)\s*([A-Z]{3}))|(?:\b([A-Z]{3})\s?(\d+(?:[.,]\d+)?))/g;
    return s.replace(pattern, (m, a1, c1, c2, a2) => {
      const amount = a1 ?? a2;
      const ccy = (c1 ?? c2 ?? '').toUpperCase();
      if (!amount || !ccy) return m;
      if (ccy === 'USD') return m;
      const row = rates[ccy];
      if (!row || !row.USD) return m;
      const num = Number(String(amount).replace(',', '.'));
      if (!Number.isFinite(num)) return m;
      return '$' + formatNumber(num * row.USD);
    });
  }, [rates]);

  const value = useMemo(() => ({
    ready: !!rates,
    rates,
    error,
    toUsd,
    formatUsd,
    formatUsdText,
  }), [rates, error, toUsd, formatUsd, formatUsdText]);

  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>;
}

export function useMoney() {
  return useContext(MoneyContext);
}

function formatNumber(n) {
  const hasCents = Math.abs(n % 1) > 1e-9 || Math.abs(n) < 10;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
