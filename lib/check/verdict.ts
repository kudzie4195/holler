import { localizeDate, lowerFirst, t, type Lang } from '@/lib/i18n';
import type { CoverageState } from './cells';
import type { AlertTotals } from './delivery';
import { CHECK_RADIUS_MI } from './scope';

/**
 * Round 25: the one block above the /check results. The verdict word comes from the page's coverageFor answer (the same `coverageState` that
 * decides the trial offer and the waitlist card), so the two can never disagree. The number under it is alertTotals (lib/check/delivery.ts):
 * every record a member with this trade at this ZIP would have been emailed, counted from the same marks the rows carry.
 *
 * No window length is ever printed: the public feeds cover different spans, so the sentence says "recently" and names the date of the oldest
 * counted record. A count from reads that stopped at their row limit says "at least".
 * A waitlist answer has no block (the waitlist card is the whole answer there).
 */
export interface CheckVerdict {
  state: 'live' | 'limited';
  head: string;
  count: string | null;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 12" (English) or "12 nov" (Spanish), from the calendar day in UTC. */
export function shortDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  return localizeDate(`${MONTHS_EN[d.getUTCMonth()]} ${d.getUTCDate()}`, lang) ?? '';
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
  if (totals.count === 0 || !totals.oldest) return { state, head, count: t(lang, 'chk.verdict.none', { who, mi, zip }) };
  const n = totals.atLeast ? t(lang, 'chk.verdict.at_least', { n: totals.count }) : String(totals.count);
  const date = shortDate(totals.oldest, lang);
  const when = totals.count === 1 && !totals.atLeast ? t(lang, 'chk.verdict.on', { date }) : t(lang, 'chk.verdict.since', { date });
  if (totals.count === 1) return { state, head, count: t(lang, 'chk.verdict.count_one', { n, who, mi, zip, when }) };
  const where = totals.places === 1 ? t(lang, 'chk.verdict.places_one') : t(lang, 'chk.verdict.places', { places: totals.places });
  return { state, head, count: t(lang, 'chk.verdict.count', { n, who, mi, zip, where, when }) };
}
