import { CATEGORIES, classifyText, type CategoryId } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { ASK_TERMS, looksLikeRequest, resolveCityFromText } from './websearch';

/**
 * Bluesky search for people asking for local recommendations.
 *
 * AUTH STATUS (researched 2026-11-17): unauthenticated app.bsky.feed.searchPosts is blocked. Evidence, all 2026:
 *  - github.com/cyanheads/bluesky-mcp-server/issues/32: 24 of 25 unauthenticated probes on 2026-09-25 got HTTP 403 from BOTH public.api.bsky.app and
 *    api.bsky.app (HTML body "403 Forbidden ... Request forbidden by administrative rules"), while getProfile/searchActors/getTrends/getFeed still returned 200.
 *  - github.com/kamoras/civitas/pull/594 (merged 2026-09-21): 48 attempts in 30 minutes on public.api.bsky.app returned 0 successes; the fix was an app
 *    password session; public.api.bsky.app returned 403 even with a valid Bearer token, api.bsky.app with a token worked; bsky.social without auth returned 401.
 *  - github.com/Rackbops/docket/issues/125 (2026-11-12): public.api.bsky.app 403 again on 2026-11-11 and 2026-11-12.
 *  - github.com/bluesky-social/bsky-docs/issues/332: a maintainer said the AppView was "deliberately returning 403 to decrease load".
 *  - the lexicon (github.com/bluesky-social/atproto lexicons/app/bsky/feed/searchPosts.json) says "Some providers may require authentication".
 * So this adapter authenticates with an app password when BLUESKY_HANDLE and BLUESKY_APP_PASSWORD are present in ctx.env:
 *   1. POST https://bsky.social/xrpc/com.atproto.server.createSession {identifier, password} -> {accessJwt, refreshJwt, handle, did, didDoc?}
 *      (lexicons/com/atproto/server/createSession.json; renew with com.atproto.server.refreshSession and the refresh token).
 *   2. GET <pds>/xrpc/app.bsky.feed.searchPosts with `Authorization: Bearer <accessJwt>` and `atproto-proxy: did:web:api.bsky.app#bsky_appview`
 *      (the documented PDS-to-AppView proxy route, as described in the cyanheads issue). <pds> is the didDoc #atproto_pds endpoint, default https://bsky.social.
 * Without credentials it still tries the keyless public host once per run (it may be reopened) and logs an error that names the two env keys when refused.
 * BLUESKY_HANDLE and BLUESKY_APP_PASSWORD are in ENV_KEYS (lib/env.ts) and .env.example. createSession is rate limited (the cyanheads issue saw
 * 10 per identifier per day) and every serverless cold start logs in again, so the adapter runs every 360 minutes (4 runs a day); the session is
 * also cached in module memory for warm invocations and renewed with refreshSession.
 *
 * Request parameters (confirmed from the lexicon): q (required), sort top|latest (default latest), since (inclusive datetime or YYYY-MM-DD),
 * until, mentions, author, lang, domain, url, tag[], limit 1..100 (default 25), cursor. Response: { posts[] (app.bsky.feed.defs#postView:
 * uri, cid, author{did,handle,...}, record{text,createdAt,...}, indexedAt), cursor?, hitsTotal? }.
 *
 * Stored per post: text snippet (<=280 chars), author handle, post URL. Nothing else.
 */

const PUBLIC_ENDPOINT = 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts';
const ENTRYWAY = 'https://bsky.social';
const APPVIEW_PROXY = 'did:web:api.bsky.app#bsky_appview';
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';
const QUERIES_PER_RUN = 12;
const CADENCE = 360;
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

export function buildBlueskyUrl(q: string, since: Date, base: string = PUBLIC_ENDPOINT): string {
  const p = new URLSearchParams({ q, limit: '50', sort: 'latest', lang: 'en', since: since.toISOString() });
  return `${base}?${p.toString()}`;
}

// --- App-password session ----------------------------------------------------------------------

interface Session {
  accessJwt: string;
  refreshJwt: string;
  /** PDS base URL, no trailing slash. */
  pds: string;
  /** epoch ms after which the access token should be renewed */
  renewAt: number;
  /** which credentials this session belongs to */
  who: string;
}
let session: Session | null = null;

/** Test hook: forget the cached session. */
export function resetBlueskySession(): void {
  session = null;
}

function jwtExpiryMs(jwt: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function pdsFromDidDoc(didDoc: unknown): string {
  const services = isObj(didDoc) && Array.isArray(didDoc.service) ? didDoc.service : [];
  for (const sv of services) {
    if (isObj(sv) && typeof sv.id === 'string' && sv.id.endsWith('#atproto_pds') && typeof sv.serviceEndpoint === 'string' && /^https:\/\//.test(sv.serviceEndpoint)) {
      return sv.serviceEndpoint.replace(/\/$/, '');
    }
  }
  return ENTRYWAY;
}

function readSession(json: unknown, who: string, fallbackPds: string): Session {
  if (!isObj(json) || typeof json.accessJwt !== 'string' || typeof json.refreshJwt !== 'string') {
    throw new Error('session response has no accessJwt/refreshJwt, API may have changed');
  }
  const exp = jwtExpiryMs(json.accessJwt);
  return {
    accessJwt: json.accessJwt,
    refreshJwt: json.refreshJwt,
    pds: json.didDoc ? pdsFromDidDoc(json.didDoc) : fallbackPds,
    renewAt: (exp ?? Date.now() + 90 * 60_000) - 5 * 60_000,
    who,
  };
}

async function postJson(ctx: AdapterContext, url: string, body: unknown, bearer?: string): Promise<Response> {
  return ctx.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
}

/** Returns a usable session, reusing, refreshing or creating one. Throws a readable Error on failure. */
async function ensureSession(ctx: AdapterContext, handle: string, password: string): Promise<Session> {
  const who = handle.toLowerCase();
  if (session && session.who === who && Date.now() < session.renewAt) return session;
  if (session && session.who === who) {
    try {
      const res = await postJson(ctx, `${session.pds}/xrpc/com.atproto.server.refreshSession`, undefined, session.refreshJwt);
      if (res.ok) {
        session = readSession(await res.json(), who, session.pds);
        return session;
      }
    } catch {
      // fall through to a fresh login
    }
  }
  const res = await postJson(ctx, `${ENTRYWAY}/xrpc/com.atproto.server.createSession`, { identifier: handle, password });
  if (!res.ok) {
    const hint =
      res.status === 401 ? ' (BLUESKY_HANDLE or BLUESKY_APP_PASSWORD is wrong; use an app password, not the account password)' : res.status === 429 ? ' (session creation rate limited)' : '';
    throw new Error(`createSession HTTP ${res.status}${hint}`);
  }
  session = readSession(await res.json(), who, ENTRYWAY);
  return session;
}

/** Structural counts for the silent-empty check: posts that carry uri, author.handle and record.text. */
export function blueskyRowStats(raw: unknown): { rows: number; usable: number } | null {
  const posts = isObj(raw) ? raw.posts : null;
  if (!Array.isArray(posts)) return null;
  let usable = 0;
  for (const p of posts) {
    if (isObj(p) && typeof p.uri === 'string' && isObj(p.author) && typeof p.author.handle === 'string' && isObj(p.record) && typeof p.record.text === 'string') usable++;
  }
  return { rows: posts.length, usable };
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
    let rawRows = 0;
    let usableRows = 0;
    let answered = 0; // responses that had a posts array
    let responses = 0;
    try {
      const handle = ctx.env.BLUESKY_HANDLE?.trim();
      const password = ctx.env.BLUESKY_APP_PASSWORD?.trim();
      let auth: Session | null = null;
      if (handle && password) {
        try {
          auth = await ensureSession(ctx, handle, password);
        } catch (e) {
          ctx.log(`error: bluesky login failed: ${e instanceof Error ? e.message : String(e)}`);
          return [];
        }
      }
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
              const url = auth ? buildBlueskyUrl(b.q, ctx.since, `${auth.pds}/xrpc/app.bsky.feed.searchPosts`) : buildBlueskyUrl(b.q, ctx.since);
              const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
              if (auth) {
                headers.Authorization = `Bearer ${auth.accessJwt}`;
                headers['atproto-proxy'] = APPVIEW_PROXY;
              }
              const res = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(15000) });
              if (res.status === 401 || res.status === 403) {
                ctx.log(
                  auth
                    ? `error: bluesky HTTP ${res.status} even with a session, check the app password and that auth is accepted`
                    : `error: bluesky HTTP ${res.status}, search requires auth: set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD (an app password)`,
                );
                return { blocked: true, signals: [] as SignalInput[] };
              }
              if (res.status === 429) {
                ctx.log('error: bluesky rate limited (HTTP 429)');
                return { blocked: true, signals: [] as SignalInput[] };
              }
              if (!res.ok) {
                ctx.log(`error: bluesky HTTP ${res.status}`);
                return { blocked: false, signals: [] as SignalInput[] };
              }
              const text = await res.text();
              let json: unknown;
              try {
                json = JSON.parse(text);
              } catch {
                ctx.log(`error: bluesky ${/^\s*</.test(text) ? 'returned an HTML page instead of JSON' : 'returned non-JSON text'}`);
                return { blocked: false, signals: [] as SignalInput[] };
              }
              responses++;
              const stats = blueskyRowStats(json);
              if (stats) {
                answered++;
                rawRows += stats.rows;
                usableRows += stats.usable;
              }
              return { blocked: false, signals: parseBluesky(json) };
            } catch (e) {
              ctx.log(`error: bluesky ${e instanceof Error ? e.message : String(e)}`);
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
      if (responses > 0 && answered === 0) {
        ctx.log(`error: bluesky ${responses} responses had no posts array, wrapper may have changed`);
      } else if (rawRows > 0 && usableRows === 0) {
        ctx.log(`error: parsed 0 of ${rawRows} rows, shape may have changed`);
      }
    } catch (e) {
      ctx.log(`error: bluesky ${e instanceof Error ? e.message : String(e)}`);
    }
    return out;
  },
};

export const adapters: Adapter[] = [bluesky];
