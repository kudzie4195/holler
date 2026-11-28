import { switchOn } from '@/lib/build-switches';

/**
 * Round 35: HOLLER_KEYWORD_VOLUME_ENABLED. Off unless 1, true, on or yes (any case). The monthly DataForSEO job
 * (app/api/cron/dataforseo/route.ts: AI mention check, national "<trade> <city>" volume, location mode) makes no DataForSEO call and books no
 * spend while it is off. ?dry=1 reads state only and works either way. Server only: read at call time, never inlined into a browser bundle.
 */
export function keywordVolumeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return switchOn(env.HOLLER_KEYWORD_VOLUME_ENABLED);
}
