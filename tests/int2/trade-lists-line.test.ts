/**
 * Round 24 INT2: the trade pages say one true line about the address lists and the door hanger, only for a trade that has a list and only
 * where sign-up takes the trade.
 */
import { describe, expect, it } from 'vitest';
import { AREA_LIST_TRADES } from '@/lib/lists/core';
import { tradeEntries, tradeListsLine, tradeOffer } from '@/lib/seo/trade-view';

describe('trade page lists line', () => {
  const ids = tradeEntries().map((t) => t.id);
  it('appears exactly for open trades that have a neighborhood list', () => {
    const shown = ids.filter((id) => tradeListsLine(id) !== null);
    expect(shown.length).toBeGreaterThan(0);
    for (const id of ids) {
      const want = AREA_LIST_TRADES.includes(id) && tradeOffer(id) !== 'waitlist';
      expect(tradeListsLine(id) !== null, id).toBe(want);
    }
    for (const id of ['landscaping', 'lawn-care']) if (AREA_LIST_TRADES.includes(id)) expect(shown).toContain(id);
  });
  it('says where to hang and flyer, names no price, trial or app, and never "lead"', () => {
    for (const id of ids) {
      const l = tradeListsLine(id);
      if (!l) continue;
      expect(l).toContain('where to hang and flyer this week');
      expect(l).not.toMatch(/\$|trial|\bapp\b|\bleads?\b|guarantee/i);
    }
  });
});
