'use client';
import QtyStepper from '@/components/QtyStepper';

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

export default function QuestionRenderer({ question, value, onChange }) {
  const q = question || {};
  const type = String(q.answerType || 'TEXT').toUpperCase();
  const label = q.title || q.purpose || 'Answer';

  const common = { id: `q_${q.uuid}`, className: 'input' };

  let control = null;
  switch (type) {
    case 'TEXT':
    case 'STRING':
      control = (
        <input
          {...common}
          type="text"
          placeholder={q.example || ''}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={!!q.required}
        />
      );
      break;
    case 'EMAIL':
      control = (
        <input
          {...common}
          type="email"
          placeholder={q.example || 'you@example.com'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={!!q.required}
        />
      );
      break;
    case 'PHONE':
      control = (
        <input
          {...common}
          type="tel"
          placeholder={q.example || '+61 491570156'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={!!q.required}
        />
      );
      break;
    case 'DATE':
      control = (
        <input
          {...common}
          type="date"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={!!q.required}
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
      // Render integer-typed questions (passenger count, party size, etc.)
      // with the same +/- stepper used everywhere else in checkout — no
      // native browser arrow controls. Honors min/max from the question
      // when provided, otherwise falls back to a sane 0–99 range.
      const minVal = Number.isFinite(Number(q.min)) ? Number(q.min) : 0;
      const maxVal = Number.isFinite(Number(q.max)) ? Number(q.max) : 99;
      const current = Number.isFinite(Number(value)) ? Number(value) : minVal;
      control = (
        <QtyStepper
          qty={current}
          min={minVal}
          max={maxVal}
          step={1}
          onChange={(n) => onChange(String(n))}
        />
      );
      break;
    }
    case 'DECIMAL':
    case 'FLOAT':
      control = (
        <input
          {...common}
          type="number"
          step="0.01"
          inputMode="decimal"
          placeholder={q.example || ''}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={!!q.required}
        />
      );
      break;
    case 'BOOLEAN': {
      const v = value === true || value === 'true';
      control = (
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" checked={v === true} onChange={() => onChange(true)} /> Yes
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" checked={v === false && value !== null && value !== undefined && value !== ''} onChange={() => onChange(false)} /> No
          </label>
        </div>
      );
      break;
    }
    case 'SELECT_SINGLE': {
      const opts = getOptions(q);
      const selected = opts.find((o) => String(optionValue(o)) === String(value));
      control = (
        <div>
          <select
            {...common}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            required={!!q.required}
          >
            <option value="">— choose —</option>
            {opts.map((o, i) => {
              const v = optionValue(o);
              const fee = o?.feeDescription ? `  (${o.feeDescription})` : '';
              return <option key={i} value={v}>{optionLabel(o)}{fee}</option>;
            })}
          </select>
          {selected?.description ? (
            <p className="text-xs text-slate-500 mt-1">{selected.description}</p>
          ) : null}
          {selected?.feeDescription ? (
            <p className="text-xs text-amber-700 mt-1">{selected.feeDescription}</p>
          ) : null}
        </div>
      );
      break;
    }
    case 'SELECT_MULTIPLE': {
      const opts = getOptions(q);
      const selected = Array.isArray(value) ? value : (value ? String(value).split(',') : []);
      const toggle = (v) => {
        const has = selected.includes(v);
        onChange(has ? selected.filter((s) => s !== v) : [...selected, v]);
      };
      control = (
        <div className="space-y-1 max-h-64 overflow-y-auto border border-slate-200 rounded-md p-2">
          {opts.map((o, i) => {
            const v = String(optionValue(o));
            return (
              <label key={i} className="flex items-start gap-2 text-sm py-1">
                <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} className="mt-1" />
                <div>
                  <div>{optionLabel(o)}</div>
                  {o?.description ? <div className="text-xs text-slate-500">{o.description}</div> : null}
                  {o?.feeDescription ? <div className="text-xs text-amber-700">{o.feeDescription}</div> : null}
                </div>
              </label>
            );
          })}
        </div>
      );
      break;
    }
    case 'BINARY':
    case 'FILE':
    case 'IMAGE':
      control = (
        <div>
          <input
            type="file"
            className="block w-full text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) { onChange(null); return; }
              const reader = new FileReader();
              reader.onload = () => onChange(String(reader.result).split(',')[1] || reader.result);
              reader.readAsDataURL(f);
            }}
          />
          <p className="text-xs text-slate-500 mt-1">Uploaded as base64.</p>
        </div>
      );
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
    <div>
      <label htmlFor={`q_${q.uuid}`} className="label">
        {label}{q.required ? <span className="text-red-500"> *</span> : null}
      </label>
      {control}
      {q.description ? <p className="text-xs text-slate-500 mt-1">{q.description}</p> : null}
      {q.feeDescription ? <p className="text-xs text-amber-700 mt-1">{q.feeDescription}</p> : null}
      {q.regex ? <p className="text-xs text-slate-500 mt-1">Pattern: <code>{q.regex}</code></p> : null}
    </div>
  );
}
