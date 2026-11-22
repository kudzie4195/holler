import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { INDEXNOW_MAX_URLS_PER_POST, indexNowConfig, postUrls } from '@/lib/seo/indexnow';
import { buildSitemapEntries } from '@/lib/seo/sitemap-entries';

// One-time (or occasional) launch ping: sends every URL in the sitemap to IndexNow, 10,000 per POST (the protocol limit).
// GET with `Authorization: Bearer CRON_SECRET` only (`?key=` is refused). `?dry=1` lists counts and a sample without sending anything.
// Do not schedule it: IndexNow asks for changed URLs only, and the scan already pings what changes.
export const maxDuration = 60;


export async function GET(req: NextRequest) {
  const secret = env.CRON_SECRET;
  if (!secret || !isCronAuthorized(req, secret)) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const cfg = indexNowConfig();
  if (!cfg) {
    return Response.json(
      { error: 'IndexNow is not configured: set INDEXNOW_KEY (8 to 128 letters, digits or dashes) and a public NEXT_PUBLIC_SITE_URL (not localhost)' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const dry = req.nextUrl.searchParams.get('dry') === '1' || req.nextUrl.searchParams.get('dry') === 'true';
  const entries = await buildSitemapEntries();
  const urls = [...new Set(entries.map((e) => e.url))].filter((u) => {
    try {
      return new URL(u).host === cfg.host;
    } catch {
      return false;
    }
  });
  if (dry) return Response.json({ dry: true, host: cfg.host, keyLocation: cfg.keyLocation, urls: urls.length, sample: urls.slice(0, 5) }, { headers: { 'Cache-Control': 'no-store' } });

  const batches: { urls: number; status: string; httpStatus?: number; error?: string }[] = [];
  for (let i = 0; i < urls.length; i += INDEXNOW_MAX_URLS_PER_POST) {
    const out = await postUrls(cfg, urls.slice(i, i + INDEXNOW_MAX_URLS_PER_POST), { timeoutMs: 20_000 });
    batches.push(out.status === 'sent' ? { urls: out.urls, status: 'sent', httpStatus: out.httpStatus } : out.status === 'failed' ? { urls: out.urls, status: 'failed', error: out.error } : { urls: 0, status: 'skipped' });
  }
  const failed = batches.some((b) => b.status === 'failed');
  return Response.json({ host: cfg.host, total: urls.length, batches }, { status: failed ? 502 : 200, headers: { 'Cache-Control': 'no-store' } });
}
