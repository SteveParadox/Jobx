import { getDb } from '@/db';
import * as s from '@/db/schema';
import {
  type Provider,
  type VerifiedPayment,
  initializeCheckout,
  paystack,
  stripeClient,
  verifyPayment,
} from '@/integrations/payments';
import { type Actor, employerAccess } from '@/lib/auth';
import { AppError, requireValue } from '@/lib/errors';
import { and, desc, eq, gt } from 'drizzle-orm';
import { audit } from './jobs';
export function validateSettlement(
  attempt: typeof s.checkouts.$inferSelect,
  payment: VerifiedPayment,
) {
  if (
    attempt.provider !== payment.provider ||
    attempt.reference !== payment.reference ||
    attempt.id !== payment.attemptId ||
    (attempt.providerReference !== null &&
      attempt.providerReference !== payment.providerReference) ||
    attempt.amount !== payment.amount ||
    attempt.currency !== payment.currency ||
    !Number.isSafeInteger(payment.amount) ||
    !Number.isFinite(payment.paidAt.getTime())
  )
    throw new AppError(400, 'Verified payment does not match the server-created checkout');
  if (payment.paidAt < new Date(attempt.createdAt.getTime() - 300000))
    throw new AppError(400, 'Payment predates checkout');
}
export async function checkout(
  actor: Actor,
  employerId: string,
  planId: string,
  provider: Provider,
) {
  await employerAccess(actor, employerId, ['owner', 'admin']);
  const db = getDb();
  const plan = requireValue(
    (
      await db
        .select()
        .from(s.plans)
        .where(and(eq(s.plans.id, planId), eq(s.plans.enabled, true)))
    )[0],
  );
  if (plan.amount <= 0) throw new AppError(400, 'This plan does not require checkout');
  const [attempt] = await db
    .insert(s.checkouts)
    .values({
      employerId,
      userId: actor.id,
      planId,
      provider,
      reference: crypto.randomUUID(),
      amount: plan.amount,
      currency: plan.currency,
      durationDays: plan.durationDays,
      activeJobs: plan.activeJobs,
      featured: plan.featured,
      expiresAt: new Date(Date.now() + 3600000),
    })
    .returning();
  try {
    const initialized = await initializeCheckout(attempt, actor.email);
    await db
      .update(s.checkouts)
      .set({ providerReference: initialized.providerReference })
      .where(eq(s.checkouts.id, attempt.id));
    return { attemptId: attempt.id, url: initialized.url };
  } catch (error) {
    await db
      .update(s.checkouts)
      .set({ status: 'initialization_failed' })
      .where(eq(s.checkouts.id, attempt.id));
    throw error;
  }
}
export async function settlePayment(payment: VerifiedPayment) {
  return getDb().transaction(async (tx) => {
    // Lock organization before checkout: every settlement for the organization uses this order.
    const [observed] = await tx
      .select()
      .from(s.checkouts)
      .where(eq(s.checkouts.reference, payment.reference));
    if (!observed) throw new AppError(404, 'Checkout not found');
    await tx
      .select()
      .from(s.employers)
      .where(eq(s.employers.id, observed.employerId))
      .for('update');
    const attempt = requireValue(
      (await tx.select().from(s.checkouts).where(eq(s.checkouts.id, observed.id)).for('update'))[0],
    );
    validateSettlement(attempt, payment);
    if (attempt.status === 'paid' || attempt.status === 'refunded')
      return { alreadySettled: true, attemptId: attempt.id };
    if (attempt.status === 'expired' && payment.paidAt > attempt.expiresAt)
      throw new AppError(
        409,
        'This payment completed after checkout expiration. Contact support for reconciliation.',
      );
    if (!['pending', 'initialization_failed', 'expired'].includes(attempt.status))
      throw new AppError(409, 'Checkout cannot settle in its current state');
    const [transaction] = await tx
      .insert(s.transactions)
      .values({
        attemptId: attempt.id,
        provider: payment.provider,
        providerTransactionId: payment.transactionId,
        amount: payment.amount,
        currency: payment.currency,
      })
      .returning();
    const [last] = await tx
      .select()
      .from(s.subscriptions)
      .where(
        and(
          eq(s.subscriptions.employerId, attempt.employerId),
          eq(s.subscriptions.status, 'active'),
          gt(s.subscriptions.endsAt, new Date()),
        ),
      )
      .orderBy(desc(s.subscriptions.endsAt))
      .limit(1);
    const startsAt = last?.endsAt ?? new Date();
    const endsAt = new Date(startsAt.getTime() + attempt.durationDays * 86400000);
    await tx.insert(s.subscriptions).values({
      employerId: attempt.employerId,
      attemptId: attempt.id,
      planId: attempt.planId,
      startsAt,
      endsAt,
      activeJobs: attempt.activeJobs,
      featured: attempt.featured,
    });
    await tx.insert(s.invoices).values({
      transactionId: transaction.id,
      employerId: attempt.employerId,
      number: `CA-${attempt.id}`,
      amount: payment.amount,
      currency: payment.currency,
    });
    await tx
      .update(s.checkouts)
      .set({ status: 'paid', providerReference: payment.providerReference })
      .where(eq(s.checkouts.id, attempt.id));
    await audit(tx, null, 'payment.settled', attempt.id, {
      provider: payment.provider,
      transactionId: payment.transactionId,
    });
    return { alreadySettled: false, attemptId: attempt.id };
  });
}
export async function reconcilePayment(actor: Actor, attemptId: string) {
  const attempt = requireValue(
    (await getDb().select().from(s.checkouts).where(eq(s.checkouts.id, attemptId)))[0],
  );
  await employerAccess(actor, attempt.employerId, ['owner', 'admin']);
  if (!attempt.providerReference) throw new AppError(409, 'Checkout initialization is incomplete');
  return settlePayment(
    await verifyPayment(attempt.provider as Provider, attempt.providerReference),
  );
}
export async function processRefund(provider: Provider, transactionId: string, amount: number) {
  const db = getDb();
  const observed = requireValue(
    (
      await db
        .select()
        .from(s.transactions)
        .where(
          and(
            eq(s.transactions.provider, provider),
            eq(s.transactions.providerTransactionId, transactionId),
          ),
        )
    )[0],
  );
  // Re-fetch authoritative state; a signed event is a trigger, not the accounting source.
  let refunded = 0;
  if (provider === 'stripe') {
    const charges = await stripeClient().charges.list({ payment_intent: transactionId, limit: 1 });
    refunded = charges.data[0]?.amount_refunded ?? 0;
  } else {
    const data = await paystack('/transaction/' + encodeURIComponent(transactionId));
    if (data.status === 'reversed') refunded = observed.amount;
  }
  if (refunded < observed.amount || amount < observed.amount)
    throw new AppError(409, 'Partial refund requires manual accounting review');
  return db.transaction(async (tx) => {
    const txn = requireValue(
      (
        await tx
          .select()
          .from(s.transactions)
          .where(eq(s.transactions.id, observed.id))
          .for('update')
      )[0],
    );
    if (txn.status === 'refunded') return;
    await tx
      .update(s.transactions)
      .set({ status: 'refunded' })
      .where(eq(s.transactions.id, txn.id));
    await tx
      .update(s.checkouts)
      .set({ status: 'refunded' })
      .where(eq(s.checkouts.id, txn.attemptId));
    await tx
      .update(s.subscriptions)
      .set({ status: 'refunded', cancelledAt: new Date() })
      .where(eq(s.subscriptions.attemptId, txn.attemptId));
    await audit(tx, null, 'payment.refunded', txn.id);
  });
}
export async function cancelSubscription(actor: Actor, id: string) {
  const sub = requireValue(
    (await getDb().select().from(s.subscriptions).where(eq(s.subscriptions.id, id)))[0],
  );
  await employerAccess(actor, sub.employerId, ['owner', 'admin']);
  await getDb()
    .update(s.subscriptions)
    .set({ cancelledAt: new Date() })
    .where(eq(s.subscriptions.id, id));
  return {
    message: 'Automatic renewal is not enabled; access remains until the paid period ends.',
  };
}
