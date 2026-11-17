import type { SupabaseClient } from '@supabase/supabase-js';
import { expireRequestPages } from './cache';
import type { PurgeResult } from './service';

/** Most time the scan cron gives the request purge before it starts the scan (the function has 60 s in all). */
export const PURGE_BUDGET_MS = 8_000;

/**
 * Resident-request housekeeping for the scan cron, run BEFORE the scan so a slow scan can never starve the deletions the legal pages
 * promise (review P1-5). Bounded by `budgetMs`: past it the scan goes ahead and the purge reports a timeout (its next run, 15 minutes
 * later, picks up where this one stopped; every step is idempotent). Never throws. When it deleted public rows it also expires the
 * cached pages that listed them.
 */
export async function runRequestPurge(db: SupabaseClient, budgetMs: number = PURGE_BUDGET_MS): Promise<PurgeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { purgeEndedRequests } = await import('./service');
    const timeout = new Promise<PurgeResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ purged: 0, deletedPending: 0, signalsDeleted: 0, error: `purge passed ${Math.round(budgetMs / 1000)} s, scan started` }),
        budgetMs,
      );
    });
    const result = await Promise.race([purgeEndedRequests(db), timeout]);
    if (result.signalsDeleted > 0) expireRequestPages();
    return result;
  } catch (e) {
    return { purged: 0, deletedPending: 0, signalsDeleted: 0, error: e instanceof Error ? e.message.slice(0, 200) : 'purge failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
