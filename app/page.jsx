'use client';
import { useEffect, useRef, useState } from 'react';
import ProductCard from '@/components/ProductCard';
import { Loading, ErrorBox, Empty } from '@/components/States';
import { apiGet, apiPost, pickList } from '@/lib/api';
import { scrollToElement } from '@/lib/scroll';

export default function Home() {
  // Default to live so the home page always shows real products with images.
  const [mode, setMode] = useState('live');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [meta, setMeta] = useState(null);

  // Anchor for auto-scroll after the user clicks Search. Only scrolls when
  // the search is user-initiated (justSearched flag) — not on the initial
  // page load, where we don't want to yank the hero out of view.
  const resultsRef = useRef(null);
  const justSearched = useRef(false);

  const [localFilters, setLocalFilters] = useState({
    supplierId: '',
    date: '',
    dateFrom: '',
    dateTo: '',
  });

  const [live, setLive] = useState({
    fts: '',
    country: '',
    durationMin: '',
    durationMax: '',
  });

  const [needsSync, setNeedsSync] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function runLocal() {
    setLoading(true);
    setError(null);
    setNeedsSync(false);
    const res = await apiGet('/catalog', {
      supplierId: localFilters.supplierId,
      date: localFilters.date,
      dateFrom: localFilters.dateFrom,
      dateTo: localFilters.dateTo,
      resultsPerPage: 24,
    });
    if (!res.ok) {
      setLoading(false);
      setError(res.error);
      setProducts([]);
      setMeta(null);
      return;
    }
    const skeletons = (res.data?.results || []).map((r) => ({
      id: r.productId,
      disabled: r.disabled,
      supplier: { id: r.supplierId, name: `Supplier #${r.supplierId}` },
      images: [],
      name: `Product #${r.productId}`,
      operatingDates: r.operatingDates,
    }));
    setProducts(skeletons);
    setMeta({ total: res.data?.total, local: true });

    if (
      skeletons.length === 0 &&
      !localFilters.supplierId &&
      !localFilters.date &&
      !localFilters.dateFrom &&
      !localFilters.dateTo
    ) {
      setNeedsSync(true);
    }

    setLoading(false);

    // Enrich cards with full product details (names, images, prices) from the
    // server cache. These hit /products/<id>.json on disk, so they're cheap
    // after first sync. Run in chunks to avoid hammering the proxy.
    if (skeletons.length) {
      enrichInBackground(skeletons, setProducts);
    }
  }

  async function syncNow() {
    setSyncing(true);
    const res = await apiPost('/cache/sync', { includeDisabled: false });
    setSyncing(false);
    if (!res.ok) { setError(res.error); return; }
    runLocal();
  }

  async function runLive() {
    setLoading(true);
    setError(null);
    // The wcities cobber_api wrapper currently rejects every value of `fts`
    // with the same "Value must begin and end with '" error — even values
    // that literally do begin and end with a single quote — so server-side
    // text search is effectively broken. We omit `fts` from the request and
    // filter the returned products client-side. Other filters (country,
    // duration) are still honored server-side.
    const body = {
      paging: { resultsPerPage: 48, currentPage: 1 },
      countries: live.country ? [live.country] : undefined,
      durationMin: live.durationMin ? Number(live.durationMin) : undefined,
      durationMax: live.durationMax ? Number(live.durationMax) : undefined,
      minimalDetails: false,
    };
    Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
    const res = await apiPost('/products/search', body);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setProducts([]);
      setMeta(null);
      return;
    }
    const list = pickList(res.data, 'products');
    const filtered = filterByText(list, live.fts);
    const serverTotal = res.data?.paging?.resultsTotal ?? list.length;
    // When a search term is in play, "total" should reflect what the user
    // actually sees, not the unfiltered server count.
    const total = live.fts?.trim() ? filtered.length : serverTotal;
    setProducts(filtered);
    setMeta({ total, searchId: res.data?.id, live: true });
  }

  useEffect(() => { runLive(); /* eslint-disable-next-line */ }, []);

  function submit(e) {
    e.preventDefault();
    // Mark this run as user-initiated so the loading-finished effect knows
    // to scroll the results into view (the initial page-load fetch shouldn't).
    justSearched.current = true;
    mode === 'local' ? runLocal() : runLive();
  }

  // After a user-initiated search finishes, ease the results section into
  // view so the user lands on the cards without having to scroll past the
  // hero + filters every time.
  useEffect(() => {
    if (loading) return;
    if (!justSearched.current) return;
    justSearched.current = false;
    // Wait a tick for the result grid to lay out before scrolling.
    setTimeout(() => scrollToElement(resultsRef.current, 80), 50);
  }, [loading]);

  const resultCount = meta?.total ?? products.length;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="hero p-6 md:p-10">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.08] pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 80% 60%, white 1px, transparent 1px)',
            backgroundSize: '28px 28px, 42px 42px',
          }}
        />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 ring-1 ring-white/20 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
            Live inventory · 100+ suppliers
          </div>
          <h1 className="mt-4 text-3xl md:text-5xl font-bold tracking-tight text-balance">
            Discover and book extraordinary experiences.
          </h1>
          <p className="mt-3 text-base md:text-lg text-white/75 max-w-2xl">
            wcities connects your storefront to thousands of tours, activities and attractions —
            browse the local catalog or search Livn live, in one console.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <a href="#search" className="btn bg-white text-brand-800 hover:bg-brand-50">
              Start exploring
            </a>
            <a href="/admin" className="btn bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20">
              Catalog tools
            </a>
          </div>
        </div>
      </section>

      {/* Search */}
      <section id="search" className="card p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
          <div>
            <h2 className="section-title">Browse tours &amp; activities</h2>
            <p className="text-sm muted mt-0.5">
              Search Livn in real-time, or filter the locally-synced catalog.
            </p>
          </div>
          <div className="tab-group self-start md:self-auto">
            <button
              type="button"
              onClick={() => { setMode('live'); }}
              className={'tab ' + (mode === 'live' ? 'tab-active' : '')}
            >
              Live search
            </button>
            <button
              type="button"
              onClick={() => { setMode('local'); }}
              className={'tab ' + (mode === 'local' ? 'tab-active' : '')}
            >
              Local cache
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {mode === 'local' ? (
            <>
              <Field label="Supplier ID">
                <input
                  className="input"
                  type="number"
                  placeholder="e.g. 42"
                  value={localFilters.supplierId}
                  onChange={(e) => setLocalFilters({ ...localFilters, supplierId: e.target.value })}
                />
              </Field>
              <Field label="On date">
                <input
                  className="input"
                  type="date"
                  value={localFilters.date}
                  onChange={(e) => setLocalFilters({ ...localFilters, date: e.target.value })}
                />
              </Field>
              <Field label="From">
                <input
                  className="input"
                  type="date"
                  value={localFilters.dateFrom}
                  onChange={(e) => setLocalFilters({ ...localFilters, dateFrom: e.target.value })}
                />
              </Field>
              <Field label="To">
                <input
                  className="input"
                  type="date"
                  value={localFilters.dateTo}
                  onChange={(e) => setLocalFilters({ ...localFilters, dateTo: e.target.value })}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Search text" className="md:col-span-2">
                <input
                  className="input"
                  placeholder="e.g. hot air balloon, snorkeling, museum…"
                  value={live.fts}
                  onChange={(e) => setLive({ ...live, fts: e.target.value })}
                />
              </Field>
              <Field label="Country (ISO-2)">
                <input
                  className="input"
                  placeholder="AU"
                  maxLength={2}
                  value={live.country}
                  onChange={(e) => setLive({ ...live, country: e.target.value.toUpperCase() })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Min duration">
                  <input
                    className="input"
                    type="number"
                    placeholder="mins"
                    value={live.durationMin}
                    onChange={(e) => setLive({ ...live, durationMin: e.target.value })}
                  />
                </Field>
                <Field label="Max duration">
                  <input
                    className="input"
                    type="number"
                    placeholder="mins"
                    value={live.durationMax}
                    onChange={(e) => setLive({ ...live, durationMax: e.target.value })}
                  />
                </Field>
              </div>
            </>
          )}
          <div className="md:col-span-4 flex gap-2 justify-end pt-1">
            <button type="submit" className="btn-primary min-w-[120px]" disabled={loading}>
              {loading ? (
                <>
                  <Spinner />
                  Searching…
                </>
              ) : (
                <>
                  <SearchIcon />
                  Search
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* Results */}
      <section ref={resultsRef} className="space-y-4 scroll-mt-24">
        {loading ? <Loading /> : null}
        {!loading && error ? (
          <ErrorBox
            error={error}
            variant="card"
            onRetry={() => (mode === 'local' ? runLocal() : runLive())}
          />
        ) : null}

        {!loading && !error && needsSync ? (
          <div className="card p-8 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-brand-50 text-brand-700 grid place-items-center ring-1 ring-brand-100">
              <SyncIcon />
            </div>
            <div>
              <div className="section-title">Your local catalog is empty</div>
              <p className="text-sm muted mt-1 max-w-md mx-auto">
                Pull the full catalog from Livn so search works offline — it usually takes a few seconds.
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <button onClick={syncNow} disabled={syncing} className="btn-primary">
                {syncing ? 'Syncing…' : 'Sync catalog now'}
              </button>
              <button onClick={() => { setMode('live'); runLive(); }} className="btn-secondary">
                Or search Livn live
              </button>
            </div>
          </div>
        ) : null}

        {!loading && !error && !needsSync && products.length === 0 ? (
          <Empty label="No products match your filters." />
        ) : null}

        {meta && products.length > 0 ? (
          <div className="flex items-center justify-between">
            <div className="text-sm text-ink-500">
              <span className="font-semibold text-ink-900">{resultCount}</span>{' '}
              result{resultCount === 1 ? '' : 's'}
              {meta.local ? ' · from local cache' : meta.live ? ' · via Livn live search' : ''}
            </div>
            {meta.searchId ? (
              <span className="kbd" title="Livn search identifier">id: {String(meta.searchId).slice(0, 8)}…</span>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map((p) => (
            <ProductCard key={`${p.id}-${p.supplier?.id ?? ''}`} product={p} />
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------- enrichment ----------------

/**
 * Fetch full product details for a batch of local-cache skeletons so
 * ProductCard has real images, names, and fromPrices to show. Updates state
 * as results stream in, in chunks, so the first images appear quickly.
 */
async function enrichInBackground(skeletons, setProducts) {
  const CONCURRENCY = 6;
  const queue = skeletons.map((s, idx) => ({ idx, id: s.id }));
  let cancelled = false;

  async function worker() {
    while (queue.length && !cancelled) {
      const job = queue.shift();
      if (!job) return;
      try {
        const res = await apiGet(`/products/${job.id}`);
        if (!res.ok || !res.data) continue;
        const enriched = {
          ...res.data,
          // Keep the original id/supplier from the skeleton so the React key
          // stays stable even if the detail payload differs subtly.
          id: res.data.id ?? job.id,
        };
        setProducts((prev) => {
          if (!Array.isArray(prev) || !prev[job.idx] || prev[job.idx].id !== job.id) return prev;
          const next = prev.slice();
          next[job.idx] = enriched;
          return next;
        });
      } catch (_) { /* skip */ }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

// Case-insensitive substring match across the fields the user is most likely
// to be searching for. Used as the client-side fallback while the wrapper's
// fts endpoint is broken (always returns "Value must begin and end with '"
// regardless of input). Tokenizes the query so "hot air" matches whether the
// product hits "hot air balloon" or "Hot-Air Adventure".
function filterByText(products, raw) {
  const q = (raw || '').trim().toLowerCase();
  if (!q) return products;
  const tokens = q.split(/\s+/).filter(Boolean);
  return products.filter((p) => {
    const hay = [
      p?.name,
      p?.description,
      p?.supplier?.name,
      ...(p?.locationsStart || []).map((l) => l?.city),
      ...(p?.categories || []).map((c) => (typeof c === 'string' ? c : c?.name)),
    ].filter(Boolean).join(' ').toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

function Spinner() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 3v4h-4M6 21v-4h4"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
