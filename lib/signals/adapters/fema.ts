import { HOLLER_UA } from '@/lib/user-agent';
import type { CategoryId } from '../categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '../types';

/**
 * OpenFEMA Disaster Declarations Summaries v2.
 * Endpoint: https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries (OData-style $filter/$orderby/$top).
 * Confirmed 2026-11-17 by a live WebFetch of that endpoint: top-level keys are `metadata` and `DisasterDeclarationsSummaries`; each row has
 * femaDeclarationString, disasterNumber (number), state, declarationType, declarationDate ("2026-10-27T00:00:00.000Z"), fyDeclared,
 * incidentType, declarationTitle, ihProgramDeclared, iaProgramDeclared, paProgramDeclared, hmProgramDeclared, incidentBeginDate,
 * incidentEndDate, disasterCloseoutDate, tribalRequest, fipsStateCode, fipsCountyCode, placeCode, designatedArea ("Bay (County)"),
 * declarationRequestNumber, incidentId, region, lastRefresh, hash, id. The metadata object carries skip, select, rundate, top, filter,
 * format, metadata, orderby, entityname, version, url, count.
 * Query syntax confirmed live: `$filter=declarationDate ge '2026-10-18T00:00:00.000z'`, `$orderby=declarationDate desc`, `$top=N`, `$select=a,b`
 * all returned data; fema.gov/about/openfema/api documents $top default 1000 / max 10000, $select (case-sensitive field names), $orderby, ISO-8601 date
 * literals in single quotes. The wrapper key is the entity name (metadata.entityname), which the docs page does not state; the live response does.
 * One row per designated county, so rows are aggregated to one state-level signal per disaster.
 */
const BASE = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries';

const REBUILD: CategoryId[] = ['restoration', 'general-contractor', 'roofing', 'insurance', 'public-adjuster', 'tree-service', 'junk-removal'];

export function categoriesFor(incidentType: string): CategoryId[] {
  const t = incidentType.toLowerCase();
  if (/hurricane|tropical|typhoon|coastal storm|tornado|severe storm|straight-line|wind/.test(t)) return [...REBUILD, 'electrical', 'towing'];
  if (/flood|dam|levee|mud|landslide|tsunami/.test(t)) return ['restoration', 'plumbing', 'junk-removal', 'insurance', 'public-adjuster', 'general-contractor', 'pest-control'];
  if (/snow|ice|freez|winter/.test(t)) return ['snow-removal', 'tree-service', 'electrical', 'plumbing', 'hvac', 'restoration'];
  if (/fire/.test(t)) return ['restoration', 'insurance', 'public-adjuster', 'general-contractor', 'tree-service', 'junk-removal'];
  if (/earthquake|volcan/.test(t)) return ['general-contractor', 'restoration', 'insurance', 'plumbing', 'electrical'];
  if (/drought/.test(t)) return ['landscaping', 'lawn-care', 'pool-spa'];
  return []; // biological, chemical, terrorism, other: shown on public pages, not matched to trades
}

interface Row {
  disasterNumber?: number;
  state?: string;
  declarationType?: string;
  declarationDate?: string;
  incidentType?: string;
  declarationTitle?: string;
  designatedArea?: string;
  incidentBeginDate?: string;
  incidentEndDate?: string;
  iaProgramDeclared?: boolean;
  paProgramDeclared?: boolean;
}

export function parseFema(raw: unknown): SignalInput[] {
  const rows = (raw as { DisasterDeclarationsSummaries?: Row[] } | null)?.DisasterDeclarationsSummaries;
  if (!Array.isArray(rows)) return [];
  const groups = new Map<string, { first: Row; areas: string[] }>();
  for (const r of rows) {
    if (!r || typeof r.disasterNumber !== 'number' || typeof r.state !== 'string' || !r.declarationDate) continue;
    const key = `${r.disasterNumber}-${r.state}`;
    const g = groups.get(key) ?? { first: r, areas: [] };
    if (r.designatedArea && !g.areas.includes(r.designatedArea)) g.areas.push(r.designatedArea);
    groups.set(key, g);
  }
  const out: SignalInput[] = [];
  for (const [key, { first: r, areas }] of groups) {
    const t = Date.parse(r.declarationDate!);
    if (!Number.isFinite(t)) continue;
    const incident = r.incidentType ?? 'Disaster';
    const counties = areas.filter((a) => a && !/statewide/i.test(a)).map((a) => a.replace(/\s*\((county|parish|borough)\)\s*$/i, '').trim());
    const type = r.declarationType ?? '';
    // DR = major disaster, EM = emergency, FM = fire management assistance.
    const severity: Severity = type === 'DR' ? (r.iaProgramDeclared ? 3 : 2) : type === 'EM' || type === 'FM' ? 2 : 1;
    const label = type === 'DR' ? 'Major disaster declaration' : type === 'EM' ? 'Emergency declaration' : type === 'FM' ? 'Fire management assistance declaration' : 'Disaster declaration';
    const title = `${label}: ${r.declarationTitle ?? incident} (${r.state})`;
    const shown = counties.slice(0, 6).join(', ');
    const summary = `FEMA declared ${incident.toLowerCase()} ${type ? `(${type}-${r.disasterNumber}) ` : ''}for ${r.state}${counties.length ? `: ${counties.length} area${counties.length === 1 ? '' : 's'} designated${shown ? ` (${shown}${counties.length > 6 ? ', and more' : ''})` : ''}` : ' (statewide)'}.`;
    out.push({
      source: 'fema',
      externalId: key,
      kind: 'disaster',
      title,
      summary,
      url: `https://www.fema.gov/disaster/${r.disasterNumber}`,
      state: r.state,
      county: counties.length === 1 ? counties[0] : null,
      categories: categoriesFor(incident),
      severity,
      occurredAt: new Date(t).toISOString(),
      // A declaration does not expire, and it usually comes AFTER the incident period closes, so incidentEndDate is already in the
      // past on insert (live: DR-4955 FL declared 2026-10-27, incident ended 2026-10-12). Age is handled by the windows and the prune.
      expiresAt: null,
      data: {
        disasterNumber: r.disasterNumber,
        declarationType: type,
        incidentType: incident,
        counties,
        incidentBeginDate: r.incidentBeginDate ?? null,
        incidentEndDate: r.incidentEndDate ?? null,
        iaProgramDeclared: r.iaProgramDeclared ?? null,
        paProgramDeclared: r.paProgramDeclared ?? null,
      },
    });
  }
  return out;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(/^\s*</.test(text) ? 'expected JSON but received an HTML page' : 'expected JSON but received non-JSON text');
  }
}

export const femaAdapter: Adapter = {
  id: 'fema',
  label: 'FEMA disaster declarations',
  kind: 'disaster',
  cadenceMinutes: 360,
  sourceUrl: 'https://www.fema.gov/disaster/declarations',
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    try {
      const from = new Date(Date.now() - 30 * 86400_000).toISOString().replace(/Z$/, 'z');
      const qs = `$filter=${encodeURIComponent(`declarationDate ge '${from}'`)}&$orderby=${encodeURIComponent('declarationDate desc')}&$top=1000`;
      const res = await ctx.fetch(`${BASE}?${qs}`, {
        headers: { 'User-Agent': HOLLER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await readJson(res);
      const rows = (json as { DisasterDeclarationsSummaries?: unknown } | null)?.DisasterDeclarationsSummaries;
      if (!Array.isArray(rows)) {
        const keys = json && typeof json === 'object' ? Object.keys(json as object).slice(0, 8).join(',') : typeof json;
        ctx.log(`error: fema response has no DisasterDeclarationsSummaries array, wrapper key may have changed (top-level keys: ${keys})`);
        return [];
      }
      const out = parseFema(json);
      if (rows.length > 0 && out.length === 0) ctx.log(`error: parsed 0 of ${rows.length} rows, shape may have changed`);
      return out;
    } catch (e) {
      ctx.log(`error: fema fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  },
};

export const adapters: Adapter[] = [femaAdapter];
