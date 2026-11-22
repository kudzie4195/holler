import { isSchemaMismatch } from './schema-check';
import { isProbationNote } from './probation-note';

/**
 * Source probation, the owner's view (round 19 COVERAGE). The storage side is lib/signals/samples.ts and the scan side lib/signals/run.ts
 * (a probation adapter's rows go to holler_source_samples only). This module lists the probation sources for GET /api/admin/sources,
 * with the health state each one is in, so a source whose columns do not match ("schema mismatch: expected ISSUEDATE") is visible to the
 * owner instead of silently storing nothing. Pure: rows in, rows out.
 */

export type ProbationPlatform = 'socrata' | 'arcgis' | 'carto';

/** One source added by round 19 COVERAGE: where it is, what it can carry, and how sure the schema is (COVERAGE-research.md tags). */
export interface CoverageSource {
  id: string;
  metro: 'dallas-fort-worth' | 'houston' | 'miami' | 'phoenix';
  platform: ProbationPlatform;
  endpoint: string;
  offers: { contractor: boolean; value: boolean; coordinates: 'geometry' | 'lat/lon columns' | 'zip centroid'; status: boolean };
  /** Research tag of the column names: O opened, 3P third party, A assumed. */
  schemaTag: 'O' | '3P' | 'A';
  /**
   * The label lib/signals/lead-rules.ts SOURCE_DEFAULTS should give it at integration (this unit may not edit lead-rules.ts). Same
   * defaults as the existing sources of the same kind: a permit coming_soon, a code violation act_now, a 311 request coming_soon.
   */
  label: 'coming_soon' | 'act_now';
}

export const COVERAGE_R19_SOURCES: readonly CoverageSource[] = [
  {
    id: 'socrata-dallas-permits', metro: 'dallas-fort-worth', platform: 'socrata', endpoint: 'https://www.dallasopendata.com/resource/e7gq-4sah.json',
    offers: { contractor: true, value: true, coordinates: 'zip centroid', status: false }, schemaTag: '3P', label: 'coming_soon',
  },
  {
    id: 'arcgis-arlington-permits', metro: 'dallas-fort-worth', platform: 'arcgis', endpoint: 'https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1',
    offers: { contractor: false, value: true, coordinates: 'geometry', status: true }, schemaTag: 'O', label: 'coming_soon',
  },
  {
    id: 'arcgis-miamidade-permits', metro: 'miami', platform: 'arcgis', endpoint: 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services/miamidade_permit_data/FeatureServer/0',
    offers: { contractor: true, value: true, coordinates: 'geometry', status: true }, schemaTag: '3P', label: 'coming_soon',
  },
  {
    id: 'arcgis-miamidade-violations', metro: 'miami', platform: 'arcgis', endpoint: 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services/CodeComplianceViolation_Open_View/FeatureServer/0',
    offers: { contractor: false, value: false, coordinates: 'geometry', status: true }, schemaTag: '3P', label: 'act_now',
  },
  {
    id: 'arcgis-miamidade-building-violations', metro: 'miami', platform: 'arcgis', endpoint: 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services/BuildingViolation_gdb/FeatureServer/0',
    offers: { contractor: false, value: false, coordinates: 'geometry', status: false }, schemaTag: '3P', label: 'act_now',
  },
  {
    id: 'arcgis-phoenix-permits', metro: 'phoenix', platform: 'arcgis', endpoint: 'https://mapportal.phoenix.gov/pds/rest/services/ShapePHX/ShapePHXPermitsPoints/MapServer/0',
    offers: { contractor: false, value: false, coordinates: 'geometry', status: true }, schemaTag: 'O', label: 'coming_soon',
  },
  {
    id: 'arcgis-tempe-permits', metro: 'phoenix', platform: 'arcgis', endpoint: 'https://services.arcgis.com/lQySeXwbBg53XWDi/arcgis/rest/services/building_permits/FeatureServer/0',
    offers: { contractor: true, value: true, coordinates: 'lat/lon columns', status: true }, schemaTag: 'A', label: 'coming_soon',
  },
  {
    id: 'arcgis-houston-311', metro: 'houston', platform: 'arcgis', endpoint: 'https://mycity2.houstontx.gov/pubgis01/rest/services/311/D365_SR311_PROD/MapServer/0',
    offers: { contractor: false, value: false, coordinates: 'lat/lon columns', status: true }, schemaTag: 'O', label: 'coming_soon',
  },
];

/**
 * Sources that are registered but have no SOURCE_DEFAULTS entry yet, because lib/signals/lead-rules.ts belongs to another unit this round.
 * tests/signals/lead-rules.test.ts lets ONLY these ids, and only while they are on probation, go without an entry (they reach no member,
 * so no label is ever computed for them). At integration: add each id with COVERAGE_R19_SOURCES[].label to SOURCE_DEFAULTS.
 */
export const LABEL_PENDING_INTEGRATION: readonly string[] = COVERAGE_R19_SOURCES.map((s) => s.id);

/** The owner's probe for a coverage source (Bearer CRON_SECRET only). */
export function coverageProbePath(id: string): string {
  return `/api/admin/coverage-probe?source=${encodeURIComponent(id)}`;
}

export interface ProbationHealthLite {
  source: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  /** Newest record date the source ever returned (null: it has never returned a row). */
  last_record_at?: string | null;
}

/** The latest holler_scan_runs row of a source (error column only): carries a probation note such as "row cap reached". */
export interface ProbationRunLite {
  source: string;
  started_at: string | null;
  error: string | null;
}

export interface ProbationRow {
  id: string;
  /** Always true: listed here only while on probation. */
  probation: true;
  metro: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /**
   * Review P2-C/D/F: a broken source never reads "ok".
   *   not_run          no scan has recorded it yet (or the samples table is missing, which skips it)
   *   schema_mismatch  the expected id, date or flag column is missing, or the date is unreadable (lastError says which)
   *   not_json         the portal answered 200 with an HTML page or an empty body
   *   no_recent_rows   rows came back, but none in the age window (lastError names the newest date)
   *   error            any other failure (HTTP status, timeout, unreadable field list ...)
   *   no_rows          ran without error but has never returned a row
   *   row_cap          worked, but the last run read a full page: older rows in the window were not read (note says so)
   *   ok               the last run worked and the source has returned rows
   */
  check: 'not_run' | 'ok' | 'schema_mismatch' | 'not_json' | 'no_recent_rows' | 'error' | 'no_rows' | 'row_cap';
  /** The latest run's probation note (row cap), when there is one. */
  note?: string;
  /** Coverage sources only: the probe to run before promoting it. */
  probe?: string;
  /** Where to remove the flag to promote it. */
  promote: string;
}

const PROMOTE_FILE: Record<ProbationPlatform, string> = {
  socrata: 'lib/signals/adapters/socrata-datasets.ts',
  arcgis: 'lib/signals/adapters/coverage-datasets.ts',
  carto: 'lib/signals/adapters/carto-datasets.ts and buildCartoAdapter (lib/signals/adapters/carto.ts)',
};

function platformOf(id: string): ProbationPlatform | null {
  if (id.startsWith('socrata-')) return 'socrata';
  if (id.startsWith('arcgis-')) return 'arcgis';
  if (id.startsWith('carto-')) return 'carto';
  return null;
}

/** Every registered probation source with its last recorded run (holler_source_health), sorted by id. */
/** The check state of one probation source from its health row and its latest scan_runs row (see ProbationRow.check). */
export function probationCheck(h: ProbationHealthLite | undefined, lastRun?: ProbationRunLite): ProbationRow['check'] {
  if (!h || !h.last_run_at) return 'not_run';
  const e = h.last_error;
  if (e) {
    if (isSchemaMismatch(e)) return 'schema_mismatch';
    if (/empty response body|response was not JSON/.test(e)) return 'not_json';
    if (/no rows in the last \d+ days/.test(e)) return 'no_recent_rows';
    return 'error';
  }
  if (!h.last_record_at) return 'no_rows';
  if (lastRun && isProbationNote(lastRun.error) && /row cap reached/.test(lastRun.error ?? '')) return 'row_cap';
  return 'ok';
}

export function probationOverview(
  adapters: ReadonlyArray<{ id: string; probation?: boolean }>,
  health: readonly ProbationHealthLite[],
  metroOf: (id: string) => string | null,
  lastRuns: readonly ProbationRunLite[] = [],
): ProbationRow[] {
  const by = new Map(health.map((h) => [h.source, h]));
  const runBy = new Map<string, ProbationRunLite>();
  for (const r of lastRuns) {
    const prev = runBy.get(r.source);
    if (!prev || (r.started_at ?? '') > (prev.started_at ?? '')) runBy.set(r.source, r);
  }
  const coverage = new Set(COVERAGE_R19_SOURCES.map((s) => s.id));
  return adapters
    .filter((a) => a.probation)
    .map((a) => {
      const h = by.get(a.id);
      const run = runBy.get(a.id);
      const check = probationCheck(h, run);
      const platform = platformOf(a.id);
      const file = platform === 'arcgis' && !coverage.has(a.id) ? 'lib/signals/adapters/arcgis-datasets.ts' : platform ? PROMOTE_FILE[platform] : 'its adapter';
      return {
        id: a.id,
        probation: true as const,
        metro: metroOf(a.id),
        lastRunAt: h?.last_run_at ?? null,
        lastSuccessAt: h?.last_success_at ?? null,
        lastError: h?.last_error ?? null,
        check,
        ...(run && isProbationNote(run.error) ? { note: run.error as string } : {}),
        ...(coverage.has(a.id) ? { probe: coverageProbePath(a.id) } : {}),
        promote: `remove probation: true${coverage.has(a.id) ? ' and schemaUnverified: true' : ''} from its entry in ${file}${coverage.has(a.id) ? ' and add its SOURCE_DEFAULTS label in lib/signals/lead-rules.ts' : ''}, then deploy`,
      };
    })
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/**
 * Review P3-K: the sources the owner monitor may alert on: on now (no missing env key or flag) and NOT on probation. A probation source is
 * judged in the daily health report and GET /api/admin/sources, never by an alert email (several have assumed URLs and will fail first).
 */
export function monitoredSourceIds(adapters: ReadonlyArray<{ id: string; probation?: boolean }>, missingEnvOf: (a: { id: string }) => readonly string[]): Set<string> {
  return new Set(adapters.filter((a) => missingEnvOf(a).length === 0 && !a.probation).map((a) => a.id));
}
