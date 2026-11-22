/**
 * Which permit sources expose a status column that can carry "final inspection", "finaled" or "certificate of occupancy"
 * (PLAN-2.0 item 2.1). Read from each adapter's CONFIG (summaryFields, notes) and the test fixtures on 2026-11-22, not from the portals:
 * no portal was called. tests/signals/stage.test.ts keeps this table and the `statusField` of every dataset in step.
 *
 *   field      the column the adapter reads (the dataset's `statusField`)
 *   evidence   where the column name is seen: 'config' (already requested by the adapter), 'fixture' (a recorded response row has it)
 *
 *   stageDate  the column the stage query filters on (the dataset's `stageQuery.dateField`), or null when the source has no stage query
 *              yet. ':updated_at' is the Socrata row-update time, used where no status date column is known from this repo. NONE of these
 *              date columns is seen in this repo's code or fixtures (SF `status_date` is a documented SF DBI column); a wrong name makes the
 *              portal answer an error, which the adapter logs ("stage query not used") and ignores. All need a live field check.
 *
 * The main query of every source below filters on the ISSUE date over a short window (7 days; 30 for Montgomery County, 14 for Los Angeles),
 * so a permit that reaches final inspection months after it was issued is only seen through the stage query (lib/signals/adapters/socrata.ts
 * buildSocrataStageQuery). DeKalb (ArcGIS) has no stage query: its status-date column is not known from this repo ("needs live field check").
 */
export const PERMIT_STATUS_SOURCES: Readonly<Record<string, { field: string; evidence: 'config' | 'fixture'; stageDate: string | null }>> = {
  'socrata-sf-permits': { field: 'status', evidence: 'config', stageDate: 'status_date' },
  'socrata-nola-permits': { field: 'currentstatus', evidence: 'config', stageDate: ':updated_at' },
  'arcgis-dekalb-permits': { field: 'statusDescription', evidence: 'config', stageDate: null },
  'socrata-cambridge-permits': { field: 'status', evidence: 'config', stageDate: ':updated_at' },
  'socrata-montgomery-permits': { field: 'status', evidence: 'config', stageDate: ':updated_at' },
  'socrata-chicago-permits': { field: 'permit_status', evidence: 'fixture', stageDate: ':updated_at' },
  'socrata-norfolk-permits': { field: 'status', evidence: 'fixture', stageDate: ':updated_at' },
};
