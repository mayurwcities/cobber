'use client';

// Shared +/- stepper used across the checkout (fare selector, add-ons,
// passenger count). One canonical control so qty inputs all look and behave
// the same — no native browser arrow controls anywhere in checkout.
export default function QtyStepper({ qty, min = 0, max = 99, step = 1, onChange }) {
  const dec = () => onChange(Math.max(min, qty - step));
  const inc = () => onChange(Math.min(max, qty + step));
  return (
    <div className="inline-flex rounded-md ring-1 ring-slate-200 overflow-hidden">
      <button type="button" onClick={dec} disabled={qty <= min} className="px-2 py-1 bg-white disabled:opacity-40">–</button>
      <span className="px-3 py-1 bg-slate-50 min-w-[40px] text-center text-sm tabular-nums">{qty}</span>
      <button type="button" onClick={inc} disabled={qty >= max} className="px-2 py-1 bg-white disabled:opacity-40">+</button>
    </div>
  );
}
