import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildEventRow, type EventName, type EventProps, type EventRow } from './events';

export type { EventName } from './events';

/** The slice of the Supabase client that track() uses. */
export interface EventsDb {
  from(table: 'holler_events'): { insert(row: EventRow): PromiseLike<{ error: { code?: string; message?: string } | null }> };
}

/** Longest a caller waits for the insert. The insert itself is not cancelled; the caller just stops waiting. */
export const TRACK_TIMEOUT_MS = 1500;

let warned = false;

/**
 * Records one funnel step. Never throws and never waits longer than TRACK_TIMEOUT_MS: a missing table (migration 0017 not applied),
 * a missing service key, a duplicate step (the unique indexes make signup, trial_start, first_alert and paid once per member) and
 * a database error all end as a quiet return. Only the error code is logged, once per process.
 */
export async function track(name: EventName, props?: EventProps, db?: EventsDb): Promise<void> {
  try {
    const row = buildEventRow(name, props);
    if (!row) return;
    const client = db ?? (createAdminClient() as unknown as EventsDb);
    const work = Promise.resolve(client.from('holler_events').insert(row)).then(
      ({ error }) => {
        if (error && error.code !== '23505' && !warned) {
          warned = true;
          console.error('[analytics] insert failed', error.code ?? 'unknown');
        }
      },
      () => {},
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, TRACK_TIMEOUT_MS);
    });
    await Promise.race([work, timeout]);
    if (timer) clearTimeout(timer);
  } catch {
    // never throws
  }
}
