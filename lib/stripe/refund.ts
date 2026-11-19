/**
 * Refunds what a duplicate Holler subscription was charged (review v2 P2, commander decision 6). Used by the Stripe webhook when a
 * second completed checkout is canceled because the member already pays for the subscription on their profile row.
 *
 * Stripe API 2026 (stripe@23): an invoice no longer names its charge; its payments are InvoicePayment objects, each pointing at a
 * PaymentIntent (or, for old charges, a Charge). Every paid invoice of the subscription is refunded in full, one refund per payment,
 * with an idempotency key per payment, so a retried webhook never refunds twice. A payment Stripe says is already refunded counts as
 * done. Any other failure throws: the webhook answers 500 and Stripe delivers the event again (the webhook refunds BEFORE it
 * cancels, so the retry still finds the duplicate live and comes back here).
 */

/** The few Stripe calls this needs (a subset of the Stripe client, so tests can pass a fake). */
export interface RefundApi {
  invoices: {
    list(params: { subscription: string; status: 'paid'; limit: number }): Promise<{ data: { id: string; amount_paid?: number | null }[] }>;
  };
  invoicePayments: {
    list(params: { invoice: string; status: 'paid'; limit: number }): Promise<{
      data: { id: string; amount_paid?: number | null; payment?: { type?: string; payment_intent?: string | { id: string } | null; charge?: string | { id: string } | null } | null }[];
    }>;
  };
  refunds: {
    create(
      params: { payment_intent?: string; charge?: string; reason: 'duplicate'; metadata: Record<string, string> },
      opts: { idempotencyKey: string },
    ): Promise<{ id: string }>;
  };
}

export interface RefundOutcome {
  /** Refund ids Stripe returned (or 'already_refunded'). */
  refunded: string[];
  /** Payments that could not be refunded through the API (a payment_record): a person must refund these by hand. */
  manual: string[];
}

const idOf = (x: string | { id: string } | null | undefined): string | null => (!x ? null : typeof x === 'string' ? x : x.id);

export async function refundSubscriptionPayments(stripe: RefundApi, subscriptionId: string): Promise<RefundOutcome> {
  const out: RefundOutcome = { refunded: [], manual: [] };
  const invoices = await stripe.invoices.list({ subscription: subscriptionId, status: 'paid', limit: 20 });
  for (const inv of invoices.data) {
    if (!inv.amount_paid || inv.amount_paid <= 0) continue; // a trial or $0 invoice charged nothing
    const payments = await stripe.invoicePayments.list({ invoice: inv.id, status: 'paid', limit: 20 });
    for (const pay of payments.data) {
      if (pay.amount_paid != null && pay.amount_paid <= 0) continue;
      const pi = idOf(pay.payment?.payment_intent);
      const ch = idOf(pay.payment?.charge);
      if (!pi && !ch) {
        out.manual.push(pay.id);
        continue;
      }
      try {
        const r = await stripe.refunds.create(
          {
            ...(pi ? { payment_intent: pi } : { charge: ch! }),
            reason: 'duplicate',
            metadata: { app: 'holler', reason: 'duplicate_subscription', subscription: subscriptionId, invoice: inv.id },
          },
          { idempotencyKey: `holler-dup-refund-${pay.id}` },
        );
        out.refunded.push(r.id);
      } catch (e) {
        if ((e as { code?: string } | null)?.code === 'charge_already_refunded') {
          out.refunded.push('already_refunded');
          continue;
        }
        throw e;
      }
    }
  }
  return out;
}
