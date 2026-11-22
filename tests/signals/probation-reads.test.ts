// Source probation on the read side: every read of holler_signals that can reach a member or a public page leaves probation rows out.
// Behaviour tests use the repo's in-memory fakes (tests/ops/fakedb.ts, the preview test's chain double); the guard at the end reads the
// source so a new read of holler_signals cannot be added without a decision. Rows are hand-written.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({}) }) }));

import { createStore } from '@/lib/lifecycle/store';
import { missedSince } from '@/lib/lifecycle/missed';
import { recentPreviewFor, type PreviewProfile } from '@/lib/preview/recent';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const U = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('builders (/app/builders): permit reads', () => {
  const profile = { categories: ['plumbing'], lat: 30.27, lon: -97.74, state: 'TX', radius_mi: 25 };
  const sig = (id: number, over: Record<string, unknown> = {}) => ({
    id, kind: 'permit', title: 'Plumbing permit in Austin', source: 's', lat: 30.28, lon: -97.75, state: 'TX', severity: 2, occurred_at: day(2), categories: ['plumbing'], ...over,
  });
  it('a contractor on a probation permit is not listed', async () => {
    await import('../builders/fake-or');
    const db = new FakeDb({
      holler_profiles: [{ user_id: 'u1', subscription_status: 'active', trial_ends_at: null }],
      holler_signals: [sig(1), sig(2, { data: { probation: true } })],
      holler_signal_contacts: [
        { id: 1, signal_id: 1, role: 'contractor', name: 'Plain Plumbing Co', phone: null, website: null },
        { id: 2, signal_id: 2, role: 'contractor', name: 'Probation Pipes LLC', phone: null, website: null },
      ],
    });
    const { loadActiveBuilders } = await import('@/lib/builders/load');
    const out = await loadActiveBuilders(db as never, 'u1', profile, NOW);
    expect(out.builders.map((b) => b.name)).toEqual(['Plain Plumbing Co']);
  });
});

describe('lifecycle emails', () => {
  it('matchesOf leaves a probation row out of the "what you got" list', async () => {
    const s = (id: number, over: Record<string, unknown> = {}) => ({ id, source: 'nws', kind: 'alert', title: `T${id}`, city: 'Atlanta', state: 'GA', severity: 2, occurred_at: `2026-11-${10 + id}T00:00:00Z`, subtype: null, ...over });
    const db = new FakeDb({
      holler_matches: [
        { id: 1, user_id: U, status: 'new', created_at: '2026-11-11T00:00:00Z', signal: s(1) },
        { id: 2, user_id: U, status: 'new', created_at: '2026-11-12T00:00:00Z', signal: s(2, { probation: 'true' }) },
        { id: 3, user_id: U, status: 'new', created_at: '2026-11-13T00:00:00Z', signal: s(3, { data: { probation: true } }) },
      ],
    });
    const r = await createStore(db as never).matchesOf(U);
    expect(r.items.map((i) => i.title)).toEqual(['T1']);
  });
});

describe('preview ("near you in the last 90 days")', () => {
  type Row = Record<string, unknown>;
  const ATL = { lat: 33.749, lon: -84.388 };
  let n = 1;
  const row = (over: Row): Row => ({ id: n++, source: 'spc', kind: 'report', title: 'Hail report', opp_type: 'hail', opp_hail: '1.5', city: 'Atlanta', state: 'GA', ...ATL, categories: ['roofing'], severity: 2, occurred_at: day(3), subtype: null, ...over });
  const fakeDb = (a: Row[]) => {
    const calls: string[][] = [];
    const db = {
      from: (t: string) => {
        const log = [`from:${t}`];
        calls.push(log);
        const chain: Record<string, unknown> = {};
        for (const m of ['neq', 'overlaps', 'gte', 'lte', 'order', 'limit', 'not', 'is', 'or', 'in']) chain[m] = (...args: unknown[]) => (log.push(`${m}:${args.map(String).join(',')}`), chain);
        chain.select = () => chain;
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve(res({ data: log.some((f) => f.startsWith('is:lat')) || log.some((f) => f.startsWith('in:source,')) ? [] : a, error: null }));
        return chain;
      },
    };
    return { db: db as never, calls };
  };
  const profile: PreviewProfile = { categories: ['roofing'], ...ATL, state: 'GA', radius_mi: 25, plan: null, subscription_status: 'trialing', extra_areas: null, keywords: null };

  it('missedSince (the lifecycle "you missed N" count) skips a probation row too', async () => {
    const f = fakeDb([row({}), row({ probation: 'true' }), row({ probation: 'true' })]);
    const since = new Date(NOW.getTime() - 14 * 86_400_000);
    const r = await missedSince(f.db, { ...profile, radius_mi: 25 } as never, since, NOW);
    expect(r.count).toBe(1);
    expect(f.calls.filter((c) => c[0] === 'from:holler_signals').every((c) => c.includes('is:data->>probation,null'))).toBe(true);
  });

  it('does not count or show a probation row, and asks SQL to leave them out', async () => {
    const f = fakeDb([row({}), row({ probation: 'true', title: 'PROBATION hail' }), row({ probation: 'true' })]);
    const p = await recentPreviewFor(profile, { db: f.db, now: NOW });
    expect(p?.total).toBe(1);
    expect(JSON.stringify(p)).not.toContain('PROBATION');
    expect(f.calls.filter((c) => c[0] === 'from:holler_signals').every((c) => c.includes('is:data->>probation,null'))).toBe(true);
  });
});

// ---- guard: every read of holler_signals is either filtered or justified ---------------------------------------------------------
const ROOT = join(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Files outside the probation handling that touch holler_signals, and why that is fine. Anything not listed here and not mentioning
 * probation fails the guard, so a new reader has to be filtered (lib/signals/probation.ts) or added here with a reason.
 */
const NOT_MEMBER_VISIBLE: Record<string, string> = {
  'lib/signals/store.ts': 'the scan writer: insert, dedupe, prune and the matcher read-back (INSERTED_SIGNAL_COLUMNS carries the flag); matching skips probation rows',
  'lib/signals/rematch.ts': 'reads rows only to feed matchSignals, which skips probation rows (and prunes a stale match if one ever existed)',
  'lib/signals/mapping/remap.ts': 'internal category re-map of stored rows (data is rewritten with the flag kept); its rematch goes through matchSignals',
  'lib/signals/member-opportunity.ts': 'comment only',
  'lib/signals/request-visibility.ts': 'comment only (resident requests, source holler-request, never a probation source)',
  'lib/builders/active.ts': 'pure aggregation of rows loadActiveBuilders already filtered (doc comment mentions holler_signals.id)',
  'lib/signals/adapters/permit-privacy.ts': 'comment only',
  'lib/signals/adapters/socrata.ts': 'comment only',
  'lib/moat/run.ts': 'outcome questions are asked only for matches, and a probation row has none; reads public fields by id',
  'lib/monitor/run.ts': 'operator health: counts rows created since a time, so probation rows are counted on purpose',
  'lib/contacts/types.ts': 'comment only',
  'lib/outreach/loader.ts': 'comment only',
  'lib/requests/signal.ts': 'resident requests (source holler-request) only',
  'lib/requests/details.ts': 'resident requests only',
  'lib/requests/tokens.ts': 'comment only',
  'lib/requests/service.ts': 'resident requests only',
  'lib/requests/scrub.ts': 'comment only',
  'lib/storms/data.ts': 'reads sources spc and fema only (two existing sources, never on probation)',
  'lib/storms/report.ts': 'comment only (sources spc and fema)',
  'lib/seo/client.ts': 'comment only',
  'lib/seo/summarize.ts': 'comment only (row type)',
  'lib/seo/indexnow.ts': 'reads holler_place_counts and weekly place rows for places the scan touched; probation rows have no place_slug and are not passed in',
  'lib/ai/classify.ts': 'filters (see import)',
  'app/api/draft/route.ts': 'drafts for a match the member owns; a probation row has no match',
  'app/check/page.tsx': 'comment only (loadCheck filters)',
  'lib/check/scope.ts': 'comment only',
  'lib/lifecycle/missed.ts': 'filters (see import)',
};

describe('guard: reads of holler_signals', () => {
  const files = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))].map((f) => relative(ROOT, f));
  const readers = files.filter((f) => /holler_signals(_near)?\b/.test(readFileSync(join(ROOT, f), 'utf8')));

  it('finds the readers (the guard itself works)', () => {
    expect(readers.length).toBeGreaterThan(25);
    expect(readers).toContain('lib/seo/data.ts');
    expect(readers).toContain('lib/push/notify.ts');
  });

  it('every reader filters probation rows or is listed with a reason', () => {
    const unhandled = readers.filter((f) => !/probation/i.test(readFileSync(join(ROOT, f), 'utf8')) && !(f in NOT_MEMBER_VISIBLE));
    expect(unhandled).toEqual([]);
  });

  it('every listed exception still exists and still reads holler_signals (a stale entry is a lie)', () => {
    for (const f of Object.keys(NOT_MEMBER_VISIBLE)) expect(readers, f).toContain(f);
  });

  it('public pages filter in SQL on every read: one probation filter per from(holler_signals)', () => {
    for (const f of ['lib/seo/data.ts', 'lib/seo/week-data.ts', 'lib/seo/trade-data.ts', 'lib/seo/home-map.ts', 'lib/seo/home-live.ts', 'lib/seo/guide-data.ts', 'lib/seo/national-data.ts', 'lib/check/coverage.ts']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const reads = (src.match(/\.from\('holler_signals'\)/g) ?? []).length;
      const filters = (src.match(/\.is\(PROBATION_COLUMN, null\)/g) ?? []).length;
      expect(filters, f).toBeGreaterThanOrEqual(reads);
    }
  });
});
