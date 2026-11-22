/**
 * Which permit sources expose a status column that can carry "final inspection", "finaled" or "certificate of occupancy"
 * (PLAN-2.0 item 2.1). Read from each adapter's CONFIG (summaryFields, notes) and the test fixtures on 2026-11-22, not from the portals:
 * no portal was called. tests/signals/stage.test.ts keeps this table and the `statusField` of every dataset in step.
 *
 *   field      the column the adapter reads (the dataset's `statusField`)
 *   evidence   where the column name is seen: 'config' (already requested by the adapter), 'fixture' (a recorded response row has it)
 *
 * Caveat that holds for every source below: the adapters fetch by ISSUE date over a short window (7 days; 30 for Montgomery County, 14 for Los
 * Angeles), so a status is only re-read while its permit is still inside that window. A new house that reaches final inspection months after
 * issue is not re-read by the current queries. Catching it needs a query on the status-change date column of each portal, which is not
 * verified for any of them (see STAGE-report.md).
 */
export const PERMIT_STATUS_SOURCES: Readonly<Record<string, { field: string; evidence: 'config' | 'fixture' }>> = {
  'socrata-sf-permits': { field: 'status', evidence: 'config' },
  'socrata-nola-permits': { field: 'currentstatus', evidence: 'config' },
  'arcgis-dekalb-permits': { field: 'statusDescription', evidence: 'config' },
  'socrata-cambridge-permits': { field: 'status', evidence: 'config' },
  'socrata-montgomery-permits': { field: 'status', evidence: 'config' },
  'socrata-chicago-permits': { field: 'permit_status', evidence: 'fixture' },
  'socrata-norfolk-permits': { field: 'status', evidence: 'fixture' },
};
