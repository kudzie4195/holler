import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EnvKey } from '../../lib/env';
import { aboutCopy, homeCopy, llmsText } from '../../lib/seo/public-copy';
import { sourceActive, tradeComingSoon } from '../../lib/seo/signal-types';
import { buildSearchDescription } from '../../lib/seo/titles';
import { cityRecordsCaveat, tradeEntries, visibleSignals } from '../../lib/seo/trade-view';
import { emptyPlaceData } from '../../lib/seo/summarize';
import { groupCategories } from '../../components/profile-form-groups';
import { CATEGORIES } from '../../lib/signals/categories';
import { activeTradeSignals } from '../../lib/seo/signal-types';
import { priceLabel } from '@/lib/stripe/plans';
import { EXAMPLE_RECORDS } from '@/lib/seo/home-map';
import { FAQ_GROUPS, faqItems } from '@/lib/seo/faq';
import { TRIAL_DAYS } from '@/lib/auth/membership';

const setOf = (...keys: string[]) => (...k: EnvKey[]) => k.every((x) => keys.includes(x));
const NONE = setOf();
const ALL = setOf('BRAVE_SEARCH_API_KEY', 'SERPER_API_KEY', 'BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD', 'TICKETMASTER_API_KEY', 'SAM_API_KEY');

/** Every string reachable in a value, joined: meta descriptions, headings, list items, FAQ, examples, everything the page renders from it. */
function allText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(allText).join('\n');
  if (v && typeof v === 'object') return Object.values(v).map(allText).join('\n');
  return '';
}

const llmsInput = { cityCount: 300, states: [{ name: 'Georgia', slug: 'georgia' }], url: (p: string) => `https://example.test${p}` };
const pages = (has: (...k: EnvKey[]) => boolean) => ({
  home: allText(homeCopy(has)),
  about: allText(aboutCopy(has)),
  faq: allText(faqItems(has)),
  llms: llmsText(llmsInput, has),
});
const ASK_KEYS = [setOf('BRAVE_SEARCH_API_KEY'), setOf('SERPER_API_KEY'), setOf('BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'), ALL];

const KEY_GATED = ['asking', 'recommend', 'Bluesky', 'SAM.gov', 'concert', 'festival', 'Ticketmaster'];

describe('N3: public pages tell the truth for the keys that are set', () => {
  it('no optional keys: none of the key-gated words appear on the home page, /about, /faq or /llms.txt', () => {
    const p = pages(NONE);
    for (const [name, text] of Object.entries(p)) {
      for (const w of KEY_GATED) expect(text.toLowerCase(), `${name} names "${w}" with no keys`).not.toContain(w.toLowerCase());
    }
  });

  it('all keys: every one of them appears (the copy is gated, not deleted)', () => {
    const p = pages(ALL);
    const all = Object.values(p).join('\n').toLowerCase();
    // The home page dropped its events and people-asking cards, so "concert" and "festival" are no longer said anywhere; the event
    // key still shows as Ticketmaster.
    for (const w of KEY_GATED.filter((x) => x !== 'concert' && x !== 'festival')) expect(all, w).toContain(w.toLowerCase());
    // Round 9 fix 3: the people-asking sentences moved from the home FAQ to /faq, so the home word budget does not move with the keys.
    expect(p.faq.toLowerCase()).toContain('bluesky');
    expect(p.home.toLowerCase()).not.toContain('bluesky');
    expect(p.about).toContain('SAM.gov');
    expect(p.llms).toContain('Ticketmaster');
    expect(p.llms).toContain('SAM.gov');
  });

  it('each source is named only with its own key', () => {
    expect(allText(aboutCopy(setOf('SAM_API_KEY')))).toContain('SAM.gov');
    expect(allText(aboutCopy(setOf('BRAVE_SEARCH_API_KEY')))).not.toContain('Bluesky');
    expect(allText(aboutCopy(setOf('BRAVE_SEARCH_API_KEY')))).toContain('Licensed web search');
    expect(allText(aboutCopy(setOf('BLUESKY_HANDLE')))).not.toContain('Bluesky');
    expect(allText(faqItems(setOf('BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD')))).toContain('Bluesky');
    expect(allText(faqItems(setOf('BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD')))).not.toContain('licensed search');
    expect(allText(faqItems(setOf('BRAVE_SEARCH_API_KEY')))).toContain('licensed search APIs');
    expect(allText(faqItems(setOf('BRAVE_SEARCH_API_KEY')))).not.toContain('Bluesky');
    expect(allText(faqItems(setOf('BLUESKY_HANDLE')))).not.toContain('Bluesky');
    // Round 9 fix 3: the home FAQ names no optional source (its word budget must not move with the keys); the event key still
    // shows on /about and /llms.txt, and only with its own key.
    expect(allText(aboutCopy(setOf('TICKETMASTER_API_KEY')))).toContain('Ticketmaster');
    expect(allText(aboutCopy(NONE))).not.toContain('Ticketmaster');
    expect(allText(homeCopy(setOf('TICKETMASTER_API_KEY')).faqs)).not.toContain('Ticketmaster');
    expect(allText(aboutCopy(setOf('TICKETMASTER_API_KEY'))).toLowerCase()).not.toContain('asking');
    expect(sourceActive('sam', NONE)).toBe(false);
    expect(sourceActive('sam', setOf('SAM_API_KEY'))).toBe(true);
  });

  it('the home page examples need no key: the example map holds permits and 311 or code records only, the same in both states', () => {
    // Round 9: the example alerts moved from homeCopy to the radius map's labelled example set (lib/seo/home-map.ts).
    expect('examples' in homeCopy(NONE)).toBe(false);
    expect(EXAMPLE_RECORDS.map((e) => e.family).every((f) => f === 'permit' || f === 'civic')).toBe(true);
    expect(EXAMPLE_RECORDS.map((e) => e.title).join(' ')).not.toMatch(/asking|recommend|post|bluesky|ticket|event|sam\.gov/i);
  });

  it('keeps the page structure: same steps, ledger rows and FAQ questions in both states; the ledger names keyless record types only', () => {
    const n = homeCopy(NONE);
    const a = homeCopy(ALL);
    expect(n.steps).toEqual(a.steps);
    expect(n.faqs.map((f) => f.q)).toEqual(a.faqs.map((f) => f.q));
    expect(n.faqs.length).toBeLessThanOrEqual(4);
    // The home FAQ does not grow with any optional key: every key set leaves it exactly as it is with no key.
    for (const has of [...ASK_KEYS, setOf('SAM_API_KEY'), setOf('TICKETMASTER_API_KEY')]) expect(homeCopy(has).faqs).toEqual(n.faqs);
    for (const has of ASK_KEYS) expect(allText(homeCopy(has).faqs)).not.toMatch(/asking|bluesky|licensed search|draft/i);
    // The three-family ledger is the same with or without keys: nothing in it needs an optional key.
    expect(n.families).toEqual(a.families);
    expect(n.families.map((f) => f.id)).toEqual(['weather', 'permit', 'civic']);
    for (const f of n.families) expect(allText(f), f.id).not.toMatch(/event|concert|festival|asking|bluesky|sam\.gov|ticket/i);
    // Each step: a short title, at most twelve words of body.
    expect(n.steps).toHaveLength(3);
    for (const s of n.steps) {
      expect(s.title.split(/\s+/).length).toBeLessThanOrEqual(4);
      expect(s.body.split(/\s+/).length).toBeLessThanOrEqual(12);
    }
    expect(aboutCopy(NONE).sources.length).toBe(aboutCopy(ALL).sources.length - 4);
  });

  it('no em dashes and no invented counts in the built copy, in either state', () => {
    for (const has of [NONE, ALL]) {
      for (const text of Object.values(pages(has))) {
        expect(text).not.toContain('—');
        expect(text).not.toMatch(/\b10\+|\bten kinds\b/i);
      }
    }
  });

  it('the cadence sentence names the six-hour posts only when people-asking is on', () => {
    // The cadence moved off the home page (it is on /about); the gating rule is unchanged.
    expect(allText(homeCopy(NONE))).not.toContain('six hours');
    expect(aboutCopy(NONE).cadence).not.toContain('six hours');
    expect(aboutCopy(ALL).cadence).toContain('every six hours');
    expect(aboutCopy(NONE).cadence).toContain('every 30 minutes');
  });

  it('no draft reply promise on the home page or /about without a people-asking key; with a key it is still there', () => {
    for (const text of [allText(homeCopy(NONE)), allText(aboutCopy(NONE)), llmsText(llmsInput, NONE)]) expect(text.toLowerCase()).not.toContain('draft');
    // The steps promise no draft in either state; with a people-asking key the FAQ still explains it.
    expect(allText(homeCopy(ALL).steps).toLowerCase()).not.toContain('draft');
    // Round 9 fix 3: with a key the draft reply is explained on /faq, not in the home FAQ.
    expect(allText(homeCopy(ALL).faqs).toLowerCase()).not.toContain('draft');
    expect(allText(faqItems(NONE)).toLowerCase()).not.toContain('draft');
    for (const has of ASK_KEYS) expect(allText(faqItems(has))).toContain('If you ask for a draft reply to a public post, you get text to edit and post yourself.');
    expect(allText(aboutCopy(ALL))).toContain('draft reply');
  });

  it('the home page names no competitor and quotes no outside price: no $199, upvotes, Reddit bot or SaaS founders; only Holler pricing', () => {
    for (const has of [NONE, ALL]) {
      const t = allText(homeCopy(has));
      expect(t).not.toMatch(/\$199|upvote|Reddit|SaaS|bought accounts|Other tools|typical/i);
      // Prices are said once in the hero line and once in the plan cards (both built from lib/stripe/plans.ts), not in the copy.
      expect('flatPrice' in homeCopy(has)).toBe(false);
      const visible = allText({ ...homeCopy(has), metaDescription: '' });
      expect(visible).not.toMatch(/\$\d/);
      expect(homeCopy(has).metaDescription).toContain(`${priceLabel('starter', 'monthly')} a month after a ${TRIAL_DAYS}-day free trial`);
    }
  });

  it('no page says Holler messages anyone for the business: home FAQ, /about and /faq', () => {
    // Round 9: the home FAQ is the design's four questions; the "who sends what" answer lives on /faq (lib/seo/faq.ts).
    for (const has of [NONE, ALL]) expect(allText(homeCopy(has).faqs)).not.toMatch(/on your behalf|we post|posts for you|messages anyone for you/i);
    expect(allText(homeCopy(NONE).faqs)).toContain('It does not promise a job or a customer.');
    expect(allText(FAQ_GROUPS)).toContain('Only when you write a reply to a resident request and press send');
    expect(allText(aboutCopy(NONE).whatItIs)).toContain('plus a free page where residents can ask local businesses for help');
    expect(allText(aboutCopy(NONE).whatItIs)).toContain('Holler is new');
  });

  it('the page files hold no key-gated wording of their own (it all comes from lib/seo/public-copy.ts)', () => {
    for (const file of ['app/page.tsx', 'app/about/page.tsx', 'app/llms.txt/route.ts', 'app/faq/page.tsx', 'lib/seo/faq.ts']) {
      const src = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      for (const w of KEY_GATED) expect(src.toLowerCase(), `${file} contains "${w}"`).not.toContain(w.toLowerCase());
    }
  });
});

describe('P2: city and state descriptions, trade caveat, coming-soon trades', () => {
  const NOW = '2026-11-17T12:00:00Z';
  it('a city with nothing to count gets neutral wording: no permits, 311 or events promised for a place without a feed', () => {
    const d = buildSearchDescription({ name: 'Billings', state: 'MT', slug: 'billings-mt' }, emptyPlaceData('billings-mt', NOW, true));
    expect(d).toContain('Billings, MT');
    expect(d).not.toMatch(/311|events|contracts/i);
    expect(d.length).toBeLessThanOrEqual(155);
  });
  it('a city with a connected feed may name it, from CITY_FEEDS, and never exceeds 155 characters', () => {
    const d = buildSearchDescription({ name: 'Chicago', state: 'IL', slug: 'chicago-il' }, emptyPlaceData('chicago-il', NOW, true));
    expect(d.length).toBeLessThanOrEqual(155);
    expect(d).not.toMatch(/events/i);
  });
  it('the local index and state descriptions no longer promise permits, 311 or events', () => {
    for (const f of ['app/local/page.tsx', 'app/local/[state]/page.tsx']) {
      const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
      const desc = src.split('\n').filter((l) => /(const DESCRIPTION|const description) =/.test(l)).join('\n');
      expect(desc, f).not.toMatch(/permits|311|events|contracts/i);
      expect(desc.length, f).toBeGreaterThan(0);
    }
  });
  it('the trade caveat names only the city-record types that trade shows', () => {
    for (const t of tradeEntries()) {
      for (const has of [NONE, ALL]) {
        const shown = visibleSignals(t, activeTradeSignals(t.id, has));
        const c = cityRecordsCaveat(shown);
        const types = new Set(shown.map((s) => s.type));
        if (!c) continue;
        if (!types.has('permit')) expect(c, `${t.id} permit`).not.toContain('Building permits');
        if (!types.has('event-permit')) expect(c, `${t.id} event permit`).not.toContain('event permits');
        if (!types.has('311')) expect(c, `${t.id} 311`).not.toContain('311');
        if (!types.has('inspection')) expect(c, `${t.id} inspection`).not.toContain('nspections');
        if (!types.has('business')) expect(c, `${t.id} business`).not.toContain('business licenses');
        if (!types.has('violation')) expect(c, `${t.id} violation`).not.toContain('code violations');
      }
    }
    const locksmith = tradeEntries().find((t) => t.id === 'locksmith')!;
    expect(cityRecordsCaveat(visibleSignals(locksmith, activeTradeSignals('locksmith', NONE)))).toBe(
      'Business licenses come only from the cities Holler has connected so far.',
    );
    expect(cityRecordsCaveat([])).toBeNull();
  });
  it('trades with no active signal type are coming soon without keys, and not with the people-asking key', () => {
    expect(tradeComingSoon('childcare', NONE)).toBe(true);
    expect(tradeComingSoon('beauty', NONE)).toBe(true);
    expect(tradeComingSoon('roofing', NONE)).toBe(false);
    expect(tradeComingSoon('childcare', setOf('BRAVE_SEARCH_API_KEY'))).toBe(false);
    expect(tradeComingSoon('not-a-trade', NONE)).toBe(false);
  });
  it('chips: coming-soon trades sort last in their group, nothing is lost or duplicated', () => {
    const cats = CATEGORIES.map((c) => ({ id: c.id, label: c.label, group: c.group, comingSoon: tradeComingSoon(c.id, NONE) }));
    const groups = groupCategories(cats);
    expect(groups.flatMap((g) => g.items.map((i) => i.id)).sort()).toEqual(CATEGORIES.map((c) => c.id).sort());
    for (const g of groups) {
      const flags = g.items.map((i) => !!i.comingSoon);
      expect(flags, g.key).toEqual([...flags].sort((a, b) => Number(a) - Number(b)));
    }
    const all = groups.flatMap((g) => g.items).filter((i) => i.comingSoon).map((i) => i.id).sort();
    expect(all).toEqual(['beauty', 'childcare']);
    const beauty = groups.find((g) => g.items.some((i) => i.id === 'beauty'))!;
    expect(beauty.items[beauty.items.length - 1].comingSoon).toBe(true);
  });
});

describe('final verify P2-9 and P2-10: no promise a trade or a city cannot keep', () => {
  it('childcare and beauty FAQ promise no alerts without a people-asking key, and do with one', async () => {
    const { tradeFaq } = await import('../../lib/seo/trade-view');
    for (const id of ['childcare', 'beauty']) {
      const t = tradeEntries().find((x) => x.id === id)!;
      const none = tradeFaq(t, NONE).map((f) => f.q + ' ' + f.a).join(' ');
      expect(none).not.toMatch(/see real alerts/i);
      expect(none).toContain('no alerts to send this trade yet');
      expect(tradeFaq(t, setOf('BRAVE_SEARCH_API_KEY')).map((f) => f.a).join(' ')).toMatch(/see real alerts/i);
    }
    const roofing = tradeEntries().find((x) => x.id === 'roofing')!;
    expect(tradeFaq(roofing, NONE)[1].a).toMatch(/see real alerts/i);
  });
  it('llms.txt says city records exist only for the connected cities, with and without keys', () => {
    for (const has of [NONE, ALL]) {
      const t = llmsText(llmsInput, has);
      expect(t).toMatch(/City records \(building permits, 311 requests, inspections, new business licenses, code violations and event permits\) exist only for the cities Holler has connected/);
      expect(t).not.toMatch(/active weather alerts, storm reports, disaster declarations and earthquakes, building permits/);
    }
  });
});
