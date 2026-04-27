'use client';
import { pickTotal, applyMarkup } from '@/lib/api';
import { useMoney } from '@/components/MoneyProvider';

/**
 * Render a Livn quote. Based on live API shape:
 *   {
 *     lineItems: [ { title, type, quantity, grossPerUnit, grossTotal,
 *                    netPerUnit, netTotal, commissionTotal,
 *                    salesComputationDetails:{ resSuppliedPriceIsNetRate } } ],
 *     grossTotal:  { amount, currency },
 *     netTotal:    { amount, currency },
 *     commissionTotal: { amount, currency },
 *     contractCommTotal: { amount, currency },
 *     resSuppliedCommTotal: { amount, currency },
 *     localFees: "20.0 AUD National park levy...",
 *     cancellationPolicy: { setAtTimeOfBooking, text },
 *     generalTerms: "..."
 *   }
 */
export default function QuoteView({ quote, markup = 0 }) {
  const { formatUsd, formatUsdText } = useMoney();
  if (!quote) return null;
  const items = quote.lineItems || quote.items || [];

  // Cert: "You as the seller are responsible for applying the appropriate
  // markup to prices supplied as net amounts (as indicated by the Boolean
  // value of every quote.lineItem.salesComputationDetails.resSuppliedPriceIsNetRate)."
  // We mark up only the line items flagged as net, then recompute the total
  // from the marked-up subtotals so a Hybrid quote (gross + net items mixed)
  // doesn't get double-marked or under-marked.
  const lineMarkup = (li) => (
    li?.salesComputationDetails?.resSuppliedPriceIsNetRate ? markup : 0
  );

  const computedTotalAmount = items.reduce((sum, li) => {
    const sub = applyMarkup(li.grossTotal || li.totalPrice || li.price, lineMarkup(li));
    const a = Number(sub?.amount);
    return Number.isFinite(a) ? sum + a : sum;
  }, 0);
  const rawTotal = pickTotal(quote);
  const total = items.length && computedTotalAmount > 0 && rawTotal
    ? { ...rawTotal, amount: computedTotalAmount }
    : applyMarkup(rawTotal, markup);

  return (
    <div className="space-y-3">
      <div className="divide-y divide-slate-100 border border-slate-200 rounded-md overflow-hidden">
        {items.map((li, i) => {
          const m = lineMarkup(li);
          const unit = applyMarkup(li.grossPerUnit || li.price, m);
          const subtotal = applyMarkup(li.grossTotal || li.totalPrice || li.price, m);
          const qty = li.quantity ?? 1;
          const isSurcharge = (li.type || '').toUpperCase() === 'SURCHARGE' || (li.type || '').toUpperCase() === 'FEE';
          return (
            <div key={i} className="flex items-center justify-between p-3 bg-white gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{li.title || li.description || li.name || 'Item'}</div>
                <div className="text-xs text-slate-500 flex gap-2 flex-wrap mt-0.5">
                  {li.type ? <span className="badge bg-slate-100 text-slate-700">{li.type}</span> : null}
                  {qty > 1 ? <span>× {qty}</span> : null}
                  {unit && qty > 1 ? <span>@ {formatUsd(unit)}</span> : null}
                  {li?.salesComputationDetails?.resSuppliedPriceIsNetRate ? (
                    <span className="badge bg-amber-100 text-amber-800">net rate</span>
                  ) : null}
                  {isSurcharge ? <span className="text-amber-700">surcharge</span> : null}
                </div>
              </div>
              <div className="text-right font-semibold tabular-nums shrink-0">
                {formatUsd(subtotal)}
              </div>
            </div>
          );
        })}
        {items.length === 0 ? (
          <div className="p-3 text-sm text-slate-500">No line items.</div>
        ) : null}
      </div>

      {total ? (
        <div className="flex items-center justify-between p-3 bg-brand-50 rounded-md">
          <div>
            <div className="font-semibold">Total</div>
            {quote.netTotal && quote.grossTotal && quote.netTotal.amount !== quote.grossTotal.amount ? (
              <div className="text-xs text-slate-500">
                Net: {formatUsd(applyMarkup(quote.netTotal, markup))} · Commission: {formatUsd(applyMarkup(quote.commissionTotal || quote.contractCommTotal, markup))}
              </div>
            ) : null}
          </div>
          <div className="text-xl font-bold text-brand-700 tabular-nums">{formatUsd(total)}</div>
        </div>
      ) : null}

      {quote.localFees ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="font-medium text-amber-900">Payable locally</div>
          <div className="text-amber-800 text-xs mt-0.5 whitespace-pre-wrap">{formatUsdText(quote.localFees)}</div>
        </div>
      ) : null}

      {quote.cancellationPolicy?.text ? (
        <details className="text-sm">
          <summary className="cursor-pointer select-none text-slate-700 font-medium">
            Cancellation policy
            {quote.cancellationPolicy.setAtTimeOfBooking ? (
              <span className="badge bg-slate-100 text-slate-700 ml-2">set at booking</span>
            ) : null}
          </summary>
          <div className="whitespace-pre-wrap mt-1 text-slate-700 text-sm">
            {formatUsdText(quote.cancellationPolicy.text)}
          </div>
        </details>
      ) : null}

      {quote.generalTerms || quote.termsAndConditions ? (
        <details className="text-sm">
          <summary className="cursor-pointer select-none text-slate-700 font-medium">
            Terms &amp; conditions
          </summary>
          <div className="whitespace-pre-wrap mt-1 text-slate-700 text-sm">
            {formatUsdText(quote.generalTerms || quote.termsAndConditions)}
          </div>
        </details>
      ) : null}
    </div>
  );
}

