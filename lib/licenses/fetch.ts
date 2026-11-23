import type { LicenseSource } from './sources';

/** One raw row of a licence file: column name (or position, for a headerless CSV) to text. Never stored or logged as is. */
export type RawLicenseRow = Record<string, string>;

export interface FetchLicenseOptions {
  /** Stop after this many data rows (after `offset`). */
  maxRows: number;
  /** Skip this many data rows first (a later call continues where the last one stopped). */
  offset?: number;
  /** Stop reading when this time (ms since epoch) is passed. */
  deadline?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  socrataToken?: string;
}

export interface FetchLicenseResult {
  httpStatus: number | null;
  columns: string[];
  rows: RawLicenseRow[];
  /** True when the file (or the Socrata query) had no more rows. */
  done: boolean;
  error?: string;
}

const SOCRATA_PAGE = 5000;

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

async function withTimeout(f: typeof fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await f(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchSocrata(src: LicenseSource, f: typeof fetch, o: FetchLicenseOptions): Promise<FetchLicenseResult> {
  const rows: RawLicenseRow[] = [];
  const cols = new Set<string>();
  let offset = o.offset ?? 0;
  let status: number | null = null;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (o.socrataToken) headers['X-App-Token'] = o.socrataToken;
  while (rows.length < o.maxRows) {
    if (o.deadline && Date.now() > o.deadline) return { httpStatus: status, columns: [...cols], rows, done: false };
    const limit = Math.min(SOCRATA_PAGE, o.maxRows - rows.length);
    const u = new URL(src.fileUrl);
    if (src.where) u.searchParams.set('$where', src.where);
    u.searchParams.set('$order', ':id');
    u.searchParams.set('$limit', String(limit));
    u.searchParams.set('$offset', String(offset));
    const res = await withTimeout(f, u.toString(), { headers }, o.timeoutMs ?? 20_000);
    status = res.status;
    if (!res.ok) return { httpStatus: status, columns: [...cols], rows, done: false, error: `http_${res.status}` };
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return { httpStatus: status, columns: [...cols], rows, done: false, error: 'not_json_array' };
    for (const r of body) {
      if (!r || typeof r !== 'object') continue;
      const row: RawLicenseRow = {};
      for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
        cols.add(k);
        if (typeof v === 'string' || typeof v === 'number') row[k] = String(v);
      }
      rows.push(row);
    }
    offset += body.length;
    if (body.length < limit) return { httpStatus: status, columns: [...cols], rows, done: true };
  }
  return { httpStatus: status, columns: [...cols], rows, done: false };
}

async function fetchCsv(src: LicenseSource, f: typeof fetch, o: FetchLicenseOptions): Promise<FetchLicenseResult> {
  const res = await withTimeout(f, src.fileUrl, { headers: { Accept: 'text/csv, text/plain, */*' } }, o.timeoutMs ?? 30_000);
  if (!res.ok || !res.body) return { httpStatus: res.status, columns: [], rows: [], done: false, error: `http_${res.status}` };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let header: string[] | null = null;
  let skip = o.offset ?? 0;
  const rows: RawLicenseRow[] = [];
  let width = 0;
  let done = false;
  const take = (line: string): boolean => {
    if (!line.trim()) return true;
    const cells = splitCsvLine(line.replace(/\r$/, ''));
    if (!src.headerless && !header) {
      header = cells.map((c) => c.replace(/^﻿/, ''));
      if (header.some((h) => /^<!doctype|^<html/i.test(h))) return false; // an HTML page, not a CSV
      return true;
    }
    width = Math.max(width, cells.length);
    if (skip > 0) {
      skip--;
      return true;
    }
    const row: RawLicenseRow = {};
    cells.forEach((v, i) => {
      row[header ? (header[i] ?? String(i)) : String(i)] = v;
    });
    rows.push(row);
    return rows.length < o.maxRows;
  };
  try {
    for (;;) {
      if (o.deadline && Date.now() > o.deadline) break;
      const { value, done: end } = await reader.read();
      if (end) {
        if (buf) take(buf);
        done = true;
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
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const h = header as string[] | null;
  const columns = h ?? Array.from({ length: width }, (_, i) => String(i));
  if (!src.headerless && h && h.some((x) => /^<!doctype|^<html/i.test(x))) return { httpStatus: res.status, columns: [], rows: [], done: false, error: 'not_csv' };
  return { httpStatus: res.status, columns, rows, done };
}

/** Read up to `maxRows` rows of a licence file. Never throws: a network or parse failure is returned as `error`. */
export async function fetchLicenseRows(src: LicenseSource, f: typeof fetch, o: FetchLicenseOptions): Promise<FetchLicenseResult> {
  try {
    return src.format === 'socrata' ? await fetchSocrata(src, f, o) : await fetchCsv(src, f, o);
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timeout' : e.message.slice(0, 120)) : 'fetch_failed';
    return { httpStatus: null, columns: [], rows: [], done: false, error: msg };
  }
}
