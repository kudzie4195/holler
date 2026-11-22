/**
 * Cobb County residential permits, round 15 unit K (PLAN-2.0 item 1.4): the Smyrna test.
 *
 * Inputs are the live rows of 2026-11-19 (tests/coverage/fixtures/arcgis-cobb-*-live-2026-11-19.json, provenance in cobb-approx.test.ts),
 * run through the real parser (parseCobb), the real matcher (matchOne, with the approximate-location reach) and the real label rules for
 * members in ZIP 30080 (Smyrna, 33.8826, -84.5144; Smyrna is inside Cobb County). Nothing here is hand-labelled.
 *
 * What the data supports (checked in the fixtures): layer 4 (Residential Permits) carries only PermitType "New Home"; layer 1 (Commercial)
 * New Tenant / Remodel / Vacant Tenant; layer 3 (MultiUnit) Townhome. None of the three names a roofing, HVAC, electrical or plumbing job,
 * so a roofer in Smyrna is shown NO Cobb row (correct: nothing here is a roof). Movers and real-estate members get new-home rows as
 * Coming Soon; the general contractor gets them as Market Insight (the permitted work is theirs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { COBB_SOURCE_IDS, parseCobb } from '@/lib/signals/adapters/arcgis-cobb';
import { matchOne, type MatchSignal } from '@/lib/signals/match';
import { cardBrief } from '@/lib/signals/brief';
import { BANNED } from '../signals/banned';

const FILES: Record<string, string> = {
  'arcgis-cobb-residential-permits': 'arcgis-cobb-residential-live-2026-11-19.json',
  'arcgis-cobb-commercial-permits': 'arcgis-cobb-commercial-live-2026-11-19.json',
  'arcgis-cobb-multiunit-permits': 'arcgis-cobb-multiunit-live-2026-11-19.json',
};
const rows = COBB_SOURCE_IDS.flatMap((id) => {
  const ds = ARCGIS_DATASETS.find((d) => d.id === id)!;
  const body = JSON.parse(readFileSync(join(__dirname, 'fixtures', FILES[id]), 'utf8')) as unknown;
  return parseCobb(body, ds);
});
const sigOf = (s: (typeof rows)[number], i: number): MatchSignal => ({
  id: i + 1, source: s.source, kind: s.kind, title: s.title, summary: s.summary ?? null, categories: s.categories, lat: s.lat ?? null, lon: s.lon ?? null,
  state: s.state ?? null, severity: s.severity, occurred_at: s.occurredAt, subtype: 'permit', data: s.data,
});
const smyrna = (categories: string[]) => ({ user_id: 'u', categories, lat: 33.8826, lon: -84.5144, state: 'GA', radius_mi: 25 });

describe('Smyrna (30080) members and the Cobb permit rows', () => {
  it('has rows from all three layers', () => {
    for (const id of COBB_SOURCE_IDS) expect(rows.some((r) => r.source === id)).toBe(true);
  });

  it('a Smyrna roofer, HVAC, electrical and plumbing member is shown no Cobb row (no layer names that work)', () => {
    for (const trade of ['roofing', 'hvac', 'electrical', 'plumbing']) {
      const hits = rows.map(sigOf).filter((sig) => matchOne(sig, smyrna([trade])));
      expect(hits, trade).toHaveLength(0);
    }
  });

  it('a Smyrna mover and a real-estate member get every New Home / Townhome row as Coming Soon, with no distance', () => {
    for (const trade of ['moving', 'real-estate']) {
      const sigs = rows.map(sigOf).filter((s) => /new home permit/i.test(s.title ?? ''));
      expect(sigs.length).toBeGreaterThan(0);
      for (const sig of sigs) {
        const m = matchOne(sig, smyrna([trade]));
        expect(m, `${trade} ${sig.title}`).not.toBeNull();
        expect(m!.label).toBe('coming_soon');
        expect(m!.distance_mi).toBeNull();
      }
    }
  });

  it('a Smyrna general contractor gets residential, commercial and multi-unit rows as Market Insight (their own trade)', () => {
    const labels = new Set<string>();
    for (const sig of rows.map(sigOf)) {
      const m = matchOne(sig, smyrna(['general-contractor']));
      expect(m, sig.title ?? '').not.toBeNull();
      labels.add(`${sig.source}:${m!.label}`);
    }
    expect([...labels].sort()).toEqual([
      'arcgis-cobb-commercial-permits:market_insight',
      'arcgis-cobb-multiunit-permits:market_insight',
      'arcgis-cobb-residential-permits:market_insight',
    ]);
  });

  it('a member far from the county (Macon, about 80 mi) is not matched; the reach is radius + 15 mi from the county seat', () => {
    const macon = { user_id: 'u2', categories: ['moving'], lat: 32.8407, lon: -83.6324, state: 'GA', radius_mi: 25 };
    for (const sig of rows.map(sigOf)) expect(matchOne(sig, macon)).toBeNull();
  });

  it('the card for a mover says what the permit is and is not, names the county, and never uses a banned word', () => {
    const s = rows.find((r) => /new home permit/i.test(r.title))!;
    const b = cardBrief({ source: s.source, kind: s.kind, subtype: 'permit', title: s.title, summary: s.summary ?? null, label: 'coming_soon', trade: 'moving', url: s.url ?? null, occurredAt: s.occurredAt });
    expect(s.title).toMatch(/Cobb County$/);
    expect(b.source.label).toBe('Cobb County open data: building permits');
    expect(b.source.href).toMatch(/^https:\/\/gis\.cobbcounty\.org\/gisserver\/rest\/services\/comdev\/Accela_PermitsDashboard\/FeatureServer\/\d$/);
    for (const text of [b.why, b.next, b.uncertain, s.title, s.summary ?? '']) for (const re of BANNED) expect(text).not.toMatch(re);
  });
});
