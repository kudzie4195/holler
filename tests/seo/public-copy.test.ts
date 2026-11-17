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
  llms: llmsText(llmsInput, has),
});

const KEY_GATED = ['asking', 'recommend', 'Bluesky', 'SAM.gov', 'concert', 'festival', 'Ticketmaster'];

describe('N3: public pages tell the truth for the keys that are set', () => {
  it('no optional keys: none of the key-gated words appear on the home page, /about or /llms.txt', () => {
    const p = pages(NONE);
    for (const [name, text] of Object.entries(p)) {
      for (const w of KEY_GATED) expect(text.toLowerCase(), `${name} names "${w}" with no keys`).not.toContain(w.toLowerCase());
    }
  });

  it('all keys: every one of them appears (the copy is gated, not deleted)', () => {
    const p = pages(ALL);
    const all = Object.values(p).join('\n').toLowerCase();
    for (const w of KEY_GATED) expect(all, w).toContain(w.toLowerCase());
    expect(p.home.toLowerCase()).toContain('bluesky');
    expect(p.about).toContain('SAM.gov');
    expect(p.llms).toContain('Ticketmaster');
    expect(p.llms).toContain('SAM.gov');
  });

  it('each source is named only with its own key', () => {
    expect(allText(aboutCopy(setOf('SAM_API_KEY')))).toContain('SAM.gov');
    expect(allText(aboutCopy(setOf('BRAVE_SEARCH_API_KEY')))).not.toContain('Bluesky');
    expect(allText(aboutCopy(setOf('BRAVE_SEARCH_API_KEY')))).toContain('Licensed web search');
    expect(allText(aboutCopy(setOf('BLUESKY_HANDLE')))).not.toContain('Bluesky');
    expect(allText(homeCopy(setOf('BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD')))).toContain('Bluesky');
    expect(allText(homeCopy(setOf('BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD')))).not.toContain('licensed search');
    expect(allText(homeCopy(setOf('TICKETMASTER_API_KEY')))).toContain('festivals');
    expect(allText(homeCopy(setOf('TICKETMASTER_API_KEY'))).toLowerCase()).not.toContain('asking');
    expect(sourceActive('sam', NONE)).toBe(false);
    expect(sourceActive('sam', setOf('SAM_API_KEY'))).toBe(true);
  });

  it('the example alert on the home page is always a storm report; the people-asking example needs a key', () => {
    expect(homeCopy(NONE).examples.map((e) => e.kind)).toEqual(['report']);
    expect(homeCopy(ALL).examples.map((e) => e.kind)).toEqual(['report', 'ask']);
    expect(homeCopy(NONE).examples[0].source).toBe('NOAA Storm Prediction Center');
  });

  it('keeps the page structure: same headings, steps, comparison rows and FAQ questions in both states, fewer list items without keys', () => {
    const n = homeCopy(NONE);
    const a = homeCopy(ALL);
    expect(n.steps.map((s) => s.title)).toEqual(a.steps.map((s) => s.title));
    expect(n.comparison.map((r) => r.label)).toEqual(a.comparison.map((r) => r.label));
    expect(n.faqs.map((f) => f.q)).toEqual(a.faqs.map((f) => f.q));
    expect(n.who.map((w) => w.title)).toEqual(a.who.map((w) => w.title));
    expect(n.sources.length).toBe(a.sources.length - 2);
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
    expect(allText(homeCopy(NONE).faqs)).not.toContain('six hours');
    expect(allText(homeCopy(ALL).faqs)).toContain('every six hours');
    expect(aboutCopy(NONE).cadence).toContain('every 30 minutes');
  });

  it('the three page files hold no key-gated wording of their own (it all comes from lib/seo/public-copy.ts)', () => {
    for (const file of ['app/page.tsx', 'app/about/page.tsx', 'app/llms.txt/route.ts']) {
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
