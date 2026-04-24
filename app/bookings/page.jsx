'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, formatDate, pickList } from '@/lib/api';
import { Loading, ErrorBox, Empty } from '@/components/States';

export default function BookingsListPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState({
    anyReference: '',
    partyName: '',
    partyEmailAddress: '',
    travelFrom: '',
    travelTo: '',
  });

  async function run() {
    setLoading(true);
    setError(null);
    const res = await apiGet('/bookings', {
      ...q,
      resultsPerPage: 50,
      currentPage: 1,
    });
    setLoading(false);
    if (!res.ok) { setError(res.error); setRows([]); return; }
    setRows(pickList(res.data, 'bookings'));
  }

  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Bookings</h1>
          <p className="text-sm muted mt-1">Search and review every reservation created through wcities.</p>
        </div>
      </header>
      <div className="card p-5 md:p-6">
        <form
          className="grid grid-cols-1 md:grid-cols-5 gap-3"
          onSubmit={(e) => { e.preventDefault(); run(); }}
        >
          <div>
            <label className="label">Any reference</label>
            <input className="input" value={q.anyReference} onChange={(e) => setQ({ ...q, anyReference: e.target.value })} />
          </div>
          <div>
            <label className="label">Passenger name</label>
            <input className="input" value={q.partyName} onChange={(e) => setQ({ ...q, partyName: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={q.partyEmailAddress} onChange={(e) => setQ({ ...q, partyEmailAddress: e.target.value })} />
          </div>
          <div>
            <label className="label">Travel from</label>
            <input className="input" type="date" value={q.travelFrom} onChange={(e) => setQ({ ...q, travelFrom: e.target.value })} />
          </div>
          <div>
            <label className="label">Travel to</label>
            <input className="input" type="date" value={q.travelTo} onChange={(e) => setQ({ ...q, travelTo: e.target.value })} />
          </div>
          <div className="md:col-span-5 flex justify-end">
            <button className="btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Search
            </button>
          </div>
        </form>
      </div>

      {loading ? <Loading /> : null}
      {!loading && error ? <ErrorBox error={error} /> : null}
      {!loading && !error && rows.length === 0 ? <Empty label="No bookings found." /> : null}

      <div className="space-y-2">
        {rows.map((b) => (
          <Link key={b.id} href={`/bookings/${b.id}`} className="card card-hover p-4 block">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{b.partyName || 'Unknown passenger'}</div>
                {b.productName ? <div className="text-sm text-slate-700 truncate">{b.productName}</div> : null}
                <div className="text-xs text-slate-500 flex gap-2 flex-wrap">
                  <span>Livn: <span className="font-mono">{b.livnReference}</span></span>
                  {b.supplierReference ? <span>supplier: <span className="font-mono">{b.supplierReference}</span></span> : null}
                  {b.passThroughReference ? <span>passThrough: <span className="font-mono">{b.passThroughReference}</span></span> : null}
                </div>
                {b.partyEmailAddress ? <div className="text-xs text-slate-500">{b.partyEmailAddress}</div> : null}
              </div>
              <div className="text-right text-xs text-slate-500 shrink-0">
                {b.confirmed ? <div>Confirmed {formatDate(b.confirmed)}</div> : null}
                {b.cancellations?.length ? <div className="badge bg-red-100 text-red-700 mt-1">Cancelled</div> : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
