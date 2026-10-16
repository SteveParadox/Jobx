# Payments and access

Stripe and Paystack are optional. Without keys, paid checkout is disabled while free discovery/posting remains usable. The shipped billing model is fixed-period access with manual renewal checkout; it does not create automatic recurring charges.

## Setup

1. Create a provider sandbox account and verify the merchant/currency capabilities.
2. Configure Stripe secret + webhook secret or Paystack secret.
3. Register `/api/webhooks/stripe` or `/api/webhooks/paystack` as appropriate.
4. Use provider sandbox tools to send genuine signed events, delayed payments and refunds.
5. Complete provider reconciliation tests before using live money.

References: https://docs.stripe.com/webhooks and https://paystack.com/docs/payments/webhooks/ and https://paystack.com/docs/payments/verify-payments/

## Settlement guarantees

The server creates a checkout attempt with organization, actor, plan, amount in minor units, currency, duration, allowance, feature flag, provider, unique reference and expiry. The redirect carries no payment authority. Provider initialization gets an idempotency key/reference. If the initialization response is interrupted, a verified webhook can still recover an attempt using its authenticated reference and metadata.

A valid signature is only a trigger: the backend re-fetches authoritative provider state. Amount, currency, provider, attempt ID, server reference and known provider reference must match. Settlement locks the employer and checkout, then writes the unique payment transaction, subscription period, invoice and paid status **atomically**. An invoice failure rolls everything back. Duplicate/replayed events return the existing settlement.

Manual renewal starts after the latest already paid active/future period, avoiding overlapping duplicate periods. Access checks also test actual starts/ends rather than trusting a status string. The worker marks elapsed periods expired. Cancellation records non-renewal; it does not invent an automatic provider subscription.

## Reconciliation and exceptions

Use Verify payment from the employer's checkout history, or administrator reconciliation, for a missed webhook. Authorization is checked against the organization. An expired attempt paid before its deadline can settle; a payment completed after checkout expiration requires support review. Provider initialization failures with no stored reference may require webhook recovery or operator investigation.

Full-refund events re-fetch provider state before revoking access. Stripe charge refunds and Paystack reversed transactions are handled. Partial refunds are intentionally rejected for manual accounting review; they do not silently revoke or grant access. The platform does not claim a self-service refund execution flow or automatic recurring renewal/failure handling.

## Required release tests

Use test cards/accounts to check success, asynchronous success, signature mismatch, amount/currency/reference mismatch, duplicate events, crash/replay, missed webhook, late payment, full refund, partial-refund review and paid-period expiry. Database tests cover atomicity/replay but do not replace live-provider sandbox validation. Never test with real card/customer secrets committed to Git.
