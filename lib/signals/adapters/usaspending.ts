import type { CategoryId } from '@/lib/signals/categories';
import { classifyText } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '@/lib/signals/types';
import { CITIES } from '@/lib/geo';

/**
 * USAspending.gov API v2, no key. POST /api/v2/search/spending_by_award/
 * Docs (sourced): https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/search/spending_by_award.md
 *  - body: filters{award_type_codes (required), time_period[{start_date,end_date}], naics_codes{require[],exclude[]}}, fields[], limit, page, sort, order
 *  - contract field names: Award ID, Recipient Name, Award Amount, Description, Start Date, Place of Performance City Code,
 *    Place of Performance State Code, Place of Performance Zip5, Primary Place of Performance, NAICS, generated_internal_id, Awarding Agency, Last Modified Date
 *  - response: results[], page_metadata{page,hasNext}
 * Assumed: shape of "Primary Place of Performance" ({city_name, state_code}) and "NAICS" ({code, description}); the parser accepts strings too.
 */

const ENDPOINT = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';

export const NAICS_PREFIXES = ['561720', '561730', '561710', '561612', '238', '236', '562', '722'];

/** NAICS code (any length) to Holler categories. Longest/most specific rule wins, then falls back to the family. */
export function naicsToCategories(code: string | null | undefined): CategoryId[] {
  const c = (code ?? '').replace(/\D/g, '');
  if (!c) return [];
  const rules: [string, CategoryId[]][] = [
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
  for (const [prefix, cats] of rules) {
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
  const t = str(v);
  if (!t) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00Z` : t);
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
        const zip = str(r['Place of Performance Zip5']).slice(0, 5) || null;

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
          occurredAt: dateIso(r['Start Date']) ?? dateIso(r['Last Modified Date']) ?? new Date().toISOString(),
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
      time_period: [{ start_date: day(start), end_date: day(now) }],
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
        ctx.log(`usaspending: HTTP ${res.status}`);
        return [];
      }
      return parseUsaSpending(await res.json());
    } catch (e) {
      ctx.log(`usaspending: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};

export const adapters: Adapter[] = [usaspending];
