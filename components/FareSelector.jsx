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
    <div className="space-y-8">
      {baseVariants.map((bv, bi) => (
        <VariantBlock
          key={bv.uuid || bi}
          variant={bv}
          index={bi}
          selections={selections}
          addOns={addOns}
          setQty={setQty}
          setAddOnQty={setAddOnQty}
          markup={markup}
        />
      ))}

      {subtotal ? (
        <div className="sticky bottom-2 flex items-center justify-between p-4 bg-brand-700 text-white rounded-lg shadow-lg">
          <div className="font-semibold text-sm uppercase tracking-wide opacity-90">Running total</div>
          <div className="text-2xl font-bold tabular-nums">{formatUsd(subtotal)}</div>
        </div>
      ) : null}
    </div>
  );
}

function VariantBlock({ variant: bv, index, selections, addOns, setQty, setAddOnQty, markup }) {
  const timeSlots = bv.timeSlots || [];
  const unavailable = bv.available === false;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <header className="px-5 py-4 bg-gradient-to-r from-brand-50 to-white border-b border-slate-200">
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold text-brand-700 uppercase tracking-wider">
              Option {index + 1}
            </div>
            <h3 className="font-semibold text-lg leading-tight mt-0.5">
              {bv.name || `Variant ${index + 1}`}
            </h3>
          </div>
          {unavailable ? (
            <span className="badge bg-red-100 text-red-700 shrink-0">Unavailable</span>
          ) : null}
        </div>
        {bv.description ? (
          <p className="text-sm text-slate-600 mt-2">{bv.description}</p>
        ) : null}
      </header>

      <div className="p-5 space-y-6">
        <ExtrasSection
          label="Optional extras for this option"
          addOns={bv.addOns}
          selections={addOns}
          onChange={setAddOnQty}
          markup={markup}
        />

        <div>
          <SectionLabel>
            {timeSlots.length > 1 ? 'Available time slots' : 'Time slot'}
          </SectionLabel>
          <div className="mt-3 space-y-5">
            {timeSlots.map((ts, ti) => (
              <TimeSlotBlock
                key={ts.uuid || ti}
                slot={ts}
                index={ti}
                selections={selections}
                addOns={addOns}
                setQty={setQty}
                setAddOnQty={setAddOnQty}
                markup={markup}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TimeSlotBlock({ slot: ts, index, selections, addOns, setQty, setAddOnQty, markup }) {
  const fares = ts.fares || [];
  const unavailable = ts.available === false;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/40">
      <div className="flex justify-between items-center px-4 py-3 border-b border-slate-200 bg-white rounded-t-lg">
        <div className="flex items-center gap-2">
          <ClockIcon />
          <span className="font-medium text-slate-800">
            {ts.name || ts.timeSlot || `Time slot ${index + 1}`}
          </span>
        </div>
        {unavailable ? <span className="badge bg-red-100 text-red-700">Unavailable</span> : null}
      </div>

      <div className="p-4 space-y-5">
        <ExtrasSection
          label="Optional extras for this time slot"
          addOns={ts.addOns}
          selections={addOns}
          onChange={setAddOnQty}
          markup={markup}
          tone="white"
        />

        <div>
          <SectionLabel>
            <span className="inline-flex items-center gap-1.5">
              <TicketIcon /> Choose your tickets
            </span>
          </SectionLabel>
          <div className="mt-3 space-y-3">
            {fares.map((f) => (
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
      </div>
    </div>
  );
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
  const selected = qty > 0;

  return (
    <div
      className={
        'rounded-lg border bg-white transition-colors ' +
        (selected ? 'border-brand-300 ring-1 ring-brand-200' : 'border-slate-200')
      }
    >
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">{fare.name}</span>
            {selected ? (
              <span className="badge bg-brand-100 text-brand-800">{qty} selected</span>
            ) : null}
          </div>
          <div className="flex gap-1.5 flex-wrap mt-2">
            {fare.ageMin != null ? (
              <FareChip icon={<UserIcon />} tone="slate">
                Age {fare.ageMin}{fare.ageMax ? '–' + fare.ageMax : '+'}
              </FareChip>
            ) : null}
            {fare.unitsAvailable != null ? (
              <FareChip
                icon={<StockIcon />}
                tone={fare.unitsAvailable <= 5 ? 'red' : fare.unitsAvailable <= 20 ? 'amber' : 'emerald'}
              >
                {fare.unitsAvailable <= 5
                  ? `Only ${fare.unitsAvailable} left`
                  : `${fare.unitsAvailable} available`}
              </FareChip>
            ) : null}
            {step > 1 ? (
              <FareChip icon={<MultiplesIcon />} tone="indigo">
                Sold in pairs of {step}
              </FareChip>
            ) : null}
            {min > 0 ? (
              <FareChip icon={<DownIcon />} tone="amber">
                Min {min}
              </FareChip>
            ) : null}
            {fare.unitsMax ? (
              <FareChip icon={<UpIcon />} tone="amber">
                Max {fare.unitsMax} per booking
              </FareChip>
            ) : null}
          </div>
          {fare.specialNotes ? (
            <div className="mt-2 text-xs text-slate-600 whitespace-pre-wrap">
              {formatUsdText(fare.specialNotes)}
            </div>
          ) : null}
          {fare.otherCharges ? (
            <div className="mt-2 inline-flex items-start gap-1.5 max-w-full rounded-md bg-amber-50 ring-1 ring-amber-200 px-2.5 py-1.5 text-xs text-amber-800">
              <span aria-hidden className="mt-px">ⓘ</span>
              <span className="whitespace-pre-wrap">{formatUsdText(fare.otherCharges)}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-base font-semibold text-brand-700 tabular-nums">
            {formatUsd(lineTotal(fare.price, Math.max(qty, 1), markup))}
          </div>
          <QtyStepper qty={qty} min={0} max={max} step={step} onChange={onQty} />
        </div>
      </div>

      {fareAddOns.length > 0 && qty > 0 ? (
        <div className="border-t border-slate-200 bg-slate-50/60 rounded-b-lg p-4">
          <SectionLabel small>Upgrades for this ticket</SectionLabel>
          <div className="mt-2 space-y-2">
            {fareAddOns.map((a) => {
              const aqty = (addOns || {})[a.uuid] || 0;
              const amax = a.unitsLinkedToParent ? qty : (a.unitsAvailable ?? 99);
              return (
                <div key={a.uuid} className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium text-slate-800">
                      {a.name}
                      {a.unitsLinkedToParent ? (
                        <span className="ml-2 badge bg-slate-200 text-slate-700 text-[10px]">per ticket</span>
                      ) : null}
                    </div>
                    {a.description ? (
                      <div className="text-xs text-slate-500 mt-0.5">{a.description}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm text-slate-700 tabular-nums">
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
        </div>
      ) : null}
    </div>
  );
}

// Reusable add-on group shown at variant or time-slot level. Wraps the rows
// in a clearly labelled card so users see WHICH context the add-ons apply to
// (cert product 1 has add-ons at three different levels — easy to confuse).
function ExtrasSection({ label, addOns, selections, onChange, markup = 0, tone = 'tinted' }) {
  const { formatUsd } = useMoney();
  if (!Array.isArray(addOns) || addOns.length === 0) return null;
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className={
        'mt-2 rounded-lg border border-slate-200 ' +
        (tone === 'white' ? 'bg-white' : 'bg-slate-50/50') +
        ' divide-y divide-slate-200'
      }>
        {addOns.map((a) => {
          const qty = (selections || {})[a.uuid] || 0;
          const max = a.unitsAvailable ?? 99;
          return (
            <div key={a.uuid} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0 text-sm flex-1">
                <div className="font-medium text-slate-800">{a.name}</div>
                {a.description ? (
                  <div className="text-xs text-slate-500 mt-0.5">{a.description}</div>
                ) : null}
              </div>
              {/* Price above stepper, same vertical layout as the fare rows. */}
              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="text-sm font-semibold text-brand-700 tabular-nums">
                  {formatUsd(lineTotal(a.price, Math.max(qty, 1), markup))}
                </div>
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
    </div>
  );
}

function SectionLabel({ children, small }) {
  return (
    <div className={
      'font-semibold text-slate-700 tracking-wide uppercase ' +
      (small ? 'text-[10px]' : 'text-xs')
    }>
      {children}
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

// Icon-pill used under fare names to surface eligibility / availability /
// constraint info. Tones are picked to give each kind of information its own
// visual signature so the user can scan the row at a glance:
//   slate  — neutral demographic info (age range)
//   emerald/amber/red — availability stock (green plenty, amber limited, red tight)
//   indigo — booking-shape constraints (multiples of)
//   amber  — caps/floors that the user must respect (min/max)
function FareChip({ icon, tone = 'slate', children }) {
  const palette = {
    slate:   'bg-slate-100 text-slate-700 ring-slate-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber:   'bg-amber-50 text-amber-800 ring-amber-200',
    red:     'bg-red-50 text-red-700 ring-red-200',
    indigo:  'bg-indigo-50 text-indigo-700 ring-indigo-200',
  }[tone] || 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <span className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ' + palette}>
      {icon}
      <span>{children}</span>
    </span>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="text-slate-500">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="text-slate-500">
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 7v10" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2 2" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M4 21a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 7l9-4 9 4-9 4-9-4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M3 12l9 4 9-4M3 17l9 4 9-4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function MultiplesIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="13" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="13" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function DownIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14m0 0-5-5m5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UpIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 19V5m0 0-5 5m5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
