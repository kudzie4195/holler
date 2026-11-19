import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { track } from './server';

/** The parts of a Stripe invoice that matter here, so the webhook patch needs no new Stripe types. */
export interface PaidInvoice {
  amount_paid?: number | null;
  customer?: string | { id: string } | null;
  subscription_details?: { metadata?: Record<string, string> | null } | null;
  metadata?: Record<string, string> | null;
}

/** The service-role client. Only the profile lookup by customer id is used. */
type Admin = Pick<SupabaseClient, 'from'>;

/**
 * invoice.paid: records `paid` for the member on an invoice that moved money (amount_paid above zero; the free trial's zero-dollar
 * invoice is not a payment). The unique index on holler_events (user_id, name) keeps the first one, so later invoices, replays and
 * retries are dropped by the database. Never throws, so it cannot turn a webhook into a 500.
 */
export async function trackPaidInvoice(admin: Admin, invoice: PaidInvoice): Promise<void> {
  try {
    if (!invoice || !(typeof invoice.amount_paid === 'number' && invoice.amount_paid > 0)) return;
    const meta = invoice.subscription_details?.metadata ?? invoice.metadata ?? {};
    if (meta.app !== undefined && meta.app !== 'holler') return; // shared Stripe account: another product's invoice
    let userId = typeof meta.user_id === 'string' ? meta.user_id : null;
    if (!userId) {
      const customer = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (!customer) return;
      const { data } = await admin.from('holler_profiles').select('user_id').eq('stripe_customer_id', customer).maybeSingle();
      userId = typeof data?.user_id === 'string' ? data.user_id : null;
    }
    if (userId) await track('paid', { userId });
  } catch {
    // never throws
  }
}
