import type { Limit } from '@/lib/auth/limits';
import { LIMITS } from '@/lib/auth/limits';
import { cleanPage, isFeatureId, type FeatureId } from './features';

/**
 * Records one "I want this" pick. Pure logic over injected dependencies so tests run without a database.
 * Nothing about the visitor is stored. A signed-out pick is { feature, page, user_id: null } and nothing else.
 */
export interface InterestDb {
  from(table: 'holler_feature_interest'): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { code?: string; message?: string } | null }>;
    upsert(
      row: Record<string, unknown>,
      opts: { onConflict: string; ignoreDuplicates: boolean },
    ): PromiseLike<{ error: { code?: string; message?: string } | null }>;
  };
}

export interface InterestDeps {
  db: InterestDb;
  hit: (limits: Limit[]) => Promise<'allowed' | 'limited' | 'error'>;
}

export type InterestCode = 'ok' | 'invalid' | 'limited' | 'already' | 'unavailable';

export interface InterestResult {
  code: InterestCode;
  /** Feature ids for the cookie, when code is ok or already. */
  picked?: FeatureId[];
}

export interface InterestInput {
  feature: unknown;
  page: unknown;
  /** Signed-in member id, or null for a signed-out visitor. */
  userId: string | null;
  /** Used only in memory by the existing rate limiter, as the request form does. Never stored here. */
  ip: string;
  /** Ids already in this browser's holler_picked cookie. */
  cookiePicked: readonly FeatureId[];
}

export async function recordInterest(deps: InterestDeps, input: InterestInput): Promise<InterestResult> {
  if (!isFeatureId(input.feature)) return { code: 'invalid' };
  const feature = input.feature;
  const page = cleanPage(input.page);
  const already = input.cookiePicked.includes(feature);
  const nextPicked = [...new Set([...input.cookiePicked, feature])];

  // A second click from the same browser is refused before anything is counted or written.
  if (!input.userId && already) return { code: 'already', picked: [...input.cookiePicked] };

  const limit = input.userId ? LIMITS.interestUser(input.userId) : LIMITS.interestIp(input.ip);
  const h = await deps.hit([limit]);
  if (h === 'limited') return { code: 'limited' };
  if (h === 'error') return { code: 'unavailable' };

  const table = deps.db.from('holler_feature_interest');
  const { error } = input.userId
    ? await table.upsert({ feature, user_id: input.userId, page }, { onConflict: 'feature,user_id', ignoreDuplicates: true })
    : await table.insert({ feature, page, user_id: null });
  // A missing table (migration 0008 not applied yet) or any other failure is a soft error, never a throw.
  if (error) return { code: 'unavailable' };
  return { code: 'ok', picked: nextPicked };
}
