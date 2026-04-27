'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loading, ErrorBox } from '@/components/States';
import DatePicker from '@/components/DatePicker';
import { apiGet, apiPost, formatDuration, formatAgeRange, formatLocation, getProductMarkup, applyMarkup } from '@/lib/api';
import { scrollToElement } from '@/lib/scroll';
import { useMoney } from '@/components/MoneyProvider';

export default function ProductDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { formatUsd, formatUsdText } = useMoney();

  const [product, setProduct] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [departures, setDepartures] = useState([]);
  const [depLoading, setDepLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const startErrorRef = useRef(null);

  // Scroll the error box into view whenever a new startError appears, so the
  // user doesn't miss validation feedback after clicking Start booking on a
  // long product page.
  useEffect(() => {
    if (!startError) return;
    scrollToElement(startErrorRef.current, 80);
  }, [startError]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await apiGet(`/products/${id}`);
      setLoading(false);
      if (!res.ok) { setError(res.error); return; }
      setProduct(res.data);
    })();
  }, [id]);

  useEffect(() => {
    if (!product) return;
    (async () => {
      setDepLoading(true);
      // Livn rejects endDate > 1 year from today ("Parameter endDate cannot
      // extend more than one year into the future."). Stay a couple of days
      // short of the edge so we don't trip the limit on leap-year rollovers.
      const today = new Date();
      const end = new Date();
      end.setDate(today.getDate() + 363);
      const iso = (d) => d.toISOString().slice(0, 10);
      const res = await apiGet(`/products/${id}/departures`, {
        startDate: iso(today),
        endDate: iso(end),
      });
      setDepLoading(false);
      if (res.ok) {
        // Livn returns { productId, departures: [{date, fromPrices:[…]}] }
        const arr = Array.isArray(res.data?.departures) ? res.data.departures : [];
        setDepartures(arr);
      }
    })();
  }, [product, id]);

  // Livn returns the supplier-supported booking currencies on the product.
  // Some products (e.g. Salzburg) accept AUD/EUR/USD and the Livn cert
  // requires us to let the user pick, so we render a select when there's
  // more than one option. We always *display* prices via MoneyProvider's
  // USD conversion regardless of which currency the booking is settled in.
  const currencies = product?.currencies || [];
  const [currency, setCurrency] = useState('');
  useEffect(() => {
    // Default to the first currency once product loads. Stays empty until then
    // so the <select> doesn't briefly select a wrong value.
    if (!currency && currencies.length) setCurrency(currencies[0]);
  }, [currencies, currency]);

  const imagesToShow = useMemo(() => {
    const imgs = product?.images || [];
    return imgs.filter((i) => i?.url).slice(0, 5);
  }, [product]);

  async function startCheckout() {
    if (!selectedDate) { setStartError({ message: 'Please pick a date.' }); return; }
    setStartError(null);
    setStarting(true);
    const res = await apiPost('/flows', {
      productId: Number(id),
      date: selectedDate,
      currency: currency || undefined,
    });
    setStarting(false);
    if (!res.ok) { setStartError(res.error); return; }
    const flowId = res.data?.id;
    if (!flowId) { setStartError({ message: 'Flow created but no id returned.' }); return; }
    // Stash the initial flow in sessionStorage so we can hydrate on the next page
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('livn.flow.' + flowId, JSON.stringify(res.data));
    }
    router.push(`/checkout/${flowId}`);
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!product) return null;

  const netRate = product?._pricing?.usesNetRates ?? product?.usesNetRates;
  const productMarkup = getProductMarkup(product);
  const rawFromPrices = product?._pricing?.fromPrices || product?.fromPrices || [];
  const fromPrices = rawFromPrices.map((p) => applyMarkup(p, productMarkup));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {imagesToShow.length ? (
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3 md:col-span-2 aspect-[16/10] rounded-lg overflow-hidden bg-slate-100">
              <img src={imagesToShow[0].url} alt="" className="w-full h-full object-cover" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-1 gap-2">
              {imagesToShow.slice(1, 5).map((img, i) => (
                <div key={i} className="aspect-[16/10] rounded overflow-hidden bg-slate-100">
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <section className="card p-5">
          <div className="text-xs text-slate-500">
            {product.supplier?.name} · {product.supplier?.country || ''}
          </div>
          <h1 className="text-2xl font-bold mt-1">{product.name}</h1>
          {product.disabled ? (
            <span className="badge bg-red-100 text-red-700 mt-2">Disabled — not bookable</span>
          ) : null}
          <div className="flex gap-2 flex-wrap mt-2">
            {(product.categories || []).map((c) => (
              <span key={c.id || c.name} className="badge bg-brand-50 text-brand-700">
                {c.name || c}
              </span>
            ))}
          </div>
          {product.description ? (
            <p className="text-slate-700 mt-3 whitespace-pre-wrap">{formatUsdText(product.description)}</p>
          ) : null}
        </section>

        <section className="card p-5">
          <h2 className="font-semibold mb-3">Quick facts</h2>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            {formatDuration(product.duration) ? (
              <Fact label="Duration" value={formatDuration(product.duration)} />
            ) : null}
            {product.groupSizeMax ? (
              <Fact label="Max group size" value={product.groupSizeMax} />
            ) : null}
            <Fact label="Age range" value={formatAgeRange(product.ageMin, product.ageMax)} />
            {product.operatingDaysStr ? (
              <Fact label="Operating days" value={product.operatingDaysStr.replace(/,/g, ', ')} />
            ) : null}
            {product.resSystem ? (
              <Fact label="Reservation system" value={product.resSystem} />
            ) : null}
          </dl>
        </section>

        {(product._pricing?.usesNetRates || product.usesNetRates) && fromPrices[0] ? (
          <section className="card p-5">
            <h2 className="font-semibold mb-2">Pricing</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm muted">From</span>
              <span className="text-lg font-bold text-brand-800 tabular-nums">
                {formatUsd(fromPrices[0])}
              </span>
              <span className="badge bg-amber-100 text-amber-800">Net rate</span>
            </div>
            <p className="mt-2 text-xs text-amber-700">
              ⓘ This is a net rate — add your own commission markup before showing it to customers.
            </p>
          </section>
        ) : null}

        {(product.locationsStart?.length || product.locationsEnd?.length) ? (
          <section className="card p-5">
            <h2 className="font-semibold mb-3">Where</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {product.locationsStart?.length ? (
                <div>
                  <div className="text-xs text-slate-500 mb-1">Starts at</div>
                  {product.locationsStart.map((loc, i) => (
                    <LocationBlock key={'s' + i} loc={loc} />
                  ))}
                </div>
              ) : null}
              {product.locationsEnd?.length ? (
                <div>
                  <div className="text-xs text-slate-500 mb-1">Ends at</div>
                  {product.locationsEnd.map((loc, i) => (
                    <LocationBlock key={'e' + i} loc={loc} />
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {product.highlights?.highlights?.length ? (
          <section className="card p-5">
            <h2 className="font-semibold mb-2">Highlights</h2>
            <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
              {product.highlights.highlights.map((h, i) => <li key={i}>{formatUsdText(h)}</li>)}
            </ul>
          </section>
        ) : null}

        {product.inclusions?.items?.length ? (
          <section className="card p-5">
            <h2 className="font-semibold mb-2">Inclusions</h2>
            <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
              {product.inclusions.items.map((it, i) => (
                <li key={i}>
                  {it.type ? <span className="text-xs text-slate-500">[{it.type}] </span> : null}
                  {formatUsdText(it.content)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {product.itinerary?.items?.length ? (
          <section className="card p-5">
            <h2 className="font-semibold mb-2">Itinerary</h2>
            <div className="space-y-3">
              {product.itinerary.items.map((it, i) => (
                <div key={i}>
                  <div className="text-sm font-medium">
                    {it.title || `Day ${it.dayFrom}${it.dayTo && it.dayTo !== it.dayFrom ? '–' + it.dayTo : ''}`}
                  </div>
                  <div className="text-sm text-slate-700 whitespace-pre-wrap">{formatUsdText(it.body)}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {product.specialNotes ? (
          <section className="card p-5">
            <h2 className="font-semibold mb-2">Special notes</h2>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{formatUsdText(product.specialNotes)}</p>
          </section>
        ) : null}

        {product.pickupNotes || product.dropoffNotes ? (
          <section className="card p-5 space-y-2 text-sm">
            {product.pickupNotes ? (
              <div><span className="font-semibold">Pickup:</span> {formatUsdText(product.pickupNotes)}</div>
            ) : null}
            {product.dropoffNotes ? (
              <div><span className="font-semibold">Drop-off:</span> {formatUsdText(product.dropoffNotes)}</div>
            ) : null}
          </section>
        ) : null}

        {product.supplier ? (
          <section className="card p-5 text-sm">
            <h2 className="font-semibold mb-2">Supplier</h2>
            <div className="flex items-start gap-3">
              {product.supplier.logo?.url ? (
                <img
                  src={product.supplier.logo.url}
                  alt={product.supplier.name}
                  className="w-16 h-16 object-contain rounded bg-white ring-1 ring-slate-200 p-1"
                />
              ) : null}
              <div>
                <div className="font-medium">{product.supplier.name}</div>
                {product.supplier.nameCompany && product.supplier.nameCompany !== product.supplier.name ? (
                  <div className="text-xs text-slate-500">{product.supplier.nameCompany}</div>
                ) : null}
                <div className="text-xs text-slate-500 mt-1">
                  {[product.supplier.city, product.supplier.state, product.supplier.country].filter(Boolean).join(', ')}
                </div>
                <div className="text-xs text-slate-500 mt-1 flex gap-3 flex-wrap">
                  {product.supplier.website ? (
                    <a className="hover:underline" href={product.supplier.website.startsWith('http') ? product.supplier.website : 'https://' + product.supplier.website} target="_blank" rel="noreferrer">
                      {product.supplier.website}
                    </a>
                  ) : null}
                  {product.supplier.email ? <span>{product.supplier.email}</span> : null}
                  {product.supplier.phoneRes ? <span>{product.supplier.phoneRes}</span> : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <aside className="space-y-4">
        <div className="card p-5 sticky top-20">
          <div className="text-[10px] uppercase tracking-wider muted">From</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-3xl font-bold text-brand-800 tabular-nums">
              {fromPrices[0] ? formatUsd(fromPrices[0]) : '—'}
            </span>
            {netRate ? (
              <span className="badge bg-amber-100 text-amber-800">Net rate</span>
            ) : null}
          </div>

          <div className="mt-4">
            <label className="label">Select a date</label>
            <DatePicker
              value={selectedDate}
              onChange={setSelectedDate}
              departures={departures}
              loading={depLoading}
            />
            {selectedDate ? (
              <div className="mt-2 text-xs text-slate-600">
                Booking for <span className="font-medium">{selectedDate}</span>
              </div>
            ) : null}
          </div>

          {currencies.length > 1 ? (
            <div className="mt-4">
              <label className="label" htmlFor="booking-currency">Booking currency</label>
              <select
                id="booking-currency"
                className="input"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                The booking is settled in this currency; prices are displayed in USD.
              </p>
            </div>
          ) : null}

          <button
            onClick={startCheckout}
            disabled={starting || !selectedDate}
            className="btn-primary w-full mt-4"
          >
            {starting ? 'Starting…' : 'Start booking'}
          </button>

          <div ref={startErrorRef} className="scroll-mt-24">
            {startError ? <div className="mt-3"><ErrorBox error={startError} /></div> : null}
          </div>

          <p className="text-xs text-slate-500 mt-3">
            Product ID: {product.id} · resSystem: {product.resSystem || product.supplier?.resSystem}
          </p>
        </div>
      </aside>
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium">{value || '—'}</dd>
    </div>
  );
}

function LocationBlock({ loc }) {
  if (!loc) return null;
  const line = formatLocation(loc);
  const street = loc.address1 || loc.business;
  return (
    <div className="text-slate-700">
      {street ? <div>{street}</div> : null}
      {line ? <div className="text-slate-600">{line}</div> : null}
      {loc.postcode ? <div className="text-xs text-slate-500">{loc.postcode}</div> : null}
      {loc.tz ? <div className="text-xs text-slate-500">tz: {loc.tz}</div> : null}
    </div>
  );
}
