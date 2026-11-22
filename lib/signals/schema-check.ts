/**
 * Round 19 coverage: the schema check for feeds whose column names were never read from the portal itself (COVERAGE-research.md tags
 * [3P] and [A]). Pure, no I/O. When a feed answers with rows but none of them has the id or the date column the config expects, or
 * the date column holds nothing that reads as a date, the adapter logs ONE line starting "error: schema mismatch: ...". run.ts turns an
 * empty run with an error-looking log into an error on that source (holler_scan_runs.error, holler_source_health.last_error), which is
 * what GET /api/admin/sources shows the owner. The line names column names only, never a value from a row.
 */

export const SCHEMA_MISMATCH = 'schema mismatch';

/** Column names present in at least one row (rows that are not objects are ignored). Sorted. */
export function columnsSeen(rows: readonly unknown[]): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r && typeof r === 'object' && !Array.isArray(r)) for (const k of Object.keys(r)) set.add(k);
  return [...set].sort();
}

/** Expected columns that no row has (a column that is null in every row counts as present: the key is there). */
export function missingColumns(rows: readonly unknown[], expected: readonly string[]): string[] {
  const seen = new Set(columnsSeen(rows));
  return [...new Set(expected.filter(Boolean))].filter((c) => !seen.has(c));
}

export interface SchemaExpectation {
  /** The id column, or every column of a composite id. */
  idFields: readonly string[];
  dateField: string;
  /** True when the raw value of the date column can be read as a date (the adapter's own parser). */
  readsAsDate: (v: unknown) => boolean;
}

/**
 * Null when the rows fit, else the problem in a few words ("expected ISSUEDATE", "issued_date is not readable as a date"). Only called
 * when rows came back and none parsed, so a quiet day is never a mismatch. Column names only.
 */
export function schemaProblem(rows: readonly unknown[], exp: SchemaExpectation): string | null {
  const objects = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
  if (objects.length === 0) return null;
  const missing = missingColumns(objects, [...exp.idFields, exp.dateField]);
  if (missing.length) return `expected ${missing.join(', ')}`;
  const dated = objects.filter((r) => r[exp.dateField] != null && r[exp.dateField] !== '');
  if (dated.length > 0 && !dated.some((r) => exp.readsAsDate(r[exp.dateField]))) return `${exp.dateField} is not readable as a date`;
  return null;
}

/** The log line: column names and counts only (no row value, no URL). At most 12 column names are listed. */
export function schemaMismatchLog(sourceId: string, problem: string, rows: readonly unknown[]): string {
  const cols = columnsSeen(rows);
  const shown = cols.slice(0, 12).join(', ') + (cols.length > 12 ? `, and ${cols.length - 12} more` : '');
  return `error: ${SCHEMA_MISMATCH}: ${problem} (${sourceId}: 0 of ${rows.length} rows parsed; columns seen: ${shown || 'none'})`;
}

/** Is this stored error a schema mismatch? (the sources report flags it) */
export function isSchemaMismatch(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.includes(`${SCHEMA_MISMATCH}:`);
}
