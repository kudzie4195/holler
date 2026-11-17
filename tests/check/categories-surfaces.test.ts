import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_GROUPS } from '@/lib/signals/categories';
import { groupCategories } from '@/components/profile-form-groups';
import { tradeGroups } from '@/lib/check/trades';
import { groupTrades, tradeEntries } from '@/lib/seo/trade-view';
import { watchTypes } from '@/lib/check/watch';
import { TRADE_SIGNALS } from '@/lib/signals/capabilities';

// Every surface that lists trades reads CATEGORIES and CATEGORY_GROUPS. None keeps its own list, so adding a category
// (or a group) shows up everywhere and nothing silently stops at 32.
describe('every trade surface covers all categories', () => {
  const ids = CATEGORIES.map((c) => c.id).sort();
  it('there are 41 categories, each with a known group', () => {
    expect(CATEGORIES).toHaveLength(41);
    const groups = new Set(CATEGORY_GROUPS.map((g) => g.id));
    for (const c of CATEGORIES) expect(groups.has(c.group), c.id).toBe(true);
  });
  it('onboarding and settings chips (groupCategories) list every id once', () => {
    const g = groupCategories(CATEGORIES.map((c) => ({ id: c.id, label: c.label, group: c.group })));
    expect(g.flatMap((x) => x.items.map((i) => i.id)).sort()).toEqual(ids);
    expect(g.length).toBeGreaterThan(1);
    expect(g.every((x) => x.label)).toBe(true);
  });
  it('the /check form (tradeGroups) lists every id once, grouped', () => {
    const g = tradeGroups();
    expect(g.flatMap((x) => x.options.map((o) => o.id)).sort()).toEqual(ids);
    expect(g.length).toBeGreaterThan(1);
  });
  it('/for (tradeEntries and groupTrades) has a page for every id, grouped', () => {
    expect(tradeEntries().map((t) => t.id).sort()).toEqual(ids);
    const g = groupTrades(tradeEntries());
    expect(g.flatMap((x) => x.trades.map((t) => t.id)).sort()).toEqual(ids);
    expect(g.length).toBeGreaterThan(1);
  });
  it('the three surfaces use the same group headings in the same order', () => {
    const labels = CATEGORY_GROUPS.map((g) => g.label);
    const used = (l: (string | null)[]) => labels.filter((x) => l.includes(x));
    expect(groupCategories(CATEGORIES.map((c) => ({ id: c.id, label: c.label, group: c.group }))).map((x) => x.label)).toEqual(used(labels));
    expect(tradeGroups().map((x) => x.label)).toEqual(used(labels));
    expect(groupTrades(tradeEntries()).map((x) => x.title)).toEqual(used(labels));
  });
  it('the checker\'s "what Holler watches" list never names a type the trade does not receive', () => {
    for (const c of CATEGORIES) {
      for (const t of watchTypes(c.id, 'atlanta-ga')) expect(TRADE_SIGNALS[c.id], `${c.id}/${t}`).toContain(t);
    }
  });
});
