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
/** Review LIC P1-1: a person joined to a company in one cell. The licence is the person's: never stored. */
const JOINED = [
  'JOHN SMITH DBA ACME ROOFING LLC', 'JOHN SMITH D/B/A ACME ROOFING LLC', 'JOHN SMITH D.B.A. ACME ROOFING LLC', 'JOHN SMITH T/A ACME ROOFING LLC',
  'JOHN SMITH TRADING AS ACME ROOFING LLC', 'JOHN SMITH DOING BUSINESS AS ACME ROOFING LLC', 'ACME ROOFING LLC DBA JOHN SMITH', 'JOHN SMITH / ACME ROOFING LLC',
  'JOHN SMITH, ACME ROOFING LLC', 'JOHN SMITH OF ACME ROOFING LLC', 'ACME ROOFING LLC (JOHN SMITH)', 'JOHN SMITH C/O ACME ROOFING LLC',
  'JOHN SMITH DBA DESERT COOLING LLC', 'JOHN SMITH AKA ACME ROOFING LLC', 'JOHN SMITH OPERATING AS ACME ROOFING LLC',
];
const COMPANIES = ['ACME ROOFING LLC', 'SUMMIT MECHANICAL INC', 'Toll Brothers Inc', 'D.R. Horton, Inc.', 'Premier Heating & Air LLC'];
/** A valid licence number per state (each matches the state's numberPattern). */
const NUM: Record<string, string> = { FL: 'QB1234567', CA: '1012345', AZ: 'ROC123456', TX: 'TACLA12345', NY: '2091234-DCA' };
/** An allowed company type per state that has a type column. */
const TYPE: Record<string, string> = { FL: 'QB', CA: 'Corporation', NY: 'Business' };
/** A source promoted for a test only (the registry keeps every source on probation). */
const promoted = (s: LicenseSource): LicenseSource => ({ ...s, probation: false, schemaUnverified: false, ...(s.headerless ? { headerless: { ...s.headerless, confirmed: true } } : {}) });

/** One row in a source's own shape: holder, optional DBA, a valid number and an allowed type unless overridden. */
function rowFor(s: LicenseSource, holder: string, over: Record<string, string> = {}): Record<string, string> {
  const row: Record<string, string> = {};
  for (const c of expectedColumns(s)) row[c] = '';
  row[s.columns.number] = NUM[s.state];
  row[s.columns.holder] = holder;
  if (s.columns.entityType) row[s.columns.entityType] = TYPE[s.state];
  if (s.columns.phone) row[s.columns.phone] = '214-555-0100';
  if (s.columns.personFields) for (const p of s.columns.personFields) row[p] = 'JOHN SMITH';
  return { ...row, ...over };
}
const readOf = (row: Record<string, string>) => (c: string) => row[c] ?? '';

/** A California CSLB-shaped row (header names [A]). */
const ca = (name: string, type = 'Corporation', phone = '(213) 555-0142', no = '1012345') => ({
  LicenseNo: no, BusinessName: name, FullBusinessName: '', BusinessType: type, BusinessPhone: phone, MailingAddress: '742 EVERGREEN TER', 'Classifications(s)': 'C20',
});

describe('company rows only (privacy, planted names)', () => {
  it('every planted person is dropped as the holder, in every registered source (valid number and type, so the holder rule decides)', () => {
    for (const s of LICENSE_SOURCES) {
      for (const p of PERSONS) expect(toCompanyRow(readOf(rowFor(s, p)), s, NOW), `${s.id}: ${p}`).toEqual({ drop: 'holder_not_company' });
      // A company in the same shape is kept (so the drops above are not an artefact of the row).
      expect('row' in toCompanyRow(readOf(rowFor(s, 'ACME ROOFING LLC', s.columns.personFields ? { 'Qualifying Party': 'BRENT KOWALSKI' } : {})), s, NOW), s.id).toBe(true);
    }
  });

  it('P1-1: a person joined to a company in the holder cell is dropped in every source, and as a DBA under a company holder too', () => {
    for (const s of LICENSE_SOURCES) {
      for (const j of JOINED) {
        expect(toCompanyRow(readOf(rowFor(s, j)), s, NOW), `${s.id}: ${j}`).toEqual({ drop: 'holder_not_company' });
        if (s.columns.dba) {
          const out = toCompanyRow(readOf(rowFor(s, 'SUMMIT MECHANICAL INC', { [s.columns.dba]: j })), s, NOW);
          expect('row' in out && out.row.business_name, `${s.id} dba: ${j}`).toBe('SUMMIT MECHANICAL INC');
        }
      }
    }
  });

  it('P1-1: through the sync (promoted sources), no joined person row reaches the table, and the person\'s number attaches nothing', async () => {
    const db = new FakeDb();
    for (const s of LICENSE_SOURCES.filter((x) => x.format === 'csv' && !x.headerless)) {
      const rows = JOINED.map((j, i) => rowFor(s, j, { [s.columns.number]: s.state === 'CA' ? String(1500000 + i) : `ROC${150000 + i}` }));
      const r = await runLicenseSync({ db: asDb(db), state: s.state, fetch: fileFetch(csv(rows)), enabled: true, source: promoted(s) });
      expect(r, s.id).toMatchObject({ status: 'ok', kept: 0, written: 0 });
    }
    expect(db.tables.holler_contractor_licenses ?? []).toEqual([]);
    const items = [{ contacts: [] as ContactInput[], refs: [{ state: 'CA', number: '1500000' }] }];
    expect(await attachLicensedContacts(asDb(db), items)).toBe(0);
    expect(items[0].contacts).toEqual([]);
  });

  it('P1-2: the type check is an allow-list: every unknown, individual or blank code is dropped (CA and NY), allowed types are kept', () => {
    const DROP = ['S', '01', 'SO', 'SoleOwner', 'Sole_Owner', 'Sole Owner', 'SOLE', 'sole-owner', 'IND', 'I', 'Individual', 'Proprietorship', 'Person', 'Owner/Operator', 'N/A', '-', '0', ''];
    for (const t of DROP) {
      expect(toCompanyRow(readOf(ca('ACME ROOFING INC', t)), src('CA'), NOW), `CA ${t}`).toEqual({ drop: 'individual_type' });
      expect(toCompanyRow(readOf(rowFor(src('NY'), 'ACME ROOFING LLC', { license_type: t })), src('NY'), NOW), `NY ${t}`).toEqual({ drop: 'individual_type' });
    }
    for (const t of ['Corporation', 'CORPORATION', 'LLC', 'Limited Liability Company', 'Limited Liability', 'Partnership', 'Joint Venture'])
      expect('row' in toCompanyRow(readOf(ca('ACME ROOFING INC', t)), src('CA'), NOW), `CA ${t}`).toBe(true);
    expect('row' in toCompanyRow(readOf(rowFor(src('NY'), 'ACME ROOFING LLC', { license_type: 'Business' })), src('NY'), NOW)).toBe(true);
    // Florida: only the business-organisation class.
    for (const t of ['CGC', 'CBC', 'CRC', 'CCC', '', 'qb ', 'QBX']) expect(toCompanyRow(readOf(rowFor(src('FL'), 'ACME ROOFING LLC', { '2': t })), src('FL'), NOW), `FL ${t}`).toEqual({ drop: 'individual_type' });
  });

  it('P1-3: a number that does not match the state pattern is dropped; a type that does not have the label shape is stored as null', () => {
    for (const bad of ['01/15/1998', '90001', '742', '742 EVERGREEN TER', 'PO BOX 12', 'JOHN SMITH 3RD', '33101'])
      expect(toCompanyRow(readOf(rowFor(src('FL'), 'ACME ROOFING LLC', { '10': bad })), src('FL'), NOW), `FL ${bad}`).toEqual({ drop: 'no_number' });
    for (const bad of ['01/15/1998', 'ROC12', 'CGC1234567', '742 EVERGREEN TER'])
      expect(toCompanyRow(readOf(ca('ACME ROOFING INC', 'Corporation', '213-555-0142', bad)), src('CA'), NOW), `CA ${bad}`).toEqual({ drop: 'no_number' });
    const az = toCompanyRow(readOf(rowFor(src('AZ'), 'ACME ROOFING LLC', { Class: '742 EVERGREEN TER' })), src('AZ'), NOW);
    expect('row' in az && az.row.license_type).toBeNull();
    const az2 = toCompanyRow(readOf(rowFor(src('AZ'), 'ACME ROOFING LLC', { Class: 'CR-39' })), src('AZ'), NOW);
    expect('row' in az2 && az2.row.license_type).toBe('CR-39');
  });

  it('P1-3: the reviewer\'s Florida layouts that differ from the documented one store nothing (promoted and layout confirmed for the test)', async () => {
    const fl = promoted(src('FL'));
    const ADDR = ['742 EVERGREEN TER', '', '', 'MIAMI', 'FL', '33101', '23'];
    const lines = [
      // a leading board code: every field one place to the right
      ['06', 'ACME ROOFING LLC', '', 'QB', ...ADDR, 'QB1500001', 'C', '01/15/1998'],
      // a date where the documented layout has the number
      ['ACME ROOFING LLC', '', 'QB', ...ADDR, '01/15/1998', 'QB1500002'],
      // the street where the class code should be
      ['ACME ROOFING LLC', '', '742 EVERGREEN TER', 'QB', '', '', 'MIAMI', 'FL', '33101', '23', 'QB1500003'],
      // the reviewer's layout B: a person, the DBA company, class, address ..., a date in the number column
      ['SMITH, JOHN A', 'ACME ROOFING LLC', 'CGC', ...ADDR, '01/15/1998', 'CGC1500003'],
      // a ZIP code in the number column
      ['ACME ROOFING LLC', '', 'QB', '742 EVERGREEN TER', '', '', 'MIAMI', 'FL', '23', '33101', '33101'],
    ];
    const body = lines.map((l) => l.map((v) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';
    const db = new FakeDb();
    const r = await runLicenseSync({ db: asDb(db), state: 'FL', fetch: fileFetch(body), enabled: true, source: fl });
    expect(r).toMatchObject({ status: 'ok', read: 5, kept: 0, written: 0 });
    expect(db.tables.holler_contractor_licenses ?? []).toEqual([]);
    // The documented layout itself is kept.
    const good = ['ACME ROOFING LLC', '', 'QB', ...ADDR, 'QB1500004', 'C', '01/15/1998'].join(',') + '\n';
    const r2 = await runLicenseSync({ db: asDb(db), state: 'FL', fetch: fileFetch(good), enabled: true, source: fl });
    expect(r2).toMatchObject({ status: 'ok', kept: 1 });
    expect(db.tables.holler_contractor_licenses).toEqual([expect.objectContaining({ license_number: 'QB1500004', business_name: 'ACME ROOFING LLC', license_type: 'QB', business_address: null })]);
    expect(JSON.stringify(db.tables)).not.toMatch(/EVERGREEN|SMITH|01\/15/);
  });

  it('companies are kept: name, licence key, business phone only from a business-phone column, never a mailing address', () => {
    const out = toCompanyRow(readOf(ca('SUMMIT MECHANICAL INC')), src('CA'), NOW);
    expect(out).toEqual({
      row: {
        state: 'CA', license_number: '1012345', source: 'license-ca-cslb-master', business_name: 'SUMMIT MECHANICAL INC', business_phone: '213-555-0142',
        business_address: null, business_city: null, business_zip: null, license_type: 'C20', fetched_at: NOW,
      },
    });
    const az = toCompanyRow(readOf({ 'License No': 'ROC999001', 'Business Name': 'ACME ROOFING LLC', Phone: '602-555-0100', 'Qualifying Party': 'BRENT KOWALSKI' }), src('AZ'), NOW);
    expect('row' in az && az.row.business_phone).toBeNull();
    for (const s of LICENSE_SOURCES) expect(s.addressIsBusiness, s.id).toBe(false);
  });

  it('a batch keeps companies only and the kept JSON holds no planted person anywhere', () => {
    const raw = [...[...PERSONS, ...JOINED].map((p, i) => ca(p, 'Corporation', '312-555-0100', String(2000000 + i))), ...COMPANIES.map((c, i) => ca(c, 'Corporation', '312-555-0100', String(3000000 + i)))];
    const { rows, dropped } = filterCompanyRows('CA', raw, NOW);
    expect(rows.map((r) => r.business_name)).toEqual(COMPANIES);
    expect(dropped.holder_not_company).toBe(PERSONS.length + JOINED.length);
    const json = JSON.stringify(rows);
    for (const p of [...PERSONS, 'JOHN SMITH']) expect(json, p).not.toContain(p);
    expect(json).not.toMatch(/EVERGREEN/);
  });

  it('the holder rule: both name rules or a listed company with a legal form; L3 trade names without an owner column give nothing', () => {
    expect(companyLicenseName('ACME ROOFING LLC', [])).toBe('ACME ROOFING LLC');
    expect(companyLicenseName('Toll Brothers Inc', [])).toBe('Toll Brothers Inc');
    expect(companyLicenseName('Toll Brothers', [])).toBeNull();
    expect(companyLicenseName('KOWALSKI ROOFING', [])).toBeNull();
    expect(companyLicenseName('SMITH ROOFING LLC', ['JOHN SMITH'])).toBeNull();
    for (const p of [...PERSONS, ...JOINED]) expect(companyLicenseName(p, []), p).toBeNull();
  });

  it('licence keys: upper case, no spaces; phone and SSN shapes are refused; a board number shaped like "QB1234567" is a key', () => {
    expect(licenseKey(' cgc 1234567 ')).toBe('CGC1234567');
    expect(licenseKey('QB1234567')).toBe('QB1234567');
    for (const bad of ['', 'NONE', 'AB', '404-555-0140', '(404) 555-0140', '555-0140', '123-45-6789', '123456789', 'a@b.co1']) expect(licenseKey(bad), bad).toBeNull();
  });
});

const csv = (rows: Record<string, string>[]) => {
  const cols = Object.keys(rows[0]);
  const q = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c] ?? '')).join(','))].join('\r\n') + '\r\n';
};
function fileFetch(body: string, calls: string[] = []): typeof fetch {
  return (async (u: string | URL | Request) => {
    calls.push(String(u));
    return new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } });
  }) as unknown as typeof fetch;
}

describe('sync and probe', () => {
  afterEach(() => vi.unstubAllEnvs());
  const RAW = [...PERSONS.map((p, i) => ca(p, i % 2 ? 'Sole Owner' : 'Corporation', '312-555-0100', String(2000000 + i))), ...COMPANIES.map((c, i) => ca(c, 'Corporation', '312-555-0100', String(3000000 + i)))];
  const CA = () => promoted(src('CA'));

  it('the switch is off by default; off means no fetch and no write', async () => {
    expect(licenseSyncEnabled(undefined)).toBe(false);
    expect(licenseSyncEnabled('0')).toBe(false);
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(licenseSyncEnabled(v), v).toBe(true);
    const calls: string[] = [];
    const db = new FakeDb();
    const r = await runLicenseSync({ db: asDb(db), state: 'CA', fetch: fileFetch(csv(RAW), calls), enabled: false, source: CA() });
    expect(r.status).toBe('disabled');
    expect(calls).toEqual([]);
    expect(db.calls).toEqual([]);
  });

  it('P2-4: switch on but the source on probation (every registered source today): not_promoted, no fetch, no write', async () => {
    for (const s of LICENSE_SOURCES) {
      expect(s.probation && s.schemaUnverified, s.id).toBe(true);
      const calls: string[] = [];
      const db = new FakeDb();
      const r = await runLicenseSync({ db: asDb(db), state: s.state, fetch: fileFetch(csv(RAW), calls), enabled: true });
      expect(r.status, s.id).toBe('not_promoted');
      expect(calls).toEqual([]);
      expect(db.calls).toEqual([]);
    }
    // One flag removed is not enough, and a headerless layout must be confirmed too.
    for (const s of [{ ...src('CA'), probation: false }, { ...src('CA'), schemaUnverified: false }, { ...src('FL'), probation: false, schemaUnverified: false }]) {
      const r = await runLicenseSync({ db: asDb(new FakeDb()), state: s.state, fetch: fileFetch(''), enabled: true, source: s });
      expect(r.status).toBe('not_promoted');
    }
  });

  it('on and promoted: only company rows reach the database (planted persons never sent)', async () => {
    const db = new FakeDb();
    const r = await runLicenseSync({ db: asDb(db), state: 'ca', fetch: fileFetch(csv(RAW)), enabled: true, now: new Date(NOW), source: CA() });
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
      const r = await runLicenseSync({ db: asDb(db), state: 'CA', fetch: fileFetch(csv(RAW)), enabled: true, source: CA() });
      expect(r.status, code).toBe('table_missing');
    }
  });

  it('a portal that answers an HTML page or fails: fetch_failed / unreachable with a fixed code, nothing written', async () => {
    const db = new FakeDb();
    const r = await runLicenseSync({ db: asDb(db), state: 'CA', fetch: fileFetch('<!DOCTYPE html><html></html>'), enabled: true, source: CA() });
    expect(r).toMatchObject({ status: 'fetch_failed', error: 'not_csv' });
    const down = (async () => new Response('no', { status: 503 })) as unknown as typeof fetch;
    expect(await runLicenseProbe('CA', down)).toMatchObject({ status: 'unreachable', error: 'http_503' });
    expect(db.calls).toEqual([]);
  });

  it('P3-11: error text never echoes the body or a thrown message', async () => {
    const leaky = (async () => { throw new Error('ECONNRESET secret=abc'); }) as unknown as typeof fetch;
    const a = await runLicenseProbe('CA', leaky);
    expect(a).toMatchObject({ status: 'unreachable', error: 'fetch_failed' });
    expect(JSON.stringify(a)).not.toMatch(/secret|ECONNRESET/);
    const notJson = (async () => new Response('SMITH, JOHN A, 742 EVERGREEN TER', { status: 200 })) as unknown as typeof fetch;
    const b = await runLicenseProbe('NY', notJson);
    expect(b).toMatchObject({ status: 'unreachable', error: 'not_json' });
    expect(JSON.stringify(b)).not.toMatch(/SMITH|EVERGREEN/);
  });

  it('P3-12: a body with no line break over 1,000,000 characters stops as not_csv', async () => {
    const r = await runLicenseProbe('CA', fileFetch('x'.repeat(1_200_000)));
    expect(r).toMatchObject({ status: 'unreachable', error: 'not_csv' });
  });

  it('P3-7: a stalled body is cut off by the timeout; a call past its deadline reports no_progress, never the same offset as "ok"', async () => {
    const stall = (async (_u: unknown, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('LicenseNo,BusinessName\n'));
          init?.signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await runLicenseSync({ db: asDb(new FakeDb()), state: 'CA', fetch: stall, enabled: true, source: CA(), deadline: Date.now() + 300 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r).toMatchObject({ status: 'fetch_failed', error: 'timeout' });
    const past = await runLicenseSync({ db: asDb(new FakeDb()), state: 'CA', fetch: fileFetch(csv(RAW)), enabled: true, source: CA(), offset: 7, deadline: Date.now() - 1 });
    expect(past).toMatchObject({ status: 'no_progress', nextOffset: 7, done: false });
  });

  it('P3-7: offset and nextOffset: a second call continues after the rows written by the first', async () => {
    const db = new FakeDb();
    const a = await runLicenseSync({ db: asDb(db), state: 'CA', fetch: fileFetch(csv(RAW)), enabled: true, source: CA(), maxRows: 10 });
    expect(a).toMatchObject({ status: 'ok', read: 10, done: false, nextOffset: 10 });
    const b = await runLicenseSync({ db: asDb(db), state: 'CA', fetch: fileFetch(csv(RAW)), enabled: true, source: CA(), offset: a.nextOffset });
    expect(b).toMatchObject({ status: 'ok', read: RAW.length - 10, done: true, nextOffset: RAW.length });
    expect(db.tables.holler_contractor_licenses.map((x) => x.business_name)).toEqual(COMPANIES);
  });

  it('probe (headed CSV): columns, missing expected columns, row count, companies kept and type labels, with no name, number or phone', async () => {
    const p = await runLicenseProbe('CA', fileFetch(csv(RAW)));
    expect(p).toMatchObject({ status: 'ok', rowCount: RAW.length, keptAsCompanies: COMPANIES.length, schema: 'ok', missingExpected: [], promoted: false, numberPatternShare: 1 });
    expect(p.typeValues?.sort()).toEqual(['Corporation', 'Sole Owner']);
    expect(p.dropped?.individual_type).toBe(Math.floor(PERSONS.length / 2));
    const json = JSON.stringify(p);
    for (const n of [...PERSONS, ...COMPANIES, '1012345', '312-555-0100', 'EVERGREEN']) expect(json, n).not.toContain(n);
    expect((await runLicenseProbe('ZZ', fileFetch(''))).status).toBe('unknown_state');
    // A type column that holds people (misread): a name seen once is never listed, nor a full name seen three times, nor a street.
    const misread = [...['MARIA LOPEZ', 'KOWALSKI', 'NGUYEN'].map((t, i) => ca('ACME ROOFING INC', t, '', String(4000000 + i))),
      ...[0, 1, 2].map((i) => ca('ACME ROOFING INC', 'JOHN SMITH', '', String(4100000 + i))), ...[0, 1, 2].map((i) => ca('ACME ROOFING INC', '742 EVERGREEN TER', '', String(4200000 + i)))];
    const q = await runLicenseProbe('CA', fileFetch(csv(misread)));
    expect(q.typeValues).toEqual([]);
  });

  it('P2-5: a headed source whose file has no header line: no column names, no values, schema mismatch', async () => {
    const body = 'ROC300001,JOHN SMITH,SMITH COOLING,CR-39,742 EVERGREEN TER,PHOENIX,AZ,85001,602-555-0100,JOHN SMITH\nROC300002,ACME ROOFING LLC,,CR-39,1 MAIN ST,PHOENIX,AZ,85001,602-555-0101,BRENT KOWALSKI\n';
    const p = await runLicenseProbe('AZ', fileFetch(body));
    expect(p).toMatchObject({ status: 'ok', schema: 'mismatch', columnCount: 10 });
    expect(p.columns).toBeUndefined();
    expect(p.note).toMatch(/first line does not look like a header/);
    expect(JSON.stringify(p)).not.toMatch(/ROC3000|SMITH|EVERGREEN|MAIN ST|555-01|PHOENIX|85001|KOWALSKI|ACME/);
  });

  it('P1-3 / P2-5: the Florida probe (no header) says "schema unverified: no header", reports shares per position, never a value', async () => {
    const lines = [
      ['ACME ROOFING LLC', '', 'QB', '742 EVERGREEN TER', '', '', 'MIAMI', 'FL', '33101', '23', 'QB1500004', 'C', '01/15/1998'],
      ['SMITH, JOHN A', 'SMITH ROOFING', 'CGC', '1 MAIN ST', '', '', 'MIAMI', 'FL', '33101', '23', 'CGC1500005', 'C', '02/01/2001'],
    ];
    const body = lines.map((l) => l.map((v) => (/[",]/.test(v) ? `"${v}"` : v)).join(',')).join('\n') + '\n';
    const p = await runLicenseProbe('FL', fileFetch(body));
    expect(p).toMatchObject({ status: 'ok', schema: 'schema unverified: no header', columnCount: 13, rowCount: 2, keptAsCompanies: 1 });
    expect(p.columns).toBeUndefined();
    expect(p.shape?.positions[10]).toMatchObject({ index: 10, numberPattern: 1 });
    expect(p.shape?.positions[2]).toMatchObject({ companyType: 0.5 });
    expect(p.shape?.positions[12]).toMatchObject({ dateLike: 1 });
    expect(JSON.stringify(p)).not.toMatch(/ACME|SMITH|EVERGREEN|MAIN ST|MIAMI|33101|QB1500004|CGC1500005|01\/15/);
  });

  it('Socrata sources select only the expected columns and page with $where, $limit and $offset', async () => {
    const calls: string[] = [];
    const f = (async (u: string | URL | Request) => {
      calls.push(String(u));
      return Response.json([{ license_nbr: '2091234-DCA', business_name: 'SUMMIT CONSTRUCTION LLC', license_type: 'Business', business_category: 'Home Improvement Contractor', owner_name: 'JOHN SMITH' }, { license_nbr: '2091235-DCA', business_name: 'JOHN SMITH', license_type: 'Individual' }]);
    }) as unknown as typeof fetch;
    const p = await runLicenseProbe('NY', f);
    expect(p.keptAsCompanies).toBe(1);
    const u = new URL(calls[0]);
    expect(u.searchParams.get('$where')).toContain('Home Improvement Contractor');
    expect(u.searchParams.get('$select')).toBe('license_nbr,business_name,dba_trade_name,license_type,business_category');
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
