/**
 * Round 15 Unit G, PLAN-2.0 1.3: "Job value on the permit: $X" on the three card surfaces (web feed, e-mail digest, mobile alert), and the pure
 * read-path helpers that work on a STORED row (data.jobValue when present, else the "$N job value" part of the public summary).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';

vi.mock('server-only', () => ({}));
vi.mock('@/app/app/actions', () => ({
  setMatchStatus: async () => ({ ok: true }),
  getRequestReplyStates: async () => ({}),
  submitFeedback: async () => ({ ok: true }),
}));

import { Feed } from '@/components/feed';
import { renderDigest } from '@/lib/email/templates';
import { buildAlerts } from '@/lib/mobile/feed';
import { cardBrief } from '@/lib/signals/brief';
import { VALUE_SELECT, firstMoney, formatMoney, jobValueLine, jobValueOf, parseMoney, siteAddressFromSummary, MAX_JOB_VALUE, MIN_JOB_VALUE } from '@/lib/signals/permit-value';
import { outreachPlan } from '@/lib/outreach/plan';
import { BANNED } from './banned';
import { FIXTURES, NOW, digestItem, feedItem, mobileRow } from './brief-fixtures';

const permit = FIXTURES.find((c) => c.name === 'own-trade permit')!;
const storm = FIXTURES.find((c) => c.name === 'hail report')!;
const LINE = 'Job value on the permit: $14,500';

describe('parseMoney / firstMoney / formatMoney', () => {
  it.each([
    [12500, 12500],
    ['12500', 12500],
    ['12,500.00', 12500],
    ['$12,500', 12500],
    [' $ 12 500 ', 12500],
    ['18500.4', 18500],
    [MIN_JOB_VALUE, MIN_JOB_VALUE],
    [MAX_JOB_VALUE, MAX_JOB_VALUE],
    ['$499,999,999', 499999999],
  ])('reads %j as %s', (raw, want) => expect(parseMoney(raw)).toBe(want));
  it.each([[0], ['0'], [''], [null], [undefined], ['n/a'], ['12abc'], [-500], ['-500'], [9], [MAX_JOB_VALUE + 1], ['$4,045,551,212'], ['4045551212'], [4045551212], ['2125551212'], ['$500,000,001'], ['404-555-1212'], ['(404) 555-1212'], [NaN], [Infinity], ['5551234567890'], [{}], [[]]])('rejects %j', (raw) => expect(parseMoney(raw)).toBeNull());
  it('firstMoney takes the first plausible value in order (a 0 total falls through to the trade valuation)', () => {
    expect(firstMoney(['0', '', '7000', '9000'])).toBe(7000);
    expect(firstMoney([null, 'x'])).toBeNull();
  });
  it('formatMoney prints whole dollars with separators', () => {
    expect(formatMoney(14500)).toBe('$14,500');
    expect(formatMoney(1250000)).toBe('$1,250,000');
  });
});

describe('jobValueOf / jobValueLine on a stored row', () => {
  it('data.jobValue wins; the summary part is the fallback for a row stored before this change', () => {
    expect(jobValueOf({ jobValue: 14500, summary: 'X | $9,000 job value' })).toBe(14500);
    expect(jobValueOf({ jobValue: '14500', summary: null })).toBe(14500); // data->>jobValue comes back as text
    expect(jobValueOf({ summary: 'PERMIT | Interior Remodel | $3,149 job value | 2150 N DAMEN' })).toBe(3149);
    expect(jobValueOf({ summary: '$3,149 job value' })).toBe(3149);
    expect(jobValueOf({ jobValue: '0', summary: 'A | B' })).toBeNull();
    expect(jobValueOf(null)).toBeNull();
    expect(jobValueOf({})).toBeNull();
  });
  it('a number in some other part of the summary is not a value', () => {
    expect(jobValueOf({ summary: 'Roof | 1500 sq ft | 2150 N DAMEN' })).toBeNull();
    expect(jobValueOf({ summary: 'Estimated $5,000 job value later' })).toBeNull();
  });
  it('the card line wording', () => {
    expect(jobValueLine({ jobValue: 14500 })).toBe(LINE);
    expect(jobValueLine({})).toBeNull();
    expect(jobValueLine({ jobValue: 14500 })).not.toMatch(/—|–/);
  });
  it('the PostgREST alias reads data.jobValue as text', () => {
    expect(VALUE_SELECT).toBe('jobValue:data->>jobValue');
  });
});

describe('siteAddressFromSummary (read path, stored summaries)', () => {
  it.each([
    ['PERMIT | Interior Remodel | $14,500 job value | 2150 N DAMEN', '2150 N DAMEN', null],
    ['Residential | 1431 SHARON NW, ATLANTA, GA 30314', '1431 SHARON NW', 'ATLANTA, GA 30314'],
    ['Building | 245 First St, Cambridge, MA 02142', '245 First St', 'Cambridge, MA 02142'],
    ['BLDR | Repair | 9541 SOUTH BV CHARLOTTE NC 28273', '9541 SOUTH BV', 'CHARLOTTE NC 28273'],
  ])('finds the street in %s', (summary, address, tail) => {
    expect(siteAddressFromSummary(summary)).toEqual({ address, tail });
  });
  it.each([
    ['Roof | 1500 sq ft'],
    ['Roof | $14,500 job value'],
    ['Roof | 4 units'],
    ['Roof | 2 units | 10 stories'],
    ['2 units | 10 stories'],
    ['Roof | 10 floors'],
    ['Roof | 3 bedrooms'],
    ['Roof | 12 months'],
    ['Roof | 2500 square'],
    ['Roof | 4000 block of W MADISON ST'],
    ['Roof | 12 Main St call 404-555-0100'],
    [''],
    [null],
  ])('gives null for %j', (summary) => {
    expect(siteAddressFromSummary(summary as string | null)).toBeNull();
  });
});

describe('outreachPlan: a permit stored before site rows existed still shows its job site, from the summary it already prints', () => {
  const sig = { source: 'socrata-chicago-permits', kind: 'permit', city: 'Chicago', state: 'IL', summary: 'PERMIT | $14,500 job value | 2150 N DAMEN' };
  it('no stored contacts: the site plan carries the summary address', () => {
    const plan = outreachPlan(sig, []);
    expect(plan).not.toBeNull();
    expect(JSON.stringify(plan)).toContain('2150 N DAMEN');
  });
  it('without the summary address and without contacts nothing is invented', () => {
    const plan = outreachPlan({ ...sig, summary: 'PERMIT | $14,500 job value' }, []);
    expect(JSON.stringify(plan ?? {})).not.toContain('DAMEN');
  });
  it('a stored contractor company is still the only organisation shown, with its licence', () => {
    const plan = outreachPlan(sig, [{ role: 'contractor', name: 'METRO BUILDING SERVICES LLC', license: '626543', phone: '718-555-0140' }]);
    expect(JSON.stringify(plan)).toContain('METRO BUILDING SERVICES LLC');
    expect(JSON.stringify(plan)).toContain('626543');
  });
});

describe('brief valueLine (the card part)', () => {
  const input = { source: permit.signal.source, kind: permit.signal.kind, subtype: 'permit', title: permit.signal.title, summary: permit.signal.summary ?? null, label: permit.label, trade: permit.trade };
  it('a permit with data.jobValue shows the line', () => expect(cardBrief({ ...input, jobValue: 14500 }).valueLine).toBe(LINE));
  it('a stored permit with no data.jobValue falls back to the summary', () => expect(cardBrief({ ...input, jobValue: undefined }).valueLine).toBe(LINE));
  it('a locked member gets no line (title and summary are null as well)', () => expect(cardBrief({ ...input, title: null, summary: null, jobValue: null }).valueLine).toBeNull());
  it('a permit with no value anywhere shows no line', () => expect(cardBrief({ ...input, summary: 'PERMIT | 2150 N DAMEN', jobValue: null }).valueLine).toBeNull());
  it('only permits: a storm card or a federal award never shows a job value', () => {
    expect(cardBrief({ source: storm.signal.source, kind: storm.signal.kind, title: storm.signal.title, summary: '$14,500 job value', jobValue: 14500 }).valueLine).toBeNull();
    expect(cardBrief({ source: 'usaspending', kind: 'contract', title: 'Award', summary: 'by VA', jobValue: 310000 }).valueLine).toBeNull();
  });
});

describe('the value line on the three surfaces', () => {
  const feed = (item: ReturnType<typeof feedItem>) =>
    renderToStaticMarkup(createElement(Feed, { items: [item], hasFilter: false, nowMs: NOW.getTime() } as never));
  it('web feed: a permit card prints the line once; a card without a value prints none', () => {
    const html = feed({ ...feedItem(permit), jobValue: 14500 });
    expect(html).toContain('data-testid="brief-value"');
    expect(html.split(LINE).length - 1).toBe(1);
    const none = feed({ ...feedItem(permit), summary: 'PERMIT | 2150 N DAMEN', jobValue: null });
    expect(none).not.toContain('brief-value');
    expect(feed(feedItem(storm))).not.toContain('brief-value');
  });
  it('e-mail digest: html and text carry the line; none for a card with no value', () => {
    const mail = renderDigest({ businessName: 'Fixture', items: [{ ...digestItem(permit), jobValue: 14500 }], appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW });
    expect(mail.html).toContain(LINE);
    expect(mail.text).toContain(LINE);
    const bare = renderDigest({ businessName: 'Fixture', items: [{ ...digestItem(permit), summary: 'PERMIT | 2150 N DAMEN', jobValue: null }], appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW });
    expect(bare.html + bare.text).not.toContain('Job value on the permit');
    for (const re of BANNED) expect(mail.html + mail.text, String(re)).not.toMatch(re);
  });
  it('mobile alert: brief.valueLine from the row value; null for a locked member', async () => {
    const deps = (locked: boolean) => ({ userId: 'u1', locked, db: new FakeDb() as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: [permit.trade ?? 'roofing'] });
    const row = mobileRow(permit, 0) as unknown as { signal: Record<string, unknown> };
    row.signal.jobValue = '14500';
    const [open] = await buildAlerts([row as never], deps(false));
    expect(open.brief.valueLine).toBe(LINE);
    const [locked] = await buildAlerts([row as never], deps(true));
    expect(locked.brief.valueLine).toBeNull();
  });
});

describe('who to contact: the licence number of a contractor company', () => {
  it('is printed as "Contractor license number: N" under the company, and nothing is printed without one', async () => {
    const { WhoToContact } = await import('@/components/feed/who-to-contact');
    const item = { source: 'socrata-nyc-permits', kind: 'permit', city: 'New York City', state: 'NY', title: 'Permit', summary: 'General Construction | $125,000 job value | BROOKLYN', url: 'https://data.cityofnewyork.us/d/rbx6-tga4' };
    const co = { role: 'contractor' as const, name: 'METRO BUILDING SERVICES LLC', phone: '718-555-0140', license: '626543' };
    const html = renderToStaticMarkup(createElement(WhoToContact, { item: item as never, contacts: [co] }));
    expect(html).toContain('METRO BUILDING SERVICES LLC');
    expect(html).toContain('Contractor license number: 626543');
    const plain = renderToStaticMarkup(createElement(WhoToContact, { item: item as never, contacts: [{ ...co, license: undefined }] }));
    expect(plain).not.toContain('license number');
    for (const re of BANNED) expect(html, String(re)).not.toMatch(re);
  });
});

describe('review HSK G-P2: a value or a site that merely looks like one', () => {
  it('a phone number typed into the cost column is never a value, from the ingest or from a stored summary', () => {
    expect(jobValueOf({ jobValue: '$4,045,551,212' })).toBeNull();
    expect(jobValueOf({ summary: 'PERMIT | $4,045,551,212 job value | 2150 N DAMEN' })).toBeNull();
    expect(jobValueLine({ jobValue: 4045551212 })).toBeNull();
  });
  it('a count in a summary part is not a job site', () => {
    expect(siteAddressFromSummary('Office | 10 stories')).toBeNull();
    expect(siteAddressFromSummary('Office | 10 stories | 2150 N DAMEN')?.address).toBe('2150 N DAMEN');
    expect(siteAddressFromSummary('2 units | 10 stories')).toBeNull();
  });
  it('the plan never prints a non-address as the job site', () => {
    const plan = outreachPlan({ source: 'socrata-chicago-permits', kind: 'permit', city: 'Chicago', state: 'IL', summary: 'PERMIT | 10 stories' }, []);
    expect(JSON.stringify(plan ?? {})).not.toContain('10 stories');
  });
});
