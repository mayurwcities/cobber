'use client';

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-3 text-ink-500 text-sm py-10 justify-center">
      <svg className="animate-spin h-5 w-5 text-brand-700" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
      </svg>
      <span className="font-medium">{label}</span>
    </div>
  );
}

export function Empty({ label = 'Nothing to show.' }) {
  return (
    <div className="card p-10 text-center space-y-3">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 grid place-items-center ring-1 ring-brand-100">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="text-sm muted">{label}</div>
    </div>
  );
}

/**
 * User-friendly error banner. Maps raw `{code, message, details}` shapes to
 * plain-English titles + short explanations.
 *
 * Props:
 *   error     — the error object from apiGet/apiPost (or any {code, message, details})
 *   onRetry   — optional callback; renders a "Try again" button when provided
 *   variant   — 'inline' (default) or 'card' (full-width card with padding)
 */
export function ErrorBox({ error, onRetry, variant = 'inline' }) {
  if (!error) return null;

  const { title, message, hint } = prettify(error);
  const wrap = variant === 'card'
    ? 'rounded-lg border border-red-200 bg-red-50 p-4 shadow-sm'
    : 'rounded-md border border-red-200 bg-red-50 p-3';

  return (
    <div className={wrap} role="alert">
      <div className="flex items-start gap-3">
        <WarnIcon />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-red-900">{title}</div>
          {message ? <div className="text-sm text-red-800 mt-0.5 whitespace-pre-wrap">{message}</div> : null}
          {hint ? <div className="text-xs text-red-700 mt-1">{hint}</div> : null}

          {onRetry ? (
            <div className="mt-2">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 text-xs font-medium text-red-900 hover:text-red-700 underline underline-offset-2"
              >
                ↻ Try again
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WarnIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-red-500 shrink-0 mt-0.5" aria-hidden>
      <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ----- prettify ------------------------------------------------------

/**
 * Look at a raw error and return a user-friendly title/message/hint.
 */
function prettify(err) {
  const code    = err?.code || err?.error?.code || '';
  const rawMsg  = err?.message || err?.error?.message || '';
  const details = err?.details || err?.error?.details || null;

  // Livn's "customerErrorMessage" is already phrased for end-users. Prefer it.
  const livnCustomer = details?.error?.customerErrorMessage;
  const terminated   = details?.error?.terminateTransaction === true;

  if (livnCustomer) {
    return {
      title:   terminated ? 'This booking can\'t continue' : 'Please review your entries',
      message: livnCustomer,
      hint:    terminated
        ? 'The reservation system has rejected this flow. Try a different product or date.'
        : 'Fix the fields above and try again.',
    };
  }

  const CATALOG = {
    not_found: {
      title: "We couldn't find that",
      message: 'The product, flow, or booking you\'re looking for doesn\'t exist, or it\'s not available to your account.',
    },
    invalid_request: {
      title: 'Some required info is missing',
      message: rawMsg || 'Please fill in all required fields and try again.',
    },
    unauthorized: {
      title: 'Not authorized',
      message: 'Your API key is missing or incorrect. Check your .env configuration.',
    },
    cache_sync_failed: {
      title: "Couldn't refresh the catalog",
      message: 'We had trouble syncing with the tour provider. Please wait a moment and try again.',
    },
    export_failed: {
      title: "Couldn't export the catalog",
      message: rawMsg.includes('writable') || rawMsg.includes('Cannot open')
        ? rawMsg
        : 'The server couldn\'t write the CSV file.',
      hint: rawMsg.includes('writable') || rawMsg.includes('Cannot open')
        ? 'Usually a permissions issue on the server. Make storage/exports writable (chmod 775).'
        : null,
    },
    proxy_unreachable: {
      title: "Can't reach the booking service",
      message: 'The backend server isn\'t responding.',
      hint: 'If you\'re running locally, check that php -S is still up on the configured port.',
    },
    upstream_error: {
      title: 'The tour system is temporarily unavailable',
      message: 'The supplier\'s reservation system is having trouble. Please try again in a minute.',
    },
    livn_error: {
      title: 'The tour system rejected that request',
      message: rawMsg || 'Please review the details and try again.',
    },
    internal_error: {
      title: 'Something went wrong on our side',
      message: 'A technical error occurred. If this keeps happening, please contact support.',
    },
    bootstrap_failed: {
      title: 'Service configuration error',
      message: 'The backend couldn\'t start. Check the server logs.',
    },
    bad_json: {
      title: 'Unexpected response',
      message: 'The server returned something unreadable.',
    },
    payment_not_ready: {
      title: 'Payment form is still loading',
      message: rawMsg || 'Give it a second and try again.',
    },
    payment_invalid: {
      title: 'Please check your card details',
      message: rawMsg || 'One of the card fields looks wrong. Review the highlighted fields and try again.',
    },
    authorization_failed: {
      title: 'Card authorization declined',
      message: rawMsg || 'Your bank declined the authorization. Try another card or contact your issuer.',
    },
    duplicate_transaction: {
      title: 'Duplicate transaction blocked',
      message: 'Braintree blocks identical amount + card combinations within ~30 seconds.',
      hint: 'Wait 30 seconds and try again, or disable Duplicate Transaction Checking in the Braintree control panel (Settings → Processing).',
    },
    cvv_mismatch: {
      title: 'CVV did not match',
      message: rawMsg || 'The 3 or 4-digit security code on the back of the card was rejected by the issuing bank.',
      hint: 'Double-check the CVV and try again, or use a different card.',
    },
    avs_mismatch: {
      title: 'Billing address did not match',
      message: rawMsg || 'The address on file with the issuing bank did not match what we sent.',
      hint: 'Verify the billing address with your card issuer, or try a different card.',
    },
    fraud_suspected: {
      title: 'Card blocked by fraud check',
      message: rawMsg || 'This transaction was blocked by our fraud-prevention rules.',
      hint: 'Please use a different payment method. If you believe this is in error, contact support.',
    },
    card_verification_required: {
      title: 'Card needs verification',
      message: rawMsg || 'The issuing bank requires additional verification (e.g. 3-D Secure).',
      hint: 'Try again, or use a different card that does not require verification.',
    },
    insufficient_funds: {
      title: 'Insufficient funds',
      message: rawMsg || 'The card does not have enough available funds for this charge.',
      hint: 'Try a different card or add funds to the card.',
    },
    capture_failed: {
      title: 'Booking confirmed — payment needs follow-up',
      message: rawMsg || 'Your booking went through, but we could not charge your card after several attempts.',
      hint: 'Your ticket is valid. Please contact support with the transaction reference shown above so they can complete the charge.',
    },
    no_amount: {
      title: 'Could not determine the amount to charge',
      message: rawMsg || 'We couldn\'t read a price from the quote. Please go back a step and retry.',
    },
    invalid_amount: {
      title: 'Invalid amount',
      message: rawMsg || 'The amount to charge is not valid.',
    },
    missing_nonce: {
      title: 'Missing payment token',
      message: rawMsg || 'The card form didn\'t produce a payment token. Please re-enter your card.',
    },
    braintree_error: {
      title: 'Payment provider error',
      message: rawMsg || 'The payment provider returned an error. Please try again.',
    },
    booking_incomplete: {
      title: 'Please complete the booking details',
      message: rawMsg || 'Fill in all required fields before continuing to payment.',
    },
    booking_not_confirmed: {
      title: "Booking didn't go through",
      message: rawMsg || 'The booking could not be confirmed. Any card hold has been released.',
      hint: 'Please re-enter your card details before retrying.',
    },
    step_failed: {
      title: 'Please review your entries',
      message: rawMsg || 'Fix the highlighted step and try again.',
      hint: 'Your card has not been charged — any hold has been released. Please re-enter your card details before retrying.',
    },
  };

  const preset = CATALOG[code];
  if (preset) {
    return {
      title:   preset.title,
      message: preset.message,
      hint:    preset.hint || null,
    };
  }

  // Unknown code — degrade gracefully
  return {
    title:   'Something went wrong',
    message: rawMsg || String(err),
    hint:    null,
  };
}
