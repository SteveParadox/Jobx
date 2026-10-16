import type { checkouts } from '@/db/schema';
import { brand, env } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { validHmac } from '@/lib/security';
import Stripe from 'stripe';
export type Provider = 'stripe' | 'paystack';
export type VerifiedPayment = {
  provider: Provider;
  reference: string;
  providerReference: string;
  transactionId: string;
  amount: number;
  currency: string;
  paidAt: Date;
  attemptId: string;
};
export function stripeClient() {
  if (!env.STRIPE_SECRET_KEY) throw new AppError(503, 'Stripe is not configured');
  return new Stripe(env.STRIPE_SECRET_KEY, { timeout: 15000, maxNetworkRetries: 2 });
}
export async function paystack(path: string, method = 'GET', body?: unknown) {
  if (!env.PAYSTACK_SECRET_KEY) throw new AppError(503, 'Paystack is not configured');
  const response = await fetch('https://api.paystack.co' + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) throw new AppError(502, `Paystack returned ${response.status}`);
  const result = await response.json();
  if (!result.status) throw new AppError(502, 'Paystack did not complete the request');
  return result.data;
}
export async function initializeCheckout(attempt: typeof checkouts.$inferSelect, email: string) {
  if (attempt.provider === 'stripe') {
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: attempt.reference,
        customer_email: email,
        metadata: { attemptId: attempt.id },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: attempt.currency.toLowerCase(),
              unit_amount: attempt.amount,
              product_data: {
                name: `${brand.name} employer access · ${attempt.durationDays} days`,
              },
            },
          },
        ],
        success_url: `${brand.url}/employers?checkout=${attempt.id}`,
        cancel_url: `${brand.url}/pricing`,
        expires_at: Math.floor(attempt.expiresAt.getTime() / 1000),
      },
      { idempotencyKey: attempt.id },
    );
    return { url: session.url!, providerReference: session.id };
  }
  if (attempt.provider === 'paystack') {
    const data = await paystack('/transaction/initialize', 'POST', {
      email,
      amount: attempt.amount,
      currency: attempt.currency,
      reference: attempt.reference,
      metadata: { attemptId: attempt.id },
      callback_url: `${brand.url}/employers?checkout=${attempt.id}`,
    });
    return { url: String(data.authorization_url), providerReference: attempt.reference };
  }
  throw new AppError(400, 'Unsupported provider');
}
export async function verifyPayment(
  provider: Provider,
  providerReference: string,
): Promise<VerifiedPayment> {
  if (provider === 'stripe') {
    const session = await stripeClient().checkout.sessions.retrieve(providerReference, {
      expand: ['payment_intent'],
    });
    if (
      session.payment_status !== 'paid' ||
      session.status !== 'complete' ||
      session.mode !== 'payment'
    )
      throw new AppError(409, 'Payment is not complete');
    const intent = session.payment_intent;
    if (!intent || typeof intent === 'string' || intent.status !== 'succeeded')
      throw new AppError(409, 'Payment intent is not settled');
    return {
      provider,
      reference: session.client_reference_id ?? '',
      providerReference: session.id,
      transactionId: intent.id,
      amount: session.amount_total ?? 0,
      currency: session.currency?.toUpperCase() ?? '',
      paidAt: new Date(intent.created * 1000),
      attemptId: session.metadata?.attemptId ?? '',
    };
  }
  const d = await paystack('/transaction/verify/' + encodeURIComponent(providerReference));
  if (d.status !== 'success') throw new AppError(409, 'Payment is not complete');
  return {
    provider,
    reference: String(d.reference),
    providerReference: String(d.reference),
    transactionId: String(d.id),
    amount: Number(d.amount),
    currency: String(d.currency),
    paidAt: new Date(d.paid_at),
    attemptId: String(d.metadata?.attemptId ?? ''),
  };
}
export function verifyWebhook(
  provider: Provider,
  body: string,
  signature: string,
): { reference?: string; refundTransactionId?: string; refundAmount?: number; ignore?: boolean } {
  if (provider === 'stripe') {
    if (!env.STRIPE_WEBHOOK_SECRET) throw new AppError(503, 'Stripe webhooks are not configured');
    let event: Stripe.Event;
    try {
      event = stripeClient().webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new AppError(400, 'Invalid webhook signature');
    }
    if (
      ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(
        event.type,
      )
    )
      return { reference: (event.data.object as Stripe.Checkout.Session).id };
    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      return {
        refundTransactionId:
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id,
        refundAmount: charge.amount_refunded,
      };
    }
    return { ignore: true };
  }
  if (!env.PAYSTACK_SECRET_KEY) throw new AppError(503, 'Paystack webhooks are not configured');
  if (!validHmac(body, signature, env.PAYSTACK_SECRET_KEY))
    throw new AppError(400, 'Invalid webhook signature');
  const event = JSON.parse(body);
  if (event.event === 'charge.success') return { reference: String(event.data.reference) };
  if (event.event === 'refund.processed')
    return {
      refundTransactionId: String(event.data.transaction?.id ?? event.data.transaction),
      refundAmount: Number(event.data.amount),
    };
  return { ignore: true };
}
