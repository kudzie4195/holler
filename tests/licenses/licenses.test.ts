/**
 * Round 20 (LIC, lever 2): state contractor licence files. Privacy first: a licence file mixes sole proprietors with companies, and a row
 * whose licence HOLDER does not pass the company rules is dropped before anything is written (planted person names below). The table
 * (migration 0036) may be missing: nothing is attached and nothing fails (PGRST205 / 42P01).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeDb } from '../ops/fakedb';
import { companyLicenseName, licenseKey, toCompanyRow } from '@/lib/licenses/company-row';
import { LICENSE_SOURCES, expectedColumns, licenseSourceForState, type LicenseSource } from '@/lib/licenses/sources';
import { filterCompanyRows, runLicenseProbe, runLicenseSync } from '@/lib/licenses/sync';
import { isLicenseTableMissing, lookupLicenses } from '@/lib/licenses/store';
import { attachLicensedContacts } from '@/lib/licenses/attach';
import { licenseSyncEnabled } from '@/lib/licenses/switch';
import { splitCsvLine } from '@/lib/licenses/fetch';
import { extractContacts, extractLicenseRefs, type ContactSpec } from '@/lib/contacts/extract';
import { sanitizeSample } from '@/lib/signals/samples';
import { insertNewSignals, type SignalRowInput } from '@/lib/signals/store';
import type { ContactInput } from '@/lib/contacts/types';

vi.mock('server-only', () => ({}));
const asDb = (d: FakeDb) => d as unknown as SupabaseClient;
const NOW = '2026-11-22T12:00:00.000Z';
const src = (st: string) => licenseSourceForState(st) as LicenseSource;

/** Planted private persons: every one of them must be dropped, whatever column holds it. */
const PERSONS = [
  'JOHN SMITH', 'SMITH, JOHN A', 'Maria Lopez', 'MARIA LOPEZ ROOFING', 'Mary Jones Plumbing LLC', 'Danny Smith LLC', 'J. Smith', 'Kowalski Roofing',
  'Deontay Kamara LLC', 'NGUYEN, VAN MINH', 'Jose Luis Hernandez Garcia', 'John Smith DBA Mary Jones', 'Gareth Barber', 'Taylor Morrison', 'Dr. Horton',
];
const COMPANIES = ['ACME ROOFING LLC', 'SUMMIT MECHANICAL INC', 'Toll Brothers', 'D.R. Horton, Inc.', 'Premier Heating & Air LLC'];

/** A California CSLB-shaped row (header names [A]). */
const ca = (name: string, type = 'Corporation', phone = '(213) 555-0142', no = '1012345') => ({
  LicenseNo: no, BusinessName: name, FullBusinessName: '', BusinessType: type, BusinessPhone: phone, MailingAddress: '742 EVERGREEN TER', 'Classifications(s)': 'C20',
});

describe('company rows only (privacy, planted names)', () => {
  it('every planted person is dropped as the holder, in every registered source', () => {
    for (const s of LICENSE_SOURCES) {
      for (const p of PERSONS) {
        const row: Record<string, string> = {};
        for (const c of expectedColumns(s)) row[c] = '';
        row[s.columns.number] = 'ABC123456';
        row[s.columns.holder] = p;
        if (s.columns.entityType) row[s.columns.entityType] = s.state === 'NY' ? 'Business' : 'Corporation';
        const out = toCompanyRow((c) => row[c] ?? '', s, NOW);
        expect('drop' in out, `${s.id}: ${p}`).toBe(true);
      }
    }
  });

  it('a company name under an individual entity type is dropped (the file says it is a person), and a blank type fails closed', () => {
    for (const t of ['Sole Owner', 'SOLE OWNERSHIP', 'Individual', '']) {
      expect(toCompanyRow((c) => (ca('ACME ROOFING LLC', t) as Record<string, string>)[c] ?? '', src('CA'), NOW), t).toEqual({ drop: 'individual_type' });
    }
  });

  it('a person holder with a company DBA is dropped (the licence holder must be a company: Florida qualifiers)', () => {
    const fl = src('FL');
    const row: Record<string, string> = { '1': 'JOHN SMITH', '2': 'ACME ROOFING LLC', '3': 'CGC', '11': 'CGC1234567' };
    expect(toCompanyRow((c) => row[c] ?? '', fl, NOW)).toEqual({ drop: 'holder_not_company' });
  });

  it('a DBA that shares a word with a person named on the row is not shown; the company holder is', () => {
    const az = src('AZ');
    const row: Record<string, string> = { 'License No': 'ROC123456', 'Business Name': 'DESERT AIR LLC', 'Doing Business As': 'KOWALSKI COOLING LLC', 'Qualifying Party': 'BRENT KOWALSKI', Class: 'C-39' };
    const out = toCompanyRow((c) => row[c] ?? '', az, NOW);
    expect('row' in out && out.row.business_name).toBe('DESERT AIR LLC');
    expect(JSON.stringify(out)).not.toMatch(/KOWALSKI/);
  });

  it('companies are kept: name, licence key, business phone only from a business-phone column, never a mailing address', () => {
    const out = toCompanyRow((c) => (ca('SUMMIT MECHANICAL INC') as Record<string, string>)[c] ?? '', src('CA'), NOW);
    expect(out).toEqual({
      row: {
        state: 'CA', license_number: '1012345', source: 'license-ca-cslb-master', business_name: 'SUMMIT MECHANICAL INC', business_phone: '213-555-0142',
        business_address: null, business_city: null, business_zip: null, license_type: 'C20', fetched_at: NOW,
      },
    });
    // Arizona's phone is not marked as the business phone: not kept.
    const az: Record<string, string> = { 'License No': 'ROC999001', 'Business Name': 'ACME ROOFING LLC', Phone: '602-555-0100' };
    const a = toCompanyRow((c) => az[c] ?? '', src('AZ'), NOW);
    expect('row' in a && a.row.business_phone).toBeNull();
    // No source marks its address as the business address (research): none stores one.
    for (const s of LICENSE_SOURCES) expect(s.addressIsBusiness, s.id).toBe(false);
  });

  it('a batch keeps companies only and the kept JSON holds no planted person anywhere', () => {
    const raw = [...PERSONS.map((p, i) => ca(p, 'Corporation', '312-555-0100', String(2000000 + i))), ...COMPANIES.map((c, i) => ca(c, 'Corporation', '312-555-0100', String(3000000 + i)))];
    const { rows, dropped } = filterCompanyRows('CA', raw, NOW);
    expect(rows.map((r) => r.business_name)).toEqual(COMPANIES);
    expect(dropped.holder_not_company).toBe(PERSONS.length);
    const json = JSON.stringify(rows);
    for (const p of PERSONS) expect(json, p).not.toContain(p);
    expect(json).not.toMatch(/EVERGREEN/);
  });

  it('the holder rule: both name rules or a listed company; L3 trade names without an owner column give nothing', () => {
    expect(companyLicenseName('ACME ROOFING LLC', [])).toBe('ACME ROOFING LLC');
    expect(companyLicenseName('Toll Brothers', [])).toBe('Toll Brothers');
    expect(companyLicenseName('KOWALSKI ROOFING', [])).toBeNull();
    expect(companyLicenseName('SMITH ROOFING LLC', ['JOHN SMITH'])).toBeNull();
    for (const p of PERSONS) expect(companyLicenseName(p, []), p).toBeNull();
  });

  it('licence keys: upper case, no spaces; phone and SSN shapes are refused; a board number shaped like "QB1234567" is a key', () => {
    expect(licenseKey(' cgc 1234567 ')).toBe('CGC1234567');
    expect(licenseKey('QB1234567')).toBe('QB1234567');
    for (const bad of ['', 'NONE', 'AB', '404-555-0140', '(404) 555-0140', '555-0140', '123-45-6789', '123456789', 'a@b.co1']) expect(licenseKey(bad), bad).toBeNull();
  });
});

describe('sync and probe', () => {
  afterEach(() => vi.unstubAllEnvs());
  const csv = (rows: Record<string, string>[]) => {
    const cols = Object.keys(rows[0]);
    const q = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c] ?? '')).join(','))].join('\r\n') + '\r\n';
  };
  const fileFetch = (body: string, calls: string[] = []) =>
    (async (u: string | URL | Request) => {
      calls.push(String(u));
      return new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } });
    }) as unknown as typeof fetch;
  const RAW = [...PERSONS.map((p, i) => ca(p, i % 2 ? 'Sole Owner' : 'Corporation', '312-555-0100', String(2000000 + i))), ...COMPANIES.map((c, i) => ca(c, 'Corporation', '312-555-0100', String(3000000 + i)))];

  it('the switch is off by default; off means no fetch and no write', async () => {
    expect(licenseSyncEnabled(undefined)).toBe(false);
    expect(licenseSyncEnabled('0')).toBe(false);
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(licenseSyncEnabled(v), v).toBe(true);
    const calls: string[] = [];
    const db = new FakeDb();
    const r = await runLicenseSync({ db: asDb(db), state: 'CA', fetch: fileFetch(csv(RAW), calls), enabled: false });
    expect(r.status).toBe('disabled');
    expect(calls).toEqual([]);
    expect(db.calls).toEqual([]);
  });

  it('on: only company rows reach the database (planted persons never sent)', async () => {
    const db = new FakeDb();
    const r = await runLicenseSync({ db: asDb(db), state: 'ca', fetch: fileFetch(csv(RAW)), enabled: true, now: new Date(NOW) });
    expect(r).toMatchObject({ status: 'ok', read: RAW.length, kept: COMPANIES.length, written: COMPANIES.length, done: true, nextOffset: RAW.length });
    expect(db.tables.holler_contractor_licenses.map((x) => x.business_name)).toEqual(COMPANIES);
    const json = JSON.stringify(db.tables);
    for (const p of PERSONS) expect(json, p).not.toContain(p);
    expect(json).not.toMatch(/EVERGREEN/);
  });

  it('the table missing (0036 not applied): status table_missing, nothing thrown', async () => {
    for (const code of ['PGRST205', '42P01']) {
      const db = new FakeDb();
      db.failOn['holler_contractor_licenses.upsert'] = 'relation "public.holler_contractor_licenses" does not exist';
      db.failCode['holler_contractor_licenses.upsert'] = code;
      const r = await runLicenseSync({ db: asDb(db), state: 'CA', fetch: fileFetch(csv(RAW)), enabled: true });
      expect(r.status, code).toBe('table_missing');
    }
  });

  it('a portal that answers an HTML page or fails: fetch_failed / unreachable, nothing written', async () => {
    const db = new FakeDb();
    const r = await runLicenseSync({ db: asDb(db), state: 'CA', fetch: fileFetch('<!DOCTYPE html><html></html>'), enabled: true });
    expect(r.status).toBe('fetch_failed');
    const down = (async () => new Response('no', { status: 503 })) as unknown as typeof fetch;
    expect((await runLicenseProbe('CA', down)).status).toBe('unreachable');
    expect(db.calls).toEqual([]);
  });

  it('probe: columns, missing expected columns, row count and companies kept, with no name, number or phone in the answer', async () => {
    const p = await runLicenseProbe('CA', fileFetch(csv(RAW)));
    expect(p).toMatchObject({ status: 'ok', rowCount: RAW.length, keptAsCompanies: COMPANIES.length, schema: 'ok', missingExpected: [] });
    expect(p.dropped?.individual_type).toBe(Math.floor(PERSONS.length / 2));
    const json = JSON.stringify(p);
    for (const n of [...PERSONS, ...COMPANIES, '1012345', '312-555-0100']) expect(json, n).not.toContain(n);
    const unknown = await runLicenseProbe('ZZ', fileFetch(''));
    expect(unknown.status).toBe('unknown_state');
  });

  it('Socrata sources page with $where, $limit and $offset', async () => {
    const calls: string[] = [];
    const f = (async (u: string | URL | Request) => {
      calls.push(String(u));
      return Response.json([{ license_nbr: '2091234-DCA', business_name: 'SUMMIT CONSTRUCTION LLC', license_type: 'Business', business_category: 'Home Improvement Contractor' }, { license_nbr: '2091235-DCA', business_name: 'JOHN SMITH', license_type: 'Individual' }]);
    }) as unknown as typeof fetch;
    const p = await runLicenseProbe('NY', f);
    expect(p.keptAsCompanies).toBe(1);
    const u = new URL(calls[0]);
    expect(u.searchParams.get('$where')).toContain('Home Improvement Contractor');
    expect(u.searchParams.get('$offset')).toBe('0');
  });

  it('CSV split handles quotes and doubled quotes', () => {
    expect(splitCsvLine('a,"b, c","d ""e"""')).toEqual(['a', 'b, c', 'd "e"']);
  });
});

describe('the permit lookup (attach)', () => {
  const STORED = { state: 'FL', license_number: 'QB1234567', source: 'license-fl-dbpr-construction', business_name: 'ACME ROOFING LLC', business_phone: '305-555-0100', business_address: null, business_city: null, business_zip: null, license_type: 'QB', fetched_at: NOW };

  it('missing table (PGRST205, 42P01): nothing attached, no error, one log line', async () => {
    for (const code of ['PGRST205', '42P01']) {
      const db = new FakeDb();
      db.failOn['holler_contractor_licenses.select'] = "Could not find the table 'public.holler_contractor_licenses' in the schema cache";
      db.failCode['holler_contractor_licenses.select'] = code;
      const logs: string[] = [];
      const items = [{ contacts: [] as ContactInput[], refs: [{ state: 'FL', number: 'QB1234567' }] }];
      expect(await attachLicensedContacts(asDb(db), items, (m) => logs.push(m))).toBe(0);
      expect(items[0].contacts).toEqual([]);
      expect(logs).toEqual([expect.stringContaining('0036')]);
      expect(isLicenseTableMissing({ code })).toBe(true);
      expect((await lookupLicenses(asDb(db), 'FL', ['QB1234567'])).missing).toBe(true);
    }
  });

  it('a stored company is attached by licence number: name and business phone; an existing same-licence contact gets the phone', async () => {
    const db = new FakeDb({ holler_contractor_licenses: [STORED] });
    const a = { contacts: [] as ContactInput[], refs: [{ state: 'FL', number: 'qb 1234567' }] };
    const b = { contacts: [{ role: 'contractor', name: 'ACME ROOFING LLC', license: 'QB1234567' }] as ContactInput[], refs: [{ state: 'FL', number: 'QB1234567' }] };
    const c = { contacts: [] as ContactInput[], refs: [{ state: 'CA', number: 'QB1234567' }] }; // another state's number: nothing
    expect(await attachLicensedContacts(asDb(db), [a, b, c])).toBe(2);
    expect(a.contacts).toEqual([expect.objectContaining({ role: 'contractor', name: 'ACME ROOFING LLC', phone: '305-555-0100', license: 'QB1234567', address: null })]);
    expect(b.contacts).toHaveLength(1);
    expect(b.contacts[0].phone).toBe('305-555-0100');
    expect(c.contacts).toEqual([]);
  });

  it('defence in depth: a person name planted straight into the table is never attached', async () => {
    const db = new FakeDb({ holler_contractor_licenses: PERSONS.map((p, i) => ({ ...STORED, license_number: `QB${1000000 + i}`, business_name: p })) });
    const items = PERSONS.map((_, i) => ({ contacts: [] as ContactInput[], refs: [{ state: 'FL', number: `QB${1000000 + i}` }] }));
    expect(await attachLicensedContacts(asDb(db), items)).toBe(0);
    expect(items.flatMap((x) => x.contacts)).toEqual([]);
  });

  it('insertNewSignals: a permit with a licence ref gains the company contact; a violation never looks up; samples never keep refs', async () => {
    const db = new FakeDb({ holler_contractor_licenses: [STORED] });
    const sig = (ext: string, subtype: string): SignalRowInput => ({
      source: 'arcgis-miamidade-permits', externalId: ext, kind: subtype === 'permit' ? 'permit' : 'civic', title: 'Roof permit in Miami', lat: 25.7, lon: -80.2,
      city: 'Miami', state: 'FL', categories: ['roofing'], severity: 1, occurredAt: NOW, data: { subtype }, placeSlug: 'miami-fl',
      licenseRefs: [{ state: 'FL', number: 'QB1234567' }],
    });
    const out = await insertNewSignals(asDb(db), [sig('p1', 'permit'), sig('v1', 'violation')]);
    expect(out).toHaveLength(2);
    const p1 = db.tables.holler_signals.find((r) => r.external_id === 'p1')!;
    // The name and phone are attached; "QB1234567" has a driver-licence shape, so the stored contact does not SHOW it (cleanLicense).
    expect(db.tables.holler_signal_contacts).toEqual([expect.objectContaining({ signal_id: p1.id, role: 'contractor', name: 'ACME ROOFING LLC', phone: '305-555-0100', license: null })]);
    for (const r of db.tables.holler_signals) expect(JSON.stringify(r)).not.toMatch(/QB1234567|licenseRefs/);
    expect(out.find((r) => r.external_id === 'p1')?.hasContact).toBe(true);
    expect(JSON.stringify(sanitizeSample(sig('p2', 'permit')))).not.toMatch(/QB1234567|licenseRefs/);
  });

  it('insertNewSignals without the table: signals and their own contacts are written as before', async () => {
    const db = new FakeDb();
    db.failOn['holler_contractor_licenses.select'] = 'relation "public.holler_contractor_licenses" does not exist';
    db.failCode['holler_contractor_licenses.select'] = '42P01';
    const s: SignalRowInput = {
      source: 'socrata-chicago-permits', externalId: 'x', kind: 'permit', title: 'Roof permit in Chicago', lat: 41.9, lon: -87.6, city: 'Chicago', state: 'IL',
      categories: ['roofing'], severity: 1, occurredAt: NOW, data: { subtype: 'permit' }, placeSlug: 'chicago-il',
      contacts: [{ role: 'contractor', name: 'SUMMIT MECHANICAL INC' }], licenseRefs: [{ state: 'IL', number: '123456' }],
    };
    const out = await insertNewSignals(asDb(db), [s], { log: () => undefined });
    expect(out).toHaveLength(1);
    expect(db.tables.holler_signal_contacts.map((r) => r.name)).toEqual(['SUMMIT MECHANICAL INC']);
  });
});

describe('extracting licence refs from a permit row', () => {
  const spec: ContactSpec = {
    verifiedUrl: 'https://example.test', checkedOn: '2026-11-22',
    orgs: [{ role: 'contractor', nameFields: ['CONTRNAME'], licenseFields: ['CONTRNUM'], licenseState: 'FL' }],
  };
  const row: Record<string, string> = { CONTRNAME: 'JOHN SMITH', CONTRNUM: 'CGC1234567' };
  const read = (f: string) => row[f] ?? '';

  it('with a licence state: a ref for the lookup, and the raw number is never put on a contact (it may be a person\'s licence)', () => {
    expect(extractLicenseRefs(read, spec, 'permit')).toEqual([{ state: 'FL', number: 'CGC1234567' }]);
    expect(extractLicenseRefs(read, spec, 'violation')).toEqual([]);
    expect(extractContacts(read, spec, { city: 'Miami', state: 'FL' }, 'permit')).toEqual([]);
    const company = (f: string) => ({ CONTRNAME: 'ACME ROOFING LLC', CONTRNUM: 'CGC1234567' } as Record<string, string>)[f] ?? '';
    const cs = extractContacts(company, spec, { city: 'Miami', state: 'FL' }, 'permit');
    expect(cs).toEqual([expect.objectContaining({ role: 'contractor', name: 'ACME ROOFING LLC' })]);
    expect(cs[0].license).toBeUndefined();
  });

  it('without a licence state nothing changes: no refs (Raleigh keeps its stored licence next to a company as before)', () => {
    const plain: ContactSpec = { ...spec, orgs: [{ role: 'contractor', nameFields: ['CONTRNAME'], licenseFields: ['CONTRNUM'] }] };
    expect(extractLicenseRefs(read, plain, 'permit')).toEqual([]);
  });

  it('no live adapter spec sets a licence state today (the only 10-metro licence column, Miami-Dade CONTRNUM, stays unfetched)', async () => {
    const { CONTACT_SPECS } = await import('@/lib/signals/adapters/socrata-datasets');
    const { CONTACT_SPECS: ARC } = await import('@/lib/signals/adapters/arcgis-datasets');
    const { COVERAGE_CONTACT_SPECS } = await import('@/lib/signals/adapters/coverage-datasets');
    const all = [...Object.values(CONTACT_SPECS), ...Object.values(ARC), ...Object.values(COVERAGE_CONTACT_SPECS)];
    expect(all.flatMap((s) => (s.orgs ?? []).filter((o) => o.licenseState))).toEqual([]);
  });
});

describe('migration 0036', () => {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/0036_holler_contractor_licenses.sql'), 'utf8');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  it('idempotent, holler_ only, RLS on, nothing granted to anon or authenticated', () => {
    expect(code).toMatch(/create table if not exists public\.holler_contractor_licenses/);
    expect(code).toMatch(/create index if not exists/);
    expect(code).toMatch(/enable row level security/);
    expect(code).toMatch(/revoke all on table public\.holler_contractor_licenses from public, anon, authenticated/);
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toMatch(/create policy/i);
    expect(code).toMatch(/unique \(state, license_number\)/);
    for (const m of code.matchAll(/public\.([a-z_]+)/g)) expect(m[1].startsWith('holler_'), m[1]).toBe(true);
    // No person, owner or home address column exists to be filled.
    expect(code).not.toMatch(/owner|first_name|last_name|qualifier|mailing|home/i);
  });
});
