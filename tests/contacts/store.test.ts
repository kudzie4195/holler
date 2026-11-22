import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeDb } from '../ops/fakedb';
import { insertNewSignals, writeSignalContacts, type SignalRowInput } from '@/lib/signals/store';
import { runScan } from '@/lib/signals/run';
import type { Adapter } from '@/lib/signals/types';
import type { ContactInput } from '@/lib/contacts/types';
import { plainEmail, usPhone } from '@/lib/contacts/sanitize';

const asDb = (d: FakeDb) => d as unknown as SupabaseClient;

function sig(ext: string, contacts?: ContactInput[]): SignalRowInput {
  return {
    source: 'socrata-chicago-permits', externalId: ext, kind: 'permit', title: 'Roof permit in Chicago', summary: 'PERMIT | 2150 N DAMEN',
    lat: 41.9, lon: -87.6, city: 'Chicago', state: 'IL', categories: ['roofing'], severity: 1, occurredAt: '2026-11-12T00:00:00Z',
    data: { subtype: 'permit' }, placeSlug: 'chicago-il', ...(contacts ? { contacts } : {}),
  };
}
// FIX-E: a site address needs a street suffix (sanitize.ts cleanAddress), so the input street is written with one.
const SITE: ContactInput = { role: 'site', name: '', address: '2150 N DAMEN AVE', city: 'Chicago', state: 'IL' };
/** Distinct organization names with no digit (FIX-C: a digit inside a name fails R1; FIX-E: "WEST" is a listed given name). */
const WORDS = ['NORTH', 'SOUTH', 'EAST', 'PRIME', 'CENTRAL', 'METRO', 'PREMIER', 'SUMMIT', 'ELITE'];
const ACME: ContactInput = { role: 'contractor', name: 'ACME ROOFING LLC', city: 'SKOKIE', state: 'IL', zip: '60076', phone: '(312) 555-0100' };

describe('insertNewSignals writes contacts for inserted rows only', () => {
  it('insert with contacts: one row per contact, filed under the new signal id, never in holler_signals', async () => {
    const db = new FakeDb();
    const out = await insertNewSignals(asDb(db), [sig('a', [SITE, ACME]), sig('b')]);
    expect(out).toHaveLength(2);
    const a = db.tables.holler_signals.find((r) => r.external_id === 'a')!;
    expect(db.tables.holler_signal_contacts).toEqual([
      expect.objectContaining({ signal_id: a.id, role: 'site', name: '', address: '2150 N DAMEN AVE', city: 'Chicago' }),
      expect.objectContaining({ signal_id: a.id, role: 'contractor', name: 'ACME ROOFING LLC', address: '', phone: '312-555-0100', zip: '60076' }),
    ]);
    for (const r of db.tables.holler_signals) expect(JSON.stringify(r)).not.toMatch(/ACME|contacts|555-0100/);
  });
  it('a duplicate signal (already stored) gets no second contact write', async () => {
    const db = new FakeDb();
    await insertNewSignals(asDb(db), [sig('a', [SITE, ACME])]);
    const writes = db.calls.filter((c) => c === 'holler_signal_contacts.upsert').length;
    await insertNewSignals(asDb(db), [sig('a', [SITE, { role: 'business', name: 'NEW NAME LLC' }])]);
    expect(db.calls.filter((c) => c === 'holler_signal_contacts.upsert').length).toBe(writes);
    expect(db.tables.holler_signal_contacts).toHaveLength(2);
    expect(JSON.stringify(db.tables.holler_signal_contacts)).not.toContain('NEW NAME');
  });
  it('a missing contacts table (migration not applied yet) is logged; signals are still inserted and returned', async () => {
    const db = new FakeDb();
    db.failOn['holler_signal_contacts.upsert'] = "Could not find the table 'public.holler_signal_contacts' in the schema cache";
    const logs: string[] = [];
    const out = await insertNewSignals(asDb(db), [sig('a', [SITE]), sig('b', [ACME])], { log: (m) => logs.push(m) });
    expect(out).toHaveLength(2);
    expect(db.tables.holler_signals).toHaveLength(2);
    expect(logs).toEqual([expect.stringContaining('apply migration 0006')]);
  });
  it('any other write failure or a throwing client is logged, never thrown', async () => {
    const db = new FakeDb();
    db.failOn['holler_signal_contacts.upsert'] = 'permission denied';
    const logs: string[] = [];
    await expect(insertNewSignals(asDb(db), [sig('a', [SITE])], { log: (m) => logs.push(m) })).resolves.toHaveLength(1);
    expect(logs[0]).toMatch(/write failed/);
    const throwing = { from() { throw new Error('socket closed'); } } as unknown as SupabaseClient;
    const l2: string[] = [];
    await expect(writeSignalContacts(throwing, [{ signalId: 1, contacts: [SITE] }], (m) => l2.push(m))).resolves.toBe(0);
    expect(l2[0]).toMatch(/socket closed/);
  });
  it('dry run writes nothing (insertNewSignals dry option and runScan dry)', async () => {
    const db = new FakeDb();
    expect(await insertNewSignals(asDb(db), [sig('a', [SITE])], { dry: true })).toEqual([]);
    expect(db.calls).toEqual([]);
    const adapter: Adapter = { id: 'socrata-chicago-permits', label: 't', kind: 'permit', cadenceMinutes: 1, sourceUrl: 'x', fetch: async () => [sig('z', [SITE, ACME])] };
    const rep = await runScan({ dry: true, adapters: [adapter], now: new Date('2026-11-17T00:00:00Z') }, asDb(db));
    expect(rep.dry).toBe(true);
    expect(db.calls).toEqual([]);
  });
  it('caps at 6 per signal, sanitises fields, drops persons, bad phones and bad emails', async () => {
    const db = new FakeDb();
    const many: ContactInput[] = [
      ...Array.from({ length: 9 }, (_, i) => ({ role: 'contractor' as const, name: `${WORDS[i]} ROOFING LLC` })),
      { role: 'contractor', name: 'JOHN SMITH', phone: '312-555-0199' },
      SITE,
    ];
    await insertNewSignals(asDb(db), [sig('cap', many)]);
    const rows = db.tables.holler_signal_contacts;
    expect(rows).toHaveLength(6);
    expect(rows[0].role).toBe('site');
    expect(JSON.stringify(rows)).not.toMatch(/JOHN SMITH|0199/);

    const db2 = new FakeDb();
    await insertNewSignals(asDb(db2), [sig('f', [
      { role: 'business', name: '  SUNSET   CAFE  ', address: `  ${'9'.repeat(5)} ${'A'.repeat(300)}`, city: 'C'.repeat(200), state: 'Illinois', zip: '606011234', phone: '123-456-7890', email: 'not an email' },
      { role: 'awardee', name: 'GOOD SERVICES INC', phone: '312.555.0123 x45', email: 'Bids@Good.COM', website: 'good.com' },
      { role: 'contractor', name: 'OK BUILDERS', attn: 'Jane Doe', zip: 'IL 6060' },
      { role: 'site', name: 'SHOULD BE DROPPED', address: '' },
      { role: 'owner' as never, name: 'X LLC' },
    ])]);
    const r = db2.tables.holler_signal_contacts;
    expect(r).toHaveLength(3);
    // Redo 1: a two-word licence name needs a plain vocabulary word beside the marker ("ACME CAFE" could be a first name), so SUNSET.
    const cafe = r.find((x) => x.name === 'SUNSET CAFE')!;
    // FIX-E: a city that is not place words is dropped; state is a US code.
    expect(cafe.address.length).toBe(200); // FIX-E follow-up: one street word after the house number is allowed (cut at 200)
    expect(cafe.city).toBeNull();
    expect(cafe.state).toBe('IL');
    expect(cafe.zip).toBe('60601-1234');
    expect(cafe.phone).toBeNull();
    expect(cafe.email).toBeNull();
    const good = r.find((x) => x.role === 'awardee')!;
    expect([good.phone, good.email, good.website]).toEqual(['312-555-0123', 'bids@good.com', null]); // FIX-E: website always null
    expect(r.find((x) => x.name === 'OK BUILDERS')!.attn).toBeNull();
    expect(r.every((x) => x.website === null && x.attn === null)).toBe(true);
    expect(r.find((x) => x.name === 'OK BUILDERS')!.zip).toBeNull();
  });
  it('phone and email plausibility', () => {
    expect(usPhone('312-555-0100')).toBe('312-555-0100');
    expect(usPhone('+1 (312) 555 0100')).toBe('312-555-0100');
    for (const bad of ['555-0100', '012-555-0100', '312-055-0100', '0000000000', '312-555-01001', '911-555-0100', 'call me', '312-555-0100 or 312-555-0101'])
      expect(usPhone(bad), bad).toBeNull();
    expect(plainEmail('a.b@city.gov')).toBe('a.b@city.gov');
    for (const bad of ['a@b', 'a b@c.com', '@c.com', 'a@@c.com', 'a..b@c.com']) expect(plainEmail(bad), bad).toBeNull();
  });
});

describe('L3-3: contacts are written per chunk, right after that chunk\'s signal upsert', () => {
  it('1,200 signals, the second signal chunk fails: the first chunk\'s contacts are written, then the error is thrown', async () => {
    const db = new FakeDb();
    let upserts = 0;
    const wrapped = {
      from(table: string) {
        if (table === 'holler_signals' && ++upserts === 2) db.failOn['holler_signals.upsert'] = 'statement timeout';
        return db.from(table);
      },
    } as unknown as SupabaseClient;
    const signals = Array.from({ length: 1200 }, (_, i) => sig(`c${i}`, [{ ...SITE, address: `${100 + i} N DAMEN AVE` }]));
    await expect(insertNewSignals(wrapped, signals)).rejects.toThrow(/statement timeout/);
    const firstChunk = db.tables.holler_signals.slice(0, 200);
    expect(db.tables.holler_signals).toHaveLength(200);
    const contacts = db.tables.holler_signal_contacts;
    expect(contacts).toHaveLength(200);
    expect(new Set(contacts.map((c) => c.signal_id))).toEqual(new Set(firstChunk.map((r) => r.id)));
  });
  it('the per-scan cap of 6,000 contact rows still holds across chunks', async () => {
    const db = new FakeDb();
    const six = (): ContactInput[] => [SITE, ...Array.from({ length: 5 }, (_, j) => ({ role: 'contractor' as const, name: `${WORDS[j]} ROOFING LLC` }))];
    await insertNewSignals(asDb(db), Array.from({ length: 1100 }, (_, i) => sig(`k${i}`, six())));
    expect(db.tables.holler_signal_contacts).toHaveLength(6000);
  });
});

describe('review2 P2-5: no contact write for a code violation or a 311 request, whatever the adapter attached', () => {
  const withSubtype = (ext: string, subtype: string): SignalRowInput => ({ ...sig(ext, [SITE, ACME]), data: { subtype } });
  it('violation and 311 signals are inserted, their contacts are not written', async () => {
    const db = new FakeDb();
    const out = await insertNewSignals(asDb(db), [withSubtype('v', 'violation'), withSubtype('t', '311'), withSubtype('p', 'permit')]);
    expect(out).toHaveLength(3);
    const ids = new Map(db.tables.holler_signals.map((r) => [r.external_id as string, r.id as number]));
    const written = new Set(db.tables.holler_signal_contacts.map((c) => c.signal_id));
    expect(written).toEqual(new Set([ids.get('p')]));
    expect(db.tables.holler_signal_contacts).toHaveLength(2);
  });
  it('the subtype is matched in any case and with spaces around it', async () => {
    const db = new FakeDb();
    await insertNewSignals(asDb(db), [withSubtype('v2', 'VIOLATION'), withSubtype('t2', ' 311 ')]);
    expect(db.tables.holler_signal_contacts ?? []).toHaveLength(0);
    expect(db.calls.filter((c) => c === 'holler_signal_contacts.upsert')).toHaveLength(0);
  });
});
