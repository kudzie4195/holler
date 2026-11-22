/**
 * Round 18 (NAMES): what changed on the existing fixtures, the business-licence contacts, and the privacy sweep over every fixture.
 *
 * fixtures/contacts-before-r18.json holds the contacts every fixture gave at r17-ship 8bee203 (before this unit). The only differences
 * now are EXPECTED_ADDED (the business on two business-licence feeds and two contractor names the trade-name rule accepts) and
 * EXPECTED_REMOVED (redo 1: "Taqueria Lopez" holds a listed surname, so the inspection names nobody and stores no address). The public
 * title, summary and data are pinned separately (public-output.test.ts).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { parseUsaSpending } from '@/lib/signals/adapters/usaspending';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { outreachPlan } from '@/lib/outreach/plan';
import type { ContactInput } from '@/lib/contacts/types';
import type { SignalInput } from '@/lib/signals/types';

const DIRS = [join(__dirname, '../fixtures'), join(__dirname, 'fixtures')];
const SKIP = new Set(['public-before.json', 'review3-appendix.json', 'contacts-before-r18.json']);

function parseFixture(file: string, raw: unknown): SignalInput[] | null {
  const base = file.replace(/\.json$/, '').replace(/-people$/, '').replace(/-contacts$/, '').replace(/-live-\d{4}-\d{2}-\d{2}$/, '');
  if (base.startsWith('usaspending')) return parseUsaSpending(raw);
  if (file.startsWith('socrata-')) {
    const d = SOCRATA_DATASETS.find((x) => x.id === base);
    return d ? parseSocrata(raw, d) : null;
  }
  if (file.startsWith('arcgis-')) {
    const d = ARCGIS_DATASETS.find((x) => x.id === base);
    return d ? parseArcgis(raw, d) : null;
  }
  return null;
}

interface Parsed { key: string; file: string; raw: unknown[]; items: SignalInput[] }
function parseAll(): Parsed[] {
  const out: Parsed[] = [];
  for (const dir of DIRS) {
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.json') || SKIP.has(f)) continue;
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const items = parseFixture(f, raw);
      if (!items) continue;
      const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.features) ? raw.features.map((x: { attributes: unknown }) => x.attributes) : Array.isArray(raw?.results) ? raw.results : [];
      out.push({ key: `${dir.endsWith('contacts/fixtures') ? 'tests/contacts/fixtures' : 'tests/fixtures'}/${f}`, file: f, raw: rows, items });
    }
  }
  return out;
}

const before = (JSON.parse(readFileSync(join(__dirname, 'fixtures/contacts-before-r18.json'), 'utf8')) as { files: Record<string, { id: string; contacts: ContactInput[] }[]> }).files;
const key = (c: ContactInput) => JSON.stringify(c);

/** fixture file + record id -> the contacts added by round 18 (role: name). Every newly named business, for a human to eyeball. */
const EXPECTED_ADDED: Record<string, string[]> = {
  'tests/fixtures/socrata-la-business.json 0000123456-0001-0': ['site: 6000 W SUNSET BLVD', 'business: SUNSET PIZZA'],
  'tests/fixtures/socrata-orlando-business.json BTR-2026-9002': ['site: 200 S ORANGE AVE', 'business: SUMMIT CONSULTING GROUP'],
  'tests/contacts/fixtures/socrata-austin-permits-contacts.json 2026-123456 BP': ['contractor: Lone Star Roofing LLC'],
  'tests/contacts/fixtures/socrata-chicago-permits-contacts.json 101300001': ['contractor: NORTH BRANCH ARCHITECTS LTD'],
};
/** Redo 1: contacts the r17 code stored that the licence rule now refuses. */
const EXPECTED_REMOVED: Record<string, string[]> = {
  'tests/contacts/fixtures/socrata-austin-inspections-contacts.json 2026-10-30-10099901:2026-10-30': ['site: 1107 E 7th St', 'business: Taqueria Lopez'],
};

describe('existing fixtures: contacts change only by the newly accepted business names', () => {
  const now = parseAll();
  it('same fixture files and record ids as the r17 snapshot', () => {
    expect(now.map((p) => p.key).sort()).toEqual(Object.keys(before).sort());
    for (const p of now) expect(p.items.map((s) => s.externalId), p.key).toEqual(before[p.key].map((r) => r.id));
  });
  it('the additions are exactly EXPECTED_ADDED and the removals exactly EXPECTED_REMOVED', () => {
    const added: Record<string, string[]> = {};
    const removed: Record<string, string[]> = {};
    const label = (c: ContactInput) => `${c.role}: ${c.role === 'site' ? c.address : c.name}`;
    for (const p of now) {
      p.items.forEach((s, i) => {
        const was = before[p.key][i].contacts;
        const is = s.contacts ?? [];
        const wasK = new Set(was.map(key));
        const isK = new Set(is.map(key));
        const add = is.filter((c) => !wasK.has(key(c))).map(label);
        const rem = was.filter((c) => !isK.has(key(c))).map(label);
        if (add.length) added[`${p.key} ${s.externalId}`] = add;
        if (rem.length) removed[`${p.key} ${s.externalId}`] = rem;
      });
    }
    expect(added).toEqual(EXPECTED_ADDED);
    expect(removed).toEqual(EXPECTED_REMOVED);
  });
  it('the English "Who to contact" block changes only on those records', () => {
    const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'owner' && v === null ? undefined : v)));
    for (const p of now) {
      p.items.forEach((s, i) => {
        const sig = { source: s.source, kind: s.kind, city: s.city, state: s.state, zip: s.zip, summary: s.summary, url: s.url };
        const was = strip(outreachPlan(sig, before[p.key][i].contacts, 'en'));
        const is = strip(outreachPlan(sig, s.contacts ?? [], 'en'));
        const k = `${p.key} ${s.externalId}`;
        if (!EXPECTED_ADDED[k] && !EXPECTED_REMOVED[k]) expect(is, k).toEqual(was);
      });
    }
  });
});

describe('business licences: the business on the licence is the contact on every enabled business-licence source', () => {
  // Redo 1 (rule 6): the NYC and SF fixture names ("FLATBUSH LOCKSMITH", "Mission Taqueria", "Bayview Bookkeeping") put an unknown word
  // beside one marker, which cannot be told apart from a first name, so they give nothing; those two feeds are proved on inline rows.
  const cases: [string, string, string][] = [
    ['socrata-chicago-business', '../contacts/fixtures/socrata-chicago-business-contacts.json', 'SUMMIT CITY CAFE'],
    ['socrata-la-business', '../fixtures/socrata-la-business.json', 'SUNSET PIZZA'],
    ['socrata-orlando-business', '../fixtures/socrata-orlando-business.json', 'SUMMIT CONSULTING GROUP'],
  ];
  const inline: [string, Record<string, unknown>, string][] = [
    ['socrata-nyc-business', { license_nbr: 'X1', business_name: 'SAMPLE PERSON', dba_trade_name: 'FLATBUSH LOCKSMITH INC', business_category: 'Locksmith', license_type: 'Business', license_status: 'Active', license_creation_date: '2026-10-28T00:00:00.000', address_building: '1200', address_street_name: 'FLATBUSH AVE', address_zip: '11226', latitude: '40.6410', longitude: '-73.9570' }, 'FLATBUSH LOCKSMITH INC'],
    ['socrata-sf-business', { uniqueid: 'X2', ownership_name: 'SAMPLE OWNER PERSON', dba_name: 'Mission Street Taqueria', full_business_address: '2100 Mission St San Francisco CA 94110', business_zip: '94110', location_start_date: '2026-11-02T00:00:00.000', lic_code_description: 'Food Service', location: { type: 'Point', coordinates: ['-122.4194', '37.7599'] } }, 'Mission Street Taqueria'],
  ];
  it('covers every enabled business-licence dataset', () => {
    const enabled = [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => d.subtype === 'business' && d.verified).map((d) => d.id).sort();
    expect([...cases.map((c) => c[0]), ...inline.map((c) => c[0])].sort()).toEqual(enabled);
  });
  it.each(inline)('%s (inline row) names the business with its site; the owner column never appears', (id, row, name) => {
    const d = SOCRATA_DATASETS.find((x) => x.id === id)!;
    const [s] = parseSocrata([row], d);
    expect(s.contacts?.find((c) => c.role === 'business')?.name).toBe(name);
    expect(s.contacts?.some((c) => c.role === 'site')).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/SAMPLE (?:OWNER )?PERSON/);
  });
  it('a home-based licence category gives no name and no address, unless the name has a legal form (rule 6)', () => {
    const d = SOCRATA_DATASETS.find((x) => x.id === 'socrata-chicago-business')!;
    const row = (dba: string, activity: string) => ({ id: `${dba}-${activity}`, doing_business_as_name: dba, address: '2318 W 47TH ST', zip_code: '60609', license_description: 'Limited Business License', business_activity: activity, application_type: 'ISSUE', date_issued: '2026-11-12T00:00:00.000', latitude: '41.8', longitude: '-87.6' });
    const items = parseSocrata([row('SUNSET ACADEMY', 'Home Day Care'), row('SUNSET ACADEMY', 'Tutoring'), row('SUNSET ACADEMY LLC', 'Home Day Care')], d);
    expect(items[0].contacts ?? []).toEqual([]);
    expect(items[1].contacts?.map((c) => c.role)).toEqual(['site', 'business']);
    expect(items[2].contacts?.map((c) => c.role)).toEqual(['site', 'business']);
  });
  it.each(cases)('%s names the business and shows it as "The business that opened"', (id, file, name) => {
    const d = SOCRATA_DATASETS.find((x) => x.id === id)!;
    const items = parseSocrata(JSON.parse(readFileSync(join(__dirname, file), 'utf8')), d);
    const s = items.find((x) => x.contacts?.some((c) => c.role === 'business' && c.name === name))!;
    expect(s, id).toBeDefined();
    const plan = outreachPlan({ source: s.source, kind: s.kind, city: s.city, state: s.state }, s.contacts ?? [], 'en');
    expect(plan?.type === 'org' && plan.entries[0]).toMatchObject({ name, role: 'The business that opened' });
    const es = outreachPlan({ source: s.source, kind: s.kind, city: s.city, state: s.state }, s.contacts ?? [], 'es');
    expect(es?.type === 'org' && es.entries[0].role).toBe('El negocio que abrió');
  });
  it('sole proprietors (the people fixtures) give no name and no home address', () => {
    for (const id of ['socrata-la-business', 'socrata-nyc-business', 'socrata-orlando-business', 'socrata-sf-business', 'socrata-chicago-business']) {
      const d = SOCRATA_DATASETS.find((x) => x.id === id)!;
      for (const s of parseSocrata(JSON.parse(readFileSync(join(__dirname, `../fixtures/${id}-people.json`), 'utf8')), d)) expect(s.contacts ?? [], id).toEqual([]);
    }
  });
  it('the arcgis Atlanta licence feed stays disabled and reads no name (no fixture to prove a business name)', () => {
    const atl = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-atlanta-business')!;
    expect(atl.verified).toBe(false);
    expect(atl.contacts).toBeUndefined();
  });
});

describe('privacy sweep over every fixture: no person, owner phone or owner email in the stored SignalInput', () => {
  /** Columns that hold a private party or its contact details (never shown, whatever the dataset). */
  const PRIVATE_COL = /owner|applicant|tenant|resident|complainant|inspector|full_?name|contact_name|first_name|last_name|requestor|requester|^legal_name$|ownership/i;
  const CONTACT_COL = /phone|email/i;
  /** Company or placeholder values in those columns that are not a person (the fixture's own words). */
  const NOT_PERSON = /^(?:private owner|private contact|not applicable|owner)$/i;
  it('no value of an owner, applicant, inspector or personal-name column, and no owner or applicant phone or email, appears anywhere', () => {
    let checked = 0;
    for (const p of parseAll()) {
      const hay = JSON.stringify(p.items).toLowerCase();
      const pub = p.items.map((s) => `${s.title}\n${s.summary ?? ''}`).join('\n').toLowerCase();
      for (const row of p.raw as Record<string, unknown>[]) {
        if (!row || typeof row !== 'object') continue;
        for (const [col, v] of Object.entries(row)) {
          if (typeof v !== 'string' || v.trim().length < 4) continue;
          // Address columns of the permitted work are public record (the job site); type and id columns hold no name.
          const personCol = PRIVATE_COL.test(col) && !/business_name|dba|company|contractor|address|city|state|zip|street|type|_id$|date/i.test(col);
          const privatePhone = CONTACT_COL.test(col) && /owner|applicant|resident|tenant|business_email|primary_contact_email|^email$/i.test(col);
          if (!personCol && !privatePhone) continue;
          if (NOT_PERSON.test(v.trim())) continue;
          if (/llc|inc\b/i.test(v) && /legal_name/.test(col)) continue; // a registered legal name is a company
          checked++;
          const needle = v.trim().toLowerCase();
          expect(hay.includes(needle), `${p.key} ${col}=${v} reached the stored output`).toBe(false);
          expect(pub.includes(needle), `${p.key} ${col}=${v} reached the public title or summary`).toBe(false);
          const digits = v.replace(/\D/g, '');
          if (privatePhone && digits.length >= 10) expect(hay.replace(/\D/g, '').includes(digits), `${p.key} ${col} digits`).toBe(false);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
  it('every phone in any contact sits on a contractor or business contact, never on a site or an owner company', () => {
    for (const p of parseAll()) for (const s of p.items) for (const c of s.contacts ?? []) if (c.phone) expect(['contractor', 'business'], `${p.key} ${c.role}`).toContain(c.role);
  });
  it('no licence number outside Raleigh, and no driver-licence shape anywhere', () => {
    for (const p of parseAll()) {
      for (const s of p.items) for (const c of s.contacts ?? []) {
        if (c.license) {
          expect(s.source, p.key).toBe('arcgis-raleigh-permits');
          expect(c.license).not.toMatch(/^[A-Za-z]{1,2}[\s-]?\d{7,8}[A-Za-z]?$/);
        }
      }
    }
  });
  it('DC permits never read the applicant, DeKalb keeps its contact-type allow-list', () => {
    const dc = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dc-permits')!;
    expect(dc.contacts?.orgs).toBeUndefined();
    const dekalb = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-dekalb-permits')!;
    expect(dekalb.contacts?.orgs?.[0].acceptType).toBeInstanceOf(RegExp);
    expect(dekalb.contacts?.orgs?.[0].rejectType).toBeInstanceOf(RegExp);
  });
});
