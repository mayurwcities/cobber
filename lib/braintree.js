// Server-only Braintree gateway factory. Never import this from a client
// component — it pulls in node-only deps and references private keys.

import braintree from 'braintree';

let cachedGateway = null;

export function getGateway() {
  if (cachedGateway) return cachedGateway;

  const envName = (process.env.BRAINTREE_ENVIRONMENT || 'Sandbox').toLowerCase();
  const environment =
    envName === 'production' ? braintree.Environment.Production : braintree.Environment.Sandbox;

  cachedGateway = new braintree.BraintreeGateway({
    environment,
    merchantId: process.env.BRAINTREE_MERCHANT_ID,
    publicKey:  process.env.BRAINTREE_PUBLIC_KEY,
    privateKey: process.env.BRAINTREE_PRIVATE_KEY,
  });
  return cachedGateway;
}

export function ok(data) {
  return Response.json({ success: true, data });
}

export function fail(code, message, status = 400, details) {
  return Response.json(
    { success: false, error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}
