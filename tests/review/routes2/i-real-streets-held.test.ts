/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 18 ROUTES review 2 probe (logs/REV2-ROUTES-probe-tests), kept as a permanent regression test (redo 2).
// REV2-ROUTES probe I: real street names that the gate still refuses, through the real adapters, the real sanitiser and the scan's own
// markContactPaths, then the feed's shownHold. Copy to tests/_rev2/ in a clone at d93f95d; npx vitest run tests/_rev2/i-real-streets-held.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { markContactPaths } from '@/lib/signals/run';
import { matchSignals, type MatchProfile } from '@/lib/signals/match';
import { CATEGORIES } from '@/lib/signals/categories';
import { shownHold } from '@/lib/signals/alert-gate';
import { sanitizeContacts } from '@/lib/contacts/sanitize';
import type { StoredSignal } from '@/lib/signals/store';
import type { SignalInput } from '@/lib/signals/types';

const NOW = new Date('2026-11-22T12:00:00Z');
const atl = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-atlanta-permits')!;
const live = JSON.parse(readFileSync('tests/coverage/fixtures/arcgis-atlanta-permits-live-2026-11-19.json', 'utf8'));
// a real live Atlanta row that alerts today, with only its Address changed to another real Atlanta street
const atlRow = (address: string, i: number) => { const f = live.features.find((x: any) => /Demolition|New/i.test(x.attributes.TypeCombo ?? '')) ?? live.features[1]; return { ...f, attributes: { ...f.attributes, RecordID: `X-${i}`, Address: address } }; };
const nyc = SOCRATA_DATASETS.find((d) => d.id === 'socrata-nyc-permits')!;
const sf = SOCRATA_DATASETS.find((d) => d.id === 'socrata-sf-permits')!;
const toStored = (s: SignalInput, id: number): StoredSignal => ({ id, source: s.source, external_id: s.externalId, kind: s.kind, subtype: 'permit', title: s.title, summary: s.summary ?? null, categories: s.categories, lat: s.lat ?? 0, lon: s.lon ?? 0, state: s.state ?? 'GA', severity: 1, occurred_at: s.occurredAt, data: s.data ?? {} }) as any;
function run(items: SignalInput[]) {
  const stored = items.map((s, i) => toStored(s, i + 1));
  markContactPaths(stored, items);
  return stored.map((r, k) => {
    const profiles: MatchProfile[] = CATEGORIES.map((c) => ({ user_id: c.id, categories: [c.id], lat: r.lat ?? 0, lon: r.lon ?? 0, state: r.state ?? 'GA', radius_mi: 50, plan: 'pro' }) as MatchProfile);
    const rows = matchSignals([r], profiles, 1000, NOW, true);
    const eligible = matchSignals([{ ...r, contactPath: null } as never], profiles, 1000, NOW, true).filter((x) => x.alert_hold === 'background').length;
    const held = rows.filter((x) => x.alert_hold === 'background').length;
    const contacts = sanitizeContacts(items[k].contacts ?? [], { datasetCity: items[k].city ?? null });
    return { title: r.title, summary: r.summary, path: (r as any).contactPath, eligible, held, site: contacts.filter((c) => c.role === 'site').map((c) => c.address), note: shownHold(held ? 'background' : null, contacts, r.summary) };
  });
}

describe('REV2-ROUTES I: a card that prints a real street address is held, and says it has no site address', () => {
  it('Atlanta (no street suffix in the feed): streets whose name holds a word on the not-a-street list', () => {
    const control = '2300 NANCY CREEK NW, ATLANTA, GA 30327';
    const real = ['3080 NEW HOPE SW, ATLANTA, GA 30331', '1240 COUNTY LINE SW, ATLANTA, GA 30331', '55 NEW JERSEY NW, ATLANTA, GA 30314'];
    const res = run(parseArcgis({ features: [control, ...real].map(atlRow) }, atl));
    for (const r of res) console.log(`ATL  ${r.summary}  -> path ${r.path}; alert-eligible trades ${r.eligible}, held ${r.held}; feed note: ${r.note === 'background' ? '"This permit names no business and no site address"' : 'none'}`);
    expect(res[0].held).toBe(0);
    for (const r of res.slice(1)) { expect(r.eligible).toBeGreaterThan(0); expect(r.held, r.summary ?? '').toBe(0); } // REQUIRED: a printed street address is a contact path
  });
  it('New York (Bath Ave, New Lots Ave in Brooklyn) and San Francisco (Day St): the site contact is stored and shown, the card is still held', () => {
    const n = (house: string, street: string, i: number) => ({ work_permit: `B-${i}`, issued_date: '2026-11-20T00:00:00.000', job_description: 'demolition of existing one story building', work_type: 'Full Demolition', house_no: house, street_name: street, borough: 'BROOKLYN', zip_code: '11214', latitude: '40.6', longitude: '-74.0', estimated_job_costs: '50000' });
    const ny = run(parseSocrata([n('1800', 'BATH AVENUE', 1), n('653', 'NEW LOTS AVENUE', 2), n('1800', 'BAY PARKWAY', 3)], nyc));
    const s = (num: string, name: string, suf: string, i: number) => ({ permit_number: `S-${i}`, permit_type_definition: 'demolitions', description: 'demolish single family dwelling', status: 'issued', issued_date: '2026-11-20T00:00:00.000', estimated_cost: '18000', street_number: num, street_name: name, street_suffix: suf, zipcode: '94131', location: { type: 'Point', coordinates: [-122.429, 37.8003] } });
    const sfr = run(parseSocrata([s('25', 'Day', 'St', 1), s('25', 'Duncan', 'St', 2)], sf));
    for (const r of [...ny, ...sfr]) console.log(`${r.title}  |  ${r.summary}  -> stored site contact ${JSON.stringify(r.site)}; path ${r.path}; alert-eligible ${r.eligible}, held ${r.held}; feed note: ${r.note === 'background' ? '"This permit names no business and no site address"' : 'none'}`);
    for (const r of [...ny, ...sfr]) if (r.eligible > 0) expect(r.held, r.summary ?? '').toBe(0); // REQUIRED
  });
});
