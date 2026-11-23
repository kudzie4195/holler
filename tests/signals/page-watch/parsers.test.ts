import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_WATCH_DATASETS, pageWatchDataset, type PageWatchDataset } from '@/lib/signals/adapters/page-watch-datasets';
import {
  CONTACT_HEADER,
  csvRecords,
  decodeEntities,
  mapColumns,
  parseBonfire,
  parseCsv,
  parseHtmlLinks,
  parseHtmlTable,
  parseRss,
  parseTextBlocks,
  tablesOf,
  textOf,
} from '@/lib/signals/adapters/page-watch-parse';
import { cleanBidTitle, pageWatchTrades, parseDateText, proposedPageWatchLabel, rowsToSignals } from '@/lib/signals/adapters/page-watch';

/** Fixtures are hand-written (fixtures/README.md): no agency page was downloaded. */
const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const NOW = new Date('2026-11-22T17:00:00Z');
const ds = (id: string): PageWatchDataset => pageWatchDataset(id)!;

/** Names, e-mails and phones invented in the fixtures: none may ever come out of a parser or a record. */
const PEOPLE = /Buyerson|Smallwood|Ferreira|Brennan|Pat Morgan|pmorgan|Ann Example|Lee Example|@|555-01/i;
const noPeople = (x: unknown) => expect(JSON.stringify(x)).not.toMatch(PEOPLE);

describe('HTML reader', () => {
  it('decodes entities and drops scripts, styles and comments', () => {
    expect(decodeEntities('A &amp; B &#8211; C&nbsp;D &#x41;')).toBe('A & B – C D A');
    expect(textOf('<p>a<script>var x="SECRET"</script> b<!-- hidden --></p><style>p{}</style>')).toBe('a b');
  });
  it('reads the innermost table only, header from thead or the first row', () => {
    const t = tablesOf(fx('metro-table.html'));
    expect(t.map((x) => x.headers[0])).toEqual(['solicitation number', 'event']);
    expect(t[0].rows).toHaveLength(5);
    expect(t[0].rows[0][0].links).toEqual(['https://ridemetro.bonfirehub.com/opportunities/149219']);
  });
  it('never maps a contact column, even when its header holds a wanted word', () => {
    expect(CONTACT_HEADER.test('Buyer Contact')).toBe(true);
    const map = mapColumns(['solicitation number', 'title', 'close date', 'buyer', 'contact phone', 'buyer name (title)']);
    expect(map).toEqual({ number: 0, due: 2, title: 1 });
  });
  it('csv records keep quoted commas and line breaks', () => {
    expect(csvRecords('a,b\n"x, y","line1\nline2"\n')).toEqual([['a', 'b'], ['x, y', 'line1\nline2']]);
  });
});

describe('platform parsers', () => {
  it('bonfire: projects keyed by id, link to the opportunity page', () => {
    const r = parseBonfire(JSON.parse(fx('bonfire-open.json')), ds('bids-pw-dart'));
    expect(r.structure).toBe(true);
    expect(r.rows).toHaveLength(6);
    expect(r.rows[0]).toMatchObject({ title: 'Roof Replacement at Kashmere Bus Operating Facility', number: 'IFB 2027000041', due: '2026-12-10 20:00:00', link: 'https://dart.bonfirehub.com/opportunities/149219' });
    expect(parseBonfire({ payload: { projects: [] } }, ds('bids-pw-dart'))).toMatchObject({ rows: [], structure: true, empty: true });
    expect(parseBonfire({ payload: { weird: 1 } }, ds('bids-pw-dart')).problem).toMatch(/no projects list/);
  });
  it('html-table (Houston METRO): number, title, close date and the number link; the Ariba "No results" table is ignored', () => {
    const r = parseHtmlTable(fx('metro-table.html'), ds('bids-pw-houston-metro'));
    expect(r.rows).toHaveLength(5);
    expect(r.rows[0]).toMatchObject({ number: 'IFB 2027000041', title: 'Roof Replacement at Kashmere Bus Operating Facility', due: 'Dec 10, 2026 2:00 PM', link: 'https://ridemetro.bonfirehub.com/opportunities/149219' });
    noPeople(r.rows.map((x) => ({ ...x, title: cleanBidTitle(x.title, x.number) })));
  });
  it('html-table (School District of Philadelphia): Buyer Contact never read, Results read as status', () => {
    const r = parseHtmlTable(fx('philasd-capital.html'), ds('bids-pw-philasd-capital'));
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0]).toMatchObject({ number: 'NG10901', due: '12/17/2026', posted: '11/12/2026', agency: 'Capital Programs', link: '/procurement/wp-content/uploads/sites/93/2026/11/NG10901.pdf' });
    expect(r.rows[2].status).toBe('Walkthrough Sign-in Sheet, Bid Tab');
    noPeople(r.rows);
  });
  it('html-table (Miami-Dade): headers with no row is a mismatch (a script may fill the grid), even with "No data to show" outside it', () => {
    const r = parseHtmlTable(fx('miamidade-empty.html'), ds('bids-pw-miamidade-construction'));
    expect(r).toMatchObject({ rows: [], structure: true, empty: false });
    expect(r.problem).toMatch(/filled by a script/);
  });
  it('html-table: a server-rendered "no open solicitations" row is an empty list', () => {
    const html = '<table><tr><th>Bid #</th><th>Title</th><th>Due Date</th></tr><tr><td colspan="3">There are currently no open solicitations.</td></tr></table>';
    expect(parseHtmlTable(html, ds('bids-pw-houston-isd'))).toMatchObject({ rows: [], structure: true, empty: true });
  });
  it('html-table: a table with no title column is a mismatch with the headers named', () => {
    const r = parseHtmlTable(fx('mismatch-table.html'), ds('bids-pw-houston-isd'));
    expect(r.rows).toEqual([]);
    expect(r.structure).toBe(true);
    expect(r.empty).toBe(false);
    expect(r.problem).toMatch(/no table has a title column \(headers seen: foo\/bar\)/);
    // A header-less table: only its shape is printed, never a cell.
    const r2 = parseHtmlTable('<table><tr><td>RFP 123</td><td>Jane Buyerson</td><td>713-555-0100</td></tr></table>', ds('bids-pw-houston-isd'));
    expect(r2.problem).toBe('no table has a title column (3 columns, 0 rows, no header row)');
  });
  it('html-table (Chicago): agency, category, spec number and response due date', () => {
    const r = parseHtmlTable(fx('chicago.html'), ds('bids-pw-chicago'));
    expect(r.rows).toHaveLength(4);
    expect(r.rows[1]).toMatchObject({ agency: 'CTA', number: 'B26OP03708', category: 'Commodities', due: '12/18/2026', link: '/vcsearch/cta/solicitationdetails/B26OP03708' });
  });
  it('html-table (LA County): number split from the Name cell, Close is due, Open is posted', () => {
    const r = parseHtmlTable(fx('lacounty.html'), ds('bids-pw-lacounty-dpw'));
    expect(r.rows[0]).toMatchObject({ number: 'RDC0016342', title: 'South Whittier Community Bikeway Access Improvements (Addendum Count: 1)', posted: '11/3/2026', due: '12/8/2026', category: 'Bikeway' });
    expect(r.rows[2]).toMatchObject({ number: 'RMD1402001', link: undefined });
  });
  it('html-links (Atlanta Housing): numbered links only; mail and terms links ignored', () => {
    const r = parseHtmlLinks(fx('atlanta-housing.html'), ds('bids-pw-atlanta-housing'));
    expect(r.rows.map((x) => x.number)).toEqual(['RFP 2027-0052', 'RFQL 2027-0045', 'RFQL 2027-0045', 'IFB 2027-0061', 'IFB 2027-0062']);
    expect(r.rows.every((x) => !x.feedOnly)).toBe(true);
    expect(r.rows[3]).toMatchObject({ title: 'Unit Turn Painting and Flooring Services', link: '/wp-content/uploads/2026/11/IFB-2027-0061.pdf' });
  });
  it('html-links (SEPTA): item numbers, the EOI line without a number is left out', () => {
    const r = parseHtmlLinks(fx('septa.html'), ds('bids-pw-septa'));
    expect(r.rows.map((x) => x.number)).toEqual(['26-00299-ATWP', '26-00305-AXJC', '26-00260-ADMC']);
  });
  it('text-blocks (Decatur Housing): title on the next line or the same line, due date from the due/deadline wording', () => {
    const r = parseTextBlocks(fx('decatur.html'), ds('bids-pw-decatur-housing'));
    expect(r.rows).toEqual([
      expect.objectContaining({ number: 'RFP-GA-011-2026-05', title: 'Carpet Cleaning - RE-BID', due: 'December 10, 2026' }),
      expect.objectContaining({ number: 'RFP-GA-011-2026-01', title: 'ENTERPRISE HOUSING MANAGEMENT AND FINANCIAL SOFTWARE SOLUTION', due: 'October 2, 2026' }),
      expect.objectContaining({ number: 'RFP-GA-011-2026-07', title: 'Landscaping and Grounds Maintenance', due: 'January 15, 2027 at 3:00 p.m.' }),
    ]);
    noPeople(r.rows);
  });
  it('rss: items with the due date from the description; the contact line is not a field', () => {
    const r = parseRss(fx('feed.xml'), { ...ds('bids-pw-chicago'), numberPattern: '(?:IFB|RFP)-\\d{2}-\\d{3}' });
    expect(r.rows[0]).toMatchObject({ number: 'IFB-26-114', title: 'Fire Station Roof Replacement', due: 'December 9, 2026 at 2:00 PM.', link: 'https://example-city.gov/bids/26-114', category: 'Construction' });
    noPeople(r.rows.map(({ title, number, due, link }) => ({ title, number, due, link })));
  });
  it('csv: header words, buyer name and e-mail columns never read, link column kept', () => {
    const r = parseCsv(fx('bids.csv'), ds('bids-pw-chicago'));
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ number: '26-201', title: 'Janitorial Services, City Hall', due: '12/14/2026 2:00 PM', category: 'Services', link: 'https://example-city.gov/bids/26-201' });
    noPeople(r.rows);
  });
});

describe('row validation (rowsToSignals)', () => {
  it('Bonfire rows: open and past-due split, parts purchase dropped, awarded dropped, title "Bid: <title> (<agency>)"', () => {
    const d = ds('bids-pw-dart');
    const { items, counts } = rowsToSignals(parseBonfire(JSON.parse(fx('bonfire-open.json')), d).rows, d, NOW);
    expect(counts).toMatchObject({ read: 6, kept: 3, closed: 1, notOpen: 1, noTrade: 2 });
    expect(items.map((s) => s.title)).toEqual([
      'Bid: Roof Replacement at Kashmere Bus Operating Facility (Facilities Maintenance)',
      'Bid: Janitorial Services for Administrative Buildings (Dallas Area Rapid Transit (DART))',
      'Bid: Landscape Maintenance of Transit Centers (Dallas Area Rapid Transit (DART))',
    ]);
    // Awarded: kept for the feed only, never urgent.
    expect(items[2].data).toMatchObject({ statusClass: 'closed', proposedLabel: 'context' });
    const roof = items[0];
    expect(roof).toMatchObject({ source: 'bids-pw-dart', kind: 'contract', categories: ['roofing'], expiresAt: '2026-12-10T20:00:00.000Z', url: 'https://dart.bonfirehub.com/opportunities/149219', state: 'TX', zip: '75202' });
    expect(roof.data).toMatchObject({ subtype: 'bid', solicitationId: 'IFB 2027000041', dueDate: '2026-12-10', loc: 'approx', approxLocation: true, via: 'page-watch', statusClass: 'open', proposedLabel: 'act_now' });
    // Janitorial bid due tomorrow: under 3 days, heads-up.
    expect(items[1].data?.proposedLabel).toBe('coming_soon');
  });
  it('a link off the agency domains falls back to the public list page; a person named in a title is cut', () => {
    const d = ds('bids-pw-houston-metro');
    const { items } = rowsToSignals(parseHtmlTable(fx('metro-table.html'), d).rows, d, NOW);
    const sw = items.find((s) => /Switchgear/.test(s.title))!;
    expect(sw.url).toBe(d.pageUrl);
    expect(sw.data?.linkKind).toBe('list');
    const paint = items.find((s) => /Repaint/.test(s.title))!;
    expect(paint.title).toBe('Bid: Repaint HOV Diamond Bus Lanes & Striping. (Houston METRO)');
    expect(paint.categories).toEqual(expect.arrayContaining(['painting', 'concrete-paving']));
    noPeople(items);
  });
  it('Philadelphia SD: the past bid-tab row is dropped, the cancelled one is feed-only, an empty status cell is never urgent; no buyer name', () => {
    const d = ds('bids-pw-philasd-capital');
    const { items, counts } = rowsToSignals(parseHtmlTable(fx('philasd-capital.html'), d).rows, d, NOW);
    expect(counts).toMatchObject({ closed: 1, notOpen: 1 });
    expect(items.map((s) => [s.title, s.data?.proposedLabel])).toEqual([
      ['Bid: Kitchen Ventilation Upgrade at Thomas Alva Edison High School MC (Capital Programs)', 'coming_soon'],
      ['Bid: Bathroom Renovations at George W. Childs School EC (Capital Programs)', 'coming_soon'],
      ['Bid: Roof Replacement at Lincoln HS (Capital Programs)', 'context'],
    ]);
    expect(items[0].categories).toEqual(['hvac']);
    expect(items[1].categories).toEqual(['general-contractor']);
    expect(items[0].url).toBe('https://philasd.org/procurement/wp-content/uploads/sites/93/2026/11/NG10901.pdf');
    noPeople(items);
  });
  it('Chicago: stale "active" rows dropped by their due date; the Construction category alone names no trade; CTA named in full; ACTIVE is open', () => {
    const d = ds('bids-pw-chicago');
    const { items, counts } = rowsToSignals(parseHtmlTable(fx('chicago.html'), d).rows, d, NOW);
    expect(counts).toMatchObject({ read: 4, closed: 1, noTrade: 2, kept: 1 });
    expect(items[0]).toMatchObject({ title: 'Bid: Station Janitorial Services, North Branch (Chicago Transit Authority)', url: 'https://webapps1.chicago.gov/vcsearch/cta/solicitationdetails/C26FI101' });
    expect(items[0].data).toMatchObject({ statusClass: 'open', proposedLabel: 'act_now' });
  });
  it('Atlanta Housing: no due dates (heads-up), addendum folded into its solicitation, consulting dropped', () => {
    const d = ds('bids-pw-atlanta-housing');
    const { items, counts } = rowsToSignals(parseHtmlLinks(fx('atlanta-housing.html'), d).rows, d, NOW);
    expect(items.map((s) => s.title)).toEqual(['Bid: Unit Turn Painting and Flooring Services (Atlanta Housing)', 'Bid: Landscape and Grounds Maintenance (Atlanta Housing)']);
    expect(counts.noDue).toBe(2);
    expect(items.every((s) => s.expiresAt === null && s.data?.noDueDate === true && s.data?.proposedLabel === 'coming_soon')).toBe(true);
    expect(items[0].url).toBe('https://www.atlantahousing.org/wp-content/uploads/2026/11/IFB-2027-0061.pdf');
  });
  it('SEPTA: the four-w host is repaired to www; demolition is general-contractor work; laptops dropped', () => {
    const d = ds('bids-pw-septa');
    const { items } = rowsToSignals(parseHtmlLinks(fx('septa.html'), d).rows, d, NOW);
    expect(items.map((s) => s.url)).toEqual(['https://www.septa.org/procurement/bids/janitorial-landscaping/', 'https://www.septa.org/procurement/bids/front-street-demo/']);
    expect(items[1].categories).toEqual(['general-contractor']);
  });
  it('Decatur: software and past-due rows dropped; local due day kept', () => {
    const d = ds('bids-pw-decatur-housing');
    const { items } = rowsToSignals(parseTextBlocks(fx('decatur.html'), d).rows, d, NOW);
    expect(items.map((s) => [s.title, s.data?.dueDate])).toEqual([
      ['Bid: Carpet Cleaning - RE-BID (Decatur Housing Authority)', '2026-12-10'],
      ['Bid: Landscaping and Grounds Maintenance (Decatur Housing Authority)', '2027-01-15'],
    ]);
    noPeople(items);
  });
});

describe('helpers', () => {
  it('dates: two-digit years, written months, Bonfire UTC wall time, a date inside a sentence', () => {
    expect(parseDateText('08/31/23 2:00 pm', 'America/Chicago')).toBe('2023-08-31T19:00:00.000Z');
    expect(parseDateText('Dec 10, 2026 2:00 PM', 'America/Chicago')).toBe('2026-12-10T20:00:00.000Z');
    expect(parseDateText('2026-12-10 20:00:00', 'UTC')).toBe('2026-12-10T20:00:00.000Z');
    expect(parseDateText('Proposal due: 12/10/2026', 'America/New_York')).toBe('2026-12-11T04:59:00.000Z');
    expect(parseDateText('Open until filled', 'America/New_York')).toBeNull();
  });
  it('titles: e-mail, phone, "Contact:" tail, number prefix and addendum removed', () => {
    expect(cleanBidTitle('IFB 12 - Roof Repair Contact: Jane Doe 404-555-0100', 'IFB 12')).toBe('Roof Repair');
    expect(cleanBidTitle('Mowing (call 404-555-0100 or x@y.org)')).toBe('Mowing');
    expect(cleanBidTitle('Fence Install ADDENDUM #2')).toBe('Fence Install');
  });
  it('trades: the shared bid table plus general-contractor work, under the same purchase and paper guards', () => {
    expect(pageWatchTrades({ title: 'Audelia Manor Interior Remodel' })).toEqual(['general-contractor']);
    expect(pageWatchTrades({ title: 'Roof Replacement and Renovation' })).toEqual(['roofing', 'general-contractor']);
    expect(pageWatchTrades({ title: 'Renovation Design Services' })).toEqual([]);
    expect(pageWatchTrades({ title: 'Lead Service Line Replacement', category: 'Construction' })).toEqual([]);
    expect(pageWatchTrades({ title: 'Website Remodel and Hosting' })).toEqual([]);
    expect(pageWatchTrades({ title: 'New Construction Loan Servicing' })).toEqual([]);
    expect(pageWatchTrades({ title: 'Demolition Equipment Purchase' })).toEqual([]);
  });
  it('proposed label: urgent at 3 days or more, heads-up sooner or with no due date', () => {
    expect(proposedPageWatchLabel('2026-11-25T17:00:00Z', NOW)).toBe('act_now');
    expect(proposedPageWatchLabel('2026-11-25T16:59:00Z', NOW)).toBe('coming_soon');
    expect(proposedPageWatchLabel(null, NOW)).toBe('coming_soon');
    expect(proposedPageWatchLabel('2026-12-25T17:00:00Z', NOW, { status: 'open' })).toBe('act_now');
    expect(proposedPageWatchLabel('2026-12-25T17:00:00Z', NOW, { status: 'empty' })).toBe('coming_soon');
    expect(proposedPageWatchLabel('2026-12-25T17:00:00Z', NOW, { status: 'other' })).toBe('coming_soon');
    expect(proposedPageWatchLabel('2026-12-25T17:00:00Z', NOW, { status: 'closed' })).toBe('context');
    expect(proposedPageWatchLabel('2026-12-25T17:00:00Z', NOW, { feedOnly: true })).toBe('context');
  });
  it('every dataset: ids start with bids-pw-, on probation, schema unverified, link domains cover the page, a ZIP the dataset knows', () => {
    for (const d of PAGE_WATCH_DATASETS) {
      expect(d.id).toMatch(/^bids-pw-[a-z0-9-]+$/);
      expect(d.probation).toBe(true);
      expect(d.schemaUnverified).toBe(true);
      expect(d.termsChecked, d.id).toBe(false);
      const host = new URL(d.pageUrl).hostname.replace(/^www\./, '');
      expect(d.linkDomains.some((x) => host === x || host.endsWith(`.${x}`)), d.id).toBe(true);
      expect(rowsToSignals([{ title: 'Roof Replacement', due: '12/30/2026' }], d, NOW).items, d.id).toHaveLength(1);
    }
  });
});
