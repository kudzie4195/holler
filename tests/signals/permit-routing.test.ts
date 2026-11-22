// Round 15 unit F (PLAN-2.0 item 1.1): downstream permit routing. Permit type is read from the record's own title, never from a trade tag.
//
// Sourced: the 110 titles below are real title shapes read (read-only select, holler_signals where data->>'subtype' = 'permit', last 30
// days, round 15) across the permit sources: arcgis atlanta, dc, cobb (multiunit and commercial), dekalb, mecklenburg, raleigh, johnscreek
// and socrata austin, chicago, nyc, la, sf, nola, orlando, cincinnati, cambridge, buffalo, baton rouge, montgomery. The city after "in" is
// real; the route kinds expected are written by hand from the matrix (PLAN-2.0 section 4), not computed by the code under test.
// Assumed: nothing about a trade's hiring; the table only says which trades a title makes downstream.
import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS, type CategoryId } from '@/lib/signals/categories';
import { PERMIT_KINDS } from '@/lib/signals/mapping/permit';
import {
  DOWNSTREAM,
  KIND_DOERS,
  PERMIT_NOUNS,
  ROUTE_KINDS,
  ROUTE_WHY,
  carriedTrades,
  doerTradesOf,
  downstreamTradesOf,
  expandCategoriesForRouting,
  isPermitRecord,
  permitLabelsOf,
  routeFor,
  routeKindsOf,
  routeWhyFor,
  type RouteKind,
} from '@/lib/signals/permit-routing';
import { labelFor, labelForMember } from '@/lib/signals/lead-rules';
import { MAX_WHY } from '@/lib/signals/brief';
import { BANNED } from './banned';
import fs from 'node:fs';
import path from 'node:path';

const R = 're-roof', N = 'new-build', M = 'remodel', S = 'solar', D = 'demolition', F = 'fit-out';

/** [title, expected route kinds (ROUTE_KINDS order)] */
const TITLES: [string, RouteKind[]][] = [
  // single kinds (every source has these)
  ['Roof permit in Atlanta', [R]],
  ['Roof permit in Austin', [R]],
  ['New home permit in Cobb County', [N]],
  ['New home permit in Austin', [N]],
  ['New construction permit in Atlanta', [N]],
  ['Remodel permit in Atlanta', [M]],
  ['Addition permit in Atlanta', [M]],
  ['Solar permit in Baton Rouge', [S]],
  ['Demolition permit in Atlanta', [D]],
  ['Tenant fit-out permit in Cobb County', [F]],
  // trade-only titles: the work belongs to that trade, nothing is downstream
  ['Electrical permit in Atlanta', []],
  ['Plumbing permit in Austin', []],
  ['HVAC permit in Austin', []],
  ['Concrete permit in Austin', []],
  ['Fence permit in Austin', []],
  ['Window permit in Austin', []],
  ['Door permit in Austin', []],
  ['Sign permit in Baton Rouge', []],
  ['Landscaping permit in Austin', []],
  ['Pool permit in Atlanta', []],
  ['Water heater permit in Austin', []],
  ['Damage repair permit in Chicago', []],
  ['Flooring permit in Buffalo', []],
  ['Siding permit in Austin', []],
  ['Painting permit in Baton Rouge', []],
  ['Retaining wall permit in DeKalb County', []],
  ['Tree removal permit in Baton Rouge', []],
  // generic kinds that start no route
  ['Building permit in Austin', []],
  ['Structural permit in Cincinnati', []],
  ['Site work permit in Cambridge', []],
  ['Accessory building permit in Baton Rouge', []],
  ['Deck permit in Chicago', []],
  // no type at all
  ['Permit in Montgomery County', []],
  // "New construction" beside a named trade: its structured type is only "New" (a new line, a new panel), so it is not a new building
  ['New construction and electrical permit in Austin', []],
  ['New construction and plumbing permit in Austin', []],
  ['New construction and HVAC permit in Austin', []],
  ['New construction and concrete permit in Austin', []],
  // "New home" beside a trade is still a new home
  ['New home and plumbing permit in Austin', [N]],
  ['New home and electrical permit in Austin', [N]],
  ['New home and HVAC permit in Austin', [N]],
  // roof combinations
  ['Roof and solar permit in Chicago', [R, S]],
  ['Roof and HVAC permit in Los Angeles', [R]],
  ['Roof and siding permit in Austin', [R]],
  ['Roof and concrete permit in Austin', [R]],
  ['Roof and window permit in Los Angeles', [R]],
  ['Roof, HVAC, plumbing and electrical permit in Austin', [R]],
  ['Roof, window and siding permit in Austin', [R]],
  ['Roof, solar and electrical permit in Austin', [R, S]],
  ['Roof and deck permit in Buffalo', [R]],
  ['Roof and damage repair permit in Austin', [R]],
  ['Roof and gutter permit in Buffalo', [R]],
  ['Roof, fence and concrete permit in New York City', [R]],
  ['Roof and fence permit in Chicago', [R]],
  ['Roof, plumbing and electrical permit in Montgomery County', [R]],
  ['Roof and demolition permit in Montgomery County', [R, D]],
  ['Roof and landscaping permit in Los Angeles', [R]],
  ['Roof, HVAC and plumbing permit in Los Angeles', [R]],
  ['Roof, HVAC, siding and flooring permit in New Orleans', [R]],
  ['Roof, water heater, HVAC and electrical permit in Washington', [R]],
  ['Roof and remodel permit in Atlanta', [R, M]],
  ['Roof and electrical permit in New York City', [R]],
  ['Roof and plumbing permit in Raleigh', [R]],
  // remodel and addition combinations
  ['Plumbing, electrical and remodel permit in Chicago', [M]],
  ['Plumbing and remodel permit in New York City', [M]],
  ['HVAC, plumbing, electrical and remodel permit in Buffalo', [M]],
  ['Window and remodel permit in Buffalo', [M]],
  ['Flooring and remodel permit in New York City', [M]],
  ['HVAC, plumbing and remodel permit in Chicago', [M]],
  ['HVAC and remodel permit in New York City', [M]],
  ['Door and remodel permit in New York City', [M]],
  ['Electrical, window and remodel permit in San Francisco', [M]],
  ['Electrical and remodel permit in Chicago', [M]],
  ['HVAC, electrical, flooring and remodel permit in Washington', [M]],
  ['HVAC, plumbing, electrical and addition permit in Chicago', [M]],
  ['Demolition and remodel permit in Austin', [M, D]],
  ['Demolition and addition permit in Austin', [M, D]],
  // solar combinations
  ['Solar and electrical permit in Austin', [S]],
  // demolition combinations
  ['HVAC and demolition permit in New York City', [D]],
  ['Demolition and window permit in Los Angeles', [D]],
  ['Plumbing and demolition permit in Austin', [D]],
  ['Plumbing, electrical and demolition permit in Buffalo', [D]],
  ['Demolition and door permit in New York City', [D]],
  ['Demolition and landscaping permit in Mecklenburg County', [D]],
  ['Demolition and flooring permit in Austin', [D]],
  ['HVAC, electrical and demolition permit in San Francisco', [D]],
  ['Demolition and concrete permit in New York City', [D]],
  ['Electrical, demolition and flooring permit in San Francisco', [D]],
  ['HVAC, plumbing, electrical and demolition permit in Chicago', [D]],
  ['Demolition and tenant fit-out permit in San Francisco', [D, F]],
  ['Electrical and demolition permit in Mecklenburg County', [D]],
  ['Pool and demolition permit in Austin', [D]],
  ['Demolition and fence permit in Cincinnati', [D]],
  // trade-only combinations
  ['HVAC, plumbing and electrical permit in Austin', []],
  ['Plumbing and landscaping permit in Austin', []],
  ['Plumbing and electrical permit in Austin', []],
  ['Pool and electrical permit in Orlando', []],
  ['Window and door permit in Montgomery County', []],
  ['Fence and concrete permit in Buffalo', []],
  ['HVAC and electrical permit in Austin', []],
  ['HVAC, plumbing, electrical and window permit in Buffalo', []],
  ['Plumbing and window permit in Cincinnati', []],
  ['Window and flooring permit in Buffalo', []],
  ['Pool and concrete permit in Chicago', []],
  ['Concrete and deck permit in New York City', []],
  ['Landscaping and concrete permit in Mecklenburg County', []],
  ['HVAC and window permit in Austin', []],
  ['Window and siding permit in Austin', []],
  ['Landscaping and window permit in Austin', []],
  ['Fence and landscaping permit in Chicago', []],
  ['Pool and landscaping permit in Los Angeles', []],
  ['HVAC and plumbing permit in Baton Rouge', []],
  ['Pool, plumbing and electrical permit in Austin', []],
];

describe('permit kind detection from real permit titles (table)', () => {
  it('has at least 60 distinct real titles', () => {
    expect(new Set(TITLES.map(([t]) => t)).size).toBeGreaterThanOrEqual(60);
    expect(new Set(TITLES.map(([t]) => t)).size).toBe(TITLES.length);
  });
  it.each(TITLES)('%s -> %j', (title, want) => {
    expect(routeKindsOf(title)).toEqual(want);
  });
  it('every kind of the matrix is covered by the table', () => {
    const seen = new Set(TITLES.flatMap(([, k]) => k));
    expect([...seen].sort()).toEqual([...ROUTE_KINDS].sort());
  });
  it('detection never reads anything but the title: tags, source and city name change nothing', () => {
    expect(routeKindsOf('Roof permit in Atlanta')).toEqual(routeKindsOf('Roof permit in Roofville'));
    for (const t of ['', null, undefined, 'Roofing contractor license', 'Hail report', 'Federal contract in X: Roof']) expect(routeKindsOf(t as string)).toEqual([]);
  });
  it('a permit whose CITY is named like a work kind is not mistaken for it', () => {
    expect(routeKindsOf('Permit in Solar City')).toEqual([]);
    expect(routeKindsOf('Electrical permit in Demolition Bay')).toEqual([]);
  });
});

describe('the label vocabulary stays in step with the permit mapping', () => {
  it('KIND_DOERS names exactly the labels PERMIT_KINDS can write', () => {
    const labels = PERMIT_KINDS.map((k) => k.label.toLowerCase()).sort();
    expect(Object.keys(KIND_DOERS).sort()).toEqual(labels);
  });
  it('every label PERMIT_KINDS writes is read back by permitLabelsOf', () => {
    for (const k of PERMIT_KINDS) expect(permitLabelsOf(`${k.label} permit in Atlanta`), k.label).toEqual([k.label.toLowerCase()]);
  });
  it('every DOWNSTREAM trade is a real trade id', () => {
    for (const kind of ROUTE_KINDS) for (const t of DOWNSTREAM[kind]) expect(CATEGORY_IDS as readonly string[], `${kind}/${t}`).toContain(t);
  });
});

/** The matrix of PLAN-2.0 section 4 item 1.1, mapped to this repo's trade ids (written out again here so a code change cannot move it unseen). */
const MATRIX: Record<RouteKind, string[]> = {
  're-roof': ['siding-gutters', 'solar', 'junk-removal'], // gutters, siding, solar, junk removal
  'new-build': ['moving', 'landscaping', 'fencing', 'cleaning', 'security', 'pool-spa', 'windows-doors'],
  remodel: ['flooring', 'painting', 'cleaning', 'junk-removal', 'handyman'],
  solar: ['electrical', 'roofing'],
  demolition: ['junk-removal', 'fencing', 'concrete-paving'],
  'fit-out': ['janitorial-commercial', 'signs-printing', 'security', 'pest-control', 'business-services'], // commercial cleaning, signs, security, pest control, IT
};
const TITLE_OF: Record<RouteKind, string> = {
  're-roof': 'Roof permit in Atlanta',
  'new-build': 'New home permit in Atlanta',
  remodel: 'Remodel permit in Atlanta',
  solar: 'Solar permit in Atlanta',
  demolition: 'Demolition permit in Atlanta',
  'fit-out': 'Tenant fit-out permit in Atlanta',
};
const permit = (title: string) => ({ source: 'socrata-chicago-permits', kind: 'civic', subtype: 'permit', title });

describe('the downstream matrix', () => {
  it('matches PLAN-2.0 item 1.1 exactly', () => {
    for (const k of ROUTE_KINDS) expect([...DOWNSTREAM[k]], k).toEqual(MATRIX[k]);
  });
  for (const k of ROUTE_KINDS) {
    for (const trade of MATRIX[k]) {
      it(`${k}: ${trade} is downstream, labelled coming_soon, and has one sentence`, () => {
        expect(routeFor(TITLE_OF[k], trade)).toBe(k);
        expect(labelFor(permit(TITLE_OF[k]), trade as CategoryId)).toBe('coming_soon');
        expect(routeWhyFor(TITLE_OF[k], trade)).toBe(ROUTE_WHY[`${k}|${trade}`]?.replace('{Permit}', PERMIT_NOUNS[k][0]));
        expect(routeWhyFor(TITLE_OF[k], trade)).toBeTruthy();
      });
    }
  }
  it('every (kind, trade) cell has exactly one sentence and no other cell exists', () => {
    const cells = ROUTE_KINDS.flatMap((k) => MATRIX[k].map((t) => `${k}|${t}`)).sort();
    expect(Object.keys(ROUTE_WHY).sort()).toEqual(cells);
  });
});

describe('same-trade permits stay market_insight, never downstream', () => {
  it('the trade that does the permitted work gets market_insight', () => {
    const SAME: [string, string][] = [
      ['Roof permit in Atlanta', 'roofing'], ['Solar permit in Atlanta', 'solar'], ['Pool permit in Atlanta', 'pool-spa'],
      ['Fence permit in Austin', 'fencing'], ['Concrete permit in Austin', 'concrete-paving'], ['Window permit in Austin', 'windows-doors'],
      ['Flooring permit in Buffalo', 'flooring'], ['Painting permit in Baton Rouge', 'painting'], ['Sign permit in Baton Rouge', 'signs-printing'],
      ['Siding permit in Austin', 'siding-gutters'], ['Roof and gutter permit in Buffalo', 'siding-gutters'], ['Electrical permit in Atlanta', 'electrical'],
      ['Landscaping permit in Austin', 'landscaping'], ['Roof and solar permit in Chicago', 'solar'], ['Roof and solar permit in Chicago', 'roofing'],
      ['Remodel permit in Atlanta', 'general-contractor'], ['New home permit in Austin', 'general-contractor'],
    ];
    for (const [title, trade] of SAME) {
      expect(routeFor(title, trade), `${title} / ${trade}`).toBeNull();
      expect(labelFor(permit(title), trade as CategoryId), `${title} / ${trade}`).toBe('market_insight');
    }
  });
  it('roofers get no roof-permit alert: every title that names Roof is market_insight for roofing', () => {
    const roofTitles = TITLES.filter(([t]) => permitLabelsOf(t)?.includes('roof'));
    expect(roofTitles.length).toBeGreaterThan(15);
    for (const [title] of roofTitles) expect(labelFor(permit(title), 'roofing'), title).toBe('market_insight');
  });
  it('roofers do get a solar permit as coming_soon (the matrix: solar is followed by roofing), but not a roof+solar one', () => {
    expect(labelFor(permit('Solar permit in Atlanta'), 'roofing')).toBe('coming_soon');
    expect(labelFor(permit('Roof and solar permit in Chicago'), 'roofing')).toBe('market_insight');
  });
  it('a permit title naming no type routes to nobody and keeps its source default', () => {
    expect(downstreamTradesOf('Permit in Montgomery County')).toEqual([]);
    expect(downstreamTradesOf('Building permit in Austin')).toEqual([]);
  });
  it('a non-permit record is never routed (a roof-titled 311 or violation stays as before)', () => {
    const v = { source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Roof permit in Atlanta' };
    expect(isPermitRecord(v)).toBe(false);
    expect(carriedTrades(v, ['roofing'])).toEqual(['roofing']);
  });
});

describe('carried trades and the widened read', () => {
  it('a re-roof permit tagged roofing reaches siding-gutters, solar and junk-removal without losing its own tag', () => {
    expect([...carriedTrades(permit('Roof permit in Atlanta'), ['roofing'])]).toEqual(['roofing', 'siding-gutters', 'solar', 'junk-removal']);
  });
  it('doers are not added (a roof+solar permit does not add solar or roofing as downstream)', () => {
    const t = downstreamTradesOf('Roof and solar permit in Chicago');
    expect(t).not.toContain('solar');
    expect(t).not.toContain('roofing');
    expect([...doerTradesOf('Roof and solar permit in Chicago')].sort()).toEqual(['roofing', 'solar']);
  });
  it('expandCategoriesForRouting adds the carrier tags only for members whose trade is downstream', () => {
    expect(expandCategoriesForRouting(['siding-gutters'])).toEqual(['siding-gutters', 'roofing']);
    expect(expandCategoriesForRouting(['plumbing'])).toEqual(['plumbing']);
    expect(expandCategoriesForRouting(['cleaning'])).toEqual(expect.arrayContaining(['cleaning', 'general-contractor']));
  });
  it('labelForMember reads the carried trades: a siding member sees a roof permit as coming_soon', () => {
    const sig = { ...permit('Roof permit in Atlanta'), categories: ['roofing'] };
    expect(labelForMember(sig, ['siding-gutters'])).toBe('coming_soon');
    expect(labelForMember(sig, ['roofing'])).toBe('market_insight');
  });
});

describe('the one sentence per (permit kind, trade)', () => {
  const cells = Object.entries(ROUTE_WHY).flatMap(([key, text]) =>
    PERMIT_NOUNS[key.split('|')[0] as RouteKind].map((n) => [`${key} / ${n}`, text.replace('{Permit}', n)] as const),
  );
  it('has 25 cells', () => expect(Object.keys(ROUTE_WHY)).toHaveLength(25));
  it.each(cells)('%s: short, hedged, no banned words, no claim of a hire', (_key, text) => {
    expect(text.length).toBeLessThanOrEqual(MAX_WHY);
    for (const re of BANNED) expect(text, String(re)).not.toMatch(re);
    expect(text).not.toMatch(/\b(?:hired|chosen|choosing|picked|selected|awarded|won|will)\b/i);
    expect(text).toMatch(/was filed nearby/);
    expect(text).toMatch(/\b(?:may|often|some|are part of)\b/);
  });
  it('names the permit the title names: an addition is not a "remodel permit", a roof permit is not a "re-roof permit"', () => {
    expect(routeWhyFor('Addition permit in Atlanta', 'cleaning')).toMatch(/^An addition permit was filed nearby/);
    expect(routeWhyFor('Remodel permit in Atlanta', 'cleaning')).toMatch(/^A remodel permit was filed nearby/);
    expect(routeWhyFor('Addition permit in Atlanta', 'flooring')).not.toMatch(/remodel/i);
    expect(routeWhyFor('Roof permit in Atlanta', 'siding-gutters')).toMatch(/^A roof permit was filed nearby/);
    expect(routeWhyFor('Roof permit in Atlanta', 'siding-gutters')).not.toMatch(/re-roof/i);
    expect(routeWhyFor('Remodel and addition permit in Atlanta', 'cleaning')).toMatch(/^A remodel permit/);
    expect(routeWhyFor('Tenant fit-out permit in Cobb County', 'security')).toMatch(/^A tenant fit-out permit/);
    // a commercial remodel reached through the record's own class is not called a tenant fit-out
    expect(routeWhyFor('Remodel permit in Atlanta', 'janitorial-commercial', { summary: 'Commercial Alteration | $40,000 job value | 740 LAMBERT NE' })).toMatch(/^A commercial permit/);
  });
  it('a new-construction title says "new-construction permit", a new-home title says "new-home permit"', () => {
    expect(routeWhyFor('New construction permit in Atlanta', 'moving')).toContain('new-construction permit');
    expect(routeWhyFor('New home permit in Atlanta', 'moving')).toContain('new-home permit');
  });
  it('is null for a trade that is not downstream, so the brief falls back to its own sentence', () => {
    expect(routeWhyFor('Roof permit in Atlanta', 'roofing')).toBeNull();
    expect(routeWhyFor('Roof permit in Atlanta', 'plumbing')).toBeNull();
    expect(routeWhyFor('Permit in Atlanta', 'cleaning')).toBeNull();
  });
});

describe('client safety and purity', () => {
  it('imports nothing but types and ./categories-free code (no server module, no clock)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/signals/permit-routing.ts'), 'utf8');
    const imports = [...src.matchAll(/^import .* from '(.+)';/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./categories']);
    expect(src).not.toMatch(/Date\.now|new Date\(|Math\.random|process\.env/);
  });
  it('the same title gives the same answer', () => {
    for (const [title] of TITLES) expect(routeKindsOf(title)).toEqual(routeKindsOf(title));
  });
});
