'use client';
import { useMemo, useState } from 'react';
import { useMoney } from '@/components/MoneyProvider';
import { applyMarkup } from '@/lib/api';

/**
 * Calendar date picker tuned for Livn's /departures endpoint.
 *
 * Props:
 *   value            selected YYYY-MM-DD (string) or ''
 *   onChange(iso)    called with the selected date string
 *   departures       [{ date, fromPrices: [{amount, currency}] }] — from
 *                    /api/v1/products/{id}/departures. Dates NOT present in
 *                    this list are rendered disabled.
 *   loading          boolean — show a skeleton
 *   minDate          YYYY-MM-DD. Defaults to "today" (blocks past dates)
 *   maxDate          YYYY-MM-DD (optional upper bound)
 */
export default function DatePicker({
  value,
  onChange,
  departures = [],
  loading = false,
  minDate,
  maxDate,
  // Net-rate markup fraction (0.20 for 20%). When non-zero, every fromPrice
  // we render on the calendar is marked up so the dates the user sees match
  // the ticket / quote prices later in the flow.
  markup = 0,
}) {
  const { formatPriceCompact } = useMoney();
  // ---- normalise departures into a Map<iso, fromPrice> ----
  // All fromPrices for a given date represent the same trip in different
  // currencies; since we always display USD, any of them works.
  const priceByDate = useMemo(() => {
    const m = new Map();
    for (const d of departures || []) {
      const iso = typeof d === 'string' ? d : d?.date;
      if (!iso) continue;
      const rawFp = (typeof d === 'object' && Array.isArray(d.fromPrices)) ? d.fromPrices[0] : null;
      m.set(iso, applyMarkup(rawFp, markup));
    }
    return m;
  }, [departures, markup]);

  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()); // strip time
  }, []);

  const min = minDate ? parseISO(minDate) : today;
  const max = maxDate ? parseISO(maxDate) : null;

  // ---- viewport month ----
  const initial = useMemo(() => {
    if (value) {
      const d = parseISO(value);
      if (d) return firstOfMonth(d);
    }
    // if no value, jump to the earliest available date, else today
    const firstAvailable = [...priceByDate.keys()].sort()[0];
    if (firstAvailable) {
      const d = parseISO(firstAvailable);
      if (d) return firstOfMonth(d);
    }
    return firstOfMonth(today);
  }, [value, priceByDate, today]);
  const [viewMonth, setViewMonth] = useState(initial);

  // Navigation — we clamp between earliest available and (12 months from today)
  const availableMonths = useMemo(() => {
    const set = new Set();
    for (const iso of priceByDate.keys()) {
      const d = parseISO(iso);
      if (d) set.add(`${d.getFullYear()}-${d.getMonth()}`);
    }
    return set;
  }, [priceByDate]);

  const prev = () => setViewMonth(addMonths(viewMonth, -1));
  const next = () => setViewMonth(addMonths(viewMonth, +1));

  const weeks = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  if (loading) {
    return <div className="card p-3"><CalendarSkeleton /></div>;
  }

  if (priceByDate.size === 0) {
    return (
      <div className="card p-4 text-sm text-slate-500 text-center">
        No published departures in the 366-day window. The supplier may add
        dates later — try again soon.
      </div>
    );
  }

  return (
    <div className="card p-3 select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          type="button"
          onClick={prev}
          className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"
          aria-label="Previous month"
        >
          <Chevron dir="left" />
        </button>
        <div className="text-sm font-semibold tracking-wide">{monthLabel}</div>
        <button
          type="button"
          onClick={next}
          className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"
          aria-label="Next month"
        >
          <Chevron dir="right" />
        </button>
      </div>

      {/* Weekday row */}
      <div className="grid grid-cols-7 text-[10px] font-medium text-slate-400 px-1 mb-1">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((w) => (
          <div key={w} className="text-center py-1">{w}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {weeks.map((cell, i) => {
          if (!cell) {
            return <div key={'e' + i} />;
          }
          const iso = toIsoDate(cell);
          const inMonth = cell.getMonth() === viewMonth.getMonth();
          const isPast = cell < min;
          const afterMax = max && cell > max;
          const isAvailable = priceByDate.has(iso);
          const fp = priceByDate.get(iso);
          const isSelected = iso === value;
          const isToday = sameDay(cell, today);
          const disabled = !inMonth || isPast || afterMax || !isAvailable;

          const base = 'aspect-square rounded-md flex flex-col items-center justify-center text-xs transition ';
          const cls = disabled
            ? base + 'text-slate-300 cursor-not-allowed bg-slate-50/50 line-through decoration-1'
            : isSelected
              ? base + 'bg-brand-700 text-white font-semibold shadow-brand-glow'
              : base + 'bg-white text-ink-900 hover:bg-brand-50 hover:ring-1 hover:ring-brand-200 cursor-pointer';

          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              onClick={() => onChange && onChange(iso)}
              className={cls}
              aria-pressed={isSelected}
              aria-label={iso + (isAvailable ? '' : ' (unavailable)')}
              title={disabled && inMonth && !isPast ? 'Not operating on this date' : ''}
            >
              <span className={isToday && !isSelected ? 'underline decoration-brand-400 decoration-2 underline-offset-2' : ''}>
                {cell.getDate()}
              </span>
              {fp && !disabled ? (
                <span className={'text-[9px] mt-0.5 tabular-nums ' + (isSelected ? 'text-white/80' : 'text-brand-700')}>
                  {formatPriceCompact(fp)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 px-1 text-[10px] text-ink-500">
        <Dot className="bg-brand-700" /> selected
        <Dot className="bg-white ring-1 ring-slate-200" /> available
        <Dot className="bg-slate-200" /> unavailable
        {priceByDate.size ? (
          <span className="ml-auto">{priceByDate.size} operating date{priceByDate.size === 1 ? '' : 's'}</span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------- helpers ----------------

function Dot({ className = '' }) {
  return <span className={'inline-block w-2 h-2 rounded-full ' + className} />;
}

function Chevron({ dir }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-slate-600">
      {dir === 'left'
        ? <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M9 6l6 6-6 6"  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function CalendarSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex justify-between mb-2">
        <div className="w-6 h-6 bg-slate-200 rounded" />
        <div className="w-24 h-4 bg-slate-200 rounded" />
        <div className="w-6 h-6 bg-slate-200 rounded" />
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 42 }).map((_, i) => (
          <div key={i} className="aspect-square bg-slate-100 rounded-md" />
        ))}
      </div>
    </div>
  );
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function firstOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

/**
 * Return a 6x7 grid of Date objects (or null for leading blanks) that covers
 * the requested month. Monday-first. Leading/trailing days spill into
 * adjacent months so the grid shape is predictable.
 */
function buildMonthGrid(viewMonth) {
  const firstDay = firstOfMonth(viewMonth);
  // Monday=0 ... Sunday=6
  const offset = (firstDay.getDay() + 6) % 7;
  const cells = [];
  // Pad out leading days with the tail of the previous month.
  for (let i = offset; i > 0; i--) {
    cells.push(new Date(firstDay.getFullYear(), firstDay.getMonth(), 1 - i));
  }
  // Fill the real month.
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    cells.push(new Date(y, m, d));
  }
  // Pad to a multiple of 7.
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    cells.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }
  // Always 42 cells (6 weeks) for visual consistency.
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    cells.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }
  return cells;
}

