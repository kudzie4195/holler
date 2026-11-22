import { classifyText } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';
import { findCity, naicsToCategories, normalizeState } from './usaspending';

/**
 * SAM.gov Get Opportunities Public API v2.
 * Docs (confirmed 2026-11-17 by fetching https://open.gsa.gov/api/get-opportunities-public-api/):
 *  - GET https://api.sam.gov/opportunities/v2/search?api_key=...&postedFrom=MM/dd/yyyy&postedTo=MM/dd/yyyy&limit=<=1000&offset=0
 *    postedFrom/postedTo are mandatory and at most 1 year apart; `offset` is documented as "Page index" (default 0), so page N is offset=N;
 *    optional ncode (<=6 digits), state, ptype (u,p,a,r,s,o,g,k,i).
 *  - response: totalRecords, limit, offset, opportunitiesData[], links[]. Item keys: noticeId, title, solicitationNumber, department, subTier,
 *    office, postedDate (YYYY-MM-DD), type, baseType, archiveType, archiveDate, typeOfSetAsideDescription, typeOfSetAside, responseDeadLine,
 *    naicsCode (string or null), classificationCode, active, award, pointOfContact, description (a URL, not text), organizationType,
 *    officeAddress{zipcode,city (string),countryCode,state (string)}, placeOfPerformance{city{code,name},state{code},country{code},streetAddress,zip}
 *    (null when absent), additionalInfoLink, uiLink, links. A second documented example uses fullParentPathName/fullParentPathCode/resourceLinks instead.
 *  - errors: 400 (bad dates/limit), 401, 403 (invalid or missing api_key), 404 "No Data found", 500. 429 is not documented.
 *  - daily quota by role (sharedcontext.ai/skills/external/1102tools/sam-gov-api): 10 per day without a SAM role, 1,000 with one. This adapter
 *    makes at most 3 calls per run and runs twice a day, so a key with no role (10/day) is enough; a role is not needed.
 * Not confirmed: whether `offset` really is a page index in production (the docs say so; one third-party note calls it a record skip for another SAM API).
 * The "reponseDeadLine" typo in the request table is request-side only; the response key is read as responseDeadLine, with the typo as a fallback.
 */

const ENDPOINT = 'https://api.sam.gov/opportunities/v2/search';
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';
const PAGE = 1000;
const MAX_PAGES = 3;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function nameOrCode(v: unknown): { name: string; code: string } {
  if (isObj(v)) return { name: str(v.name), code: str(v.code) };
  return { name: str(v), code: str(v) };
}

function isoFromPosted(v: unknown): string | null {
  const t = str(v);
  if (!t) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00Z` : t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Pure parser for a SAM opportunities response. Drops award notices and anything outside our trades. */
export function parseSam(raw: unknown): SignalInput[] {
  try {
    const data = isObj(raw) ? raw.opportunitiesData : null;
    if (!Array.isArray(data)) return [];
    const out: SignalInput[] = [];
    for (const item of data) {
      try {
        if (!isObj(item)) continue;
        const noticeId = str(item.noticeId);
        const title = str(item.title);
        if (!noticeId || !title) continue;
        const type = str(item.type);
        if (/award|justification|special notice|sale of surplus/i.test(type)) continue;

        const naics = str(item.naicsCode);
        // Supply buys are not jobs for a local trade: goods NAICS (manufacturing 31-33, wholesale 42, retail 44-45)
        // or a numeric federal supply class prefix in the title ("36--GENERATOR", "49--REPAIR KIT"). Service codes are letters.
        if (isSupplyBuy(naics, title)) continue;
        let categories = naicsToCategories(naics);
        if (categories.length === 0) categories = classifyText(title);
        if (categories.length === 0) continue;

        const pop = isObj(item.placeOfPerformance) ? item.placeOfPerformance : {};
        const office = isObj(item.officeAddress) ? item.officeAddress : {};
        const cityN = nameOrCode(pop.city).name || str(office.city);
        const stateN = nameOrCode(pop.state);
        const stateCode = normalizeState(stateN.code) ?? normalizeState(stateN.name) ?? normalizeState(str(office.state));
        if (!stateCode) continue;
        const city = findCity(cityN, stateCode);
        const zip = str(pop.zip).slice(0, 5) || str(office.zipcode).slice(0, 5) || null;
        const posted = isoFromPosted(item.postedDate);
        const deadline = isoFromPosted(item.responseDeadLine ?? item.reponseDeadLine);
        const agency = str(item.fullParentPathName).split('.').filter(Boolean).slice(0, 2).join(' / ');

        out.push({
          source: 'sam-gov',
          externalId: noticeId,
          kind: 'contract',
          title: `Federal bid in ${cityN ? `${cityN}, ${stateCode}` : stateCode}: ${title.slice(0, 120)}`,
          summary:
            [type, agency, naics && `NAICS ${naics}`, deadline && `responses due ${deadline.slice(0, 10)}`]
              .filter(Boolean)
              .join(' | ')
              .slice(0, 280) || null,
          url: str(item.uiLink) || `https://sam.gov/opp/${encodeURIComponent(noticeId)}/view`,
          lat: city?.lat ?? null,
          lon: city?.lon ?? null,
          city: city?.name ?? (cityN || null),
          state: stateCode,
          zip,
          categories,
          severity: 2,
          occurredAt: posted ?? new Date().toISOString(),
          expiresAt: deadline,
          data: { solicitationNumber: str(item.solicitationNumber) || null, naics: naics || null, type: type || null },
        });
      } catch {
        // skip malformed notice
      }
    }
    return out;
  } catch {
    return [];
  }
}

function mdY(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()}`;
}

/** `page` is the zero-based page index: the docs define `offset` as a page index, not a record offset. */
export function buildSamUrl(apiKey: string, since: Date, now: Date, page = 0): string {
  const from = new Date(Math.max(since.getTime(), now.getTime() - 7 * 86_400_000));
  const p = new URLSearchParams({
    api_key: apiKey,
    postedFrom: mdY(from),
    postedTo: mdY(now),
    limit: String(PAGE),
    offset: String(page),
  });
  return `${ENDPOINT}?${p.toString()}`;
}

/** Structural counts for the silent-empty check: notices that carry an id and a title. */
export function samRowStats(raw: unknown): { rows: number; usable: number } | null {
  const data = isObj(raw) ? raw.opportunitiesData : null;
  if (!Array.isArray(data)) return null;
  let usable = 0;
  for (const it of data) if (isObj(it) && str(it.noticeId) && str(it.title)) usable++;
  return { rows: data.length, usable };
}

const sam: Adapter = {
  id: 'sam-gov',
  label: 'Federal bid opportunities (SAM.gov)',
  kind: 'contract',
  cadenceMinutes: 720,
  requiresEnv: ['SAM_API_KEY'],
  sourceUrl: 'https://sam.gov/',
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    const key = ctx.env.SAM_API_KEY ?? env.SAM_API_KEY;
    if (!key) {
      ctx.log('sam-gov: SAM_API_KEY missing');
      return [];
    }
    const all: SignalInput[] = [];
    try {
      const now = new Date();
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await ctx.fetch(buildSamUrl(key, ctx.since, now, page), {
          headers: { Accept: 'application/json', 'User-Agent': UA },
          signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        if (!res.ok) {
          // The docs list 404 "No Data found" for an empty window: that is a quiet day, not a failure.
          if (res.status === 404 && /no data found/i.test(text)) break;
          const hint = res.status === 401 || res.status === 403 ? ' (api_key invalid, missing or not allowed)' : res.status === 429 ? ' (daily request quota exhausted)' : '';
          const detail = /^\s*</.test(text) ? '' : ` ${text.replace(/\s+/g, ' ').slice(0, 120)}`;
          ctx.log(`error: sam-gov HTTP ${res.status}${hint}${detail}`);
          break;
        }
        let json: Obj;
        try {
          json = JSON.parse(text) as Obj;
        } catch {
          ctx.log(`error: sam-gov ${/^\s*</.test(text) ? 'returned an HTML page instead of JSON' : 'returned non-JSON text'}`);
          break;
        }
        const stats = samRowStats(json);
        if (!stats) {
          const keys = isObj(json) ? Object.keys(json).slice(0, 8).join(',') : typeof json;
          ctx.log(`error: sam-gov response has no opportunitiesData array, wrapper may have changed (top-level keys: ${keys})`);
          break;
        }
        const parsed = parseSam(json);
        // Most notices are outside our trades, so a small page may legitimately parse to nothing; a large page cannot.
        if (stats.rows > 0 && (stats.usable === 0 || (stats.rows >= 25 && parsed.length === 0))) {
          ctx.log(`error: parsed 0 of ${stats.rows} rows, shape may have changed`);
        }
        all.push(...parsed);
        const total = Number(json?.totalRecords);
        if (!Number.isFinite(total) || (page + 1) * PAGE >= total) break;
      }
    } catch (e) {
      ctx.log(`error: sam-gov ${e instanceof Error ? e.message : String(e)}`);
    }
    return all;
  },
};

export const adapters: Adapter[] = [sam];

/** True when a SAM notice is a purchase of goods rather than work a local business would do. */
export function isSupplyBuy(naics: string | null | undefined, title: string): boolean {
  const n = (naics ?? '').replace(/\D/g, '');
  if (/^(3[1-3]|42|4[45])/.test(n)) return true;
  return /^\s*\d{2}--/.test(title);
}
