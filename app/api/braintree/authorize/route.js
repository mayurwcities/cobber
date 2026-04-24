import { getGateway, ok, fail } from '@/lib/braintree';

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return fail('bad_json', 'Invalid JSON body'); }

  const { nonce, amount, flowId } = body || {};
  if (!nonce) return fail('missing_nonce', 'Payment method nonce is required');

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return fail('invalid_amount', 'A positive amount is required');
  }

  try {
    const gateway = getGateway();
    // Flow id is put in orderId so it's queryable in Braintree without
    // requiring a pre-registered custom field in the merchant dashboard.
    const orderId = flowId ? String(flowId).slice(0, 255) : undefined;
    const result = await gateway.transaction.sale({
      amount: amt.toFixed(2),
      paymentMethodNonce: nonce,
      ...(orderId ? { orderId } : {}),
      options: {
        // Auth-only: puts a hold on the card without capturing. We capture
        // later from /api/braintree/capture once the booking is confirmed.
        submitForSettlement: false,
      },
    });

    if (!result.success || !result.transaction) {
      // Map Braintree's gatewayRejectionReason / processor responses
      // onto specific error codes so the UI can give the customer a
      // useful next step instead of the generic "declined". Anything
      // returned here means the booking was NEVER attempted — Livn is
      // only called after a successful authorization.
      const reason = result.transaction?.gatewayRejectionReason;
      const processorCode = result.transaction?.processorResponseCode;
      const processorText = result.transaction?.processorResponseText;
      const sharedDetails = {
        gatewayRejectionReason: reason,
        processorResponseCode: processorCode,
        processorResponseText: processorText,
        transactionId: result.transaction?.id,
      };

      if (reason === 'duplicate') {
        return fail(
          'duplicate_transaction',
          'Braintree flagged this as a duplicate of a recent transaction.',
          402,
          sharedDetails,
        );
      }
      if (reason === 'cvv') {
        return fail(
          'cvv_mismatch',
          'The security code (CVV) on the back of the card did not match.',
          402, sharedDetails,
        );
      }
      if (reason === 'avs' || reason === 'avs_and_cvv') {
        return fail(
          'avs_mismatch',
          'The billing address on file with the issuing bank did not match.',
          402, sharedDetails,
        );
      }
      if (reason === 'fraud' || reason === 'risk_threshold') {
        return fail(
          'fraud_suspected',
          'This card was blocked by our fraud-prevention rules.',
          402, sharedDetails,
        );
      }
      if (reason === 'three_d_secure' || reason === 'token_issuance') {
        return fail(
          'card_verification_required',
          'This card needs additional verification with the issuing bank.',
          402, sharedDetails,
        );
      }

      // Insufficient funds is the most common processor decline.
      if (processorCode === '2001') {
        return fail(
          'insufficient_funds',
          'The card was declined for insufficient funds.',
          402, sharedDetails,
        );
      }

      // Generic processor / issuer decline — fall back to the
      // processor's own text so the customer knows it came from the
      // bank, not us.
      return fail(
        'authorization_failed',
        processorText || result.message || 'The issuing bank declined this card.',
        402,
        sharedDetails,
      );
    }

    return ok({
      transactionId: result.transaction.id,
      status: result.transaction.status,
      amount: result.transaction.amount,
      currency: result.transaction.currencyIsoCode,
    });
  } catch (err) {
    return fail('braintree_error', String(err?.message || err), 500);
  }
}
