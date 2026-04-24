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
 * plain-English titles + short explanations. Technical details are hidden
 * behind a disclosure toggle so they don't scare non-technical users.
 *
 * Props:
 *   error     — the error object from apiGet/apiPost (or any {code, message, details})
 *   onRetry   — optional callback; renders a "Try again" button when provided
 *   variant   — 'inline' (default) or 'card' (full-width card with padding)
 */
export function ErrorBox({ error, onRetry, variant = 'inline' }) {
  if (!error) return null;

  const { title, message, hint, showDetails } = prettify(error);
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

          <div className="flex items-center gap-3 mt-2">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 text-xs font-medium text-red-900 hover:text-red-700 underline underline-offset-2"
              >
                ↻ Try again
              </button>
            ) : null}
            {showDetails ? (
              <details className="text-xs text-red-700">
                <summary className="cursor-pointer select-none">Technical details</summary>
                <pre className="mt-1 p-2 bg-white/80 rounded text-[11px] overflow-x-auto whitespace-pre-wrap break-words">
{JSON.stringify(showDetails, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
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
 * Look at a raw error and return a user-friendly title/message/hint and
 * the technical details blob to disclose on demand.
 */
function prettify(err) {
  const code    = err?.code || err?.error?.code || '';
  const status  = err?.status;
  const rawMsg  = err?.message || err?.error?.message || '';
  const details = err?.details || err?.error?.details || null;

  // Livn's "customerErrorMessage" is already phrased for end-users. Prefer it.
  const livnCustomer = details?.error?.customerErrorMessage;
  const livnInternal = details?.error?.internalErrorMessage;
  const terminated   = details?.error?.terminateTransaction === true;

  if (livnCustomer) {
    return {
      title:   terminated ? 'This booking can\'t continue' : 'Please review your entries',
      message: livnCustomer,
      hint:    terminated
        ? 'The reservation system has rejected this flow. Try a different product or date.'
        : 'Fix the fields above and try again.',
      showDetails: { code, status, internal: livnInternal, ...details },
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
  };

  const preset = CATALOG[code];
  if (preset) {
    return {
      title:   preset.title,
      message: preset.message,
      hint:    preset.hint || null,
      showDetails: { code, status, message: rawMsg, ...(details ? { details } : {}) },
    };
  }

  // Unknown code — degrade gracefully
  return {
    title:   'Something went wrong',
    message: rawMsg || String(err),
    hint:    null,
    showDetails: { code: code || 'unknown', status, ...(details ? { details } : {}) },
  };
}
