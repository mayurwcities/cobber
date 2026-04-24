import { getGateway, ok, fail } from '@/lib/braintree';

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return fail('bad_json', 'Invalid JSON body'); }

  const { transactionId } = body || {};
  if (!transactionId) return fail('missing_transaction_id', 'transactionId is required');

  try {
    const gateway = getGateway();
    const result = await gateway.transaction.void(String(transactionId));
    if (!result.success) {
      return fail('void_failed', result.message || 'Could not void transaction', 500);
    }
    return ok({
      transactionId: result.transaction.id,
      status: result.transaction.status,
    });
  } catch (err) {
    return fail('braintree_error', String(err?.message || err), 500);
  }
}
