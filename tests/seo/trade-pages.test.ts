import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../lib/signals/categories';
import { TRADE_FACTS } from '../../lib/seo/trade-pages';
import { groupTrades, serviceLd, tradeDescription, tradeEntries, tradeEntry, tradeFaq, tradeTitle, GROUP_LABELS } from '../../lib/seo/trade-view';
import { isTradeIndexable, toTradeItems } from '../../lib/seo/trade-data';
import { tradeLabel } from '../../lib/seo/trades';
import { faqLd } from '../../lib/seo/jsonld';

const BANNED = /unlock|supercharge|seamless|elevate|game-changer|revolutioniz|leverag|empower|cutting-edge|robust|harness|delve|effortless|journey|in today's/i;
const NEW_IDS = ['fencing', 'concrete-paving', 'windows-doors', 'siding-gutters', 'flooring', 'handyman', 'signs-printing', 'business-services', 'public-adjuster'];

describe('trade pages data file', () => {
  it('has an entry for every CategoryId', () => {
    const missing = CATEGORIES.map((c) => c.id).filter((id) => !TRADE_FACTS[id]);
    expect(missing).toEqual([]);
  });
  it('has no entry for an id that is not in CATEGORIES', () => {
    const ids = new Set<string>(CATEGORIES.map((c) => c.id));
    // The nine round-2 ids may be here before U3's categories.ts lands; nothing else may be.
    expect(Object.keys(TRADE_FACTS).filter((id) => !ids.has(id) && !NEW_IDS.includes(id))).toEqual([]);
  });
  it('covers the nine trades added in round 2 once categories.ts has them', () => {
    const ids = new Set<string>(CATEGORIES.map((c) => c.id));
    for (const id of NEW_IDS) expect(TRADE_FACTS[id], id).toBeDefined();
    // Informational: when U3's categories land, all nine must be present there too.
    if (NEW_IDS.every((id) => ids.has(id))) expect(CATEGORIES.length).toBeGreaterThanOrEqual(41);
  });
  it('gives each trade 3 to 5 signals with a specific sentence each', () => {
    for (const [id, f] of Object.entries(TRADE_FACTS)) {
      expect(f.signals.length, id).toBeGreaterThanOrEqual(3);
      expect(f.signals.length, id).toBeLessThanOrEqual(5);
      expect(f.headline.length, id).toBeGreaterThan(10);
      expect(f.lead.length, id).toBeGreaterThan(30);
      for (const s of f.signals) expect(s.why.length, `${id}/${s.signal}`).toBeGreaterThan(40);
    }
  });
  it('has unique headlines and no repeated "why" sentences across trades', () => {
    const heads = Object.values(TRADE_FACTS).map((f) => f.headline);
    expect(new Set(heads).size).toBe(heads.length);
    const whys = Object.values(TRADE_FACTS).flatMap((f) => f.signals.map((s) => s.why));
    expect(new Set(whys).size).toBe(whys.length);
  });
  it('has no em dashes or banned words in any string', () => {
    for (const [id, f] of Object.entries(TRADE_FACTS)) {
      const strings = [f.noun, f.headline, f.lead, ...f.signals.flatMap((s) => [s.signal, s.why])];
      for (const s of strings) {
        expect(s, id).not.toMatch(/[—–]/);
        expect(s, id).not.toMatch(BANNED);
      }
    }
  });
});

describe('trade page builders', () => {
  it('reads labels from CATEGORIES, not a private list', () => {
    for (const c of CATEGORIES) expect(tradeLabel(c.id)).toBe(c.label);
    expect(tradeLabel('something-new')).toBe('Something new');
  });
  it('builds an entry per category', () => {
    expect(tradeEntries().map((t) => t.id)).toEqual(CATEGORIES.map((c) => c.id));
    expect(tradeEntry('roofing')?.facts.headline).toBe('Storm and hail alerts for roofers');
    expect(tradeEntry('nope')).toBeUndefined();
  });
  it('groups by `group` when present and by nothing when absent', () => {
    const entries = tradeEntries();
    const none = groupTrades(entries.map((e) => ({ ...e, group: null })));
    expect(none).toHaveLength(1);
    expect(none[0].title).toBeNull();
    const grouped = groupTrades(entries.map((e, i) => ({ ...e, group: i % 2 ? 'storm' : 'home' })));
    expect(grouped.map((g) => g.title)).toEqual([GROUP_LABELS.home, GROUP_LABELS.storm]);
    expect(grouped.flatMap((g) => g.trades)).toHaveLength(entries.length);
  });
  it('writes 3 grounded FAQ answers, valid FAQPage and Service JSON-LD', () => {
    const t = tradeEntry('roofing')!;
    const faq = tradeFaq(t);
    expect(faq.length).toBeGreaterThanOrEqual(2);
    expect(faq.length).toBeLessThanOrEqual(3);
    expect(faq[0].a.toLowerCase()).toContain('hail reports');
    expect(faq[1].a).toContain('$7.99 a month or $79.99 a year');
    expect(faqLd(faq)['@type']).toBe('FAQPage');
    const svc = serviceLd(t);
    expect(svc['@type']).toBe('Service');
    // Offers priced from lib/stripe/plans.ts, not typed (they said '5' and '48' before round 7).
    expect((svc.offers as { price: string; description: string }[]).map((o) => [o.price, o.description])).toEqual([
      // Round 18: the precise trial form in JSON-LD, never "months free" next to a yearly price.
      ['7.99', 'Monthly plan, 60-day free trial'],
      ['79.99', 'Annual plan, 60-day free trial'],
    ]);
    expect(JSON.stringify(svc)).not.toMatch(/[—–]/);
  });
  it('keeps titles and descriptions short, with no em dashes', () => {
    for (const t of tradeEntries()) {
      expect(tradeDescription(t).length).toBeLessThanOrEqual(155);
      expect(tradeTitle(t)).not.toMatch(/[—–]/);
      for (const f of tradeFaq(t)) expect(f.q + f.a).not.toMatch(/[—–]/);
    }
  });
  it('is noindex until the live list has 5 items', () => {
    expect(isTradeIndexable(4)).toBe(false);
    expect(isTradeIndexable(5)).toBe(true);
  });
  it('drops unsafe urls from live items', () => {
    const items = toTradeItems([
      { id: 1, source: 'nws', kind: 'alert', title: 't', url: 'javascript:alert(1)', city: null, state: 'TX', occurred_at: '2026-11-15T00:00:00Z' },
      { id: 2, source: 'nws', kind: 'alert', title: 't', url: 'https://example.gov/a', city: 'Austin', state: 'TX', occurred_at: '2026-11-15T00:00:00Z' },
    ]);
    expect(items[0].url).toBeNull();
    expect(items[1].url).toBe('https://example.gov/a');
  });
});
