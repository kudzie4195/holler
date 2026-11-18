import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeDb } from '../ops/fakedb';
import { contactsForMember } from '@/lib/contacts/load';

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-11-17T12:00:00Z');

function seed(myStatus = 'trialing', myTrialEnd = '2026-11-20T00:00:00Z') {
  return new FakeDb({
    holler_profiles: [
      { user_id: ME, subscription_status: myStatus, trial_ends_at: myTrialEnd },
      { user_id: OTHER, subscription_status: 'active', trial_ends_at: '2026-01-01T00:00:00Z' },
    ],
    holler_matches: [
      { id: 1, user_id: ME, signal_id: 10 },
      { id: 2, user_id: OTHER, signal_id: 20 },
    ],
    holler_signal_contacts: [
      { id: 1, signal_id: 10, role: 'site', name: '', attn: null, address: '2150 N DAMEN', city: 'Chicago', state: 'IL', zip: null, phone: null, email: null, website: null },
      { id: 2, signal_id: 10, role: 'contractor', name: 'ACME ROOFING LLC', attn: null, address: '', city: 'SKOKIE', state: 'IL', zip: '60076', phone: '312-555-0100', email: null, website: null },
      { id: 3, signal_id: 20, role: 'business', name: 'OTHER CAFE', attn: null, address: '', city: null, state: null, zip: null, phone: null, email: null, website: null },
    ],
  });
}
const call = (db: FakeDb, ids: number[], user = ME) => contactsForMember(db as unknown as SupabaseClient, user, ids, NOW);

describe('contactsForMember', () => {
  it('returns contacts for the member\'s own matched signal, empty address as null', async () => {
    const m = await call(seed(), [10]);
    expect([...m.keys()]).toEqual([10]);
    expect(m.get(10)).toEqual([
      { signalId: 10, role: 'site', name: '', attn: null, address: '2150 N DAMEN', city: 'Chicago', state: 'IL', zip: null, phone: null, email: null, website: null },
      { signalId: 10, role: 'contractor', name: 'ACME ROOFING LLC', attn: null, address: null, city: 'SKOKIE', state: 'IL', zip: '60076', phone: '312-555-0100', email: null, website: null },
    ]);
  });
  it('another member\'s signal gives nothing, even when asked for alongside an own one', async () => {
    expect((await call(seed(), [20])).size).toBe(0);
    const m = await call(seed(), [10, 20, 999]);
    expect([...m.keys()]).toEqual([10]);
  });
  it('no current access gives nothing: expired trial, canceled, missing profile', async () => {
    expect((await call(seed('trialing', '2026-11-01T00:00:00Z'), [10])).size).toBe(0);
    expect((await call(seed('canceled', '2026-12-01T00:00:00Z'), [10])).size).toBe(0);
    expect((await call(seed(), [10], '33333333-3333-3333-3333-333333333333')).size).toBe(0);
  });
  it('paid statuses keep access after the trial', async () => {
    expect((await call(seed('active', '2026-01-01T00:00:00Z'), [10])).size).toBe(1);
    expect((await call(seed('past_due', '2026-01-01T00:00:00Z'), [10])).size).toBe(1);
  });
  it('any error gives an empty map: each table failing, a throwing client, a missing contacts table', async () => {
    for (const k of ['holler_profiles.select', 'holler_matches.select', 'holler_signal_contacts.select']) {
      const db = seed();
      db.failOn[k] = k.startsWith('holler_signal_contacts') ? "Could not find the table 'public.holler_signal_contacts' in the schema cache" : 'boom';
      expect((await call(db, [10])).size, k).toBe(0);
    }
    const throwing = { from() { throw new Error('network'); } } as unknown as SupabaseClient;
    expect((await contactsForMember(throwing, ME, [10], NOW)).size).toBe(0);
  });
  it('bad input gives nothing and reads nothing; at most 200 ids are used', async () => {
    const db = seed();
    expect((await call(db, [])).size).toBe(0);
    expect((await call(db, [0, -1, 1.5, Number.NaN])).size).toBe(0);
    expect((await contactsForMember(db as unknown as SupabaseClient, '', [10], NOW)).size).toBe(0);
    expect(db.calls).toEqual([]);
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    let seen: number[] = [];
    const spy = seed();
    const orig = spy.from.bind(spy);
    (spy as unknown as { from: unknown }).from = (t: string) => {
      const b = orig(t) as unknown as { in: (c: string, v: number[]) => unknown };
      const inn = b.in.bind(b);
      b.in = (c: string, v: number[]) => { if (t === 'holler_matches') seen = v; return inn(c, v); };
      return b;
    };
    await contactsForMember(spy as unknown as SupabaseClient, ME, ids, NOW);
    expect(seen.length).toBe(200);
  });
});
