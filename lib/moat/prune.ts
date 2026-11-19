import type { SupabaseClient } from '@supabase/supabase-js';

export interface PruneCounts {
  archived: number;
  deletedOld: number;
  deletedFuture: number;
}

/**
 * Archive-then-delete in one database transaction (migration 0015, holler_prune_signals). Returns the counts, or null when the
 * function is not there yet (code deployed before the migration: PostgREST PGRST202, or 42883 naming holler_prune_signals): the
 * caller then keeps its old plain deletes.
 * Any other failure throws, so a failed archive never turns into a plain delete.
 */
export async function archiveAndPrune(
  db: Pick<SupabaseClient, 'rpc'>,
  cutoff: Date,
  futureCutoff: Date,
): Promise<PruneCounts | null> {
  if (typeof (db as { rpc?: unknown }).rpc !== 'function') return null;
  const { data, error } = await db.rpc('holler_prune_signals', { cutoff: cutoff.toISOString(), future_cutoff: futureCutoff.toISOString() });
  if (error) {
    const m = error.message ?? '';
    const code = (error as { code?: string }).code;
    // Only "the prune function itself is not installed" falls back. An error raised inside it (a missing archive table, column or
    // helper) must not turn into the old plain delete, which would delete signals with no archive copy.
    if (code === 'PGRST202' || (code === '42883' && /holler_prune_signals/i.test(m))) return null;
    throw new Error(`prune failed: ${m}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { archived?: number; deleted_old?: number; deleted_future?: number } | null;
  return { archived: row?.archived ?? 0, deletedOld: row?.deleted_old ?? 0, deletedFuture: row?.deleted_future ?? 0 };
}
