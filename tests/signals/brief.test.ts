/**
 * Brief card v1 (PLAN-2.0 item 0.4): the pure table lib/signals/brief.ts.
 * Table-driven over every registered source (SOURCE_DEFAULTS) x every label x every trade. Inputs are hand-written (assumed).
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS } from '@/lib/signals/categories';
import { labelFor, OPPORTUNITY_LABELS, SOURCE_DEFAULTS, type OpportunityLabel } from '@/lib/signals/lead-rules';
import {
  BRIEF_FAMILIES,
  MAX_NEXT,
  MAX_UNCERTAIN,
  MAX_WHY,
  NEXT_STEP,
  TRADE_WORK,
  WHY_OVERRIDES,
  allBriefStrings,
  briefFamilyOf,
  briefFor,
  briefSource,
  awardWorkOf,
  cardBrief,
  damagePhraseOf,
  permitTypeOf,
  sourceLine,
  tradeForRecord,
  workFor,
} from '@/lib/signals/brief';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { BANNED } from './banned';

const SOURCES = Object.keys(SOURCE_DEFAULTS);
const TRADES: (string | null)[] = [null, ...CATEGORY_IDS];

describe('families', () => {
  it('every registered source maps to a real family, never "other"', () => {
    for (const id of SOURCES) expect(briefFamilyOf({ source: id }), id).not.toBe('other');
  });
  it('every source in SOURCE_META has a family too', () => {
    for (const id of Object.keys(SOURCE_META)) expect(briefFamilyOf({ source: id }), id).not.toBe('other');
  });
  it('maps by dataset suffix, subtype and kind; an unknown record is "other"', () => {
    expect(briefFamilyOf({ source: 'socrata-chicago-inspections' })).toBe('inspection');
    expect(briefFamilyOf({ source: 'arcgis-cobb-residential-permits' })).toBe('permit');
    expect(briefFamilyOf({ source: 'socrata-nyc-311' })).toBe('311');
    expect(briefFamilyOf({ source: 'socrata-austin-violations' })).toBe('violation');
    expect(briefFamilyOf({ source: 'socrata-sf-business' })).toBe('business');
    expect(briefFamilyOf({ source: 'socrata-nyc-events' })).toBe('event-permit');
    expect(briefFamilyOf({ source: 'bids-la' })).toBe('city-bid');
    expect(briefFamilyOf({ source: 'future-source', subtype: 'bid' })).toBe('city-bid');
    expect(briefFamilyOf({ source: 'future-source', subtype: 'violation' })).toBe('violation');
    expect(briefFamilyOf({ source: 'future-source', kind: 'quake' })).toBe('quake');
    expect(briefFamilyOf({ source: 'future-source', kind: 'civic' })).toBe('other');
  });
  it('has a next step for every family', () => {
    for (const f of BRIEF_FAMILIES) expect(NEXT_STEP[f]?.length, f).toBeGreaterThan(10);
  });
});

describe('every source x label x trade gives a complete brief', () => {
  for (const id of SOURCES) {
    it(id, () => {
      for (const label of OPPORTUNITY_LABELS) {
        for (const trade of TRADES) {
          const b = briefFor({ source: id, label, trade });
          const where = `${id} ${label} ${trade}`;
          // one sentence: it ends in a period and has no other sentence break inside
          for (const [name, text] of [['why', b.why], ['next', b.next], ['uncertain', b.uncertain]] as const) {
            expect(text.length, `${where} ${name}`).toBeGreaterThan(15);
            expect(text.endsWith('.'), `${where} ${name} ends with a period`).toBe(true);
            expect(/[.!?]\s+[A-Z]/.test(text.slice(0, -1)), `${where} ${name} is one sentence: ${text}`).toBe(false);
          }
          // short enough that a typical card stays small on a phone
          expect(b.why.length, `${where} why length`).toBeLessThanOrEqual(MAX_WHY);
          expect(b.next.length, `${where} next length`).toBeLessThanOrEqual(MAX_NEXT);
          expect(b.uncertain.length, `${where} uncertain length`).toBeLessThanOrEqual(MAX_UNCERTAIN);
          expect(['High', 'Medium', 'Low']).toContain(b.confidence);
          expect(b.uncertain.startsWith(`${b.confidence} confidence `), where).toBe(true);
          expect(b.uncertain).toMatch(/;/);
          expect(b.family).toBe(briefFamilyOf({ source: id }));
        }
      }
    });
  }
  it('uses the real label for every (source, trade): the brief for labelFor() is never empty', () => {
    for (const id of SOURCES) {
      for (const trade of TRADES) {
        const label = labelFor({ source: id }, trade as never);
        expect(briefFor({ source: id, label, trade }).why.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('confidence comes from the source family', () => {
  const conf = (source: string, label: OpportunityLabel = 'coming_soon') => briefFor({ source, label, trade: 'roofing' }).confidence;
  it('official measurements and records are High', () => {
    for (const s of ['nws', 'spc', 'fema', 'usgs', 'faa', 'socrata-chicago-permits', 'socrata-chicago-violations', 'socrata-chicago-inspections', 'sam-gov', 'usaspending', 'bids-sf', 'socrata-sf-business', 'socrata-nyc-events']) {
      expect(conf(s), s).toBe('High');
    }
  });
  it('311 requests, event listings and resident requests are Medium', () => {
    for (const s of ['socrata-chicago-311', 'socrata-nyc-311', 'ticketmaster', 'holler-request']) expect(conf(s), s).toBe('Medium');
  });
  it('public posts are Low', () => {
    for (const s of ['bluesky', 'websearch-brave', 'websearch-serper']) expect(conf(s, 'act_now'), s).toBe('Low');
  });
  it('the example in the plan: a failed inspection is High that it is on file, and says hiring is not known', () => {
    const b = briefFor({ source: 'socrata-chicago-inspections', label: 'act_now', trade: 'pest-control' });
    expect(b.uncertain).toBe('High confidence the inspection result is on file; hiring is not known.');
  });
});

describe('trade-specific, and honest about what the record does not show', () => {
  it('the same record reads differently for different trades', () => {
    const a = briefFor({ source: 'socrata-chicago-permits', label: 'coming_soon', trade: 'hvac' }).why;
    const b = briefFor({ source: 'socrata-chicago-permits', label: 'coming_soon', trade: 'painting' }).why;
    expect(a).not.toBe(b);
    expect(a).toContain(TRADE_WORK.hvac);
    expect(b).toContain(TRADE_WORK.painting);
  });
  it('every category has a work phrase; no trade uses the generic one', () => {
    for (const t of CATEGORY_IDS) expect(TRADE_WORK[t], t).toBeTruthy();
    expect(workFor(null)).toBe('work you do');
    expect(workFor('not-a-trade')).toBe('work you do');
    for (const t of CATEGORY_IDS) expect(TRADE_WORK[t].length, t).toBeLessThanOrEqual(22);
    expect(Object.keys(TRADE_WORK).sort()).toEqual([...CATEGORY_IDS].sort());
  });
  it('a weather event never proves damage, and never denies it either: "no damage is reported" only when the record text has no damage words', () => {
    for (const t of TRADES) {
      for (const src of ['nws', 'usgs', 'spc']) {
        for (const label of ['act_now', 'coming_soon'] as const) {
          // text not passed: only "not confirmed"
          const bare = briefFor({ source: src, label, trade: t });
          expect(bare.uncertain, `${src} ${label} ${t}`).toMatch(/damage is not confirmed/);
          expect(bare.uncertain).not.toMatch(/no damage/);
          // text passed and clean: the table's line (may say no damage is reported)
          const clean = briefFor({ source: src, label, trade: t, title: 'A report', summary: 'Winds from the west.' });
          expect(clean.uncertain).toMatch(/no damage is reported|damage is not confirmed/);
          // text with damage words: says what the record says, never "no damage"
          const dmg = briefFor({ source: src, label, trade: t, title: '60 mph wind gust reported near 3 N Smyrna, GA', summary: 'Several trees down on homes and power lines down. (FFC)' });
          expect(dmg.uncertain).toMatch(/it mentions trees down, not confirmed/);
          expect(dmg.uncertain).not.toMatch(/no damage/);
        }
        expect(briefFor({ source: src, label: 'coming_soon', trade: t, title: 'x' }).why, `${src} ${t}`).not.toMatch(/was damaged|caused damage|has damage|is damaged|measured/i);
      }
    }
  });
  it('a gust is "reported", never "measured" (SPC speeds are often estimated)', () => {
    for (const t of TRADES) {
      const b = briefFor({ source: 'spc', label: 'coming_soon', trade: t, title: 'x' });
      expect(b.why + b.uncertain).not.toMatch(/measured/);
      expect(b.why).toMatch(/A wind gust was reported nearby/);
    }
  });
  it('the damage phrase is the record\'s own words, one of a fixed list', () => {
    for (const [text, phrase] of [['Trees down across the road', 'trees down'], ['Power lines down.', 'power lines down'], ['roof damage to a barn', 'roof damage'], ['Damaging winds', 'damage'], ['Flooding on Main St', 'flooding'], ['Injuries reported', 'injuries']] as const) {
      expect(damagePhraseOf(text), text).toBe(phrase);
    }
    expect(damagePhraseOf('Winds from the west at 60 mph')).toBeNull();
  });
  it('a permit never proves a vendor is chosen', () => {
    for (const t of TRADES) {
      for (const label of ['coming_soon', 'market_insight'] as const) {
        const b = briefFor({ source: 'socrata-chicago-permits', label, trade: t });
        expect(b.why + ' ' + b.uncertain, `${label} ${t}`).toMatch(/work is planned|may follow|may already be hired out|is not known|filed nearby/);
        expect(b.why).not.toMatch(/is being (chosen|hired)|has been hired/i);
      }
    }
    expect(briefFor({ source: 'socrata-chicago-permits', label: 'market_insight', trade: 'roofing' }).uncertain).toMatch(/may already be hired out/);
  });
  it('overrides are real cells: label, family and trade exist, and each differs from the generic sentence', () => {
    for (const [key, text] of Object.entries(WHY_OVERRIDES)) {
      const [label, family, trade] = key.split('|');
      expect(OPPORTUNITY_LABELS).toContain(label);
      expect(BRIEF_FAMILIES).toContain(family);
      expect(CATEGORY_IDS).toContain(trade);
      const rep: Record<string, string> = { 'storm-report': 'spc', inspection: 'socrata-chicago-inspections', permit: 'socrata-chicago-permits' };
      const generic = briefFor({ source: rep[family], label: label as OpportunityLabel, trade: 'not-a-trade' }).why;
      expect(text).not.toBe(generic.replace(workFor('not-a-trade'), workFor(trade)));
    }
  });
  it('an override reaches the card: a roofer after a hail report, a pest-control company after a failed inspection', () => {
    expect(briefFor({ source: 'spc', label: 'act_now', trade: 'roofing' }).why).toMatch(/roofs are often checked/);
    expect(briefFor({ source: 'socrata-chicago-inspections', label: 'act_now', trade: 'pest-control' }).why).toMatch(/often involve pests/);
  });
  it('the next step is one concrete action per family, as in the plan', () => {
    expect(briefFor({ source: 'sam-gov', label: 'act_now', trade: 'roofing' }).next).toBe("Check the due date and the buyer's bid page.");
    expect(briefFor({ source: 'bids-la', label: 'act_now', trade: 'roofing' }).next).toBe("Check the due date and the buyer's bid page.");
    expect(briefFor({ source: 'socrata-chicago-violations', label: 'act_now', trade: 'plumbing' }).next).toMatch(/look at it on a map/);
    expect(briefFor({ source: 'socrata-chicago-inspections', label: 'act_now', trade: 'pest-control' }).next).toBe('Check what failed and the address, then decide if it is worth a visit.');
  });
  it('a next step is the action AFTER opening the source: none repeats "Open the source" (the Source line holds the link)', () => {
    for (const f of BRIEF_FAMILIES) expect(NEXT_STEP[f], f).not.toMatch(/\bopen\b/i);
  });
  it('no brief string says "your trade": a card is worded for the trade it was matched to, never for the viewer in general', () => {
    for (const s of allBriefStrings()) expect(s).not.toMatch(/your trade|your line of work|your industry/i);
  });
});

describe('wording rules over every brief string', () => {
  const all = allBriefStrings();
  it('covers a lot of strings (so the test is not vacuous)', () => {
    expect(all.length).toBeGreaterThan(5000);
    expect(new Set(all).size).toBeGreaterThan(300);
  });
  it('has no banned word or phrase, no em or en dash', () => {
    const hits = new Set<string>();
    for (const s of all) for (const re of BANNED) if (re.test(s)) hits.add(`${re}: ${s}`);
    expect([...hits]).toEqual([]);
  });
  it('uses US spelling', () => {
    for (const s of all) expect(s).not.toMatch(/organis|colour|licence|neighbour/i);
  });
});

describe('source and date (part 4): a card never has no link', () => {
  it('every registered source gets a link with no record url (the dataset page), and the record link when it has one', () => {
    for (const id of SOURCES) {
      const home = briefSource({ source: id, url: null, occurredAt: '2026-11-20T15:00:00Z', base: 'https://localholler.com' });
      expect(home.href, id).toMatch(/^https?:\/\//);
      expect(home.recordLink).toBe(false);
      expect(home.label.length).toBeGreaterThan(3);
      expect(home.dateText).toBe('Nov 20, 2026');
      const own = briefSource({ source: id, url: 'https://city.example.gov/r/1', occurredAt: '2026-11-20T15:00:00Z' });
      expect(own.href).toBe('https://city.example.gov/r/1');
      expect(own.recordLink).toBe(true);
    }
  });
  it('rejects a link that is not http(s) or a site path (no javascript: urls)', () => {
    const s = briefSource({ source: 'nws', url: 'javascript:alert(1)', occurredAt: '2026-11-20T15:00:00Z' });
    expect(s.href).toBe('https://www.weather.gov/alerts');
    expect(s.recordLink).toBe(false);
  });
  it('a resident request links to the Holler request page, made absolute with a base, and says "Open the request form"', () => {
    const rel = briefSource({ source: 'holler-request', url: '/request', occurredAt: '2026-11-20T15:00:00Z' });
    expect(rel.href).toBe('/request');
    const abs = briefSource({ source: 'holler-request', url: '/request', occurredAt: '2026-11-20T15:00:00Z', base: 'https://localholler.com/' });
    expect(abs.href).toBe('https://localholler.com/request');
    expect(abs.linkText).toBe('Open the request form');
    expect(abs.label).toBe('Request made on Holler');
  });
  it('Baton Rouge bids keep the "bid portal" link text', () => {
    expect(briefSource({ source: 'bids-batonrouge', url: 'https://www.brla.gov/bids', occurredAt: null }).linkText).toBe('Open the bid portal');
  });
  it('the record date is the Eastern calendar day; an unusable date says so', () => {
    expect(briefSource({ source: 'nws', occurredAt: '2026-11-21T03:00:00Z' }).dateText).toBe('Nov 20, 2026');
    expect(briefSource({ source: 'nws', occurredAt: 'nope' }).dateText).toBeNull();
    expect(sourceLine({ label: 'X', dateText: null })).toBe('Source: X. Record date not published.');
    expect(sourceLine({ label: 'X', dateText: 'Nov 20, 2026' })).toBe('Source: X. Record date: Nov 20, 2026.');
  });
  it('cardBrief counts an unset label as coming_soon and carries all five parts', () => {
    const c = cardBrief({ source: 'socrata-chicago-311', trade: 'plumbing', url: 'https://x.gov/1', occurredAt: '2026-11-20T15:00:00Z' });
    expect(c.label).toBe('coming_soon');
    expect([c.why, c.next, c.source.label, c.source.href, c.source.dateText, c.uncertain, c.confidence].every(Boolean)).toBe(true);
  });
});

describe('tradeForRecord', () => {
  const sig = { source: 'socrata-chicago-inspections', subtype: 'inspection', title: 'Failed food inspection' };
  it('picks the member trade that gives the strongest label', () => {
    // pest-control is act_now for a failed inspection; plumbing is coming_soon
    expect(tradeForRecord(sig, ['plumbing', 'pest-control'], ['plumbing', 'pest-control'])).toBe('pest-control');
  });
  it('ignores trades the record is not tagged with, and gives null for a keyword-only match', () => {
    expect(tradeForRecord(sig, ['plumbing'], ['pest-control'])).toBeNull();
    expect(tradeForRecord(sig, null, ['pest-control'])).toBeNull();
    expect(tradeForRecord(sig, ['plumbing'], [])).toBeNull();
  });
});

describe('permit and federal-award briefs describe the record from the record, never from the trade tag (review P1-2)', () => {
  it('a market-insight permit names the permit type from its own title, whatever trade the member picked', () => {
    for (const t of TRADES) {
      const hvac = briefFor({ source: 'arcgis-montgomery-permits', label: 'market_insight', trade: t, title: 'HVAC permit in Montgomery County' }).why;
      expect(hvac, `${t}`).toBe('A permit was filed nearby (HVAC); work is planned.');
      expect(hvac).not.toContain(workFor(t) === 'work you do' ? 'XXX' : workFor(t));
    }
  });
  it('a permit title with no type says the permit does not say what the work is', () => {
    const b = briefFor({ source: 'socrata-chicago-permits', label: 'market_insight', trade: 'childcare', title: 'Permit in Montgomery County' });
    expect(b.why).toBe('A permit was filed nearby; the permit does not say what the work is.');
    expect(b.why).not.toMatch(/childcare/);
    expect(briefFor({ source: 'socrata-chicago-permits', label: 'coming_soon', trade: 'moving', title: 'Permit in X' }).uncertain).toMatch(/it does not say what the work is/);
  });
  it('the live rows the review found: HVAC to junk removal, window and door to childcare, home occupation to real estate', () => {
    const w = (title: string, trade: string) => briefFor({ source: 'socrata-montgomery-permits', label: 'market_insight', trade, title }).why;
    expect(w('HVAC permit in Montgomery County', 'junk-removal')).toBe('A permit was filed nearby (HVAC); work is planned.');
    expect(w('Window and door permit in Montgomery County', 'childcare')).toBe('A permit was filed nearby (Window and door); work is planned.');
    expect(w('Home Occupation permit in Washington', 'real-estate')).toBe('A permit was filed nearby (Home Occupation); work is planned.');
  });
  it('permitTypeOf and awardWorkOf read the title only', () => {
    expect(permitTypeOf('Roof permit in Chicago')).toBe('Roof');
    expect(permitTypeOf('Permit in Chicago')).toBeNull();
    expect(permitTypeOf(undefined)).toBeUndefined();
    expect(awardWorkOf('Federal contract ($310K) in Cincinnati, OH: Plumbing (NAICS 238220)')).toBe('Plumbing');
    expect(awardWorkOf('Federal contract ($256K) in Duluth, MN: NAICS 562991')).toBeNull();
    expect(awardWorkOf(undefined)).toBeUndefined();
  });
  it('a federal award never names the trade: a NAICS-only contract shown to junk removal does not say "for junk hauling"', () => {
    for (const t of TRADES) {
      const why = briefFor({ source: 'usaspending', label: 'market_insight', trade: t, title: 'Federal contract ($256K) in Duluth, MN: NAICS 562991' }).why;
      expect(why).toBe('A federal contract was awarded; the record does not name the work.');
    }
    expect(briefFor({ source: 'usaspending', label: 'market_insight', trade: 'junk-removal', title: 'Federal contract ($1K) in X: Plumbing (NAICS 238220)' }).why).toBe('A federal contract was awarded for Plumbing; it is closed.');
  });
  it('a permit sentence with a long type falls back to the short sentence and stays within the cap', () => {
    const long = 'A very long permit type that goes on and on and on';
    for (const label of ['coming_soon', 'market_insight'] as const) {
      expect(briefFor({ source: 'socrata-chicago-permits', label, trade: 'roofing', title: `${long} permit in X` }).why.length).toBeLessThanOrEqual(MAX_WHY);
    }
  });
});

describe('inspection trade wording is true for the trade (review P1-3: live inspections are tagged to many trades)', () => {
  const REPAIR = ['plumbing', 'hvac', 'electrical', 'general-contractor', 'handyman', 'painting', 'flooring', 'windows-doors'];
  it('"repairs may involve" / "fixing it may call for" appears only for repair trades', () => {
    for (const t of CATEGORY_IDS) {
      for (const label of ['act_now', 'coming_soon'] as const) {
        const why = briefFor({ source: 'socrata-chicago-inspections', label, trade: t }).why;
        const repairWording = /repairs may involve|fixing it may call for/.test(why);
        if (['pest-control', 'cleaning', 'janitorial-commercial'].includes(t) && label === 'act_now') continue; // own sentences
        expect(repairWording, `${label} ${t}: ${why}`).toBe(REPAIR.includes(t));
      }
    }
  });
  it('every other trade gets the neutral sentence, never "repairs may involve childcare / catering / food truck"', () => {
    for (const t of ['childcare', 'food-truck', 'catering', 'business-services', 'signs-printing', 'landscaping', 'junk-removal']) {
      const why = briefFor({ source: 'socrata-chicago-inspections', label: 'coming_soon', trade: t }).why;
      expect(why).toBe('A food inspection nearby failed; check if what failed fits what you do.');
    }
    expect(briefFor({ source: 'socrata-chicago-inspections', label: 'coming_soon', trade: null }).why).toBe('A food inspection nearby failed; check if what failed fits what you do.');
  });
});

describe('hedged wording (review P2)', () => {
  it('a 311 does not say the city has not confirmed it; it says the record does not show it', () => {
    const u = briefFor({ source: 'socrata-nyc-311', label: 'act_now', trade: 'hvac' }).uncertain;
    expect(u).toBe('Medium confidence it was filed; the record does not show the city confirmed it.');
  });
  it('a weather alert "was issued"; the next step says to check if it is still in effect', () => {
    const b = briefFor({ source: 'nws', label: 'coming_soon', trade: 'roofing' });
    expect(b.why).toBe('A weather alert was issued near you; roof repair or install may follow.');
    expect(b.why).not.toMatch(/is active/);
    expect(b.next).toMatch(/check if it is still in effect/);
  });
  it('cleaning reads "cleaning", not "house cleaning", on a business-license card', () => {
    expect(briefFor({ source: 'socrata-sf-business', label: 'coming_soon', trade: 'cleaning' }).why).toBe('A new business license was filed nearby; it may need cleaning.');
  });
});
