import { getGateway, ok, fail } from '@/lib/braintree';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 800, 2000]; // 0s → 0.8s → 2s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return fail('bad_json', 'Invalid JSON body'); }

  const { transactionId } = body || {};
  if (!transactionId) return fail('missing_transaction_id', 'transactionId is required');

  const gateway = getGateway();
  let lastErr = null;
  let lastMessage = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt]) await sleep(BACKOFF_MS[attempt]);
    try {
      const result = await gateway.transaction.submitForSettlement(String(transactionId));
      if (result.success) {
        return ok({
          transactionId: result.transaction.id,
          status: result.transaction.status,
          attempts: attempt + 1,
        });
      }
      lastMessage = result.message || 'Could not settle transaction';
      // Some failures (e.g. transaction status invalid) won't get better
      // with another attempt. Stop early in that case.
      if (/cannot be submitted|status|invalid/i.test(lastMessage)) break;
    } catch (err) {
      lastErr = err;
    }
  }

  return fail(
    'capture_failed',
    lastMessage || String(lastErr?.message || 'Capture failed after retries'),
    500,
    { attempts: MAX_ATTEMPTS, transactionId },
  );
}
