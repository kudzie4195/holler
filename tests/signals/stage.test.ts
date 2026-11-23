// Round 17 STAGE (PLAN-2.0 2.1, 2.3): the pure pieces. Status vocabulary, card wording, which sources carry a status column, and the
// strong-match rules for "same project".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allStageStrings, isStageTrade, isTriggerStage, permitStageOf, stageLine, STAGE_TRADES, TRIGGER_STAGES } from '@/lib/signals/stage';
import { PERMIT_STATUS_SOURCES } from '@/lib/signals/stage-sources';
import { SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { cardBrief } from '@/lib/signals/brief';
import { routeFor } from '@/lib/signals/permit-routing';
import { labelFor } from '@/lib/signals/lead-rules';
import { MIRROR_GROUPS, normalizeAddress, PROJECT_WINDOW_DAYS, projectKeyOf, relationOf, sameProject, type ProjectKey } from '@/lib/signals/project';
import { BANNED } from './banned';

describe('permitStageOf: portal status text to one of five fixed codes', () => {
  const cases: Array<[string, ReturnType<typeof permitStageOf>]> = [
    ['Issued', 'issued'], ['issued', 'issued'], ['ACTIVE', 'issued'], ['Permit Issued', 'issued'],
    ['Final Inspection', 'final_inspection'], ['FINAL INSPECTION PENDING', 'final_inspection'], ['Ready for Final', 'final_inspection'],
    ['Finaled', 'finaled'], ['Final', 'finaled'], ['Complete', 'finaled'], ['COMPLETE', 'finaled'], ['Closed - Finaled', 'finaled'], ['Permit Finaled', 'finaled'],
    ['Final Approved', 'finaled'], ['Final Passed', 'finaled'], ['Final Accepted', 'finaled'], ['Certificate of Completion', 'finaled'],
    ['Certificate of Occupancy Issued', 'certificate_of_occupancy'], ['CO Issued', 'certificate_of_occupancy'], ['TCO', 'certificate_of_occupancy'],
    ['Expired', 'stopped'], ['Cancelled', 'stopped'], ['Withdrawn', 'stopped'],
    // never a trigger
    ['Incomplete', null], ['Final Inspection Failed', null], ['Not Finaled', null], ['Pre-final', null], ['In Review', null], ['Closed', null],
    ['Issued Status Code', null], ['', null],
  ];
  for (const [text, stage] of cases) it(`${JSON.stringify(text)} -> ${stage}`, () => expect(permitStageOf(text)).toBe(stage));
  it('non-strings and very long text are null', () => {
    expect(permitStageOf(undefined)).toBeNull();
    expect(permitStageOf(42)).toBeNull();
    expect(permitStageOf('x'.repeat(200))).toBeNull();
  });
  it('trigger stages are final inspection, finaled and certificate of occupancy only', () => {
    expect([...TRIGGER_STAGES].sort()).toEqual(['certificate_of_occupancy', 'final_inspection', 'finaled']);
    expect(isTriggerStage('issued')).toBe(false);
    expect(isTriggerStage('stopped')).toBe(false);
  });
});

describe('stage wording: timing, never a promise of work', () => {
  it('every line passes the banned words and says nothing about hiring, a vendor or need', () => {
    const all = allStageStrings();
    expect(all).toHaveLength(3);
    for (const s of all) {
      for (const re of BANNED) expect(s, String(re)).not.toMatch(re);
      expect(s).not.toMatch(/\bneed|\bhir|\bvendor|\bwill\b|\bcontract|\bchosen|\bselected|damage/i);
      expect(s).toMatch(/\bmay\b/);
      expect(s).toMatch(/public source/);
      expect(s.length).toBeLessThanOrEqual(130);
    }
  });
  it('the line prints the day Holler saw the stage, "on record" without one, and nothing for issued, stopped or an unknown value', () => {
    expect(stageLine('final_inspection', '2026-11-22T12:00:00Z')).toBe('The public source lists this permit at final inspection (seen Nov 22, 2026). The building may be ready soon.');
    expect(stageLine('finaled')).toContain('(on record)');
    expect(stageLine('issued', '2026-11-22T12:00:00Z')).toBeNull();
    expect(stageLine('stopped')).toBeNull();
    expect(stageLine('pwned <b>')).toBeNull();
    expect(stageLine(null)).toBeNull();
  });
  it('only permit cards carry it', () => {
    const permit = cardBrief({ source: 'socrata-sf-permits', kind: 'permit', subtype: 'permit', title: 'New home permit in X', label: 'coming_soon', trade: 'cleaning', permitStage: 'finaled', permitStageAt: '2026-11-22T12:00:00Z' });
    expect(permit.stageLine).toMatch(/finished/);
    const other = cardBrief({ source: 'socrata-chicago-311', kind: 'civic', subtype: '311', title: '311 request in X: Y', label: 'coming_soon', trade: 'cleaning', permitStage: 'finaled' });
    expect(other.stageLine).toBeNull();
    expect(cardBrief({ source: 'socrata-sf-permits', kind: 'permit', subtype: 'permit', title: 'New home permit in X', label: 'coming_soon', trade: 'cleaning' }).stageLine).toBeNull();
  });
});

describe('who gets the update: the stage trades, through the existing routing and label code', () => {
  it('cleaners, commercial cleaners, landscapers and security', () => expect([...STAGE_TRADES].sort()).toEqual(['cleaning', 'janitorial-commercial', 'landscaping', 'security']));
  it('a new home reaches cleaning, landscaping and security; at a finished stage all three are coming_soon; a re-roof reaches none of them', () => {
    const home = { source: 'socrata-sf-permits', kind: 'permit', subtype: 'permit', title: 'New home permit in X', summary: 'Single Family | 12 EXAMPLE LN' };
    for (const t of ['cleaning', 'landscaping', 'security']) {
      expect(routeFor(home.title, t, { summary: home.summary, source: home.source }), t).toBe('new-build');
      // round 19 RULES line 55: security is feed only at issue; the stage update (permitStage) keeps it a heads-up, as before
      expect(labelFor(home, t as never), t).toBe(t === 'security' ? 'market_insight' : 'coming_soon');
      for (const stage of ['final_inspection', 'finaled', 'certificate_of_occupancy']) expect(labelFor({ ...home, permitStage: stage }, t as never), `${t} ${stage}`).toBe('coming_soon');
    }
    const roof = { ...home, title: 'Roof permit in X', summary: 'Re-roof | 12 EXAMPLE LN' };
    for (const t of STAGE_TRADES) expect(routeFor(roof.title, t, { summary: roof.summary, source: roof.source }), t).toBeNull();
  });
  it('a tenant fit-out reaches commercial cleaning and security; house cleaning stays out', () => {
    expect(routeFor('Tenant fit-out permit in X', 'janitorial-commercial')).toBe('fit-out');
    expect(routeFor('Tenant fit-out permit in X', 'security')).toBe('fit-out');
    expect(routeFor('Tenant fit-out permit in X', 'cleaning')).toBeNull();
    expect(isStageTrade('roofing')).toBe(false);
  });
});

describe('2.1 which permit sources expose a status field (kept in step with the adapter configs)', () => {
  const socrata = new Map(SOCRATA_DATASETS.map((d) => [d.id, d] as const));
  const arcgis = new Map(ARCGIS_DATASETS.map((d) => [d.id, d] as const));
  it('the stage query date column of every source matches its dataset config; DeKalb (ArcGIS) has none ("needs live field check")', () => {
    for (const [id, v] of Object.entries(PERMIT_STATUS_SOURCES)) {
      const ds = socrata.get(id);
      expect(ds?.stageQuery?.dateField ?? null, id).toBe(v.stageDate);
    }
    expect(PERMIT_STATUS_SOURCES['arcgis-dekalb-permits'].stageDate).toBeNull();
    // Austin has no status column at all: no stage query either
    expect(socrata.get('socrata-austin-permits')?.stageQuery).toBeUndefined();
  });
  it('every dataset with a statusField is listed, with the same field, and every listed source has it', () => {
    const wired: Record<string, string> = {};
    for (const d of [...socrata.values(), ...arcgis.values()]) if (d.statusField) wired[d.id] = d.statusField;
    expect(wired).toEqual(Object.fromEntries(Object.entries(PERMIT_STATUS_SOURCES).map(([id, v]) => [id, v.field])));
  });
  it('a "config" source already asks for the column (summaryFields) and a "fixture" source shows it in a recorded row', () => {
    for (const [id, v] of Object.entries(PERMIT_STATUS_SOURCES)) {
      const ds = (socrata.get(id) ?? arcgis.get(id)) as { summaryFields: string[]; datasetId?: string };
      if (v.evidence === 'config') expect(ds.summaryFields, id).toContain(v.field);
      else {
        const rows = JSON.parse(readFileSync(`tests/fixtures/${id}.json`, 'utf8')) as Array<Record<string, unknown>>;
        expect(rows.some((r) => v.field in r), id).toBe(true);
      }
    }
  });
  it('only permits carry one', () => {
    for (const d of socrata.values()) if (d.statusField) expect(d.subtype).toBe('permit');
  });
  it('the parsers turn the status column into a stage code and keep every public field as it was', () => {
    const sf = parseSocrata(JSON.parse(readFileSync('tests/fixtures/socrata-sf-permits.json', 'utf8')), socrata.get('socrata-sf-permits') as SocrataDataset);
    expect(sf.length).toBeGreaterThan(0);
    for (const r of sf) expect(r.permitStage).toBe('issued');
    const ds = JSON.parse(readFileSync('tests/fixtures/socrata-sf-permits.json', 'utf8')) as Array<Record<string, unknown>>;
    const finaled = parseSocrata(ds.map((r) => ({ ...r, status: 'complete' })), socrata.get('socrata-sf-permits') as SocrataDataset);
    expect(finaled.every((r) => r.permitStage === 'finaled')).toBe(true);
    expect(finaled[0].data).not.toHaveProperty('permitStage'); // the stage is not stored by the plain upsert
    // DeKalb prints "Issued Status Code" on live rows: that is a field label, not a status
    const raw = JSON.parse(readFileSync('tests/fixtures/arcgis-dekalb-permits.json', 'utf8')) as { features: Array<{ attributes: object }> };
    const withStatus = (v: string) => ({ features: raw.features.map((f) => ({ ...f, attributes: { ...f.attributes, statusDescription: v } })) });
    const dk = parseArcgis(withStatus('Issued Status Code'), arcgis.get('arcgis-dekalb-permits') as never);
    expect(parseArcgis(withStatus('Finaled'), arcgis.get('arcgis-dekalb-permits') as never).every((r) => r.permitStage === 'finaled')).toBe(true);
    for (const r of dk) expect(r.permitStage).toBeUndefined();
  });
  it('a source with no status column never gets a stage', () => {
    const austin = parseSocrata(JSON.parse(readFileSync('tests/signals/fixtures/socrata-austin-permits-e14th-synthetic.json', 'utf8')).map((r: object) => ({ ...r, status: 'Final' })), socrata.get('socrata-austin-permits') as SocrataDataset);
    for (const r of austin) expect(r.permitStage).toBeUndefined();
  });
});

describe('2.3 same project: a strong match, never an address alone', () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    source: 's', externalId: 'a', kind: 'permit', title: 'Remodel permit in Austin', summary: 'Building Permit | Remodel | 1204 East 14th Street', categories: ['general-contractor'],
    occurredAt: '2026-11-19T06:00:00Z', lat: 30.27312, lon: -97.72964, city: 'Austin', state: 'TX', data: { subtype: 'permit' }, ...over,
  });
  const keyed = (r: ReturnType<typeof rec>) => ({ ...(projectKeyOf(r) as ProjectKey), occurredAt: r.occurredAt });
  const link = (r: ReturnType<typeof rec>) => { const k = projectKeyOf(r) as ProjectKey; return { key: k.key, source: r.source, externalId: r.externalId, occurredAt: r.occurredAt, lat: k.lat, lon: k.lon, city: k.city }; };

  it('normalizes the address text: direction, suffix, case, unit', () => {
    expect(normalizeAddress('1204 East 14th Street')).toBe('1204 E 14TH ST');
    expect(normalizeAddress('1204 e. 14th st.')).toBe('1204 E 14TH ST');
    expect(normalizeAddress('12 Oak Avenue, Apt 4')).toBe('12 OAK AVE #4');
    expect(normalizeAddress('12 Oak Avenue Unit 5')).not.toBe(normalizeAddress('12 Oak Avenue Unit 4'));
    expect(normalizeAddress('Peachtree at 14th')).toBeNull();
    expect(normalizeAddress(null)).toBeNull();
  });
  it('the window is documented: 3 days', () => expect(PROJECT_WINDOW_DAYS).toBe(3));
  it('same address, same trade, 2 days apart, same site: one project', () => {
    const a = rec(); const b = rec({ externalId: 'b', occurredAt: '2026-11-21T06:00:00Z', summary: 'Building Permit | Remodel | 1204 E 14TH ST' });
    expect(sameProject(keyed(b), link(a))).toBe(true);
  });
  it('4 days apart: two projects', () => expect(sameProject(keyed(rec({ occurredAt: '2026-11-23T06:00:00Z' })), link(rec()))).toBe(false));
  it('same address, different trade: never one project', () => {
    const plumbing = rec({ categories: ['plumbing'], title: 'Plumbing permit in Austin' });
    expect(projectKeyOf(plumbing)!.key).not.toBe(projectKeyOf(rec())!.key);
    expect(sameProject(keyed(plumbing), link(rec()))).toBe(false);
    // a mixed title is its own trade set
    expect(projectKeyOf(rec({ categories: ['general-contractor', 'plumbing'] }))!.key).not.toBe(projectKeyOf(rec())!.key);
  });
  it('same address text but 5 miles apart: not one site; with no real positions the same city decides', () => {
    expect(sameProject(keyed(rec({ lat: 30.32, lon: -97.72964 })), link(rec()))).toBe(false);
    const approx = { data: { subtype: 'permit', approxLocation: true } };
    expect(sameProject(keyed(rec({ ...approx })), link(rec({ ...approx, externalId: 'z' })))).toBe(true);
    expect(sameProject(keyed(rec({ ...approx, city: 'Elsewhere' })), link(rec({ ...approx })))).toBe(false);
  });
  it('different state or no address or not a permit: no key at all', () => {
    expect(projectKeyOf(rec({ state: 'GA' }))!.key).not.toBe(projectKeyOf(rec())!.key);
    expect(projectKeyOf(rec({ summary: 'Building Permit | Remodel' }))).toBeNull();
    expect(projectKeyOf(rec({ kind: 'civic', data: { subtype: '311' } }))).toBeNull();
    expect(projectKeyOf(rec({ categories: [] }))).toBeNull();
  });
  it('same source is a duplicate, another source is corroboration; no mirror is declared today', () => {
    expect(MIRROR_GROUPS).toEqual([]);
    expect(relationOf('a', 'a')).toBe('duplicate');
    expect(relationOf('a', 'b')).toBe('corroboration');
    expect(relationOf('a', 'b', [['a', 'b']])).toBe('duplicate');
    expect(relationOf('a', 'c', [['a', 'b']])).toBe('corroboration');
  });
});
