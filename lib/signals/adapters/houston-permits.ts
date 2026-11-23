import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { PROBATION_NOTE_PREFIX } from '@/lib/signals/probation-note';
import { UNVERIFIED_REQUEST_TIMEOUT_MS } from '@/lib/signals/schema-check';
import { parseSocrataReport } from './socrata';
import { checkRobots } from '@/lib/firecrawl/robots';
import {
  HOUSTON_ACCESS,
  HOUSTON_HEADER_ALIASES,
  HOUSTON_HEADERS,
  HOUSTON_PERMITS_DS,
  HOUSTON_PERMITS_ID,
  HOUSTON_REPORT_URL,
  HOUSTON_REQUIRED,
  HOUSTON_ROW_CAP,
  HOUSTON_USER_AGENT,
  MAX_BODY_CHARS,
  houstonAccessCleared,
} from './houston-permits-config';

export { HOUSTON_ACCESS, HOUSTON_HEADERS, HOUSTON_PERMITS_DS, HOUSTON_PERMITS_ID, HOUSTON_REPORT_URL, HOUSTON_REQUIRED, HOUSTON_ROW_CAP, HOUSTON_USER_AGENT, houstonAccessCleared };

/**
 * ROUND 20 NEXT: the City of Houston weekly "Permit Activity Report", HTML table version (Houston has no permit feed with an address
 * otherwise). ON PROBATION: rows go to holler_source_samples only (Adapter.probation), never to a member, until the owner has read real
 * samples (GET /api/admin/coverage-probe?source=html-houston-permits) and promoted it (LAUNCH.md, "Round 20 next sources").
 *
 * Research (/home/claude/gates/r20/SCOUT-research.md, Houston): the page WebeReport.html [O] holds one table with the columns Zip Code, Permit
 * Date, Permit Type, Project No, Address, Comments, about 470 rows a week, NO person name column; on 2026-11-22 it showed 2026-10-26 to
 * 11-02 (about a week of lag; the Excel archive on houstonpermittingcenter.org runs to Nov 9). The page URL is [O]; that it stays at this URL
 * and keeps these headers is [A].
 *
 * The reader (readPermitTable) has no dependency: it finds the table whose header row names the columns above (matched by header TEXT, never
 * by position), reads each data row's cells with tags removed and the common entities decoded, and returns plain row objects. The rows then go
 * through the shared Socrata parser (parseSocrataReport) with the config below, so classification, titles (fixed permit labels), the address
 * rule (strictAddress: lib/contacts cleanAddress), the ZIP-centroid placement and the age limit are the same reviewed code as every permit
 * feed. Comments are classified but NEVER printed (free text: a name could be typed there). Nothing else of the page is read.
 *
 * Review fixes: P1-3, no request at all (page, robots.txt, probe) until the owner records the access check (houston-permits-config.ts
 * HOUSTON_ACCESS), then the shared robots checker must allow the page (it fails closed when robots.txt cannot be read), and every request
 * names localholler.com. P2-5, the reader finds the header row anywhere in the page (a title row above it, a layout table around it), reads
 * every table whose header matches, maps a short list of header spellings, and keeps a ZIP only when it is five digits.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Cell text: tags removed, entities decoded (named above, decimal and hex), spaces folded. */
export function cellText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, ' ')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6}|#39);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (ENTITIES[k] !== undefined) return ENTITIES[k];
      const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : k.startsWith('#') ? parseInt(k.slice(1), 10) : NaN;
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface TableRead {
  rows: Record<string, string>[];
  /** Header keys found (HOUSTON_HEADERS keys). */
  headers: string[];
  /** Why no row could be read, or null. */
  problem: string | null;
  /** Data rows seen under a matching header (before the cap). */
  seen: number;
  /** Header rows that matched (one per report table, or per repeated header). */
  tables: number;
}

/** A project number that may be an external id: letters, digits and "-", 3 to 30 characters. Anything else drops the row. */
const PROJECT_RE = /^[A-Za-z0-9-]{3,30}$/;

/** The cells of one row: a <td> or <th> start tag (attributes may hold ">" inside quotes) up to the next cell or the end of the row. */
function cellsOf(tr: string): string[] {
  return [...tr.matchAll(/<t([hd])\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)(?=<t[hd]\b|<\/tr\s*>|$)/gi)].map((m) => cellText((m[2] ?? '').replace(/<\/t[hd]\s*>\s*$/i, '')));
}

/** The header mapping of a row (key -> cell index) when every required header is there, else null. */
function headerIndex(cells: readonly string[]): Record<string, number> | null {
  const normed = cells.map(norm);
  const index: Record<string, number> = {};
  for (const key of Object.keys(HOUSTON_HEADERS)) {
    const names = [HOUSTON_HEADERS[key], ...(HOUSTON_HEADER_ALIASES[key] ?? [])].map(norm);
    const i = normed.findIndex((h, j) => names.includes(h) && !Object.values(index).includes(j));
    if (i >= 0) index[key] = i;
  }
  return HOUSTON_REQUIRED.every((k) => k in index) ? index : null;
}

/**
 * Reads the report out of the page. The page is walked as a sequence of rows and table ends: a row that names every required header starts
 * (or restarts) a report table, its columns mapped by header text; rows before any header (a title, a layout table) are skipped; the report
 * table's end stops it. Every matching table is read. Pure; never throws.
 */
export function readPermitTable(html: unknown, cap = HOUSTON_ROW_CAP): TableRead {
  const out: TableRead = { rows: [], headers: [], problem: null, seen: 0, tables: 0 };
  if (typeof html !== 'string' || !html.trim()) return { ...out, problem: 'empty response body' };
  const page = html.length > MAX_BODY_CHARS ? html.slice(0, MAX_BODY_CHARS) : html;
  const marks = [...page.matchAll(/<tr\b|<\/table\s*>/gi)].map((m) => ({ at: m.index ?? 0, end: /^<\//.test(m[0]) }));
  const found = new Set<string>();
  let index: Record<string, number> | null = null;
  for (let k = 0; k < marks.length; k++) {
    const m = marks[k];
    if (m.end) {
      index = null;
      continue;
    }
    const chunk = page.slice(m.at, k + 1 < marks.length ? marks[k + 1].at : page.length);
    const cells = cellsOf(chunk);
    if (!cells.length) continue;
    const h = headerIndex(cells);
    if (h) {
      index = h;
      out.tables += 1;
      Object.keys(h).forEach((x) => found.add(x));
      continue;
    }
    if (!index || cells.every((c) => !c)) continue;
    out.seen += 1;
    if (out.rows.length >= cap) continue;
    const row: Record<string, string> = {};
    for (const [key, i] of Object.entries(index)) row[key] = cells[i] ?? '';
    if (!PROJECT_RE.test(row.project_no ?? '')) continue;
    // A ZIP is five digits or nothing (a stray attribute or a ZIP+4 never becomes a ZIP).
    if (row.zip_code !== undefined && !/^\d{5}$/.test(row.zip_code)) row.zip_code = '';
    out.rows.push(row);
  }
  out.headers = [...found];
  if (!out.tables) return { ...out, problem: `schema mismatch: expected a table with the headers ${HOUSTON_REQUIRED.map((k) => HOUSTON_HEADERS[k]).join(', ')}` };
  return out;
}

/** The report rows as records: the shared parser, then the report's own link and data (never the Socrata ones). */
export function parseHoustonPermits(rows: readonly Record<string, string>[], now?: Date): { items: SignalInput[]; shapeOk: number; tooOld: number } {
  const report = parseSocrataReport(rows as unknown[], HOUSTON_PERMITS_DS, now ? { now } : {});
  const items = report.items.map((it) => ({
    ...it,
    url: HOUSTON_REPORT_URL,
    data: { ...(it.data ?? {}), dataset: 'permit-activity-report', domain: 'www.houstontx.gov' },
  }));
  return { items, shapeOk: report.shapeOk, tooOld: report.tooOld ?? 0 };
}

/**
 * Review fix P1-3: may the page be requested now? Without the owner's access record nothing is requested (not even robots.txt); with it,
 * the shared robots checker must allow the page path (robots.txt unreachable or a 5xx: refused).
 */
export async function houstonAccess(doFetch: typeof fetch, now: Date, access: typeof HOUSTON_ACCESS = HOUSTON_ACCESS): Promise<{ ok: true } | { ok: false; reason: string; error: boolean }> {
  if (!houstonAccessCleared(access)) {
    return { ok: false, error: false, reason: 'terms not recorded: the owner records robotsUrl, termsUrl and checkedOn and sets termsChecked (houston-permits-config.ts HOUSTON_ACCESS); no request sent' };
  }
  const robots = await checkRobots(HOUSTON_REPORT_URL, doFetch, now.getTime());
  if (!robots.allowed) return { ok: false, error: true, reason: `robots_${robots.reason}: no request sent for the page` };
  return { ok: true };
}

/** The response body as text, read only up to `max` characters (the rest is never downloaded). */
export async function readBoundedText(res: Response, max = MAX_BODY_CHARS): Promise<string> {
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, max);
  const dec = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    if (text.length >= max) {
      await reader.cancel().catch(() => undefined);
      return text.slice(0, max);
    }
  }
  return text + dec.decode();
}

export function buildHoustonPermitsAdapter(access: typeof HOUSTON_ACCESS = HOUSTON_ACCESS): Adapter {
  return {
    id: HOUSTON_PERMITS_ID,
    label: 'City of Houston: weekly permit activity report',
    kind: 'permit',
    cadenceMinutes: HOUSTON_PERMITS_DS.cadenceMinutes,
    probation: true,
    sourceUrl: HOUSTON_REPORT_URL,
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        const now = ctx.now ?? new Date();
        const gate = await houstonAccess(ctx.fetch, now, access);
        if (!gate.ok) {
          ctx.log(gate.error ? `error: ${HOUSTON_PERMITS_ID}: ${gate.reason}` : `${PROBATION_NOTE_PREFIX} ${HOUSTON_PERMITS_ID}: ${gate.reason}`);
          return [];
        }
        const res = await ctx.fetch(HOUSTON_REPORT_URL, {
          headers: { Accept: 'text/html', 'User-Agent': HOUSTON_USER_AGENT },
          signal: AbortSignal.timeout(UNVERIFIED_REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          ctx.log(`error: ${HOUSTON_PERMITS_ID}: HTTP ${res.status}`);
          return [];
        }
        const table = readPermitTable(await readBoundedText(res));
        if (table.problem) {
          ctx.log(`error: ${table.problem} (${HOUSTON_PERMITS_ID})`);
          return [];
        }
        if (table.tables > 1) ctx.log(`${PROBATION_NOTE_PREFIX} ${table.tables} report tables read on the page`);
        if (table.seen > HOUSTON_ROW_CAP) ctx.log(`${PROBATION_NOTE_PREFIX} row cap reached: ${HOUSTON_ROW_CAP} of ${table.seen} rows read`);
        const parsed = parseHoustonPermits(table.rows, now);
        if (table.rows.length > 0 && parsed.items.length === 0) {
          if (parsed.shapeOk === 0) ctx.log(`error: schema mismatch: no row had a project number, a readable permit date and a type (${HOUSTON_PERMITS_ID})`);
          else if (parsed.tooOld === parsed.shapeOk) ctx.log(`error: ${HOUSTON_PERMITS_ID}: no rows in the last ${HOUSTON_PERMITS_DS.maxRecordAgeDays} days (${table.rows.length} rows read)`);
          else ctx.log(`${HOUSTON_PERMITS_ID}: ${table.rows.length} rows, 0 matched a trade`);
        }
        return parsed.items;
      } catch (e) {
        ctx.log(`error: ${HOUSTON_PERMITS_ID}: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      }
    },
  };
}

export const adapters: Adapter[] = [buildHoustonPermitsAdapter()];
