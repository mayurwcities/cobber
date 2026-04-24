import { getGateway, ok, fail } from '@/lib/braintree';

export async function GET() {
  return generate();
}

export async function POST() {
  return generate();
}

async function generate() {
  try {
    const gateway = getGateway();
    const res = await gateway.clientToken.generate({});
    if (!res.success || !res.clientToken) {
      return fail('token_generation_failed', res.message || 'Could not generate client token', 500);
    }
    return ok({ clientToken: res.clientToken });
  } catch (err) {
    return fail('braintree_error', String(err?.message || err), 500);
  }
}
