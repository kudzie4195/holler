/**
 * Brief card v1 (PLAN-2.0 item 0.4): the pure table lib/signals/brief.ts.
 * Table-driven over every registered source (SOURCE_DEFAULTS) x every label x every trade. Inputs are hand-written (assumed).
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS } from '@/lib/signals/categories';
import { labelFor, OPPORTUNITY_LABELS, SOURCE_DEFAULTS, type OpportunityLabel } from '@/lib/signals/lead-rules';
import {
  BRIEF_FAMILIES,
  NEXT_STEP,
  TRADE_WORK,
  WHY_OVERRIDES,
  allBriefStrings,
  briefFamilyOf,
  briefFor,
  briefSource,
  cardBrief,
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
            expect(text.length, `${where} ${name}`).toBeGreaterThan(20);
            expect(text.endsWith('.'), `${where} ${name} ends with a period`).toBe(true);
            expect(/[.!?]\s+[A-Z]/.test(text.slice(0, -1)), `${where} ${name} is one sentence: ${text}`).toBe(false);
          }
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
  it('the example in the plan: a failed inspection is High that it failed, and says the owner hiring is not known', () => {
    const b = briefFor({ source: 'socrata-chicago-inspections', label: 'act_now', trade: 'pest-control' });
    expect(b.uncertain).toBe('High confidence the inspection result is on file; whether the owner is hiring is not known.');
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
    expect(Object.keys(TRADE_WORK).sort()).toEqual([...CATEGORY_IDS].sort());
  });
  it('a weather event never proves damage', () => {
    for (const t of TRADES) {
      expect(briefFor({ source: 'nws', label: 'coming_soon', trade: t }).why).toMatch(/no damage is reported/);
      expect(briefFor({ source: 'usgs', label: 'coming_soon', trade: t }).why).toMatch(/no damage is reported/);
      expect(briefFor({ source: 'spc', label: 'coming_soon', trade: t }).why).toMatch(/no damage is reported/);
      expect(briefFor({ source: 'spc', label: 'act_now', trade: t }).why).toMatch(/not confirmed/);
    }
    expect(briefFor({ source: 'nws', label: 'coming_soon', trade: 'roofing' }).uncertain).toMatch(/whether anything was damaged is not known/);
  });
  it('a permit never proves a vendor is chosen', () => {
    for (const t of TRADES) {
      for (const label of ['coming_soon', 'market_insight'] as const) {
        const b = briefFor({ source: 'socrata-chicago-permits', label, trade: t });
        expect(b.why + ' ' + b.uncertain, `${label} ${t}`).toMatch(/not who will do it|does not say|may follow|may already be hired out|is not known/);
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
    expect(briefFor({ source: 'socrata-chicago-violations', label: 'act_now', trade: 'plumbing' }).next).toMatch(/look at the address on a map before you go/);
    expect(briefFor({ source: 'nws', label: 'coming_soon', trade: 'roofing' }).next).toMatch(/^Open the source/);
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
  it('a resident request links to the Holler request page, made absolute with a base, and says "Open the request"', () => {
    const rel = briefSource({ source: 'holler-request', url: '/request', occurredAt: '2026-11-20T15:00:00Z' });
    expect(rel.href).toBe('/request');
    const abs = briefSource({ source: 'holler-request', url: '/request', occurredAt: '2026-11-20T15:00:00Z', base: 'https://localholler.com/' });
    expect(abs.href).toBe('https://localholler.com/request');
    expect(abs.linkText).toBe('Open the request');
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
