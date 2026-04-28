'use client';

// Shared +/- stepper used across the checkout (fare selector, add-ons,
// passenger count). One canonical control so qty inputs all look and behave
// the same — no native browser arrow controls anywhere in checkout.
//
// Step-awareness rules (so unitsMultipleOf is never violated):
//   - "+" only fires when qty + step <= max. Without this guard, a partial
//     slot (e.g. remainingCap = 1 with step = 2) would let inc settle on
//     qty + 1 — producing an invalid, off-step quantity.
//   - "-" only fires when qty - step >= min, with one exception: if qty is
//     already a single step above 0 (i.e. qty === step) and min is 0, we
//     allow dec all the way to 0 to clear the row entirely. Otherwise we
//     keep dec disabled to avoid leaving an off-step value.
export default function QtyStepper({ qty, min = 0, max = 99, step = 1, onChange }) {
  const canDec = qty - step >= min;
  const canInc = qty + step <= max;
  const dec = () => { if (canDec) onChange(qty - step); };
  const inc = () => { if (canInc) onChange(qty + step); };
  return (
    <div className="inline-flex rounded-md ring-1 ring-slate-200 overflow-hidden">
      <button type="button" onClick={dec} disabled={!canDec} className="px-2 py-1 bg-white disabled:opacity-40">–</button>
      <span className="px-3 py-1 bg-slate-50 min-w-[40px] text-center text-sm tabular-nums">{qty}</span>
      <button type="button" onClick={inc} disabled={!canInc} className="px-2 py-1 bg-white disabled:opacity-40">+</button>
    </div>
  );
}
