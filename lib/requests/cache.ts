import { revalidateTag } from 'next/cache';
import { REQUEST_CACHE_TAG } from '@/lib/signals/request-visibility';

/**
 * Expires every cached city, weekly, trade and /check entry that lists a resident request (they are tagged REQUEST_CACHE_TAG), so the
 * next visit renders fresh, without the ended request. `{ expire: 0 }` because this runs from route handlers (close link, scan cron),
 * where updateTag is not available. The 15-minute cache lifetime of those entries is the guarantee; this only makes it sooner.
 * Never throws (outside a request, for example in a test, revalidateTag has no store and throws; that is ignored).
 */
export function expireRequestPages(): boolean {
  try {
    revalidateTag(REQUEST_CACHE_TAG, { expire: 0 });
    return true;
  } catch {
    return false;
  }
}
