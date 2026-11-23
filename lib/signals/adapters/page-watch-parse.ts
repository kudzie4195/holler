import { DEFAULT_COLUMNS, type ColumnHints, type PageWatchDataset } from './page-watch-datasets';

/**
 * Round 20 WATCH: the per-platform row parsers of the page-watch adapter, and the small HTML reader they share. Pure (text in, rows out),
 * no dependency: the pages are server-rendered government lists, so a tag-level reader is enough (no npm HTML parser is installed and none
 * may be added). It never runs a script and never follows a link.
 *
 * Every parser returns RAW rows: the text of the title, number, due date, posted date, category, status and agency cells, and one link.
 * A column whose header names a person (CONTACT_HEADER) is skipped before any field is matched, so a buyer's name, phone or e-mail never
 * leaves this module. Text of other unmapped columns is kept only as `otherText`, read for closed or awarded words and never stored.
 *
 * Round 20 review fixes:
 *  - linear scanners (indexOf, no lazy regex across the document): an unclosed comment, script or link ends the scan instead of making it
 *    quadratic; every parser takes a deadline tick and throws ParseTimeoutError past it (page-watch.ts records `parse_timeout`);
 *  - every table with a title column is read, except one under an awarded, closed, archived, past or results heading or with an award
 *    column; tables with a due column are preferred; a table with headers and no row is a mismatch (a script may fill it), not "empty";
 *  - a header row is "real" only from <thead> or all-<th> cells; a problem text never echoes a cell of a header-less table, only shapes.
 */

export interface RawBidRow {
  title: string;
  number?: string;
  due?: string;
  posted?: string;
  category?: string;
  status?: string;
  agency?: string;
  /** Absolute or relative href as printed; resolved and domain-checked later. */
  link?: string;
  /** The source has a status column or key for this row (an empty cell still counts): urgency then needs an explicitly open status. */
  statusKnown?: boolean;
  /** Text of the other non-contact columns, read only for closed/awarded words. Never stored. */
  otherText?: string;
  /** Read from the whole page because the listing area was not found: never urgent. */
  feedOnly?: boolean;
}

export interface ParseResult {
  rows: RawBidRow[];
  /** The page has the structure the parser looks for (a table, a list of numbered links, items, a header line). */
  structure: boolean;
  /** The page says, in server-rendered text, that nothing is open. */
  empty: boolean;
  /** Why zero rows came out (for the parser_mismatch log line). Never holds a cell of a header-less table. */
  problem?: string;
}

export class ParseTimeoutError extends Error {
  constructor() {
    super('parse_timeout');
    this.name = 'ParseTimeoutError';
  }
}

/** A deadline check: call it in every loop; it throws ParseTimeoutError once `deadlineMs` (performance.now()) has passed. */
export type Tick = () => void;
export function tickUntil(deadlineMs: number | null | undefined, now: () => number = () => performance.now()): Tick {
  if (!deadlineMs) return () => {};
  let n = 0;
  return () => {
    if ((++n & 63) === 0 && now() > deadlineMs) throw new ParseTimeoutError();
  };
}

// ---- HTML reader -------------------------------------------------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
  hellip: '...', bull: '*', middot: '*', copy: '(c)', reg: '(R)', trade: '(TM)', sect: 'S', deg: ' deg', eacute: 'é', egrave: 'è',
  aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', rarr: '->', larr: '<-',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const NOISE_TAGS = ['script', 'style', 'noscript', 'template', 'svg', 'head'];
const isBoundary = (c: string | undefined) => c === undefined || c === '>' || c === '/' || /\s/.test(c);

/** Index of the next `<tag` (followed by a boundary) at or after `from` in the lower-cased text, or -1. */
function nextTag(lower: string, tag: string, from: number): number {
  let i = from;
  for (;;) {
    i = lower.indexOf(`<${tag}`, i);
    if (i === -1) return -1;
    if (isBoundary(lower[i + 1 + tag.length])) return i;
    i += 1;
  }
}

/**
 * Scripts, styles, templates, SVG, comments and the head removed: what a reader sees. Linear: the next position of each construct is
 * cached, and an unclosed comment or element ends the document there.
 */
export function stripNoise(html: string, tick: Tick = () => {}): string {
  const lower = html.toLowerCase();
  const next = new Map<string, number>();
  const pos = (key: string, from: number): number => {
    const cached = next.get(key);
    if (cached !== undefined && (cached === -1 || cached >= from)) return cached;
    const v = key === '!--' ? lower.indexOf('<!--', from) : nextTag(lower, key, from);
    next.set(key, v);
    return v;
  };
  const parts: string[] = [];
  let i = 0;
  while (i < html.length) {
    tick();
    let best = -1;
    let which = '';
    for (const k of ['!--', ...NOISE_TAGS]) {
      const p = pos(k, i);
      if (p !== -1 && (best === -1 || p < best)) {
        best = p;
        which = k;
      }
    }
    if (best === -1) {
      parts.push(html.slice(i));
      break;
    }
    parts.push(html.slice(i, best), ' ');
    if (which === '!--') {
      const end = lower.indexOf('-->', best + 4);
      if (end === -1) break;
      i = end + 3;
    } else {
      const end = lower.indexOf(`</${which}`, best + which.length + 1);
      if (end === -1) break;
      const close = lower.indexOf('>', end);
      i = close === -1 ? html.length : close + 1;
    }
  }
  return parts.join('');
}

/** Visible text: block ends become line breaks, cells are joined with " | ", tags removed, entities decoded, spaces collapsed per line. */
export function textOf(html: string, tick: Tick = () => {}): string {
  const t = stripNoise(html, tick)
    .replace(/<\/(td|th)\s*>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|dt|dd|section|article|header|footer|table|ul|ol|caption)\s*>/gi, '\n')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/</g, ' ');
  return decodeEntities(t)
    .split('\n')
    .map((l) => l.replace(/[\s ]+/g, ' ').replace(/(?:\s*\|\s*)+$/, '').trim())
    .filter(Boolean)
    .join('\n');
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null;
};

export interface Link {
  text: string;
  href: string;
}

/** Links in document order. Linear: an unclosed <a> ends the scan. */
export function linksOf(html: string, tick: Tick = () => {}): Link[] {
  const lower = html.toLowerCase();
  const out: Link[] = [];
  let i = 0;
  for (;;) {
    tick();
    const a = nextTag(lower, 'a', i);
    if (a === -1) break;
    const gt = lower.indexOf('>', a);
    if (gt === -1) break;
    const end = lower.indexOf('</a', gt);
    if (end === -1) break;
    i = end + 3;
    const href = attr(html.slice(a, gt + 1), 'href');
    if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href.trim())) continue;
    out.push({ text: textOf(html.slice(gt + 1, end), tick).replace(/\n/g, ' ').trim(), href: href.trim() });
  }
  return out;
}

export interface Cell {
  text: string;
  links: string[];
  header: boolean;
}

export interface Table {
  /** Header texts in lower case ('' for a column with no header). */
  headers: string[];
  /** The header row came from <thead> or is all <th> cells. false: the first row was taken as headers and may be data (never printed). */
  realHeader: boolean;
  /** Data rows (the header row left out). */
  rows: Cell[][];
  /** The nearest heading or caption before the table (visible text, at most 160 characters). */
  context: string;
}

/** Cells of one row: the content between consecutive <td>/<th> openings, cut at the cell's own close. */
function cellsOf(row: string, tick: Tick): Cell[] {
  const cells: Cell[] = [];
  const re = /<(t[dh])\b[^>]*>/gi;
  const starts: Array<{ at: number; end: number; th: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(row))) {
    tick();
    starts.push({ at: m.index, end: m.index + m[0].length, th: m[1].toLowerCase() === 'th' });
  }
  starts.forEach((s, k) => {
    let inner = row.slice(s.end, k + 1 < starts.length ? starts[k + 1].at : row.length);
    const close = inner.search(/<\/(?:td|th|tr)\s*>/i);
    if (close !== -1) inner = inner.slice(0, close);
    cells.push({ text: textOf(inner, tick).replace(/\n/g, ' ').trim(), links: linksOf(inner, tick).map((l) => l.href), header: s.th });
  });
  return cells;
}

/**
 * Innermost tables only (a layout table around a data table is skipped). Linear: each table is found with indexOf, nested openings move the
 * start inward, an unclosed table ends the scan.
 */
export function tablesOf(html: string, tick: Tick = () => {}): Table[] {
  const clean = stripNoise(html, tick);
  const lower = clean.toLowerCase();
  const out: Table[] = [];
  let i = 0;
  for (;;) {
    tick();
    let start = nextTag(lower, 'table', i);
    if (start === -1) break;
    let close = lower.indexOf('</table', start);
    if (close === -1) break;
    for (let inner = nextTag(lower, 'table', start + 6); inner !== -1 && inner < close; inner = nextTag(lower, 'table', start + 6)) {
      tick();
      start = inner;
    }
    close = lower.indexOf('</table', start);
    const openEnd = lower.indexOf('>', start);
    i = close + 7;
    if (openEnd === -1 || openEnd > close) continue;
    const body = clean.slice(openEnd + 1, close);
    const bodyLower = body.toLowerCase();
    const theadEnd = bodyLower.indexOf('</thead');
    const rowStarts: number[] = [];
    for (let r = nextTag(bodyLower, 'tr', 0); r !== -1; r = nextTag(bodyLower, 'tr', r + 3)) {
      tick();
      rowStarts.push(r);
    }
    const rows: Cell[][] = [];
    let headerIdx = -1;
    rowStarts.forEach((r, k) => {
      const cells = cellsOf(body.slice(r, k + 1 < rowStarts.length ? rowStarts[k + 1] : body.length), tick);
      if (!cells.length) return;
      if (headerIdx < 0 && theadEnd >= 0 && r < theadEnd) headerIdx = rows.length;
      rows.push(cells);
    });
    if (!rows.length) continue;
    let realHeader = headerIdx >= 0;
    if (headerIdx < 0) {
      headerIdx = 0;
      realHeader = rows[0].every((c) => c.header);
    }
    const capM = /<caption\b[^>]*>([\s\S]*?)<\/caption/i.exec(body.slice(0, 2000));
    const before = textOf(clean.slice(Math.max(0, start - 600), start), tick).split('\n').filter(Boolean);
    const context = (capM ? textOf(capM[1], tick) : before[before.length - 1] ?? '').slice(0, 160);
    out.push({ headers: rows[headerIdx].map((c) => c.text.toLowerCase()), realHeader, rows: rows.filter((_, k) => k !== headerIdx), context });
  }
  return out;
}

/** The listing area: from the first match of the start marker to the first match of the end marker after it. `found` false: no start marker. */
export function listingArea(html: string, ds: Pick<PageWatchDataset, 'areaStart' | 'areaEnd'>): { html: string; found: boolean } {
  let s = html;
  let found = !ds.areaStart;
  if (ds.areaStart) {
    const m = new RegExp(ds.areaStart, 'i').exec(s);
    if (m) {
      s = s.slice(m.index);
      found = true;
    }
  }
  if (found && ds.areaEnd) {
    const m = new RegExp(ds.areaEnd, 'i').exec(s.slice(1));
    if (m) s = s.slice(0, m.index + 1);
  }
  return { html: s, found };
}

// ---- column matching ---------------------------------------------------------------------------------------------------------------

/** A header that names a person or a way to reach one: the column is never read. */
export const CONTACT_HEADER = /contact|buyer|purchasing agent|specialist|officer|analyst|manager|representative|phone|e-?mail|fax|attn|attention|prepared by|requested by|coordinator|\blead\b|owner|vendor|awarded to|recipient/i;
/** A heading that marks a list of finished solicitations. */
export const ARCHIVE_HEADING = /\b(?:award(?:ed|s)?|closed|archiv\w*|past|previous|results|cancel(?:l?ed)?|expired|completed?|history)\b/i;
const AWARD_HEADER = /award|winning|vendor selected/i;

type Field = 'number' | 'due' | 'posted' | 'status' | 'category' | 'agency' | 'title';
const FIELD_ORDER: Field[] = ['number', 'due', 'posted', 'status', 'category', 'agency', 'title'];

/** Column index per field: the dataset's own hints first, then the defaults; earliest hint wins; contact columns are excluded. */
export function mapColumns(headers: readonly string[], hints: ColumnHints = {}): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  const taken = new Set<number>();
  headers.forEach((h, i) => {
    if (CONTACT_HEADER.test(h)) taken.add(i);
  });
  for (const f of FIELD_ORDER) {
    const list = [...(hints[f] ?? []), ...DEFAULT_COLUMNS[f]];
    for (const hint of list) {
      const i = headers.findIndex((h, j) => !taken.has(j) && h.length > 0 && h.includes(hint));
      if (i >= 0) {
        out[f] = i;
        taken.add(i);
        break;
      }
    }
  }
  return out;
}

const compileNumber = (src: string | undefined): RegExp | null => (src ? new RegExp(`^\\s*(${src})\\b\\s*[:\\-\\u2013\\u2014|]?\\s*`, 'i') : null);

/** "RFP 2027-0052 Compensation Study" -> number "RFP 2027-0052", title "Compensation Study" (null when the text does not start with a number). */
export function splitNumber(text: string, pattern: string | undefined): { number: string; rest: string } | null {
  const re = compileNumber(pattern);
  if (!re) return null;
  const m = re.exec(text);
  if (!m) return null;
  return { number: m[1].replace(/^Item\s+/i, '').trim(), rest: text.slice(m[0].length).trim() };
}

function rowFromCells(cells: Cell[], map: Partial<Record<Field, number>>, ds: Pick<PageWatchDataset, 'numberPattern'>, headers: readonly string[]): RawBidRow | null {
  const get = (f: Field) => (map[f] !== undefined ? cells[map[f] as number]?.text ?? '' : '');
  let title = get('title');
  let number = get('number');
  if (!number && title) {
    const s = splitNumber(title, ds.numberPattern);
    if (s && s.rest) {
      number = s.number;
      title = s.rest;
    }
  }
  if (!title) return null;
  // The link: the title cell's, then the number cell's, then the first link of any other column that is not a contact column (a
  // "Details" column often has no header). Only the href is taken from it, never its text.
  const pick = [map.title, map.number].filter((x): x is number => x !== undefined);
  let link: string | undefined;
  for (const i of pick) if (!link && cells[i]?.links.length) link = cells[i].links[0];
  for (let i = 0; i < cells.length && !link; i++) {
    if (CONTACT_HEADER.test(headers[i] ?? '')) continue;
    const href = cells[i].links.find((h) => !/^(?:mailto|tel):/i.test(h));
    if (href) link = href;
  }
  const mapped = new Set(Object.values(map));
  const other = cells
    .map((c, i) => (mapped.has(i) || CONTACT_HEADER.test(headers[i] ?? '') ? '' : c.text))
    .filter(Boolean)
    .join(' | ');
  return {
    title,
    number: number || undefined,
    due: get('due') || undefined,
    posted: get('posted') || undefined,
    category: get('category') || undefined,
    status: get('status') || undefined,
    statusKnown: map.status !== undefined,
    agency: get('agency') || undefined,
    link,
    otherText: other || undefined,
  };
}

// ---- parsers -----------------------------------------------------------------------------------------------------------------------

/** Server-rendered "nothing open" wording. */
const NO_OPEN_TEXT = /\b(?:there are\s+)?(?:currently\s+)?no\s+(?:open|active|current|available)\s+(?:bids|solicitations|opportunities|procurements|rfps)\b|\bno (?:solicitations|bids) (?:are )?(?:open|available) at this time\b/i;

function pageSaysEmpty(text: string, ds: Pick<PageWatchDataset, 'emptyText'>): boolean {
  return (!!ds.emptyText && new RegExp(ds.emptyText, 'i').test(text)) || NO_OPEN_TEXT.test(text);
}

/** How a table looks, for a problem text: column count and whether it has a real header. Never a cell's text. */
function shapeOf(t: Table): string {
  return `${t.headers.length} columns, ${t.rows.length} rows${t.realHeader ? '' : ', no header row'}`;
}

/** Header texts only when the header row is a real one (thead or all th); otherwise the shape. */
function describeTables(ts: readonly Table[]): string {
  return ts
    .map((t) => (t.realHeader ? `headers seen: ${t.headers.filter(Boolean).join('/')}` : shapeOf(t)))
    .join('; ')
    .slice(0, 160);
}

/**
 * html-table: every table that has a title column and is not a finished list (archive heading or an award column); tables with a due
 * column are preferred. A table with headers and no data row is a mismatch (a script may fill it), unless one full-width row says nothing
 * is open.
 */
export function parseHtmlTable(html: string, ds: PageWatchDataset, tick: Tick = () => {}): ParseResult {
  const tables = tablesOf(html, tick);
  if (!tables.length) {
    const said = pageSaysEmpty(textOf(html, tick), ds);
    return { rows: [], structure: false, empty: said, problem: said ? undefined : 'the page has no table' };
  }
  const candidates: Array<{ t: Table; map: Partial<Record<Field, number>> }> = [];
  let archived = 0;
  for (const t of tables) {
    const map = mapColumns(t.headers, ds.columns);
    if (map.title === undefined) continue;
    if (ARCHIVE_HEADING.test(t.context) || t.headers.some((h) => AWARD_HEADER.test(h))) {
      archived++;
      continue;
    }
    candidates.push({ t, map });
  }
  if (!candidates.length) {
    return {
      rows: [],
      structure: true,
      empty: false,
      problem: archived ? `only finished lists (awarded, closed or archived) were found: ${archived} table(s)` : `no table has a title column (${describeTables(tables)})`,
    };
  }
  const withDue = candidates.filter((c) => c.map.due !== undefined);
  const use = withDue.length ? withDue : candidates;
  const rows: RawBidRow[] = [];
  let messageRow = false;
  for (const { t, map } of use) {
    for (const cells of t.rows) {
      tick();
      const filled = cells.filter((c) => c.text);
      if (t.headers.length > 1 && filled.length <= 1 && cells.length <= 2) {
        // One spanning cell, or one filled cell: a "no records" message, not a row.
        if (NO_OPEN_TEXT.test(filled[0]?.text ?? '') || /\bno (?:results|records|data)\b/i.test(filled[0]?.text ?? '')) messageRow = true;
        continue;
      }
      const r = rowFromCells(cells, map, ds, t.headers);
      if (r) rows.push(r);
    }
  }
  if (rows.length) return { rows, structure: true, empty: false };
  if (messageRow) return { rows: [], structure: true, empty: true };
  const headerOnly = use.every((c) => c.t.rows.length === 0);
  return {
    rows: [],
    structure: true,
    empty: false,
    problem: headerOnly ? 'the table has headers and no rows: they may be filled by a script' : 'the table has rows but none had a title',
  };
}

/**
 * html-links: links whose text starts with a solicitation number, inside the listing area. When the area is not found the whole page is
 * read and every row is feed-only (never urgent).
 */
export function parseHtmlLinks(html: string, ds: PageWatchDataset, tick: Tick = () => {}): ParseResult {
  const area = listingArea(html, ds);
  const links = linksOf(area.html, tick);
  const rows: RawBidRow[] = [];
  for (const l of links) {
    tick();
    const s = splitNumber(l.text, ds.numberPattern);
    if (!s || s.rest.length < 4) continue;
    rows.push({ title: s.rest, number: s.number, link: l.href, statusKnown: false, ...(area.found ? {} : { feedOnly: true }) });
  }
  const said = pageSaysEmpty(textOf(area.html, tick), ds);
  return { rows, structure: links.length > 0, empty: rows.length === 0 && said, problem: rows.length === 0 && !said ? `${links.length} links, none starting with a solicitation number` : undefined };
}

const DUE_WORD = /\b(due|deadline|closing|closes|close date|opening|submission|submit)\b/i;
const DATE_IN_TEXT = /(\b\d{1,2}\/\d{1,2}\/\d{2,4}\b(?:[^|\n]{0,20}?\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)?)|(\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:[^|\n]{0,20}?\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)?)|(\b\d{4}-\d{2}-\d{2}\b)/i;

/** The first date written on a due/deadline line of a block, or on the line right after one. */
export function dueInBlock(lines: readonly string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (!DUE_WORD.test(lines[i])) continue;
    const here = DATE_IN_TEXT.exec(lines[i]);
    if (here) return here[0];
    const next = lines[i + 1] ? DATE_IN_TEXT.exec(lines[i + 1]) : null;
    if (next) return next[0];
  }
  return undefined;
}

/** A line that can be a title: short and not a sentence (no sentence punctuation, no ", " list). */
const titleLike = (l: string | undefined) => !!l && l.length < 90 && !/[.!?;]|,\s/.test(l.replace(/\b(?:No|Inc|Co|St)\.\s/g, ''));

/**
 * text-blocks: a line that starts with a solicitation number opens a block; the title is the rest of that line, or the next line when it is
 * short and not a sentence. Outside the listing area (not found): feed-only.
 */
export function parseTextBlocks(html: string, ds: PageWatchDataset, tick: Tick = () => {}): ParseResult {
  const area = listingArea(html, ds);
  const lines = textOf(area.html, tick).split('\n');
  const starts: number[] = [];
  lines.forEach((l, i) => {
    tick();
    if (splitNumber(l, ds.numberPattern)) starts.push(i);
  });
  const rows: RawBidRow[] = [];
  starts.forEach((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : Math.min(lines.length, start + 30);
    const block = lines.slice(start, end);
    const s = splitNumber(block[0], ds.numberPattern)!;
    const rest = s.rest.replace(/^[-:\s]+/, '').trim();
    const title = rest || (titleLike(block[1]) ? block[1].trim() : '');
    if (title.length < 4) return;
    const status = block.find((l) => /\b(cancel(?:l?ed)?|awarded|closed)\b/i.test(l));
    rows.push({
      title,
      number: s.number,
      due: dueInBlock(block.slice(1)),
      status: status ? status.slice(0, 80) : undefined,
      statusKnown: false,
      ...(area.found ? {} : { feedOnly: true }),
    });
  });
  const said = pageSaysEmpty(lines.join('\n'), ds);
  return { rows, structure: lines.length > 3, empty: rows.length === 0 && said, problem: rows.length === 0 && !said ? 'no line starts with a solicitation number' : undefined };
}

const tagText = (xml: string, tag: string): string | undefined => {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(xml);
  if (!m) return undefined;
  const v = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return textOf(v).replace(/\n/g, ' ').trim() || undefined;
};

/** rss: RSS <item> or Atom <entry>. The due date is read from the description's due/deadline wording, if any. */
export function parseRss(xml: string, ds: PageWatchDataset, tick: Tick = () => {}): ParseResult {
  const rows: RawBidRow[] = [];
  const lower = xml.toLowerCase();
  let items = 0;
  let i = 0;
  for (;;) {
    tick();
    const a = Math.min(...[nextTag(lower, 'item', i), nextTag(lower, 'entry', i)].map((x) => (x === -1 ? Infinity : x)));
    if (!Number.isFinite(a)) break;
    const tag = lower.startsWith('<item', a) ? 'item' : 'entry';
    const end = lower.indexOf(`</${tag}`, a);
    if (end === -1) break;
    const it = xml.slice(a, end + tag.length + 3);
    i = end + 3;
    items++;
    const titleRaw = tagText(it, 'title');
    if (!titleRaw) continue;
    let link = tagText(it, 'link');
    if (!link) {
      const m = /<link\b[^>]*href\s*=\s*["']([^"']+)["']/i.exec(it);
      link = m ? decodeEntities(m[1]) : undefined;
    }
    const desc = tagText(it, 'description') ?? tagText(it, 'summary') ?? tagText(it, 'content') ?? '';
    const s = splitNumber(titleRaw, ds.numberPattern);
    rows.push({
      title: s?.rest || titleRaw,
      number: s?.number,
      due: dueInBlock(desc.split(/(?<=[.;])\s+|\n/)),
      posted: tagText(it, 'pubDate') ?? tagText(it, 'updated') ?? tagText(it, 'published'),
      category: tagText(it, 'category'),
      statusKnown: false,
      link,
    });
  }
  const looksXml = /<(rss|feed|rdf:RDF)\b/i.test(xml);
  return { rows, structure: looksXml, empty: looksXml && items === 0, problem: looksXml && items > 0 && rows.length === 0 ? 'items without titles' : undefined };
}

/** One CSV record per line (quoted fields may hold commas, doubled quotes and line breaks). */
export function csvRecords(text: string, tick: Tick = () => {}): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    if ((i & 1023) === 0) tick();
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some((x) => x.trim())) out.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) out.push(row);
  return out;
}

/** csv: the header row is matched like a table's; a link column is any header with "url" or "link". */
export function parseCsv(text: string, ds: PageWatchDataset, tick: Tick = () => {}): ParseResult {
  const recs = csvRecords(text.replace(/^﻿/, ''), tick);
  if (recs.length === 0) return { rows: [], structure: false, empty: false };
  const headers = recs[0].map((h) => h.trim().toLowerCase());
  const map = mapColumns(headers, ds.columns);
  const linkCol = headers.findIndex((h) => !CONTACT_HEADER.test(h) && /\b(url|link)\b/.test(h));
  if (map.title === undefined) return { rows: [], structure: true, empty: false, problem: `no title column (${headers.length} columns)` };
  const rows: RawBidRow[] = [];
  for (const r of recs.slice(1)) {
    tick();
    const cells: Cell[] = r.map((t) => ({ text: t.trim(), links: [], header: false }));
    const raw = rowFromCells(cells, map, ds, headers);
    if (!raw) continue;
    if (linkCol >= 0 && r[linkCol]?.trim()) raw.link = r[linkCol].trim();
    rows.push(raw);
  }
  return { rows, structure: true, empty: recs.length === 1, problem: rows.length === 0 && recs.length > 1 ? 'rows without a title' : undefined };
}

const pickKey = (o: Record<string, unknown>, keys: string[]): string | undefined => keys.find((k) => k in o);
const pickStr = (o: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
};

const BONFIRE_NAME = ['ProjectName', 'projectName', 'ProjectTitle', 'title', 'name'];
const BONFIRE_CLOSE = ['DateClose', 'dateClose', 'closeDate', 'CloseDate', 'DateCloseUTC', 'closingDate'];
const BONFIRE_STATUS = ['ProjectStatus', 'projectStatus', 'status', 'Status'];

/**
 * bonfire: the public portal's open-opportunities JSON. The path is documented by a third party; the field names are ASSUMED (Bonfire's
 * internal casing ProjectID / ReferenceID / ProjectName / DateClose, with camelCase fallbacks), so the probe is what confirms them.
 * Round 20 review P1-5: a Bonfire opportunity always has a close date and a status, so a project without a readable date key or without a
 * status key makes the whole answer a mismatch (no row is stored with a made-up "no due date"), and a holder with no project objects is
 * a mismatch, not an empty list.
 */
export function parseBonfire(body: unknown, ds: PageWatchDataset, tick: Tick = () => {}): ParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { rows: [], structure: false, empty: false, problem: 'the answer is not a JSON object' };
  const root = body as Record<string, unknown>;
  const payload = (root.payload && typeof root.payload === 'object' ? root.payload : root) as Record<string, unknown>;
  const holder = payload.projects ?? payload.openProjects ?? payload.opportunities ?? root.projects ?? root.data;
  if (holder === undefined || holder === null || typeof holder !== 'object') {
    return { rows: [], structure: false, empty: false, problem: `no projects list (keys: ${Object.keys(payload).slice(0, 12).join(', ')})` };
  }
  const values = Array.isArray(holder) ? holder : Object.values(holder as Record<string, unknown>);
  if (values.length === 0) return { rows: [], structure: true, empty: true };
  const list = values.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
  if (!list.length) return { rows: [], structure: true, empty: false, problem: 'projects list has no project objects' };
  const rows: RawBidRow[] = [];
  for (const p of list) {
    tick();
    const title = pickStr(p, BONFIRE_NAME);
    if (!title) continue;
    const keys = Object.keys(p).slice(0, 12).join(', ');
    const dueKey = pickKey(p, BONFIRE_CLOSE);
    const due = dueKey ? p[dueKey] : undefined;
    if (!dueKey || typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(due.trim())) {
      return { rows: [], structure: true, empty: false, problem: `close date field not found or not a date (keys: ${keys})` };
    }
    if (!pickKey(p, BONFIRE_STATUS)) return { rows: [], structure: true, empty: false, problem: `status field not found (keys: ${keys})` };
    const id = pickStr(p, ['ProjectID', 'projectId', 'ProjectId', 'id']);
    rows.push({
      title,
      number: pickStr(p, ['ReferenceID', 'referenceId', 'ReferenceId', 'reference']),
      due: due.trim(),
      posted: pickStr(p, ['DateOpen', 'dateOpen', 'openDate', 'DatePublished']),
      category: pickStr(p, ['ProjectType', 'projectType', 'Type']),
      status: pickStr(p, BONFIRE_STATUS) ?? '',
      statusKnown: true,
      agency: pickStr(p, ['DepartmentName', 'departmentName']),
      link: id && /^\d{1,12}$/.test(id) && ds.bonfireSlug ? `https://${ds.bonfireSlug}.bonfirehub.com/opportunities/${id}` : undefined,
    });
  }
  return { rows, structure: true, empty: false, problem: rows.length === 0 ? 'projects without a name field' : undefined };
}
