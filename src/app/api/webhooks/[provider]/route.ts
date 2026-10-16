import { processRefund, settlePayment } from '@/domain/billing';
import { verifyPayment, verifyWebhook, type Provider } from '@/integrations/payments';
import { AppError } from '@/lib/errors';
import { endpoint, rawBody } from '@/lib/http';
export async function POST(req: Request, context: { params: Promise<{ provider: string }> }) {
  return endpoint(async () => {
    const { provider } = await context.params;
    if (!['stripe', 'paystack'].includes(provider)) throw new AppError(404, 'Unknown provider');
    const raw = await rawBody(req, 256000);
    if (Buffer.byteLength(raw) > 256000) throw new AppError(413, 'Webhook payload too large');
    const trigger = verifyWebhook(
      provider as Provider,
      raw,
      req.headers.get(provider === 'stripe' ? 'stripe-signature' : 'x-paystack-signature') ?? '',
    );
    if (trigger.ignore) return { received: true };
    if (trigger.refundTransactionId) {
      await processRefund(
        provider as Provider,
        trigger.refundTransactionId,
        trigger.refundAmount ?? 0,
      );
      return { received: true };
    }
    if (trigger.reference)
      await settlePayment(await verifyPayment(provider as Provider, trigger.reference));
    return { received: true };
  });
}
