'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiGet, apiPut, apiPost, cacheFlow, pickTotal, getProductMarkup, applyMarkup } from '@/lib/api';
import { scrollToElement } from '@/lib/scroll';
import { useMoney } from '@/components/MoneyProvider';
import { Loading, ErrorBox } from '@/components/States';
import FlowStepper from '@/components/FlowStepper';
import FareSelector from '@/components/FareSelector';
import QuestionRenderer, { questionNumericBounds, walkActiveQuestions, isDobQuestion, todayIso } from '@/components/QuestionRenderer';
import QuoteView from '@/components/QuoteView';
import BraintreeDropIn from '@/components/BraintreeDropIn';

export default function CheckoutPage() {
  const { flowId } = useParams();
  const router = useRouter();
  const { formatUsd, toUsd, setBookingCurrency, setBookingMarkup } = useMoney();

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

  // Net-rate products: the supplier price is what we owe Livn, and we tack on
  // a flat commission for the customer-facing price. Applied uniformly to fare
  // selector display, server-quote display, and the Braintree auth so every
  // visible/charged number agrees.
  const markup = getProductMarkup(flow?.product);

  // Display currency in checkout follows the user's catalog-wide header
  // preference (preferredDisplayCurrency). The booking currency Livn settles
  // in is recorded as flow.currency and submitted as part of the flow, but
  // visually we keep prices in whatever the user chose to browse in — FX
  // handles the conversion. The Braintree authorize amount is computed via
  // toUsd() separately, so the actual card charge is always USD-equivalent
  // regardless of what's shown.
  //
  // We DO publish flow.currency as the active "booking currency" though,
  // so MoneyProvider.formatFeeText knows that bare-number prose like
  // "Transfer fee: 12.0" on pickup options is implicitly in flow.currency
  // and converts correctly into the user's display target.
  useEffect(() => {
    if (flow?.currency) setBookingCurrency(flow.currency);
    return () => setBookingCurrency(null);
  }, [flow?.currency, setBookingCurrency]);

  // Same idea for the net-rate markup. Pickup-option feeDescription strings
  // come back as bare numbers (no currency, no markup) — the user-visible
  // line item gets marked up in QuoteView, so the dropdown needs to match.
  // Publishing the markup here lets formatFeeText apply it consistently.
  useEffect(() => {
    setBookingMarkup(markup);
    return () => setBookingMarkup(0);
  }, [markup, setBookingMarkup]);

  // Salzburg-style products ask "how many passengers?" before fare selection.
  // Once that's answered, the FARE_SELECTION step needs to honour that count
  // — total fares (Adult + Child + Infant + …) shouldn't be allowed to
  // exceed the chosen number. Pull the answer off the DONE PAX_COUNT step
  // here so we can pass it through to FareSelector.
  const paxCap = useMemo(() => findPaxCount(flow), [flow]);

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
      // Only send answers for questions that are CURRENTLY reachable on this
      // step. walkActiveQuestions follows option-gated follow-ups (e.g. the
      // Frequent Flyer Number that lives inside the YES option). If the user
      // picked YES, filled the regex, then flipped to NO, the stale follow-up
      // answer still lives in the React answers map — without this filter we
      // would send it to Livn and trip "Unknown questionUuid".
      const activeUuids = new Set();
      for (const g of step.questions.questionGroups || []) {
        for (const top of g.questions || []) {
          for (const aq of walkActiveQuestions(top, answers)) {
            activeUuids.add(aq.uuid);
          }
        }
      }
      step.answers = {
        answers: Object.entries(answers)
          .filter(([uuid, v]) =>
            activeUuids.has(uuid) &&
            v !== undefined && v !== null && v !== '' &&
            !(Array.isArray(v) && v.length === 0)
          )
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

    // Client-side validation runs on EVERY forward submit, not just the
    // confirm-booking step — that way fare-selection violations
    // (unitsMultipleOf, unitsMin) and regex-format violations on questions
    // produce an inline error before we even hit the server, instead of
    // waiting for Livn to fail the step and round-tripping back.
    if (!back) {
      const validationIssue = validateStep(step, fareSel, answers, paxCap);
      if (validationIssue) {
        setSubmitting(false);
        setError({ code: 'booking_incomplete', message: validationIssue.message });
        if (validationIssue.questionUuid && typeof document !== 'undefined') {
          const el = document.getElementById('q_' + validationIssue.questionUuid);
          if (el) {
            scrollToElement(el, 120);
            setTimeout(() => { try { el.focus({ preventScroll: true }); } catch {} }, 350);
          }
        }
        return;
      }
    }

    if (needsPayment) {
      // ------------------------------------------------------------
      // Authorize-then-void still leaves a visible auth in the Braintree
      // dashboard and may briefly tie up the customer's available balance,
      // so we only charge if the booking side is fully ready (above check).
      // ------------------------------------------------------------

      // The confirm-booking step is sometimes FINAL_QUOTE (simple products)
      // and sometimes TEMPORARY_HOLD (complex products) — the latter has no
      // finalQuote on itself, so scan the whole flow for the latest quote.
      const quote = step.finalQuote || findQuoteInFlow(flow);
      const charge = resolveChargeAmount(quote, toUsd, markup);
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
      cacheFlow(flowId, res.data);
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
        cacheFlow(flowId, res.data);
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

    cacheFlow(flowId, res.data);
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
          markup={markup}
          paxCap={paxCap}
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

function StepView({ step, flow, fareSel, setFareSel, addOnSel, setAddOnSel, answers, setAnswers, onNext, onBack, onPreview, submitting, payStatus, error, errorRef, dropinRef, canPay, onRequestableChange, cooldownUntil, markup = 0, paxCap = null }) {
  const { formatUsd } = useMoney();
  const hasFares = !!step.fareDetails;
  const hasQuestions = !!step.questions?.questionGroups?.length;
  const hasQuote = !!step.finalQuote;
  const needsPayment = step.nextStepConfirmedBooking === true;
  // On TEMPORARY_HOLD steps the finalQuote lives on a previous (DONE) step,
  // so reach back into the flow so the "Authorizing $X" label stays accurate.
  const payableQuote = step.finalQuote || (needsPayment ? findQuoteInFlow(flow) : null);
  const totalPrice = payableQuote ? applyMarkup(pickTotal(payableQuote), markup) : null;
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

  // Pretty milestone label so the section header reads "Choose your tickets"
  // instead of "FARE_SELECTION". Fall back to whatever Livn supplied if we
  // don't have a friendly mapping. Special case TEMPORARY_HOLD: when the
  // server didn't attach any questions to the hold step, our default copy
  // ("a few last questions") is misleading — use the step's own caption.
  let milestoneLabel = MILESTONE_LABELS[step.milestone] || step.caption || step.milestone || step.stepName || 'Step';
  if (step.milestone === 'TEMPORARY_HOLD' && !hasQuestions) {
    milestoneLabel = 'Confirm your booking';
  }

  return (
    <div className="space-y-4">
      {/* Step header card — milestone, sub-caption, expiry countdown, and any
          inline error. Always rendered so the user sees where they are even
          when the step itself has no input. */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-brand-700 uppercase tracking-wider">
              Step {step.sequenceNumber || ''} · {step.milestone || step.stepName}
            </div>
            <h2 className="text-xl font-semibold mt-0.5">{milestoneLabel}</h2>
            {step.caption && step.caption !== milestoneLabel ? (
              <p className="text-sm text-slate-600 mt-1">{step.caption}</p>
            ) : null}
          </div>
          {remainingMs !== null ? (
            <div className={
              'badge text-sm shrink-0 ' +
              (remainingMs < 60000 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800')
            }>
              ⏱ Expires in {mins}m {String(secs).padStart(2, '0')}s
            </div>
          ) : null}
        </div>

        <div ref={errorRef} className="scroll-mt-24">
          {error ? (
            <div className="mt-4"><ErrorBox error={error} /></div>
          ) : step.status === 'FAILED' && step.error ? (
            <div className="mt-4"><ErrorBox error={{ code: 'step_failed', message: step.error.customerErrorMessage || step.error.internalErrorMessage, details: step.error }} /></div>
          ) : null}
        </div>

        {!hasFares && !hasQuestions && !hasQuote && !needsPayment ? (
          <p className="text-sm text-slate-600 mt-4">
            No additional input needed — just continue.
          </p>
        ) : null}
      </section>

      {/* Each interaction surfaces in its own titled section card so users
          can scan the page top-to-bottom: tickets → details → quote → pay. */}
      {hasFares ? (
        <SectionCard
          eyebrow="Step A"
          title="Choose your tickets"
          subtitle="Pick a variant, time slot, and the fares for your party."
        >
          <FareSelector
            fareDetails={step.fareDetails}
            selections={fareSel}
            onChange={setFareSel}
            addOns={addOnSel}
            onAddOnChange={setAddOnSel}
            markup={markup}
            paxCap={paxCap}
          />
        </SectionCard>
      ) : null}

      {hasQuestions ? (
        <SectionCard
          eyebrow={hasFares ? 'Step B' : 'Step A'}
          title={questionSectionTitle(step)}
          subtitle="Required fields are marked with *."
        >
          <div className="space-y-8">
            {step.questions.questionGroups.map((g, gi) => {
              // Highlight question groups that branch the flow (e.g. the
              // "ask questions in TEMPORARY_HOLD step" trigger on Product 2's
              // FINAL_QUOTE) — without a callout it's easy to skim past these
              // among the passenger-detail groups and miss a downstream prompt.
              const isBranchGroup = isBranchingGroup(g);
              const wrapperCls =
                (gi > 0 ? 'pt-6 border-t border-slate-100 ' : '') +
                (isBranchGroup
                  ? 'rounded-lg bg-amber-50/60 ring-1 ring-amber-200 p-4 mt-2'
                  : '');
              return (
                <div key={gi} className={wrapperCls}>
                  {g.caption ? (
                    <h4 className={
                      'font-semibold mb-3 ' +
                      (isBranchGroup ? 'text-amber-900' : 'text-slate-800')
                    }>
                      {isBranchGroup ? '⚑ ' : ''}{g.caption}
                    </h4>
                  ) : null}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    {(g.questions || []).map((q) => (
                      <QuestionRenderer
                        key={q.uuid}
                        question={q}
                        value={answers[q.uuid]}
                        // Functional setState so browser autofill / rapid typing
                        // doesn't drop values via stale closure over `answers`.
                        onChange={(v) => setAnswers((prev) => ({ ...prev, [q.uuid]: v }))}
                        // Pass the full answers map + a generic setter so
                        // SELECT_SINGLE can render any follow-up questions
                        // attached to the selected option (e.g. Salzburg's
                        // Frequent Flyer Number) into the same answers store.
                        answers={answers}
                        setAnswer={(uuid, v) => setAnswers((prev) => ({ ...prev, [uuid]: v }))}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      ) : null}

      {hasQuote ? (
        <SectionCard
          eyebrow="Review"
          title="Your booking summary"
          subtitle="Final price including taxes and surcharges."
        >
          <QuoteView quote={step.finalQuote} markup={markup} />
        </SectionCard>
      ) : null}

      {needsPayment ? (
        <SectionCard
          eyebrow="Payment"
          title="Card details"
          subtitle={totalUsdDisplay ? `You'll be charged ${totalUsdDisplay} when you confirm.` : 'Enter your card to confirm the booking.'}
        >
          <BraintreeDropIn
            ref={dropinRef}
            amount={totalUsdDisplay}
            onRequestableChange={onRequestableChange}
          />
        </SectionCard>
      ) : null}

      {/* Sticky action bar — keeps Continue / Confirm in reach no matter
          how long the form is. */}
      <div className="sticky bottom-0 -mx-2 px-2 py-3 bg-gradient-to-t from-white via-white to-transparent">
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
    </div>
  );
}

// Friendly label for each Livn milestone. Falls back to step.caption then
// the raw enum name in StepView when no entry exists.
const MILESTONE_LABELS = {
  FARE_SELECTION: 'Choose your tickets',
  PASSENGER_DETAILS: 'Passenger details',
  PICKUP_DROPOFF: 'Pickup & drop-off',
  PICKUP_DETAILS: 'Pickup & drop-off',
  PAX_COUNT: 'How many travellers?',
  FINAL_QUOTE: 'Review your booking',
  TEMPORARY_HOLD: 'Almost there — a few last questions',
  CONFIRMED_BOOKING: 'Confirm and pay',
};

// A "branching" group is one whose answers change the shape of later steps
// (e.g. Product 2's "Ask questions in the TEMPORARY_HOLD step" trigger, or
// the frequent-flyer YES/NO that adds a regex follow-up). Detect by group
// caption keywords and by the presence of a BOOLEAN question — not perfect,
// but good enough to surface the group with an amber callout so the user
// doesn't skim past it.
function isBranchingGroup(group) {
  const cap = String(group?.caption || '').toLowerCase();
  if (/temporary[_\s]?hold|frequent\s*flyer|conditional|optional\s+question/.test(cap)) {
    return true;
  }
  const qs = group?.questions || [];
  if (qs.length === 1 && String(qs[0]?.answerType || '').toUpperCase() === 'BOOLEAN') {
    return true;
  }
  return false;
}

function questionSectionTitle(step) {
  const m = step.milestone || '';
  if (m.includes('PASSENGER')) return 'Passenger details';
  if (m.includes('PICKUP')) return 'Pickup & drop-off';
  if (m === 'PAX_COUNT') return 'Number of travellers';
  if (m === 'TEMPORARY_HOLD') return 'A few final questions';
  if (m === 'FARE_SELECTION') return 'A few more details';
  return 'Tell us more';
}

function SectionCard({ eyebrow, title, subtitle, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-200 bg-slate-50/60">
        {eyebrow ? (
          <div className="text-[10px] font-semibold text-brand-700 uppercase tracking-widest">
            {eyebrow}
          </div>
        ) : null}
        <h3 className="text-base font-semibold text-slate-900 mt-0.5">{title}</h3>
        {subtitle ? (
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        ) : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/**
 * Return { message, questionUuid? } describing the first validation
 * problem on the current step, or null if the step is ready to submit.
 * Runs BEFORE we hit Braintree so an incomplete form never creates an
 * authorization in the first place.
 */
function validateStep(step, fareSel, answers, paxCap = null) {
  if (step.fareDetails) {
    const totalQty = Object.values(fareSel || {}).reduce((n, v) => n + Number(v || 0), 0);
    if (totalQty < 1) return { message: 'Please choose at least one ticket before paying.' };

    // Per-fare constraints. Walk the same fareDetails tree the FareSelector
    // renders. Without these checks Livn returns step.error after submit on
    // products like Salzburg (twin fare with unitsMultipleOf=2) — better to
    // catch client-side before we burn a Braintree authorization.
    const constraintIssue = validateFareConstraints(step.fareDetails, fareSel);
    if (constraintIssue) return constraintIssue;

    // PAX_COUNT cap. Salzburg-style products ask the user up front how many
    // travellers they have; the sum of selected fares must equal that number,
    // not just stay below it (Livn rejects an under-count too).
    if (paxCap != null && Number.isFinite(paxCap)) {
      if (totalQty > paxCap) {
        return { message: `You said you're travelling with ${paxCap} ${paxCap === 1 ? 'person' : 'people'}, but selected ${totalQty} fares. Adjust the quantities to match.` };
      }
      if (totalQty < paxCap) {
        return { message: `You said you're travelling with ${paxCap} ${paxCap === 1 ? 'person' : 'people'}, but only ${totalQty} ${totalQty === 1 ? 'is' : 'are'} selected. Pick fares for everyone before continuing.` };
      }
    }
  }
  const groups = step.questions?.questionGroups || [];
  for (const g of groups) {
    for (const topQ of g.questions || []) {
      // Walk the question AND any follow-up questions reachable through the
      // currently-selected option (Salzburg's Frequent Flyer Number is a
      // 10-digit regex TEXT field that appears once the user picks "Yes" on
      // the parent SELECT_SINGLE — it lives inside that option's payload).
      for (const q of walkActiveQuestions(topQ, answers)) {
        const issue = validateOneQuestion(q, answers);
        if (issue) return issue;
      }
    }
  }
  return null;
}

// Required / regex / numeric-bounds checks for a single question. Pulled out
// so the same rules apply to top-level AND option-gated follow-up questions.
function validateOneQuestion(q, answers) {
  const v = answers?.[q.uuid];
  const empty =
    v === undefined || v === null || v === '' ||
    (Array.isArray(v) && v.length === 0);
  if (empty) {
    if (!q.required) return null;
    const label = q.title || q.question || 'a required field';
    return {
      message: `Please fill in "${label}" before paying.`,
      questionUuid: q.uuid,
    };
  }
  // Regex validation runs whether the field is required or not — once the
  // user has filled it in it must match. Used by Salzburg's Frequent Flyer
  // follow-up (\d{10}) and any cert Product 4 regex prompt.
  if (q.regex) {
    try {
      const re = new RegExp(q.regex);
      const stringVal = Array.isArray(v) ? v.join(',') : String(v);
      if (!re.test(stringVal)) {
        const label = q.title || q.question || 'this field';
        return {
          message: `"${label}" doesn't match the required format (${q.regex}).`,
          questionUuid: q.uuid,
        };
      }
    } catch (_) {
      // A malformed regex from the supplier should not block submission.
    }
  }
  // Numeric bounds — PAX_COUNT and similar integer questions carry min/max
  // constraints under several different field names depending on the supplier,
  // and sometimes only as prose in the description. questionNumericBounds()
  // tries every shape so we and the renderer never disagree.
  const t = String(q.answerType || '').toUpperCase();
  if (t === 'NUMBER' || t === 'INTEGER' || t === 'DECIMAL' || t === 'FLOAT') {
    const num = Number(v);
    if (Number.isFinite(num)) {
      const { min: lo, max: hi } = questionNumericBounds(q);
      const label = q.title || q.question || 'value';
      if (lo != null && num < lo) {
        return { message: `"${label}" must be at least ${lo}.`, questionUuid: q.uuid };
      }
      if (hi != null && num > hi) {
        return { message: `"${label}" can't be more than ${hi}.`, questionUuid: q.uuid };
      }
    }
  }
  // Date-of-birth questions can't be in the future. The DateField renderer
  // already caps the calendar picker via max=today, but a manually-typed
  // value can still slip past — block it here before submit.
  if (t === 'DATE' && isDobQuestion(q) && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    if (String(v) > todayIso()) {
      const label = q.title || q.question || 'Date of birth';
      return { message: `"${label}" can't be in the future.`, questionUuid: q.uuid };
    }
  }
  return null;
}

// Salzburg-style products gate FARE_SELECTION on a pre-step asking how many
// travellers there are (stepName === 'PAX_COUNT'). Read its answer off the
// flow so we can cap fare-quantity steppers and validate the totals match.
// Returns an integer or null if no PAX_COUNT step has been answered yet.
function findPaxCount(flow) {
  for (const s of flow?.steps || []) {
    if (s?.stepName !== 'PAX_COUNT') continue;
    if (s.status !== 'DONE') continue;
    const ans = s.answers?.answers?.[0];
    if (!ans) continue;
    const n = Number(ans.value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// Walk the fareDetails tree and check every selected fare against its own
// unitsMin / unitsMax / unitsAvailable / unitsMultipleOf. Returns the first
// failure, or null.
function validateFareConstraints(fareDetails, fareSel) {
  const sel = fareSel || {};
  for (const bv of fareDetails.baseVariants || []) {
    for (const ts of bv.timeSlots || []) {
      for (const f of ts.fares || []) {
        const qty = Number(sel[f.uuid] || 0);
        if (!qty) continue;
        const min = Number(f.unitsMin ?? 0);
        const max = Math.min(Number(f.unitsAvailable ?? 99), Number(f.unitsMax ?? 99));
        const step = Number(f.unitsMultipleOf ?? 1);
        const label = f.name || 'this fare';
        if (qty < min) {
          return { message: `"${label}" requires at least ${min} units.` };
        }
        if (qty > max) {
          return { message: `"${label}" allows at most ${max} units.` };
        }
        if (step > 1 && qty % step !== 0) {
          return { message: `"${label}" must be booked in multiples of ${step}.` };
        }
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
function resolveChargeAmount(quote, toUsd, markup = 0) {
  if (!quote || typeof quote !== 'object') return null;

  const items = Array.isArray(quote.lineItems) ? quote.lineItems
              : Array.isArray(quote.items) ? quote.items : [];

  // Per-line-item markup: only items flagged resSuppliedPriceIsNetRate get
  // marked up, matching what QuoteView shows the customer. Falls back to
  // root-total × markup if line items don't add up cleanly.
  if (items.length) {
    let sum = 0;
    let currency = null;
    let ok = true;
    for (const li of items) {
      const isNet = !!li?.salesComputationDetails?.resSuppliedPriceIsNetRate;
      const m = isNet ? markup : 0;
      const lineTotal = li.grossTotal || li.totalPrice || li.price;
      if (lineTotal && Number.isFinite(Number(lineTotal.amount))) {
        sum += Number(lineTotal.amount) * (1 + m);
        currency = currency || lineTotal.currency;
        continue;
      }
      const unit = li.grossPerUnit || li.netPerUnit || li.unitPrice;
      const qty = Number(li.quantity ?? 1);
      if (unit && Number.isFinite(Number(unit.amount)) && Number.isFinite(qty)) {
        sum += Number(unit.amount) * qty * (1 + m);
        currency = currency || unit.currency;
        continue;
      }
      ok = false;
      break;
    }
    if (ok && sum > 0) {
      const c = { amount: sum, currency: currency || 'USD' };
      const usd = toUsd(c);
      if (Number.isFinite(usd) && usd > 0) return { amount: usd.toFixed(2), currency: 'USD' };
      return { amount: sum.toFixed(2), currency: c.currency };
    }
  }

  const candidates = [];
  const rootTotal = quote.grossTotal || quote.total || quote.netTotal;
  if (rootTotal) candidates.push(rootTotal);
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
      return { amount: (usd * (1 + markup)).toFixed(2), currency: 'USD' };
    }
    return { amount: (amt * (1 + markup)).toFixed(2), currency: c.currency || 'USD' };
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
  const { formatUsd, formatUsdText } = useMoney();
  const bookings = flow.bookings || [];
  const flowQuote = findQuoteInFlow(flow);
  const flowMarkup = getProductMarkup(flow.product);
  const flowTotal = flowQuote ? applyMarkup(pickTotal(flowQuote), flowMarkup) : null;

  return (
    <div className="space-y-5">
      {/* Hero confirmation banner — green so the customer immediately knows
          the booking went through, plus the headline numbers/refs they'll
          want at hand. */}
      <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-emerald-800">
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-emerald-600 text-white">✓</span>
              <span className="font-semibold text-lg">Booking confirmed</span>
            </div>
            <div className="text-sm text-emerald-800 mt-2">
              Download your PDF voucher below and keep it handy — you'll need it on the day of the tour.
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span>
                <span className="text-emerald-700/70">Livn reference</span>{' '}
                <span className="font-mono font-semibold text-emerald-900">{flow.livnReference}</span>
              </span>
              {flowTotal ? (
                <span>
                  <span className="text-emerald-700/70">Total paid</span>{' '}
                  <span className="font-semibold text-emerald-900 tabular-nums">{formatUsd(flowTotal)}</span>
                </span>
              ) : null}
            </div>
          </div>
          <div className="text-emerald-700">
            <ShieldCheckIcon />
          </div>
        </div>
      </div>

      {bookings.map((b) => <BookingCard key={b.id} booking={b} formatUsdText={formatUsdText} />)}
    </div>
  );
}

function BookingCard({ booking: b, formatUsdText }) {
  // Travel date can live at the booking root or on the first ticket. Prefer
  // the booking-level field so we don't conflict with multi-day products
  // where individual tickets have their own travel dates.
  const travelDate = b.travelDate
    || b.tickets?.[0]?.travelDate
    || b.tickets?.[0]?.productDetails?.[0]?.startTime;

  const ticketCount = (b.tickets || []).length;
  const totalPax = (b.tickets || []).reduce((n, t) => n + (t.passengerDetails?.length || 0), 0);
  const ticketKind = ticketCount === 1 && totalPax > 1
    ? { label: 'Group ticket', tone: 'bg-indigo-100 text-indigo-800' }
    : ticketCount > 1
    ? { label: `${ticketCount} individual tickets`, tone: 'bg-slate-100 text-slate-700' }
    : null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold text-brand-700 uppercase tracking-widest">
              Booking #{b.id}
            </div>
            <h3 className="text-lg font-semibold mt-0.5">{b.productName || `Product ${b.productId}`}</h3>
            <div className="text-sm text-slate-600 mt-1">
              {b.partyName}{b.partyEmailAddress ? ` · ${b.partyEmailAddress}` : ''}
            </div>
          </div>
          {ticketKind ? (
            <span className={'badge ' + ticketKind.tone}>{ticketKind.label}</span>
          ) : null}
        </div>

        {/* Quick-facts strip: travel date, confirmed-at, references */}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
          {travelDate ? (
            <Fact label="Travel date" value={formatDateMaybe(travelDate)} />
          ) : null}
          {b.confirmed ? (
            <Fact label="Confirmed" value={formatDateTimeMaybe(b.confirmed)} />
          ) : null}
          <Fact label="Livn ref" value={b.livnReference} mono />
          {b.supplierReference ? <Fact label="Supplier ref" value={b.supplierReference} mono /> : null}
          {b.clientReference ? <Fact label="Client ref" value={b.clientReference} mono /> : null}
        </div>
      </header>

      <div className="p-5 space-y-5">
        {b.tickets?.length ? (
          <div>
            <h4 className="font-semibold text-sm text-slate-800 mb-3">Your tickets</h4>
            <div className="space-y-3">
              {b.tickets.map((t) => (
                <ConfirmedTicketRow key={t.id} ticket={t} formatUsdText={formatUsdText} />
              ))}
            </div>
          </div>
        ) : null}

        {b.cancellationPolicy?.text ? (
          <details className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm">
            <summary className="cursor-pointer select-none font-medium text-slate-800">
              Cancellation policy
              {b.cancellationPolicy.setAtTimeOfBooking ? (
                <span className="ml-2 badge bg-slate-200 text-slate-700 text-[10px]">set at booking</span>
              ) : null}
            </summary>
            <div className="mt-2 text-slate-700 whitespace-pre-wrap">
              {formatUsdText(b.cancellationPolicy.text)}
            </div>
          </details>
        ) : null}

        {b.externalResources?.length ? (
          <div>
            <h4 className="font-semibold text-sm text-slate-800 mb-2">Additional resources from the supplier</h4>
            <ul className="space-y-1.5 text-sm">
              {b.externalResources.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  <LinkIcon />
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                    {r.title || r.type || r.url}
                  </a>
                  {r.required ? (
                    <span className="badge bg-red-100 text-red-700 text-[10px]">required</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex gap-2 flex-wrap pt-2 border-t border-slate-100">
          <a className="btn-primary" target="_blank" rel="noreferrer" href={`/api/livn/bookings/${b.id}/pdf`}>
            Download voucher PDF
          </a>
          <Link className="btn-secondary" href={`/bookings/${b.id}`}>View full details →</Link>
        </div>
      </div>
    </section>
  );
}

function ConfirmedTicketRow({ ticket: t, formatUsdText }) {
  const paxNames = (t.passengerDetails || []).map((p) => p?.name).filter(Boolean);
  const primaryProduct = (t.productDetails || [])[0];
  const barcodes = Array.isArray(t.barcodes) ? t.barcodes : (t.barcode ? [t.barcode] : []);
  const pickup = t.pickupDetails;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">Ticket #{t.id}</span>
            {t.printRequired ? (
              <span className="badge bg-amber-100 text-amber-800 text-[10px]">Must be printed</span>
            ) : null}
          </div>
          {paxNames.length ? (
            <div className="text-sm text-slate-700">
              <span className="text-slate-500">Passengers: </span>
              {paxNames.join(', ')}
            </div>
          ) : null}
          {primaryProduct?.name ? (
            <div className="text-sm text-slate-600">{primaryProduct.name}</div>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
            {primaryProduct?.startTime ? <span>Starts {primaryProduct.startTime}</span> : null}
            {t.travelDate ? <span>Travel {formatDateMaybe(t.travelDate)}</span> : null}
          </div>
          {t.supplierName ? (
            <div className="text-xs text-slate-500">
              Operated by <span className="font-medium text-slate-700">{t.supplierName}</span>
              {t.supplierEmailRes ? ` · ${t.supplierEmailRes}` : ''}
              {t.supplierPhoneRes ? ` · ${t.supplierPhoneRes}` : ''}
            </div>
          ) : null}
          {barcodes.length ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {barcodes.map((bc, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded bg-slate-100 ring-1 ring-slate-200 px-2 py-0.5 text-[11px]">
                  <span className="text-slate-500">{bc.format || 'Code'}:</span>
                  <span className="font-mono text-slate-800">{bc.content || bc.value}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <a
          href={`/api/livn/tickets/${t.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary shrink-0"
        >
          Ticket PDF
        </a>
      </div>

      {(pickup?.notes || pickup?.dropoffNotes || pickup?.location) ? (
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60 text-xs text-slate-600 space-y-1">
          {pickup.notes ? (
            <div><span className="font-semibold text-slate-700">Pickup:</span> {pickup.notes}</div>
          ) : null}
          {pickup.dropoffNotes ? (
            <div><span className="font-semibold text-slate-700">Drop-off:</span> {pickup.dropoffNotes}</div>
          ) : null}
        </div>
      ) : null}

      {t.specialNotes ? (
        <div className="px-4 py-3 border-t border-amber-100 bg-amber-50/60 text-xs text-amber-900 whitespace-pre-wrap">
          <span className="font-semibold">Important: </span>{formatUsdText(t.specialNotes)}
        </div>
      ) : null}

      {t.localFees ? (
        <div className="px-4 py-3 border-t border-slate-100 bg-amber-50 text-xs text-amber-900">
          <span className="font-semibold">Local fees payable on the day: </span>{formatUsdText(t.localFees)}
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value, mono }) {
  if (value == null || value === '') return null;
  return (
    <span>
      <span className="text-slate-500">{label}:</span>{' '}
      <span className={'font-medium text-slate-800 ' + (mono ? 'font-mono' : '')}>{value}</span>
    </span>
  );
}

function formatDateMaybe(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTimeMaybe(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ShieldCheckIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="text-slate-500 shrink-0">
      <path d="M9 15a4 4 0 0 0 5.66 0l3.18-3.18a4 4 0 0 0-5.66-5.66L11 7.34" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 9a4 4 0 0 0-5.66 0L6.16 12.18a4 4 0 0 0 5.66 5.66L13 16.66" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
