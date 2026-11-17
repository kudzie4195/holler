import { parseExtraAreas } from './areas';
import { parseKeywords, preparePhrases } from './keywords';
import { effectiveTier, PLAN_LIMITS, type Tier } from './limits';

export interface ScopeArea {
  lat: number | null;
  lon: number | null;
  state: string | null;
}

export interface MatchScope {
  tier: Tier;
  /** Main area first, then the extra areas the plan allows. */
  areas: ScopeArea[];
  /** The first N saved trades, N from the plan. */
  categories: string[];
  /** Keyword watches the plan allows (none on Starter). */
  keywords: string[];
  /** The same keywords in searchable form (lib/plan/keywords.ts foldText), prepared once per profile for the matcher. */
  phrases: string[];
}

export interface ScopeInput {
  categories: string[] | null;
  lat: number | null;
  lon: number | null;
  state: string | null;
  plan?: string | null;
  subscription_status?: string | null;
  extra_areas?: unknown;
  keywords?: unknown;
}

/**
 * What matching may use for one member right now. Saved settings beyond the plan are kept in the row but left out here:
 * a Starter (or trial, or canceled) profile with saved extras uses its main area, its first 5 trades and no keywords.
 */
export function matchScope(p: ScopeInput): MatchScope {
  const tier = effectiveTier(p);
  const lim = PLAN_LIMITS[tier];
  const areas: ScopeArea[] = [{ lat: p.lat, lon: p.lon, state: p.state }];
  for (const a of parseExtraAreas(p.extra_areas).slice(0, lim.extraAreas)) areas.push({ lat: a.lat, lon: a.lon, state: a.state });
  const categories = (Array.isArray(p.categories) ? p.categories : []).slice(0, lim.trades);
  const keywords = parseKeywords(p.keywords).slice(0, lim.keywords);
  return { tier, areas, categories, keywords, phrases: preparePhrases(keywords) };
}
