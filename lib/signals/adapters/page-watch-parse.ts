import { DEFAULT_COLUMNS, type ColumnHints, type PageWatchDataset } from './page-watch-datasets';

/**
 * Round 20 WATCH: the per-platform row parsers of the page-watch adapter, and the small HTML reader they share. Pure (text in, rows out),
 * no dependency: the pages are server-rendered government lists, so a tag-level reader is enough (no npm HTML parser is installed and none
 * may be added). It never runs a script and never follows a link.
 *
 * Every parser returns RAW rows: the text of the title, number, due date, posted date, category, status and agency cells, and one link.
 * Nothing else is read. A column whose header names a person (CONTACT_HEADER) is skipped before any field is matched, so a buyer's name,
 * phone or e-mail never leaves this module. Validation (open, due, trade, privacy clean-up of the title) is page-watch.ts.
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
}

export interface ParseResult {
  rows: RawBidRow[];
  /** The page has the structure the parser looks for (a table, a list of numbered links, items, a header line). */
  structure: boolean;
  /** The page says nothing is open (dataset emptyText), or the matched table has a header and no data row. */
  empty: boolean;
  /** Why zero rows came out of a page that has structure (for the parser_mismatch log line). */
  problem?: string;
}

// ---- HTML reader -------------------------------------------------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
  hellip: '...', bull: '*', middot: '*', copy: '(c)', reg: '(R)', trade: '(TM)', sect: 'S', deg: ' deg',
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

/** Scripts, styles, templates, SVG, comments and the head removed: what a reader sees. */
export function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
}

/** Visible text: block ends become line breaks, cells are joined with " | ", tags removed, entities decoded, spaces collapsed per line. */
export function textOf(html: string): string {
  const t = stripNoise(html)
    .replace(/<\/(td|th)\s*>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|dt|dd|section|article|header|footer|table|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
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

export function linksOf(html: string): Link[] {
  const out: Link[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = attr(`<a ${m[1]}>`, 'href');
    if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href.trim())) continue;
    out.push({ text: textOf(m[2]).replace(/\n/g, ' ').trim(), href: href.trim() });
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
  /** Data rows (the header row left out). */
  rows: Cell[][];
}

/**
 * Innermost tables only (a layout table around a data table is skipped): the pattern refuses a nested opening <table>. The header is the
 * <thead> row, else the first row made of <th> cells, else the first row.
 */
export function tablesOf(html: string): Table[] {
  const clean = stripNoise(html);
  const out: Table[] = [];
  const tableRe = /<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table\s*>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(clean))) {
    const body = tm[1];
    const rows: Cell[][] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/tbody|<\/thead|<\/tfoot|$)/gi;
    let rm: RegExpExecArray | null;
    let theadEnd = -1;
    const th = /<\/thead\s*>/i.exec(body);
    if (th) theadEnd = th.index;
    let headerRowIdx = -1;
    while ((rm = rowRe.exec(body))) {
      if (rm[0] === '') {
        rowRe.lastIndex++;
        continue;
      }
      const cells: Cell[] = [];
      const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)(?=<td\b|<th\b|<\/tr|$)/gi;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rm[1]))) {
        if (cm[0] === '') {
          cellRe.lastIndex++;
          continue;
        }
        const inner = cm[2].replace(/<\/(td|th)\s*>[\s\S]*$/i, '');
        cells.push({ text: textOf(inner).replace(/\n/g, ' ').trim(), links: linksOf(inner).map((l) => l.href), header: cm[1].toLowerCase() === 'th' });
      }
      if (!cells.length) continue;
      if (headerRowIdx < 0 && theadEnd >= 0 && rm.index < theadEnd) headerRowIdx = rows.length;
      rows.push(cells);
    }
    if (!rows.length) continue;
    if (headerRowIdx < 0) headerRowIdx = 0;
    const headers = rows[headerRowIdx].map((c) => c.text.toLowerCase());
    out.push({ headers, rows: rows.filter((_, i) => i !== headerRowIdx) });
  }
  return out;
}

/** The listing area: the text between the dataset's markers (first match of each), else the whole page. */
export function listingArea(html: string, ds: Pick<PageWatchDataset, 'areaStart' | 'areaEnd'>): string {
  let s = html;
  if (ds.areaStart) {
    const m = new RegExp(ds.areaStart, 'i').exec(s);
    if (m) s = s.slice(m.index);
  }
  if (ds.areaEnd) {
    const m = new RegExp(ds.areaEnd, 'i').exec(s.slice(1));
    if (m) s = s.slice(0, m.index + 1);
  }
  return s;
}

// ---- column matching ---------------------------------------------------------------------------------------------------------------

/** A header that names a person or a way to reach one: the column is never read. */
export const CONTACT_HEADER = /contact|buyer|purchasing agent|specialist|officer|analyst|manager|representative|phone|e-?mail|fax|attn|attention|prepared by/i;

type Field = keyof ColumnHints;
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

function rowFromCells(cells: Cell[], map: Partial<Record<Field, number>>, ds: Pick<PageWatchDataset, 'numberPattern'>, headers: readonly string[] = []): RawBidRow | null {
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
  return {
    title,
    number: number || undefined,
    due: get('due') || undefined,
    posted: get('posted') || undefined,
    category: get('category') || undefined,
    status: get('status') || undefined,
    agency: get('agency') || undefined,
    link,
  };
}

// ---- parsers -----------------------------------------------------------------------------------------------------------------------

function emptyMessage(html: string, ds: Pick<PageWatchDataset, 'emptyText'>): boolean {
  return !!ds.emptyText && new RegExp(ds.emptyText, 'i').test(textOf(html));
}

/** html-table: the table whose headers give a title column and that has the most data rows. */
export function parseHtmlTable(html: string, ds: PageWatchDataset): ParseResult {
  const tables = tablesOf(html);
  const said = emptyMessage(html, ds);
  if (!tables.length) return { rows: [], structure: false, empty: said };
  let best: { t: Table; map: Partial<Record<Field, number>> } | null = null;
  for (const t of tables) {
    const map = mapColumns(t.headers, ds.columns);
    if (map.title === undefined) continue;
    if (!best || t.rows.length > best.t.rows.length) best = { t, map };
  }
  if (!best) {
    const dataTable = tables.some((t) => t.rows.length >= 1);
    return { rows: [], structure: dataTable, empty: said, problem: dataTable ? `no table has a title column (headers seen: ${tables.map((t) => t.headers.filter(Boolean).join('/')).join('; ').slice(0, 160)})` : undefined };
  }
  const rows: RawBidRow[] = [];
  for (const cells of best.t.rows) {
    // A "no records" row spans the table: one cell, or every mapped cell blank.
    if (cells.length === 1 && best.t.headers.length > 1) continue;
    const r = rowFromCells(cells, best.map, ds, best.t.headers);
    if (r) rows.push(r);
  }
  const empty = said || best.t.rows.every((c) => c.length === 1 && best.t.headers.length > 1) || best.t.rows.length === 0;
  return { rows, structure: true, empty: rows.length === 0 && empty, problem: rows.length === 0 && !empty ? 'the table has rows but none had a title' : undefined };
}

/** html-links: each link whose text (or the text right after the number) starts with a solicitation number. */
export function parseHtmlLinks(html: string, ds: PageWatchDataset): ParseResult {
  const links = linksOf(html);
  const rows: RawBidRow[] = [];
  for (const l of links) {
    const s = splitNumber(l.text, ds.numberPattern);
    if (!s || s.rest.length < 4) continue;
    rows.push({ title: s.rest, number: s.number, link: l.href });
  }
  const said = emptyMessage(html, ds);
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

/** text-blocks: a line that starts with a solicitation number opens a block; the title is the rest of that line or the next line. */
export function parseTextBlocks(html: string, ds: PageWatchDataset): ParseResult {
  const lines = textOf(html).split('\n');
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (splitNumber(l, ds.numberPattern)) starts.push(i);
  });
  const rows: RawBidRow[] = [];
  starts.forEach((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : Math.min(lines.length, start + 30);
    const block = lines.slice(start, end);
    const s = splitNumber(block[0], ds.numberPattern)!;
    const title = (s.rest || block[1] || '').replace(/^[-:\s]+/, '').trim();
    if (title.length < 4) return;
    const status = block.find((l) => /\b(cancel(?:l?ed)?|awarded|closed)\b/i.test(l));
    rows.push({ title, number: s.number, due: dueInBlock(block.slice(1)), status: status ? status.slice(0, 80) : undefined });
  });
  const said = emptyMessage(html, ds);
  return { rows, structure: lines.length > 3, empty: rows.length === 0 && said, problem: rows.length === 0 && !said ? 'no line starts with a solicitation number' : undefined };
}

const tagText = (xml: string, tag: string): string | undefined => {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(xml);
  if (!m) return undefined;
  const v = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return textOf(v).replace(/\n/g, ' ').trim() || undefined;
};

/** rss: RSS <item> or Atom <entry>. The due date is read from the description's due/deadline wording, if any. */
export function parseRss(xml: string, ds: PageWatchDataset): ParseResult {
  const items = xml.match(/<(item|entry)\b[\s\S]*?<\/\1\s*>/gi) ?? [];
  const rows: RawBidRow[] = [];
  for (const it of items) {
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
      link,
    });
  }
  const looksXml = /<(rss|feed|rdf:RDF)\b/i.test(xml);
  return { rows, structure: looksXml, empty: looksXml && items.length === 0, problem: looksXml && items.length > 0 && rows.length === 0 ? 'items without titles' : undefined };
}

/** One CSV record per line (quoted fields may hold commas, doubled quotes and line breaks). */
export function csvRecords(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
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
export function parseCsv(text: string, ds: PageWatchDataset): ParseResult {
  const recs = csvRecords(text.replace(/^﻿/, ''));
  if (recs.length === 0) return { rows: [], structure: false, empty: false };
  const headers = recs[0].map((h) => h.trim().toLowerCase());
  const map = mapColumns(headers, ds.columns);
  const linkCol = headers.findIndex((h) => !CONTACT_HEADER.test(h) && /\b(url|link)\b/.test(h));
  if (map.title === undefined) return { rows: [], structure: true, empty: false, problem: `no title column (headers: ${headers.join('/').slice(0, 160)})` };
  const rows: RawBidRow[] = [];
  for (const r of recs.slice(1)) {
    const cells: Cell[] = r.map((t) => ({ text: t.trim(), links: [], header: false }));
    const raw = rowFromCells(cells, map, ds, headers);
    if (!raw) continue;
    if (linkCol >= 0 && r[linkCol]?.trim()) raw.link = r[linkCol].trim();
    rows.push(raw);
  }
  return { rows, structure: true, empty: recs.length === 1, problem: rows.length === 0 && recs.length > 1 ? 'rows without a title' : undefined };
}

const pickStr = (o: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
};

/**
 * bonfire: the public portal's open-opportunities JSON. The path is documented by a third party; the field names are ASSUMED (Bonfire's
 * internal casing ProjectID / ReferenceID / ProjectName / DateClose, with camelCase fallbacks), so the probe is what confirms them. The
 * projects may be an array or an object keyed by id, under payload.projects, payload.openProjects, projects or data.
 */
export function parseBonfire(body: unknown, ds: PageWatchDataset): ParseResult {
  if (!body || typeof body !== 'object') return { rows: [], structure: false, empty: false };
  const root = body as Record<string, unknown>;
  const payload = (root.payload && typeof root.payload === 'object' ? root.payload : root) as Record<string, unknown>;
  const holder = payload.projects ?? payload.openProjects ?? payload.opportunities ?? root.projects ?? root.data;
  if (holder === undefined || holder === null || typeof holder !== 'object') {
    return { rows: [], structure: false, empty: false, problem: `no projects list (keys: ${Object.keys(payload).slice(0, 12).join(', ')})` };
  }
  const list = (Array.isArray(holder) ? holder : Object.values(holder as Record<string, unknown>)).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  const rows: RawBidRow[] = [];
  for (const p of list) {
    const title = pickStr(p, ['ProjectName', 'projectName', 'ProjectTitle', 'title', 'name']);
    if (!title) continue;
    const id = pickStr(p, ['ProjectID', 'projectId', 'ProjectId', 'id']);
    rows.push({
      title,
      number: pickStr(p, ['ReferenceID', 'referenceId', 'ReferenceId', 'reference']),
      due: pickStr(p, ['DateClose', 'dateClose', 'closeDate', 'CloseDate', 'DateCloseUTC', 'closingDate']),
      posted: pickStr(p, ['DateOpen', 'dateOpen', 'openDate', 'DatePublished']),
      category: pickStr(p, ['ProjectType', 'projectType', 'Type']),
      status: pickStr(p, ['ProjectStatus', 'status', 'Status']),
      agency: pickStr(p, ['DepartmentName', 'departmentName']),
      link: id && /^\d{1,12}$/.test(id) && ds.bonfireSlug ? `https://${ds.bonfireSlug}.bonfirehub.com/opportunities/${id}` : undefined,
    });
  }
  return { rows, structure: true, empty: list.length === 0, problem: list.length > 0 && rows.length === 0 ? 'projects without a name field' : undefined };
}
