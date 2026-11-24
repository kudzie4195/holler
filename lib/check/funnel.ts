import type { Lang } from '@/lib/i18n';
import type { CoverageState } from './cells';

/**
 * Round 25: the path the area_check funnel event records (lib/analytics/request.ts trackVisitorStep): the answer the visitor got,
 * /check/live, /check/limited or /check/waitlist, and /es/check/<state> on the Spanish page. Path only: never a ZIP or a trade.
 * lib/analytics/attr.ts cleanPath accepts it ([A-Za-z0-9/_.-]).
 */
export function areaCheckPath(state: CoverageState, lang: Lang = 'en'): string {
  return `${lang === 'en' ? '' : `/${lang}`}/check/${state}`;
}
