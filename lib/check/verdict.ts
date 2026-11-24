import { lowerFirst, t, type Lang } from '@/lib/i18n';
import type { CoverageState } from './cells';
import type { AlertTotals } from './delivery';
import { CHECK_RADIUS_MI } from './scope';
import { MAX_ITEMS_IN_DIGEST } from '@/lib/email/digest-cap';

/**
 * Round 25: the one block above the /check results. The verdict word comes from the page's coverageFor answer (the same `coverageState` that
 * decides the trial offer and the waitlist card), so the two can never disagree. The number under it is alertTotals (lib/check/delivery.ts):
 * every record a member with this trade at this ZIP would have been sent as an alert, counted from the same marks the rows carry.
 *
 * R25 check fix (review R25CHECK P1-3, option 2): the count is kept and the claim says what it is. Those records would have REACHED the member
 * as alerts (the notify route marks every one of them notified), and each email lists at most MAX_ITEMS_IN_DIGEST of them, the rest being on
 * the matches page ("Plus N more"). No date is printed: the heading under the block already says "last 30 days", so nothing contradicts it.
 * A count from reads that stopped at their row limit says "at least".
 * A waitlist answer has no block (the waitlist card is the whole answer there).
 */
export interface CheckVerdict {
  state: 'live' | 'limited';
  head: string;
  count: string | null;
}

export function checkVerdict(
  state: CoverageState,
  totals: AlertTotals | null,
  ctx: { tradeLabel: string; zip: string; lang: Lang },
): CheckVerdict | null {
  if (state === 'waitlist') return null;
  const { lang, zip } = ctx;
  const head = t(lang, state === 'live' ? 'chk.verdict.live' : 'chk.verdict.limited');
  if (!totals) return { state, head, count: null };
  const word = lang === 'en' ? ctx.tradeLabel.toLowerCase() : lowerFirst(ctx.tradeLabel);
  const who = t(lang, lang === 'en' && /^[aeiou]/.test(word) ? 'chk.verdict.who_an' : 'chk.verdict.who', { trade: word });
  const mi = CHECK_RADIUS_MI;
  if (totals.count === 0) return { state, head, count: t(lang, 'chk.verdict.none', { who, mi, zip }) };
  const n = totals.atLeast ? t(lang, 'chk.verdict.at_least', { n: totals.count }) : String(totals.count);
  if (totals.count === 1) return { state, head, count: t(lang, 'chk.reach.one', { n, who, zip }) };
  const where = totals.places === 1 ? t(lang, 'chk.reach.places_one') : t(lang, 'chk.verdict.places', { places: totals.places });
  return { state, head, count: t(lang, 'chk.reach.many', { n, who, zip, where, cap: MAX_ITEMS_IN_DIGEST }) };
}
