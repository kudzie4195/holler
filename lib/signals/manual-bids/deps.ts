import 'server-only';
import { ownerGate } from './owner';
import { bidsEnabled } from '@/lib/signals/bid-sources';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ServiceDeps } from './service';

/**
 * The real dependencies of the owner actions and pages (round 33). The owner gate runs inside every service function before `db` is
 * called, so a refused call never builds the service-role client. Not a server action module: nothing here is callable from a browser.
 */
export function ownerServiceDeps(): ServiceDeps {
  return {
    gate: ownerGate,
    db: () => createAdminClient(),
    now: () => new Date(),
    bidsOn: () => bidsEnabled(),
    findExisting: async (db, cands) => (await import('./store')).findExisting(db, cands),
    publish: async (db, items, now) => (await import('./store')).publishManualBids(db, items, now),
    retire: async (db, id, now) => (await import('./store')).retireManualBid(db, id, now),
    list: async (db, now) => (await import('./store')).listManualBids(db, now),
  };
}
