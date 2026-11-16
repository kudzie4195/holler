import { classifyText } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';
import { findCity, naicsToCategories, normalizeState } from './usaspending';

/**
 * SAM.gov Get Opportunities Public API v2.
 * Docs (sourced): https://open.gsa.gov/api/get-opportunities-public-api/
 *  - GET https://api.sam.gov/opportunities/v2/search?api_key=...&postedFrom=MM/dd/yyyy&postedTo=MM/dd/yyyy&limit=<=1000&offset=0
 *  - optional ncode (<=6 digits), state, ptype; response opportunitiesData[] with noticeId, title, solicitationNumber, postedDate, type,
 *    naicsCode, placeOfPerformance{city,state,zip,country}, uiLink, responseDeadLine, description, fullParentPathName, active
 * Assumed: placeOfPerformance.city / .state are objects {code,name} in live responses; the parser accepts plain strings too.
 * Assumed: the "reponseDeadLine" typo in the request table is request-side only; response key read as responseDeadLine.
 * Rate limit note: SAM keys without a federal role are limited per day, so this adapter makes at most 3 calls per run and runs twice a day.
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

export function buildSamUrl(apiKey: string, since: Date, now: Date, offset = 0): string {
  const from = new Date(Math.max(since.getTime(), now.getTime() - 7 * 86_400_000));
  const p = new URLSearchParams({
    api_key: apiKey,
    postedFrom: mdY(from),
    postedTo: mdY(now),
    limit: String(PAGE),
    offset: String(offset),
  });
  return `${ENDPOINT}?${p.toString()}`;
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
        const res = await ctx.fetch(buildSamUrl(key, ctx.since, now, page * PAGE), {
          headers: { Accept: 'application/json', 'User-Agent': UA },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          ctx.log(`sam-gov: HTTP ${res.status}`);
          break;
        }
        const json = (await res.json()) as Obj;
        all.push(...parseSam(json));
        const total = Number(json?.totalRecords);
        if (!Number.isFinite(total) || (page + 1) * PAGE >= total) break;
      }
    } catch (e) {
      ctx.log(`sam-gov: ${e instanceof Error ? e.message : String(e)}`);
    }
    return all;
  },
};

export const adapters: Adapter[] = [sam];
