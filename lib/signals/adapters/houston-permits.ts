import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { PROBATION_NOTE_PREFIX } from '@/lib/signals/probation-note';
import { UNVERIFIED_REQUEST_TIMEOUT_MS } from '@/lib/signals/schema-check';
import { parseSocrataReport } from './socrata';
import { HOUSTON_HEADERS, HOUSTON_PERMITS_DS, HOUSTON_PERMITS_ID, HOUSTON_REPORT_URL, HOUSTON_REQUIRED, HOUSTON_ROW_CAP, MAX_BODY_CHARS } from './houston-permits-config';

export { HOUSTON_HEADERS, HOUSTON_PERMITS_DS, HOUSTON_PERMITS_ID, HOUSTON_REPORT_URL, HOUSTON_REQUIRED, HOUSTON_ROW_CAP };

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
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Cell text: tags removed, entities decoded (named above, decimal and hex), spaces folded. */
export function cellText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
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
  /** Data rows seen in the table (before the cap). */
  seen: number;
}

/** A project number that may be an external id: letters, digits and "-", 3 to 30 characters. Anything else drops the row. */
const PROJECT_RE = /^[A-Za-z0-9-]{3,30}$/;

/**
 * Reads the report table out of the page. The first <table> whose header row (th cells, or the first row's td cells) names every required
 * header is used; its columns are mapped by header text. Pure; never throws.
 */
export function readPermitTable(html: unknown, cap = HOUSTON_ROW_CAP): TableRead {
  const out: TableRead = { rows: [], headers: [], problem: null, seen: 0 };
  if (typeof html !== 'string' || !html.trim()) return { ...out, problem: 'empty response body' };
  const page = html.length > MAX_BODY_CHARS ? html.slice(0, MAX_BODY_CHARS) : html;
  const tables = page.match(/<table\b[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const trs = table.match(/<tr\b[\s\S]*?(?=<tr\b|<\/table>)/gi) ?? [];
    if (!trs.length) continue;
    const cellsOf = (tr: string) => [...tr.matchAll(/<t([hd])\b[^>]*>([\s\S]*?)(?=<t[hd]\b|<\/tr>|$)/gi)].map((m) => cellText((m[2] ?? '').replace(/<\/t[hd]>\s*$/i, '')));
    const headerCells = cellsOf(trs[0] ?? '').map(norm);
    const index: Record<string, number> = {};
    for (const [key, label] of Object.entries(HOUSTON_HEADERS)) {
      const i = headerCells.findIndex((h) => h === label || h === `${label}.` || h.replace(/\s/g, '') === label.replace(/\s/g, ''));
      if (i >= 0) index[key] = i;
    }
    if (!HOUSTON_REQUIRED.every((k) => k in index)) continue;
    out.headers = Object.keys(index);
    for (const tr of trs.slice(1)) {
      const cells = cellsOf(tr);
      if (!cells.length || cells.every((c) => !c)) continue;
      out.seen += 1;
      if (out.rows.length >= cap) continue;
      const row: Record<string, string> = {};
      for (const [key, i] of Object.entries(index)) row[key] = cells[i] ?? '';
      if (!PROJECT_RE.test(row.project_no ?? '')) continue;
      out.rows.push(row);
    }
    return out;
  }
  return { ...out, problem: `schema mismatch: expected a table with the headers ${HOUSTON_REQUIRED.map((k) => HOUSTON_HEADERS[k]).join(', ')}` };
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

export function buildHoustonPermitsAdapter(): Adapter {
  return {
    id: HOUSTON_PERMITS_ID,
    label: 'City of Houston: weekly permit activity report',
    kind: 'permit',
    cadenceMinutes: HOUSTON_PERMITS_DS.cadenceMinutes,
    probation: true,
    sourceUrl: HOUSTON_REPORT_URL,
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        const res = await ctx.fetch(HOUSTON_REPORT_URL, {
          headers: { Accept: 'text/html', 'User-Agent': 'Holler/1.0 (+https://holler.app/about; contact@holler)' },
          signal: AbortSignal.timeout(UNVERIFIED_REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          ctx.log(`error: ${HOUSTON_PERMITS_ID}: HTTP ${res.status}`);
          return [];
        }
        const table = readPermitTable(await res.text());
        if (table.problem) {
          ctx.log(`error: ${table.problem} (${HOUSTON_PERMITS_ID})`);
          return [];
        }
        if (table.seen > HOUSTON_ROW_CAP) ctx.log(`${PROBATION_NOTE_PREFIX} row cap reached: ${HOUSTON_ROW_CAP} of ${table.seen} rows read`);
        const parsed = parseHoustonPermits(table.rows, ctx.now ?? new Date());
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
