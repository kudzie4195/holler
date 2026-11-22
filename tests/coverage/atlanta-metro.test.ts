/**
 * Fixture provenance (tests/coverage/fixtures/arcgis-*-live-2026-11-19.json)
 * Rows copied from the live layers on 2026-11-19 through each layer's /query endpoint (outSR 4326), reduced to the attributes the config reads.
 * Edits made on purpose: Atlanta permit names that held a surname or an agency name were replaced with "Example" values, and every house number in
 * the three fixtures was replaced with a round fake number. Coordinates are rounded to 4 decimals. No phone, email or personal name remains.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildArcgisQuery, parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS, type ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import { JC_SYNTH_FIELD, JOHNS_CREEK_PERMITS, adapters as jcAdapters, addJobWorkType, parseJohnsCreek } from '@/lib/signals/adapters/arcgis-johnscreek';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { SOURCE_META } from '@/lib/signals/source-meta';
import type { AdapterContext } from '@/lib/signals/types';

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures', n), 'utf8'));
const ds = (id: string): ArcgisDataset => {
  const d = ARCGIS_DATASETS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};

describe('Atlanta building permit applications', () => {
  const out = parseArcgis(fx('arcgis-atlanta-permits-live-2026-11-19.json'), ds('arcgis-atlanta-permits'));
  const byId = (id: string) => out.find((s) => s.externalId === id)!;

  it('parses every fixture row into a public permit signal', () => {
    // 5 of 6: "Example Pool Cabana" under "Residential Miscellaneous" is dropped. Name mixes addresses, descriptions and names, so a bare
    // "Pool" there is not a work phrase (round 7 review r1: "POOL RESIDENCE" is a surname), and Miscellaneous names no trade.
    expect(out.length).toBe(5);
    for (const s of out) {
      expect(s.source).toBe('arcgis-atlanta-permits');
      expect(s.kind).toBe('permit');
      expect(s.city).toBe('Atlanta');
      expect(s.state).toBe('GA');
      expect(s.lat).toBeGreaterThan(33.6);
      expect(s.lat).toBeLessThan(33.9);
      expect(s.lon).toBeLessThan(-84.3);
      expect(s.contacts).toBeUndefined();
    }
  });

  it('finds the roof job in the project name and prints only a fixed title', () => {
    const roof = byId('BB-202609998');
    // verify-v1 decision 1: the Name column's work phrase adds roofing and keeps the type column's general contractor.
    expect(roof.categories).toEqual(['roofing', 'general-contractor']);
    expect(roof.title).toBe('Roof and remodel permit in Atlanta');
    expect(roof.occurredAt).toBe('2026-11-17T00:00:00.000Z');
  });

  it('maps the structured type to trades', () => {
    expect(byId('BB-202610049').categories).toEqual(['junk-removal']);
    expect(byId('BB-202610011')).toBeUndefined();
    expect(byId('BB-202610038').categories).toEqual(['general-contractor']);
    expect(byId('BB-202610045').categories).toEqual(['general-contractor']);
    expect(byId('BB-202610043').title).toBe('Tenant fit-out permit in Atlanta'); // a commercial alteration is a tenant fit-out (round 15 Q2)
  });

  it('never copies the free-text Name column into any public field', () => {
    const text = JSON.stringify(out.map((s) => [s.title, s.summary, s.data]));
    expect(text).not.toMatch(/EXAMPLE AGENCY|Pool Cabana|VIP WINGS|Roof Replacement|Duplex/i);
    expect(text).not.toMatch(/[\w.]+@[\w.]+|\d{3}[-. ]\d{3}[-. ]\d{4}/);
  });

  it('puts the job value in the summary as a number, and drops a zero value', () => {
    expect(byId('BB-202610049').summary).toContain('$40,000 job value');
    expect(byId('BB-202609998').summary).not.toMatch(/job value/);
  });

  it('asks the layer for the newest rows and leaves out rows that are not work', () => {
    const q = buildArcgisQuery(ds('arcgis-atlanta-permits'), new Date('2026-11-19T12:00:00Z'));
    const where = q.get('where') ?? '';
    expect(where).toContain("Opend >= timestamp '2026-11-12 12:00:00'");
    expect(where).toContain('NOT IN');
    for (const t of ['Open Record Request', 'Building Complaint']) expect(where).toContain(t);
    expect(q.get('orderByFields')).toBe('Opend DESC');
    expect(q.get('outSR')).toBe('4326');
    // the owner-like and contact-like columns do not exist on this layer; the only free text read is Name
    expect(q.get('outFields')).not.toMatch(/owner|applicant|contact|phone|email/i);
  });
});

describe('DeKalb County code violations', () => {
  const cfg = ds('arcgis-dekalb-violations');
  const out = parseArcgis(fx('arcgis-dekalb-violations-live-2026-11-19.json'), cfg);

  it('keeps rows with a violation heading and drops the rest', () => {
    expect(out.map((s) => s.externalId).sort()).toEqual(['1323878', '1324014', '1324019', '1324038']);
    expect(out.find((s) => s.externalId === '1324047')).toBeUndefined(); // parking rule: no trade
    expect(out.find((s) => s.externalId === '1324118')).toBeUndefined(); // no heading yet
  });

  it('maps debris, vegetation and vehicles to trades', () => {
    const by = (id: string) => out.find((s) => s.externalId === id)!;
    expect(by('1324019').categories).toEqual(['junk-removal']);
    expect(by('1324038').categories).toEqual(expect.arrayContaining(['lawn-care', 'landscaping']));
    expect(by('1324014').categories).toEqual(expect.arrayContaining(['towing']));
  });

  it('prints a fixed title, a block-level address and a block-level point, and no contact', () => {
    for (const s of out) {
      expect(s.title).toBe('Code violation in DeKalb County: property violation');
      expect(s.summary).toMatch(/^\d{1,2}00 block of [A-Z ]+$/);
      expect(s.kind).toBe('civic');
      expect(s.contacts).toBeUndefined();
      expect(Math.round((s.lat as number) * 1000) / 1000).toBe(s.lat);
      expect(Math.round((s.lon as number) * 1000) / 1000).toBe(s.lon);
      expect(s.data).toMatchObject({ subtype: 'violation' });
    }
    expect(out.find((s) => s.externalId === '1324019')!.summary).toBe('1600 block of HAIRSTON RD');
  });

  it('uses addedDateTime as the case date', () => {
    expect(out.find((s) => s.externalId === '1324019')!.occurredAt).toBe('2026-11-17T15:28:41.000Z');
    expect(buildArcgisQuery(cfg, new Date('2026-11-19T00:00:00Z')).get('orderByFields')).toBe('addedDateTime DESC');
  });

  it('does not ask the layer for comments, names or contact columns', () => {
    const fields = buildArcgisQuery(cfg).get('outFields') ?? '';
    expect(fields).not.toMatch(/comment|caller|owner|complain|email|phone|takenBy|requestedBy/i);
  });
});

describe('Johns Creek building permits', () => {
  it('turns the job number prefix into a fixed work word and classifies it', () => {
    const out = parseJohnsCreek(fx('arcgis-johnscreek-permits-live-2026-11-19.json'));
    const by = (id: string) => out.find((s) => s.externalId === id)!;
    expect(out.length).toBe(7); // ADMIN-26-0025 is not on the prefix list
    expect(by('MECH-26-0767').categories).toEqual(['hvac']);
    expect(by('MECH-26-0767').title).toBe('HVAC permit in Johns Creek');
    expect(by('ELCT-26-0631').categories).toEqual(['electrical']);
    expect(by('PLMB-26-0522').categories).toEqual(['plumbing']);
    expect(by('TREE-26-0110').categories).toEqual(['tree-service']);
    expect(by('FENCE-26-0043').categories).toEqual(['fencing']);
    expect(by('BLDR-26-0416').categories).toEqual(['general-contractor']);
    expect(out.find((s) => s.externalId === 'ADMIN-26-0025')).toBeUndefined();
    for (const s of out) {
      expect(s.state).toBe('GA');
      expect(s.city).toBe('Johns Creek');
      expect(s.lat).toBeGreaterThan(33.9);
    }
  });

  it('does not change its input and ignores unknown prefixes and junk', () => {
    const raw = fx('arcgis-johnscreek-permits-live-2026-11-19.json') as { features: { attributes: Record<string, unknown> }[] };
    const copy = JSON.stringify(raw);
    const added = addJobWorkType(raw) as { features: { attributes: Record<string, unknown> }[] };
    expect(JSON.stringify(raw)).toBe(copy);
    expect(added.features[0].attributes[JC_SYNTH_FIELD]).toBe('Mechanical');
    expect(added.features[7].attributes[JC_SYNTH_FIELD]).toBeUndefined();
    expect(addJobWorkType(null)).toBeNull();
    expect(addJobWorkType({ features: 'x' })).toEqual({ features: 'x' });
    expect(parseJohnsCreek({ error: { code: 400, message: 'bad' } })).toEqual([]);
  });

  it('the adapter never sends the synthetic field to the server and returns the same rows', async () => {
    const urls: string[] = [];
    const ctx: AdapterContext = {
      since: new Date(),
      now: new Date('2026-11-19T12:00:00Z'),
      env: {},
      log: () => undefined,
      fetch: (async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return new Response(JSON.stringify(fx('arcgis-johnscreek-permits-live-2026-11-19.json')), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    };
    const rows = await jcAdapters[0].fetch(ctx);
    expect(rows.length).toBe(7);
    const u = new URL(urls[0]);
    expect(u.searchParams.get('outFields')).not.toContain(JC_SYNTH_FIELD);
    expect(u.searchParams.get('outFields')).toContain('JobID');
    expect(u.searchParams.get('where')).toContain("JobID LIKE 'MECH-%'");
    expect(u.searchParams.get('where')).not.toContain("'ADMIN-%'");
    expect(u.searchParams.get('orderByFields')).toBe('ISSUE_DATE DESC');
  });
});

describe('registration', () => {
  const ids = ['arcgis-atlanta-permits', 'arcgis-dekalb-violations', 'arcgis-johnscreek-permits'];
  it('the three feeds are enabled adapters with source-meta that matches', () => {
    for (const id of ids) {
      const a = ALL_ADAPTERS.find((x) => x.id === id);
      expect(a, id).toBeDefined();
      expect(SOURCE_META[id]).toEqual({ id, label: a!.label, sourceUrl: a!.sourceUrl });
    }
    expect(new Set(ALL_ADAPTERS.map((a) => a.id)).size).toBe(ALL_ADAPTERS.length);
  });
  it('every Georgia ArcGIS feed carries its metadata URL and a check date', () => {
    const cfgs = [...ARCGIS_DATASETS.filter((d) => d.state === 'GA'), JOHNS_CREEK_PERMITS];
    for (const d of cfgs) {
      expect(d.verifiedUrl, d.id).toMatch(/^https:\/\/.+\?f=json$/);
      expect(d.checkedOn, d.id).toMatch(/^2026-11-\d\d$/);
    }
    expect(ids.every((id) => cfgs.find((d) => d.id === id)?.verified === true)).toBe(true);
  });
});
