// Round 15 review F (attack 1) and re-grade Q2: a permit title is checked against the record's OWN fields (its summary: structured type,
// class and use, and its source), not only against the fixed title vocabulary.
//
// Sourced: tests/signals/__data__/review-f-sample-156.json is the reviewer's sample: 156 real stored permit rows, 7 per source, from 23
// permit sources (read-only select, holler_signals, md5 seed revF-r15-seed). Each row is [id, source, title, summary, city, categories].
// The expected kinds of the rows the reviewer judged wrong or doubtful are written by hand below from the reviewer's table
// (/home/claude/gates/r15/review/review-F.md). Q2 cards #32, #42 and #43 are re-grade rows (Q2-grades.md), written here from the grade text.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { downstreamTradesOf, routeKindsOf, routeWhyFor, carriedTrades, summaryParts, type RouteKind } from '@/lib/signals/permit-routing';
import { classifyPermit } from '@/lib/signals/mapping/permit';
import { matchOne, type MatchProfile } from '@/lib/signals/match';
import { briefFor, tradeForRecord } from '@/lib/signals/brief';
import { labelFor } from '@/lib/signals/lead-rules';
import type { CategoryId } from '@/lib/signals/categories';

type Row = [number, string, string, string, string, string[]];
const ROWS = JSON.parse(fs.readFileSync(path.join(__dirname, '__data__/review-f-sample-156.json'), 'utf8')) as Row[];
const byId = (id: number) => ROWS.find((r) => r[0] === id)!;
const kinds = (id: number): RouteKind[] => {
  const [, source, title, summary] = byId(id);
  return routeKindsOf(title, { summary, source });
};
const trades = (id: number) => {
  const [, source, title, summary] = byId(id);
  return downstreamTradesOf(title, { summary, source });
};
const HOUSE_ONLY = ['cleaning', 'pool-spa', 'moving', 'handyman', 'landscaping', 'fencing', 'flooring', 'painting', 'windows-doors'];

describe('the sample is what the reviewer drew', () => {
  it('has 156 rows from 23 sources', () => {
    expect(ROWS).toHaveLength(156);
    expect(new Set(ROWS.map((r) => r[1])).size).toBe(23);
  });
});

describe('commercial and industrial permits never reach residential trades (review P1-2)', () => {
  // [id, what the reviewer saw]
  const COMMERCIAL: [number, string][] = [
    [55466, 'Atlanta Commercial Alteration $8.4M'],
    [55516, 'Atlanta Commercial Alteration $40,000'],
    [55474, 'Atlanta Commercial Alteration $750,000'],
    [138452, 'Cobb commercial Remodel $15.1M'],
    [138453, 'Cobb commercial Remodel $15.1M (same address)'],
    [124960, 'Baton Rouge New Building Permit (C) Commercial'],
    [124969, 'Baton Rouge Existing Bldg Remodel Only (C) Commercial'],
    [35635, 'Cincinnati Alter Commercial'],
    [58582, 'Seattle Addition/Alteration Commercial $1,000'],
    [58598, 'Seattle Addition/Alteration Commercial $275,000'],
    [58608, 'Seattle Addition/Alteration Commercial $250,000'],
    [117072, 'Seattle New Industrial $2.7M'],
  ];
  it.each(COMMERCIAL)('#%i %s routes to the fit-out row only', (id) => {
    expect(kinds(id)).toEqual(['fit-out']);
    const t = trades(id);
    expect(t).toEqual(['janitorial-commercial', 'signs-printing', 'security', 'pest-control', 'business-services']);
    for (const r of HOUSE_ONLY) expect(t, `${id} / ${r}`).not.toContain(r);
  });
  it('a house cleaner, a pool company and a mover are not carried the record (carriedTrades)', () => {
    for (const [id] of COMMERCIAL) {
      const [, source, title, summary, , cats] = byId(id);
      for (const t of ['cleaning', 'pool-spa', 'moving', 'handyman']) {
        // not downstream: only the doer tag could reach them, and these trades are not on the record
        expect(carriedTrades({ source, subtype: 'permit', title, summary }, cats), `${id} ${t}`).not.toContain(t);
      }
    }
  });
  it('no row of the 156 whose own class says commercial, industrial, office, retail, warehouse or apartment reaches a house trade', () => {
    let checked = 0;
    for (const [id, source, title, summary] of ROWS) {
      const parts = summaryParts(summary);
      const nonRes = parts.some((p) => /\bcommercial\b|\bindustrial\b|\(c\)|\boffice\b|\bretail\b|\bwarehouse\b|multi[\s-]?family|\bapartments?\b/i.test(p)) || source === 'arcgis-cobb-commercial-permits';
      if (!nonRes) continue;
      const t = downstreamTradesOf(title, { summary, source });
      for (const r of ['cleaning', 'pool-spa', 'moving', 'handyman', 'landscaping', 'fencing']) {
        if (kinds(id).some((k) => k === 'new-build' || k === 'remodel')) expect.fail(`${id} still routes as ${kinds(id)}`);
        if (title.includes('Demolition')) continue; // a demolition keeps its own hauling and fencing route
        expect(t, `${id} ${r}`).not.toContain(r);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(15);
  });
  it('Q2 #42 and #43: an Atlanta Commercial Alteration and an LA "Bldg-Alter/Repair | Commercial" row never reach house cleaning', () => {
    const atl = { title: 'Remodel permit in Atlanta', ctx: { source: 'arcgis-atlanta-permits', summary: 'Commercial Alteration | $50,000 job value | 100 PEACHTREE ST NE, ATLANTA, GA 30303' } };
    const la = { title: 'Remodel permit in Los Angeles', ctx: { source: 'socrata-la-permits', summary: 'Bldg-Alter/Repair | Commercial | $120,000 job value | 100 S MAIN ST' } };
    for (const x of [atl, la]) {
      expect(downstreamTradesOf(x.title, x.ctx)).not.toContain('cleaning');
      expect(downstreamTradesOf(x.title, x.ctx)).toContain('janitorial-commercial');
      expect(routeWhyFor(x.title, 'cleaning', x.ctx)).toBeNull();
    }
  });
  it('a home addition still reaches house cleaning', () => {
    expect(downstreamTradesOf('Addition permit in Atlanta', { source: 'arcgis-atlanta-permits', summary: 'Residential Addition | $65,000 job value | 1634 LENOX NE' })).toContain('cleaning');
    expect(downstreamTradesOf('Remodel permit in Atlanta', { source: 'arcgis-atlanta-permits', summary: 'Residential Alteration | $30,000 job value | 5 X ST' })).toContain('cleaning');
  });
});

describe('ingest: a commercial alteration is a tenant fit-out (Q2 pattern 1)', () => {
  it('Atlanta "Commercial Alteration" and LA "Bldg-Alter/Repair | Commercial" classify as Tenant fit-out', () => {
    expect(classifyPermit({ structured: ['Commercial Alteration'] }, 'Atlanta').label).toBe('Tenant fit-out');
    expect(classifyPermit({ structured: ['Bldg-Alter/Repair', 'Commercial'] }, 'Los Angeles').label).toBe('Tenant fit-out');
    expect(classifyPermit({ structured: ['Addition/Alteration', 'Commercial'] }, 'Seattle').label).toBe('Tenant fit-out');
  });
  it('a residential alteration and a named trade in a commercial permit are not changed', () => {
    expect(classifyPermit({ structured: ['Residential Alteration'] }, 'Atlanta').label).toBe('Remodel');
    expect(classifyPermit({ structured: ['Commercial Alteration'], free: ['replace roof'] }, 'Atlanta').categories).toContain('roofing');
    expect(classifyPermit({ structured: ['Bldg-Alter/Repair', '1 or 2 Family Dwelling'] }, 'Los Angeles').label).toBe('Remodel');
  });
});

describe('wrong kinds fixed (review P2-1)', () => {
  it('Chicago "Masonry Work" is not a remodel, Orlando "Repair" is not a remodel, Cambridge "Dumpster" is not a demolition', () => {
    expect(kinds(57250)).toEqual([]);
    expect(kinds(36051)).toEqual([]);
    expect(kinds(3177)).toEqual([]);
    expect(trades(57250)).not.toContain('flooring');
    expect(trades(3177)).not.toContain('fencing');
  });
  it('NOLA "Accessory Structure" is not a new home', () => {
    expect(kinds(2988)).toEqual([]);
    expect(trades(2988)).toEqual([]);
  });
  it('interior demolition inside an alteration permit does not send fencing or concrete (SF $1 and $600k, Cincinnati stadium)', () => {
    for (const id of [1576, 133169, 134445]) expect(kinds(id), String(id)).toEqual([]);
  });
  it('a bare repair is not a re-roof (Buffalo REPAIR under a Roof title)', () => {
    expect(kinds(3407)).toEqual([]);
  });
  it('a real structured demolition keeps its route', () => {
    expect(routeKindsOf('Demolition permit in Atlanta', { source: 'arcgis-atlanta-permits', summary: 'Residential Demolition | $5,000 job value | 5 X ST' })).toEqual(['demolition']);
  });
  it('ingest: masonry, dumpster and repair are their own generic kinds, never remodel or demolition', () => {
    expect(classifyPermit({ structured: ['Masonry Work'] }, 'Chicago').label).toBe('Masonry');
    expect(classifyPermit({ structured: ['Dumpster'], free: ['demolition debris'] }, 'Cambridge').label).toBe('Dumpster');
    expect(classifyPermit({ structured: ['Building Permit', 'Repair'] }, 'Orlando').label).toBe('Repair');
    expect(classifyPermit({ structured: ['Remodel/Repair'] }, 'X').label).toBe('Remodel');
  });
});

describe('an addition or alteration is never "New home" (Q2 pattern 3, review P2-1)', () => {
  it('ingest: Q2 #32 "Bldg-Addition | 1 or 2 Family Dwelling" with a description read as a new dwelling is an Addition', () => {
    const c = classifyPermit({ structured: ['Bldg-Addition', '1 or 2 Family Dwelling'], free: ['add new single family dwelling unit to rear of lot'] }, 'Los Angeles');
    expect(c.label).toBe('Addition');
    expect(c.categories).not.toContain('real-estate');
    expect(c.categories).not.toContain('moving');
  });
  it('ingest: an accessory structure with a new-home description is an Accessory building', () => {
    const c = classifyPermit({ structured: ['Accessory Structure'], free: ['new single family detached residence'] }, 'New Orleans');
    expect(c.label).not.toMatch(/new home/i);
  });
  it('ingest: a real new home is still a new home', () => {
    expect(classifyPermit({ structured: ['New Construction', '1 or 2 Family Dwelling'], free: ['new single family home'] }, 'Atlanta').label).toBe('New home');
  });
  it('a stored "New home" row whose own type is an addition routes as the addition it is, not to landscapers and movers', () => {
    const ctx = { source: 'socrata-la-permits', summary: 'Bldg-Addition | 1 or 2 Family Dwelling | $15,000 job value | 123 MAIN ST' };
    expect(routeKindsOf('New home permit in Los Angeles', ctx)).toEqual(['remodel']);
    const t = downstreamTradesOf('New home permit in Los Angeles', ctx);
    expect(t).not.toContain('landscaping');
    expect(t).not.toContain('moving');
    expect(routeWhyFor('New home permit in Los Angeles', 'landscaping', ctx)).toBeNull();
  });
});

describe('detection compares the title with the record (review P2-8): every sampled row', () => {
  it('a record\'s class can only remove or redirect a route, never invent a new trade for a title that names nothing', () => {
    for (const [id, source, title, summary] of ROWS) {
      const withClass = routeKindsOf(title, { summary, source });
      const titleOnly = routeKindsOf(title);
      if (titleOnly.length === 0) expect(withClass, String(id)).toEqual([]);
      for (const k of withClass) {
        // a kind can appear only if the title named it, or by the two redirects (new-build to remodel, build or remodel to fit-out)
        expect(titleOnly.includes(k) || k === 'remodel' || k === 'fit-out', `${id} ${k}`).toBe(true);
      }
    }
  });
  it('no routed row has a structured type that contradicts its kind', () => {
    for (const [id, source, title, summary] of ROWS) {
      const parts = summaryParts(summary);
      const ks = routeKindsOf(title, { summary, source });
      if (ks.includes('new-build')) expect(parts.some((p) => /\baccessory\b|\baddition|\balteration|\brepair/i.test(p)), `${id} new-build over ${parts}`).toBe(false);
      if (ks.includes('remodel')) expect(parts.some((p) => /\bmasonry\b|^repairs?$/i.test(p) || /\bcommercial\b|\bindustrial\b/i.test(p)), `${id} remodel over ${parts}`).toBe(false);
      if (ks.includes('demolition')) expect(parts.some((p) => /\bdumpster\b/i.test(p)), `${id} demolition over ${parts}`).toBe(false);
      if (ks.includes('re-roof')) expect(parts.some((p) => /^repairs?$/i.test(p)), `${id} re-roof over ${parts}`).toBe(false);
    }
  });
  it('the routed share of the sample and its detections after the record class (reported in F-report.md)', () => {
    const routed = ROWS.filter(([, source, title, summary]) => routeKindsOf(title, { summary, source }).length > 0);
    // 82 rows routed on the title alone (review); the record class drops 9 and redirects 12 to the fit-out row
    expect(ROWS.filter(([, , title]) => routeKindsOf(title).length > 0)).toHaveLength(82);
    expect(routed.length).toBeLessThan(82);
    expect(routed.length).toBeGreaterThan(65);
  });
});

describe('the matcher sees the same class (summary reaches the label)', () => {
  const cleaner: MatchProfile = { user_id: 'c', categories: ['cleaning'], lat: 33.75, lon: -84.39, state: 'GA', radius_mi: 25 };
  const sig = (summary: string, title = 'Remodel permit in Atlanta') => ({
    id: 1, categories: ['general-contractor'], lat: 33.76, lon: -84.4, state: 'GA', severity: 1, occurred_at: '2026-11-20T12:00:00Z', subtype: 'permit',
    source: 'arcgis-atlanta-permits', title, summary, kind: 'permit',
  });
  it('a house cleaner is matched to a residential remodel and not to a commercial alteration', () => {
    expect(matchOne(sig('Residential Alteration | $30,000 job value | 5 X ST'), cleaner, false)?.label).toBe('coming_soon');
    expect(matchOne(sig('Commercial Alteration | $30,000 job value | 5 X ST'), cleaner, false)).toBeNull();
  });
  it('review F P1-2b: tradeForRecord picks janitorial-commercial for an $8.4M commercial alteration, and the card sentence never says cleaning may follow', () => {
    const rec = { source: 'arcgis-atlanta-permits', kind: 'permit', subtype: 'permit', title: 'Remodel permit in Atlanta', summary: 'Commercial Alteration | $8,400,000 job value | 100 PEACHTREE ST NE, ATLANTA, GA 30303' };
    const cats = ['general-contractor', 'cleaning', 'janitorial-commercial'];
    const trades = ['cleaning', 'janitorial-commercial'];
    expect(tradeForRecord(rec, cats, trades)).toBe('janitorial-commercial');
    // Without the summary (the old call) the card was built for cleaning: this is what the surfaces must not do.
    expect(tradeForRecord({ ...rec, summary: undefined }, cats, trades)).toBe('cleaning');
    const t = tradeForRecord(rec, cats, trades)!;
    const why = briefFor({ ...rec, label: labelFor(rec, t as CategoryId), trade: t }).why;
    expect(why).not.toMatch(/cleaning may follow/i);
  });
  it('every caller of tradeForRecord (web feed, digest, mobile feed) passes the record summary', () => {
    for (const f of ['app/app/page.tsx', 'app/api/cron/notify/route.ts', 'lib/mobile/feed.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      const calls = src.match(/tradeForRecord\(\{[^}]*\}/g) ?? [];
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c, `${f}: ${c}`).toMatch(/summary: s\.summary/);
    }
  });
  it('every caller of labelForMember passes the record summary', () => {
    for (const f of ['app/app/page.tsx', 'app/api/cron/notify/route.ts', 'lib/mobile/feed.ts', 'lib/push/notify.ts', 'lib/signals/score-admin.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
      const calls = src.match(/labelForMember\(\{[^}]*\}/g) ?? [];
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c, `${f}: ${c}`).toMatch(/summary|\.\.\.input/);
    }
  });
});
