// Alert-quality dashboard (PLAN-2.0 3.4): the aggregation against fixtures, the read-only loader, the route's auth and the HTML page.
// Inputs are hand-written (assumed); each expected number is derived in the comment beside it.
import { HEAT_MARK } from '@/lib/signals/carry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { buildQualityReport, KEYWORD_TRADE, percentile, type QualityInputs } from '@/lib/admin/quality';
import { renderQualityHtml } from '@/lib/admin/quality-html';
import { labelFor } from '@/lib/signals/lead-rules';

const NOW = new Date('2026-11-22T12:00:00Z');
const H = 3_600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

// Signals: one of each label for the trade it is used with below.
const S = {
  // round 19 RULES: an HVAC card on a whole-building complaint exists only for the building's third complaint, which carries the scan's mark
  heat1: { id: 1, source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in New York: HEAT/HOT WATER / ENTIRE BUILDING', summary: `HEAT/HOT WATER | ENTIRE BUILDING | BRONX | ${HEAT_MARK}`, categories: ['hvac', 'plumbing'] },
  inspect: { id: 2, source: 'socrata-nyc-inspections', kind: 'civic', subtype: 'inspection', title: 'Failed inspection', categories: ['plumbing'] },
  graffiti: { id: 3, source: 'socrata-chicago-311', kind: 'civic', subtype: '311', title: '311 request in Chicago: Graffiti Removal Request', categories: ['painting'] },
  roofPermit: { id: 4, source: 'socrata-chicago-permits', kind: 'permit', subtype: 'permit', title: 'Chicago permit: Re-roof', categories: ['roofing'] },
  hail: { id: 5, source: 'spc', kind: 'report', subtype: null, title: 'hail reported', categories: ['roofing'] },
  heat2: { id: 6, source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in New York: Non-Residential Heat / Inadequate or No Heat', categories: ['hvac'] },
  orphan: { id: 7, source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: 'gone', categories: ['hvac'] },
};
const signals = Object.values(S);

const profile = (user_id: string, categories: string[], over: Record<string, unknown> = {}) => ({
  user_id, created_at: ago(30 * D), categories, plan: null, subscription_status: 'trialing', trial_ends_at: ahead(5 * D), ...over,
});
const profiles = [
  profile('u1', ['roofing', 'hvac'], { created_at: ago(3 * D) }),
  profile('u2', ['hvac'], { subscription_status: 'active' }),
  profile('u3', ['plumbing'], { created_at: ago(5 * D), trial_ends_at: ago(1 * D) }), // trial over, not paying: locked
  profile('u4', ['painting'], { created_at: ago(20 * H) }),
];
const alert = (user_id: string, signal_id: number | null, trade: string | null, createdAgo: number, emailedAgo: number | null, over: Record<string, unknown> = {}) => ({
  user_id, signal_id, source: null, kind: null, subtype: null, trade, created_at: ago(createdAgo), emailed_at: emailedAgo === null ? null : ago(emailedAgo), ...over,
});
const alerts = [
  alert('u2', 1, 'hvac', 2 * D, 2 * D - H), // act_now, sent
  alert('u2', 6, 'hvac', 1 * D, 1 * D - H), // act_now, sent
  alert('u3', 2, 'plumbing', 2 * D, 2 * D - H), // coming_soon, sent
  alert('u4', 3, 'painting', 1 * D, 1 * D - H), // context, SENT: a bug the dashboard must show
  alert('u1', 4, 'roofing', 2 * D, 2 * D - H), // market_insight, sent
  alert('u1', 5, 'roofing', 2 * D, 2 * D - H), // act_now, sent
  alert('u1', 1, 'hvac', 1 * D, null), // logged, not emailed
  alert('u2', 1, 'hvac', 20 * D, 20 * D - H), // outside the window
  alert('u2', 5, null, 1 * D, 1 * D - H), // keyword-watch match (no trade): hail is act_now for no-trade? computed below
  alert('u2', null, 'hvac', 1 * D, 1 * D - H, { source: 'socrata-nyc-311', kind: 'civic', subtype: '311' }), // signal pruned: labelled from the row's own fields
];
const feedback = [
  { user_id: 'u2', signal_id: 1, verdict: 'useful', updated_at: ago(1 * D) },
  { user_id: 'u2', signal_id: 6, verdict: 'not_relevant', updated_at: ago(1 * D) },
  { user_id: 'u1', signal_id: 5, verdict: 'led_to_work', updated_at: ago(1 * D) },
  { user_id: 'u1', signal_id: 4, verdict: 'not_relevant', updated_at: ago(1 * D) },
  { user_id: 'u2', signal_id: 1, verdict: 'useful', updated_at: ago(20 * D) }, // outside the window
  { user_id: 'u1', signal_id: 5, verdict: 'something_else', updated_at: ago(1 * D) }, // not a verdict we count
];
const matches = [
  { user_id: 'u1', signal_id: 4, created_at: ago(3 * D - 2 * H) }, // +2 h, market_insight: not a useful card
  { user_id: 'u1', signal_id: 1, created_at: ago(3 * D - 10 * H) }, // +10 h, act_now for hvac
  { user_id: 'u1', signal_id: 5, created_at: ago(3 * D - 30 * H) }, // +30 h, act_now for roofing
  { user_id: 'u3', signal_id: 2, created_at: ago(5 * D - 1 * H) }, // +1 h, coming_soon for plumbing
];
const base = (): QualityInputs => ({ now: NOW, alerts, signals, feedback, profiles, matches });
const byTrade = (r: ReturnType<typeof buildQualityReport>, t: string) => r.trades.find((x) => x.trade === t)!;

describe('fixture sanity: the labels the cases rely on', () => {
  it('has one of each label', () => {
    const l = (s: (typeof signals)[number], t: string | null) => labelFor({ source: s.source, kind: s.kind, subtype: s.subtype, title: s.title, summary: (s as { summary?: string }).summary }, t as never);
    expect(l(S.heat1, 'hvac')).toBe('act_now');
    expect(l(S.heat2, 'hvac')).toBe('act_now');
    expect(l(S.inspect, 'plumbing')).toBe('coming_soon');
    expect(l(S.graffiti, 'painting')).toBe('context');
    expect(l(S.roofPermit, 'roofing')).toBe('market_insight');
    expect(l(S.hail, 'roofing')).toBe('act_now');
  });
});

describe('buildQualityReport', () => {
  const r = buildQualityReport(base());

  it('counts sent alerts by label per trade', () => {
    // hvac sent: sig1 act_now, sig6 act_now, the pruned row (nyc 311, no title: source default) = 3 in window; sig1 at -20 d is outside
    const hvac = byTrade(r, 'hvac');
    expect(hvac.sent.act_now + hvac.sent.coming_soon + hvac.sent.market_insight + hvac.sent.context).toBe(hvac.sent.total);
    expect(hvac.sent.total).toBe(3);
    expect(hvac.sent.act_now).toBeGreaterThanOrEqual(2);
    expect(byTrade(r, 'plumbing').sent).toMatchObject({ coming_soon: 1, total: 1, usefulShare: 1, meetsTarget: true });
    expect(byTrade(r, 'painting').sent).toMatchObject({ context: 1, total: 1, usefulShare: 0, meetsTarget: false });
    expect(byTrade(r, 'roofing').sent).toMatchObject({ act_now: 1, market_insight: 1, total: 2, usefulShare: 0.5, meetsTarget: false });
  });

  it('keeps alerts with no trade in their own bucket', () => {
    expect(byTrade(r, KEYWORD_TRADE).sent.total).toBe(1);
  });

  it('logged counts every row created in the window, sent or not', () => {
    // hvac: sig1, sig6, sig1 (not emailed), pruned row = 4; the -20 d row is outside
    expect(byTrade(r, 'hvac').logged.total).toBe(4);
    expect(byTrade(r, 'hvac').logged.total).toBeGreaterThan(byTrade(r, 'hvac').sent.total);
  });

  it('totals across trades and lists the trades under the 60% target', () => {
    expect(r.all.sent.total).toBe(3 + 1 + 1 + 2 + 1); // hvac 3, plumbing 1, painting 1, roofing 2, keyword 1
    expect(r.belowTarget.sort()).toEqual(['painting', 'roofing']);
    expect(r.target).toBe(0.6);
    expect(r.windowDays).toBe(14);
  });

  it('flags a sent Context alert as a bug in the notes', () => {
    expect(r.all.sent.context).toBeGreaterThanOrEqual(1);
    expect(r.notes.join(' ')).toMatch(/Context label/);
  });

  it('computes the feedback false-positive rate per trade from answers in the window only', () => {
    // hvac: u2 sig1 useful, u2 sig6 not_relevant (the -20 d answer and the unknown verdict are left out) = 1 of 2
    expect(byTrade(r, 'hvac').feedback).toMatchObject({ answered: 2, notRelevant: 1, useful: 1, falsePositiveRate: 0.5, lowSample: true });
    // roofing: u1 sig5 led_to_work (useful), u1 sig4 not_relevant
    expect(byTrade(r, 'roofing').feedback).toMatchObject({ answered: 2, notRelevant: 1, falsePositiveRate: 0.5 });
    expect(byTrade(r, 'plumbing').feedback).toMatchObject({ answered: 0, falsePositiveRate: null });
    expect(r.all.feedback.answered).toBe(4);
  });

  it('measures the time to the first useful card for new members only', () => {
    // new members: u1 (3 d), u3 (5 d), u4 (20 h); u2 joined 30 d ago
    expect(r.all.firstCard).toMatchObject({ newMembers: 3, withUsefulCard: 2, withoutCard: 1, within24h: 2, medianHours: 1, p90Hours: 10 });
    expect(byTrade(r, 'hvac').firstCard).toMatchObject({ newMembers: 1, withUsefulCard: 1, within24h: 1, medianHours: 10 }); // u1: the act_now heat card at +10 h
    expect(byTrade(r, 'roofing').firstCard).toMatchObject({ newMembers: 1, withUsefulCard: 1, within24h: 0, medianHours: 30 }); // the +2 h roof permit is market_insight, so the first useful card is the +30 h hail report
    expect(byTrade(r, 'plumbing').firstCard).toMatchObject({ newMembers: 1, withUsefulCard: 1, medianHours: 1 });
    expect(byTrade(r, 'painting').firstCard).toMatchObject({ newMembers: 1, withUsefulCard: 0, withoutCard: 1, medianHours: null });
  });

  it('counts members per trade and those with access right now', () => {
    expect(byTrade(r, 'hvac')).toMatchObject({ members: 2, membersWithAccess: 2 }); // u1, u2
    expect(byTrade(r, 'roofing')).toMatchObject({ members: 1, membersWithAccess: 1 });
    expect(byTrade(r, 'plumbing')).toMatchObject({ members: 1, membersWithAccess: 0 }); // u3's trial is over and nothing is paid
    expect(r.all).toMatchObject({ members: 4, membersWithAccess: 3 });
  });

  it('sorts trades by sent alerts, then members', () => {
    expect(r.trades[0].trade).toBe('hvac');
  });

  it('does not carry member ids, emails or titles anywhere in the report', () => {
    const json = JSON.stringify(r);
    for (const bad of ['u1', 'u2', 'u3', 'u4', '@', 'HEAT', 'Re-roof', 'user_id']) expect(json).not.toContain(bad);
  });
});

describe('edges', () => {
  it('no data at all: zeros, null shares, and a note that nothing is logged', () => {
    const r = buildQualityReport({ now: NOW, alerts: [], signals: [], feedback: [], profiles: [], matches: [] });
    expect(r.all.sent).toMatchObject({ total: 0, usefulShare: null, meetsTarget: null });
    expect(r.all.feedback.falsePositiveRate).toBeNull();
    expect(r.all.firstCard).toMatchObject({ newMembers: 0, medianHours: null, p90Hours: null });
    expect(r.trades).toEqual([]);
    expect(r.belowTarget).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/No alert emails are logged/);
  });
  it('a section that could not be read is unavailable and says so, not zero', () => {
    const r = buildQualityReport({ ...base(), status: { alerts: 'unavailable' } });
    expect(r.sections.alerts).toBe('unavailable');
    expect(r.all.sent.total).toBe(0);
    expect(r.notes.join(' ')).toMatch(/alerts read was unavailable/);
    expect(r.sections.feedback).toBe('ok');
  });
  it('rows dated in the future or without a date are ignored', () => {
    const r = buildQualityReport({
      ...base(),
      alerts: [alert('u2', 1, 'hvac', -1 * D, -1 * D), { ...alert('u2', 1, 'hvac', D, D), emailed_at: 'not a date', created_at: 'nope' }],
    });
    expect(r.all.sent.total).toBe(0);
    expect(r.all.logged.total).toBe(0);
  });
  it('percentile is nearest-rank', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 90)).toBe(4);
  });
  it('a small first-card gap never goes negative', () => {
    const r = buildQualityReport({ ...base(), matches: [{ user_id: 'u3', signal_id: 2, created_at: ago(6 * D) }] });
    expect(byTrade(r, 'plumbing').firstCard.medianHours).toBe(0);
  });
});

describe('loadQualityReport (read only)', () => {
  const seeded = () =>
    new FakeDb({
      holler_profiles: profiles,
      holler_alert_log: alerts.map((a, i) => ({ id: i + 1, ...a })),
      holler_signal_feedback: feedback,
      holler_matches: matches.map((m, i) => ({ id: i + 1, ...m })),
      holler_signals: signals,
    });

  it('produces the same report as the pure builder and only ever calls select', async () => {
    const { loadQualityReport } = await import('@/lib/admin/quality-load');
    const db = seeded();
    const r = await loadQualityReport(db as never, NOW);
    // The duplicates line (round 17, PLAN-2.0 2.3) is added by the loader; everything else is the pure builder's report.
    const { duplicates, ...rest } = r;
    expect(rest).toEqual(buildQualityReport(base()));
    expect(duplicates).toMatchObject({ status: 'ok', bySource: [], windowDays: 7 });
    expect(db.calls.length).toBeGreaterThan(0);
    expect(db.calls.every((c) => c.endsWith('.select'))).toBe(true);
    expect([...new Set(db.calls)].sort()).toEqual(['holler_alert_log.select', 'holler_dedupe_drops.select', 'holler_matches.select', 'holler_profiles.select', 'holler_signal_feedback.select', 'holler_signals.select']);
  });

  it('reads only holler_ tables', async () => {
    const { loadQualityReport } = await import('@/lib/admin/quality-load');
    const db = seeded();
    await loadQualityReport(db as never, NOW);
    expect(db.calls.every((c) => c.startsWith('holler_'))).toBe(true);
  });

  it('marks a section unavailable when its table cannot be read, and keeps the rest (no error text)', async () => {
    const { loadQualityReport } = await import('@/lib/admin/quality-load');
    const db = seeded();
    db.failOn['holler_alert_log.select'] = 'relation "holler_alert_log" does not exist: secret detail';
    const r = await loadQualityReport(db as never, NOW);
    expect(r.sections).toEqual({ alerts: 'unavailable', feedback: 'ok', members: 'ok', firstCard: 'ok' });
    expect(r.all.members).toBe(4);
    expect(JSON.stringify(r)).not.toMatch(/secret|relation/);
  });

  it('marks every section that needs records unavailable when the signals cannot be read', async () => {
    const { loadQualityReport } = await import('@/lib/admin/quality-load');
    const db = seeded();
    db.failOn['holler_signals.select'] = 'boom';
    const r = await loadQualityReport(db as never, NOW);
    expect(r.sections).toEqual({ alerts: 'unavailable', feedback: 'unavailable', members: 'ok', firstCard: 'unavailable' });
  });

  it('reports a read that hits the page cap as partial, never silently cut', async () => {
    const { loadQualityReport, readPagesCapped } = await import('@/lib/admin/quality-load');
    // 2300 alert rows in the window, page size 1000: a cap of 2 pages keeps 2000 and the probe page proves there is more.
    const many = Array.from({ length: 2300 }, (_, i) => ({ id: i + 1, ...alert('u2', 1, 'hvac', 1 * D + i, 1 * D + i - H) }));
    const db = new FakeDb({ holler_profiles: profiles, holler_alert_log: many, holler_signals: signals });
    const r = await loadQualityReport(db as never, NOW, 2);
    expect(r.sections).toEqual({ alerts: 'partial', feedback: 'ok', members: 'ok', firstCard: 'ok' });
    expect(r.all.sent.total).toBe(2000);
    expect(r.notes.join(' ')).toMatch(/alerts read hit its row limit/);
    // The same table under a roomy cap is complete.
    const full = await loadQualityReport(new FakeDb({ holler_profiles: profiles, holler_alert_log: many, holler_signals: signals }) as never, NOW, 5);
    expect(full.sections.alerts).toBe('ok');
    expect(full.all.sent.total).toBe(2300);
    // Exactly at the cap is complete too (the probe page is empty).
    const exact = await readPagesCapped<{ id: number }>((from, to) => new FakeDb({ t: many.slice(0, 2000) }).from('t').select('id').order('id').range(from, to), 2);
    expect(exact).toMatchObject({ partial: false });
    expect(exact.rows).toHaveLength(2000);
  });
  it('the newest rows are the ones kept when a cap is hit', async () => {
    const { loadQualityReport } = await import('@/lib/admin/quality-load');
    const old = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, ...alert('u2', 1, 'hvac', 10 * D, 10 * D - H) }));
    const fresh = Array.from({ length: 1000 }, (_, i) => ({ id: 1001 + i, ...alert('u2', 1, 'hvac', 1 * D, 1 * D - H) }));
    const db = new FakeDb({ holler_profiles: profiles, holler_alert_log: [...old, ...fresh], holler_signals: signals });
    const r = await loadQualityReport(db as never, NOW, 1);
    expect(r.sections.alerts).toBe('partial');
    expect(r.all.sent.total).toBe(1000);
    expect(r.all.sent.act_now).toBe(1000);
  });
  it('works when migration 0015 is not applied (empty or missing log) and with no members', async () => {
    const { loadQualityReport } = await import('@/lib/admin/quality-load');
    const r = await loadQualityReport(new FakeDb() as never, NOW);
    expect(r.all.sent.total).toBe(0);
    expect(r.all.members).toBe(0);
  });
});

describe('HTML page', () => {
  it('shows every trade, flags trades under the target, and escapes values', () => {
    const r = buildQualityReport(base());
    r.trades[0].trade = '<script>alert(1)</script>';
    const html = renderQualityHtml(r);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Below target');
    expect(html).toContain('painting');
    expect(html).toContain('50%');
    expect(html).not.toMatch(/https?:\/\//);
  });
  it('says which reads were partial, and that labels use today\'s rules', () => {
    const r = buildQualityReport({ ...base(), status: { alerts: 'partial' } });
    const html = renderQualityHtml(r);
    expect(html).toContain('Partial reads');
    expect(html).toContain('alerts');
    expect(html).not.toContain('Unavailable reads');
    expect(html).toMatch(/today&#39;s label rules|today's label rules/);
    expect(r.sections.alerts).toBe('partial');
    expect(r.all.sent.total).toBeGreaterThan(0);
  });
  it('says which reads were unavailable', () => {
    const html = renderQualityHtml(buildQualityReport({ ...base(), status: { feedback: 'unavailable' } }));
    expect(html).toContain('Unavailable reads');
    expect(html).toContain('feedback');
  });
});

describe('GET /api/admin/quality', () => {
  afterEach(() => vi.unstubAllEnvs());
  async function load(db: FakeDb = new FakeDb({ holler_profiles: profiles, holler_signals: signals }), secret: string | undefined = 's3cret') {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', secret ?? '');
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
    return { GET: (await import('../../app/api/admin/quality/route')).GET, db };
  }
  const req = (qs = '', auth: string | null = 'Bearer s3cret') => new Request(`http://x.test/api/admin/quality${qs}`, { headers: auth ? { authorization: auth } : {} });

  it('anonymous gets 401 and nothing is read', async () => {
    const { GET, db } = await load();
    const res = await GET(req('', null));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(db.calls).toEqual([]);
  });
  it('a wrong bearer, a wrong ?key=, and an empty bearer are all 401', async () => {
    const { GET, db } = await load();
    expect((await GET(req('', 'Bearer nope'))).status).toBe(401);
    expect((await GET(req('?key=nope', null))).status).toBe(401);
    expect((await GET(req('', 'Bearer '))).status).toBe(401);
    expect((await GET(req('?format=html', null))).status).toBe(401);
    expect(db.calls).toEqual([]);
  });
  it('is 401 for everyone when CRON_SECRET is not set', async () => {
    const { GET } = await load(undefined, '');
    expect((await GET(req('', 'Bearer '))).status).toBe(401);
    expect((await GET(req('?key=', null))).status).toBe(401);
  });
  it('refuses the secret in a ?key= query, even the right one: this route has a browser view, so a query secret would leak into history and logs', async () => {
    const { GET, db } = await load();
    for (const qs of ['?key=s3cret', '?key=s3cret&format=html']) {
      const res = await GET(req(qs, null));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
    expect(db.calls).toEqual([]);
  });
  it('returns the JSON report with the Bearer secret, no-store and noindex', async () => {
    const { GET } = await load();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    const body = await res.json();
    expect(body.windowDays).toBe(14);
    expect(body.all.members).toBe(4);
  });
  it('returns the HTML page for ?format=html', async () => {
    const { GET } = await load();
    const res = await GET(req('?format=html'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(await res.text()).toContain('Holler alert quality');
  });
  it('503 when the admin client is not configured', async () => {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('missing env'); } }));
    const { GET } = await import('../../app/api/admin/quality/route');
    expect((await GET(req())).status).toBe(503);
  });
  it('only reads: no write call reaches the database', async () => {
    const { GET, db } = await load(new FakeDb({ holler_profiles: profiles, holler_alert_log: alerts.map((a, i) => ({ id: i + 1, ...a })), holler_signals: signals }));
    await GET(req());
    expect(db.calls.every((c) => c.endsWith('.select'))).toBe(true);
  });
});
