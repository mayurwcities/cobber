'use client';
import { useRef, useState } from 'react';
import QtyStepper from '@/components/QtyStepper';
import { useMoney } from '@/components/MoneyProvider';

// Defensive: the exact shape of a question varies by reservation system, so
// we read optional fields with ?. and fall back gracefully.

function getOptions(q) {
  if (Array.isArray(q?.selectOptions?.options)) return q.selectOptions.options;
  if (Array.isArray(q?.selectOptions)) return q.selectOptions;
  if (Array.isArray(q?.options)) return q.options;
  return [];
}

// Livn SelectOption shape from live API:
//   { uuid, title, description?, feeDescription?, fingerprintHash, dnaHash }
// Older mocks / non-UUID systems may use { value, label } — handle both.
function optionValue(o) {
  if (o == null) return '';
  if (typeof o !== 'object') return String(o);
  return o.uuid ?? o.value ?? o.id ?? o.code ?? o.title ?? o.label ?? o.name ?? '';
}
function optionLabel(o) {
  if (o == null) return '';
  if (typeof o !== 'object') return String(o);
  return o.title ?? o.label ?? o.name ?? String(o.value ?? o.id ?? o.uuid ?? '');
}

// <input type="time"> wants "HH:MM" (or "HH:MM:SS" with step < 60). Livn may
// echo back "14:30:00" or "2:30 PM" — normalize both to "HH:MM" so the
// control stays populated on re-render.
function normalizeTime(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  const mil = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (mil) {
    const h = Math.max(0, Math.min(23, Number(mil[1])));
    return `${String(h).padStart(2, '0')}:${mil[2]}`;
  }
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?$/);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (/[Pp]/.test(ampm[3])) h += 12;
    return `${String(h).padStart(2, '0')}:${ampm[2]}`;
  }
  return s;
}

// At this many options, switch SELECT_SINGLE / SELECT_MULTIPLE from card grids
// to a native <select> / scrollable list so the form doesn't blow up on
// pickup-list questions with 20+ options.
const CARD_LIST_THRESHOLD = 8;

// Auto-insert dashes as the user types an ISO date. Strips non-digits,
// caps at 8 digits, then formats as yyyy-MM-dd. Lets users paste full
// "2026-04-28" or just type "20260428" — both end up well-formed.
function maskIsoDate(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return digits.slice(0, 4) + '-' + digits.slice(4);
  return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6);
}

// Today's date as yyyy-MM-dd in the browser's local time zone — used as
// the upper bound for DOB questions.
export function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Is this DATE question asking for a date of birth? Livn marks them with a
// purpose of PAX_DOB / CUSTOMER_DOB etc.; we also catch title/purpose strings
// containing "birth" as a backstop in case the supplier uses a custom code.
export function isDobQuestion(q) {
  if (!q) return false;
  if (String(q.answerType || '').toUpperCase() !== 'DATE') return false;
  const purpose = String(q.purpose || '').toUpperCase();
  if (/DOB\b|BIRTH/.test(purpose)) return true;
  const title = String(q.title || '').toLowerCase();
  return /\bbirth\b|date of birth|dob\b/.test(title);
}

// DOB / date question control. Shows a text input with a yyyy-MM-dd
// placeholder so what the user sees matches Livn's instruction, plus a
// calendar icon button on the right that fires showPicker() on a hidden
// native <input type="date"> so users still get the click-to-pick UX.
// `maxDate` (yyyy-MM-dd) caps the picker — used to prevent picking future
// dates on DOB questions.
function DateField({ q, value, onChange, common, maxDate }) {
  const pickerRef = useRef(null);
  const isIso = /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  const placeholder = q.example && /^\d{4}-\d{2}-\d{2}$/.test(q.example)
    ? q.example
    : 'yyyy-MM-dd';
  // If the user typed a future date past our maxDate, mark the field invalid
  // visually even before submit so they catch it immediately.
  const exceedsMax = !!(maxDate && isIso && value > maxDate);
  function openPicker() {
    const el = pickerRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch (_) { /* fall through */ }
    }
    el.focus();
    el.click();
  }
  return (
    <div className="space-y-1">
      <div className="relative">
        <input
          {...common}
          type="text"
          inputMode="numeric"
          placeholder={placeholder}
          maxLength={10}
          value={value ?? ''}
          onChange={(e) => onChange(maskIsoDate(e.target.value))}
          required={!!q.required}
          aria-invalid={exceedsMax || undefined}
          className={
            (common.className || 'input') + ' pr-10 ' +
            (exceedsMax ? 'ring-2 ring-red-400 focus:ring-red-500' : '')
          }
        />
        {/* Hidden native date input — drives the calendar popup. Kept in sync
            with the visible text input so picking from the calendar fills in
            the field with a proper yyyy-MM-dd value. The `max` attribute
            disables future dates in the calendar UI for DOB questions. */}
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-hidden
          max={maxDate}
          value={isIso ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="sr-only"
        />
        <button
          type="button"
          onClick={openPicker}
          aria-label="Open calendar"
          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-brand-700"
        >
          <CalendarIcon />
        </button>
      </div>
      {exceedsMax ? (
        <p className="text-xs text-red-600">Date can't be in the future.</p>
      ) : null}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// Return the first argument that's a finite number — used to walk the various
// field names Livn might use for numeric bounds (q.min, q.minValue, q.unitsMin,
// q.numericMin, ...). Returns null if none qualify.
function pickFiniteNumber(...candidates) {
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Livn often embeds numeric constraints in the question description as prose
// ("the passenger count should be a minimum of 1 and a maximum of 10")
// rather than structured fields. Parse common phrasings so the stepper bounds
// match what the customer just read.
function parseRangeFromText(text) {
  if (!text) return { min: null, max: null };
  const t = String(text).toLowerCase();
  let min = null;
  let max = null;
  // "minimum of 1" / "at least 1" / "no fewer than 1" / "min: 1"
  const minMatch = t.match(/(?:minimum(?:\s+of)?|at\s+least|no\s+fewer\s+than|min(?:imum)?[:\s]+)\s*(\d+)/);
  if (minMatch) min = Number(minMatch[1]);
  // "maximum of 10" / "at most 10" / "no more than 10" / "up to 10" / "max: 10"
  const maxMatch = t.match(/(?:maximum(?:\s+of)?|at\s+most|no\s+more\s+than|up\s+to|max(?:imum)?[:\s]+)\s*(\d+)/);
  if (maxMatch) max = Number(maxMatch[1]);
  // "from N to M" / "between N and M" / "N to M" — fill in whichever side
  // we still don't have. Only matches integers so price ranges in prose
  // don't accidentally get treated as bounds.
  if (min == null || max == null) {
    const range = t.match(/(?:from\s+|between\s+)?(\d+)\s+(?:to|-|–|and)\s+(\d+)/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (Number.isFinite(a) && Number.isFinite(b) && a <= b) {
        if (min == null) min = a;
        if (max == null) max = b;
      }
    }
  }
  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
  };
}

// Realistic ranges for unit-typed measurements when Livn doesn't ship any
// bounds (Product 3's Height (cm) / Weight (kg) come back with no valueMin
// or valueMax — without these defaults the API would happily take "1" cm).
// Lookup is by the bracketed unit in the question title.
const UNIT_BOUNDS = {
  cm:    [30, 250],
  cms:   [30, 250],
  m:     [0.3, 2.5],
  metres:[0.3, 2.5],
  meters:[0.3, 2.5],
  in:    [12, 100],
  inch:  [12, 100],
  inches:[12, 100],
  ft:    [1, 10],
  feet:  [1, 10],
  kg:    [1, 300],
  kgs:   [1, 300],
  lb:    [2, 600],
  lbs:   [2, 600],
  pounds:[2, 600],
};

function inferBoundsFromTitle(title) {
  if (!title) return { min: null, max: null };
  const m = String(title).match(/\(([a-zA-Z]+)\)\s*$/);
  if (!m) return { min: null, max: null };
  const range = UNIT_BOUNDS[m[1].toLowerCase()];
  if (!range) return { min: null, max: null };
  return { min: range[0], max: range[1] };
}

// Single source of truth for "what range does this numeric question allow?".
// Used by QuestionRenderer's stepper bounds AND validateStep so the UI and
// the submit-time validator never disagree.
//
// Livn is inconsistent about which field carries the bounds. Examples we've
// seen in the wild:
//   - PAX_COUNT (Product 2):     no structured field; bounds in title prose
//   - Rating (Product 2 hold):   valueMin: "1", valueMax: "5"  (strings!)
//   - Height/Weight (Product 3): no field, no prose — just "Height (cm)"
//   - Other products:            min / max / minimum / maximum
// We try every shape, then prose-parse, then infer from the title's unit
// (so 1cm / 1kg can never be submitted even though Livn's validator allows it).
export function questionNumericBounds(q) {
  const c = q?.constraints || {};
  const nc = q?.numberConstraints || {};
  let min = pickFiniteNumber(
    q?.valueMin, q?.min, q?.minValue, q?.minimum,
    q?.unitsMin, q?.numericMin,
    c.min, c.minimum, nc.min, nc.minimum,
  );
  let max = pickFiniteNumber(
    q?.valueMax, q?.max, q?.maxValue, q?.maximum,
    q?.unitsMax, q?.numericMax,
    c.max, c.maximum, nc.max, nc.maximum,
  );
  if (min == null || max == null) {
    const fromText = parseRangeFromText([q?.description, q?.title].filter(Boolean).join(' '));
    if (min == null) min = fromText.min;
    if (max == null) max = fromText.max;
  }
  if (min == null || max == null) {
    const fromUnit = inferBoundsFromTitle(q?.title);
    if (min == null) min = fromUnit.min;
    if (max == null) max = fromUnit.max;
  }
  return { min, max };
}

export default function QuestionRenderer({ question, value, onChange, answers, setAnswer }) {
  const { formatFeeText } = useMoney();
  const q = question || {};
  const type = String(q.answerType || 'TEXT').toUpperCase();
  const label = q.title || q.purpose || 'Answer';

  const common = { id: `q_${q.uuid}`, className: 'input' };

  // Some Livn questions (e.g. Salzburg's "are you a frequent flyer?") attach
  // a follow-up questionGroup to the YES option. When that option is picked,
  // those follow-up questions need to render inline AND have their answers
  // captured. We need the parent's answers map + setter for that — pass them
  // through QuestionRenderer's props so the SELECT_SINGLE branch below can
  // recurse without the parent having to know which questions branch.
  const canRecurse = !!(answers && setAnswer);

  let control = null;
  let fullWidth = false;
  switch (type) {
    case 'TEXT':
    case 'STRING': {
      // Honor q.lengthMax / q.maxLength as a hard input cap so the user
      // can't type past it. When the regex matches digit-only patterns
      // (e.g. Salzburg's frequent flyer "\d{10}"), flip the keyboard to
      // numeric and strip non-digit characters on the way in.
      const maxLen = pickFiniteNumber(q.lengthMax, q.maxLength);
      // Matches whole-string digit-only regexes: \d, \d+, \d{10}, \d{1,5},
      // [0-9], [0-9]{10}, etc., with optional ^ / $ anchors.
      const digitsOnly = q.regex
        ? /^\^?(?:\\d|\[0-9\])(?:[+*?]|\{\d+(?:,\d*)?\})?\$?$/.test(String(q.regex))
        : false;
      control = (
        <input
          {...common}
          type="text"
          inputMode={digitsOnly ? 'numeric' : undefined}
          pattern={digitsOnly ? '[0-9]*' : undefined}
          maxLength={maxLen != null ? maxLen : undefined}
          placeholder={q.example || ''}
          value={value ?? ''}
          onChange={(e) => {
            let v = e.target.value;
            if (digitsOnly) v = v.replace(/\D+/g, '');
            if (maxLen != null) v = v.slice(0, maxLen);
            onChange(v);
          }}
          required={!!q.required}
        />
      );
      break;
    }
    case 'EMAIL':
      control = (
        <IconInput
          {...common}
          type="email"
          placeholder={q.example || 'you@example.com'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={!!q.required}
          icon={<MailIcon />}
        />
      );
      break;
    case 'PHONE':
      control = (
        <IconInput
          {...common}
          type="tel"
          placeholder={q.example || '+61 491570156'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={!!q.required}
          icon={<PhoneIcon />}
        />
      );
      break;
    case 'DATE':
      // Livn's instruction reads "Please answer in yyyy-MM-dd format" but a
      // native <input type="date"> shows the browser's locale-specific
      // placeholder (dd/mm/yyyy on AU/UK, mm/dd/yyyy on US). DateField gives
      // us both: a text input with an explicit yyyy-MM-dd placeholder for
      // typing AND a calendar icon button that opens the native picker.
      // DOB-purpose questions get a max=today cap so future dates can't
      // be selected from the calendar; validateStep mirrors the same rule.
      control = (
        <DateField
          q={q}
          value={value}
          onChange={onChange}
          common={common}
          maxDate={isDobQuestion(q) ? todayIso() : undefined}
        />
      );
      break;
    case 'TIME':
      control = (
        <input
          {...common}
          type="time"
          step="60"
          placeholder={q.example || 'HH:MM'}
          value={normalizeTime(value)}
          onChange={(e) => onChange(e.target.value)}
          required={!!q.required}
        />
      );
      break;
    case 'DATETIME':
    case 'TIMESTAMP':
      control = (
        <input
          {...common}
          type="datetime-local"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={!!q.required}
        />
      );
      break;
    case 'NUMBER':
    case 'INTEGER': {
      // Bounds come from questionNumericBounds(), which checks every Livn
      // shape (valueMin/valueMax, min/max, unitsMin/unitsMax, …) and falls
      // back to parsing them from the title/description prose.
      const { min: lo, max: hi } = questionNumericBounds(q);
      const hasBounds = lo != null && hi != null;
      const minVal = lo != null ? lo : 0;
      const maxVal = hi != null ? hi : 99;
      const raw = Number(value);
      const inRange = Number.isFinite(raw) && raw >= minVal && raw <= maxVal;
      // Stepper for big ranges, rating buttons for tight ranges (≤ 10
      // selectable values) — the latter renders a "1 2 3 4 5"-style row
      // that immediately reads as a rating control.
      const span = hasBounds ? (hi - lo + 1) : 0;
      const useRatingButtons = type === 'INTEGER' && hasBounds && span >= 2 && span <= 10;
      if (useRatingButtons) {
        const buttons = [];
        for (let n = lo; n <= hi; n++) buttons.push(n);
        control = (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-2">
              {buttons.map((n) => {
                const sel = inRange && raw === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChange(String(n))}
                    className={
                      'h-10 min-w-[40px] px-3 rounded-lg text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-brand-500 ' +
                      (sel
                        ? 'bg-brand-700 text-white shadow-sm'
                        : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-brand-50 hover:ring-brand-300')
                    }
                    aria-pressed={sel}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-slate-500">Pick a value from {lo} to {hi}.</div>
          </div>
        );
      } else {
        const current = inRange ? raw : minVal;
        control = (
          <div className="space-y-1.5">
            <QtyStepper
              qty={current}
              min={minVal}
              max={maxVal}
              step={1}
              onChange={(n) => onChange(String(n))}
            />
            {hasBounds ? (
              <div className="text-[11px] text-slate-500">Allowed range: {lo}–{hi}</div>
            ) : null}
          </div>
        );
      }
      break;
    }
    case 'DECIMAL':
    case 'FLOAT':
      // Floor at 0 — height/weight/etc. can't be negative, and Livn doesn't
      // ship explicit bounds for these on Product 3 (per their decision we
      // don't invent them, but blocking negatives is harmless and prevents
      // the native input arrow from sliding past zero).
      control = (
        <input
          {...common}
          type="number"
          step="0.01"
          min={0}
          inputMode="decimal"
          placeholder={q.example || ''}
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '' || raw === '-') { onChange(''); return; }
            const n = Number(raw);
            if (!Number.isFinite(n)) { onChange(raw); return; }
            onChange(String(Math.max(0, n)));
          }}
          required={!!q.required}
        />
      );
      break;
    case 'BOOLEAN': {
      const isYes = value === true || value === 'true';
      const isNo = value === false || value === 'false';
      control = (
        <div className="inline-flex rounded-lg ring-1 ring-slate-200 bg-slate-50 p-1 gap-1">
          <ToggleBtn active={isYes} onClick={() => onChange(true)}>Yes</ToggleBtn>
          <ToggleBtn active={isNo} onClick={() => onChange(false)}>No</ToggleBtn>
        </div>
      );
      break;
    }
    case 'SELECT_SINGLE': {
      const opts = getOptions(q);
      fullWidth = opts.length > 1;
      const selectedOpt = opts.find((o) => String(optionValue(o)) === String(value));
      // Livn embeds follow-up questions on the OPTION rather than the parent
      // question (e.g. picking "Yes" on "Are you a Frequent Flyer?" reveals a
      // 10-digit number TEXT field with a regex). Render those inline below
      // the option list so the user fills them in before continuing.
      const followUpGroups = selectedOpt?.followUpQuestions?.questionGroups || [];
      if (opts.length === 0) {
        control = <p className="text-xs text-slate-500">No options available.</p>;
      } else if (opts.length > CARD_LIST_THRESHOLD) {
        // Long list (e.g. pickup points) — keep native <select> with the
        // selected option's description shown below.
        control = (
          <div className="space-y-3">
            <select
              {...common}
              value={value ?? ''}
              onChange={(e) => onChange(e.target.value)}
              required={!!q.required}
            >
              <option value="">— choose —</option>
              {opts.map((o, i) => {
                const v = optionValue(o);
                const fee = o?.feeDescription ? `  (${formatFeeText(o.feeDescription)})` : '';
                return <option key={i} value={v}>{optionLabel(o)}{fee}</option>;
              })}
            </select>
            {selectedOpt?.description ? (
              <p className="text-xs text-slate-500">{selectedOpt.description}</p>
            ) : null}
            {selectedOpt?.feeDescription ? (
              <p className="text-xs text-amber-700">⚑ {formatFeeText(selectedOpt.feeDescription)}</p>
            ) : null}
            {canRecurse && followUpGroups.length ? (
              <FollowUpGroups groups={followUpGroups} answers={answers} setAnswer={setAnswer} />
            ) : null}
          </div>
        );
      } else {
        // Short list — radio cards, much friendlier than a native select.
        control = (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {opts.map((o, i) => {
                const v = String(optionValue(o));
                const isSelected = String(value) === v;
                return (
                  <OptionCard
                    key={i}
                    selected={isSelected}
                    onClick={() => onChange(v)}
                    type="radio"
                  >
                    <div className="font-medium text-slate-900">{optionLabel(o)}</div>
                    {o?.description ? (
                      <div className="text-xs text-slate-500 mt-0.5">{o.description}</div>
                    ) : null}
                    {o?.feeDescription ? (
                      <div className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
                        ⚑ {formatFeeText(o.feeDescription)}
                      </div>
                    ) : null}
                  </OptionCard>
                );
              })}
            </div>
            {canRecurse && followUpGroups.length ? (
              <FollowUpGroups groups={followUpGroups} answers={answers} setAnswer={setAnswer} />
            ) : null}
          </div>
        );
      }
      break;
    }
    case 'SELECT_MULTIPLE': {
      const opts = getOptions(q);
      fullWidth = opts.length > 1;
      const selected = Array.isArray(value) ? value : (value ? String(value).split(',') : []);
      const toggle = (v) => {
        const has = selected.includes(v);
        onChange(has ? selected.filter((s) => s !== v) : [...selected, v]);
      };
      if (opts.length === 0) {
        control = <p className="text-xs text-slate-500">No options available.</p>;
      } else if (opts.length > CARD_LIST_THRESHOLD) {
        // Long list — scrollable checkbox list.
        control = (
          <div className="rounded-lg border border-slate-200 bg-white max-h-64 overflow-y-auto divide-y divide-slate-100">
            {opts.map((o, i) => {
              const v = String(optionValue(o));
              const isSelected = selected.includes(v);
              return (
                <label key={i} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(v)}
                    className="mt-0.5 accent-brand-600"
                  />
                  <div className="text-sm">
                    <div className="font-medium text-slate-800">{optionLabel(o)}</div>
                    {o?.description ? <div className="text-xs text-slate-500 mt-0.5">{o.description}</div> : null}
                    {o?.feeDescription ? <div className="text-xs text-amber-700 mt-0.5">⚑ {formatFeeText(o.feeDescription)}</div> : null}
                  </div>
                </label>
              );
            })}
          </div>
        );
      } else {
        // Short list — checkbox cards.
        control = (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {opts.map((o, i) => {
              const v = String(optionValue(o));
              const isSelected = selected.includes(v);
              return (
                <OptionCard
                  key={i}
                  selected={isSelected}
                  onClick={() => toggle(v)}
                  type="checkbox"
                >
                  <div className="font-medium text-slate-900">{optionLabel(o)}</div>
                  {o?.description ? (
                    <div className="text-xs text-slate-500 mt-0.5">{o.description}</div>
                  ) : null}
                  {o?.feeDescription ? (
                    <div className="mt-1 text-xs text-amber-700 font-medium">⚑ {formatFeeText(o.feeDescription)}</div>
                  ) : null}
                </OptionCard>
              );
            })}
          </div>
        );
      }
      break;
    }
    case 'BINARY':
    case 'FILE':
    case 'IMAGE':
      control = <FileDropZone questionId={q.uuid} value={value} onChange={onChange} accept={type === 'IMAGE' ? 'image/*' : undefined} />;
      fullWidth = true;
      break;
    default:
      control = (
        <input
          {...common}
          type="text"
          placeholder={q.example || ''}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }

  return (
    <div className={'space-y-2 ' + (fullWidth ? 'md:col-span-2' : '')}>
      <label htmlFor={`q_${q.uuid}`} className="block text-sm font-medium text-slate-800">
        {label}
        {q.required ? <span className="text-red-500 ml-0.5">*</span> : null}
      </label>
      {control}
      {q.description ? (
        <p className="text-xs text-slate-500">{q.description}</p>
      ) : null}
      {q.feeDescription ? (
        <p className="text-xs text-amber-700">⚑ {formatFeeText(q.feeDescription)}</p>
      ) : null}
    </div>
  );
}

// Render the follow-up question groups attached to a Livn select option
// (e.g. the regex-validated Frequent Flyer Number that appears when YES is
// picked). Wrapped in a soft amber-tinted container so the user clearly sees
// "your previous answer added these new fields". Each follow-up question
// runs through the same QuestionRenderer recursively, so its answer flows
// into the same answers map and gets sent in the next /flows PUT.
function FollowUpGroups({ groups, answers, setAnswer }) {
  if (!groups?.length) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 space-y-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-800">
        ⚑ Based on your answer above
      </div>
      {groups.map((g, gi) => (
        <div key={gi} className={gi > 0 ? 'pt-3 border-t border-amber-100' : ''}>
          {g.caption ? (
            <h5 className="font-semibold text-sm text-amber-900 mb-2">{g.caption}</h5>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            {(g.questions || []).map((fq) => (
              <QuestionRenderer
                key={fq.uuid}
                question={fq}
                value={answers?.[fq.uuid]}
                onChange={(v) => setAnswer(fq.uuid, v)}
                answers={answers}
                setAnswer={setAnswer}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Walk a question and yield itself + every follow-up question reachable
// through whichever option is currently selected. Used by validateStep so
// regex / required / numeric-bounds checks fire on the live frequent-flyer
// number (and any other option-gated question) instead of being silently
// skipped because they're nested inside an option payload.
export function* walkActiveQuestions(question, answers) {
  if (!question) return;
  yield question;
  if (String(question.answerType || '').toUpperCase() !== 'SELECT_SINGLE') return;
  const opts = getOptions(question);
  const v = answers?.[question.uuid];
  const sel = opts.find((o) => String(optionValue(o)) === String(v));
  for (const g of sel?.followUpQuestions?.questionGroups || []) {
    for (const fq of g.questions || []) {
      yield* walkActiveQuestions(fq, answers);
    }
  }
}

// Input with a leading icon. Reuses .input ring/focus styling but adds the
// icon space and bumps left padding so the icon doesn't crowd the text.
function IconInput({ icon, className = '', ...props }) {
  return (
    <div className="relative">
      <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
        {icon}
      </span>
      <input {...props} className={(className || 'input') + ' pl-9'} />
    </div>
  );
}

// Segmented-toggle button used for BOOLEAN questions — feels modern compared
// to bare radios and reads better at a glance.
function ToggleBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-4 py-1.5 rounded-md text-sm font-medium transition ' +
        (active
          ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-200'
          : 'text-slate-500 hover:text-slate-800')
      }
    >
      {children}
    </button>
  );
}

// Selectable card used for short SELECT_SINGLE/SELECT_MULTIPLE option lists.
// Behaves like a labelled <button> but visually reflects selection state.
function OptionCard({ selected, onClick, type, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role={type === 'radio' ? 'radio' : 'checkbox'}
      aria-checked={!!selected}
      className={
        'group text-left rounded-lg border-2 p-3 transition focus:outline-none focus:ring-2 focus:ring-brand-500 ' +
        (selected
          ? 'border-brand-500 bg-brand-50/60 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50')
      }
    >
      <span className="flex items-center gap-3">
        <span
          className={
            'inline-flex items-center justify-center rounded-full transition shrink-0 ' +
            (type === 'radio'
              ? 'h-5 w-5 ring-2 ' + (selected ? 'bg-brand-600 ring-brand-600' : 'bg-white ring-slate-300')
              : 'h-5 w-5 ' + (selected ? 'bg-brand-600' : 'bg-white ring-2 ring-slate-300'))
          }
          aria-hidden
        >
          {selected && type === 'radio' ? (
            <span className="h-2 w-2 rounded-full bg-white" />
          ) : selected && type !== 'radio' ? (
            <svg width="12" height="12" viewBox="0 0 12 12" className="text-white">
              <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          ) : null}
        </span>
        <span className="flex-1 min-w-0">{children}</span>
      </span>
    </button>
  );
}

// Drag-and-drop file picker with preview for images. Stores the file as
// base64 in the answer (Livn expects raw base64 without the data: prefix).
function FileDropZone({ questionId, value, onChange, accept }) {
  const [name, setName] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [dragging, setDragging] = useState(false);

  function handleFile(file) {
    if (!file) { onChange(null); setName(''); setPreviewUrl(''); return; }
    setName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      // Livn wants the bare base64 payload, not the data: URI prefix.
      onChange(dataUrl.split(',')[1] || dataUrl);
      if (file.type?.startsWith('image/')) setPreviewUrl(dataUrl);
      else setPreviewUrl('');
    };
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <label
        htmlFor={`q_${questionId}_file`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
        className={
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed cursor-pointer transition px-4 py-6 text-center ' +
          (dragging
            ? 'border-brand-500 bg-brand-50'
            : value
            ? 'border-emerald-300 bg-emerald-50/50'
            : 'border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/40')
        }
      >
        {previewUrl ? (
          <img src={previewUrl} alt="" className="max-h-32 rounded object-contain" />
        ) : (
          <UploadIcon />
        )}
        <div className="text-sm">
          {value ? (
            <span className="text-emerald-700 font-medium">
              ✓ {name || 'File attached'} — click to replace
            </span>
          ) : (
            <>
              <span className="font-medium text-slate-800">Click to upload</span>
              <span className="text-slate-500"> or drag &amp; drop</span>
            </>
          )}
        </div>
        <input
          id={`q_${questionId}_file`}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </label>
    </div>
  );
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 4a2 2 0 0 1 2-2h2.4a1 1 0 0 1 1 .8l.8 4a1 1 0 0 1-.3 1l-1.6 1.5a14 14 0 0 0 6.4 6.4l1.5-1.6a1 1 0 0 1 1-.3l4 .8a1 1 0 0 1 .8 1V18a2 2 0 0 1-2 2A17 17 0 0 1 5 4z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden className="text-slate-400">
      <path d="M12 16V4m0 0-4 4m4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
