/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/**
 * REV-ROUTES probe 06 (run on BOTH commits; output diffed): the label and categories of every permit fixture row in the repo.
 *  (a) raw portal fixtures through the real adapters;
 *  (b) the stored real rows (their structured type, class and use from the public summary) with no description and with five
 *      descriptions (the stored rows keep no description, so the descriptions are stand-ins);
 *  (c) an adversarial matrix of real new construction and real demolition shapes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { parseJohnsCreek } from '@/lib/signals/adapters/arcgis-johnscreek';
import { classifyPermit } from '@/lib/signals/mapping/permit';
import { summaryParts } from '@/lib/signals/permit-routing';

const j = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const soc = (id: string) => SOCRATA_DATASETS.find((d) => d.id === id)!;
const arc = (id: string) => ARCGIS_DATASETS.find((d) => d.id === id)!;
const rowsOf = (d: any) => (Array.isArray(d) ? d : d.rows);

describe('REV-ROUTES 06 dump', () => {
  it('writes labels', () => {
    const out: Record<string, { label: string | null; cats: string[] }> = {};
    const raw: Array<[string, () => any[]]> = [
      ...['dc', 'dekalb', 'mecklenburg', 'raleigh'].map((c) => [`tests/fixtures/arcgis-${c}-permits.json`, () => parseArcgis(j(`tests/fixtures/arcgis-${c}-permits.json`), arc(`arcgis-${c}-permits`))] as [string, () => any[]]),
      ['tests/coverage/fixtures/arcgis-atlanta-permits-live-2026-11-19.json', () => parseArcgis(j('tests/coverage/fixtures/arcgis-atlanta-permits-live-2026-11-19.json'), arc('arcgis-atlanta-permits'))],
      ['tests/coverage/fixtures/arcgis-johnscreek-permits-live-2026-11-19.json', () => parseJohnsCreek(j('tests/coverage/fixtures/arcgis-johnscreek-permits-live-2026-11-19.json'))],
      ...['buffalo', 'cambridge', 'chicago', 'cincinnati', 'montgomery', 'nola', 'norfolk', 'orlando', 'sf'].map((c) => [`tests/fixtures/socrata-${c}-permits.json`, () => parseSocrata(j(`tests/fixtures/socrata-${c}-permits.json`), soc(`socrata-${c}-permits`))] as [string, () => any[]]),
      ['tests/signals/adapters/fixtures/S-sample-la-permits.json', () => parseSocrata(rowsOf(j('tests/signals/adapters/fixtures/S-sample-la-permits.json')), soc('socrata-la-permits'))],
      ['tests/signals/fixtures/socrata-austin-permits-e14th-synthetic.json', () => parseSocrata(rowsOf(j('tests/signals/fixtures/socrata-austin-permits-e14th-synthetic.json')), soc('socrata-austin-permits'))],
      ['tests/contacts/fixtures/socrata-austin-permits-contacts.json', () => parseSocrata(rowsOf(j('tests/contacts/fixtures/socrata-austin-permits-contacts.json')), soc('socrata-austin-permits'))],
      ['tests/contacts/fixtures/socrata-chicago-permits-contacts.json', () => parseSocrata(rowsOf(j('tests/contacts/fixtures/socrata-chicago-permits-contacts.json')), soc('socrata-chicago-permits'))],
    ];
    let nRaw = 0;
    for (const [file, parse] of raw) {
      for (const s of parse()) {
        nRaw++;
        out[`raw|${file}|${s.externalId}`] = { label: s.title, cats: s.categories };
      }
    }
    const stored = new Map<number, { source: string; title: string; summary: string | null }>();
    for (const r of j('tests/signals/__data__/review-f-sample-156.json') as any[]) stored.set(r[0], { source: r[1], title: r[2], summary: r[3] });
    for (const c of j('tests/signals/__data__/quality-gate-r15-cards.json').cards as any[]) if (c.signal?.kind === 'permit') stored.set(c.signal.id, { source: c.signal.source, title: c.signal.title, summary: c.signal.summary ?? null });
    const FREE = ['', 'interior demolition of kitchen and bath', 'demolish existing structure', 'new single family residence', 'new construction of 3 story office building', 'reroof and replace hvac unit'];
    let nStored = 0;
    for (const [id, r] of stored) {
      if (!/permits$/.test(r.source)) continue;
      nStored++;
      for (const f of FREE) {
        const c = classifyPermit({ structured: summaryParts(r.summary), ...(f ? { free: [f] } : {}) }, 'X');
        out[`stored|${id}|${r.source}|${summaryParts(r.summary).join(' / ')}|stored title: ${r.title}|free: ${f || '(none)'}`] = { label: c.label, cats: c.categories };
      }
    }
    const ADV: Array<[string[], string[]]> = [
      [['New'], []], [['Building', 'New'], []], [['Building Permit', 'New'], []], [['Residential', 'New'], []], [['Commercial', 'New'], []],
      [['Building Permit', 'New', 'Electrical'], []], [['Building, Electrical, Mechanical, Plumbing', 'New'], []], [['Combination Permit', 'New'], ['new sfd with electrical mechanical plumbing']],
      [['Residential Combo (Bldg/Elec/Mech/Plbg)', 'New'], []], [['Single Family Dwelling', 'New'], []], [['Townhouse', 'New'], []], [['Duplex', 'New'], []], [['Apartment Building', 'New'], []],
      [['Foundation', 'New'], []], [['Shell', 'New'], []], [['Garage', 'New'], []], [['Pool', 'New'], []], [['Fence', 'New'], []], [['Sign', 'New'], []], [['Roofing', 'New'], []],
      [['Mechanical', 'New'], ['new 2 story house']], [['Electrical', 'New'], ['NEW SFR']], [['Electrical', 'New'], ['new construction of warehouse']], [['Plumbing', 'New'], ['new home']],
      [['Electrical', 'New Construction'], []], [['Mechanical', 'New Building'], []], [['New Construction', 'Single Family Dwelling'], []], [['Commercial New Construction', 'New'], []],
      [['Driveway / Sidewalks', 'New'], ['new single family residence with driveway']], [['Electrical', 'NEW'], []], [['Electrical', ' new '], []], [['Electrical', 'New/Addition'], []], [['Electrical', 'New Install'], []],
      // demolition
      [['Demolition'], []], [['Bldg-Demolition'], []], [['Commercial Demolition'], []], [['Residential Demolition'], []], [['PERMIT - WRECKING/DEMOLITION'], []],
      [['Alteration'], ['demolish existing single family dwelling']], [['Alteration'], ['complete demolition of house and garage']], [['Alteration/Demolition'], ['demolish garage']], [['Alter/Repair/Demo'], ['total demo of structure']],
      [['Bldg-Alter/Repair'], ['demolish existing detached garage']], [['otc alterations permit'], ['interior demolition']], [['Alter Commercial'], ['soft demo for tenant improvement']], [['Renovation'], ['raze building']],
      [['Building Permit', 'Remodel'], ['demolition of entire building to slab']], [['Building Permit', 'Demolition'], ['demolish house']], [['Building Permit'], ['demolish house']], [['Residential Alteration'], ['demo']],
      [['PERMIT - RENOVATION/ALTERATION'], ['wreck and remove 2 story frame residence']], [['Alteration', 'Wrecking'], []], [['Rehab'], ['demolition']], [['Alteration'], ['demo and new plumbing']], [['Alteration'], ['demo, reroof']],
      [['Demolition', 'Alteration'], ['interior demolition']], [['Interior Demolition'], []], [['Interior Alteration'], ['interior demolition only, no new work']],
    ];
    for (const [s, f] of ADV) {
      const c = classifyPermit({ structured: s, ...(f.length ? { free: f } : {}) }, 'X');
      out[`adv|${s.join(' / ')}|free: ${f.join(' ') || '(none)'}`] = { label: c.label, cats: c.categories };
    }
    if (process.env.REV_OUT) writeFileSync(process.env.REV_OUT as string, JSON.stringify({ nRaw, nStored, out }, null, 1));
    expect(nRaw).toBeGreaterThan(40);
    // Redo 1: pinned. Against 3d01b54 the redo changes 106 of 1,200 entries, all intended: the interior-demolition alterations keep
    // junk-removal as a tag (decision 5), and a combined type that names a building beside "New" keeps New construction (review P3-9).
    expect({ nRaw, nStored, entries: Object.keys(out).length, sha: createHash('sha256').update(JSON.stringify(out)).digest('hex') }).toMatchSnapshot();
  });
});
