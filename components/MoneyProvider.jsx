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
 *
 * Target currency:
 *   The whole site defaults to displaying prices in USD. During a checkout
 *   flow the user can pick a booking currency (Product 2 supports AUD/EUR/
 *   USD), and we want every price they see — fare prices, quote totals,
 *   the Braintree auth amount — to display in that currency rather than
 *   silently converting back to USD. CheckoutPage calls setTargetCurrency()
 *   when it loads the flow, and resets it on unmount.
 */

const STORAGE_KEY = 'fx.livn.v1';
const TTL_MS = 6 * 3600 * 1000; // 6 hours
// Persists the user's preferred display currency for the catalog (the
// currency picker in the header writes here). Checkout temporarily overrides
// to the booking currency, then resets back to whatever's stored here.
const DISPLAY_CCY_STORAGE_KEY = 'fx.livn.displayCurrency';
// Default to AUD because every cert product is priced natively in AUD —
// rendering "AU$279" on first load reads as "this is a real price from the
// supplier" instead of an FX-converted approximation.
const DEFAULT_DISPLAY_CURRENCY = 'AUD';

// Symbol per currency. We deliberately use "US$" / "AU$" (not the bare "$"
// or "A$") so the customer can never mistake one dollar denomination for
// another at a glance. Anything not in this map falls back to the ISO code
// prefix ("CHF 100").
const CURRENCY_SYMBOLS = {
  USD: 'US$',
  AUD: 'AU$',
  CAD: 'CA$',
  NZD: 'NZ$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

const MoneyContext = createContext({
  ready: false,
  rates: null,
  targetCurrency: DEFAULT_DISPLAY_CURRENCY,
  preferredDisplayCurrency: DEFAULT_DISPLAY_CURRENCY,
  setTargetCurrency: () => {},
  setPreferredDisplayCurrency: () => {},
  toUsd: () => null,
  formatUsd: () => '',
  formatUsdText: (s) => s,
});

export function MoneyProvider({ children }) {
  const [rates, setRates] = useState(null);
  const [error, setError] = useState(null);
  // The picker in the header writes to this; checkout overrides targetCurrency
  // for the duration of a flow but reads this back when it unmounts.
  const [preferredDisplayCurrency, setPreferredDisplayCurrencyState] = useState(DEFAULT_DISPLAY_CURRENCY);
  const [targetCurrency, setTargetCurrencyState] = useState(DEFAULT_DISPLAY_CURRENCY);
  // Hydrate the user's preferred display currency from localStorage once the
  // component mounts (avoids SSR mismatch — server always renders the default).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(DISPLAY_CCY_STORAGE_KEY);
      if (stored) {
        const code = String(stored).toUpperCase();
        setPreferredDisplayCurrencyState(code);
        setTargetCurrencyState(code);
      }
    } catch (_) { /* ignore */ }
  }, []);

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

  // Normalise codes to upper case so callers can pass 'aud' / 'AUD' equally.
  // Used by checkout for per-flow currency override.
  const setTargetCurrency = useCallback((code) => {
    setTargetCurrencyState(String(code || DEFAULT_DISPLAY_CURRENCY).toUpperCase() || DEFAULT_DISPLAY_CURRENCY);
  }, []);

  // Used by the header picker. Writes to localStorage AND immediately flips
  // the active target so the catalog rerenders without a page reload.
  const setPreferredDisplayCurrency = useCallback((code) => {
    const norm = String(code || DEFAULT_DISPLAY_CURRENCY).toUpperCase() || DEFAULT_DISPLAY_CURRENCY;
    setPreferredDisplayCurrencyState(norm);
    setTargetCurrencyState(norm);
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(DISPLAY_CCY_STORAGE_KEY, norm); } catch (_) {}
    }
  }, []);

  // Convert any price into the configured target currency. Renamed-internally
  // formerly known as toUsd; we keep the toUsd export so existing callers
  // continue to compile. Returns null when we can't convert (rates missing
  // or currency outside the rates table).
  const toTarget = useCallback((price) => {
    if (!price || typeof price !== 'object') return null;
    const amount = Number(price.amount);
    if (!Number.isFinite(amount)) return null;
    const ccy = String(price.currency || 'USD').toUpperCase();
    if (ccy === targetCurrency) return amount;
    if (!rates || !rates[ccy] || !rates[ccy][targetCurrency]) return null;
    // rates[SRC][TGT] = one SRC expressed in TGT.
    return amount * rates[ccy][targetCurrency];
  }, [rates, targetCurrency]);

  // Backwards-compatible: callers that explicitly want USD (e.g. the
  // Braintree authorize amount, which our merchant account is denominated
  // in) keep that semantic.
  const toUsd = useCallback((price) => {
    if (!price || typeof price !== 'object') return null;
    const amount = Number(price.amount);
    if (!Number.isFinite(amount)) return null;
    const ccy = String(price.currency || 'USD').toUpperCase();
    if (ccy === 'USD') return amount;
    if (!rates || !rates[ccy] || !rates[ccy].USD) return null;
    return amount * rates[ccy].USD;
  }, [rates]);

  const symbol = CURRENCY_SYMBOLS[targetCurrency];

  // Despite the legacy "Usd" name, this formats prices in the active target
  // currency. CheckoutPage flips the target to flow.currency so AUD/EUR
  // bookings actually display in AUD/EUR.
  const formatUsd = useCallback((price) => {
    const n = toTarget(price);
    if (n == null) {
      // Rates haven't loaded or we can't convert this currency → show a
      // placeholder rather than a foreign-currency string.
      if (!price || typeof price !== 'object') return '';
      return Number.isFinite(Number(price.amount)) ? (symbol || (targetCurrency + ' ')) + '—' : '';
    }
    if (symbol) return symbol + formatNumber(n);
    // Unknown currency code → render as "CHF 1,234.00".
    return targetCurrency + ' ' + formatNumber(n);
  }, [toTarget, symbol, targetCurrency]);

  // Livn pickup-option fees come back as bare-number prose like
  // "Transfer fee: 12.0" with no currency code or symbol — the supplier
  // assumes you know it's the booking currency. Prepend the active symbol
  // so users actually see "Transfer fee: AU$12" / "Transfer fee: €12" etc.
  // Skips strings without a number, things already paired with a currency
  // symbol/code, and percentages / units like "5% discount" or "30 mins".
  const formatFeeText = useCallback((text) => {
    if (text == null || text === '') return text;
    const s = String(text);
    const m = s.match(/^(.*?)(\d+(?:[.,]\d+)?)(.*)$/);
    if (!m) return s;
    if (/[$£€¥]\s*$|[A-Z]{3}\s*$/.test(m[1])) return s;
    if (/^\s*(%|percent|off\b|discount\b|years?\b|hours?\b|min(?:ute)?s?\b|days?\b|km\b|meters?\b|metres?\b|miles?\b|kg\b|cm\b|lb\b)/i.test(m[3])) return s;
    const num = Number(m[2].replace(',', '.'));
    if (!Number.isFinite(num)) return s;
    return m[1] + (symbol ? symbol + formatNumber(num) : targetCurrency + ' ' + formatNumber(num)) + m[3];
  }, [symbol, targetCurrency]);

  // Compact form for tight UI like the calendar date cells: "A$574" or
  // "€1.2k". Skips decimals; collapses thousands so the price fits in a tile.
  const formatPriceCompact = useCallback((price) => {
    const n = toTarget(price);
    if (n == null) return '';
    const prefix = symbol || (targetCurrency + ' ');
    if (n >= 1000) return prefix + (Math.round(n / 10) / 100) + 'k';
    return prefix + Math.round(n);
  }, [toTarget, symbol, targetCurrency]);

  /**
   * Convert inline currency mentions inside prose to the active target
   * currency. Handles both "10 AUD" / "10.50 AUD" and "AUD 10" orderings.
   * Only letter codes that appear in the rates table are touched, so random
   * uppercase words ("CEO", "USA") are left alone.
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
      if (ccy === targetCurrency) return m;
      const row = rates[ccy];
      if (!row || !row[targetCurrency]) return m;
      const num = Number(String(amount).replace(',', '.'));
      if (!Number.isFinite(num)) return m;
      const converted = num * row[targetCurrency];
      return symbol ? symbol + formatNumber(converted) : targetCurrency + ' ' + formatNumber(converted);
    });
  }, [rates, targetCurrency, symbol]);

  const value = useMemo(() => ({
    ready: !!rates,
    rates,
    error,
    targetCurrency,
    preferredDisplayCurrency,
    setTargetCurrency,
    setPreferredDisplayCurrency,
    toUsd,
    formatUsd,
    formatUsdText,
    formatFeeText,
    formatPriceCompact,
  }), [rates, error, targetCurrency, preferredDisplayCurrency, setTargetCurrency, setPreferredDisplayCurrency, toUsd, formatUsd, formatUsdText, formatFeeText, formatPriceCompact]);

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
