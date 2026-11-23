import { beforeEach, describe, expect, it } from 'vitest';
import { cleanBidTitle, pageWatchLogLines, pageWatchTrades, parseDateText, PW_PARSE_MS, runPageWatch } from '@/lib/signals/adapters/page-watch';
import { resetRobotsCache } from '@/lib/firecrawl/robots';
import { sanitizeHealthError } from '@/lib/signals/health';
import { cleared, SWITCH_ON } from './helpers';

/**
 * Round 20 independent review of WATCH (gates/r20/review/review-WATCH.md): each attack the reviewer ran, as a regression test. The pages
 * are hand-written, after the reviewer's probes (gates/r20/review/WATCH-probes/parse.probe.ts, perf.probe.ts).
 */

const NOW = new Date('2026-11-22T17:00:00Z');
const page = (html: string, type = 'text/html') =>
  (async (u: string) => (String(u).endsWith('/robots.txt') ? new Response('User-agent: *\nAllow: /') : new Response(html, { status: 200, headers: { 'content-type': type } }))) as unknown as typeof fetch;
const run = (id: string, body: string, type?: string, over: { parseMs?: number } = {}) => runPageWatch(cleared(id), { fetch: page(body, type), now: NOW, probe: true, env: SWITCH_ON, ...over });
const labels = (r: Awaited<ReturnType<typeof run>>) => r.kept.map((s) => [s.title, (s.data as Record<string, unknown>).proposedLabel]);
const table = (rows: string, head = '<th>Bid #</th><th>Description</th><th>Due Date</th>') => `<html><body><table><tr>${head}</tr>${rows}</table></body></html>`;
const PEOPLE = /\b(?:john|smith|jane|doe|mary|jones|bob lee|pat morgan|maria|lopez|tom brown|ann white)\b|555|@|agency\.gov/i;

beforeEach(() => resetRobotsCache());

describe('P1-2 urgency is an allow list', () => {
  it('closed, awarded and cancelled words in the title make a row feed-only, never urgent', async () => {
    const r = await run('bids-pw-dallas-isd', table('<tr><td>B-101</td><td>AWARDED - Roof Replacement at Lincoln HS</td><td>12/20/2026</td></tr><tr><td>B-102</td><td>Roof Repair at Adams ES (CLOSED)</td><td>12/21/2026</td></tr><tr><td>B-103</td><td>HVAC Replacement - Bid Closed, under evaluation</td><td>12/22/2026</td></tr><tr><td>B-104</td><td>CANCELLED: Plumbing Repairs</td><td>12/23/2026</td></tr>'));
    expect(r.kept).toHaveLength(4);
    for (const [, l] of labels(r)) expect(l).toBe('context');
  });
  it('a status column named Stage is read; Awarded and Closed are feed-only', async () => {
    const r = await run('bids-pw-dallas-isd', table('<tr><td>B-201</td><td>Roof Replacement at Lincoln HS</td><td>12/20/2026</td><td>Awarded</td></tr><tr><td>B-202</td><td>Painting of Gym</td><td>12/20/2026</td><td>Closed</td></tr>', '<th>Bid #</th><th>Description</th><th>Due Date</th><th>Stage</th>'));
    expect(labels(r).map((x) => x[1])).toEqual(['context', 'context']);
  });
  it('Evaluation, Pending Board Approval, Under Review, Complete, Not Awarded, Award Pending, Opened: feed-only; only "Open" is urgent', async () => {
    const statuses = ['Evaluation', 'Pending Board Approval', 'Under Review', 'Complete', 'Not Awarded', 'Award Pending', 'Opened', 'Open'];
    const r = await run('bids-pw-dallas-isd', table(statuses.map((s, i) => `<tr><td>B-30${i}</td><td>Roof Replacement School ${i}</td><td>12/2${i}/2026</td><td>${s}</td></tr>`).join(''), '<th>Bid #</th><th>Description</th><th>Due Date</th><th>Status</th>'));
    expect(labels(r).map((x) => x[1])).toEqual(['context', 'context', 'context', 'context', 'context', 'context', 'context', 'act_now']);
  });
  it('a status that is neither open nor closed is a heads-up at most, and counted', async () => {
    const r = await run('bids-pw-dallas-isd', table('<tr><td>B-1</td><td>Roof Replacement</td><td>12/20/2026</td><td>Small Order</td></tr>', '<th>Bid #</th><th>Description</th><th>Due Date</th><th>Status</th>'));
    expect(labels(r)).toEqual([['Bid: Roof Replacement (Dallas ISD)', 'coming_soon']]);
    expect(r.counts.unknownStatus).toBe(1);
  });
  it('Bonfire Evaluation and Pending Selection with a future close date: feed-only', async () => {
    const body = JSON.stringify({ success: 1, payload: { projects: [{ ProjectID: 5, ReferenceID: 'BN-5', ProjectName: 'Plumbing Repairs', DateClose: '2026-12-10 20:00:00', ProjectStatus: 'Evaluation' }, { ProjectID: 6, ReferenceID: 'BN-6', ProjectName: 'Fence installation', DateClose: '2026-12-10 20:00:00', ProjectStatus: 'Pending Selection' }] } });
    const r = await run('bids-pw-dart', body, 'application/json');
    expect(labels(r).map((x) => x[1])).toEqual(['context', 'context']);
  });
});

describe('P1-3 finished lists are never read as open', () => {
  const open = `<h2>Open Solicitations</h2><table><tr><th>Solicitation Number</th><th>Title</th><th>Close Date</th></tr><tr><td>IFB 2027000041</td><td>Roof Replacement at Kashmere</td><td>Dec 10, 2026 2:00 PM</td></tr><tr><td>IFB 2027000042</td><td>Janitorial Services North</td><td>Dec 12, 2026 2:00 PM</td></tr></table>`;
  const awarded = `<h2>Awarded Solicitations</h2><table><tr><th>Solicitation Number</th><th>Title</th><th>Awarded Vendor</th><th>Award Date</th></tr>${[1, 2, 3, 4, 5].map((i) => `<tr><td>IFB 202600010${i}</td><td>HVAC Replacement Building ${i}</td><td>Acme Mechanical LLC</td><td>10/0${i}/2026</td></tr>`).join('')}</table>`;
  const closed = `<h2>Closed Solicitations</h2><table><tr><th>Solicitation Number</th><th>Title</th><th>Close Date</th></tr>${[1, 2, 3, 4, 5].map((i) => `<tr><td>IFB 202600010${i}</td><td>HVAC Replacement Building ${i}</td><td>Oct ${i}, 2026 2:00 PM</td></tr>`).join('')}</table>`;
  it.each([
    ['an awarded archive', awarded],
    ['a closed archive', closed],
  ])('an open table beside %s: the two open bids are read, the archive is not', async (_n, archive) => {
    for (const id of ['bids-pw-houston-metro', 'bids-pw-dallas-isd']) {
      resetRobotsCache();
      const r = await run(id, `<html><body>${open}${archive}</body></html>`);
      expect(r.kept.map((s) => s.title.replace(/ \(.*\)$/, '')), id).toEqual(['Bid: Roof Replacement at Kashmere', 'Bid: Janitorial Services North']);
    }
  });
  it('only an archive on the page: parser_mismatch naming it, nothing stored', async () => {
    const r = await run('bids-pw-dallas-isd', `<html><body>${awarded}</body></html>`);
    expect(r.check).toBe('parser_mismatch');
    expect(r.detail).toMatch(/only finished lists/);
  });
  it('Atlanta Housing: only the open list is read; a page without it is read whole and every row is feed-only', async () => {
    const h = `<html><body><h2>Open Solicitations</h2><ul><li><a href="/s/1">RFP 2027-0052 Landscaping Services for Senior Highrises</a></li></ul>
<h2>Closed Solicitations</h2><ul><li><a href="/s/2">RFP 2026-0011 Roof Replacement at Cosby Spear</a></li><li><a href="/s/3">IFB 2026-0019 Janitorial Services (AWARDED)</a></li><li><a href="/s/4">RFQ 2025-0007 Painting Services - Notice of Award</a></li></ul>
<h2>Plans</h2><ul><li><a href="/p/1">2025-2026 Landscaping and Grounds Annual Plan</a></li></ul></body></html>`;
    const r = await run('bids-pw-atlanta-housing', h);
    expect(r.kept.map((s) => s.title)).toEqual(['Bid: Landscaping Services for Senior Highrises (Atlanta Housing)']);
    resetRobotsCache();
    const whole = await run('bids-pw-atlanta-housing', h.replace('Open Solicitations', 'Current List'));
    expect(whole.kept.length).toBeGreaterThan(1);
    for (const [, l] of labels(whole)) expect(l).toBe('context');
    expect(whole.kept.some((s) => /Annual Plan/.test(s.title))).toBe(false);
    expect(pageWatchLogLines(cleared('bids-pw-atlanta-housing'), whole)).toContain('bids-pw-atlanta-housing: listing area not found: rows read from the whole page are feed-only');
  });
  it('unreadable due dates drop the row (counted); every row unreadable is parser_mismatch; more written forms are read', async () => {
    const r = await run('bids-pw-dallas-isd', table('<tr><td>B-401</td><td>Roof Replacement at Lincoln HS</td><td>01-Nov-2026</td></tr><tr><td>B-402</td><td>Janitorial Services</td><td>10-01-2026</td></tr><tr><td>B-403</td><td>Parking lot paving</td><td>12-30-2026</td></tr><tr><td>B-404</td><td>Fence repair</td><td>sometime 99</td></tr>'));
    expect(r.counts).toMatchObject({ read: 4, closed: 2, badDue: 1, kept: 1 });
    resetRobotsCache();
    const all = await run('bids-pw-dallas-isd', table('<tr><td>B-1</td><td>Roof Replacement</td><td>99/99/9999</td></tr>'));
    expect(all.check).toBe('parser_mismatch');
    expect(parseDateText('10-Dec-2026', 'America/Chicago')).toBe('2026-12-11T05:59:00.000Z');
    expect(parseDateText('10 December 2026', 'America/Chicago')).toBe('2026-12-11T05:59:00.000Z');
    expect(parseDateText('12-10-2026', 'America/Chicago')).toBe('2026-12-11T05:59:00.000Z');
    expect(parseDateText('11/20/2026 extended to 12/15/2026', 'America/Chicago')).toBe('2026-12-16T05:59:00.000Z');
  });
});

describe('P1-4 no person in a title, summary, data field, log or probe', () => {
  it.each([
    ['HVAC Replacement - Contact John Smith at 555-0100', 'HVAC Replacement'],
    ['Roof repair (John Smith, 713-555-0100)', 'Roof repair'],
    ['Roofing Services c/o Jane Doe jane.doe@agency.gov', 'Roofing Services'],
    ['Janitorial Services - Questions: Mary Jones 404.555.0100 ext 12', 'Janitorial Services'],
    ['Plumbing Repairs; Project Manager Bob Lee (bob.lee at city dot gov)', 'Plumbing Repairs'],
    ['Carpet cleaning questions to Pat Morgan, pmorgan@decaturhousing.org', 'Carpet cleaning'],
    ['Painting - call Maria Lopez 5550100', 'Painting'],
    ['Fence Installation; Buyer - Tom Brown', 'Fence Installation'],
    ['Tree trimming | POC: Ann White +1 (713) 555 0142', 'Tree trimming'],
    ['Roof Replacement Contact: Sam', 'Roof Replacement'],
    ['Landscaping at the John F. Kennedy School', 'Landscaping at the John F. Kennedy School'],
    ['Kitchen Ventilation Upgrade at Thomas Alva Edison High School MC', 'Kitchen Ventilation Upgrade at Thomas Alva Edison High School MC'],
    ['Call Center Janitorial Services', 'Call Center Janitorial Services'],
  ])('title "%s" -> "%s"', (raw, want) => {
    expect(cleanBidTitle(raw)).toBe(want);
  });
  it('a row with a name in the title AND the department cell: title, summary and buyer carry none of it', async () => {
    const r = await run('bids-pw-dallas-isd', `<html><body><table><tr><th>Bid #</th><th>Description</th><th>Department</th><th>Due Date</th><th>Requested By</th></tr>
<tr><td>B-801</td><td>HVAC Replacement - Contact John Smith at 555-0100</td><td>Jane Doe - Facilities (713) 555-0142</td><td>12/20/2026</td><td>Bob Lee</td></tr></table></body></html>`);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].title).toBe('Bid: HVAC Replacement (Facilities)');
    expect(JSON.stringify(r.kept)).not.toMatch(PEOPLE);
  });
  it('a department cell that is only a person falls back to the agency', async () => {
    const r = await run('bids-pw-dallas-isd', table('<tr><td>B-1</td><td>Roof Replacement</td><td>John Smith</td><td>12/20/2026</td></tr>', '<th>Bid #</th><th>Description</th><th>Department</th><th>Due Date</th>'));
    expect(r.kept[0].title).toBe('Bid: Roof Replacement (Dallas ISD)');
  });
  it('a title with an honorific (a private residence) drops the row', async () => {
    const r = await run('bids-pw-dallas-isd', table('<tr><td>B-1</td><td>Paving for Mr. David Chen residence at 12 Oak St</td><td>12/20/2026</td></tr><tr><td>B-2</td><td>Parking Lot Paving</td><td>12/20/2026</td></tr>'));
    expect(r.counts.personText).toBe(1);
    expect(JSON.stringify(r.kept)).not.toMatch(/chen|oak st/i);
  });
  it('a header-less table: the log line and the detail give its shape only, never a cell', async () => {
    const headless = '<html><body><table><tr><td>RFP 123</td><td>John Smith</td><td>713-555-0100</td><td>jsmith@agency.gov</td></tr><tr><td>RFP 124</td><td>Mary Jones</td><td>713-555-0101</td><td>mjones@agency.gov</td></tr></table></body></html>';
    const r = await run('bids-pw-houston-isd', headless);
    expect(r.check).toBe('parser_mismatch');
    const line = pageWatchLogLines(cleared('bids-pw-houston-isd'), r)[0];
    expect(line).toBe('error: bids-pw-houston-isd: parser_mismatch (no table has a title column (4 columns, 1 rows, no header row))');
    expect(sanitizeHealthError(line)).not.toMatch(PEOPLE);
  });
  it('text blocks: a prose line after the number is never taken as the title', async () => {
    const r = await run('bids-pw-decatur-housing', '<html><body><article><h1>Procurements Page</h1><p><strong>RFP-GA-011-2026-05</strong></p><p>Carpet cleaning questions to Pat Morgan, pmorgan@decaturhousing.org or 404-555-0100</p><p>Due December 10, 2026</p></article></body></html>');
    expect(r.kept).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(PEOPLE);
  });
  it('a person column under a "lead" or "coordinator" header is never read as a title', async () => {
    const r = await run('bids-pw-aps', '<html><body><table><tr><th>Bid #</th><th>Project</th><th>Project Lead</th><th>Due</th></tr><tr><td>B-9</td><td>Roof repair</td><td>Sam Park</td><td>12/20/2026</td></tr></table><table><tr><th>No.</th><th>Coordinator Name</th><th>Closing</th></tr><tr><td>77</td><td>Roofing Ray Romano</td><td>12/20/2026</td></tr></table></body></html>');
    expect(r.kept.map((s) => s.title)).toEqual(['Bid: Roof repair (Atlanta Public Schools)']);
    expect(JSON.stringify(r.kept)).not.toMatch(/sam park|romano/i);
  });
  it('a Bonfire name holding a buyer and a phone', async () => {
    const r = await run('bids-pw-dart', JSON.stringify({ success: 1, payload: { projects: [{ ProjectID: 7, ReferenceID: 'BN-7', ProjectName: 'Roof Replacement - Buyer John Smith 214-555-0100', DateClose: '2026-12-22 15:00:00', ProjectStatus: 'Open' }] } }), 'application/json');
    expect(r.kept[0].title).toBe('Bid: Roof Replacement (Dallas Area Rapid Transit (DART))');
  });
});

describe('P1-5 Bonfire with assumed field names fails as parser_mismatch', () => {
  const mk = (projects: unknown) => JSON.stringify({ success: 1, payload: { projects } });
  it.each([
    ['the close date under another key', mk({ '1': { ProjectID: '1', ReferenceID: 'BN-1', ProjectName: 'Roof Replacement at City Hall', EndDate: '2026-10-01 20:00:00', ProjectStatus: 'Open' } }), /close date field not found/],
    ['the close date as epoch seconds', mk([{ ProjectID: 3, ReferenceID: 'BN-3', ProjectName: 'HVAC Replacement', DateClose: 1796932800, ProjectStatus: 'Open' }]), /not a date/],
    ['no status key (a past list)', mk([{ ProjectID: 9, ReferenceID: 'BN-9', ProjectName: 'Roof Replacement (2019)', DateClose: '2026-12-10 20:00:00' }]), /status field not found/],
    ['an object of scalars', JSON.stringify({ success: 1, data: { count: 0, message: 'x' } }), /no project objects/],
  ])('%s', async (_n, body, problem) => {
    const r = await run('bids-pw-dart', body, 'application/json');
    expect(r.check).toBe('parser_mismatch');
    expect(r.detail).toMatch(problem);
    expect(r.kept).toEqual([]);
  });
  it('an empty projects list is an empty listing', async () => {
    expect((await run('bids-pw-dart', mk({}), 'application/json')).check).toBe('empty');
  });
});

describe('P2-4 the general-contractor rule is narrow', () => {
  it.each([
    ['Bathroom Renovations at Childs School', null, ['general-contractor']],
    ['Demolition of 2728 S. Front Street', null, ['general-contractor']],
    ['Website Remodel and Hosting', null, []],
    ['New Construction Loan Servicing', null, []],
    ['Tenant Improvements Legal Counsel', null, []],
    ['Remodeling of Compensation Structure Study', null, []],
    ['Demolition Asbestos Abatement Survey', null, []],
    ['Job Order Contracting Program Management Consultant', null, []],
    ['Annual Financial Audit', 'Construction', []],
    ['Term Agreement for Lead Service Line Replacement', 'Construction', []],
  ])('"%s" [%s] -> %j', (title, category, want) => {
    expect(pageWatchTrades({ title, category })).toEqual(want);
  });
});

describe('P2-5 parsing is linear and time-capped', () => {
  it.each([
    ['20,000 unclosed comments', '<html><body>' + '<!-- x '.repeat(20_000) + '<table><tr><th>Title</th></tr></table></body></html>'],
    ['20,000 unclosed links', '<html><body>' + '<a href="/x">x '.repeat(20_000) + '</body></html>'],
    ['3,000 unclosed scripts', '<html><body>' + '<script>var a=1;'.repeat(3_000) + '</body></html>'],
    ['a 1 MB table', `<html><body><table><tr><th>Bid #</th><th>Title</th><th>Due Date</th></tr>${'<tr><td>B-1</td><td>Roof Repair</td><td>12/20/2026</td></tr>'.repeat(17_000)}</table></body></html>`],
  ])('%s: answered within the parse limit', async (_n, body) => {
    const t0 = performance.now();
    const r = await run('bids-pw-houston-isd', body);
    expect(performance.now() - t0).toBeLessThan(PW_PARSE_MS + 3000);
    expect(['ok', 'row_cap', 'parser_mismatch', 'parse_timeout', 'empty']).toContain(r.check);
  });
  it('a parse past the limit is recorded as parse_timeout (an error the owner sees)', async () => {
    const body = `<html><body><table><tr><th>Bid #</th><th>Title</th><th>Due Date</th></tr>${'<tr><td>B-1</td><td>Roof Repair</td><td>12/20/2026</td></tr>'.repeat(5_000)}</table></body></html>`;
    const r = await run('bids-pw-houston-isd', body, undefined, { parseMs: 1 });
    expect(r.check).toBe('parse_timeout');
    expect(pageWatchLogLines(cleared('bids-pw-houston-isd'), r)[0]).toMatch(/^error: bids-pw-houston-isd: parse_timeout/);
  });
});

describe('P2-2 redirects', () => {
  const redirecting = (loc: string, target = '<html><body><table><tr><th>Bid #</th><th>Title</th><th>Due Date</th></tr><tr><td>B-1</td><td>Roof Repair</td><td>12/20/2026</td></tr></table></body></html>', robots: Record<string, string> = {}) => {
    const calls: string[] = [];
    const f = (async (u: string) => {
      calls.push(String(u));
      if (String(u).endsWith('/robots.txt')) return new Response(robots[new URL(String(u)).host] ?? 'User-agent: *\nAllow: /');
      if (String(u) === 'https://www.houstonisd.org/Page/179249') return new Response(null, { status: 301, headers: { location: loc } });
      return new Response(target, { headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    return { f, calls };
  };
  it('to another host: not followed', async () => {
    const { f, calls } = redirecting('https://evil.example.com/bids');
    const r = await runPageWatch(cleared('bids-pw-houston-isd'), { fetch: f, now: NOW, probe: true, env: SWITCH_ON });
    expect(r).toMatchObject({ check: 'http_error', detail: 'redirect to evil.example.com: not followed' });
    expect(calls).not.toContain('https://evil.example.com/bids');
  });
  it('to a subdomain of the agency: followed after that host\'s robots.txt allows it; refused when it disallows', async () => {
    const ok = redirecting('https://bids.houstonisd.org/open');
    const r = await runPageWatch(cleared('bids-pw-houston-isd'), { fetch: ok.f, now: NOW, probe: true, env: SWITCH_ON });
    expect(r.check).toBe('ok');
    expect(ok.calls).toContain('https://bids.houstonisd.org/robots.txt');
    resetRobotsCache();
    const no = redirecting('https://bids.houstonisd.org/open', undefined, { 'bids.houstonisd.org': 'User-agent: *\nDisallow: /open\n' });
    const r2 = await runPageWatch(cleared('bids-pw-houston-isd'), { fetch: no.f, now: NOW, probe: true, env: SWITCH_ON });
    expect(r2.check).toBe('robots_disallowed');
    expect(no.calls).not.toContain('https://bids.houstonisd.org/open');
  });
});

describe('Crawl-delay on a page-watch source', () => {
  it('a second read of the same host inside its Crawl-delay is skipped (not an error)', async () => {
    const f = (async (u: string) => (String(u).endsWith('/robots.txt') ? new Response('User-agent: *\nCrawl-delay: 30\n') : new Response(table('<tr><td>B-1</td><td>Roof Repair</td><td>12/20/2026</td></tr>'), { headers: { 'content-type': 'text/html' } }))) as unknown as typeof fetch;
    const d = cleared('bids-pw-houston-isd');
    expect((await runPageWatch(d, { fetch: f, now: NOW, probe: true, env: SWITCH_ON })).check).toBe('ok');
    const second = await runPageWatch(d, { fetch: f, now: NOW, probe: true, env: SWITCH_ON });
    expect(second.check).toBe('crawl_delay');
    expect(pageWatchLogLines(d, second)[0]).toMatch(/^bids-pw-houston-isd: skipped, Crawl-delay 30 s not met/);
  });
});
