import { t, type Lang } from '@/lib/i18n';
import type { StormKind } from './core';

/**
 * The line a storm card carries when its report has an address list (round 18, unit LISTS): "12 permitted addresses near this hail report.
 * Open the list". Client-safe. Null for a count under 1: an empty list is not advertised.
 */
export function listLinkFor(signalId: number, kind: StormKind, count: number, lang: Lang): { href: string; text: string; open: string } | null {
  if (!Number.isSafeInteger(signalId) || !(count >= 1)) return null;
  const key = kind === 'hail' ? (count === 1 ? 'lists.card.hail_one' : 'lists.card.hail') : count === 1 ? 'lists.card.wind_one' : 'lists.card.wind';
  return { href: `/app/lists/storm?id=${signalId}`, text: t(lang, key, { n: count.toLocaleString('en-US') }), open: t(lang, 'lists.card.open') };
}
