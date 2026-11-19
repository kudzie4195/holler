import { PUSH_INTERVAL_MS } from '@/lib/push/notify';

/**
 * The push cap in words, built from the constant the push sender uses (lib/push/notify.ts PUSH_INTERVAL_MS), so the home page
 * cannot promise a different cap than the code keeps. "one an hour" for an hour; otherwise "one every N hours" or "one every N
 * minutes".
 */
export function capPhrase(ms: number): string {
  const HOUR = 3_600_000;
  if (ms === HOUR) return 'one an hour';
  if (ms > HOUR && ms % HOUR === 0) return `one every ${ms / HOUR} hours`;
  const min = Math.round(ms / 60_000);
  return min === 1 ? 'one a minute' : `one every ${min} minutes`;
}

/** "one an hour": the push cap the app band and the FAQ state. */
export const PUSH_CAP = capPhrase(PUSH_INTERVAL_MS);
