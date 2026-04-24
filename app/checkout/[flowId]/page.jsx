'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiGet, apiPut, apiPost, pickTotal } from '@/lib/api';
import { useMoney } from '@/components/MoneyProvider';
import { Loading, ErrorBox } from '@/components/States';
import FlowStepper from '@/components/FlowStepper';
import FareSelector from '@/components/FareSelector';
import QuestionRenderer from '@/components/QuestionRenderer';
import QuoteView from '@/components/QuoteView';

export default function CheckoutPage() {
  const { flowId } = useParams();
  const router = useRouter();
  const { formatUsd } = useMoney();

  const [flow, setFlow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Per-step user input held locally.
  const [fareSel, setFareSel] = useState({});
  const [addOnSel, setAddOnSel] = useState({});
  const [answers, setAnswers] = useState({}); // { [questionUuid]: value }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      // Try to hydrate from sessionStorage first (saves a round-trip from product page)
      let initialFlow = null;
      if (typeof window !== 'undefined') {
        const stash = sessionStorage.getItem('livn.flow.' + flowId);
        if (stash) {
          try { initialFlow = JSON.parse(stash); } catch (_) {}
        }
      }

      if (initialFlow) {
        setFlow(initialFlow);
        setLoading(false);
        return;
      }

      const res = await apiGet(`/flows/${flowId}`);
      setLoading(false);
      if (!res.ok) { setError(res.error); return; }
      setFlow(res.data);
    })();
  }, [flowId]);

  const activeStep = useMemo(() => {
    if (!flow?.steps) return null;
    return flow.steps.find((s) => s.status === 'ACTIVE' || s.status === 'FAILED') || null;
  }, [flow]);

  // Livn returns steps newest-first, so we can't look at steps[length - 1].
  // A flow is "done" when a CONFIRMED_BOOKING step exists AND is DONE,
  // or when there are already booking records attached to the flow.
  const isDone = useMemo(() => {
    if (!flow) return false;
    const confirmed = (flow.steps || []).some(
      (s) => s.milestone === 'CONFIRMED_BOOKING' && s.status === 'DONE'
    );
    return confirmed || (Array.isArray(flow.bookings) && flow.bookings.length > 0);
  }, [flow]);

  // Clear per-step input when the active step changes
  useEffect(() => {
    if (!activeStep) return;
    setFareSel({});
    setAddOnSel({});
    const pre = {};
    (activeStep.answers?.answers || []).forEach((a) => {
      pre[a.questionUuid] = a.value;
    });
    setAnswers(pre);
  }, [activeStep?.id]); // eslint-disable-line

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!flow) return null;

  async function submit({ back = false } = {}) {
    if (!activeStep) return;
    setSubmitting(true);
    setError(null);

    // Patch the active step in a copy of the flow.
    const step = { ...activeStep };
    if (step.fareDetails && Object.keys(fareSel).length > 0) {
      step.fareSelections = Object.entries(fareSel).map(([uuid, quantity]) => ({ uuid, quantity }));
    }
    if (Object.keys(addOnSel).length > 0) {
      step.addOnSelections = Object.entries(addOnSel).map(([uuid, quantity]) => ({ uuid, quantity }));
    }
    if (step.questions) {
      step.answers = {
        answers: Object.entries(answers)
          .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
          .map(([questionUuid, value]) => ({
            questionUuid,
            // Livn's Answer.value is a plain String. Coerce arrays (from
            // SELECT_MULTIPLE) to comma-separated, booleans to 'true'/'false',
            // and everything else to String(value) so Jackson can deserialize.
            value: serializeAnswerValue(value),
          })),
      };
    }

    const nextFlow = {
      ...flow,
      steps: flow.steps.map((s) => (s.id === step.id ? step : s)),
    };

    const res = await apiPut('/flows', nextFlow, { back });
    setSubmitting(false);

    if (!res.ok) { setError(res.error); return; }

    if (typeof window !== 'undefined') {
      sessionStorage.setItem('livn.flow.' + flowId, JSON.stringify(res.data));
    }
    setFlow(res.data);
  }

  async function previewPrice() {
    if (!activeStep) return;
    const step = { ...activeStep };
    step.fareSelections = Object.entries(fareSel).map(([uuid, quantity]) => ({ uuid, quantity }));
    step.addOnSelections = Object.entries(addOnSel).map(([uuid, quantity]) => ({ uuid, quantity }));
    const body = {
      id: flow.id,
      steps: [{ id: step.id, fareSelections: step.fareSelections, addOnSelections: step.addOnSelections }],
    };
    const res = await apiPost('/flows/preview-price', body);
    if (!res.ok) { setError(res.error); return; }
    const total = pickTotal(res.data);
    alert('Preview total: ' + (total ? formatUsd(total) : JSON.stringify(res.data)));
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <FlowStepper flow={flow} />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500">Checkout · flow {flow.id}</div>
            <h1 className="font-semibold text-lg">{flow.product?.name || `Product #${flow.productId}`}</h1>
            <div className="text-sm text-slate-500">
              {flow.date}{flow.simulation ? ' · simulation' : ''}
            </div>
          </div>
          <div className="text-right">
            {flow.livnReference ? (
              <div className="text-xs text-slate-500">Livn ref <span className="font-mono">{flow.livnReference}</span></div>
            ) : null}
          </div>
        </div>
      </div>

      {activeStep ? (
        <StepView
          step={activeStep}
          flow={flow}
          fareSel={fareSel}
          setFareSel={setFareSel}
          addOnSel={addOnSel}
          setAddOnSel={setAddOnSel}
          answers={answers}
          setAnswers={setAnswers}
          onNext={() => submit()}
          onBack={() => submit({ back: true })}
          onPreview={previewPrice}
          submitting={submitting}
          error={error}
        />
      ) : isDone ? (
        <ConfirmedView flow={flow} />
      ) : (
        <div className="card p-5 text-sm">No active step. Flow may already be complete.</div>
      )}

      <div className="text-xs text-slate-400">
        <Link href={`/products/${flow.productId}`} className="hover:underline">← back to product</Link>
      </div>
    </div>
  );
}

function StepView({ step, flow, fareSel, setFareSel, addOnSel, setAddOnSel, answers, setAnswers, onNext, onBack, onPreview, submitting, error }) {
  const hasFares = !!step.fareDetails;
  const hasQuestions = !!step.questions?.questionGroups?.length;
  const hasQuote = !!step.finalQuote;

  // Compute an expiry countdown if the step has one
  const expiry = step.expires ? new Date(step.expires).getTime() : null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiry) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiry]);
  const remainingMs = expiry ? Math.max(0, expiry - now) : null;
  const mins = remainingMs !== null ? Math.floor(remainingMs / 60000) : null;
  const secs = remainingMs !== null ? Math.floor((remainingMs % 60000) / 1000) : null;

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wide">{step.milestone || step.stepName}</div>
            <h2 className="text-lg font-semibold">{step.caption || 'Complete this step'}</h2>
          </div>
          {remainingMs !== null ? (
            <div className={'badge ' + (remainingMs < 60000 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800')}>
              Expires in {mins}m {String(secs).padStart(2, '0')}s
            </div>
          ) : null}
        </div>

        {step.status === 'FAILED' && step.error ? (
          <div className="mt-3"><ErrorBox error={{ code: 'step_failed', message: step.error.customerErrorMessage || step.error.internalErrorMessage, details: step.error }} /></div>
        ) : null}

        {hasFares ? (
          <div className="mt-4">
            <FareSelector
              fareDetails={step.fareDetails}
              selections={fareSel}
              onChange={setFareSel}
              addOns={addOnSel}
              onAddOnChange={setAddOnSel}
            />
          </div>
        ) : null}

        {hasQuestions ? (
          <div className="mt-4 space-y-6">
            {step.questions.questionGroups.map((g, gi) => (
              <div key={gi}>
                {g.caption ? <h3 className="font-semibold mb-2">{g.caption}</h3> : null}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(g.questions || []).map((q) => (
                    <QuestionRenderer
                      key={q.uuid}
                      question={q}
                      value={answers[q.uuid]}
                      // Functional setState so browser autofill / rapid typing
                      // doesn't drop values via stale closure over `answers`.
                      onChange={(v) => setAnswers((prev) => ({ ...prev, [q.uuid]: v }))}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {hasQuote ? (
          <div className="mt-4">
            <h3 className="font-semibold mb-2">Quote</h3>
            <QuoteView quote={step.finalQuote} />
          </div>
        ) : null}

        {!hasFares && !hasQuestions && !hasQuote ? (
          <p className="text-sm text-slate-600 mt-3">
            No additional input needed — just continue.
          </p>
        ) : null}
      </section>

      {error ? <ErrorBox error={error} /> : null}

      <div className="flex justify-between gap-3">
        <div>
          {step.allowBackHere && step.sequenceNumber > 1 ? (
            <button className="btn-secondary" disabled={submitting} onClick={onBack}>
              ← Back
            </button>
          ) : null}
        </div>
        <div className="flex gap-2">
          {hasFares ? (
            <button className="btn-secondary" disabled={submitting} onClick={onPreview}>
              Preview price
            </button>
          ) : null}
          <button className="btn-primary" disabled={submitting} onClick={onNext}>
            {submitting ? 'Submitting…' : (step.nextStepConfirmedBooking ? 'Confirm booking' : 'Continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

function serializeAnswerValue(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined && x !== '').map(String).join(',');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function ConfirmedView({ flow }) {
  const bookings = flow.bookings || [];
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-green-200 bg-green-50 p-4">
        <div className="font-semibold text-green-800">✓ Booking confirmed</div>
        <div className="text-sm text-green-700">Livn reference: <span className="font-mono">{flow.livnReference}</span></div>
      </div>

      {bookings.map((b) => (
        <div key={b.id} className="card p-5">
          <div className="flex justify-between items-start gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="text-xs text-slate-500">Booking #{b.id}</div>
              <div className="font-semibold">{b.productName || `Product ${b.productId}`}</div>
              <div className="text-sm mt-1">{b.partyName} · {b.partyEmailAddress}</div>
            </div>
            <div className="text-right text-xs text-slate-500 shrink-0 space-y-0.5">
              <div>Livn: <span className="font-mono">{b.livnReference}</span></div>
              {b.supplierReference ? <div>supplier: <span className="font-mono">{b.supplierReference}</span></div> : null}
              {b.clientReference ? <div>client: <span className="font-mono">{b.clientReference}</span></div> : null}
            </div>
          </div>

          {b.tickets?.length ? (
            <div className="mt-4">
              <h4 className="font-semibold text-sm mb-2">Tickets</h4>
              <div className="space-y-2">
                {b.tickets.map((t) => {
                  const paxNames = (t.passengerDetails || []).map((p) => p?.name).filter(Boolean);
                  const prodName = (t.productDetails || [])[0]?.name;
                  return (
                    <div key={t.id} className="flex justify-between items-start border border-slate-200 rounded p-2 text-sm gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">
                          Ticket #{t.id}{paxNames.length ? ' — ' + paxNames.join(', ') : ''}
                        </div>
                        {prodName ? <div className="text-xs text-slate-500 truncate">{prodName}</div> : null}
                      </div>
                      <a
                        href={`/api/livn/tickets/${t.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-secondary shrink-0"
                      >
                        PDF
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2 flex-wrap">
            <a className="btn-secondary" target="_blank" rel="noreferrer" href={`/api/livn/bookings/${b.id}/pdf`}>
              Booking voucher PDF
            </a>
            <Link className="btn-secondary" href={`/bookings/${b.id}`}>Open booking</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
