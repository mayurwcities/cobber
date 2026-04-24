'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiGet, apiDelete, formatDate, formatDateTime } from '@/lib/api';
import { Loading, ErrorBox } from '@/components/States';
import QuoteView from '@/components/QuoteView';
import { useMoney } from '@/components/MoneyProvider';

/**
 * Booking shape from GET /api/bookings?id=...:
 * {
 *   id, flowId, productId, supplierId, productName,
 *   livnReference, passThroughReference, supplierReference, clientReference?,
 *   partyName, partyEmailAddress, confirmed,
 *   billingInfo: { billingCurrency, billingExchangeRate },
 *   invoice:     { lineItems, grossTotal, netTotal, ... },
 *   cancellationPolicy: { text, setAtTimeOfBooking },
 *   tickets: [ … see /tickets below … ],
 *   cancellations?: [ { id, status, created, reason } ],
 *   externalResources?: [ { url, title, type, required } ]
 * }
 */
export default function BookingDetailPage() {
  const { id } = useParams();
  const { formatUsdText } = useMoney();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    const res = await apiGet(`/bookings/${id}`);
    setLoading(false);
    if (!res.ok) { setError(res.error); return; }
    setBooking(res.data);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function cancel() {
    if (!confirm('Cancel this booking?')) return;
    setCancelling(true);
    const res = await apiDelete(`/bookings/${id}`, { reason });
    setCancelling(false);
    if (!res.ok) { setError(res.error); return; }
    load();
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={load} variant="card" />;
  if (!booking) return null;

  const cancellations = booking.cancellations || [];
  const inProgress = cancellations.some((c) => c.status === 'IN_PROGRESS');
  const cancelled  = cancellations.some((c) => c.status === 'CANCELLED');

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">Booking #{booking.id}</div>
            <h1 className="text-lg font-semibold">{booking.productName || `Product ${booking.productId}`}</h1>
            <div className="text-xs text-slate-500 mt-1 flex gap-3 flex-wrap">
              <span>Livn ref <span className="font-mono">{booking.livnReference}</span></span>
              {booking.supplierReference ? <span>supplier <span className="font-mono">{booking.supplierReference}</span></span> : null}
              {booking.passThroughReference && booking.passThroughReference !== booking.livnReference ? (
                <span>passThrough <span className="font-mono">{booking.passThroughReference}</span></span>
              ) : null}
              {booking.clientReference ? <span>client <span className="font-mono">{booking.clientReference}</span></span> : null}
            </div>
            <div className="text-sm mt-2">
              {booking.partyName}{booking.partyEmailAddress ? ` · ${booking.partyEmailAddress}` : ''}
            </div>
            <div className="text-xs text-slate-500">Confirmed {formatDateTime(booking.confirmed)}</div>
          </div>
          <div className="flex gap-2 shrink-0">
            <a className="btn-secondary" target="_blank" rel="noreferrer" href={`/api/livn/bookings/${booking.id}/pdf`}>
              PDF voucher
            </a>
            {cancelled ? (
              <span className="badge bg-red-100 text-red-700 self-center">Cancelled</span>
            ) : (
              <button className="btn-danger" onClick={cancel} disabled={cancelling || inProgress}>
                {inProgress ? 'Cancellation in progress' : cancelling ? 'Cancelling…' : 'Cancel booking'}
              </button>
            )}
          </div>
        </div>

        {!cancelled ? (
          <div className="mt-3">
            <label className="label">Cancellation reason (optional)</label>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. customer changed plans"
            />
          </div>
        ) : null}
      </div>

      {booking.invoice ? (
        <div className="card p-5">
          <h2 className="font-semibold mb-2">Invoice</h2>
          <QuoteView quote={booking.invoice} />
        </div>
      ) : null}

      {booking.cancellationPolicy?.text ? (
        <div className="card p-5">
          <h2 className="font-semibold mb-1">Cancellation policy</h2>
          {booking.cancellationPolicy.setAtTimeOfBooking ? (
            <div className="text-xs text-slate-500 mb-2">Set at time of booking.</div>
          ) : null}
          <div className="text-sm text-slate-700 whitespace-pre-wrap">
            {formatUsdText(booking.cancellationPolicy.text)}
          </div>
        </div>
      ) : null}

      {booking.tickets?.length ? (
        <div className="card p-5">
          <h2 className="font-semibold mb-2">Tickets</h2>
          <div className="space-y-2">
            {booking.tickets.map((t) => <TicketRow key={t.id} ticket={t} />)}
          </div>
        </div>
      ) : null}

      {booking.externalResources?.length ? (
        <div className="card p-5">
          <h2 className="font-semibold mb-2">External resources</h2>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {booking.externalResources.map((r, i) => (
              <li key={i}>
                <a href={r.url} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                  {r.title || r.type || r.url}
                </a>
                {r.required ? <span className="badge bg-red-100 text-red-700 ml-2">required</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {cancellations.length ? (
        <div className="card p-5">
          <h2 className="font-semibold mb-2">Cancellations</h2>
          <div className="space-y-2 text-sm">
            {cancellations.map((c) => (
              <div key={c.id} className="border border-slate-200 rounded p-3">
                <div className="flex justify-between items-center">
                  <span className="font-medium">{c.status}</span>
                  <span className="text-xs text-slate-500">{formatDateTime(c.created)}</span>
                </div>
                {c.reason ? <div className="text-xs text-slate-500 mt-1">{c.reason}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="text-xs">
        <Link href="/bookings" className="text-slate-500 hover:underline">← back to bookings</Link>
      </div>
    </div>
  );
}

/**
 * Real Livn ticket shape:
 * {
 *   id, uuid, created, travelDate, printRequired,
 *   supplierName, supplierEmailRes, supplierPhoneRes,
 *   bookingDetails:    { id, supplierReference, livnReference, partyName, … },
 *   passengerDetails:  [ { name, … } ],
 *   productDetails:    [ { name, startTime, … } ],
 *   pickupDetails:     { notes, dropoffNotes, … },
 *   specialNotes, localFees,
 *   barcodes?: [ { format, content } ]  // some products
 * }
 */
function TicketRow({ ticket }) {
  const { formatUsdText } = useMoney();
  const pax = (ticket.passengerDetails || []).map((p) => p?.name).filter(Boolean);
  const products = (ticket.productDetails || []);
  const primaryProduct = products[0] || null;
  const barcodes = Array.isArray(ticket.barcodes) ? ticket.barcodes : (ticket.barcode ? [ticket.barcode] : []);

  return (
    <div className="border border-slate-200 rounded p-3 flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="font-medium">
          Ticket #{ticket.id}
          {ticket.uuid ? <span className="text-xs text-slate-400 ml-2 font-mono">{ticket.uuid}</span> : null}
        </div>
        {pax.length ? <div className="text-sm">{pax.join(', ')}</div> : null}
        {primaryProduct?.name ? <div className="text-sm text-slate-700">{primaryProduct.name}</div> : null}
        {primaryProduct?.startTime ? <div className="text-xs text-slate-500">starts {primaryProduct.startTime}</div> : null}
        {ticket.travelDate ? <div className="text-xs text-slate-500">travel {formatDate(ticket.travelDate)}</div> : null}
        {ticket.supplierName ? (
          <div className="text-xs text-slate-500">
            {ticket.supplierName}
            {ticket.supplierEmailRes ? ` · ${ticket.supplierEmailRes}` : ''}
            {ticket.supplierPhoneRes ? ` · ${ticket.supplierPhoneRes}` : ''}
          </div>
        ) : null}
        {barcodes.map((b, i) => (
          <div key={i} className="text-xs text-slate-500">
            {b.format || 'Code'}: <span className="font-mono">{b.content || b.value}</span>
          </div>
        ))}
        {ticket.printRequired ? <div className="badge bg-amber-100 text-amber-800 text-xs">must be printed</div> : null}
        {ticket.localFees ? (
          <div className="text-xs text-amber-700 mt-1">Local fees: {formatUsdText(ticket.localFees)}</div>
        ) : null}
      </div>
      <a
        className="btn-secondary shrink-0"
        target="_blank"
        rel="noreferrer"
        href={`/api/livn/tickets/${ticket.id}/pdf`}
      >
        PDF
      </a>
    </div>
  );
}
