import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { buildArcgisAdapter, parseArcgisReport } from './arcgis';
import { ARCGIS_DATASETS, arcgisPageUrl, type ArcgisDataset } from './arcgis-datasets';

/**
 * Cobb County permits (Accela_PermitsDashboard layers 4, 1 and 3).
 *
 * The layers return NO geometry and have no ZIP or city column, so the shared parser places each row at ds.fallbackCenter (the county
 * seat, flagged data.approxLocation). This file adds what the shared parser does not know about:
 *  - data.loc = 'approx' (the marker the display code reads, see lib/signals/approx-location.ts);
 *  - coordinates rounded to 2 decimals (about 0.7 mile), so a row never looks like a surveyed point;
 *  - a synthetic work-type word (COBB_WORK_TYPES, CobbWorkType) for two permit subtypes the shared classifier has no word for: "New Tenant"
 *    (commercial, 31 of 48 rows in 30 days) becomes "Tenant fit-out" and "Townhome" (multi-unit, 9 of 9) becomes "New multi-family". Both are
 *    ASSUMED readings of the county's subtype names (not documented on the layer); every other subtype, such as "Vacant Tenant", gets no word
 *    and is dropped when the classifier cannot place it. The synthetic field is never sent to the server and never printed except as that label;
 *  - "Cobb County" in the public summary, next to the permit's own street address (printed as for every other permit feed).
 */
export const COBB_SOURCE_IDS: readonly string[] = [
  'arcgis-cobb-residential-permits',
  'arcgis-cobb-commercial-permits',
  'arcgis-cobb-multiunit-permits',
];

export const COBB_DATASETS: ArcgisDataset[] = ARCGIS_DATASETS.filter((d) => COBB_SOURCE_IDS.includes(d.id));

/** Subtype to fixed work-type word. Nothing else from the row is turned into a word. */
export const COBB_WORK_TYPES: Record<string, string> = {
  'new tenant': 'Tenant fit-out',
  townhome: 'New multi-family',
};
export const COBB_SYNTH_FIELD = 'CobbWorkType';

/** Adds the synthetic attribute to each feature (new objects; the input is not changed). */
export function addCobbWorkType(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const b = body as { features?: unknown };
  if (!Array.isArray(b.features)) return body;
  const features = b.features.map((f) => {
    if (!f || typeof f !== 'object') return f;
    const feat = f as { attributes?: Record<string, unknown> };
    const a = feat.attributes;
    if (!a || typeof a !== 'object') return f;
    const sub = typeof a.PermitSubType === 'string' ? a.PermitSubType.trim().toLowerCase() : '';
    const word = Object.prototype.hasOwnProperty.call(COBB_WORK_TYPES, sub) ? COBB_WORK_TYPES[sub] : undefined;
    return word ? { ...feat, attributes: { ...a, [COBB_SYNTH_FIELD]: word } } : f;
  });
  return { ...b, features };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** New items (the input is not changed) with the approximate-location marker, 2-decimal coordinates and the county in the summary. */
export function markApprox(items: SignalInput[], ds: ArcgisDataset): SignalInput[] {
  return items.map((s) => {
    const summary = s.summary ? (/cobb county/i.test(s.summary) ? s.summary : `${s.summary} | ${ds.city}`) : s.summary;
    return {
      ...s,
      lat: typeof s.lat === 'number' ? r2(s.lat) : s.lat,
      lon: typeof s.lon === 'number' ? r2(s.lon) : s.lon,
      summary,
      data: { ...(s.data ?? {}), approxLocation: true, loc: 'approx' },
    };
  });
}

export function parseCobb(raw: unknown, ds: ArcgisDataset): SignalInput[] {
  return markApprox(parseArcgisReport(addCobbWorkType(raw), ds).items, ds);
}

export function buildCobbAdapter(ds: ArcgisDataset): Adapter {
  const base = buildArcgisAdapter(ds);
  return {
    ...base,
    sourceUrl: arcgisPageUrl(ds),
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      const wrapped: typeof fetch = async (input, init) => {
        let target = input;
        if (typeof input === 'string') {
          const u = new URL(input);
          const keep = (u.searchParams.get('outFields') ?? '').split(',').filter((f) => f && f !== COBB_SYNTH_FIELD);
          u.searchParams.set('outFields', keep.join(','));
          target = u.toString();
        }
        const res = await ctx.fetch(target, init);
        if (!res.ok) return res;
        const body: unknown = await res.json();
        return new Response(JSON.stringify(addCobbWorkType(body)), { status: res.status, headers: { 'content-type': 'application/json' } });
      };
      return markApprox(await base.fetch({ ...ctx, fetch: wrapped }), ds);
    },
  };
}

export const adapters: Adapter[] = COBB_DATASETS.filter((d) => d.verified).map(buildCobbAdapter);
