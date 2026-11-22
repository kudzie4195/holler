/**
 * Switching HOLLER_BIDS_ENABLED off is a kill switch (review P1-2, P1-3): bid matches already stored are hidden from members in the web
 * feed, the mobile feed, push and the digest, and the health email does not list the bid sources as "never ran".
 * Inputs are hand-written (assumed): a stored city bid row as the feed selects give it (id, source, kind 'contract', subtype 'bid'),
 * beside an ordinary permit row. Test clock 2026-11-21T22:00:00Z.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { BIDS_FLAG, BID_SOURCE_IDS, bidHidden, dropHiddenBids } from '@/lib/signals/bid-sources';
import { missingEnvFor } from '@/lib/signals/run';
import { buildAlerts, type MatchRow } from '@/lib/mobile/feed';
import { renderDigest } from '@/lib/email/templates';
import { pushEntriesFromMatches } from '@/lib/push/notify';
import { buildBidAdapter, BID_DATASETS } from '@/lib/signals/adapters/city-bids';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-21T22:00:00Z');
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const bidSignal = (id: number) => ({
  id, source: 'bids-la', kind: 'contract', subtype: 'bid', title: 'REPLACE ROOFS AT TWO FIRE STATIONS', summary: 'Water & Power | due 2026-12-10',
  url: 'https://www.rampla.org/s/opportunity-details?id=1', city: 'Los Angeles', state: 'CA', county: null, zip: null, severity: 2,
  occurred_at: iso(-3_600_000), expires_at: iso(19 * 86_400_000),
});
const permitSignal = (id: number) => ({
  id, source: 'socrata-la-permits', kind: 'permit', subtype: 'permit', title: 'Re-roof permit', summary: null, url: 'https://data.lacity.org/x',
  city: 'Los Angeles', state: 'CA', county: null, zip: null, severity: 1, occurred_at: iso(-3_600_000), expires_at: null,
});
const row = (id: number, signal: Record<string, unknown>): MatchRow =>
  ({ id, status: 'new', distance_mi: null, draft: null, created_at: iso(-1_800_000), signal }) as unknown as MatchRow;

afterEach(() => vi.unstubAllEnvs());

describe('bidHidden and dropHiddenBids', () => {
  it('hide a stored bid while the flag is off, by source or by subtype, and never an ordinary row', () => {
    vi.stubEnv(BIDS_FLAG, '');
    for (const id of BID_SOURCE_IDS) expect(bidHidden({ source: id })).toBe(true);
    expect(bidHidden({ source: 'x', subtype: 'bid' })).toBe(true);
    expect(bidHidden({ source: 'x', data: { subtype: 'bid' } })).toBe(true);
    expect(bidHidden(permitSignal(2))).toBe(false);
    expect(bidHidden(null)).toBe(false);
    vi.stubEnv(BIDS_FLAG, '1');
    expect(bidHidden(bidSignal(1))).toBe(false);
  });

  it('dropHiddenBids reads object, one-item array and null signals', () => {
    const rows = [row(1, bidSignal(1)), { ...row(2, bidSignal(2)), signal: [bidSignal(2)] }, row(3, permitSignal(3)), { ...row(4, {}), signal: null }];
    expect(dropHiddenBids(rows, false).map((m) => m.id)).toEqual([3, 4]);
    expect(dropHiddenBids(rows, true).map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('web feed filter (app/app/page.tsx uses bidHidden on every loaded match)', () => {
  it('drops the stored bid with the flag off and keeps it with the flag on', () => {
    const rows = [row(1, bidSignal(1)), row(2, permitSignal(2))];
    const visible = (on: boolean) => rows.filter((m) => !bidHidden(m.signal as Parameters<typeof bidHidden>[0], on)).map((m) => m.id);
    expect(visible(false)).toEqual([2]);
    expect(visible(true)).toEqual([1, 2]);
  });
});

describe('mobile feed (buildAlerts)', () => {
  const deps = { userId: 'u1', locked: true, db: {} as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime() };

  it('returns no bid alert with the flag off, the permit alert still comes through', async () => {
    vi.stubEnv(BIDS_FLAG, '');
    const out = await buildAlerts([row(1, bidSignal(1)), row(2, permitSignal(2))], deps);
    expect(out.map((a) => a.matchId)).toEqual([2]);
  });

  it('returns the bid alert with the flag on', async () => {
    vi.stubEnv(BIDS_FLAG, '1');
    const out = await buildAlerts([row(1, bidSignal(1)), row(2, permitSignal(2))], deps);
    expect(out.map((a) => a.matchId)).toEqual([1, 2]);
  });
});

describe('push (pushEntriesFromMatches)', () => {
  const m = (id: number, user: string, s: ReturnType<typeof bidSignal>) => ({ id, user_id: user, created_at: iso(-60_000), signal: { id: s.id, title: s.title, city: s.city, source: s.source, expires_at: s.expires_at, occurred_at: s.occurred_at } });

  it('a member whose only new match is a stored bid gets no push with the flag off', () => {
    vi.stubEnv(BIDS_FLAG, '');
    expect(pushEntriesFromMatches([m(1, 'u1', bidSignal(1))], NOW.getTime()).size).toBe(0);
  });

  it('the permit still counts, the bid does not, and the flag on counts both', () => {
    const matches = [m(1, 'u1', bidSignal(1)), m(2, 'u1', permitSignal(2) as unknown as ReturnType<typeof bidSignal>)];
    vi.stubEnv(BIDS_FLAG, '');
    expect(pushEntriesFromMatches(matches, NOW.getTime()).get('u1')?.count).toBe(1);
    vi.stubEnv(BIDS_FLAG, '1');
    expect(pushEntriesFromMatches(matches, NOW.getTime()).get('u1')?.count).toBe(2);
  });
});

describe('digest (GET /api/cron/notify)', () => {
  const h = { sent: [] as { html: string; text: string }[], updates: [] as { ids: unknown }[] };

  function adminFake(matches: unknown[]) {
    return {
      from(table: string) {
        const q: Record<string, unknown> = {};
        let patch: unknown = null;
        for (const mth of ['select', 'eq', 'order']) q[mth] = () => q;
        q.range = () => Promise.resolve({ data: table === 'holler_matches' ? matches : [], error: null });
        q.update = (p: unknown) => ((patch = p), q);
        q.in = (_c: string, ids: unknown) => {
          if (patch) {
            h.updates.push({ ids });
            return Promise.resolve({ error: null });
          }
          return Promise.resolve({
            data: [{ user_id: 'u1', business_name: 'Acme Roofing', alert_email: true, subscription_status: 'active', trial_ends_at: null, last_notified_at: null, email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }],
            error: null,
          });
        };
        q.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
        return q;
      },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@acme.test' } }, error: null }) } },
    };
  }

  async function run() {
    vi.resetModules();
    h.sent.length = 0;
    h.updates.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv('CRON_SECRET', 's3cret');
    const matches = [
      { id: 1, user_id: 'u1', created_at: iso(-60_000), signal: { ...bidSignal(1), external_id: 'x1' } },
      { id: 2, user_id: 'u1', created_at: iso(-60_000), signal: { ...permitSignal(2), external_id: 'x2', title: 'Permit for a re-roof' } },
    ];
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake(matches) }));
    vi.doMock('@/lib/email', async (orig) => ({
      ...(await orig<typeof import('@/lib/email')>()),
      sendEmail: async (mail: (typeof h.sent)[number]) => (h.sent.push(mail), { ok: true, id: 'x' }),
    }));
    const { GET } = await import('@/app/api/cron/notify/route');
    await GET(new Request('http://localhost/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
    vi.useRealTimers();
    return { mail: h.sent.map((s) => s.html + s.text).join('\n'), marked: [...new Set(h.updates.flatMap((u) => u.ids as number[]))].sort() };
  }

  it('flag off: the email has the permit and not the bid, and the bid match is left unmarked', async () => {
    vi.stubEnv(BIDS_FLAG, '');
    const r = await run();
    expect(r.mail).toContain('Permit for a re-roof');
    expect(r.mail).not.toContain('REPLACE ROOFS AT TWO FIRE STATIONS');
    expect(r.marked).toEqual([2]);
  });

  it('flag on: the email has both', async () => {
    vi.stubEnv(BIDS_FLAG, '1');
    const r = await run();
    expect(r.mail).toContain('Permit for a re-roof');
    expect(r.mail).toContain('REPLACE ROOFS AT TWO FIRE STATIONS');
    expect(r.marked).toEqual([1, 2]);
  });
});

describe('health email (review P1-2)', () => {
  const LA = BID_DATASETS.find((d) => d.id === 'bids-la')!;

  it('missingEnvFor names the flag for a bid adapter while it is off, and nothing when it is on', () => {
    const a = buildBidAdapter(LA);
    vi.stubEnv(BIDS_FLAG, '');
    expect(missingEnvFor(a)).toEqual([BIDS_FLAG]);
    vi.stubEnv(BIDS_FLAG, '1');
    expect(missingEnvFor(a)).toEqual([]);
  });

  async function health(flag: string) {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.stubEnv(BIDS_FLAG, flag);
    for (const k of ['ADMIN_EMAIL', 'SUPPORT_EMAIL']) vi.stubEnv(k, '');
    const { buildBidAdapter: build, BID_DATASETS: sets } = await import('@/lib/signals/adapters/city-bids');
    const adapters = [
      { id: 'nws', label: 'NWS alerts', kind: 'alert', cadenceMinutes: 15, sourceUrl: 'x', fetch: async () => [] },
      build(sets.find((d) => d.id === 'bids-la')!),
    ];
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => new FakeDb() }));
    vi.doMock('@/lib/signals/registry', () => ({ ALL_ADAPTERS: adapters }));
    const { GET } = await import('@/app/api/cron/health/route');
    const res = await GET(new Request('http://x.test/api/cron/health?dry=1', { headers: { authorization: 'Bearer s3cret' } }));
    return res.json();
  }

  it('flag off: bids-la is "not configured", is not a never_ran problem, and the ingest monitor does not judge it', async () => {
    const body = await health('');
    expect(body.notConfigured).toEqual([`bids-la: needs ${BIDS_FLAG}`]);
    expect(JSON.stringify(body.problems)).not.toContain('bids-la');
    expect(body.sources.find((s: { id: string }) => s.id === 'bids-la')).toMatchObject({ status: 'not_configured', problems: [] });
    expect(JSON.stringify(body.monitor)).not.toContain('bids-la');
  });

  it('flag on: a bid adapter that has never run is reported like any other source', async () => {
    const body = await health('1');
    expect(body.notConfigured).toEqual([]);
    expect(body.sources.find((s: { id: string }) => s.id === 'bids-la')?.problems).toContain('never_ran');
  });
});

describe('open bids through the opportunity label (r13-rules rebase)', () => {
  const deps = { userId: 'u1', locked: true, db: {} as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: ['roofing'] };
  const stored = (over: Record<string, unknown> = {}) => ({ ...bidSignal(1), categories: ['roofing'], dueDate: '2026-12-10', bidBuyer: 'Water & Power', ...over });

  it('an open bid with the member\'s trade is act_now with the due day as the deadline, and the card line has the days left', async () => {
    vi.stubEnv(BIDS_FLAG, '1');
    const [a] = await buildAlerts([row(1, stored())], { ...deps, locked: false });
    expect(a.label).toBe('act_now');
    expect(a.deadline).toBe('2026-12-10T12:00:00.000Z');
    expect(a.bidLine).toBe('Buyer: Water & Power. Due Dec 10, 2026, 19 days left.');
  });

  it('a locked member gets no bid line (final review P2-7: the web already nulls it)', async () => {
    vi.stubEnv(BIDS_FLAG, '1');
    const [a] = await buildAlerts([row(1, stored())], deps);
    expect(a.label).toBe('act_now');
    expect(a.bidLine).toBeNull();
  });

  it('a bid whose due date has passed is dropped, not demoted to coming_soon (review P2-14)', async () => {
    vi.stubEnv(BIDS_FLAG, '1');
    expect(await buildAlerts([row(1, stored({ dueDate: '2026-11-20', expires_at: iso(-3_600_000) }))], deps)).toEqual([]);
    // an open bid next to it stays
    const kept = await buildAlerts([row(1, stored({ dueDate: '2026-11-20', expires_at: iso(-3_600_000) })), row(2, stored({ dueDate: '2026-12-10', expires_at: iso(19 * 86_400_000) }))], deps);
    expect(kept.map((a) => a.matchId)).toEqual([2]);
  });

  it('a record that is not a bid carries no bid line', async () => {
    vi.stubEnv(BIDS_FLAG, '1');
    const [a] = await buildAlerts([row(2, permitSignal(2))], deps);
    expect(a.bidLine).toBeNull();
  });

  it('the digest prints the Act now chip, the deadline and the bid line, in html and text', () => {
    const mail = renderDigest({
      businessName: 'Acme Roofing',
      items: [{ kind: 'contract', source: 'bids-la', subtype: 'bid', title: 'REPLACE ROOFS AT TWO FIRE STATIONS', occurredAt: iso(-3_600_000), sourceUrl: 'https://www.rampla.org/x', label: 'act_now', deadline: '2026-12-10T12:00:00.000Z', bidLine: 'Buyer: Water & Power. Due Dec 10, 2026, 19 days left.' }],
      appUrl: 'https://localholler.com/app',
      unsubscribeUrl: 'https://localholler.com/u',
      now: NOW,
    });
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain('Act now');
      expect(body).toContain('Deadline: Dec 10, 2026');
      expect(body).toContain('19 days left');
      expect(body).toContain('Open bid');
    }
  });
});
