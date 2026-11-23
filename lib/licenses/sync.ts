import { PROBATION_FETCH_FLAG, probationFetchOn } from '@/lib/signals/probation-fetch';
import type { SupabaseClient } from '@supabase/supabase-js';
import { looksLikeFullPersonName } from '@/lib/contacts/org';
import { licenseKey, toCompanyRow, type DropReason, type LicenseRow } from './company-row';
import { fetchLicenseRows, type FetchErrorCode } from './fetch';
import { expectedColumns, isPromoted, licenseSourceForState, LICENSE_SOURCES, type LicenseSource } from './sources';
import { upsertLicenseRows } from './store';

type Db = SupabaseClient;

/** Rows per sync call (review LIC P3-7). */
export const SYNC_MAX_ROWS = 20_000;
/** The read stops this long after the call starts; filter and upsert then run inside the whole-run deadline. */
export const SYNC_READ_MS = 25_000;
export const SYNC_RUN_MS = 45_000;
export const PROBE_ROWS = 500;
const CHUNK = 2_000;

type DropCounts = Record<DropReason, number>;
const noDrops = (): DropCounts => ({ no_number: 0, individual_type: 0, holder_not_company: 0, no_name: 0 });

/** Filter raw rows to company rows; counts only (no raw row, name or number is returned or logged). */
export function filterCompanyRows(state: string, raw: readonly Record<string, string>[], fetchedAt: string, source?: LicenseSource): { rows: LicenseRow[]; dropped: DropCounts } {
  const src = source ?? licenseSourceForState(state);
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
  status: 'disabled' | 'unknown_state' | 'not_promoted' | 'fetch_failed' | 'table_missing' | 'no_progress' | 'ok';
  httpStatus?: number | null;
  read?: number;
  kept?: number;
  dropped?: DropCounts;
  written?: number;
  failed?: number;
  done?: boolean;
  /** The next call's offset: only rows actually filtered and written are counted. */
  nextOffset?: number;
  error?: FetchErrorCode;
}

/**
 * One state's licence file into holler_contractor_licenses. Runs only when `enabled` (HOLLER_LICENSE_SYNC_ENABLED) AND the state's
 * source is promoted (review LIC P2-4: probation and schemaUnverified removed, a headerless layout confirmed). Reads at most 20,000 rows
 * from `offset` with a 25 s read limit, then filters and upserts in chunks of 2,000 while the 45 s run limit allows; `nextOffset` covers
 * only the rows written. A call that makes no progress says so (`no_progress`) instead of returning the same offset forever. A
 * person-licensee row is never sent to the database.
 */
export async function runLicenseSync(opts: {
  db: Db;
  state: string;
  fetch: typeof fetch;
  enabled: boolean;
  now?: Date;
  offset?: number;
  maxRows?: number;
  /** Whole-run deadline (ms since epoch); default now + 45 s. */
  deadline?: number;
  socrataToken?: string;
  /** Tests only: a source to use instead of the registry's. */
  source?: LicenseSource;
}): Promise<LicenseSyncResult> {
  const state = opts.state.trim().toUpperCase();
  if (!opts.enabled) return { state, source: null, status: 'disabled' };
  const src = opts.source ?? licenseSourceForState(state);
  if (!src) return { state, source: null, status: 'unknown_state' };
  if (!isPromoted(src)) return { state, source: src.id, status: 'not_promoted' };
  const started = Date.now();
  const runDeadline = opts.deadline ?? started + SYNC_RUN_MS;
  const offset = Math.max(0, Math.floor(Number.isFinite(opts.offset) ? (opts.offset as number) : 0));
  const got = await fetchLicenseRows(src, opts.fetch, {
    maxRows: Math.min(opts.maxRows ?? SYNC_MAX_ROWS, SYNC_MAX_ROWS),
    offset,
    deadline: Math.min(runDeadline, started + SYNC_READ_MS),
    socrataToken: opts.socrataToken,
  });
  if (got.error && !got.rows.length) return { state, source: src.id, status: 'fetch_failed', httpStatus: got.httpStatus, error: got.error };
  const fetchedAt = (opts.now ?? new Date()).toISOString();
  const dropped = noDrops();
  let processed = 0;
  let kept = 0;
  let written = 0;
  let failed = 0;
  for (let i = 0; i < got.rows.length; i += CHUNK) {
    if (Date.now() > runDeadline) break;
    const part = got.rows.slice(i, i + CHUNK);
    const f = filterCompanyRows(state, part, fetchedAt, src);
    for (const k of Object.keys(dropped) as DropReason[]) dropped[k] += f.dropped[k];
    const w = await upsertLicenseRows(opts.db, f.rows);
    if (w === 'missing') return { state, source: src.id, status: 'table_missing', httpStatus: got.httpStatus, read: got.rows.length, kept: kept + f.rows.length, dropped };
    kept += f.rows.length;
    written += w.written;
    failed += w.failed;
    processed += part.length;
  }
  const done = got.done && processed === got.rows.length;
  if (processed === 0 && !done) {
    return { state, source: src.id, status: 'no_progress', httpStatus: got.httpStatus, read: got.rows.length, done: false, nextOffset: offset, ...(got.error ? { error: got.error } : {}) };
  }
  return { state, source: src.id, status: 'ok', httpStatus: got.httpStatus, read: got.rows.length, kept, dropped, written, failed, done, nextOffset: offset + processed };
}

export interface HeaderlessShape {
  /** Number of cells in the widest row. */
  columnCount: number;
  /** Per position: the share (0 to 1) of the sample's cells that are filled, hold only digits, look like a date, match the state's
   *  licence-number pattern, and match the company-type allow-list. Shares only, never a value. */
  positions: { index: number; filled: number; digitsOnly: number; dateLike: number; numberPattern: number; companyType: number }[];
  layout: string;
}

export interface LicenseProbeResult {
  state: string;
  status: 'unknown_state' | 'unreachable' | 'ok';
  source?: string;
  fileUrl?: string;
  /** Whether the sync would load this state today (promoted and switch aside). */
  promoted?: boolean;
  httpStatus?: number | null;
  /** Header names, only when the first line reads like a header and at least half the expected names are there (review LIC P2-5). */
  columns?: string[];
  columnCount?: number;
  missingExpected?: string[];
  schema?: 'ok' | 'mismatch' | 'schema unverified: no header';
  note?: string;
  /** Rows read in the sample (at most PROBE_ROWS). */
  rowCount?: number;
  /** How many of them would be stored as companies. */
  keptAsCompanies?: number;
  dropped?: DropCounts;
  /** How many kept rows carry a business phone. */
  keptWithPhone?: number;
  /** Share of the sample's licence numbers that match the state's pattern. */
  numberPatternShare?: number;
  /** Distinct values of the type column (category labels seen on 3+ rows; at most 20, short label shapes, never a full person name). */
  typeValues?: string[];
  /** Headerless files: the shape report, shares only. */
  shape?: HeaderlessShape;
  error?: FetchErrorCode;
  knownStates?: string[];
}

const HEADER_NAME = /^[A-Za-z][A-Za-z0-9 _()#/.-]{0,39}$/;
const TYPE_LABEL = /^(?!.*\d{3})[A-Za-z0-9][A-Za-z0-9 _/&().-]{0,39}$/;

function share(n: number, d: number): number {
  return d ? Math.round((n / d) * 1000) / 1000 : 0;
}

/**
 * The owner's schema check for one state's licence file: a sample of PROBE_ROWS rows, counts and shares only, nothing written, never a
 * data row (review LIC P2-5): header names are returned only when the first line reads like a header; a headerless file gets a shape
 * report of shares per position and the schema "schema unverified: no header" until its layout is confirmed in code.
 */
export async function runLicenseProbe(stateRaw: string, f: typeof fetch, socrataToken?: string): Promise<LicenseProbeResult> {
  const state = stateRaw.trim().toUpperCase();
  const src = licenseSourceForState(state);
  if (!src) return { state, status: 'unknown_state', knownStates: LICENSE_SOURCES.map((s) => s.state) };
  // Round 21 final review P1-1: an unpromoted licence source is on probation; the one off switch stops its probe request too.
  if (!isPromoted(src) && !probationFetchOn()) return { state, source: src.id, fileUrl: src.fileUrl, promoted: false, httpStatus: null, status: 'unreachable', note: `${PROBATION_FETCH_FLAG} is off: no request sent` };
  // The probe keeps every column of the sample in memory (to judge the header); nothing of it is returned except names that pass.
  const got = await fetchLicenseRows(src, f, { maxRows: PROBE_ROWS, timeoutMs: 15_000, deadline: Date.now() + 40_000, socrataToken, keep: null });
  const base = { state, source: src.id, fileUrl: src.fileUrl, promoted: isPromoted(src), httpStatus: got.httpStatus };
  if (got.error && !got.rows.length) return { ...base, status: 'unreachable', error: got.error, note: src.note };
  const { rows, dropped } = filterCompanyRows(state, got.rows, new Date().toISOString(), src);
  const counts = {
    rowCount: got.rows.length,
    keptAsCompanies: rows.length,
    dropped,
    keptWithPhone: rows.filter((r) => r.business_phone).length,
    numberPatternShare: share(got.rows.filter((r) => { const k = licenseKey(r[src.columns.number] ?? ''); return Boolean(k && src.numberPattern.test(k)); }).length, got.rows.length),
  };
  if (src.headerless) {
    const width = got.maxCells;
    const positions = Array.from({ length: width }, (_, i) => {
      const cells = got.rows.map((r) => (r[String(i)] ?? '').trim());
      const filled = cells.filter(Boolean);
      return {
        index: i,
        filled: share(filled.length, cells.length),
        digitsOnly: share(filled.filter((v) => /^\d+$/.test(v)).length, cells.length),
        dateLike: share(filled.filter((v) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{4}-\d{2}-\d{2}/.test(v)).length, cells.length),
        numberPattern: share(filled.filter((v) => { const k = licenseKey(v); return Boolean(k && src.numberPattern.test(k)); }).length, cells.length),
        companyType: share(filled.filter((v) => Boolean(src.companyType?.test(v))).length, cells.length),
      };
    });
    return {
      ...base,
      status: 'ok',
      schema: src.headerless.confirmed ? (counts.numberPatternShare >= 0.9 ? 'ok' : 'mismatch') : 'schema unverified: no header',
      columnCount: width,
      shape: { columnCount: width, positions, layout: src.headerless.description },
      note: 'No header line: values are never returned. Confirm the layout from the shares per position before the source is promoted.',
      ...counts,
    };
  }
  const expected = expectedColumns(src);
  const looksLikeHeader = got.columns.length > 0 && got.columns.every((c) => !c || (HEADER_NAME.test(c) && !/^\d+$/.test(c)));
  const present = new Set(looksLikeHeader ? got.columns : []);
  const missingExpected = expected.filter((c) => !present.has(c));
  if (!looksLikeHeader || missingExpected.length > expected.length / 2) {
    return {
      ...base,
      status: 'ok',
      schema: 'mismatch',
      columnCount: got.columns.length,
      missingExpected,
      note: looksLikeHeader ? 'fewer than half of the expected columns are present; names are not returned' : 'first line does not look like a header; names are not returned',
      ...counts,
    };
  }
  const typeCol = src.columns.entityType;
  // A category repeats across rows; a person's name in a misread column rarely does. Only labels seen on 3 or more rows, in a short label
  // shape (no digit run), holding no listed given name or initial, are listed.
  let typeValues: string[] | undefined;
  if (typeCol) {
    const seen = new Map<string, number>();
    for (const r of got.rows) {
      const v = (r[typeCol] ?? '').trim();
      if (v) seen.set(v, (seen.get(v) ?? 0) + 1);
    }
    typeValues = [...seen].filter(([v, n]) => n >= 3 && TYPE_LABEL.test(v) && !looksLikeFullPersonName(v)).map(([v]) => v).slice(0, 20);
  }
  return {
    ...base,
    status: 'ok',
    schema: missingExpected.length ? 'mismatch' : 'ok',
    columns: got.columns.filter(Boolean).slice(0, 80),
    columnCount: got.columns.length,
    missingExpected,
    note: src.note,
    ...(typeValues ? { typeValues } : {}),
    ...counts,
  };
}
