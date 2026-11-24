/**
 * Round 28: Austin and Raleigh building permits carry their permit class, so a commercial permit routes like a commercial permit from any
 * other city (permit-routing.ts applyRecordClass: new build and remodel go to the fit-out row) and never to movers, pools or lawn care.
 *
 * Fixture provenance (no network in tests):
 * - tests/fixtures/r28-austin-permits-class.json: field names and values of data.austintexas.gov 3syk-w9eu rows read with the SODA API on
 *   2026-11-24. 2026-084222 BP is Holler record 67557 (the $60M airport concourse at 10113 MAINTAINERS DR). 2026-066698 BP and 2026-146952 BP
 *   are real rows; their total_job_valuation was 0 on the portal and is set to a round amount here. 2026-900001 BP is a copy of a real
 *   R-101 row (4521 TUMALO DR) with a made-up person name in contractor_company_name to prove the sole-proprietor guard still holds;
 *   contractor_full_name ("Pat Q Example") is made up and is never read.
 * - tests/fixtures/r28-raleigh-permits-class.json: attributes of live features of the City of Raleigh Building_Permits FeatureServer layer 0
 *   read on 2026-11-24 (permitclassmapped is "Residential" or "Non-Residential"; permitclass is null on them). Descriptions are cut short.
 *   BLDR-046368-2026 has a made-up person name in contractorcompanyname (the real row names a home builder).
 * - tests/fixtures/r28-other-city-route-snapshot.json: 229 permit rows of the other cities from the 14-day export with the route and label
 *   results the code gave at 45a6079, before this change.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { carriedTrades, downstreamTradesOf, routeKindsOf } from '@/lib/signals/permit-routing';
import { isAlertLabel, labelFor, recordLabelInput } from '@/lib/signals/lead-rules';
import { recordPropertyOf } from '@/lib/signals/work-profile';
import { CATEGORY_IDS, type CategoryId } from '@/lib/signals/categories';
import type { SignalInput } from '@/lib/signals/types';

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, '../fixtures', n), 'utf8'));
const austinDs = SOCRATA_DATASETS.find((d) => d.id === 'socrata-austin-permits')!;
const raleighDs = ARCGIS_DATASETS.find((d) => d.id === 'arcgis-raleigh-permits')!;
const austin = parseSocrata(fx('r28-austin-permits-class.json'), austinDs);
const raleigh = parseArcgis(fx('r28-raleigh-permits-class.json'), raleighDs);
const byId = (rows: SignalInput[], id: string) => {
  const r = rows.find((x) => x.externalId === id);
  if (!r) throw new Error(`missing ${id}`);
  return r;
};
const rec = (s: SignalInput) => ({ source: s.source, kind: s.kind, subtype: 'permit', title: s.title, summary: s.summary ?? null });
/** The trades that see the record, as matchOne reads them (own tags plus downstream). */
const carried = (s: SignalInput) => [...carriedTrades(rec(s), s.categories)];
/** The trades that get an alert (urgent or heads-up) from the record. */
const alerted = (s: SignalInput) => carried(s).filter((t) => isAlertLabel(labelFor(recordLabelInput(rec(s)), t as CategoryId)));

const HOME_ONLY = ['moving', 'pool-spa', 'lawn-care', 'landscaping', 'cleaning', 'handyman', 'flooring', 'painting', 'fencing', 'windows-doors'];
const FIT_OUT = ['janitorial-commercial', 'signs-printing', 'security', 'pest-control', 'business-services'];
/** Fit-out trades that no new home reaches (security follows both). */
const FIT_OUT_ONLY = FIT_OUT.filter((t) => t !== 'security');

describe('R28 config: the class column is a summary part (checked against the portal metadata)', () => {
  it('Austin prints permit_class_mapped, Raleigh prints permitclassmapped, after the work class and before the value', () => {
    expect(austinDs.summaryFields).toEqual(['permit_type_desc', 'work_class', 'permit_class_mapped', 'total_job_valuation']);
    expect(raleighDs.summaryFields).toEqual(['permittype', 'workclass', 'permitclassmapped', 'estprojectcost']);
  });
});

describe('R28 Austin', () => {
  it('record 67557 (2026-084222 BP, $60M commercial new build): fit-out trades, never movers, pools, lawn care or any home trade', () => {
    const s = byId(austin, '2026-084222 BP');
    expect(s.title).toBe('New construction permit in Austin');
    expect(s.summary).toBe('Building Permit | New | Commercial | $60,000,000 job value | 10113 MAINTAINERS DR');
    expect(routeKindsOf(s.title, rec(s))).toEqual(['fit-out']);
    expect(downstreamTradesOf(s.title, rec(s))).toEqual(FIT_OUT);
    const c = carried(s);
    for (const t of ['lawn-care', 'moving', 'pool-spa', ...HOME_ONLY]) expect(c).not.toContain(t);
    expect(c).toEqual(['general-contractor', ...FIT_OUT]);
    expect(recordPropertyOf(rec(s))).toBe('commercial');
  });

  it('record 67557 as stored before (no class in the summary) routed to the home trades: the bug this round fixes', () => {
    const before = { source: 'socrata-austin-permits', kind: 'permit', subtype: 'permit', title: 'New construction permit in Austin', summary: 'Building Permit | New | $60,000,000 job value | 10113 MAINTAINERS DR' };
    const c = carriedTrades(before, ['general-contractor']);
    expect(c).toEqual(expect.arrayContaining(['lawn-care', 'moving', 'pool-spa', 'landscaping', 'cleaning', 'fencing']));
  });

  it('commercial remodel (2026-146952 BP, retail tenant space): fit-out heads-up for commercial cleaning, signs and security only', () => {
    const s = byId(austin, '2026-146952 BP');
    expect(s.summary).toBe('Building Permit | Remodel | Commercial | $250,000 job value | 3220 AMY DONOVAN PLZ UNIT S15');
    expect(routeKindsOf(s.title, rec(s))).toEqual(['fit-out']);
    expect(alerted(s).sort()).toEqual(['janitorial-commercial', 'security', 'signs-printing']);
    for (const t of HOME_ONLY) expect(carried(s)).not.toContain(t);
  });

  it('residential new build (2026-066698 BP): the new-home trades, as before', () => {
    const s = byId(austin, '2026-066698 BP');
    expect(s.summary).toBe('Building Permit | New | Residential | $650,000 job value | 6300 YAUPON DR');
    expect(routeKindsOf(s.title, rec(s))).toEqual(['new-build']);
    expect(downstreamTradesOf(s.title, rec(s))).toEqual(['moving', 'landscaping', 'fencing', 'cleaning', 'security', 'pool-spa', 'windows-doors', 'lawn-care']);
    expect(alerted(s).sort()).toEqual(['cleaning', 'landscaping', 'lawn-care', 'moving', 'real-estate']);
    for (const t of FIT_OUT_ONLY) expect(carried(s)).not.toContain(t);
    expect(recordPropertyOf(rec(s))).toBe('residential');
  });
});

describe('R28 Raleigh', () => {
  it('non-residential new building (BLDNR-026392-2025, $115M): fit-out trades only', () => {
    const s = byId(raleigh, 'BLDNR-026392-2025');
    expect(s.summary).toBe('Building | New Building | Non-Residential | $115,241,264 job value | 1110 Oculus Dr');
    expect(routeKindsOf(s.title, rec(s))).toEqual(['fit-out']);
    expect(carried(s)).toEqual(['general-contractor', ...FIT_OUT]);
    for (const t of HOME_ONLY) expect(carried(s)).not.toContain(t);
    expect(recordPropertyOf(rec(s))).toBe('commercial');
  });

  it('non-residential alteration (BLDNR-042817-2026, office): fit-out, not flooring, painting, cleaning or handyman', () => {
    const s = byId(raleigh, 'BLDNR-042817-2026');
    expect(s.title).toBe('Remodel permit in Raleigh');
    expect(s.summary).toBe('Building | Alteration/Repairs | Non-Residential | $639,901 job value | 3600 Glenwood Ave');
    expect(routeKindsOf(s.title, rec(s))).toEqual(['fit-out']);
    for (const t of HOME_ONLY) expect(carried(s)).not.toContain(t);
    // Without the class the same title and summary routed to the home remodel trades.
    const before = { ...rec(s), summary: 'Building | Alteration/Repairs | $639,901 job value | 3600 Glenwood Ave' };
    expect(carriedTrades(before, s.categories)).toEqual(expect.arrayContaining(['flooring', 'painting', 'cleaning', 'handyman']));
  });

  it('residential new dwelling (BLDR-029526-2026): the new-home trades', () => {
    const s = byId(raleigh, 'BLDR-029526-2026');
    expect(s.summary).toBe('Building | New Residential Dwelling | Residential | $1,238,952 job value | 900 Currituck Dr');
    expect(routeKindsOf(s.title, rec(s))).toEqual(['new-build']);
    expect(alerted(s).sort()).toEqual(['cleaning', 'landscaping', 'lawn-care', 'moving', 'real-estate']);
    for (const t of FIT_OUT_ONLY) expect(carried(s)).not.toContain(t);
    expect(recordPropertyOf(rec(s))).toBe('residential');
  });
});

describe('R28 privacy unchanged', () => {
  it('a building permit keeps its exact address (summary and private site); contractor contacts are businesses only', () => {
    for (const s of [...austin, ...raleigh]) {
      const site = (s.contacts ?? []).find((c) => c.role === 'site');
      expect(site?.address, s.externalId).toBeTruthy();
      expect(s.summary).toContain(site!.address as string);
    }
    expect((byId(austin, '2026-146952 BP').contacts ?? []).filter((c) => c.role === 'contractor').map((c) => c.name)).toEqual(['WEISS SERVICES LLC']);
    expect((byId(raleigh, 'BLDNR-026392-2025').contacts ?? []).filter((c) => c.role === 'contractor').map((c) => c.name)).toEqual(['Consigli Construction']);
    // A person's name in the company column is never a contact; contractor_full_name is never read.
    for (const s of [byId(austin, '2026-900001 BP'), byId(raleigh, 'BLDR-046368-2026')]) {
      expect((s.contacts ?? []).filter((c) => c.role === 'contractor')).toEqual([]);
    }
    const pub = JSON.stringify([...austin, ...raleigh].map((s) => ({ t: s.title, s: s.summary, d: s.data })));
    expect(pub).not.toMatch(/Jane Q Example|Pat Q Example|Hensel|Consigli|WEISS/);
  });
});

describe('R28 other cities: routing and labels unchanged', () => {
  interface SnapRow {
    input: { id: number; source: string; kind: string; subtype: string | null; title: string | null; summary: string | null; categories: string[] | null };
    expected: { kinds: string[]; downstream: string[]; carried: string[]; property: string | null; labels: Record<string, string> };
  }
  const snap = fx('r28-other-city-route-snapshot.json') as { rows: SnapRow[] };
  it('has a sample of every other permit source in the export', () => {
    expect(snap.rows.length).toBe(229);
    expect(new Set(snap.rows.map((r) => r.input.source)).size).toBe(21);
    expect(snap.rows.some((r) => r.input.source === 'socrata-austin-permits' || r.input.source === 'arcgis-raleigh-permits')).toBe(false);
  });
  it.each(snap.rows.map((r) => [`${r.input.source} ${r.input.id}`, r] as const))('%s', (_name, r) => {
    const { input: i, expected: e } = r;
    const ctx = { summary: i.summary, source: i.source };
    const recd = { source: i.source, kind: i.kind, subtype: i.subtype, title: i.title, summary: i.summary };
    expect(routeKindsOf(i.title, ctx)).toEqual(e.kinds);
    expect(downstreamTradesOf(i.title, ctx)).toEqual(e.downstream);
    expect([...carriedTrades(recd, i.categories)]).toEqual(e.carried);
    expect(recordPropertyOf(recd)).toBe(e.property);
    const sig = recordLabelInput(recd);
    for (const [t, l] of Object.entries(e.labels)) expect(labelFor(sig, t as CategoryId), t).toBe(l);
    expect(Object.keys(e.labels).every((t) => (CATEGORY_IDS as readonly string[]).includes(t))).toBe(true);
  });
});
