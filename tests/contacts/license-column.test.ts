/**
 * Contractor licence number (migration 0022, round 15 Unit G): stored next to a company, shown to the member, and the code keeps working
 * before the column exists (write retries without it, read retries without it).
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeDb } from '../ops/fakedb';
import { missingLicenseColumn, writeSignalContacts } from '@/lib/signals/store';
import { contactsForMember } from '@/lib/contacts/load';
import { cleanLicense, sanitizeContacts } from '@/lib/contacts/sanitize';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A FakeDb that behaves like a database where the license column does not exist (yet). */
function withoutLicenseColumn(db: FakeDb): FakeDb {
  const from = db.from.bind(db);
  db.from = ((table: string) => {
    const b = from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (table !== 'holler_signal_contacts') return b;
    const err = { message: 'Could not find the \'license\' column of \'holler_signal_contacts\' in the schema cache', code: 'PGRST204' };
    const fail: Record<string, unknown> = new Proxy(
      {},
      { get: (_t, k) => (k === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: err }).then(ok) : () => fail) },
    );
    const upsert = b.upsert.bind(b);
    b.upsert = (rows: unknown, o: unknown) => (Array.isArray(rows) && rows.some((r) => 'license' in (r as object)) ? fail : upsert(rows, o));
    const select = b.select.bind(b);
    b.select = (cols: unknown, o: unknown) => (typeof cols === 'string' && /\blicense\b/.test(cols) ? fail : select(cols, o));
    return b;
  }) as unknown as typeof db.from;
  return db;
}

const CO = { role: 'contractor' as const, name: 'METRO BUILDING SERVICES LLC', license: '626543', phone: '718-555-0140' };

describe('cleanLicense', () => {
  it.each([
    ['626543', '626543'],
    ['CBC1234567', 'CBC1234567'],
    ['  GC-12345 ', 'GC-12345'],
    ['2020-0045', '2020-0045'],
  ])('keeps %s', (raw, want) => expect(cleanLicense(raw)).toBe(want));
  it.each([['', 'empty'], ['ab', 'too short'], ['LICENSED', 'no digit'], ['404-555-0140', 'a phone'], ['a@b.co1', 'an email'], ['123-45-6789', 'an SSN shape'], ['9'.repeat(41), 'too long'], ['D1234567', 'a driver-licence shape']])(
    'drops %j (%s)',
    (raw) => expect(cleanLicense(raw)).toBeNull(),
  );
});

describe('sanitize keeps the licence only on an organisation that passed', () => {
  it('a company keeps it; a site never carries one', () => {
    const out = sanitizeContacts([CO, { role: 'site', name: '', address: '742 EVERGREEN TERRACE', license: '626543' } as never]);
    expect(out.find((c) => c.role === 'contractor')?.license).toBe('626543');
    expect(out.find((c) => c.role === 'site')?.license).toBeUndefined();
  });
  it('a person name drops the whole contact, licence included', () => {
    expect(sanitizeContacts([{ role: 'contractor', name: 'JAMES CARTER', license: '626543' }])).toEqual([]);
  });
});

describe('writeSignalContacts and the license column', () => {
  it('writes the licence when the column exists', async () => {
    const db = new FakeDb();
    await writeSignalContacts(db as unknown as SupabaseClient, [{ signalId: 7, contacts: [CO], city: 'Brooklyn' }]);
    expect(db.tables.holler_signal_contacts).toEqual([expect.objectContaining({ signal_id: 7, name: 'METRO BUILDING SERVICES LLC', license: '626543' })]);
  });
  it('before migration 0022 it retries without the key: name and phone still land, one log line', async () => {
    const db = withoutLicenseColumn(new FakeDb());
    const logs: string[] = [];
    const sent = await writeSignalContacts(db as unknown as SupabaseClient, [{ signalId: 7, contacts: [CO], city: 'Brooklyn' }], (m) => logs.push(m));
    expect(sent).toBe(1);
    expect(db.tables.holler_signal_contacts).toHaveLength(1);
    expect(db.tables.holler_signal_contacts[0]).not.toHaveProperty('license');
    expect(db.tables.holler_signal_contacts[0]).toMatchObject({ name: 'METRO BUILDING SERVICES LLC', phone: '718-555-0140' });
    expect(logs).toEqual([expect.stringContaining('migration 0022')]);
  });
  it('missingLicenseColumn recognises both PostgREST and Postgres wording and nothing else', () => {
    expect(missingLicenseColumn({ code: 'PGRST204', message: "Could not find the 'license' column" })).toBe(true);
    expect(missingLicenseColumn({ code: '42703', message: 'column "license" of relation "holler_signal_contacts" does not exist' })).toBe(true);
    expect(missingLicenseColumn({ message: 'permission denied' })).toBe(false);
    expect(missingLicenseColumn({ message: "Could not find the 'phone' column" })).toBe(false);
    expect(missingLicenseColumn(null)).toBe(false);
  });
});

describe('contactsForMember and the license column', () => {
  const ME = '11111111-1111-1111-1111-111111111111';
  const seed = () =>
    new FakeDb({
      holler_profiles: [{ user_id: ME, subscription_status: 'active', trial_ends_at: '2026-01-01T00:00:00Z' }],
      holler_matches: [{ id: 1, user_id: ME, signal_id: 10 }],
      holler_signal_contacts: [{ id: 1, signal_id: 10, role: 'contractor', name: 'METRO BUILDING SERVICES LLC', attn: null, address: '', city: null, state: null, zip: null, phone: '718-555-0140', email: null, website: null, license: '626543' }],
    });
  const NOW = new Date('2026-11-21T12:00:00Z');
  it('returns the licence', async () => {
    const m = await contactsForMember(seed() as unknown as SupabaseClient, ME, [10], NOW);
    expect(m.get(10)?.[0]).toMatchObject({ name: 'METRO BUILDING SERVICES LLC', license: '626543' });
  });
  it('before migration 0022 it reads again without the column and shows everything else', async () => {
    const db = withoutLicenseColumn(seed());
    for (const r of db.tables.holler_signal_contacts) delete r.license; // the fake ignores the select list, a real table without the column has no key
    const m = await contactsForMember(db as unknown as SupabaseClient, ME, [10], NOW);
    const c = m.get(10)?.[0];
    expect(c).toMatchObject({ name: 'METRO BUILDING SERVICES LLC', phone: '718-555-0140' });
    expect(c).not.toHaveProperty('license');
  });
});

describe('migration 0022', () => {
  const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0022_holler_contact_license.sql'), 'utf8');
  it('is additive, touches only holler_signal_contacts, and does not weaken RLS', () => {
    expect(sql).toMatch(/alter table public\.holler_signal_contacts\s+add column if not exists license text/i);
    expect(sql).not.toMatch(/drop |truncate |delete from|disable row level security|create policy|grant /i);
    for (const m of sql.matchAll(/\b(?:public\.)?(holler_\w+|[a-z_]+)\b(?=\s+add column)/gi)) expect(m[1]).toMatch(/holler_signal_contacts/);
  });
});
