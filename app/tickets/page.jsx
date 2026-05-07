'use client';
import { useEffect, useState } from 'react';
import { apiGet, formatDate, pickList } from '@/lib/api';
import { Loading, ErrorBox, Empty } from '@/components/States';
import VoucherButton from '@/components/VoucherButton';

export default function TicketsPage() {
  const [q, setQ] = useState({ anyReference: '', passengerName: '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setLoading(true);
    setError(null);
    const res = await apiGet('/tickets', {
      ...q,
      resultsPerPage: 100,
      currentPage: 1,
    });
    setLoading(false);
    if (!res.ok) { setError(res.error); setRows([]); return; }
    setRows(pickList(res.data, 'tickets'));
  }

  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Tickets</h1>
          <p className="text-sm muted mt-1">Reissue and download vouchers for confirmed bookings.</p>
        </div>
      </header>
      <div className="card p-5 md:p-6">
        <form className="grid grid-cols-1 md:grid-cols-3 gap-3" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <div>
            <label className="label">Any reference</label>
            <input className="input" value={q.anyReference} onChange={(e) => setQ({ ...q, anyReference: e.target.value })} />
          </div>
          <div>
            <label className="label">Passenger name</label>
            <input className="input" value={q.passengerName} onChange={(e) => setQ({ ...q, passengerName: e.target.value })} />
          </div>
          <div className="flex items-end justify-end">
            <button className="btn-primary">Search</button>
          </div>
        </form>
      </div>

      {loading ? <Loading /> : null}
      {!loading && error ? <ErrorBox error={error} /> : null}
      {!loading && !error && rows.length === 0 ? <Empty label="No tickets found." /> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((t) => {
          const pax = (t.passengerDetails || []).map((p) => p?.name).filter(Boolean);
          const prod = (t.productDetails || [])[0];
          return (
            <div key={t.id} className="card card-hover p-4 flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="font-medium">Ticket #{t.id}</div>
                {pax.length ? <div className="text-sm">{pax.join(', ')}</div> : null}
                {prod?.name ? <div className="text-sm text-slate-700 truncate">{prod.name}</div> : null}
                <div className="text-xs text-slate-500 flex gap-2 flex-wrap">
                  {t.travelDate ? <span>travel {formatDate(t.travelDate)}</span> : null}
                  {prod?.startTime ? <span>starts {prod.startTime}</span> : null}
                  {t.supplierName ? <span>{t.supplierName}</span> : null}
                </div>
                {t.uuid ? <div className="text-[10px] text-slate-400 font-mono truncate">{t.uuid}</div> : null}
              </div>
              <VoucherButton type="ticket" id={t.id} className="btn-secondary shrink-0">
                PDF
              </VoucherButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
