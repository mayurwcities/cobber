'use client';
import { useMoney } from '@/components/MoneyProvider';
import QtyStepper from '@/components/QtyStepper';

// Render the fareDetails tree and let the user pick quantities per fare.
// selections is { [uuid]: quantity }
// addOns is { [uuid]: quantity }

export default function FareSelector({ fareDetails, selections, onChange, addOns, onAddOnChange, markup = 0, paxCap = null }) {
  const { formatUsd } = useMoney();
  if (!fareDetails) return null;
  const baseVariants = fareDetails.baseVariants || [];
  // Sum of fare quantities across every variant/timeslot. Used to:
  //   - Cap each FareRow's "+" so total can't exceed paxCap.
  //   - Show "N of M travellers selected" progress when paxCap is set.
  const totalSelected = Object.values(selections || {}).reduce(
    (n, v) => n + Number(v || 0), 0
  );
  const remainingCap = paxCap != null ? Math.max(0, paxCap - totalSelected) : null;

  // The user can only pick from ONE base variant in a single booking
  // (Livn rejects multi-variant submits). "Picking" includes any of:
  //   - a fare quantity > 0
  //   - a variant-level add-on quantity > 0 (e.g. "Exclusive package")
  //   - a time-slot-level add-on quantity > 0 (e.g. "Photo + Video")
  //   - a per-fare add-on quantity > 0 (only reachable when a fare is
  //     already selected, but checked for completeness)
  // Identify the active variant by array index because Livn returns
  // baseVariants without a uuid; only the inner fares carry one.
  const activeVariantIndex = baseVariants.findIndex((bv) =>
    variantHasAnySelection(bv, selections, addOns)
  );

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
      {paxCap != null ? (
        <PaxProgressBanner total={totalSelected} cap={paxCap} />
      ) : null}

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
          remainingCap={remainingCap}
          locked={activeVariantIndex !== -1 && bi !== activeVariantIndex}
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

// Tally banner shown above the variant cards when the flow had a PAX_COUNT
// gate. Switches color from amber (incomplete) to emerald (complete) so the
// user can see at a glance whether they've assigned everyone to a fare.
function PaxProgressBanner({ total, cap }) {
  const complete = total === cap;
  const over = total > cap;
  const tone = complete
    ? 'bg-emerald-50 ring-emerald-200 text-emerald-800'
    : over
    ? 'bg-red-50 ring-red-200 text-red-800'
    : 'bg-amber-50 ring-amber-200 text-amber-900';
  const msg = complete
    ? 'All travellers assigned to fares — ready to continue.'
    : over
    ? `You picked ${total} fares but only said ${cap} traveller${cap === 1 ? '' : 's'}. Reduce a quantity.`
    : `Pick fares for ${cap - total} more traveller${(cap - total) === 1 ? '' : 's'} (${total} of ${cap} assigned).`;
  return (
    <div className={'flex items-center justify-between gap-3 rounded-lg ring-1 px-4 py-3 ' + tone}>
      <div className="text-sm font-medium">{msg}</div>
      <div className="text-sm font-bold tabular-nums shrink-0">
        {total} / {cap}
      </div>
    </div>
  );
}

function VariantBlock({ variant: bv, index, selections, addOns, setQty, setAddOnQty, markup, remainingCap, locked = false }) {
  const timeSlots = bv.timeSlots || [];
  const unavailable = bv.available === false;
  const dimmed = locked || unavailable;

  // Same one-active-at-a-time rule as variants, applied per timeslot inside
  // this variant. If the user picked the 06:00 slot, the 10:00 slot in the
  // same variant should lock until they clear those selections — Livn won't
  // accept a fare-selection that spans two time slots either. Includes
  // time-slot add-ons too, so picking just "Photo + Video" without a fare
  // also commits the user to that slot.
  const activeTsIndex = timeSlots.findIndex((ts) =>
    timeSlotHasAnySelection(ts, selections, addOns)
  );

  return (
    <section
      aria-disabled={dimmed || undefined}
      className={
        'rounded-xl border bg-white shadow-sm overflow-hidden transition ' +
        (dimmed
          ? 'border-slate-200 opacity-60 grayscale-[0.2]'
          : 'border-slate-200')
      }
    >
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
          ) : locked ? (
            <span className="badge bg-slate-200 text-slate-700 shrink-0">Locked</span>
          ) : null}
        </div>
        {bv.description ? (
          <p className="text-sm text-slate-600 mt-2">{bv.description}</p>
        ) : null}
      </header>

      {locked ? (
        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-900">
          You've selected fares from another option above. Clear those
          selections first to choose from this one — only one option can be
          booked at a time.
        </div>
      ) : null}

      <div className="p-5 space-y-6">
        <ExtrasSection
          label="Optional extras for this option"
          addOns={bv.addOns}
          selections={addOns}
          onChange={setAddOnQty}
          markup={markup}
          disabled={locked}
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
                remainingCap={remainingCap}
                // A timeslot is locked when either the parent variant is
                // locked OR another timeslot in the same variant has the
                // active selection. The latter only kicks in for products
                // that ship multiple timeslots per variant (e.g. Product 1's
                // 06:00 vs 10:00 within "Standard Tour with Transfer").
                locked={locked || (activeTsIndex !== -1 && ti !== activeTsIndex)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TimeSlotBlock({ slot: ts, index, selections, addOns, setQty, setAddOnQty, markup, remainingCap, locked = false }) {
  const fares = ts.fares || [];
  const unavailable = ts.available === false;
  const dimmed = locked || unavailable;

  return (
    <div
      aria-disabled={dimmed || undefined}
      className={
        'rounded-lg border bg-slate-50/40 transition ' +
        (dimmed ? 'border-slate-200 opacity-60' : 'border-slate-200')
      }
    >
      <div className="flex justify-between items-center px-4 py-3 border-b border-slate-200 bg-white rounded-t-lg">
        <div className="flex items-center gap-2">
          <ClockIcon />
          <span className="font-medium text-slate-800">
            {ts.name || ts.timeSlot || `Time slot ${index + 1}`}
          </span>
        </div>
        {unavailable ? (
          <span className="badge bg-red-100 text-red-700">Unavailable</span>
        ) : locked ? (
          <span className="badge bg-slate-200 text-slate-700">Locked</span>
        ) : null}
      </div>

      {locked ? (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-900">
          Another time slot is currently selected. Clear it to choose this one instead.
        </div>
      ) : null}

      <div className="p-4 space-y-5">
        <ExtrasSection
          label="Optional extras for this time slot"
          addOns={ts.addOns}
          selections={addOns}
          onChange={setAddOnQty}
          markup={markup}
          tone="white"
          disabled={locked}
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
                remainingCap={remainingCap}
                locked={locked}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FareRow({ fare, qty, onQty, addOns, onAddOnQty, markup = 0, remainingCap = null, locked = false }) {
  const { formatUsd, formatUsdText } = useMoney();
  // Honor every constraint Livn may send:
  // - unitsAvailable (supplier stock)
  // - unitsMin        (floor per booking)
  // - unitsMax        (ceiling per booking)
  // - unitsMultipleOf (e.g. twin rooms must be in pairs)
  // Plus the cross-fare PAX_COUNT cap when present: this fare can grow up to
  // its current qty + whatever's left of the cap. When remainingCap is 0
  // (cap reached), max collapses to qty so "+" disables — until the user
  // decreases another fare and frees up a slot.
  // And the cross-variant lock: when another variant has selections, every
  // fare here pegs at qty (which is 0 for unselected variants), preventing
  // any + click — only one variant can have selections at a time.
  let max = Math.min(fare.unitsAvailable ?? 99, fare.unitsMax ?? 99);
  if (remainingCap != null) {
    max = Math.min(max, qty + Math.max(0, remainingCap));
  }
  if (locked) max = qty;
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
function ExtrasSection({ label, addOns, selections, onChange, markup = 0, tone = 'tinted', disabled = false }) {
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
          // When the parent variant is locked, peg max to qty (which is 0
          // for an inactive variant) so the "+" can't fire.
          const max = disabled ? qty : (a.unitsAvailable ?? 99);
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

// Does this time slot have ANY user selection — a fare with qty>0, a
// timeslot-level add-on, or a per-fare nested add-on? Used by both the
// variant-level lock (rolling up) and the per-timeslot lock (direct).
function timeSlotHasAnySelection(ts, selections, addOnSelections) {
  if ((ts?.addOns || []).some((a) => (addOnSelections?.[a.uuid] || 0) > 0)) return true;
  return (ts?.fares || []).some((f) => {
    if ((selections?.[f.uuid] || 0) > 0) return true;
    return (f.addOns || []).some((a) => (addOnSelections?.[a.uuid] || 0) > 0);
  });
}

// Same rollup, one level up — variant-level add-ons OR anything inside
// any of its time slots.
function variantHasAnySelection(bv, selections, addOnSelections) {
  if ((bv?.addOns || []).some((a) => (addOnSelections?.[a.uuid] || 0) > 0)) return true;
  return (bv?.timeSlots || []).some((ts) => timeSlotHasAnySelection(ts, selections, addOnSelections));
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
