'use client';
import { useMoney } from '@/components/MoneyProvider';
import QtyStepper from '@/components/QtyStepper';

// Render the fareDetails tree and let the user pick quantities per fare.
// selections is { [uuid]: quantity }
// addOns is { [uuid]: quantity }

export default function FareSelector({ fareDetails, selections, onChange, addOns, onAddOnChange, markup = 0 }) {
  const { formatUsd } = useMoney();
  if (!fareDetails) return null;
  const baseVariants = fareDetails.baseVariants || [];

  function setQty(uuid, qty) {
    // Use functional updater to avoid stale-closure loss when multiple
    // +/- clicks land in the same React batch.
    onChange((prev) => {
      const next = { ...(prev || {}) };
      if (qty <= 0) delete next[uuid];
      else next[uuid] = qty;
      return next;
    });
  }
  function setAddOnQty(uuid, qty) {
    if (!onAddOnChange) return;
    onAddOnChange((prev) => {
      const next = { ...(prev || {}) };
      if (qty <= 0) delete next[uuid];
      else next[uuid] = qty;
      return next;
    });
  }

  const subtotal = computeSubtotal({ fareDetails, selections, addOnSelections: addOns, markup });

  return (
    <div className="space-y-6">
      {baseVariants.map((bv, bi) => (
        <div key={bv.uuid || bi} className="card p-4">
          <div className="flex justify-between items-start">
            <h3 className="font-semibold">{bv.name || `Variant ${bi + 1}`}</h3>
            {bv.available === false ? <span className="badge bg-red-100 text-red-700">Unavailable</span> : null}
          </div>
          {bv.description ? <p className="text-sm text-slate-600 mt-1">{bv.description}</p> : null}

          <AddOnList addOns={bv.addOns} selections={addOns} onChange={setAddOnQty} markup={markup} />

          <div className="space-y-4 mt-3">
            {(bv.timeSlots || []).map((ts, ti) => (
              <div key={ts.uuid || ti} className="rounded border border-slate-200 p-3">
                <div className="flex justify-between items-center">
                  <div className="font-medium">{ts.name || ts.timeSlot || `Time slot ${ti + 1}`}</div>
                  {ts.available === false ? <span className="badge bg-red-100 text-red-700">Unavailable</span> : null}
                </div>

                <AddOnList addOns={ts.addOns} selections={addOns} onChange={setAddOnQty} markup={markup} />

                <div className="divide-y divide-slate-100 mt-2">
                  {(ts.fares || []).map((f) => (
                    <FareRow
                      key={f.uuid}
                      fare={f}
                      qty={selections[f.uuid] || 0}
                      onQty={(q) => setQty(f.uuid, q)}
                      addOns={addOns}
                      onAddOnQty={setAddOnQty}
                      markup={markup}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {subtotal ? (
        <div className="flex items-center justify-between p-3 bg-brand-50 rounded-md">
          <div className="font-semibold">Subtotal</div>
          <div className="text-lg font-bold text-brand-700 tabular-nums">{formatUsd(subtotal)}</div>
        </div>
      ) : null}
    </div>
  );
}

// Net-rate products carry a supplier price that the merchant marks up before
// charging the customer. `markup` is a fraction (e.g. 0.20 for 20%) — applied
// uniformly here so display, subtotal, and downstream charge all agree.
function lineTotal(price, qty, markup = 0) {
  const a = Number(price?.amount);
  if (!Number.isFinite(a) || !qty) return null;
  return { amount: a * qty * (1 + markup), currency: price.currency || 'USD' };
}

// Live client-side subtotal across selected fares + every add-on tier in the
// fareDetails tree. Server returns the authoritative price in step.finalQuote
// after submit; this is just an instant running total so qty changes don't
// feel disconnected from the price.
function computeSubtotal({ fareDetails, selections, addOnSelections, markup = 0 }) {
  if (!fareDetails) return null;
  let amount = 0;
  let currency = null;

  function add(price, qty) {
    const a = Number(price?.amount);
    if (!Number.isFinite(a) || !qty) return;
    amount += a * qty;
    currency = currency || price.currency;
  }
  function walkAddOns(list) {
    (list || []).forEach((a) => add(a.price, (addOnSelections || {})[a.uuid] || 0));
  }

  (fareDetails.baseVariants || []).forEach((bv) => {
    walkAddOns(bv.addOns);
    (bv.timeSlots || []).forEach((ts) => {
      walkAddOns(ts.addOns);
      (ts.fares || []).forEach((f) => {
        const qty = (selections || {})[f.uuid] || 0;
        add(f.price, qty);
        walkAddOns(f.addOns);
      });
    });
  });

  if (amount <= 0) return null;
  return { amount: amount * (1 + markup), currency: currency || 'USD' };
}

function FareRow({ fare, qty, onQty, addOns, onAddOnQty, markup = 0 }) {
  const { formatUsd, formatUsdText } = useMoney();
  // Honor every constraint Livn may send:
  // - unitsAvailable (supplier stock)
  // - unitsMin        (floor per booking)
  // - unitsMax        (ceiling per booking)
  // - unitsMultipleOf (e.g. twin rooms must be in pairs)
  const max = Math.min(fare.unitsAvailable ?? 99, fare.unitsMax ?? 99);
  const min = fare.unitsMin ?? 0;
  const step = fare.unitsMultipleOf ?? 1;

  const fareAddOns = Array.isArray(fare.addOns) ? fare.addOns : [];

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium truncate">{fare.name}</div>
          <div className="text-xs text-slate-500 flex gap-2 flex-wrap">
            {fare.ageMin != null ? <span>age {fare.ageMin}{fare.ageMax ? '–' + fare.ageMax : '+'}</span> : null}
            {fare.unitsAvailable != null && fare.unitsAvailable < 100 ? <span>{fare.unitsAvailable} available</span> : null}
            {step > 1 ? <span>multiples of {step}</span> : null}
            {min > 0 ? <span>min {min}</span> : null}
            {fare.unitsMax ? <span>max {fare.unitsMax}</span> : null}
          </div>
          {fare.specialNotes ? (
            <div className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">
              {formatUsdText(fare.specialNotes)}
            </div>
          ) : null}
          {fare.otherCharges ? (
            <div className="mt-1 text-xs text-amber-700 whitespace-pre-wrap">
              ⓘ {formatUsdText(fare.otherCharges)}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-sm font-semibold text-brand-700 tabular-nums min-w-[90px] text-right">
            {formatUsd(lineTotal(fare.price, Math.max(qty, 1), markup))}
          </div>
          <QtyStepper qty={qty} min={0} max={max} step={step} onChange={onQty} />
        </div>
      </div>

      {fareAddOns.length > 0 && qty > 0 ? (
        <div className="mt-2 ml-4 border-l-2 border-brand-100 pl-3 space-y-1">
          {fareAddOns.map((a) => {
            const aqty = (addOns || {})[a.uuid] || 0;
            const amax = a.unitsLinkedToParent ? qty : (a.unitsAvailable ?? 99);
            return (
              <div key={a.uuid} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{a.name}</span>
                  {a.description ? <span className="text-slate-500"> — {a.description}</span> : null}
                  {a.unitsLinkedToParent ? <span className="ml-1 badge bg-slate-100 text-slate-600 text-[10px]">per fare</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 tabular-nums">
                    {formatUsd(lineTotal(a.price, Math.max(aqty, 1), markup))}
                  </span>
                  <QtyStepper
                    qty={aqty}
                    min={0}
                    max={amax}
                    onChange={(q) => onAddOnQty(a.uuid, q)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AddOnList({ addOns, selections, onChange, markup = 0 }) {
  const { formatUsd } = useMoney();
  if (!Array.isArray(addOns) || addOns.length === 0) return null;
  return (
    <div className="mt-2 border-l-2 border-brand-100 pl-3 space-y-1">
      {addOns.map((a) => {
        const qty = (selections || {})[a.uuid] || 0;
        const max = a.unitsAvailable ?? 99;
        return (
          <div key={a.uuid} className="flex items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium">{a.name}</span>
              {a.description ? <span className="text-slate-500"> — {a.description}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 tabular-nums">
                {formatUsd(lineTotal(a.price, Math.max(qty, 1), markup))}
              </span>
              <QtyStepper
                qty={qty}
                min={0}
                max={max}
                onChange={(q) => onChange(a.uuid, q)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
