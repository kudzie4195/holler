import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { buildArcgisAdapter, parseArcgisReport } from './arcgis';
import { arcgisPageUrl, type ArcgisDataset } from './arcgis-datasets';

/**
 * Johns Creek, GA building permits (City of Johns Creek GIS, ArcGIS Online org bqfNVPUK3HOnCFmA).
 *
 * The layer has no description column: JobTypeDescription is empty on 185 of 282 rows issued in the last 30 days. The trade is in the
 * job number prefix instead (MECH-26-0767 is a mechanical permit, ELCT electrical, PLMB plumbing). This file turns that prefix into a short
 * work-type word from a FIXED list (JOHNS_CREEK_PREFIX_TYPES) and hands it to the shared parser as a structured "type" value
 * (the synthetic attribute JobWorkType). The synthetic field is never sent to the server and nothing else about the id is printed.
 * Prefixes not on the list (FIRE, RWEP right of way, LDP land disturbance, ADMIN, REV, RET, LV, BOND, BANR, BLDB) are not queried at all.
 */
const JC_LAYER = 'https://services1.arcgis.com/bqfNVPUK3HOnCFmA/ArcGIS/rest/services/Building_Permits_Issued/FeatureServer/0';

export const JOHNS_CREEK_PREFIX_TYPES: Record<string, string> = {
  MECH: 'Mechanical',
  ELCT: 'Electrical',
  PLMB: 'Plumbing',
  FENCE: 'Fence',
  TREE: 'Tree removal',
  DEMO: 'Demolition',
  SG: 'Sign',
  BLDR: 'Residential building',
  BLDC: 'Commercial building',
};

/** The synthetic attribute name. Contains "Type" so the permit classifier reads it as a structured value. */
export const JC_SYNTH_FIELD = 'JobWorkType';

export const JOHNS_CREEK_PERMITS: ArcgisDataset = {
  id: 'arcgis-johnscreek-permits', city: 'Johns Creek', state: 'GA', tz: 'America/New_York', layerUrl: JC_LAYER,
  kind: 'permit', subtype: 'permit', idField: 'JobID', dateField: 'ISSUE_DATE', dateType: 'date',
  titleFields: ['JobTypeDescription'], textFields: ['JobTypeDescription', JC_SYNTH_FIELD], summaryFields: [JC_SYNTH_FIELD],
  addressFields: ['JobAddress'],
  // Round 15: the job-site address as a private site row (no owner, applicant or contractor column exists). No value column either.
  contacts: { verifiedUrl: `${JC_LAYER}?f=json`, checkedOn: '2026-11-19', fieldStatus: 'sourced', site: { addressFields: ['JobAddress'] } },
  valueFields: [],
  extraWhere: `(${Object.keys(JOHNS_CREEK_PREFIX_TYPES).map((p) => `JobID LIKE '${p}-%'`).join(' OR ')})`,
  windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: `${JC_LAYER}?f=json`, checkedOn: '2026-11-19', fieldSource: 'sourced',
  note: 'City of Johns Creek building permits issued, layer Building_Permits_Issued/0, 11 fields (JobID, JobTypeDescription, JobAddress, JobSquareFootage, JobStatus, ISSUE_DATE and others). Live checks 2026-11-19: editingInfo.dataLastEditDate 2026-11-18, newest ISSUE_DATE 2026-11-17, 282 rows issued in the last 30 days, 20584 rows in all. No owner, applicant or contractor column. The trade comes from the JobID prefix (see JOHNS_CREEK_PREFIX_TYPES). Sibling layers Code_Compliance_Cases (last edit 2022-10), Citizen_Requests_and_Issues (2022-04), Citizen_Requests_and_Calls (2019-08) and Utility_Permits (2022-08) are stale and not used.',
};

/** Adds the synthetic work-type attribute to each feature (new objects; the input is not changed). Unknown prefixes get no value. */
export function addJobWorkType(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const b = body as { features?: unknown };
  if (!Array.isArray(b.features)) return body;
  const features = b.features.map((f) => {
    if (!f || typeof f !== 'object') return f;
    const feat = f as { attributes?: Record<string, unknown> };
    if (!feat.attributes || typeof feat.attributes !== 'object') return f;
    const id = typeof feat.attributes.JobID === 'string' ? feat.attributes.JobID : '';
    const prefix = id.split('-')[0]?.toUpperCase() ?? '';
    const word = Object.prototype.hasOwnProperty.call(JOHNS_CREEK_PREFIX_TYPES, prefix) ? JOHNS_CREEK_PREFIX_TYPES[prefix] : undefined;
    return { ...feat, attributes: { ...feat.attributes, ...(word ? { [JC_SYNTH_FIELD]: word } : {}) } };
  });
  return { ...b, features };
}

/** Same as parseArcgis for this layer, with the prefix word added first. */
export function parseJohnsCreek(raw: unknown): SignalInput[] {
  return parseArcgisReport(addJobWorkType(raw), JOHNS_CREEK_PERMITS).items;
}

/** The shared adapter with two changes: the synthetic field is removed from outFields, and the prefix word is added to the response. */
export function buildJohnsCreekAdapter(): Adapter {
  const base = buildArcgisAdapter(JOHNS_CREEK_PERMITS);
  return {
    ...base,
    sourceUrl: arcgisPageUrl(JOHNS_CREEK_PERMITS),
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      const wrapped: typeof fetch = async (input, init) => {
        let target = input;
        if (typeof input === 'string') {
          const u = new URL(input);
          const keep = (u.searchParams.get('outFields') ?? '').split(',').filter((f) => f && f !== JC_SYNTH_FIELD);
          u.searchParams.set('outFields', keep.join(','));
          target = u.toString();
        }
        const res = await ctx.fetch(target, init);
        if (!res.ok) return res;
        const body: unknown = await res.json();
        return new Response(JSON.stringify(addJobWorkType(body)), { status: res.status, headers: { 'content-type': 'application/json' } });
      };
      return base.fetch({ ...ctx, fetch: wrapped });
    },
  };
}

export const adapters: Adapter[] = [buildJohnsCreekAdapter()];
