import type { CategoryId } from '@/lib/signals/categories';
import { classifyText } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '@/lib/signals/types';
import { CITIES } from '@/lib/geo';

/**
 * USAspending.gov API v2, no key. POST /api/v2/search/spending_by_award/
 * Request (confirmed 2026-11-17):
 *  - contract md github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/search/spending_by_award.md:
 *    filters.award_type_codes required (A-D = contracts), fields required, sort must be one of the requested fields, order asc|desc,
 *    limit (100 is the maximum used by clients, sharedcontext.ai/skills/external/1102tools/usaspending-api), page, naics_codes as
 *    {require[],exclude[]} or an array of strings.
 *  - api_contracts/search_filters.md lists time_period[].date_type members action_date (default), date_signed, last_modified_date, new_awards_only.
 *  - 2, 4 or 6 digit NAICS only (usaspending-api search/filters/elasticsearch/naics.py).
 * Response (confirmed 2026-11-17 from usaspending_api/search/v2/views/spending_by_award.py and the contract md): results[] rows keyed by the requested
 * field names plus internal_id and generated_internal_id; `NAICS` and `PSC` are objects {code, description}; `Primary Place of Performance`
 * is an object {location_country_code, country_name, state_code, state_name, city_name, county_code, county_name, congressional_code, zip4, zip5};
 * the separate "Place of Performance ..." keys in the contract md are not row keys in the Elasticsearch code path, so the parser reads the nested object first
 * and falls back to the flat keys. Top level: spending_level, limit, results, page_metadata{page,hasNext}, messages[].
 * A live POST could not be made (WebFetch is GET only), so a verbatim response was not captured.
 */

const ENDPOINT = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';

/**
 * The API accepts only 2, 4 or 6 digit codes in naics_codes (usaspending-api search/filters/elasticsearch/naics.py:
 * "naics code filtering only supported for codes with lengths of 2, 4, and 6"). Families are therefore sent as 4 digit groups;
 * the 6 digit NAICS on each returned award is what drives the category mapping.
 */
export const NAICS_PREFIXES = [
  '561720', '561730', '561710', '561612', // janitorial, landscaping, pest control, security guards
  '2361', '2362', // residential and nonresidential building construction
  '2381', '2382', '2383', '2389', // specialty trade contractors
  '5621', '5622', '5629', // waste collection, treatment, remediation
  '7223', '7225', // special food services, restaurants
];

export const NAICS_RULES: [string, CategoryId[]][] = [
  ['561720', ['janitorial-commercial', 'cleaning']],
  ['561730', ['landscaping', 'lawn-care']],
  ['561710', ['pest-control']],
  ['561740', ['cleaning']],
  ['561210', ['janitorial-commercial']],
  ['561612', ['security']],
  ['561621', ['security']],
  ['238160', ['roofing']],
  ['238220', ['plumbing', 'hvac']],
  ['238210', ['electrical']],
  ['238320', ['painting']],
  ['238910', ['general-contractor', 'landscaping']],
  ['238', ['general-contractor']],
  ['236', ['general-contractor']],
  ['237', ['general-contractor']],
  ['562910', ['restoration']],
  ['562', ['junk-removal']],
  ['722', ['food-truck', 'catering']],
];

/** NAICS code (any length) to Holler categories. Longest/most specific rule wins, then falls back to the family. */
export function naicsToCategories(code: string | null | undefined): CategoryId[] {
  const c = (code ?? '').replace(/\D/g, '');
  if (!c) return [];
  for (const [prefix, cats] of NAICS_RULES) {
    if (c.startsWith(prefix)) return cats;
  }
  return [];
}

const STATE_NAME_TO_CODE = new Map<string, string>();
for (const c of CITIES) STATE_NAME_TO_CODE.set(c.stateName.toLowerCase(), c.state);

export function normalizeState(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATE_NAME_TO_CODE.get(t.toLowerCase()) ?? null;
}

const CITY_INDEX = new Map<string, (typeof CITIES)[number]>();
for (const c of CITIES) CITY_INDEX.set(`${c.name.toLowerCase()}|${c.state}`, c); // CITIES is population sorted; first wins
const nyc = CITIES.find((c) => c.slug === 'new-york-city-ny');
if (nyc) CITY_INDEX.set('new york|NY', nyc);

export function findCity(name: string | null | undefined, state: string | null | undefined) {
  const n = (name ?? '').trim().toLowerCase();
  const st = normalizeState(state);
  if (!n || !st) return null;
  return CITY_INDEX.get(`${n}|${st}`) ?? null;
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function dateIso(v: unknown): string | null {
  let t = str(v);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) t = `${t}T00:00:00Z`;
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(t)) t = `${t.replace(' ', 'T')}Z`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** Pure parser for a spending_by_award response. Never throws. */
export function parseUsaSpending(raw: unknown): SignalInput[] {
  try {
    const results = (raw as { results?: unknown })?.results;
    if (!Array.isArray(results)) return [];
    const out: SignalInput[] = [];
    for (const item of results) {
      try {
        if (!item || typeof item !== 'object') continue;
        const r = item as Record<string, unknown>;
        const internal = str(r.generated_internal_id) || str(r['Award ID']);
        if (!internal) continue;

        const naicsRaw = r.NAICS as unknown;
        const naicsCode =
          typeof naicsRaw === 'object' && naicsRaw
            ? str((naicsRaw as Record<string, unknown>).code)
            : str(naicsRaw).match(/\d{3,6}/)?.[0] ?? '';
        const desc = str(r.Description);
        let categories = naicsToCategories(naicsCode);
        if (categories.length === 0) categories = classifyText(desc);
        if (categories.length === 0) continue;

        const pop = r['Primary Place of Performance'];
        const popObj = pop && typeof pop === 'object' ? (pop as Record<string, unknown>) : {};
        const cityName = str(popObj.city_name);
        const stateCode = normalizeState(str(popObj.state_code) || str(r['Place of Performance State Code']));
        if (!stateCode) continue;
        const city = findCity(cityName, stateCode);
        const zip = str(popObj.zip5).slice(0, 5) || str(r['Place of Performance Zip5']).slice(0, 5) || null;

        const amount = typeof r['Award Amount'] === 'number' ? (r['Award Amount'] as number) : Number(r['Award Amount']);
        const hasAmount = Number.isFinite(amount) && amount > 0;
        const severity: Severity = hasAmount && amount >= 1_000_000 ? 2 : 1;
        const recipient = str(r['Recipient Name']);
        const agency = str(r['Awarding Agency']);
        const place = cityName ? `${titleCase(cityName)}, ${stateCode}` : stateCode;

        out.push({
          source: 'usaspending',
          externalId: internal,
          kind: 'contract',
          title: `Federal contract${hasAmount ? ` (${formatUsd(amount)})` : ''} in ${place}: ${
            desc ? titleCase(desc).slice(0, 100) : `NAICS ${naicsCode}`
          }`,
          summary:
            [recipient && `Awarded to ${titleCase(recipient)}`, agency && `by ${agency}`, naicsCode && `NAICS ${naicsCode}`]
              .filter(Boolean)
              .join(', ')
              .slice(0, 280) || null,
          url: `https://www.usaspending.gov/award/${encodeURIComponent(internal)}`,
          lat: city?.lat ?? null,
          lon: city?.lon ?? null,
          city: city?.name ?? (cityName ? titleCase(cityName) : null),
          state: stateCode,
          zip,
          categories,
          severity,
          // Recent activity, not the contract start: the request filters on last_modified_date, so old contracts with a recent
          // modification must not be stored with a 2019 date (the daily prune would delete them and the next scan would re-insert and re-notify).
          occurredAt: dateIso(r['Last Modified Date']) ?? dateIso(r['Start Date']) ?? new Date().toISOString(),
          data: { naics: naicsCode || null, amount: hasAmount ? amount : null, awardId: str(r['Award ID']) || null },
        });
      } catch {
        // skip malformed award
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function buildUsaSpendingBody(since: Date, now: Date = new Date()) {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const earliest = new Date(now.getTime() - 30 * 86_400_000);
  const start = since < earliest ? earliest : since;
  return {
    filters: {
      award_type_codes: ['A', 'B', 'C', 'D'],
      time_period: [{ start_date: day(start), end_date: day(now), date_type: 'last_modified_date' }],
      naics_codes: { require: NAICS_PREFIXES },
    },
    fields: [
      'Award ID',
      'Recipient Name',
      'Award Amount',
      'Description',
      'Start Date',
      'Place of Performance City Code',
      'Place of Performance State Code',
      'Place of Performance Zip5',
      'Primary Place of Performance',
      'NAICS',
      'generated_internal_id',
      'Awarding Agency',
      'Last Modified Date',
    ],
    limit: 100,
    page: 1,
    sort: 'Award Amount',
    order: 'desc',
  };
}

/** Structural counts for the silent-empty check: rows that carry an award id. */
export function usaspendingRowStats(raw: unknown): { rows: number; usable: number } | null {
  const results = (raw as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return null;
  let usable = 0;
  for (const r of results) {
    const o = r as Record<string, unknown> | null;
    if (o && typeof o === 'object' && (str(o.generated_internal_id) || str(o['Award ID']))) usable++;
  }
  return { rows: results.length, usable };
}

const usaspending: Adapter = {
  id: 'usaspending',
  label: 'Federal contract awards (USAspending.gov)',
  kind: 'contract',
  cadenceMinutes: 720,
  sourceUrl: 'https://www.usaspending.gov/',
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    try {
      const res = await ctx.fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify(buildUsaSpendingBody(ctx.since)),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
        ctx.log(`error: usaspending HTTP ${res.status}${detail && !/^\s*</.test(detail) ? ` ${detail}` : ''}`);
        return [];
      }
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        ctx.log(`error: usaspending ${/^\s*</.test(text) ? 'returned an HTML page instead of JSON' : 'returned non-JSON text'}`);
        return [];
      }
      const stats = usaspendingRowStats(json);
      if (!stats) {
        const keys = json && typeof json === 'object' ? Object.keys(json as object).slice(0, 8).join(',') : typeof json;
        ctx.log(`error: usaspending response has no results array, wrapper may have changed (top-level keys: ${keys})`);
        return [];
      }
      const out = parseUsaSpending(json);
      // The request filters on NAICS server side, so every returned row should be mappable: 0 of N means the shape moved.
      if (stats.rows > 0 && out.length === 0) ctx.log(`error: parsed 0 of ${stats.rows} rows, shape may have changed`);
      return out;
    } catch (e) {
      ctx.log(`error: usaspending ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};

export const adapters: Adapter[] = [usaspending];
