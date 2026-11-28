import { HOLLER_UA } from '@/lib/user-agent';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import type { Db } from '@/lib/signals/store';
import { env } from '@/lib/env';
import { BIDS_FLAG, BID_SOURCE_PREFIX, bidsEnabled } from '@/lib/signals/bid-sources';
import { bidTrades } from '@/lib/signals/bid-trades';
import { lookupPlaceByName } from '@/lib/geo';
import { checkRobots, crawlDelayWaitMs, HOLLER_AGENTS, noteFetch } from '@/lib/firecrawl/robots';
import { cleanText, localDay } from './city-bids';
import { decodeEntities, stripNoise, textOf } from './page-watch-parse';
import { toIso } from './socrata';

/**
 * Round 35: Gwinnett County's own list of open solicitations, read with one plain request (no Firecrawl, no credits).
 *
 * Page: https://www.gwinnettcounty.com/government/departments/financial-services/purchasing/bids-rfps (the county's own site, no login).
 * Checked on 2026-11-28 through WebFetch (the build sandbox cannot reach the host):
 *  - robots.txt: the "*" group allows this path (its Disallow lines are Liferay query parameters, /c/, /user/, /search, login and two
 *    calendar paths) and sets Crawl-delay: 5. Nine named bots are banned from the whole site (ClaudeBot, GPTBot, CCBot ...). Holler sends
 *    its own agent (lib/user-agent.ts), matched against the "*" group only, and re-reads robots.txt before every run (lib/firecrawl/robots.ts,
 *    fail closed: an unreadable robots.txt means no page request).
 *  - terms: the site has no terms of use page. The footer links a privacy statement, open records and ADA pages; none says anything
 *    about automated access or reuse. The privacy statement says site content may be public record under the Georgia Open Records Act.
 *  - feed: none (no RSS, JSON, CSV or export link), so the HTML is parsed.
 *
 * Page shape (read 2026-11-28, 23 entries): per solicitation, a bold link whose text is the code ("BL002-27 NOT", "IWQ 141936 INV")
 * pointing at the notice PDF under /static/upload/bid/<n>/, then the title line, "Buyer Contact : <e-mail>", "Opening Date :
 * 2027-01-06 15:00:00.0 EST", a meeting link, sometimes addenda links, then a view counter. The opening date is the due date.
 *
 * What is read and stored: code (as the solicitation number, the NOT/INV suffix dropped), title, opening date and the notice PDF link (the
 * public source). The buyer line, its e-mail address and the meeting link are NEVER read into a record: the parser skips those lines and the
 * title passes a contact filter. The agency is always "Gwinnett County Purchasing". Place: the county seat (Lawrenceville, GA), city level,
 * marked data.loc = 'approx' like every agency bid, so no screen shows a distance.
 *
 * Switches: HOLLER_CITY_BIDS_R35_ENABLED (this round, default off) AND HOLLER_BIDS_ENABLED. With either off, run.ts skips the adapter and
 * fetch() makes no request at all (not even robots.txt). Daily cadence, one page request per run.
 *
 * Duplicates: the Firecrawl source bids-gwinnett reads the same list. Before returning, the adapter asks holler_signals (read only) for any
 * other bid source's open row with the same agency and solicitation number (the manual bids rule, lib/signals/manual-bids/store.ts) and
 * leaves those out, so a bid already in Holler from Firecrawl, a hand-added record or a state registry source is not added twice. A failed
 * read returns nothing for this run (fail closed: never a duplicate).
 */

export const GWINNETT_SITE_ID = 'bids-gwinnett-site';
export const CITY_BIDS_R35_FLAG = 'HOLLER_CITY_BIDS_R35_ENABLED';
export const GWINNETT_LIST_URL = 'https://www.gwinnettcounty.com/government/departments/financial-services/purchasing/bids-rfps';
export const GWINNETT_HOST = 'www.gwinnettcounty.com';
export const GWINNETT_AGENCY = 'Gwinnett County Purchasing';
export const GWINNETT_TZ = 'America/New_York';
/** County seat: the record's place, city level. ZIP is the Justice and Administration Center's, used only to place the source in its metro. */
export const GWINNETT_SEAT = { city: 'Lawrenceville', state: 'GA', zip: '30046' } as const;
export const GWINNETT_CADENCE_MINUTES = 1440;
/** Largest body read (the page is about 150 KB). */
export const GWINNETT_MAX_BYTES = 2_000_000;
export const GWINNETT_TIMEOUT_MS = 15_000;
/** A due date further out than this is not a real deadline. */
const PLACEHOLDER_DAYS = 365;

const ON = new Set(['1', 'true', 'on', 'yes']);
/** This round's switch, read at call time. Server only (the adapter is never bundled for the browser). */
export function cityBidsR35Enabled(value: string | undefined = process.env[CITY_BIDS_R35_FLAG]): boolean {
  return ON.has((value ?? '').trim().toLowerCase());
}

/** Kind of solicitation by code prefix, as the page's own filter names them. */
const PREFIX_TYPE: Record<string, string> = {
  BL: 'Invitation to Bid',
  RP: 'Request for Proposal',
  IWQ: 'Informal Written Quote',
  PA: 'Annual Price Agreement',
};

/** "BL002-27 NOT", "IWQ 141936 INV", "RP004-27". Group 1 the prefix, group 2 the number part. */
const CODE = /^(BL|RP|IWQ|PA)\s?(\d[0-9A-Z-]*)(?:\s+(?:NOT|INV))?$/i;
/** A notice link: an https PDF under /static/upload/bid/<digits>/ on the county host. */
const NOTICE_PATH = /^\/static\/upload\/bid\/\d{3,10}\/[^/]+\.pdf$/i;
/** "Opening Date : 2027-01-06 15:00:00.0 EST". Also "12/10/2026 3:00 PM". */
const OPENING_ISO = /opening\s+date\s*:?\s*(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/i;
const OPENING_US = /opening\s+date\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?/i;
/** Lines of an entry that are never a title (and never stored). */
const NOT_TITLE = /^(?:buyer\b|contact\b|opening\s+date|virtual\s+bid|addend|exhibit|cost\s+template|additional\s+doc|attachment|pre-?bid|\d+$|view\b)/i;
const CANCELLED = /\bcancel(?:l?ed|lation)\b/i;
const CONTACTISH = /\S+@\S+\.\S+|https?:\/\/\S+|\bwww\.\S+|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/i;

export interface GwinnettEntry {
  number: string;
  prefix: string;
  title: string;
  dueIso: string | null;
  url: string;
  cancelled: boolean;
}

export interface GwinnettReport {
  items: SignalInput[];
  /** notice links whose text is a solicitation code */
  entries: number;
  /** entries with a title and a readable opening date */
  shapeOk: number;
  closed: number;
  cancelled: number;
  noDue: number;
  noTrade: number;
  duplicates: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** "BL160-26 NOT" and "bl160-26" are one number: suffix dropped, then letters and digits only. */
export function solKey(raw: string): string {
  return norm(raw.trim().replace(/\s+(?:NOT|INV)$/i, '')).slice(0, 60);
}

function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null;
}

/** The notice link as a clean https URL on the county host (spaces encoded), or null. */
export function noticeUrl(href: string): string | null {
  try {
    const u = new URL(href.trim(), GWINNETT_LIST_URL);
    if (u.protocol !== 'https:' || u.hostname.replace(/^www\./, '') !== 'gwinnettcounty.com' || u.port || u.username || u.search || u.hash) return null;
    const path = decodeURIComponent(u.pathname);
    if (!NOTICE_PATH.test(path)) return null;
    return `https://${GWINNETT_HOST}${path.split('/').map(encodeURIComponent).join('/')}`;
  } catch {
    return null;
  }
}

function dueOf(text: string): string | null {
  const a = OPENING_ISO.exec(text);
  if (a) {
    const h = Number(a[2]);
    const mi = Number(a[3]);
    if (h > 23 || mi > 59) return null;
    return toIso(`${a[1]}T${String(h).padStart(2, '0')}:${a[3]}:00`, GWINNETT_TZ);
  }
  const b = OPENING_US.exec(text);
  if (b) {
    const day = `${b[3]}-${b[1].padStart(2, '0')}-${b[2].padStart(2, '0')}`;
    let h = 23;
    let mi = '59';
    if (b[4]) {
      h = (Number(b[4]) % 12) + (/p/i.test(b[6]) ? 12 : 0);
      mi = b[5];
    }
    return toIso(`${day}T${String(h).padStart(2, '0')}:${mi}:00`, GWINNETT_TZ);
  }
  return null;
}

/**
 * The page's entries in document order. Markup-tolerant: an entry starts at each notice link whose text is a solicitation code and runs to
 * the next one. The title is the first line after the link that is not a label line; the due date is the entry's "Opening Date".
 */
export function entriesOf(html: string): GwinnettEntry[] {
  const clean = stripNoise(String(html ?? ''));
  const anchors: Array<{ start: number; end: number; code: RegExpExecArray; url: string }> = [];
  const re = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi;
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    const href = attrOf(tag, 'href');
    if (!href) continue;
    const text = cleanText(textOf(m[0]).replace(/\n/g, ' '));
    const code = CODE.exec(text);
    const url = code ? noticeUrl(href) : null;
    if (code && url) anchors.push({ start: m.index, end: m.index + m[0].length, code, url });
  }
  const out: GwinnettEntry[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const segEnd = i + 1 < anchors.length ? anchors[i + 1].start : Math.min(clean.length, a.end + 6000);
    // The segment text without any other link's text first (meeting links, addenda): their words are never a title.
    const seg = clean.slice(a.end, segEnd);
    const text = textOf(seg);
    const lines = text.split('\n').map((l) => cleanText(l)).filter(Boolean);
    const titleLine = lines.find((l) => !NOT_TITLE.test(l) && !CONTACTISH.test(l) && !CODE.test(l)) ?? '';
    const prefix = a.code[1].toUpperCase();
    out.push({
      number: `${prefix}${prefix === 'IWQ' ? ' ' : ''}${a.code[2].toUpperCase()}`,
      prefix,
      title: titleLine,
      dueIso: dueOf(text),
      url: a.url,
      cancelled: CANCELLED.test(titleLine) || lines.some((l) => /^(?:this\s+)?(?:solicitation|bid)\s+(?:has\s+been\s+|is\s+)?cancel/i.test(l)),
    });
  }
  return out;
}

function trunc(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 3).trimEnd()}...`;
}

/** Pure parser: the page HTML in, open routed bids out. Never throws. */
export function parseGwinnett(html: string, now: Date = new Date()): GwinnettReport {
  const report: GwinnettReport = { items: [], entries: 0, shapeOk: 0, closed: 0, cancelled: 0, noDue: 0, noTrade: 0, duplicates: 0 };
  let entries: GwinnettEntry[] = [];
  try {
    entries = entriesOf(html);
  } catch {
    return report;
  }
  report.entries = entries.length;
  const place = lookupPlaceByName(GWINNETT_SEAT.city, GWINNETT_SEAT.state);
  const nowMs = now.getTime();
  const seen = new Set<string>();
  for (const e of entries) {
    try {
      if (!e.title) continue;
      if (!e.dueIso) {
        report.noDue += 1;
        continue;
      }
      report.shapeOk += 1;
      const key = solKey(e.number);
      if (seen.has(key)) {
        report.duplicates += 1;
        continue;
      }
      seen.add(key);
      if (e.cancelled) {
        report.cancelled += 1;
        continue;
      }
      const dueMs = Date.parse(e.dueIso);
      if (!Number.isFinite(dueMs) || dueMs <= nowMs) {
        report.closed += 1;
        continue;
      }
      if (dueMs - nowMs > PLACEHOLDER_DAYS * 86_400_000) {
        report.noDue += 1;
        continue;
      }
      const title = trunc(e.title.replace(/\s*\((?:addend|exhibit)[^)]*\)\s*$/i, ''), 140);
      const trades = bidTrades({ title });
      if (trades.length === 0) {
        report.noTrade += 1;
        continue;
      }
      const dueDay = localDay(e.dueIso, GWINNETT_TZ);
      const bidType = PREFIX_TYPE[e.prefix] ?? null;
      report.items.push({
        source: GWINNETT_SITE_ID,
        externalId: `${GWINNETT_SITE_ID}:${key}`,
        kind: 'contract',
        title: `Open bid in Gwinnett County: ${title}`,
        // No English-only words in the summary (the Spanish page localizes the 'due' part only): the kind of solicitation stays in data.bidType.
        summary: trunc([GWINNETT_AGENCY, e.number, `due ${dueDay ?? e.dueIso.slice(0, 10)}`].join(' | '), 280),
        url: e.url,
        lat: place?.lat ?? null,
        lon: place?.lon ?? null,
        city: GWINNETT_SEAT.city,
        state: GWINNETT_SEAT.state,
        zip: null,
        categories: trades,
        severity: 2,
        occurredAt: now.toISOString(),
        expiresAt: e.dueIso,
        data: {
          subtype: 'bid',
          domain: GWINNETT_HOST,
          solicitationId: e.number,
          buyer: GWINNETT_AGENCY,
          bidType,
          dueDate: dueDay,
          noDueDate: false,
          linkKind: 'solicitation',
          tz: GWINNETT_TZ,
          // The county seat, not a job site: the matcher reads radius + 15 miles and no screen shows a distance.
          loc: 'approx',
          approxLocation: true,
          via: 'own-site',
        },
      });
    } catch {
      // skip a malformed entry
    }
  }
  return report;
}

// ---- dedupe against other bid sources (read only) -------------------------------------------------------------------------------------

/** PostgREST like pattern matching any spelling of the key ("bl16026" -> "*b*l*1*6*0*2*6*"), the manual bids rule. */
function solPattern(key: string): string {
  return `*${key.split('').join('*')}*`;
}

/** Agency names match when one contains the other after normalizing ("Gwinnett County" and "Gwinnett County Purchasing"). */
export function sameAgency(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
}

/**
 * External ids of the items another bid source already holds as an open record: same agency and same solicitation number, any spelling
 * (the NOT/INV suffix ignored). Own rows are not asked for (the store's upsert already skips them). A row the owner retired, or one whose
 * due date has passed, does not count. Throws on a read error.
 */
export async function alreadyHeld(db: Pick<Db, 'from'>, items: SignalInput[], now: Date): Promise<Set<string>> {
  const out = new Set<string>();
  const withKey = items.map((it) => ({ it, key: solKey(String((it.data as { solicitationId?: unknown })?.solicitationId ?? '')) })).filter((x) => x.key.length >= 2);
  if (withKey.length === 0) return out;
  const keys = [...new Set(withKey.map((x) => x.key))];
  for (let i = 0; i < keys.length; i += 20) {
    const part = keys.slice(i, i + 20);
    const { data, error } = await db
      .from('holler_signals')
      .select('source, expires_at, sol:data->>solicitationId, buyer:data->>buyer, retired:data->>retiredAt')
      .like('source', `${BID_SOURCE_PREFIX}%`)
      .neq('source', GWINNETT_SITE_ID)
      .or(part.map((k) => `data->>solicitationId.ilike.${solPattern(k)}`).join(','));
    if (error) throw new Error('dedupe read failed');
    for (const r of (data ?? []) as Array<{ expires_at?: string | null; sol?: string | null; buyer?: string | null; retired?: string | null }>) {
      if (!r.sol || r.retired) continue;
      // A closed record does not block an open one (a due date the county moved later). An unreadable date counts as open: the cautious side.
      if (r.expires_at && Date.parse(r.expires_at) <= now.getTime()) continue;
      const k = solKey(r.sol);
      for (const x of withKey) if (x.key === k && sameAgency(GWINNETT_AGENCY, r.buyer ?? '')) out.add(x.it.externalId);
    }
  }
  return out;
}

// ---- the adapter ------------------------------------------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, max);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const buf = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    const n = Math.min(c.byteLength, buf.length - off);
    buf.set(c.subarray(0, n), off);
    off += n;
    if (off >= buf.length) break;
  }
  return new TextDecoder('utf-8').decode(buf);
}

export function switchesOn(ctx: Pick<AdapterContext, 'env'>): { bids: boolean; r35: boolean } {
  return {
    bids: bidsEnabled(ctx.env[BIDS_FLAG] ?? env.HOLLER_BIDS_ENABLED ?? process.env[BIDS_FLAG]),
    r35: cityBidsR35Enabled(ctx.env[CITY_BIDS_R35_FLAG] ?? env.HOLLER_CITY_BIDS_R35_ENABLED ?? process.env[CITY_BIDS_R35_FLAG]),
  };
}

export const gwinnettSiteAdapter: Adapter = {
  id: GWINNETT_SITE_ID,
  label: 'Gwinnett County purchasing: open solicitations (county site)',
  kind: 'contract',
  cadenceMinutes: GWINNETT_CADENCE_MINUTES,
  sourceUrl: GWINNETT_LIST_URL,
  enabled: () => bidsEnabled(),
  flag: BIDS_FLAG,
  extraFlags: [{ name: CITY_BIDS_R35_FLAG, on: () => cityBidsR35Enabled() }],
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    // Defence in depth: run.ts already skips the adapter with a switch off, but a direct call (a probe, a test) must not request anything.
    const on = switchesOn(ctx);
    if (!on.bids || !on.r35) {
      ctx.log(`${GWINNETT_SITE_ID}: skipped, ${!on.r35 ? CITY_BIDS_R35_FLAG : BIDS_FLAG} is off`);
      return [];
    }
    try {
      const now = ctx.now ?? new Date();
      const robots = await checkRobots(GWINNETT_LIST_URL, ctx.fetch, now.getTime(), { agents: HOLLER_AGENTS });
      if (!robots.allowed) {
        ctx.log(`${GWINNETT_SITE_ID}: not fetched, robots.txt ${robots.reason === 'disallowed' ? 'disallows the page' : `could not be read${robots.why ? ` (${robots.why})` : ''}`}`);
        return [];
      }
      // Crawl-delay (5 s on this host): wait it out when another Holler request to the host was that recent. At most 10 s.
      const wait = crawlDelayWaitMs(GWINNETT_LIST_URL, robots.crawlDelaySec, Date.now());
      if (wait > 10_000) {
        ctx.log(`${GWINNETT_SITE_ID}: skipped, Crawl-delay ${robots.crawlDelaySec} s not met`);
        return [];
      }
      if (wait > 0) await sleep(wait);
      noteFetch(GWINNETT_LIST_URL, Date.now());
      const res = await ctx.fetch(GWINNETT_LIST_URL, {
        headers: { 'User-Agent': HOLLER_UA, Accept: 'text/html, application/xhtml+xml' },
        redirect: 'manual',
        signal: AbortSignal.timeout(GWINNETT_TIMEOUT_MS),
      });
      if (res.status >= 300 && res.status < 400) {
        ctx.log(`error: ${GWINNETT_SITE_ID} HTTP ${res.status} redirect not followed, the list page may have moved`);
        return [];
      }
      if (!res.ok) {
        ctx.log(`error: ${GWINNETT_SITE_ID} HTTP ${res.status}`);
        return [];
      }
      const ct = (res.headers.get('content-type') ?? '').toLowerCase();
      if (ct && !/html/.test(ct)) {
        ctx.log(`error: ${GWINNETT_SITE_ID} answered ${ct.split(';')[0]}, not a page`);
        return [];
      }
      const html = await readCapped(res, GWINNETT_MAX_BYTES);
      const report = parseGwinnett(html, now);
      if (report.entries === 0 || report.shapeOk === 0) {
        ctx.log(`error: ${GWINNETT_SITE_ID} parsed 0 solicitations (${report.entries} notice links), the page shape may have changed`);
        return [];
      }
      let items = report.items;
      let held = 0;
      if (ctx.db && items.length > 0) {
        try {
          const dupes = await alreadyHeld(ctx.db, items, now);
          held = dupes.size;
          items = items.filter((it) => !dupes.has(it.externalId));
        } catch {
          ctx.log(`error: ${GWINNETT_SITE_ID} could not check other bid sources for duplicates; nothing kept this run`);
          return [];
        }
      } else if (!ctx.db && items.length > 0) {
        ctx.log(`${GWINNETT_SITE_ID}: no database in this run, duplicates with other bid sources not checked`);
      }
      ctx.log(
        `${GWINNETT_SITE_ID}: ${report.entries} listed, ${report.shapeOk} readable, ${report.items.length} open with a trade, ${held} already in Holler from another source, ${items.length} kept, ${report.noTrade} no trade, ${report.closed} closed, ${report.cancelled} cancelled, ${report.noDue} without a usable due date`,
      );
      return items;
    } catch (e) {
      ctx.log(`error: ${GWINNETT_SITE_ID}: ${e instanceof Error ? e.name : 'failure'}`);
      return [];
    }
  },
};

export const adapters: Adapter[] = [gwinnettSiteAdapter];
