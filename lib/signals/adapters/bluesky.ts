import { CATEGORIES, classifyText, type CategoryId } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { ASK_TERMS, looksLikeRequest, resolveCityFromText } from './websearch';

/**
 * Bluesky public search for people asking for local recommendations.
 *
 * Endpoint (sourced: https://docs.bsky.app/docs/api/app-bsky-feed-search-posts redirects to endpoints.bsky.app, and the
 * walkthrough https://dev.to/agenthustler/scraping-bluesky-in-2026-at-protocol-makes-it-surprisingly-easy-56d6):
 *   GET https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=&limit=(<=100)&sort=latest&since=<ISO>&lang=en
 *   response posts[] {uri, cid, author{handle}, record{text, createdAt}, indexedAt}
 * AUTH WARNING (sourced: https://github.com/bluesky-social/bsky-docs/issues/332): the AppView has returned 403 to unauthenticated
 * searchPosts calls "to decrease load" (maintainer comment). Other 2026 write-ups report it open. Status cannot be probed from the
 * build sandbox. This adapter therefore needs no key, logs "403 (search may now require auth)" if blocked, and returns [].
 * If the live probe shows 403, a Bluesky app password + createSession flow is required, which needs new env keys (commander decision).
 *
 * Stored per post: text snippet (<=280 chars), author handle, post URL. Nothing else.
 */

const ENDPOINT = 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts';
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';
const QUERIES_PER_RUN = 12;
const CADENCE = 60;
const PHRASES = ['recommend a', 'looking for a', 'need a'];

export interface BlueskyQuery {
  q: string;
  category: CategoryId;
}

/** Deterministic rotation over categories (from CATEGORIES) x phrases; QUERIES_PER_RUN per run. */
export function planBlueskyQueries(now: Date, perRun: number = QUERIES_PER_RUN): BlueskyQuery[] {
  const combos: BlueskyQuery[] = [];
  for (const phrase of PHRASES) {
    for (const c of CATEGORIES) combos.push({ q: `"${phrase} ${ASK_TERMS[c.id]}"`, category: c.id });
  }
  const slot = Math.floor(now.getTime() / (CADENCE * 60_000));
  const start = (slot * perRun) % combos.length;
  return Array.from({ length: Math.min(perRun, combos.length) }, (_, i) => combos[(start + i) % combos.length]);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function snippet(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= 280 ? t : `${t.slice(0, 277).trimEnd()}...`;
}

export function postUrl(handle: string, uri: string): string | null {
  const rkey = uri.split('/').pop();
  if (!handle || !rkey) return null;
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

/** Pure parser for a searchPosts response. Keeps only posts that read as asks, name a trade and name a place. */
export function parseBluesky(raw: unknown, now: Date = new Date()): SignalInput[] {
  try {
    const posts = isObj(raw) ? raw.posts : null;
    if (!Array.isArray(posts)) return [];
    const out: SignalInput[] = [];
    for (const p of posts) {
      try {
        if (!isObj(p)) continue;
        const uri = typeof p.uri === 'string' ? p.uri : '';
        const record = isObj(p.record) ? p.record : {};
        const text = typeof record.text === 'string' ? record.text : '';
        const handle = isObj(p.author) && typeof p.author.handle === 'string' ? p.author.handle : '';
        if (!uri || !text || !handle) continue;
        if (!looksLikeRequest(text)) continue;
        const categories = classifyText(text);
        if (categories.length === 0) continue;
        const city = resolveCityFromText(text);
        if (!city) continue;
        const url = postUrl(handle, uri);
        if (!url) continue;
        const created = new Date(
          typeof record.createdAt === 'string' ? record.createdAt : typeof p.indexedAt === 'string' ? p.indexedAt : now,
        );
        const snip = snippet(text);
        out.push({
          source: 'bluesky',
          externalId: uri,
          kind: 'ask',
          title: snip.length <= 120 ? snip : `${snip.slice(0, 117).trimEnd()}...`,
          summary: snip,
          url,
          lat: city.lat,
          lon: city.lon,
          city: city.name,
          state: city.state,
          categories,
          severity: 1,
          occurredAt: Number.isNaN(created.getTime()) || created > now ? now.toISOString() : created.toISOString(),
          data: { handle, approxLocation: true },
        });
      } catch {
        // skip malformed post
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function buildBlueskyUrl(q: string, since: Date): string {
  const p = new URLSearchParams({ q, limit: '50', sort: 'latest', lang: 'en', since: since.toISOString() });
  return `${ENDPOINT}?${p.toString()}`;
}

const bluesky: Adapter = {
  id: 'bluesky',
  label: 'People asking on Bluesky',
  kind: 'ask',
  cadenceMinutes: CADENCE,
  sourceUrl: 'https://bsky.app/',
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    const out: SignalInput[] = [];
    const seen = new Set<string>();
    try {
      const plan = planBlueskyQueries(new Date());
      const started = Date.now();
      for (let i = 0; i < plan.length; i += 4) {
        if (Date.now() - started > 30_000) {
          ctx.log(`bluesky: deadline reached after ${i} of ${plan.length} queries`);
          break;
        }
        const batch = plan.slice(i, i + 4);
        const results = await Promise.all(
          batch.map(async (b) => {
            try {
              const res = await ctx.fetch(buildBlueskyUrl(b.q, ctx.since), {
                headers: { Accept: 'application/json', 'User-Agent': UA },
                signal: AbortSignal.timeout(15000),
              });
              if (res.status === 401 || res.status === 403) {
                ctx.log(`bluesky: HTTP ${res.status} (search may now require auth)`);
                return { blocked: true, signals: [] as SignalInput[] };
              }
              if (!res.ok) {
                ctx.log(`bluesky: HTTP ${res.status}`);
                return { blocked: false, signals: [] as SignalInput[] };
              }
              return { blocked: false, signals: parseBluesky(await res.json()) };
            } catch (e) {
              ctx.log(`bluesky: ${e instanceof Error ? e.message : String(e)}`);
              return { blocked: false, signals: [] as SignalInput[] };
            }
          }),
        );
        for (const r of results) {
          for (const s of r.signals) {
            if (seen.has(s.externalId)) continue;
            seen.add(s.externalId);
            out.push(s);
          }
        }
        if (results.some((r) => r.blocked)) break;
      }
    } catch (e) {
      ctx.log(`bluesky: ${e instanceof Error ? e.message : String(e)}`);
    }
    return out;
  },
};

export const adapters: Adapter[] = [bluesky];
