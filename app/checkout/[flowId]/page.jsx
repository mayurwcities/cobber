'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiGet, apiPut, apiPost, pickTotal } from '@/lib/api';
import { scrollToElement } from '@/lib/scroll';
import { useMoney } from '@/components/MoneyProvider';
import { Loading, ErrorBox } from '@/components/States';
import FlowStepper from '@/components/FlowStepper';
import FareSelector from '@/components/FareSelector';
import QuestionRenderer from '@/components/QuestionRenderer';
import QuoteView from '@/components/QuoteView';
import BraintreeDropIn from '@/components/BraintreeDropIn';

export default function CheckoutPage() {
  const { flowId } = useParams();
  const router = useRouter();
  const { formatUsd, toUsd } = useMoney();

  const [flow, setFlow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [payStatus, setPayStatus] = useState(null); // "authorizing" | "booking" | "capturing" | null
  const [canPay, setCanPay] = useState(false); // true once Drop-in reports a valid card
  const [cooldownUntil, setCooldownUntil] = useState(0); // epoch ms; blocks Confirm during Braintree's 30s duplicate window

  // Per-step user input held locally.
  const [fareSel, setFareSel] = useState({});
  const [addOnSel, setAddOnSel] = useState({});
  const [answers, setAnswers] = useState({}); // { [questionUuid]: value }

  // Braintree Drop-in imperative handle (requestPaymentMethod / isReady).
  const dropinRef = useRef(null);
  // Attached to the error-box wrapper inside StepView so setError in
  // submit() can scroll the banner into view from this scope.
  const errorRef = useRef(null);

  // Single place that both stores the error AND brings the error banner
  // into view. Keeps the scroll coupled to the error so every setError
  // call in the submit flow produces visible feedback.
  function reportError(err) {
    setError(err);
    setTimeout(() => scrollToElement(errorRef.current, 80), 0);
  }

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
  // Only blow the whole page away when the flow never loaded. Once we
  // have flow data, submit/validation errors must render *inline* in
  // StepView so the user can fix the form without losing their place.
  if (error && !flow) return <ErrorBox error={error} />;
  if (!flow) return null;

  // Fire-and-forget POST to /api/booking-record. Server appends to the
  // date-rotated log file AND emails the operations team. We never await
  // this from the UI critical path — payment / booking outcome should not
  // be held up if SMTP is slow, and any failure is logged server-side.
  function recordBookingEvent(payload) {
    try {
      fetch('/api/booking-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}
  }

  async function submit({ back = false } = {}) {
    if (!activeStep) return;
    setSubmitting(true);
    setError(null);
    setPayStatus(null);

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

    // Payment: on the confirm-booking step (and only going forward), collect
    // card details via Drop-in, AUTHORIZE the amount (hold), book, then
    // CAPTURE on success / VOID on failure.
    const needsPayment = !back && step.nextStepConfirmedBooking === true;
    let transactionId = null;
    // Hoisted so the booking-record calls after this block can reference
    // them when reporting the captured / voided / failed event.
    let chargeAmount = null;
    let chargeCurrency = null;

    if (needsPayment) {
      // ------------------------------------------------------------
      // 1) Client-side validation BEFORE we ever touch the card.
      //    Authorize-then-void still leaves a visible auth in the
      //    Braintree dashboard and may briefly tie up the customer's
      //    available balance, so we only charge if the booking side
      //    is fully ready.
      // ------------------------------------------------------------
      const validationIssue = validateStep(step, fareSel, answers);
      if (validationIssue) {
        setSubmitting(false);
        setError({ code: 'booking_incomplete', message: validationIssue.message });
        // Scroll/focus the missing field so the user lands directly on
        // what needs fixing instead of being jumped to the top of the card.
        if (validationIssue.questionUuid && typeof document !== 'undefined') {
          const el = document.getElementById('q_' + validationIssue.questionUuid);
          if (el) {
            scrollToElement(el, 120);
            setTimeout(() => { try { el.focus({ preventScroll: true }); } catch {} }, 350);
          }
        }
        return;
      }

      // The confirm-booking step is sometimes FINAL_QUOTE (simple products)
      // and sometimes TEMPORARY_HOLD (complex products) — the latter has no
      // finalQuote on itself, so scan the whole flow for the latest quote.
      const quote = step.finalQuote || findQuoteInFlow(flow);
      const charge = resolveChargeAmount(quote, toUsd);
      if (!charge) {
        // eslint-disable-next-line no-console
        console.warn('[braintree] could not resolve amount. step.finalQuote=', step.finalQuote, ' flow-level quote=', quote);
        setSubmitting(false);
        reportError({
          code: 'no_amount',
          message: 'Could not determine an amount to charge. See console for the quote shape.',
        });
        return;
      }
      chargeAmount = charge.amount;
      chargeCurrency = charge.currency;
      const usdAmount = chargeAmount;

      if (!dropinRef.current?.isReady()) {
        setSubmitting(false);
        reportError({ code: 'payment_not_ready', message: 'Payment form is not ready yet. Please wait a moment and try again.' });
        return;
      }

      let nonce = null;
      try {
        const pm = await dropinRef.current.requestPaymentMethod();
        nonce = pm?.nonce;
      } catch (e) {
        setSubmitting(false);
        reportError({ code: 'payment_invalid', message: e?.message || 'Please check your card details.' });
        return;
      }
      if (!nonce) {
        setSubmitting(false);
        reportError({ code: 'payment_invalid', message: 'Could not get a payment token from the card form.' });
        return;
      }

      setPayStatus('authorizing');
      const authRes = await fetch('/api/braintree/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, amount: usdAmount, currency: chargeCurrency, flowId }),
      });
      const authJson = await authRes.json().catch(() => null);
      if (!authJson?.success) {
        setSubmitting(false);
        setPayStatus(null);
        // Nonce was consumed by this authorize attempt — clear so the
        // next click tokenizes fresh.
        try { await dropinRef.current?.clearSelectedPaymentMethod?.(); } catch {}
        // Braintree's 30-second duplicate window — block the button
        // until it passes so the user physically can't re-hit the rule.
        if (authJson?.error?.code === 'duplicate_transaction') {
          setCooldownUntil(Date.now() + 30_000);
        }
        recordBookingEvent({
          status: 'auth_failed',
          flowId,
          productId: flow.productId,
          productName: flow.product?.name,
          date: flow.date,
          amount: chargeAmount,
          currency: chargeCurrency,
          transactionId: authJson?.data?.transactionId || authJson?.error?.details?.transactionId || null,
          errorMessage: authJson?.error?.message || 'Authorization failed',
          errorCode: authJson?.error?.code,
        });
        reportError(authJson?.error || { code: 'authorization_failed', message: 'Card authorization failed.' });
        return;
      }
      transactionId = authJson.data.transactionId;
    }

    setPayStatus(needsPayment ? 'booking' : null);
    const res = await apiPut('/flows', nextFlow, { back });

    // ------------------------------------------------------------------
    // Intermediate step advance (not the confirm-booking submit). No
    // Braintree was involved. Surface transport errors or the step's
    // own FAILED state, but don't run the confirmed-booking check —
    // the flow is legitimately mid-way and won't be confirmed yet.
    // ------------------------------------------------------------------
    if (!needsPayment) {
      setSubmitting(false);
      setPayStatus(null);
      if (!res.ok) {
        reportError(res.error);
        return;
      }
      const failed = findFailedStep(res.data);
      if (failed?.error) {
        reportError({
          code: 'step_failed',
          message: failed.error.customerErrorMessage || failed.error.internalErrorMessage,
          details: failed.error,
        });
      }
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('livn.flow.' + flowId, JSON.stringify(res.data));
      }
      setFlow(res.data);
      return;
    }

    // ------------------------------------------------------------------
    // Confirm-booking submit. Money was authorized; we only capture if
    // the booking truly landed, otherwise we void the hold. Livn can
    // return envelope.success=true even when the flow ends in a FAILED
    // step, so we inspect the flow itself via isBookingConfirmed().
    // ------------------------------------------------------------------
    const bookingConfirmed = res.ok && isBookingConfirmed(res.data);
    const failedStep = res.ok ? findFailedStep(res.data) : null;

    if (!bookingConfirmed) {
      if (transactionId) {
        try {
          await fetch('/api/braintree/void', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactionId }),
          });
        } catch {}
        // The nonce we just sent to /authorize is now spent — Braintree
        // rejects the same nonce a second time with "Cannot use a
        // payment_method_nonce more than once". Drop card selection so
        // the user's next retry tokenizes fresh.
        try { await dropinRef.current?.clearSelectedPaymentMethod?.(); } catch {}
      }
      setSubmitting(false);
      setPayStatus(null);

      const err = failedStep?.error
        ? { code: 'step_failed', message: failedStep.error.customerErrorMessage || failedStep.error.internalErrorMessage, details: failedStep.error }
        : res.error
        ? res.error
        : { code: 'booking_not_confirmed', message: 'Booking did not complete. Any card hold has been released.' };
      reportError(err);

      if (transactionId) {
        recordBookingEvent({
          status: 'auth_voided',
          flowId,
          productId: flow.productId,
          productName: flow.product?.name,
          date: flow.date,
          livnReference: res.data?.livnReference || flow.livnReference,
          amount: chargeAmount,
          currency: chargeCurrency,
          transactionId,
          errorMessage: err.message,
          errorCode: err.code,
        });
      }

      if (res.ok && res.data) {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('livn.flow.' + flowId, JSON.stringify(res.data));
        }
        setFlow(res.data);
      }
      return;
    }

    // Booking is confirmed — now capture the hold so the money actually moves.
    // The /capture route already retries up to 3× with backoff, so a failure
    // here means a sustained Braintree problem (or the hold was voided
    // externally). We DO NOT auto-cancel the booking — the customer earned
    // their ticket — but we surface the txn id + booking id so ops can
    // settle manually in the Braintree dashboard within the hold window
    // (~7 days for credit, ~30 for debit). After that the hold expires and
    // the merchant has to chase the customer for payment.
    if (transactionId) {
      setPayStatus('capturing');
      const capRes = await fetch('/api/braintree/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId }),
      });
      const capJson = await capRes.json().catch(() => null);

      const bookings = res.data?.bookings || [];
      const bookingIds = bookings.map((b) => b.id);
      const firstBooking = bookings[0];
      const customer = firstBooking
        ? [firstBooking.partyName, firstBooking.partyEmailAddress].filter(Boolean).join(' · ')
        : null;

      if (!capJson?.success) {
        reportError({
          code: 'capture_failed',
          message: `Your booking is confirmed${bookingIds.length ? ` (${bookingIds.join(', ')})` : ''}, but we couldn't charge your card after several attempts. Please contact support and quote transaction ${transactionId}.`,
          details: { transactionId, bookingIds, capture: capJson?.error },
        });
        // eslint-disable-next-line no-console
        console.error('[braintree] capture failed after retries', { transactionId, bookingIds, capJson });

        recordBookingEvent({
          status: 'capture_failed',
          flowId,
          productId: flow.productId,
          productName: flow.product?.name,
          date: flow.date,
          livnReference: res.data?.livnReference,
          bookingIds,
          customer,
          amount: chargeAmount,
          currency: chargeCurrency,
          transactionId,
          transactionStatus: capJson?.data?.status || 'authorized',
          errorMessage: capJson?.error?.message || 'Capture failed after retries',
          errorCode: capJson?.error?.code,
        });
      } else {
        recordBookingEvent({
          status: 'captured',
          flowId,
          productId: flow.productId,
          productName: flow.product?.name,
          date: flow.date,
          livnReference: res.data?.livnReference,
          bookingIds,
          customer,
          amount: chargeAmount,
          currency: chargeCurrency,
          transactionId,
          transactionStatus: capJson?.data?.status || 'submitted_for_settlement',
        });
      }
    }

    setSubmitting(false);
    setPayStatus(null);

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
          payStatus={payStatus}
          error={error}
          errorRef={errorRef}
          dropinRef={dropinRef}
          canPay={canPay}
          onRequestableChange={setCanPay}
          cooldownUntil={cooldownUntil}
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

function StepView({ step, flow, fareSel, setFareSel, addOnSel, setAddOnSel, answers, setAnswers, onNext, onBack, onPreview, submitting, payStatus, error, errorRef, dropinRef, canPay, onRequestableChange, cooldownUntil }) {
  const { formatUsd } = useMoney();
  const hasFares = !!step.fareDetails;
  const hasQuestions = !!step.questions?.questionGroups?.length;
  const hasQuote = !!step.finalQuote;
  const needsPayment = step.nextStepConfirmedBooking === true;
  // On TEMPORARY_HOLD steps the finalQuote lives on a previous (DONE) step,
  // so reach back into the flow so the "Authorizing $X" label stays accurate.
  const payableQuote = step.finalQuote || (needsPayment ? findQuoteInFlow(flow) : null);
  const totalPrice = payableQuote ? pickTotal(payableQuote) : null;
  const totalUsdDisplay = totalPrice ? formatUsd(totalPrice) : null;

  // Compute an expiry countdown (if the step has one) AND a Braintree
  // duplicate-filter cooldown after a rejected auth. Same tick for both.
  const expiry = step.expires ? new Date(step.expires).getTime() : null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const needsTick = !!expiry || (cooldownUntil || 0) > Date.now();
    if (!needsTick) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiry, cooldownUntil]);
  const remainingMs = expiry ? Math.max(0, expiry - now) : null;
  const mins = remainingMs !== null ? Math.floor(remainingMs / 60000) : null;
  const secs = remainingMs !== null ? Math.floor((remainingMs % 60000) / 1000) : null;
  const cooldownSecs = cooldownUntil && cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0;

  const submitLabel = (() => {
    if (cooldownSecs > 0) return `Try again in ${cooldownSecs}s`;
    if (!submitting) return step.nextStepConfirmedBooking ? 'Confirm booking & pay' : 'Continue';
    if (payStatus === 'authorizing') return 'Authorizing card…';
    if (payStatus === 'booking') return 'Booking…';
    if (payStatus === 'capturing') return 'Capturing payment…';
    return 'Submitting…';
  })();

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

        <div ref={errorRef} className="scroll-mt-24">
          {error ? (
            <div className="mt-3"><ErrorBox error={error} /></div>
          ) : step.status === 'FAILED' && step.error ? (
            <div className="mt-3"><ErrorBox error={{ code: 'step_failed', message: step.error.customerErrorMessage || step.error.internalErrorMessage, details: step.error }} /></div>
          ) : null}
        </div>

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

        {needsPayment ? (
          <div className="mt-6 pt-6 border-t border-slate-200">
            <BraintreeDropIn
              ref={dropinRef}
              amount={totalUsdDisplay}
              onRequestableChange={onRequestableChange}
            />
          </div>
        ) : null}
      </section>

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
          <button
            className="btn-primary"
            disabled={submitting || (needsPayment && !canPay) || cooldownSecs > 0}
            onClick={onNext}
            title={
              cooldownSecs > 0
                ? `Braintree duplicate-transaction window — available in ${cooldownSecs}s`
                : needsPayment && !canPay
                ? 'Please fill in your card details first'
                : undefined
            }
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Return { message, questionUuid? } describing the first validation
 * problem on the current step, or null if the step is ready to submit.
 * Runs BEFORE we hit Braintree so an incomplete form never creates an
 * authorization in the first place.
 */
function validateStep(step, fareSel, answers) {
  if (step.fareDetails) {
    const totalQty = Object.values(fareSel || {}).reduce((n, v) => n + Number(v || 0), 0);
    if (totalQty < 1) return { message: 'Please choose at least one ticket before paying.' };
  }
  const groups = step.questions?.questionGroups || [];
  for (const g of groups) {
    for (const q of g.questions || []) {
      if (!q.required) continue;
      const v = answers?.[q.uuid];
      const empty =
        v === undefined || v === null || v === '' ||
        (Array.isArray(v) && v.length === 0);
      if (empty) {
        const label = q.title || q.question || 'a required field';
        return {
          message: `Please fill in "${label}" before paying.`,
          questionUuid: q.uuid,
        };
      }
    }
  }
  return null;
}

/**
 * The Livn envelope returns success:true even when the flow ends in a
 * FAILED step, so we need to look at the flow itself to know whether
 * the booking actually landed.
 */
function isBookingConfirmed(flow) {
  if (!flow) return false;
  const steps = flow.steps || [];
  if (steps.some(s => s.status === 'FAILED')) return false;
  const hasConfirmed = steps.some(s => s.milestone === 'CONFIRMED_BOOKING' && s.status === 'DONE');
  return hasConfirmed || (Array.isArray(flow.bookings) && flow.bookings.length > 0);
}

function findFailedStep(flow) {
  return flow?.steps?.find(s => s.status === 'FAILED') || null;
}

/**
 * Walk the flow's steps to find the most recent finalQuote. Some products
 * end in a TEMPORARY_HOLD step that carries no quote of its own — the
 * finalQuote lives on the previous (now DONE) FINAL_QUOTE step.
 *
 * Livn returns steps newest-first, so we iterate in array order and take
 * the first one with a quote. Falls back to a scan that respects
 * sequenceNumber in case that ordering contract ever changes.
 */
function findQuoteInFlow(flow) {
  const steps = flow?.steps;
  if (!Array.isArray(steps)) return null;
  for (const s of steps) if (s?.finalQuote) return s.finalQuote;
  const sorted = [...steps].sort((a, b) => (b?.sequenceNumber || 0) - (a?.sequenceNumber || 0));
  for (const s of sorted) if (s?.finalQuote) return s.finalQuote;
  return null;
}

/**
 * Resolve an amount to charge from a Livn quote, handling the 4 different
 * product-pricing shapes we see in practice. Returns { amount, currency }
 * where amount is a "12.34" string suitable for Braintree transaction.sale,
 * or null if no sensible amount can be derived.
 *
 * Lookup order:
 *   1. grossTotal / total / netTotal at the quote root.
 *   2. Sum of lineItems[].grossTotal (or grossPerUnit × quantity).
 *   3. First numeric price-like field we can find at the root.
 *
 * Each candidate is run through toUsd(); if that succeeds we charge USD
 * (matches the site's USD-everywhere display). If FX rates aren't loaded
 * or the currency isn't in the rates table, we fall back to the raw
 * amount in its native currency so the auth isn't blocked on FX.
 */
function resolveChargeAmount(quote, toUsd) {
  if (!quote || typeof quote !== 'object') return null;

  const candidates = [];

  const rootTotal = quote.grossTotal || quote.total || quote.netTotal;
  if (rootTotal) candidates.push(rootTotal);

  const items = Array.isArray(quote.lineItems) ? quote.lineItems
              : Array.isArray(quote.items) ? quote.items : [];
  if (items.length) {
    let sum = 0;
    let currency = null;
    let ok = true;
    for (const li of items) {
      const lineTotal = li.grossTotal || li.totalPrice || li.price;
      if (lineTotal && Number.isFinite(Number(lineTotal.amount))) {
        sum += Number(lineTotal.amount);
        currency = currency || lineTotal.currency;
        continue;
      }
      const unit = li.grossPerUnit || li.netPerUnit || li.unitPrice;
      const qty = Number(li.quantity ?? 1);
      if (unit && Number.isFinite(Number(unit.amount)) && Number.isFinite(qty)) {
        sum += Number(unit.amount) * qty;
        currency = currency || unit.currency;
        continue;
      }
      ok = false;
      break;
    }
    if (ok && sum > 0) candidates.push({ amount: sum, currency: currency || 'USD' });
  }

  for (const key of ['finalPrice', 'price', 'amount', 'totalAmount']) {
    const v = quote[key];
    if (v && typeof v === 'object' && Number.isFinite(Number(v.amount))) {
      candidates.push(v);
    } else if (Number.isFinite(Number(v))) {
      candidates.push({ amount: Number(v), currency: quote.currency || 'USD' });
    }
  }

  for (const c of candidates) {
    const amt = Number(c.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;

    const usd = toUsd(c);
    if (Number.isFinite(usd) && usd > 0) {
      return { amount: usd.toFixed(2), currency: 'USD' };
    }
    return { amount: amt.toFixed(2), currency: c.currency || 'USD' };
  }

  return null;
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
