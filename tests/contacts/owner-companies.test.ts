/**
 * Round 18 (NAMES): owner companies on code-violation cards.
 *
 * A code violation may name the registered company that owns the property (role 'owner', lib/contacts/owner-company.ts), never a
 * person, never a phone, email, address or site. 311 stays without contacts. The card says "Owner on the public record: X" with the
 * public source link. Owner columns: `property_owner` (Chicago 22u3-xenr) and `owner_name` (Austin 6wtj-zbtb), both seen only in the
 * repo's hand-written people fixtures (assumed columns). Every company and person below is invented.
 *
 * Redo 1: institutional owners only (no person-name word anywhere, no unknown word), and the whole feature is behind
 * HOLLER_VIOLATION_OWNERS_ENABLED, off by default. These tests turn it on, except the "switch off" block.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ownerCompanyName, isOwnerCompanyName } from '@/lib/contacts/owner-company';
import { contactsAllowedFor, extractContacts, NO_CONTACT_SUBTYPES, OWNER_ONLY_SUBTYPES, type ContactSpec } from '@/lib/contacts/extract';
import { sanitizeContact } from '@/lib/contacts/sanitize';
import type { ContactInput, ContactRecord } from '@/lib/contacts/types';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { insertNewSignals, ownerRoleRefused, writeSignalContacts, type SignalRowInput } from '@/lib/signals/store';
import { isOrgRecord, mayHaveContacts, outreachPlan } from '@/lib/outreach/plan';
import { loadMemberContacts } from '@/lib/outreach/loader';
import { WhoToContact } from '@/components/feed/who-to-contact';
import { FakeDb } from '../ops/fakedb';

beforeEach(() => vi.stubEnv('HOLLER_VIOLATION_OWNERS_ENABLED', '1'));
afterEach(() => vi.unstubAllEnvs());

const ds = (id: string): SocrataDataset => SOCRATA_DATASETS.find((d) => d.id === id)!;
const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, '../fixtures', n), 'utf8'));

const COMPANIES = [
  'MIDWEST REALTY GROUP LLC', 'NORTHSIDE PROPERTIES LLC', '1864 CORP', 'Lakeview Properties Inc.', 'NORTHERN TRUST COMPANY',
  'CHICAGO TITLE LAND TRUST COMPANY', 'ATLANTA HOUSING AUTHORITY', 'CHICAGO HOUSING AUTHORITY', 'DETROIT LAND BANK AUTHORITY', 'NEIGHBORHOOD HOUSING SERVICES INC',
];
const NOT_COMPANIES = [
  // persons
  'Olga Torres', 'Reginald Jackson Jr', 'Garrett Mays', 'JOHN SMITH', 'SMITH, JOHN A', 'JOHN SMITH LLC', 'J SMITH LLC', 'DR PATEL HOLDINGS INC', 'MARY SMITH INC',
  // personal trusts, estates, numbered land trusts, roles
  'SMITH FAMILY TRUST', 'JOHN SMITH TR', 'CHICAGO TITLE LAND TRUST CO TR 1234', 'ESTATE OF JOHN SMITH', 'HEIRS OF MARY JONES', 'JOHN SMITH ET AL',
  'OWNER OCCUPIED', 'SAME AS ABOVE', 'N/A', 'UNKNOWN',
  // trade names: the trade-name rule never applies to an owner column
  'SMITH ROOFING', 'Carter Electric', 'ACME PROPERTY MANAGEMENT', 'SUNRISE HOMES',
  // redo 1 (review P1-3, P2-4): glued persons, a bare first name or surname with a legal form, family, initials, unknown words
  'JOHNSMITH LLC', 'MARIAGARCIA LLC', 'JSMITH LLC', 'JSMITH PROPERTIES LLC', 'MGARCIA LLC', 'SMITH LLC', 'JOHN LLC', 'MARY LLC', 'MARIA LLC', 'LOPEZ INC',
  'GARCIA PROPERTIES LLC', 'GARCIA FAMILY PROPERTIES LLC', 'THE SMITH COMPANY', 'JS LLC', 'MG PROPERTIES LLC', 'TAXPAYER LLC', 'Deontay Homes LLC',
  'ACME HOLDINGS LLC', 'STONEHENGE MANAGEMENT LLC', 'PARK MANAGEMENT INC',
  // contact shapes
  'MIDWEST REALTY GROUP LLC 312-555-0100', 'acme@holdings.com LLC',
];

describe('ownerCompanyName: institutional owners only', () => {
  it.each(COMPANIES)('names %s', (c) => {
    expect(ownerCompanyName(c)).toBe(c);
    expect(isOwnerCompanyName(c)).toBe(true);
  });
  it.each(NOT_COMPANIES)('refuses %s', (c) => expect(ownerCompanyName(c)).toBeNull());
});

describe('which records may carry which contacts', () => {
  const owner: ContactInput = { role: 'owner', name: 'MIDWEST REALTY GROUP LLC' };
  const site: ContactInput = { role: 'site', name: '', address: '12 MAIN ST' };
  const gc: ContactInput = { role: 'contractor', name: 'ACME ROOFING LLC' };
  it('311: nothing; violation: owner only; anything else: never an owner', () => {
    expect([...NO_CONTACT_SUBTYPES]).toEqual(['311']);
    expect([...OWNER_ONLY_SUBTYPES]).toEqual(['violation']);
    expect(contactsAllowedFor('311', [owner, site, gc])).toEqual([]);
    expect(contactsAllowedFor(' VIOLATION ', [owner, site, gc])).toEqual([owner]);
    expect(contactsAllowedFor('permit', [owner, site, gc])).toEqual([site, gc]);
    expect(contactsAllowedFor(undefined, [owner, site])).toEqual([site]);
  });
  it('extractContacts on a violation reads only role owner, with the name only', () => {
    const spec: ContactSpec = {
      verifiedUrl: 'https://example.test', checkedOn: '2026-11-22',
      site: { addressFields: ['address'] },
      orgs: [{ role: 'owner', nameFields: ['property_owner'] }, { role: 'business', nameFields: ['biz'], phoneField: 'phone' }],
    };
    const row: Record<string, string> = { address: '2318 W 47TH ST', property_owner: 'MIDWEST REALTY GROUP LLC', biz: 'ACME ROOFING LLC', phone: '312-555-0100' };
    const read = (f: string) => row[f] ?? '';
    expect(extractContacts(read, spec, { city: 'Chicago', state: 'IL' }, 'violation')).toEqual([
      { role: 'owner', name: 'MIDWEST REALTY GROUP LLC', attn: null, address: null, city: null, state: null, zip: null, phone: null, email: null, website: null },
    ]);
    expect(extractContacts(read, spec, { city: 'Chicago', state: 'IL' }, '311')).toEqual([]);
    // On a permit an owner spec is ignored (the owner of a permitted property is never named).
    const onPermit = extractContacts(read, spec, { city: 'Chicago', state: 'IL' }, 'permit');
    expect(onPermit.map((c) => c.role).sort()).toEqual(['business', 'site']);
  });
  it('sanitizeContact strips everything but the name from an owner, and refuses a person', () => {
    expect(sanitizeContact({ role: 'owner', name: 'MIDWEST REALTY GROUP LLC', phone: '312-555-0100', email: 'a@acme.com', address: '12 MAIN ST', city: 'Chicago', state: 'IL', zip: '60601', license: 'X123' })).toEqual({
      role: 'owner', name: 'MIDWEST REALTY GROUP LLC', attn: null, address: null, city: null, state: null, zip: null, phone: null, email: null, website: null,
    });
    expect(sanitizeContact({ role: 'owner', name: 'Olga Torres' })).toBeNull();
    expect(sanitizeContact({ role: 'owner', name: 'SMITH ROOFING' })).toBeNull();
  });
});

describe('violation datasets: owner company from the owner column, never a person', () => {
  const chicago = ds('socrata-chicago-violations');
  const austin = ds('socrata-austin-violations');
  const base = { violation_date: '2026-11-12T00:00:00.000', violation_description: 'EXTERIOR WALLS DEFECTIVE: BRICK', violation_status: 'OPEN', latitude: '41.8082', longitude: '-87.6841' };
  it('Chicago: a registered company in property_owner is the only contact; a person gives nothing', () => {
    const items = parseSocrata([
      { ...base, id: 'v1', address: '2318 W 47TH ST', property_owner: 'MIDWEST REALTY GROUP LLC', violation_inspector_comments: 'Spoke with Olga Torres 312-555-0188' },
      { ...base, id: 'v2', address: '7710 S CHAPPEL AVE', property_owner: 'Olga Torres' },
      { ...base, id: 'v3', address: '7710 S CHAPPEL AVE', property_owner: 'SMITH FAMILY TRUST' },
    ], chicago);
    expect(items).toHaveLength(3);
    expect(items[0].contacts).toEqual([expect.objectContaining({ role: 'owner', name: 'MIDWEST REALTY GROUP LLC', phone: null, address: null })]);
    expect(items[1].contacts ?? []).toEqual([]);
    expect(items[2].contacts ?? []).toEqual([]);
    const hay = JSON.stringify(items);
    for (const n of ['Olga', 'Torres', '312-555-0188', 'SMITH FAMILY', '2318 W']) expect(hay.includes(n), n).toBe(false);
    // The company is private: never in the public title, summary or data.
    for (const s of items) expect(`${s.title}\n${s.summary}\n${JSON.stringify(s.data)}`).not.toMatch(/MIDWEST/);
  });
  it('Austin: owner_name, same rule', () => {
    const items = parseSocrata([
      { case_id: 'a1', status: 'Open', address: '1500 E 12TH ST', zip_code: '78702', opened_date: '2026-11-13T09:15:00.000', case_type: 'Complaints', description: 'Structure Condition Violation(s)', owner_name: 'LAKEVIEW PROPERTIES INC', complainant: 'Maria Gutierrez', latitude: '30.27', longitude: '-97.72' },
      { case_id: 'a2', status: 'Open', address: '1500 E 12TH ST', zip_code: '78702', opened_date: '2026-11-13T09:15:00.000', case_type: 'Complaints', description: 'Structure Condition Violation(s)', owner_name: 'Garrett Mays', latitude: '30.27', longitude: '-97.72' },
    ], austin);
    expect(items[0].contacts).toEqual([expect.objectContaining({ role: 'owner', name: 'LAKEVIEW PROPERTIES INC' })]);
    expect(items[1].contacts ?? []).toEqual([]);
    expect(JSON.stringify(items)).not.toMatch(/Gutierrez|Garrett|Mays/);
  });
  it('the people fixtures (persons in the owner columns) give no contact at all', () => {
    for (const [f, id] of [['socrata-chicago-violations-people.json', 'socrata-chicago-violations'], ['socrata-austin-violations-people.json', 'socrata-austin-violations']] as const) {
      for (const s of parseSocrata(fx(f), ds(id))) expect(s.contacts ?? [], f).toEqual([]);
    }
  });
  it('only violation specs read an owner column, and only Chicago and Austin have one (DeKalb has no owner column)', () => {
    const withOwner = [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => d.contacts?.orgs?.some((o) => o.role === 'owner')).map((d) => d.id).sort();
    expect(withOwner).toEqual(['socrata-austin-violations', 'socrata-chicago-violations']);
    for (const id of withOwner) expect(ds(id).contacts?.fieldStatus, id).toBe('assumed');
  });
});

describe('store: only owner rows for a violation, none for 311, and a fallback before migration 0030', () => {
  const asDb = (d: unknown) => d as SupabaseClient;
  const sig = (ext: string, subtype: string, contacts: ContactInput[]): SignalRowInput => ({
    source: `socrata-chicago-${subtype === 'permit' ? 'permits' : subtype === '311' ? '311' : 'violations'}`, externalId: ext, kind: subtype === 'permit' ? 'permit' : 'civic',
    title: 'Code violation in Chicago: brick', summary: 'x', lat: 41.9, lon: -87.6, city: 'Chicago', state: 'IL', categories: ['roofing'], severity: 1,
    occurredAt: '2026-11-12T00:00:00Z', data: { subtype }, placeSlug: 'chicago-il', contacts,
  });
  const OWNER: ContactInput = { role: 'owner', name: 'MIDWEST REALTY GROUP LLC' };
  const SITE: ContactInput = { role: 'site', name: '', address: '2150 N DAMEN AVE', city: 'Chicago', state: 'IL' };
  const GC: ContactInput = { role: 'contractor', name: 'ACME ROOFING LLC', phone: '312-555-0100' };
  it('violation: the owner row only; 311: nothing; permit: never an owner row', async () => {
    const db = new FakeDb();
    await insertNewSignals(asDb(db), [sig('v', 'violation', [OWNER, SITE, GC]), sig('t', '311', [OWNER, SITE]), sig('p', 'permit', [OWNER, SITE, GC])]);
    const ids = new Map(db.tables.holler_signals.map((r) => [r.external_id as string, r.id as number]));
    const rows = db.tables.holler_signal_contacts;
    expect(rows.filter((r) => r.signal_id === ids.get('v')).map((r) => [r.role, r.name, r.phone, r.address])).toEqual([['owner', 'MIDWEST REALTY GROUP LLC', null, '']]);
    expect(rows.filter((r) => r.signal_id === ids.get('t'))).toEqual([]);
    expect(rows.filter((r) => r.signal_id === ids.get('p')).map((r) => r.role).sort()).toEqual(['contractor', 'site']);
  });
  it('the role check of migration 0006 refusing owner (0030 not applied): owner rows dropped, the rest written, logged once', async () => {
    const written: Record<string, unknown>[] = [];
    let calls = 0;
    const db = {
      from: () => ({
        upsert: async (batch: Record<string, unknown>[]) => {
          calls++;
          if (batch.some((r) => r.role === 'owner')) {
            return { error: { code: '23514', message: 'new row for relation "holler_signal_contacts" violates check constraint "holler_signal_contacts_role_check"' } };
          }
          written.push(...batch);
          return { error: null };
        },
      }),
    };
    const logs: string[] = [];
    const n = await writeSignalContacts(asDb(db), [{ signalId: 1, contacts: [OWNER] }, { signalId: 2, contacts: [SITE, GC] }], (m) => logs.push(m));
    expect(n).toBe(2);
    expect(written.map((r) => r.role)).toEqual(['site', 'contractor']);
    expect(calls).toBe(2);
    expect(logs).toEqual([expect.stringContaining('apply migration 0030')]);
  });
  it('ownerRoleRefused reads the Postgres check violation on the role constraint only', () => {
    expect(ownerRoleRefused({ code: '23514', message: 'new row for relation "holler_signal_contacts" violates check constraint "holler_signal_contacts_role_check"' })).toBe(true);
    expect(ownerRoleRefused({ code: '23514', message: 'violates check constraint "holler_signal_contacts_license_len"' })).toBe(false);
    expect(ownerRoleRefused({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(ownerRoleRefused(null)).toBe(false);
  });
  it('migration 0030 is idempotent, holler-only, and adds owner to the role check', () => {
    const sql = readFileSync(join(__dirname, '../../supabase/migrations/0030_holler_contact_owner_role.sql'), 'utf8').toLowerCase();
    expect(sql).toContain("check (role in ('site', 'business', 'contractor', 'awardee', 'buyer', 'owner'))");
    expect(sql).toContain('if not exists');
    expect(sql).not.toMatch(/\bgrant\b/);
    for (const m of sql.matchAll(/public\.(\w+)/g)) expect(m[1]).toMatch(/^holler_/);
  });
});

describe('card: "Owner on the public record" with the public source link, English and Spanish', () => {
  const signal = { source: 'socrata-chicago-violations', kind: 'civic', city: 'Chicago', state: 'IL', zip: '60609', url: 'https://data.cityofchicago.org/d/22u3-xenr' };
  const owner: ContactInput = { role: 'owner', name: 'MIDWEST REALTY GROUP LLC' };
  it('English: the owner line, the source link, and the area kit stays', () => {
    const p = outreachPlan(signal, [owner], 'en');
    expect(p?.type).toBe('area');
    if (p?.type !== 'area') return;
    expect(p.owner).toEqual({
      name: 'MIDWEST REALTY GROUP LLC',
      line: 'Owner on the public record: MIDWEST REALTY GROUP LLC',
      source: { href: 'https://data.cityofchicago.org/d/22u3-xenr', external: true, target: '_blank', rel: 'noopener noreferrer', label: 'Public source' },
    });
    expect(p.eddm.href).toBe('https://eddm.usps.com/eddm/select-routes.htm');
    // Never accusing words.
    expect(JSON.stringify(p.owner)).not.toMatch(/responsib|violat|owes|fault|guilty|negligen|landlord/i);
  });
  it('Spanish', () => {
    const p = outreachPlan(signal, [owner], 'es');
    expect(p?.type === 'area' && p.owner?.line).toBe('Propietario según el registro público: MIDWEST REALTY GROUP LLC');
    expect(p?.type === 'area' && p.owner?.source?.label).toBe('Fuente pública');
  });
  it('a non-https or odd source url gives no link, never a javascript: href', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', '', null]) {
      const p = outreachPlan({ ...signal, url }, [owner], 'en');
      expect(p?.type === 'area' && p.owner?.source, String(url)).toBeNull();
    }
    const http = outreachPlan({ ...signal, url: 'http://data.cityofchicago.org/d/x' }, [owner], 'en');
    expect(http?.type === 'area' && http.owner?.source?.href).toBe('https://data.cityofchicago.org/d/x');
  });
  it('no owner line without an owner contact, on 311 cards, or from an owner role on a permit', () => {
    const none = outreachPlan(signal, [], 'en');
    expect(none?.type === 'area' && none.owner).toBeNull();
    const t311 = outreachPlan({ ...signal, source: 'socrata-chicago-311' }, [owner], 'en');
    expect(t311?.type === 'area' && t311.owner).toBeNull();
    const permit = outreachPlan({ ...signal, source: 'socrata-chicago-permits', kind: 'permit' }, [owner], 'en');
    expect(JSON.stringify(permit)).not.toContain('MIDWEST REALTY GROUP');
  });
  it('the loader is asked for violation records; the locked prompt still talks about the area', () => {
    expect(mayHaveContacts('socrata-chicago-violations', 'civic')).toBe(true);
    expect(mayHaveContacts('socrata-chicago-311', 'civic')).toBe(false);
    expect(isOrgRecord('socrata-chicago-violations', 'civic')).toBe(false);
  });
  it('the rendered block shows the line and the link', () => {
    const html = renderToStaticMarkup(createElement(WhoToContact, { item: signal, contacts: [owner], lang: 'en' }));
    expect(html).toContain('Owner on the public record: MIDWEST REALTY GROUP LLC');
    expect(html).toContain('href="https://data.cityofchicago.org/d/22u3-xenr"');
    expect(html).toContain('Public source');
  });
  it('the member loader re-checks a stored owner name with the owner rule (a person filed as owner is dropped)', async () => {
    const rec = (name: string): ContactRecord => ({ signalId: 7, role: 'owner', name });
    const loader = async () => new Map([[7, [rec('MIDWEST REALTY GROUP LLC'), rec('Olga Torres'), rec('SMITH ROOFING')]]]);
    const out = await loadMemberContacts({ db: {} as never, userId: 'u1', signalIds: [7], loader });
    expect(out.get(7)?.map((c) => c.name)).toEqual(['MIDWEST REALTY GROUP LLC']);
  });
});

describe('switch off (HOLLER_VIOLATION_OWNERS_ENABLED unset, the default): nothing about owners is read, stored or shown', () => {
  beforeEach(() => vi.stubEnv('HOLLER_VIOLATION_OWNERS_ENABLED', ''));
  const owner: ContactInput = { role: 'owner', name: 'MIDWEST REALTY GROUP LLC' };
  it('the switch reads only 1, true, on or yes', async () => {
    const { violationOwnersEnabled } = await import('@/lib/contacts/owner-switch');
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(violationOwnersEnabled(v), v).toBe(true);
    for (const v of [undefined, '', '0', 'false', 'off', 'no', 'enabled']) expect(violationOwnersEnabled(v), String(v)).toBe(false);
    expect(violationOwnersEnabled()).toBe(false);
  });
  it('not read: the owner column is never touched and a violation gets no contact', () => {
    const touched: string[] = [];
    const spec: ContactSpec = { verifiedUrl: 'https://example.test', checkedOn: '2026-11-22', orgs: [{ role: 'owner', nameFields: ['property_owner'] }] };
    const out = extractContacts((f) => { touched.push(f); return 'MIDWEST REALTY GROUP LLC'; }, spec, { city: 'Chicago', state: 'IL' }, 'violation');
    expect(out).toEqual([]);
    expect(touched).toEqual([]);
    const items = parseSocrata([{ id: 'v1', violation_date: '2026-11-12T00:00:00.000', violation_description: 'EXTERIOR WALLS DEFECTIVE: BRICK', violation_status: 'OPEN', address: '2318 W 47TH ST', property_owner: 'MIDWEST REALTY GROUP LLC', latitude: '41.8', longitude: '-87.6' }], ds('socrata-chicago-violations'));
    expect(JSON.stringify(items)).not.toContain('MIDWEST');
  });
  it('not stored: contactsAllowedFor and the writer drop owner rows', async () => {
    expect(contactsAllowedFor('violation', [owner])).toEqual([]);
    const db = new FakeDb();
    const sig: SignalRowInput = {
      source: 'socrata-chicago-violations', externalId: 'v', kind: 'civic', title: 'Code violation in Chicago: brick', summary: 'x', lat: 41.9, lon: -87.6,
      city: 'Chicago', state: 'IL', categories: ['roofing'], severity: 1, occurredAt: '2026-11-12T00:00:00Z', data: { subtype: 'violation' }, placeSlug: 'chicago-il', contacts: [owner],
    };
    await insertNewSignals(db as unknown as SupabaseClient, [sig]);
    expect(db.tables.holler_signal_contacts ?? []).toEqual([]);
  });
  it('not shown: the loader drops a stored owner row and is not even asked for violation records', async () => {
    const loader = async () => new Map([[7, [{ signalId: 7, role: 'owner', name: 'MIDWEST REALTY GROUP LLC' } as ContactRecord]]]);
    const out = await loadMemberContacts({ db: {} as never, userId: 'u1', signalIds: [7], loader });
    expect(out.get(7)).toBeUndefined();
    expect(mayHaveContacts('socrata-chicago-violations', 'civic')).toBe(false);
  });
  it('documented in lib/env.ts, .env.example and LAUNCH.md, with the unverified-columns note', async () => {
    const { ENV_KEYS } = await import('@/lib/env');
    expect(ENV_KEYS).toContain('HOLLER_VIOLATION_OWNERS_ENABLED');
    const root = join(__dirname, '../..');
    const example = readFileSync(join(root, '.env.example'), 'utf8');
    expect(example).toMatch(/^HOLLER_VIOLATION_OWNERS_ENABLED=$/m);
    expect(example).toMatch(/NOT verified on the live portals/);
    const launch = readFileSync(join(root, 'LAUNCH.md'), 'utf8');
    expect(launch).toContain('`HOLLER_VIOLATION_OWNERS_ENABLED`');
    expect(launch).toMatch(/owner columns are confirmed on the live portals/);
  });
});

describe('review P3-1, P3-2: score and migration guards', () => {
  it('an owner company does not count as a named contact for the score (the e-mail and the app never show it)', async () => {
    const { hasNamedContact } = await import('@/lib/signals/score');
    expect(hasNamedContact([{ role: 'owner', name: 'MIDWEST REALTY GROUP LLC' }])).toBe(false);
    expect(hasNamedContact([{ role: 'contractor', name: 'ACME ROOFING LLC' }])).toBe(true);
  });
  it('migration 0030 does nothing before 0006 and adds a name-only check for owner rows', () => {
    const sql = readFileSync(join(__dirname, '../../supabase/migrations/0030_holler_contact_owner_role.sql'), 'utf8').toLowerCase();
    expect(sql).toContain("to_regclass('public.holler_signal_contacts') is null");
    expect(sql).toContain('holler_signal_contacts_owner_name_only');
    expect(sql).toMatch(/role <> 'owner'\s+or \(phone is null and email is null/);
  });
});
