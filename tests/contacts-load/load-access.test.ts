import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import { FakeDb } from '../ops/fakedb';
import { contactsForMember, statusGrantsAccess } from '@/lib/contacts/load';

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-11-17T12:00:00Z');
const FUTURE = '2026-11-20T00:00:00Z';
const PAST = '2026-11-01T00:00:00Z';

function seed(status: string | null, trialEnd: string | null) {
  return new FakeDb({
    holler_profiles: [{ user_id: ME, subscription_status: status, trial_ends_at: trialEnd }],
    holler_matches: [{ id: 1, user_id: ME, signal_id: 10 }],
    holler_signal_contacts: [
      { id: 1, signal_id: 10, role: 'contractor', name: 'ACME ROOFING LLC', attn: null, address: '', city: 'SKOKIE', state: 'IL', zip: '60076', phone: null, email: null, website: null },
    ],
  });
}
const call = (db: FakeDb) => contactsForMember(db as unknown as SupabaseClient, ME, [10], NOW);

afterEach(() => vi.restoreAllMocks());

describe('F10: access is an allow-list on the exact status', () => {
  const cases: Array<[string | null, string | null, boolean, string]> = [
    ['trialing', FUTURE, true, 'a new trial account (the 0001 default)'],
    ['trialing', PAST, false, 'an expired trial'],
    ['trialing', null, false, 'a trial with no end date'],
    ['trialing', 'garbage', false, 'a trial with an unreadable end date'],
    ['active', PAST, true, 'paid, trial long over'],
    ['active', null, true, 'paid, no trial date'],
    ['past_due', PAST, true, 'past due keeps access'],
    ['canceled', FUTURE, false, 'canceled with trial days left'],
    ['Canceled', FUTURE, false, 'different case'],
    [' canceled', FUTURE, false, 'leading space'],
    ['unpaid', FUTURE, false, 'unpaid'],
    ['paused', FUTURE, false, 'paused'],
    ['incomplete', FUTURE, false, 'unknown word'],
    ['Active', PAST, false, 'wrong case never counts as paid'],
    ['', FUTURE, false, 'empty string'],
    [null, FUTURE, false, 'null status'],
  ];
  for (const [status, end, ok, why] of cases) {
    it(`${JSON.stringify(status)} / ${JSON.stringify(end)} -> ${ok ? 'contacts' : 'empty'} (${why})`, async () => {
      const m = await call(seed(status, end));
      expect(m.size).toBe(ok ? 1 : 0);
      expect(statusGrantsAccess(status, end, NOW.getTime())).toBe(ok);
    });
  }
  it('a trial ending exactly now is over', () => {
    expect(statusGrantsAccess('trialing', NOW.toISOString(), NOW.getTime())).toBe(false);
  });
  it('migration 0001 creates profiles as trialing, which the allow-list accepts', () => {
    const sql = readFileSync(path.resolve(__dirname, '../../supabase/migrations/0001_holler.sql'), 'utf8');
    expect(sql).toMatch(/subscription_status text not null default 'trialing'/);
    expect(statusGrantsAccess('trialing', new Date(NOW.getTime() + 7 * 86_400_000).toISOString(), NOW.getTime())).toBe(true);
  });
});

describe('P2-1: no caller-supplied value influences access', () => {
  it('the profile is always read, and the match query is still owner-filtered', async () => {
    const db = seed('active', null);
    const m = await call(db);
    expect([...m.keys()]).toEqual([10]);
    expect(db.calls).toContain('holler_profiles.select');
    expect(db.calls).toContain('holler_matches.select');
    const db2 = new FakeDb({
      holler_profiles: [{ user_id: ME, subscription_status: 'active', trial_ends_at: null }],
      holler_matches: [{ id: 2, user_id: OTHER, signal_id: 10 }],
      holler_signal_contacts: [{ id: 1, signal_id: 10, role: 'site', name: '', address: '1 A St' }],
    });
    expect((await call(db2)).size).toBe(0);
  });
  it('a hint passed anyway (old call shape) is ignored: a canceled profile gets nothing, no contacts are read', async () => {
    const db = seed('canceled', FUTURE);
    const lying = { access: { userId: ME, subscriptionStatus: 'active', trialEndsAt: null } };
    const m = await (contactsForMember as unknown as (...a: unknown[]) => Promise<Map<number, unknown[]>>)(db as unknown as SupabaseClient, ME, [10], NOW, lying);
    expect(m.size).toBe(0);
    expect(db.calls).toContain('holler_profiles.select');
    expect(db.calls).not.toContain('holler_signal_contacts.select');
  });
  it('a user with no profile row gets nothing', async () => {
    const db = new FakeDb({ holler_profiles: [], holler_matches: [{ id: 1, user_id: ME, signal_id: 10 }], holler_signal_contacts: [{ id: 1, signal_id: 10, role: 'site', name: '', address: '1 A St' }] });
    expect((await call(db)).size).toBe(0);
  });
  it('the exported API has no hint types', () => {
    const src = readFileSync(path.resolve(__dirname, '../../lib/contacts/load.ts'), 'utf8');
    expect(src).not.toMatch(/AccessHint|ContactsOptions/);
  });
});

describe('L2-1: failures are logged with the step and the error code only', () => {
  it('each failing table logs once with no row data, ids or names', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const k of ['holler_profiles.select', 'holler_matches.select', 'holler_signal_contacts.select']) {
      const db = seed('trialing', FUTURE);
      db.failOn[k] = `boom ${ME} ACME ROOFING LLC 60076`;
      expect((await call(db)).size).toBe(0);
    }
    const lines = err.mock.calls.map((c) => c.map(String).join(' '));
    expect(lines).toEqual([
      'contacts: load failed profile unknown',
      'contacts: load failed matches unknown',
      'contacts: load failed contacts unknown',
    ]);
    for (const l of lines) expect(l).not.toMatch(/ACME|60076|1111|boom/);
  });
  it('an error with a code logs the code; a throwing client logs exception', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const builder = (res: unknown): unknown => {
      const b: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'in', 'limit', 'order']) b[k] = () => b;
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
      return b;
    };
    const coded = { from: () => builder({ data: null, error: { code: '42P01', message: 'relation "holler_signal_contacts" does not exist' } }) } as unknown as SupabaseClient;
    await contactsForMember(coded, ME, [10], NOW);
    const throwing = { from() { throw new Error('secret ' + ME); } } as unknown as SupabaseClient;
    await contactsForMember(throwing, ME, [10], NOW);
    const lines = err.mock.calls.map((c) => c.map(String).join(' '));
    expect(lines).toEqual(['contacts: load failed profile 42P01', 'contacts: load failed exception unknown']);
  });
  it('no log for the normal no-access and no-contacts outcomes', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await call(seed('canceled', FUTURE));
    await call(new FakeDb({ holler_profiles: [] }));
    expect(err).not.toHaveBeenCalled();
  });
});

describe('L1-3: server-only', () => {
  it('both modules import server-only', () => {
    for (const f of ['lib/contacts/load.ts', 'lib/outreach/loader.ts']) {
      expect(readFileSync(path.resolve(__dirname, '../..', f), 'utf8')).toMatch(/^import 'server-only';/m);
    }
  });
});
