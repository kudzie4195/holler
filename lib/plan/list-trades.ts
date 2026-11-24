import { tradeSignupClosed } from '@/lib/check/cells';
import { tradeLabel } from '@/lib/check/trades';
import { AREA_LIST_TRADES } from '@/lib/lists/core';
import type { Lang } from '@/lib/i18n';

/**
 * Round 24 FIX2 (review P3-9): the trades sign-up takes that have a neighborhood address list, named from the code's own list
 * (lib/lists/core.ts AREA_LIST_TRADES), for the pricing pages. Server side only.
 */
export function addressListTradeNames(lang: Lang = 'en'): string {
  const names = AREA_LIST_TRADES.filter((t) => !tradeSignupClosed(t)).map((t) => (lang === 'en' ? tradeLabel(t).toLowerCase() : tradeLabel(t, lang).toLowerCase()));
  const and = lang === 'en' ? 'and' : 'y';
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}` : (names[0] ?? '');
}
