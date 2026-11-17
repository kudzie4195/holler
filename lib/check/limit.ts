import { rateKey, type Limit } from '@/lib/auth/limits';

/** Results views per IP per window. A person comparing a few ZIPs and trades stays far below it. */
export const CHECK_MAX_VIEWS = 15;
export const CHECK_WINDOW_SECONDS = 60;

export function checkIpLimit(ip: string): Limit {
  return { key: rateKey('check', 'ip', ip), max: CHECK_MAX_VIEWS, windowSeconds: CHECK_WINDOW_SECONDS };
}

/**
 * allowed: read as usual.
 * limited: show the "try again in a minute" state and do not touch the database.
 * unavailable: the limiter itself could not run (no database, migration missing). The page then reads through the shared
 * remote cache only as far as that cache already holds the entry; a miss is one bounded query per cache key, and a failed
 * read is remembered for a minute, so a down database is not hammered.
 */
export type CheckGate = 'allowed' | 'limited' | 'unavailable';

export async function gateCheck(
  ip: string,
  hitFn: (limits: Limit[]) => Promise<'allowed' | 'limited' | 'error'>,
): Promise<CheckGate> {
  try {
    const r = await hitFn([checkIpLimit(ip)]);
    return r === 'allowed' ? 'allowed' : r === 'limited' ? 'limited' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
