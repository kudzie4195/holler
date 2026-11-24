import { coverageFor, type CoverageState } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { matchScope, type ScopeInput } from '@/lib/plan/scope';
import type { DigestCoverage } from './templates';

/**
 * The member's own cell in the site's coverage gate (round 24), for the alert email.
 *
 * The site (Phase A, lib/check/cells.ts) tells each visitor the truth about one city and one trade: live, limited or waitlist. A member
 * has up to N trades and up to three areas, so the email takes the best answer the site would give for any of them:
 *   - any trade live in any of the member's areas  -> 'live'   (the email says nothing extra);
 *   - else any trade limited somewhere              -> 'limited', with the trades that are limited;
 *   - else                                          -> 'waitlist', with every trade.
 * The trades and areas are the plan-limited ones matching uses (lib/plan/scope.ts matchScope), the same list the alert cards come from.
 * `served` is lib/check/coverage.ts isServedZip, passed in so tests can run without the feed catalogue. Null when the member has no
 * area with a point or no trade: there is nothing to say.
 */
export function digestCoverage(
  p: ScopeInput,
  served: (place: { lat: number; lon: number; state: string }) => boolean = isServedZip,
): DigestCoverage | null {
  const scope = matchScope(p);
  const areas = scope.areas.filter(
    (a): a is { lat: number; lon: number; state: string } =>
      typeof a.lat === 'number' && Number.isFinite(a.lat) && typeof a.lon === 'number' && Number.isFinite(a.lon) && typeof a.state === 'string',
  );
  if (areas.length === 0 || scope.categories.length === 0) return null;
  const rank: Record<CoverageState, number> = { waitlist: 0, limited: 1, live: 2 };
  const best = new Map<string, CoverageState>();
  for (const a of areas) {
    const isServed = served(a);
    for (const trade of scope.categories) {
      const state = coverageFor(a, trade, isServed).state;
      const was = best.get(trade);
      if (!was || rank[state] > rank[was]) best.set(trade, state);
    }
  }
  const states = [...best.values()];
  const state: CoverageState = states.includes('live') ? 'live' : states.includes('limited') ? 'limited' : 'waitlist';
  return { state, trades: state === 'live' ? [] : scope.categories.filter((t) => best.get(t) === state) };
}
