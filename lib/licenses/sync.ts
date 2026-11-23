import type { SupabaseClient } from '@supabase/supabase-js';
import { toCompanyRow, type DropReason, type LicenseRow } from './company-row';
import { fetchLicenseRows } from './fetch';
import { expectedColumns, licenseSourceForState, LICENSE_SOURCES } from './sources';
import { upsertLicenseRows } from './store';

type Db = SupabaseClient;

export const SYNC_MAX_ROWS = 50_000;
export const PROBE_ROWS = 500;

type DropCounts = Record<DropReason, number>;
const noDrops = (): DropCounts => ({ no_number: 0, individual_type: 0, holder_not_company: 0, no_name: 0 });

/** Filter raw rows to company rows; counts only (no raw row, name or number is returned or logged). */
export function filterCompanyRows(state: string, raw: readonly Record<string, string>[], fetchedAt: string): { rows: LicenseRow[]; dropped: DropCounts } {
  const src = licenseSourceForState(state);
  const dropped = noDrops();
  const rows: LicenseRow[] = [];
  if (!src) return { rows, dropped };
  const seen = new Set<string>();
  for (const r of raw) {
    const out = toCompanyRow((c) => (typeof r[c] === 'string' ? r[c] : ''), src, fetchedAt);
    if ('drop' in out) {
      dropped[out.drop] += 1;
      continue;
    }
    if (seen.has(out.row.license_number)) continue; // one row per number in a batch (the upsert key)
    seen.add(out.row.license_number);
    rows.push(out.row);
  }
  return { rows, dropped };
}

export interface LicenseSyncResult {
  state: string;
  source: string | null;
  status: 'disabled' | 'unknown_state' | 'fetch_failed' | 'table_missing' | 'ok';
  httpStatus?: number | null;
  read?: number;
  kept?: number;
  dropped?: DropCounts;
  written?: number;
  failed?: number;
  done?: boolean;
  nextOffset?: number;
  error?: string;
}

/**
 * One state's licence file into holler_contractor_licenses. Off unless `enabled` (HOLLER_LICENSE_SYNC_ENABLED). Reads at most `maxRows`
 * rows from `offset`, keeps company licensees only (toCompanyRow) and upserts them; a person-licensee row is never sent to the database.
 */
export async function runLicenseSync(opts: {
  db: Db;
  state: string;
  fetch: typeof fetch;
  enabled: boolean;
  now?: Date;
  offset?: number;
  maxRows?: number;
  deadline?: number;
  socrataToken?: string;
}): Promise<LicenseSyncResult> {
  const state = opts.state.trim().toUpperCase();
  if (!opts.enabled) return { state, source: null, status: 'disabled' };
  const src = licenseSourceForState(state);
  if (!src) return { state, source: null, status: 'unknown_state' };
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const got = await fetchLicenseRows(src, opts.fetch, {
    maxRows: Math.min(opts.maxRows ?? SYNC_MAX_ROWS, SYNC_MAX_ROWS),
    offset,
    deadline: opts.deadline,
    socrataToken: opts.socrataToken,
  });
  if (got.error && !got.rows.length) return { state, source: src.id, status: 'fetch_failed', httpStatus: got.httpStatus, error: got.error };
  const { rows, dropped } = filterCompanyRows(state, got.rows, (opts.now ?? new Date()).toISOString());
  const w = await upsertLicenseRows(opts.db, rows);
  if (w === 'missing') return { state, source: src.id, status: 'table_missing', httpStatus: got.httpStatus, read: got.rows.length, kept: rows.length, dropped };
  return {
    state,
    source: src.id,
    status: 'ok',
    httpStatus: got.httpStatus,
    read: got.rows.length,
    kept: rows.length,
    dropped,
    written: w.written,
    failed: w.failed,
    done: got.done,
    nextOffset: offset + got.rows.length,
  };
}

export interface LicenseProbeResult {
  state: string;
  status: 'unknown_state' | 'unreachable' | 'ok';
  source?: string;
  fileUrl?: string;
  httpStatus?: number | null;
  /** Column names (or positions) present in the sample. */
  columns?: string[];
  missingExpected?: string[];
  schema?: 'ok' | 'mismatch';
  /** Rows read in the sample (at most PROBE_ROWS). */
  rowCount?: number;
  /** How many of them would be stored as companies. */
  keptAsCompanies?: number;
  dropped?: DropCounts;
  /** How many kept rows carry a business phone. */
  keptWithPhone?: number;
  error?: string;
  knownStates?: string[];
  note?: string;
}

/** The owner's schema check for one state's licence file: a sample of PROBE_ROWS rows, counts only, nothing written. */
export async function runLicenseProbe(stateRaw: string, f: typeof fetch, socrataToken?: string): Promise<LicenseProbeResult> {
  const state = stateRaw.trim().toUpperCase();
  const src = licenseSourceForState(state);
  if (!src) return { state, status: 'unknown_state', knownStates: LICENSE_SOURCES.map((s) => s.state) };
  const got = await fetchLicenseRows(src, f, { maxRows: PROBE_ROWS, timeoutMs: 15_000, deadline: Date.now() + 45_000, socrataToken });
  if (got.error && !got.rows.length) return { state, status: 'unreachable', source: src.id, fileUrl: src.fileUrl, httpStatus: got.httpStatus, error: got.error, note: src.note };
  const expected = expectedColumns(src);
  const present = new Set(got.columns);
  const missingExpected = expected.filter((c) => !present.has(c));
  const { rows, dropped } = filterCompanyRows(state, got.rows, new Date().toISOString());
  return {
    state,
    status: 'ok',
    source: src.id,
    fileUrl: src.fileUrl,
    httpStatus: got.httpStatus,
    columns: got.columns.slice(0, 80),
    missingExpected,
    schema: missingExpected.length ? 'mismatch' : 'ok',
    rowCount: got.rows.length,
    keptAsCompanies: rows.length,
    dropped,
    keptWithPhone: rows.filter((r) => r.business_phone).length,
    note: src.note,
  };
}
