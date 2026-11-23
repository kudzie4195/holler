// Round 19 review of UNIFY (gates/r19/review/review-UNIFY.md): the reviewer's "FINDING" probes for defects 1, 3, 4, 6, 7 and 8, copied
// from gates/r19/logs/REV-UNIFY-probe-tests with each assertion flipped to the fixed behaviour. Defect 5 (name check) is left to
// integration and defect 2 to the engine worker, so their probes are not here.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import '../builders/fake-or';
import { securityHeaderRules, TOKEN_PAGE_PATHS } from '@/lib/security-headers';
import { joinWaitlist } from '@/lib/waitlist/service';
import { contactsForMember } from '@/lib/contacts/load';
import { computeSourceStates, summarizeSourceStates } from '@/lib/signals/source-state';
import { adapters as carto } from '@/lib/signals/adapters/carto';
import type { Db } from '@/lib/signals/store';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-22T12:00:00Z');

function referrerPolicyFor(path: string): string | undefined {
  let v: string | undefined;
  for (const r of securityHeaderRules()) {
    const hit = r.source === '/:path*' || r.source === path;
    if (!hit) continue;
    for (const h of r.headers) if (h.key === 'Referrer-Policy') v = h.value;
  }
  return v;
}

describe('FIXED (was FINDING P3 H, defect 6): /waitlist/confirm is a token page', () => {
  it('it gets no-referrer like every other token page', () => {
    expect((TOKEN_PAGE_PATHS as readonly string[]).includes('/waitlist/confirm')).toBe(true);
    expect(referrerPolicyFor('/waitlist/confirm')).toBe('no-referrer');
  });
});

describe('FIXED (was FINDING P3, defect 8): the dead-link page promises a new link, and the site sends one again', () => {
  it('the page text stays, and the sign-up path signs and emails a confirm link', async () => {
    // Round 19 integration: the words moved to lib/i18n (wl.confirm.*); the rendered dead-link page is checked instead of the source.
    const { GET } = await import('@/app/waitlist/confirm/route');
    expect(await GET(new Request('https://localholler.com/waitlist/confirm?token=bad')).text()).toContain('Check your ZIP code again to get a new link.');
    expect(readFileSync('lib/waitlist/deps.ts', 'utf8')).toMatch(/signScopedToken/);
    expect(readFileSync('lib/waitlist/deps.ts', 'utf8')).toMatch(/sendEmail/);
    expect(readFileSync('lib/waitlist/service.ts', 'utf8')).toMatch(/sendConfirm/);
  });
});

describe('FIXED (was FINDING P1 F, defect 1): a sign-up needs proof that the address belongs to the visitor', () => {
  const uncovered = '99501'; // Anchorage: no local source within 25 miles
  it('one POST stores a row with the consent version in the double opt-in table and sends one confirmation; nothing is "on the list" yet', async () => {
    const rows: Record<string, unknown>[] = [];
    const sent: { to: string; confirmUrl: string }[] = [];
    const deps = {
      db: {
        upsert: async (row: Record<string, unknown>) => (rows.push(row), { error: null }),
        find: async () => ({ data: { id: '6f1c2b0a-1d2e-4f3a-9b8c-7d6e5f4a3b2c', confirmed_at: null, unsubscribed_at: null }, error: null }),
      },
      hit: async () => 'allowed' as const,
      signToken: (id: string) => `t.${id}`,
      sendConfirm: async (m: { to: string; confirmUrl: string }) => (sent.push(m), true),
      siteUrl: 'https://localholler.com',
    };
    const res = await joinWaitlist(deps as never, { email: 'someone.else@example.com', zip: uncovered, trade: 'roofing', page: 'check', ip: '203.0.113.9' });
    expect(res).toEqual({ code: 'ok' });
    expect(rows).toEqual([expect.objectContaining({ email: 'someone.else@example.com', zip: uncovered, trade: 'roofing', consent_version: 'v1-2026-11' })]);
    expect(rows[0]).not.toHaveProperty('confirmed_at');
    // Round 24: `trade` is passed only for a ZIP Holler already serves (a trade-level waitlist); this ZIP is not served, so it is null.
    expect(sent).toEqual([{ to: 'someone.else@example.com', confirmUrl: expect.stringMatching(/\/waitlist\/confirm\?token=/), place: expect.any(String), trade: null }]);
    expect(readFileSync('lib/waitlist/deps.ts', 'utf8')).toMatch(/holler_zip_waitlist|WAITLIST_TABLE/);
    expect(readFileSync('lib/waitlist/service.ts', 'utf8')).toMatch(/WAITLIST_TABLE = 'holler_zip_waitlist'/);
  });
});

describe('FIXED (was FINDING P2, defect 3): the builders panel shows a phone only for permits the member holds a match for', () => {
  it('contactsForMember gives nothing for an unmatched permit; the panel gives the company name and no phone', async () => {
    const db = new FakeDb({
      holler_profiles: [{ user_id: 'u1', subscription_status: 'active', trial_ends_at: null }],
      holler_matches: [],
      holler_signals: [{ id: 1, kind: 'permit', title: 'Roof permit in Austin', source: 's', lat: 30.28, lon: -97.75, state: 'TX', severity: 2, occurred_at: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(), categories: ['roofing'] }],
      holler_signal_contacts: [{ id: 1, signal_id: 1, role: 'contractor', name: 'Acme Roofing LLC', phone: '512-555-0142', website: null }],
    });
    expect((await contactsForMember(db as never, 'u1', [1], NOW)).size).toBe(0);
    const { loadActiveBuilders } = await import('@/lib/builders/load');
    const out = await loadActiveBuilders(db as never, 'u1', { categories: ['plumbing'], lat: 30.27, lon: -97.74, state: 'TX', radius_mi: 25 }, NOW);
    expect(out.builders).toEqual([expect.objectContaining({ name: 'Acme Roofing LLC', phone: null, permits: 1 })]);
  });
});

describe('FIXED (was FINDING P2, defect 4): no builders cost on the /app render itself', () => {
  it('the page does not call the loader; a cached panel (15 minutes, remote) renders in its own Suspense', () => {
    const page = readFileSync('app/app/page.tsx', 'utf8');
    expect(page).not.toMatch(/from '@\/lib\/builders\/load'/);
    expect(page).not.toMatch(/loadActiveBuilders\(/);
    expect(page).toMatch(/<Suspense fallback=\{null\}>\s*<BuildersPanel /);
    const cached = readFileSync('lib/builders/cached.ts', 'utf8');
    expect(cached).toMatch(/'use cache: remote'/);
    expect(cached).toMatch(/revalidate: 900/);
  });
});

describe('FIXED (was FINDING P3, defect 7): samples table missing, probation sources are "not set up", never unavailable', () => {
  it.each([
    ['PGRST205', "Could not find the table 'public.holler_source_samples' in the schema cache"],
    ['42P01', 'relation "public.holler_source_samples" does not exist'],
  ])('defaultAdapters + computeSourceStates with the table missing (%s)', async (code, message) => {
    const { defaultAdapters, loadSourceStates, SAMPLES_TABLE_MISSING_ENV } = await import('@/lib/signals/source-state-load');
    const db = new FakeDb({ holler_source_health: [], holler_scan_runs: [] });
    db.failOn['holler_source_samples.select'] = message;
    db.failCode['holler_source_samples.select'] = code;
    const list = (await defaultAdapters(db as unknown as Db)).filter((a) => carto.some((c) => c.id === a.id));
    expect(list.map((a) => a.missingEnv)).toEqual(carto.map(() => [SAMPLES_TABLE_MISSING_ENV]));
    const results = computeSourceStates({ adapters: list, health: [], runs: [], now: NOW });
    expect(results.map((r) => r.state)).toEqual(carto.map(() => 'not_set_up'));
    expect(summarizeSourceStates(results).behind).toBe(0);
    const all = await loadSourceStates(db as unknown as Db, NOW);
    for (const c of carto) expect(all.find((r) => r.id === c.id)!.state).toBe('not_set_up');
  });

  it('with the table there, nothing changes (a probation source is judged like any source)', async () => {
    const { defaultAdapters } = await import('@/lib/signals/source-state-load');
    const db = new FakeDb({ holler_source_samples: [] });
    const list = (await defaultAdapters(db as unknown as Db)).filter((a) => carto.some((c) => c.id === a.id));
    expect(list.every((a) => a.missingEnv.length === 0)).toBe(true);
  });
});
