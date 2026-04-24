'use client';
import { useMoney } from '@/components/MoneyProvider';

// Render the fareDetails tree and let the user pick quantities per fare.
// selections is { [uuid]: quantity }
// addOns is { [uuid]: quantity }

export default function FareSelector({ fareDetails, selections, onChange, addOns, onAddOnChange }) {
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

  return (
    <div className="space-y-6">
      {baseVariants.map((bv, bi) => (
        <div key={bv.uuid || bi} className="card p-4">
          <div className="flex justify-between items-start">
            <h3 className="font-semibold">{bv.name || `Variant ${bi + 1}`}</h3>
            {bv.available === false ? <span className="badge bg-red-100 text-red-700">Unavailable</span> : null}
          </div>
          {bv.description ? <p className="text-sm text-slate-600 mt-1">{bv.description}</p> : null}

          <AddOnList addOns={bv.addOns} selections={addOns} onChange={setAddOnQty} />

          <div className="space-y-4 mt-3">
            {(bv.timeSlots || []).map((ts, ti) => (
              <div key={ts.uuid || ti} className="rounded border border-slate-200 p-3">
                <div className="flex justify-between items-center">
                  <div className="font-medium">{ts.name || ts.timeSlot || `Time slot ${ti + 1}`}</div>
                  {ts.available === false ? <span className="badge bg-red-100 text-red-700">Unavailable</span> : null}
                </div>

                <AddOnList addOns={ts.addOns} selections={addOns} onChange={setAddOnQty} />

                <div className="divide-y divide-slate-100 mt-2">
                  {(ts.fares || []).map((f) => (
                    <FareRow
                      key={f.uuid}
                      fare={f}
                      qty={selections[f.uuid] || 0}
                      onQty={(q) => setQty(f.uuid, q)}
                      addOns={addOns}
                      onAddOnQty={setAddOnQty}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FareRow({ fare, qty, onQty, addOns, onAddOnQty }) {
  const { formatUsd, formatUsdText } = useMoney();
  // Honor every constraint Livn may send:
  // - unitsAvailable (supplier stock)
  // - unitsMin        (floor per booking)
  // - unitsMax        (ceiling per booking)
  // - unitsMultipleOf (e.g. twin rooms must be in pairs)
  const max = Math.min(fare.unitsAvailable ?? 99, fare.unitsMax ?? 99);
  const min = fare.unitsMin ?? 0;
  const step = fare.unitsMultipleOf ?? 1;

  const dec = () => onQty(Math.max(0, qty - step));
  const inc = () => onQty(Math.min(max, qty + step));

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
          {fare.otherCharges ? (
            <div className="mt-1 text-xs text-amber-700 whitespace-pre-wrap">
              ⓘ {formatUsdText(fare.otherCharges)}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-sm font-semibold text-brand-700 tabular-nums min-w-[90px] text-right">
            {formatUsd(fare.price)}
          </div>
          <div className="inline-flex rounded-md ring-1 ring-slate-200 overflow-hidden">
            <button type="button" onClick={dec} disabled={qty <= 0} className="px-2 py-1 bg-white disabled:opacity-40">–</button>
            <span className="px-3 py-1 bg-slate-50 min-w-[40px] text-center text-sm tabular-nums">{qty}</span>
            <button type="button" onClick={inc} disabled={qty >= max} className="px-2 py-1 bg-white disabled:opacity-40">+</button>
          </div>
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
                    {formatUsd(a.price)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={amax}
                    value={aqty}
                    onChange={(e) => onAddOnQty(a.uuid, Math.max(0, Math.min(amax, Number(e.target.value) || 0)))}
                    className="input w-16 py-1 text-center"
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

function AddOnList({ addOns, selections, onChange }) {
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
                {formatUsd(a.price)}
              </span>
              <input
                type="number"
                min={0}
                max={max}
                value={qty}
                onChange={(e) => onChange(a.uuid, Number(e.target.value) || 0)}
                className="input w-16 py-1 text-center"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
