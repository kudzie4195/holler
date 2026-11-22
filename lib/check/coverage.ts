import { cacheLife } from 'next/cache';
import { publicClient } from '@/lib/seo/client';
import { CHECK_RADIUS_MI } from './scope';

/**
 * Does Holler have LOCAL data near this place? "Local" means a building permit or a city request (311, code enforcement, licences),
 * the records that come from a city or county feed. Storm and weather alerts cover every state, so they do not count: a ZIP with only
 * weather is a place Holler has not really reached yet, and the check page offers the "Coming to your area" list there.
 *
 * One bounding-box read, limit 1, any trade, last LOOKBACK_DAYS. Cached per rounded cell for an hour.
 * Returns 'local', 'none', or 'unknown' when the read failed (the page then shows no waitlist rather than a wrong one).
 */
export type Coverage = 'local' | 'none' | 'unknown';

const LOOKBACK_DAYS = 30;
const DAY = 86_400_000;
const LOCAL_KINDS = ['permit', 'civic'];
const QUERY_TIMEOUT_MS = 5000;

export async function localCoverage(cellLat: number, cellLon: number): Promise<Coverage> {
  'use cache: remote';
  // A failed read is cached for a minute only, so a blip does not hide the list (or show it wrongly) for an hour.
  const unknown = (): Coverage => {
    cacheLife({ stale: 60, revalidate: 60, expire: 300 });
    return 'unknown';
  };
  if (!Number.isFinite(cellLat) || !Number.isFinite(cellLon) || Math.abs(cellLat) > 90 || Math.abs(cellLon) > 180) return unknown();
  const sb = publicClient();
  if (!sb) return unknown();
  const r = CHECK_RADIUS_MI;
  const dLat = r / 68.9;
  const dLon = r / (68.9 * Math.max(0.05, Math.cos((Math.min(89, Math.abs(cellLat) + dLat) * Math.PI) / 180)));
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY).toISOString();
  try {
    const { data, error } = await sb
      .from('holler_signals')
      .select('id')
      .in('kind', LOCAL_KINDS)
      .gte('lat', cellLat - dLat)
      .lte('lat', cellLat + dLat)
      .gte('lon', cellLon - dLon)
      .lte('lon', cellLon + dLon)
      .gte('occurred_at', since)
      .limit(1)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    if (error) return unknown();
    cacheLife('hours');
    return data && data.length > 0 ? 'local' : 'none';
  } catch {
    return unknown();
  }
}
