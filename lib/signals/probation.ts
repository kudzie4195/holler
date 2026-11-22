import { SOCRATA_DATASETS } from './adapters/socrata-datasets';
import { ARCGIS_DATASETS } from './adapters/arcgis-datasets';
import { CARTO_DATASETS } from './adapters/carto-datasets';

/**
 * Source ids on probation (round 19, Adapter.probation): read from the same dataset configs the adapters are built from, so a source
 * leaves this set the moment its `probation: true` is removed. tests/integration/r19-int-probation.test.ts pins it equal to the registry's
 * probation adapters.
 *
 * The scan already keeps every probation row out of holler_signals (lib/signals/run.ts writes them to holler_source_samples only). This set
 * is the second wall for the readers that would otherwise trust holler_signals (round 19 integration): matching (lib/signals/match.ts),
 * address lists (lib/lists/core.ts) and the business lookup (lib/enrich/business-lookup.ts) refuse a row whose source is listed here, so a
 * probation row that reached holler_signals by any other path (a manual insert, a half-promoted source) still makes no card, list line or
 * paid lookup. It is independent of the contact gate (alert_hold): neither rule reads or relaxes the other.
 */
export const PROBATION_SOURCE_IDS: ReadonlySet<string> = new Set(
  [...SOCRATA_DATASETS, ...ARCGIS_DATASETS, ...CARTO_DATASETS].filter((d) => d.probation === true).map((d) => d.id),
);

/** True when the record's source is on probation. Source ids are exact (no case folding). */
export function isProbationSource(source: string | null | undefined): boolean {
  return typeof source === 'string' && PROBATION_SOURCE_IDS.has(source);
}
