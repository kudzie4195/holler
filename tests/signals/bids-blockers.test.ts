/**
 * Round 14: the bids blockers that had to be fixed before HOLLER_BIDS_ENABLED can ever be switched on
 * (review P2-12 flag name, P2-14 closed bids dropped, P2-16 replay command). P2-13 (public pages) is tests/integration/bids-public.test.ts.
 * Inputs are hand-written (assumed). Test clock 2026-11-21T22:00:00Z.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BIDS_FLAG } from '@/lib/signals/bid-sources';
import { missingEnvFor } from '@/lib/signals/run';
import { buildBidAdapter, BID_DATASETS } from '@/lib/signals/adapters/city-bids';
import type { Adapter } from '@/lib/signals/types';
import { dropHiddenBids } from '@/lib/signals/bid-sources';
import { pushEntriesFromMatches } from '@/lib/push/notify';
import { renderDigest } from '@/lib/email/templates';

const h = vi.hoisted(() => ({ rows: [] as unknown[], seen: [] as { title: string; label?: string }[] }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({
  requireProfile: async () => ({
    user: { id: 'u1' },
    profile: {
      user_id: 'u1', business_name: 'Acme', categories: ['roofing'], zip: '90012', city: 'Los Angeles', state: 'CA', lat: 34.05, lon: -118.24,
      radius_mi: 25, alert_email: true, subscription_status: 'active', trial_ends_at: '2026-12-01T00:00:00Z', plan: 'starter',
      stripe_customer_id: null, stripe_subscription_id: null, email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const q: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'eq', 'order']) q[m] = () => q;
    q.limit = async () => ({ data: h.rows, error: null });
    return q;
  },
}));
vi.mock('@/components/feed', () => ({
  Feed: ({ items }: { items: { title: string; label?: string }[] }) => (h.seen.push(...items), createElement('ul', null, items.map((i) => createElement('li', { key: i.title }, i.title)))),
  LockedFeed: () => null,
}));

const NOW = new Date('2026-11-21T22:00:00Z');
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const DAY = 86_400_000;

afterEach(() => vi.unstubAllEnvs());

describe('P2-12: missingEnvFor names the right flag for each flagged adapter', () => {
  const off = (over: Partial<Adapter>): Adapter => ({ id: 'x', label: 'X', kind: 'alert', cadenceMinutes: 15, sourceUrl: 'https://x.test', fetch: async () => [], enabled: () => false, ...over });

  it('a flagged adapter names its own flag, not the bids flag', () => {
    expect(missingEnvFor(off({ flag: 'HOLLER_OTHER_ENABLED' }), {})).toEqual(['HOLLER_OTHER_ENABLED']);
    expect(missingEnvFor(off({ flag: 'HOLLER_OTHER_ENABLED' }), {})).not.toContain(BIDS_FLAG);
  });
  it('a flagged adapter with no flag name says "feature flag", never another adapter\'s flag', () => {
    expect(missingEnvFor(off({}), {})).toEqual(['feature flag']);
  });
  it('lists the missing keys and the flag together, and nothing when enabled', () => {
    expect(missingEnvFor(off({ requiresEnv: ['A_KEY', 'B_KEY'], flag: 'F' }), { A_KEY: 'set' })).toEqual(['B_KEY', 'F']);
    expect(missingEnvFor(off({ enabled: () => true, flag: 'F' }), {})).toEqual([]);
    expect(missingEnvFor({ ...off({}), enabled: undefined }, {})).toEqual([]);
  });
  it('every city-bid adapter names HOLLER_BIDS_ENABLED while it is off, and every flagged registered adapter has a flag name', async () => {
    vi.stubEnv(BIDS_FLAG, '');
    for (const d of BID_DATASETS) expect(missingEnvFor(buildBidAdapter(d), {}), d.id).toEqual([BIDS_FLAG]);
    const { ALL_ADAPTERS } = await import('@/lib/signals/registry');
    for (const a of ALL_ADAPTERS) if (a.enabled) expect(a.flag, a.id).toBeTruthy();
  });
});

describe('P2-14: a closed bid is dropped, not demoted to "Coming soon ... closed"', () => {
  const bid = (id: number, over: Record<string, unknown> = {}) => ({
    id, source: 'bids-la', kind: 'contract', subtype: 'bid', title: `BID ${id}`, summary: null, url: 'https://www.rampla.org/s/1', city: 'Los Angeles', state: 'CA',
    county: null, zip: null, severity: 2, categories: ['roofing'], occurred_at: iso(-3 * DAY), expires_at: iso(10 * DAY), dueDate: '2026-12-01', bidBuyer: 'Water & Power', ...over,
  });
  const match = (id: number, signal: Record<string, unknown>) => ({ id, user_id: 'u1', status: 'new', distance_mi: null, draft: null, created_at: iso(-3_600_000), signal });

  it('web feed: the open bid stays, the closed one is gone (flag on)', async () => {
    vi.stubEnv(BIDS_FLAG, '1');
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    h.seen.length = 0;
    h.rows = [match(1, bid(1)), match(2, bid(2, { expires_at: iso(-3_600_000), dueDate: '2026-11-21' }))];
    const { default: AppHome } = await import('@/app/app/page');
    const html = renderToStaticMarkup(await AppHome({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
    vi.useRealTimers();
    expect(html).toContain('BID 1');
    expect(html).not.toContain('BID 2');
    expect(h.seen.map((i) => i.title)).toEqual(['BID 1']);
    expect(h.seen[0].label).toBe('act_now');
  });

  it('push: a closed bid is never counted', () => {
    vi.stubEnv(BIDS_FLAG, '1');
    const m = pushEntriesFromMatches(
      [match(1, bid(1, { id: 11, occurred_at: iso(-3_600_000) })), match(2, bid(2, { id: 12, expires_at: iso(-60_000), occurred_at: iso(-3_600_000) }))] as never,
      NOW.getTime(),
    );
    expect(m.get('u1')?.matchIds).toEqual([1]);
  });

  it('digest filter: dropHiddenBids drops the closed bid and keeps the open one while the flag is on', () => {
    const rows = [match(1, bid(1)), match(2, bid(2, { expires_at: iso(-60_000) })), match(3, { id: 3, source: 'nws', kind: 'alert', title: 'x', expires_at: iso(-DAY) })];
    expect(dropHiddenBids(rows, true, NOW.getTime()).map((r) => r.id)).toEqual([1, 3]);
    expect(dropHiddenBids(rows, false, NOW.getTime()).map((r) => r.id)).toEqual([3]);
  });

  it('the digest never prints "closed" for a bid it was given: a closed bid is not in the items the cron builds', () => {
    const mail = renderDigest({
      businessName: 'Acme', items: [{ kind: 'contract', source: 'bids-la', subtype: 'bid', title: 'BID 1', occurredAt: iso(-DAY), sourceUrl: 'https://www.rampla.org/s/1', label: 'act_now', bidLine: 'Buyer: Water & Power. Due Dec 1, 2026, 10 days left.' }],
      appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW,
    });
    expect(mail.html + mail.text).not.toMatch(/closed/i);
  });
});

describe('P2-16: the documented replay command runs', () => {
  it('`npm run replay:labels -- <path>` exits 0 and writes the report (no "@/lib/geo" error)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holler-replay-'));
    const out = join(dir, 'replay.md');
    execFileSync('npm', ['run', '--silent', 'replay:labels', '--', out], { cwd: process.cwd(), stdio: 'pipe', timeout: 60_000 });
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf8')).toContain('Generated by `scripts/replay-labels.ts`');
  }, 90_000);

  it('the script header documents exactly that command, and package.json defines it', () => {
    const header = readFileSync(join(process.cwd(), 'scripts/replay-labels.ts'), 'utf8').slice(0, 2500);
    expect(header).toContain('npm run replay:labels');
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['replay:labels']).toContain('JITI_TSCONFIG_PATHS=1');
    expect(pkg.scripts['replay:labels']).toContain('scripts/replay-labels.ts');
  });
});
