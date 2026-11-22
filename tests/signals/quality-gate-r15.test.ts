// Round 15, quality gate fixes (/home/claude/gates/r15/Q-grades.md, PLAN-2.0 item 0.6). The gate graded 50 real cards: 30 passed, 20 failed.
// Every graded card is a case below. Each failing card now has an assertion that it is fixed (the record no longer reaches the member, or
// its card no longer says the wrong thing); each passing card is asserted to still reach the same member under the same label.
//
// Sourced: tests/signals/__data__/quality-gate-r15-cards.json holds the 50 stored records (read-only select, holler_signals, seed
// r15q-seed-20261121) with the member each was graded for (trade, city centre, radius 25 mi, Starter scope) and the grader's verdict
// from Q-grades.md. Assumed: nothing about what a trade wants beyond the grader's verdicts; the code under test is the real matcher.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { matchOne, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { briefFor, violationOrderOf } from '@/lib/signals/brief';
import { labelFor } from '@/lib/signals/lead-rules';
import { approxLocationNote, hasApproxLocation } from '@/lib/signals/approx-location';
import { classifyPermit, NO_TRADE_WORK_TYPE_RE } from '@/lib/signals/mapping/permit';
import { remapPermitRow } from '@/lib/signals/mapping/remap';
import { categorize } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { parseNws } from '@/lib/signals/adapters/nws';

interface Card {
  n: number;
  trade: string;
  city: string;
  member: { lat: number; lon: number; state: string };
  label: 'act_now' | 'coming_soon' | 'market_insight';
  pass: boolean;
  reason: string;
  signal: {
    id: number; source: string; kind: string; title: string; summary: string | null; state: string | null; lat: number | null; lon: number | null;
    occurred_at: string; severity: number; categories: string[]; data: { subtype?: string; loc?: string; approxLocation?: boolean };
  };
}
const FILE = JSON.parse(fs.readFileSync(path.join(__dirname, '__data__/quality-gate-r15-cards.json'), 'utf8')) as { cards: Card[] };
const CARDS = FILE.cards;

const profileOf = (c: Card): MatchProfile => ({ user_id: `m${c.n}`, categories: [c.trade], lat: c.member.lat, lon: c.member.lon, state: c.member.state, radius_mi: 25 });
const signalOf = (c: Card): MatchSignal => ({
  id: c.signal.id, categories: c.signal.categories, lat: c.signal.lat, lon: c.signal.lon, state: c.signal.state, severity: c.signal.severity,
  occurred_at: c.signal.occurred_at, subtype: c.signal.data.subtype ?? null, data: c.signal.data, source: c.signal.source, title: c.signal.title,
  summary: c.signal.summary, kind: c.signal.kind,
});
const NOW = Date.parse('2026-11-22T02:30:00Z');
const matched = (c: Card) => matchOne(signalOf(c), profileOf(c), false, NOW);
const ds = (subtype: string) => SOCRATA_DATASETS.find((d) => d.subtype === subtype)!;
const card = (n: number) => CARDS.find((c) => c.n === n)!;

describe('the 50 graded cards', () => {
  it('are all here: 30 graded pass, 20 graded fail, 10 per trade', () => {
    expect(CARDS).toHaveLength(50);
    expect(CARDS.filter((c) => c.pass)).toHaveLength(30);
    for (const t of ['roofing', 'plumbing', 'hvac', 'landscaping', 'cleaning']) expect(CARDS.filter((c) => c.trade === t)).toHaveLength(10);
  });

  // Passing cards: the member still gets the record, under the label the grader saw.
  describe('passing cards still pass', () => {
    for (const c of CARDS.filter((x) => x.pass)) {
      it(`#${c.n} ${c.trade}/${c.city}: ${c.signal.title}`, () => {
        const m = matched(c);
        expect(m, 'still matched').not.toBeNull();
        expect(m!.label).toBe(c.label);
        expect(m!.trade).toBe(c.trade);
        // a passing card's brief keeps naming the record, never a hire, and links to its public source
        const b = briefFor({ source: c.signal.source, kind: c.signal.kind, subtype: c.signal.data.subtype ?? null, title: c.signal.title, summary: c.signal.summary, label: m!.label, trade: m!.trade });
        expect(b.why.length).toBeGreaterThan(10);
        expect(b.why).not.toMatch(/\blead|they need you|you will win|guarantee|official record|\bhired\b/i);
      });
    }
  });

  // Failing cards, by the defect the gate named.
  describe('failing cards are fixed', () => {
    describe('1. blanket business-licence and event tags (#41 to #50 house cleaning, #26 HVAC)', () => {
      for (const n of [41, 42, 43, 44, 45, 47, 48, 49, 50]) {
        it(`#${n} ${card(n).signal.title} no longer reaches a house cleaner (licence is context)`, () => {
          expect(labelFor({ source: card(n).signal.source, kind: card(n).signal.kind, subtype: 'business', title: card(n).signal.title }, 'cleaning')).toBe('context');
          expect(matched(card(n))).toBeNull();
        });
      }
      it('#46 the NYC street event no longer reaches a house cleaner (event permit is context)', () => {
        expect(labelFor({ source: 'socrata-nyc-events', kind: 'event', subtype: 'event-permit', title: card(46).signal.title }, 'cleaning')).toBe('context');
        expect(matched(card(46))).toBeNull();
      });
      it('#26 the Mobile Food Services licence no longer reaches HVAC (a food truck has no building)', () => {
        expect(matched(card(26))).toBeNull();
      });
      it('new licence rows are not tagged cleaning at all, and a food truck is not tagged hvac or pest-control', () => {
        for (const text of ['Retail Food Establishment', 'Raffles', 'Limited Business License', 'Electronics', 'Floor Covering Retailers']) {
          expect(categorize(ds('business'), text).categories, text).not.toContain('cleaning');
        }
        const truck = categorize(ds('business'), 'Mobile Food Services').categories;
        expect(truck).not.toContain('hvac');
        expect(truck).not.toContain('pest-control');
        expect(categorize(ds('business'), 'Retail Food Establishment').categories).toEqual(expect.arrayContaining(['hvac', 'pest-control']));
        expect(categorize(ds('event-permit'), 'Street Event').categories).not.toContain('cleaning');
      });
      it('a failed inspection no longer goes to house cleaning', () => {
        expect(categorize(ds('inspection'), 'Restaurant').categories).not.toContain('cleaning');
      });
    });

    describe('2. zone-only weather alerts do not match a whole state (#18, #24, #25)', () => {
      for (const n of [18, 24, 25]) {
        it(`#${n} ${card(n).signal.title} (no coordinates, severity ${card(n).signal.severity}) is not matched to a member 100+ miles away`, () => {
          expect(card(n).signal.lat).toBeNull();
          expect(matched(card(n))).toBeNull();
        });
      }
      it('a statewide record that is not a weather zone alert (a federal declaration) still reaches the state', () => {
        const fema: MatchSignal = { id: 1, categories: ['restoration'], lat: null, lon: null, state: 'CA', severity: 3, occurred_at: '2026-11-20T00:00:00Z', source: 'fema', title: 'Disaster declaration', kind: 'disaster' };
        expect(matchOne(fema, { user_id: 'u', categories: ['restoration'], lat: 34.05, lon: -118.24, state: 'CA', radius_mi: 25 }, false, NOW)).not.toBeNull();
      });
      it('a weather alert card says "for your area", not "near you"', () => {
        expect(briefFor({ source: 'nws', label: 'coming_soon', trade: 'hvac' }).why).toContain('for your area');
        expect(briefFor({ source: 'nws', label: 'coming_soon', trade: 'hvac' }).why).not.toContain('near you');
      });
    });

    describe('3. NYC site-safety and scaffold permit types are not trade work (#6, #7, #40)', () => {
      for (const [n, work] of [[6, 'Protection and Mechanical Methods'], [7, 'Sidewalk Shed'], [40, 'Sprinklers']] as const) {
        it(`#${n} "${work}" gives no trade and no title kind, even when the description names a roof, a window or a lawn`, () => {
          expect(card(n).signal.summary).toContain(work);
          expect(NO_TRADE_WORK_TYPE_RE.test(work)).toBe(true);
          const c = classifyPermit({ structured: [work], free: ['install roof and window protection and lawn sprinkler head'] }, 'New York City');
          expect(c.categories).toEqual([]);
          expect(c.label).toBeNull();
        });
        it(`#${n} a stored row of that work type is re-mapped to no trade (the version bump re-maps stored permits)`, () => {
          const s = card(n).signal;
          expect(remapPermitRow({ city: 'New York City', summary: s.summary, categories: s.categories as never, title: s.title } as never)).toEqual({ categories: [], label: null });
        });
      }
      it('real work types of the same sources keep their trades', () => {
        expect(classifyPermit({ structured: ['Mechanical Systems'] }, 'New York City').categories).toContain('hvac');
        expect(classifyPermit({ structured: ['Plumbing'] }, 'New York City').categories).toContain('plumbing');
      });
    });

    describe('4. "blown off" is not "roof damage" (#10)', () => {
      it('#10 the tarp report prints no roof damage', () => {
        const s = card(10).signal;
        expect(s.summary).toMatch(/tarp/i);
        const b = briefFor({ source: s.source, kind: s.kind, title: s.title, summary: s.summary, label: 'act_now', trade: 'roofing' });
        expect(b.uncertain).not.toMatch(/roof/i);
        expect(b.uncertain).toMatch(/damage|not confirmed/i);
      });
      it('a record that really names a roof still says so', () => {
        const b = briefFor({ source: 'spc', kind: 'storm', title: 'Wind damage reported near X', summary: 'Part of the roof was blown off a barn.', label: 'act_now', trade: 'roofing' });
        expect(b.uncertain).toMatch(/roof/i);
      });
    });

    describe('5. a gutter order is not told to roofers as roof repair (#2)', () => {
      it('#2 the card quotes the order and does not say roof repair', () => {
        const s = card(2).signal;
        const b = briefFor({ source: s.source, kind: s.kind, subtype: 'violation', title: s.title, summary: s.summary, label: 'act_now', trade: 'roofing' });
        expect(b.why).toBe('A code violation was recorded nearby: repair gutter & downspout.');
        expect(b.why).not.toMatch(/roof/i);
        expect(b.next).not.toMatch(/fix-by date/);
      });
      it('new violation rows from the order text are not tagged roofing by the keyword classifier', () => {
        const cats = categorize(ds('violation'), 'REPAIR GUTTER & DOWNSPOUT').categories;
        expect(cats).not.toContain('roofing');
        expect(cats).toContain('siding-gutters');
      });
      it('the order is quoted only when short, plain and the record\'s own words', () => {
        expect(violationOrderOf('Code violation in Chicago: REPAIR EXTERIOR WALL')).toBe('repair exterior wall');
        expect(violationOrderOf('Code violation in Chicago: property violation')).toBeNull();
        expect(violationOrderOf('Code violation in Chicago: 1234 N MAIN ST')).toBeNull();
        expect(violationOrderOf('Code violation in Chicago: ' + 'A'.repeat(41))).toBeNull();
        expect(violationOrderOf('Code violation in Chicago')).toBeNull();
        expect(violationOrderOf(null)).toBeNull();
      });
    });

    describe('6. a city-centre stand-in is never shown as a real distance (#46)', () => {
      it('#46 data.approxLocation marks the row approximate', () => {
        const s = card(46).signal;
        expect(s.data.approxLocation).toBe(true);
        expect(hasApproxLocation({ source: s.source, data: s.data })).toBe(true);
      });
      it('the note uses city wording and promises no distance', () => {
        const s = card(46).signal;
        const note = approxLocationNote({ source: s.source, data: s.data, city: 'New York City' } as never);
        expect(note).toMatch(/no map point|no distance/i);
        expect(note).not.toMatch(/county/i);
      });
      it('a row with a real coordinate is not marked approximate', () => {
        expect(hasApproxLocation({ source: 'socrata-nyc-permits', data: { loc: 'exact' } })).toBe(false);
      });
    });

    describe('7. a flood advisory is not plumbing (#17)', () => {
      it('#17 a Flood Advisory is tagged for restoration and hauling, not plumbing', () => {
        const feature = {
          id: 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.fa1',
          geometry: null,
          properties: {
            id: 'urn:oid:2.49.0.1.840.0.fa1', event: 'Flood Advisory', status: 'Actual', messageType: 'Alert', severity: 'Minor', areaDesc: 'Los Angeles, CA',
            geocode: { UGC: ['CAZ041'] }, onset: '2026-11-19T17:32:00Z', ends: '2026-11-19T20:00:00Z', description: 'Flooding caused by excessive rainfall is expected.',
          },
        };
        const [row] = parseNws({ features: [feature] });
        expect(row.categories).toContain('restoration');
        expect(row.categories).not.toContain('plumbing');
      });
      it('a Flash Flood Warning keeps plumbing (water in basements)', () => {
        const feature = {
          id: 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.ff1',
          geometry: null,
          properties: {
            id: 'urn:oid:2.49.0.1.840.0.ff1', event: 'Flash Flood Warning', status: 'Actual', messageType: 'Alert', severity: 'Severe', areaDesc: 'Fulton, GA',
            geocode: { UGC: ['GAZ045'] }, onset: '2026-11-19T17:32:00Z', ends: '2026-11-19T20:00:00Z', description: 'Flash flooding.',
          },
        };
        expect(parseNws({ features: [feature] })[0].categories).toContain('plumbing');
      });
    });
  });

  it('every graded failure is covered: 20 cards, each in a describe above', () => {
    const covered = new Set([2, 6, 7, 10, 17, 18, 24, 25, 26, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
    expect(CARDS.filter((c) => !c.pass).map((c) => c.n).sort((a, b) => a - b)).toEqual([...covered].sort((a, b) => a - b));
  });
});
