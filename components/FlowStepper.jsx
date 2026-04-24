'use client';

// Render a horizontal progress bar based on the Livn roadmap string.
// roadmap example: "FARE_SELECTION,FINAL_QUOTE,CONFIRMED_BOOKING"

const LABELS = {
  FARE_SELECTION:    'Fares',
  FINAL_QUOTE:       'Quote',
  TEMPORARY_HOLD:    'Hold',
  CONFIRMED_BOOKING: 'Confirmed',
};

export default function FlowStepper({ flow }) {
  if (!flow?.roadmap) return null;

  // Livn roadmap may contain bracketed tokens like "[0-1]" meaning "between
  // 0 and 1 additional non-milestone steps". They're informational, not real
  // milestones, so drop them.
  const milestones = flow.roadmap
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^\[.*\]$/.test(s));

  const doneMilestones = new Set(
    (flow.steps || [])
      .filter((s) => s.status === 'DONE' && s.milestone)
      .map((s) => s.milestone)
  );
  const activeMilestone = (flow.steps || []).find((s) => s.status === 'ACTIVE' || s.status === 'FAILED')?.milestone;

  return (
    <ol className="flex items-center w-full gap-0 text-xs">
      {milestones.map((m, i) => {
        const done = doneMilestones.has(m);
        const active = !done && m === activeMilestone;
        return (
          <li key={m} className="flex-1 flex items-center">
            <div className="flex items-center gap-2">
              <span
                className={
                  'grid place-items-center w-7 h-7 rounded-full text-[11px] font-bold transition ' +
                  (done ? 'bg-brand-700 text-white shadow-brand-glow' :
                    active ? 'bg-white text-brand-800 ring-2 ring-brand-700' :
                    'bg-slate-100 text-ink-400 ring-1 ring-slate-200')
                }
              >
                {done ? '✓' : i + 1}
              </span>
              <span className={'font-medium ' + (done || active ? 'text-ink-900' : 'text-ink-400')}>
                {LABELS[m] || m}
              </span>
            </div>
            {i < milestones.length - 1 ? (
              <span className={'flex-1 h-0.5 mx-3 rounded-full ' + (done ? 'bg-brand-700' : 'bg-slate-200')} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
