import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import './fake-or';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-22T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const profile = { categories: ['plumbing'], lat: 30.27, lon: -97.74, state: 'TX', radius_mi: 25 };
const prof = (over: Record<string, unknown> = {}) => ({ user_id: 'u1', subscription_status: 'active', trial_ends_at: null, ...over });
const sig = (id: number, over: Record<string, unknown> = {}) => ({
  id, kind: 'permit', title: 'Plumbing permit in Austin', source: 's', lat: 30.28, lon: -97.75, state: 'TX', severity: 2, occurred_at: daysAgo(2), categories: ['plumbing'], ...over,
});
const contact = (id: number, signal_id: number, name: string) => ({ id, signal_id, role: 'contractor', name, phone: null, website: null });
const load = async (db: FakeDb, p = profile) => (await import('@/lib/builders/load')).loadActiveBuilders(db as never, 'u1', p, NOW);

describe('loadActiveBuilders', () => {
  it('returns no builders on a database error', async () => {
    const db = new FakeDb({ holler_profiles: [prof()] });
    db.failOn['holler_signals.select'] = 'boom';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await load(db)).builders).toEqual([]);
    db.failOn = { 'holler_signal_contacts.select': 'boom' };
    db.tables.holler_signals = [sig(1)];
    expect((await load(db)).builders).toEqual([]);
    spy.mockRestore();
  });

  it('returns builders from nearby permits only, windowDays 30 when the read reached the cutoff', async () => {
    const db = new FakeDb({
      holler_profiles: [prof()],
      holler_signals: [
        sig(1, { occurred_at: daysAgo(2) }),
        sig(2, { lat: 32.78, lon: -96.8, occurred_at: daysAgo(2) }),
        sig(3, { occurred_at: daysAgo(40) }),
      ],
      holler_signal_contacts: [
        contact(1, 1, 'Victory Plumbing Company'),
        { id: 2, signal_id: 1, role: 'site', name: '', phone: null, website: null },
        contact(3, 2, 'Dallas Pipes LLC'),
        contact(4, 3, 'Old Pipes LLC'),
      ],
    });
    const out = await load(db);
    expect(out.builders.map((b) => b.name)).toEqual(['Victory Plumbing Company']);
    expect(out.builders[0].relation).toBe('same-trade');
    expect(out.windowDays).toBe(30);
  });

  it('F1: a canceled account with trial days left gets nothing, and no permit or contact is read', async () => {
    const mk = (over: Record<string, unknown>) =>
      new FakeDb({ holler_profiles: [prof(over)], holler_signals: [sig(1)], holler_signal_contacts: [contact(1, 1, 'Victory Plumbing Company')] });
    for (const status of ['canceled', 'unpaid', 'paused', 'Canceled', 'weird']) {
      const db = mk({ subscription_status: status, trial_ends_at: daysAgo(-7) });
      expect(await load(db)).toEqual({ builders: [], windowDays: 30 });
      expect(db.calls).toEqual(['holler_profiles.select']);
    }
    expect((await load(mk({ subscription_status: 'trialing', trial_ends_at: daysAgo(-7) }))).builders).toHaveLength(1);
    expect((await load(mk({ subscription_status: 'trialing', trial_ends_at: daysAgo(1) }))).builders).toEqual([]);
    expect((await load(new FakeDb({ holler_signals: [sig(1)] }))).builders).toEqual([]); // no profile row
  });

  it('F2: a read that hits the 3000-permit cap reports the days actually covered', async () => {
    const signals: Record<string, unknown>[] = [];
    const contacts: Record<string, unknown>[] = [];
    for (let i = 1; i <= 3500; i++) {
      // 2999 permits one day ago, the 3000th (the oldest read) 9 days ago, the rest 20 days ago.
      const when = i < 3000 ? daysAgo(1) : i === 3000 ? daysAgo(9) : daysAgo(20);
      signals.push(sig(i, { occurred_at: when }));
      contacts.push(contact(i, i, 'Acme Roofing LLC'));
    }
    const db = new FakeDb({ holler_profiles: [prof()], holler_signals: signals, holler_signal_contacts: contacts });
    const out = await load(db);
    expect(out.windowDays).toBe(9);
    expect(out.builders[0].permits).toBe(3000);
  });

  it('F2: the covered window is at least 1 day', async () => {
    const signals = Array.from({ length: 3000 }, (_, i) => sig(i + 1, { occurred_at: new Date(NOW.getTime() - 3_600_000).toISOString() }));
    const db = new FakeDb({ holler_profiles: [prof()], holler_signals: signals, holler_signal_contacts: [contact(1, 1, 'Acme Roofing LLC')] });
    expect((await load(db)).windowDays).toBe(1);
  });

  it('F2: permits outside the member radius are not counted (the box is wider than the radius)', async () => {
    const db = new FakeDb({
      holler_profiles: [prof()],
      // About 40 miles north: outside the 25 mile radius.
      holler_signals: [sig(1), sig(2, { lat: 30.27 + 40 / 69, lon: -97.74 })],
      holler_signal_contacts: [contact(1, 1, 'Acme Roofing LLC'), contact(2, 2, 'Acme Roofing LLC')],
    });
    expect((await load(db)).builders[0].permits).toBe(1);
  });

  it('F3: permits without coordinates are included exactly when the feed rule places them (state match, severity >= 2)', async () => {
    const db = new FakeDb({
      holler_profiles: [prof()],
      holler_signals: [
        sig(1, { lat: null, lon: null, state: 'TX', severity: 2 }), // placed
        sig(2, { lat: null, lon: null, state: 'TX', severity: 3 }), // placed
        sig(3, { lat: null, lon: null, state: 'TX', severity: 1 }), // too low severity
        sig(4, { lat: null, lon: null, state: 'GA', severity: 2 }), // other state
        sig(5, { lat: null, lon: null, state: null, severity: 2 }), // no state
        sig(6, { lat: null, lon: null, state: 'TX', severity: 2, occurred_at: daysAgo(40) }), // too old
      ],
      holler_signal_contacts: [1, 2, 3, 4, 5, 6].map((i) => contact(i, i, 'Victory Plumbing Company')),
    });
    const out = await load(db);
    expect(out.builders).toHaveLength(1);
    expect(out.builders[0].permits).toBe(2);
    // Same answer as the feed's own test.
    const { matchArea } = await import('@/lib/signals/match');
    const feedPlaces = [1, 2, 3, 4, 5].filter((i) => {
      const s = db.tables.holler_signals.find((r) => r.id === i)!;
      return matchArea({ id: i, kind: 'permit', categories: [], lat: null, lon: null, state: s.state, severity: s.severity, occurred_at: s.occurred_at }, { ...profile, user_id: '' });
    });
    expect(feedPlaces).toEqual([1, 2]);
  });
});
