// u2: the opportunity labels (lib/signals/opportunity.ts) are used everywhere a member sees or receives alerts: matching (downstream
// trades, context never matches, ranking), push (act only), the digest (Act now then Coming soon, why / next / not known), the web feed
// (context hidden, label chip, grouping), the app feed payload, the check page, and the select strings that feed them.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/app/app/actions', () => ({
  setMatchStatus: async () => ({ ok: true }),
  getRequestReplyStates: async () => ({}),
  submitFeedback: async () => ({ ok: true }),
}));

import { hitLabel, matchOne, matchSignals, pickHits, type Hit, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import {
  OPPORTUNITY_DATA_COLUMNS,
  memberOpportunity,
  opportunityInputOf,
  prefilterCategories,
} from '@/lib/signals/member-opportunity';
import { isActFor, pushEntriesFromMatches, buildNotification, PUSH_SIGNAL_COLUMNS } from '@/lib/push/notify';
import { digestOrder, renderDigest, type DigestItem } from '@/lib/email/templates';
import { Feed, orderByOpportunity, type FeedItem } from '@/components/feed';
import { buildAlerts, MATCH_SELECT } from '@/lib/mobile/feed';
import { groupItems, opportunityCounts, type CheckItem } from '@/lib/check/group';
import { CheckResults } from '@/components/check-results';
import { INSERTED_SIGNAL_COLUMNS } from '@/lib/signals/store';
import { SIGNAL_COLUMNS as REMATCH_COLUMNS } from '@/lib/signals/rematch';
import { APPROX_COLUMNS, COLUMNS as BACKFILL_COLUMNS, KEYWORD_COLUMNS, RPC_COLUMNS } from '@/lib/signals/backfill';
import { PREVIEW_COLUMNS } from '@/lib/preview/recent';
import { MISSED_COLUMNS } from '@/lib/lifecycle/missed';
import { CHECK_COLUMNS } from '@/lib/check/load';

const NOW = new Date('2026-11-20T12:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const AUSTIN = { lat: 30.27, lon: -97.74, state: 'TX' };
const member = (trades: string[], over: Partial<MatchProfile> = {}): MatchProfile => ({ user_id: trades.join('+'), categories: trades, ...AUSTIN, radius_mi: 25, ...over });
let nid = 1;
const rec = (over: Partial<MatchSignal>): MatchSignal => ({
  id: nid++,
  kind: 'permit',
  source: 'socrata-austin-permits',
  title: 'Roof permit in Austin',
  summary: null,
  categories: ['roofing'],
  lat: 30.28,
  lon: -97.75,
  state: 'TX',
  severity: 1,
  occurred_at: ago(2),
  subtype: 'permit',
  ...over,
});

const ROOF = rec({ id: 1001 });
const POTHOLE = rec({ id: 1002, kind: 'civic', source: 'socrata-austin-311', subtype: '311', title: '311 request in Austin: Pothole Repair', categories: ['concrete-paving', 'roofing'] });
const HEAT = rec({ id: 1003, kind: 'civic', source: 'socrata-nyc-311', subtype: '311', title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING', categories: ['hvac'] });
const HAIL = rec({ id: 1004, kind: 'report', source: 'spc', subtype: null, title: 'Hail reported near Austin', categories: ['roofing'], data: { type: 'hail', hailInches: 1.75 }, severity: 1 });
const WARNING = rec({ id: 1005, kind: 'alert', source: 'nws', subtype: null, title: 'Severe Thunderstorm Warning: Travis, TX', categories: ['roofing'], data: { event: 'Severe Thunderstorm Warning' }, severity: 3 });

describe('matching uses the opportunity per trade', () => {
  it('a re-roof permit matches a gutter company (downstream trade, not in the record categories); the old category rule would not', () => {
    const gutters = member(['siding-gutters']);
    expect(ROOF.categories).not.toContain('siding-gutters');
    expect(matchOne(ROOF, gutters)).not.toBeNull();
    expect(matchSignals([ROOF], [gutters], 25, NOW).map((r) => r.signal_id)).toEqual([1001]);
    expect(hitLabel(ROOF, gutters)).toBe('soon');
    // and stays a Market insight for the roofer
    expect(hitLabel(ROOF, member(['roofing']))).toBe('intel');
  });

  it('context never matches, even when the record categories include the trade (a pothole 311 request tagged roofing)', () => {
    const roofer = member(['roofing']);
    expect(POTHOLE.categories).toContain('roofing');
    expect(matchOne(POTHOLE, roofer)).toBeNull();
    expect(matchSignals([POTHOLE], [roofer], 25, NOW)).toEqual([]);
  });

  it('a keyword watch (Pro) still matches a record that is context for the trades, and ranks as Coming soon (emailed, never pushed)', () => {
    const pro = member(['roofing'], { plan: 'pro', subscription_status: 'active', keywords: ['pothole'] });
    expect(matchOne(POTHOLE, pro)).not.toBeNull();
    expect(hitLabel(POTHOLE, pro)).toBe('soon');
  });

  it('a keyword-only match outranks a Market insight trade match in the fast path (soon beats intel)', () => {
    const pro = member(['roofing'], { plan: 'pro', subscription_status: 'active', keywords: ['pothole'] });
    const intelSevere = rec({ id: 1, severity: 3, occurred_at: ago(1) }); // roof permit: intel for roofing
    const kwOnly = { ...POTHOLE, id: 2, severity: 1, occurred_at: ago(30) }; // context for roofing, keyword hit
    expect(matchSignals([intelSevere, kwOnly], [pro], 25, NOW).map((r) => r.signal_id)).toEqual([2, 1]);
  });

  it('a row read without its kind throws instead of silently matching nothing', () => {
    const noKind = { ...ROOF, kind: undefined } as unknown as MatchSignal;
    expect(() => matchSignals([noKind], [member(['roofing'])], 25, NOW)).toThrow(/has no kind/);
    expect(() => matchOne(noKind, member(['roofing']))).toThrow(/has no kind/);
  });

  it('pickHits ranks by the member best label first (act, soon, intel), then severity, then newest', () => {
    const roofer = member(['roofing']);
    const intelSevere = rec({ id: 1, severity: 3, occurred_at: ago(1) }); // roof permit: intel for roofing
    const soonOld = rec({ id: 2, kind: 'alert', source: 'nws', subtype: null, title: 'High Wind Warning: Travis, TX', data: { event: 'High Wind Warning' }, severity: 1, occurred_at: ago(30) });
    const actOld = rec({ id: 3, kind: 'report', source: 'spc', subtype: null, title: 'Hail reported near Austin', data: { type: 'hail', hailInches: 1.5 }, severity: 1, occurred_at: ago(40) });
    const rows = matchSignals([intelSevere, soonOld, actOld], [roofer], 25, NOW);
    expect(rows.map((r) => r.signal_id)).toEqual([3, 2, 1]);
    const hits: Hit[] = [
      { s: intelSevere, distance_mi: 1, label: 'intel' },
      { s: soonOld, distance_mi: 1, label: 'soon' },
      { s: actOld, distance_mi: 1, label: 'act' },
    ];
    expect(pickHits(hits, NOW.getTime()).map((h) => h.s.id)).toEqual([3, 2, 1]);
    // the cap keeps the act row even when 25 newer, more severe intel rows exist
    const many = Array.from({ length: 30 }, (_, i) => rec({ id: 100 + i, severity: 3, occurred_at: ago(0.5) }));
    expect(matchSignals([...many, actOld], [roofer], 25, NOW)[0].signal_id).toBe(3);
  });

  it('the SQL prefilter categories add the trades whose permitted work this trade follows', () => {
    expect(prefilterCategories(['siding-gutters'])).toEqual(['siding-gutters', 'roofing']);
    expect(prefilterCategories(['roofing'])).toEqual(['roofing']); // solar no longer feeds roofing
    expect(prefilterCategories(['solar'])).toEqual(['solar']);
    expect(prefilterCategories(['flooring'])).toContain('general-contractor');
  });
});

describe('memberOpportunity and stored rows', () => {
  it('reads the data fields from the opp_* aliases a select returns', () => {
    const row = { kind: 'report', source: 'spc', title: 'Hail reported near Austin', categories: ['roofing'], opp_type: 'hail', opp_hail: '1.25' };
    expect(opportunityInputOf(row).data).toMatchObject({ type: 'hail', hailInches: 1.25 });
    expect(memberOpportunity(row, ['roofing'])).toMatchObject({ label: 'act', labelText: 'Act now', trade: 'roofing' });
    const small = { ...row, opp_hail: '0.75' };
    expect(memberOpportunity(small, ['roofing']).label).toBe('intel');
  });
  it('picks the best trade and gives why, next and what is not known', () => {
    const o = memberOpportunity(ROOF, ['roofing', 'siding-gutters']);
    expect(o).toMatchObject({ label: 'soon', trade: 'siding-gutters', labelText: 'Coming soon' });
    expect(o.why).toMatch(/roof permit/i);
    expect(o.next.length).toBeGreaterThan(5);
    expect(o.uncertain.length).toBeGreaterThan(5);
  });
  it('context for every trade, unless a keyword watch hits', () => {
    expect(memberOpportunity(POTHOLE, ['roofing']).label).toBe('context');
    const kw = memberOpportunity(POTHOLE, ['roofing'], ['pothole']);
    expect(kw).toMatchObject({ label: 'soon', reason: 'keyword', trade: null });
    expect(kw.why).toContain('"pothole"');
  });
});

describe('push: only Act now items count', () => {
  const m = (id: number, s: Record<string, unknown>, created = ago(1)) => ({ id, user_id: 'u', created_at: created, signal: { city: 'Austin', occurred_at: ago(2), ...s, id } });
  it('a member with only Coming soon or Market insight matches gets no push entry', () => {
    const e = pushEntriesFromMatches([m(1, { ...ROOF, title: 'Roof permit in Austin' }), m(2, { ...WARNING })] as never, NOW.getTime(), new Map([['u', ['roofing', 'siding-gutters']]]));
    expect(e.size).toBe(0);
  });
  it('counts only the act matches and leads with the newest act item', () => {
    const e = pushEntriesFromMatches(
      [m(1, { ...HAIL, title: 'Hail reported near Austin' }, ago(3)), m(2, { ...WARNING }, ago(1)), m(3, { ...HEAT, title: 'No heat' }, ago(2))] as never,
      NOW.getTime(),
      (u) => (u === 'u' ? ['roofing', 'hvac'] : undefined),
    );
    expect(e.get('u')).toEqual({ count: 2, top: { signalId: 3, title: 'No heat', city: 'Austin' }, matchIds: [1, 3] });
    expect(buildNotification(e.get('u')!, 'Austin')).toMatchObject({ title: '2 new alerts near Austin', body: 'Act now: No heat' });
  });
  it('isActFor: a missing kind or no trades is never act', () => {
    expect(isActFor(HAIL, ['roofing'])).toBe(true);
    expect(isActFor({ ...HAIL, kind: null }, ['roofing'])).toBe(false);
    expect(isActFor(HAIL, [])).toBe(false);
  });
  it('the push read selects what the label needs', () => {
    for (const c of ['kind', 'categories', 'summary', 'subtype:data->>subtype', 'opp_hail:data->>hailInches']) expect(PUSH_SIGNAL_COLUMNS).toContain(c);
  });
});

describe('digest: Act now, then Coming soon; intel left out; why, next and not known on each card', () => {
  const item = (title: string, label: 'act' | 'soon' | 'intel' | 'context'): DigestItem => ({
    kind: 'report',
    source: 'spc',
    title,
    place: 'Austin, TX',
    occurredAt: ago(2),
    sourceUrl: 'https://www.spc.noaa.gov/x',
    opportunity: { label, why: `Why ${title}.`, next: `Next ${title}.`, uncertain: `Unknown ${title}.` },
  });
  it('orders by label and drops intel and context', () => {
    const got = digestOrder([item('S1', 'soon'), item('I1', 'intel'), item('A1', 'act'), item('C1', 'context'), item('S2', 'soon'), item('A2', 'act')]).map((i) => i.title);
    expect(got).toEqual(['A1', 'A2', 'S1', 'S2']);
  });
  it('renders headings, the label, why, next step and not known, and no intent label', () => {
    const mail = renderDigest({ businessName: 'Acme', items: [item('Soon one', 'soon'), item('Insight', 'intel'), item('Act one', 'act')], appUrl: 'https://x/app', unsubscribeUrl: 'https://x/u', now: NOW });
    for (const part of [mail.html, mail.text]) {
      expect(part.indexOf('Act one')).toBeLessThan(part.indexOf('Soon one'));
      expect(part).not.toContain('Insight');
      expect(part).toContain('Why Act one.');
      expect(part).toContain('Next step:');
      expect(part).toContain('Next Act one.');
      expect(part).toContain('Not known:');
      expect(part).toContain('Unknown Soon one.');
      expect(part).not.toMatch(/Might need work|Money being spent|Someone asked/);
      expect(part.indexOf('Act now')).toBeLessThan(part.indexOf('Coming soon'));
    }
    expect(mail.subject).toBe('2 new things near you');
    expect(mail.html).toContain('Open the source');
    expect(mail.text).toContain('https://www.spc.noaa.gov/x');
  });
});

describe('web feed: chip, why, next, not known, source link, Act now first', () => {
  const fi = (id: number, label: 'act' | 'soon' | 'intel', title: string): FeedItem => ({
    id,
    status: 'new',
    kind: 'permit',
    source: 'socrata-austin-permits',
    title,
    summary: null,
    url: 'https://data.austintexas.gov/x',
    distance: '1 mi away',
    place: 'Austin, TX',
    ago: '1 hr ago',
    occurredAt: ago(1),
    draft: null,
    opportunity: { label, labelText: { act: 'Act now', soon: 'Coming soon', intel: 'Market insight' }[label], why: `Why ${title}.`, next: `Next ${title}.`, uncertain: `Unknown ${title}.` },
  });
  it('groups Act now, Coming soon, Market insights in that order, with filters and each card brief', () => {
    const html = renderToStaticMarkup(createElement(Feed, { items: [fi(1, 'intel', 'Intel card'), fi(2, 'soon', 'Soon card'), fi(3, 'act', 'Act card')], cityPage: null }));
    expect(html.indexOf('Act card')).toBeLessThan(html.indexOf('Soon card'));
    expect(html.indexOf('Soon card')).toBeLessThan(html.indexOf('Intel card'));
    for (const t of ['>Act now<', '>Coming soon<', '>Market insights<', '>Market insight<']) expect(html).toContain(t);
    expect(html).toContain('data-opportunity="act"');
    expect(html).toContain('Why Act card.');
    expect(html).toContain('Next Act card.');
    expect(html).toContain('Unknown Act card.');
    expect(html).toContain('Open the source');
    expect(html).toContain('aria-label="Filter matches"');
    expect(html).not.toContain('People asking');
  });
  it('orderByOpportunity is stable inside a label', () => {
    const got = orderByOpportunity([fi(1, 'soon', 'a'), fi(2, 'act', 'b'), fi(3, 'soon', 'c'), fi(4, 'act', 'd')]).map((i) => i.id);
    expect(got).toEqual([2, 4, 1, 3]);
  });
});

describe('/app page: context rows from before the change are not shown', () => {
  it('the page drops a row whose best label is context and labels the rest', async () => {
    vi.resetModules();
    const seen: FeedItem[] = [];
    const sig = (id: number, s: Record<string, unknown>) => ({
      id: 10 + id, status: 'new', distance_mi: 1, draft: null, created_at: ago(1),
      signal: { id, summary: null, url: null, city: 'Austin', state: 'TX', county: null, zip: null, occurred_at: ago(2), expires_at: null, severity: 1, ...s },
    });
    vi.doMock('@/lib/auth/session', () => ({
      requireProfile: async () => ({
        user: { id: 'u1' },
        profile: {
          user_id: 'u1', business_name: 'Acme', categories: ['siding-gutters'], zip: '78701', city: 'Austin', state: 'TX', lat: 30.27, lon: -97.74,
          radius_mi: 25, alert_email: true, subscription_status: 'active', trial_ends_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), plan: 'starter',
          stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: ago(48), created_at: ago(24 * 30),
        },
      }),
    }));
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => {
        const q: Record<string, unknown> = {};
        for (const m of ['from', 'select', 'eq', 'order']) q[m] = () => q;
        q.limit = async () => ({
          data: [
            sig(1, { source: 'socrata-austin-permits', kind: 'permit', title: 'Roof permit in Austin', categories: ['roofing'], subtype: 'permit' }),
            sig(2, { source: 'socrata-austin-311', kind: 'civic', title: '311 request in Austin: Pothole Repair', categories: ['siding-gutters'], subtype: '311' }),
          ],
          error: null,
        });
        return q;
      },
    }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('not in this test'); } }));
    vi.doMock('@/components/feed', () => ({ Feed: ({ items }: { items: FeedItem[] }) => (seen.push(...items), null), LockedFeed: () => null }));
    const AppHome = (await import('@/app/app/page')).default;
    renderToStaticMarkup(await AppHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
    expect(seen.map((i) => i.title)).toEqual(['Roof permit in Austin']);
    expect(seen[0].opportunity).toMatchObject({ label: 'soon', labelText: 'Coming soon' });
    for (const m of ['@/lib/auth/session', '@/lib/supabase/server', '@/lib/supabase/admin', '@/components/feed']) vi.doUnmock(m);
  });
});

describe('app feed payload (lib/mobile/feed.ts)', () => {
  it('adds `opportunity` next to `intent` and drops context rows', async () => {
    const row = (id: number, s: Record<string, unknown>) => ({
      id, status: 'new', distance_mi: 2, draft: null, created_at: ago(1),
      signal: { id: 100 + id, summary: null, url: null, city: 'Austin', state: 'TX', county: null, zip: null, severity: 1, occurred_at: ago(2), expires_at: null, ...s },
    });
    const items = await buildAlerts(
      [
        row(1, { source: 'spc', kind: 'report', title: 'Hail reported near Austin', categories: ['roofing'], subtype: null, opp_type: 'hail', opp_hail: '1.5' }),
        row(2, { source: 'socrata-austin-311', kind: 'civic', title: '311 request in Austin: Pothole Repair', categories: ['roofing'], subtype: '311' }),
      ] as never,
      { userId: 'u', locked: true, db: { from: () => { throw new Error('locked: no reads'); } } as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: ['roofing'] },
    );
    expect(items.map((i) => i.matchId)).toEqual([1]);
    expect(items[0].intent).toBeDefined();
    expect(Object.keys(items[0].opportunity).sort()).toEqual(['label', 'labelText', 'next', 'uncertain', 'why']);
    expect(items[0].opportunity).toMatchObject({ label: 'act', labelText: 'Act now' });
    // locked: the why line is masked like the title
    expect(items[0].opportunity.why).toMatch(/^[x\s.,]+$/);
    expect(MATCH_SELECT).toContain('categories');
    expect(MATCH_SELECT).toContain('opp_event:data->>event');
  });
});

describe('check page: labelled for the chosen trade, never a context row', () => {
  const ci = (id: number, label: 'act' | 'soon' | 'intel' | 'context'): CheckItem => ({
    id, kind: 'permit', source: 'socrata-austin-permits', title: `Item ${id}`, url: 'https://x/y', place: 'Austin, TX', lat: 30.27, lon: -97.74, occurredAt: ago(id), severity: 1,
    opportunity: { label, labelText: label === 'act' ? 'Act now' : label === 'soon' ? 'Coming soon' : label === 'intel' ? 'Market insight' : 'Background', why: `Why ${id}.`, next: `Next ${id}.`, uncertain: `Unknown ${id}.` },
  });
  it('groupItems never lists a context row; counts are per label', () => {
    const shown = groupItems([ci(1, 'act'), ci(2, 'context'), ci(3, 'soon'), ci(4, 'intel')], NOW.getTime()).flatMap((g) => g.items.map((i) => i.id));
    expect(shown.sort()).toEqual([1, 3, 4]);
    expect(opportunityCounts([ci(1, 'act'), ci(3, 'soon'), ci(4, 'intel'), ci(5, 'soon')])).toEqual({ act: 1, soon: 2, intel: 1 });
  });
  it('the results show the label counts and each card brief, with its source link', () => {
    const html = renderToStaticMarkup(
      createElement(CheckResults, { items: [ci(1, 'act'), ci(2, 'context'), ci(3, 'soon')], mode: 'results', checkedAt: NOW.toISOString(), placeLabel: 'Austin, TX', trade: 'siding-gutters', tradeLabel: 'Siding and gutters', citySlug: null, watches: [], now: NOW.getTime() }),
    );
    expect(html).toContain('For siding and gutters: 1 Act now, 1 Coming soon.');
    expect(html).toContain('Why 1.');
    expect(html).toContain('Next 3.');
    expect(html).not.toContain('Item 2');
    expect(html).toContain('Source: ');
  });
});

describe('every read that feeds matching or a member surface selects what opportunity needs', () => {
  const plainReads: Record<string, string> = {
    INSERTED_SIGNAL_COLUMNS,
    REMATCH_COLUMNS,
    BACKFILL_COLUMNS,
    KEYWORD_COLUMNS,
    APPROX_COLUMNS,
    MISSED_COLUMNS,
  };
  it.each(Object.entries(plainReads))('%s has kind, title and the data aliases', (_n, cols) => {
    const list = cols.split(',').map((c) => c.trim());
    for (const c of ['kind', 'title', 'categories']) expect(list).toContain(c);
    for (const a of OPPORTUNITY_DATA_COLUMNS.split(',')) expect(list).toContain(a);
  });
  it('the RPC reads take the whole data object (no JSON aliases on a function result)', () => {
    for (const cols of [RPC_COLUMNS, CHECK_COLUMNS]) for (const c of ['kind', 'title', 'categories', 'data']) expect(cols.split(',')).toContain(c);
  });
  it('the preview reads the data aliases but never summary or the whole data object', () => {
    const list = PREVIEW_COLUMNS.split(',');
    expect(list).toContain('kind');
    expect(list).toContain('title');
    for (const a of OPPORTUNITY_DATA_COLUMNS.split(',')) expect(list).toContain(a);
    expect(list).not.toContain('summary');
    expect(list).not.toContain('data');
  });
  it('the feed page, the digest and the lifecycle store embed the opportunity fields', () => {
    for (const f of ['app/app/page.tsx', 'app/api/cron/notify/route.ts', 'lib/lifecycle/store.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toContain('OPPORTUNITY_DATA_COLUMNS');
      // The embedded select (holler_signals(...)) or the columns constant it uses names kind.
      expect(src, f).toMatch(/(holler_signals\(|_COLUMNS = `)[^)`]*\bkind\b/);
    }
  });
});
