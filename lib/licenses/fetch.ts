import { HOLLER_UA } from '@/lib/user-agent';
import { expectedColumns, type LicenseSource } from './sources';

/** One raw row of a licence file: column name (or position, for a headerless CSV) to text. Never stored or logged as is. */
export type RawLicenseRow = Record<string, string>;

export interface FetchLicenseOptions {
  /** Stop after this many data rows (after `offset`). */
  maxRows: number;
  /** Skip this many data rows first (a later call continues where the last one stopped). */
  offset?: number;
  /** Stop reading when this time (ms since epoch) is passed. Covers the headers AND the body (review LIC P3-7). */
  deadline?: number;
  /** Per-request timeout, for the headers and the whole body. */
  timeoutMs?: number;
  socrataToken?: string;
  /** Keep only these columns of each row (default: the source's expected columns; a headerless file keeps every position). */
  keep?: ReadonlySet<string> | null;
}

/** Fixed error codes only (review LIC P3-11): never a message that could echo the file's bytes or a library's text. */
export type FetchErrorCode = 'timeout' | 'not_json' | 'not_csv' | 'fetch_failed' | `http_${number}`;

export interface FetchLicenseResult {
  httpStatus: number | null;
  /** Header names as read (a headed CSV, Socrata keys) or positions (headerless). Checked by the probe before it shows any. */
  columns: string[];
  /** Data rows read; for a headerless file also the widest row's cell count. */
  rows: RawLicenseRow[];
  maxCells: number;
  /** True when the file (or the Socrata query) had no more rows. */
  done: boolean;
  /** Data rows passed over because of `offset` (the skip itself counts as progress only when it ends). */
  skipped: number;
  error?: FetchErrorCode;
}

const SOCRATA_PAGE = 5000;
/** A CSV line longer than this with no line break is not a CSV (review LIC P3-12). */
export const MAX_LINE_CHARS = 1_000_000;

/** RFC 4180 style split of one CSV line (quotes, doubled quotes). A quoted field spanning lines is not supported (the line is cut). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function keepSet(src: LicenseSource, o: FetchLicenseOptions): ReadonlySet<string> | null {
  if (o.keep !== undefined) return o.keep;
  return src.headerless ? null : new Set(expectedColumns(src));
}

function timeLeft(o: FetchLicenseOptions, perRequest: number): number {
  const until = o.deadline ? o.deadline - Date.now() : perRequest;
  return Math.max(1, Math.min(perRequest, until));
}

async function fetchSocrata(src: LicenseSource, f: typeof fetch, o: FetchLicenseOptions): Promise<FetchLicenseResult> {
  const rows: RawLicenseRow[] = [];
  const cols = new Set<string>();
  const keep = keepSet(src, o);
  const start = o.offset ?? 0;
  let offset = start;
  let status: number | null = null;
  // Round 21: the one Holler user agent (lib/user-agent.ts, round 20 WATCH) on every outbound request.
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': HOLLER_UA };
  if (o.socrataToken) headers['X-App-Token'] = o.socrataToken;
  const base = (): FetchLicenseResult => ({ httpStatus: status, columns: [...cols], rows, maxCells: 0, done: false, skipped: 0 });
  while (rows.length < o.maxRows) {
    if (o.deadline && Date.now() > o.deadline) return base();
    const limit = Math.min(SOCRATA_PAGE, o.maxRows - rows.length);
    const u = new URL(src.fileUrl);
    if (src.where) u.searchParams.set('$where', src.where);
    // Review LIC P3-13: only the expected columns are downloaded (no owner name, mailing address or owner phone).
    u.searchParams.set('$select', expectedColumns(src).join(','));
    u.searchParams.set('$order', ':id');
    u.searchParams.set('$limit', String(limit));
    u.searchParams.set('$offset', String(offset));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeLeft(o, o.timeoutMs ?? 20_000));
    let body: unknown;
    try {
      const res = await f(u.toString(), { headers, signal: ctl.signal });
      status = res.status;
      if (!res.ok) return { ...base(), error: `http_${res.status}` };
      try {
        body = await res.json();
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw e;
        return { ...base(), error: 'not_json' };
      }
    } finally {
      clearTimeout(timer);
    }
    if (!Array.isArray(body)) return { ...base(), error: 'not_json' };
    for (const r of body) {
      if (!r || typeof r !== 'object') continue;
      const row: RawLicenseRow = {};
      for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
        cols.add(k);
        if (keep && !keep.has(k)) continue;
        if (typeof v === 'string' || typeof v === 'number') row[k] = String(v);
      }
      rows.push(row);
    }
    offset += body.length;
    if (body.length < limit) return { ...base(), done: true };
  }
  return base();
}

async function fetchCsv(src: LicenseSource, f: typeof fetch, o: FetchLicenseOptions): Promise<FetchLicenseResult> {
  const ctl = new AbortController();
  // The timer stays armed until the whole body is read (review LIC P3-7: a body that stalls after the headers is cut off too).
  const timer = setTimeout(() => ctl.abort(), timeLeft(o, o.timeoutMs ?? 30_000));
  const keep = keepSet(src, o);
  let status: number | null = null;
  let header: string[] | null = null;
  let skip = o.offset ?? 0;
  let skipped = 0;
  const rows: RawLicenseRow[] = [];
  let maxCells = 0;
  let done = false;
  let error: FetchErrorCode | undefined;
  try {
    const res = await f(src.fileUrl, { headers: { Accept: 'text/csv, text/plain, */*', 'User-Agent': HOLLER_UA }, signal: ctl.signal });
    status = res.status;
    if (!res.ok || !res.body) return { httpStatus: status, columns: [], rows: [], maxCells: 0, done: false, skipped: 0, error: `http_${res.status}` };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const take = (line: string): boolean => {
      if (!line.trim()) return true;
      const cells = splitCsvLine(line.replace(/\r$/, ''));
      if (!src.headerless && !header) {
        header = cells.map((c) => c.replace(/^﻿/, ''));
        if (header.some((h) => /^<!doctype|^<html|^<\?xml/i.test(h))) {
          error = 'not_csv';
          return false;
        }
        return true;
      }
      if (src.headerless && cells.some((c) => /^<!doctype|^<html|^<\?xml/i.test(c))) {
        error = 'not_csv';
        return false;
      }
      maxCells = Math.max(maxCells, cells.length);
      if (skip > 0) {
        skip--;
        skipped++;
        return true;
      }
      const row: RawLicenseRow = {};
      cells.forEach((v, i) => {
        const name = header ? (header[i] ?? String(i)) : String(i);
        if (!keep || keep.has(name)) row[name] = v;
      });
      rows.push(row);
      return rows.length < o.maxRows;
    };
    try {
      for (;;) {
        if (o.deadline && Date.now() > o.deadline) break;
        const { value, done: end } = await reader.read();
        if (end) {
          if (buf && !error) take(buf);
          done = !error;
          break;
        }
        buf += dec.decode(value, { stream: true });
        let nl: number;
        let more = true;
        while (more && (nl = buf.indexOf('\n')) >= 0) {
          more = take(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
        if (!more) break;
        if (buf.length > MAX_LINE_CHARS) {
          error = 'not_csv';
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } catch (e) {
    error = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'fetch_failed';
  } finally {
    clearTimeout(timer);
  }
  const h = header as string[] | null;
  if (error === 'not_csv') return { httpStatus: status, columns: [], rows: [], maxCells: 0, done: false, skipped, error };
  const columns = h ?? Array.from({ length: maxCells }, (_, i) => String(i));
  return { httpStatus: status, columns, rows, maxCells, done, skipped, ...(error ? { error } : {}) };
}

/** Read up to `maxRows` rows of a licence file. Never throws: a failure is returned as a fixed `error` code. */
export async function fetchLicenseRows(src: LicenseSource, f: typeof fetch, o: FetchLicenseOptions): Promise<FetchLicenseResult> {
  try {
    return src.format === 'socrata' ? await fetchSocrata(src, f, o) : await fetchCsv(src, f, o);
  } catch (e) {
    const error: FetchErrorCode = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'fetch_failed';
    return { httpStatus: null, columns: [], rows: [], maxCells: 0, done: false, skipped: 0, error };
  }
}
