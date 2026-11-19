import { ingestBeacon } from '@/lib/analytics/ingest';
import { ingestDeps } from '@/lib/analytics/deps';

/**
 * POST /api/e { name: 'visit' | 'area_check' | 'app_open', path }: the first-party funnel beacon from components/analytics.tsx.
 * Always answers 204 with no body, so the response never tells a caller what was kept or why something was dropped.
 * Same origin only, cookie required (the holler_sid cookie), obvious automation ignored, rate limited with the shared limiter, and
 * Global Privacy Control or Do Not Track headers drop the event. No IP address, user agent or referrer is stored.
 */
export async function POST(req: Request) {
  try {
    await ingestBeacon(req, ingestDeps());
  } catch {
    // Not configured, limiter down, anything: still 204.
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
