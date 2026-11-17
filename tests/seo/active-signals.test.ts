import { describe, expect, it } from 'vitest';
import type { EnvKey } from '../../lib/env';
import { CATEGORY_IDS } from '../../lib/signals/categories';
import { SIGNAL_NEEDS_KEY, TRADE_SIGNALS, TRADE_SIGNALS_KEYLESS } from '../../lib/signals/capabilities';
import { activeTradeSignals, signalTypeActive } from '../../lib/seo/signal-types';
import { tradeEntries, tradeFaq, visibleSignals } from '../../lib/seo/trade-view';
import { watchList, watchTypes } from '../../lib/check/watch';

const setOf = (...keys: string[]) => (...k: EnvKey[]) => k.every((x) => keys.includes(x));
const NONE = setOf();
const ALL = setOf('TICKETMASTER_API_KEY', 'BRAVE_SEARCH_API_KEY');

describe('activeTradeSignals: key-gated types appear only when a key is configured', () => {
  it('no optional keys: equals TRADE_SIGNALS_KEYLESS for every trade, never ask or event', () => {
    for (const id of CATEGORY_IDS) {
      expect(activeTradeSignals(id, NONE), id).toEqual(TRADE_SIGNALS_KEYLESS[id]);
      expect(activeTradeSignals(id, NONE)).not.toContain('ask');
      expect(activeTradeSignals(id, NONE)).not.toContain('event');
    }
  });
  it('all keys: equals TRADE_SIGNALS', () => {
    for (const id of CATEGORY_IDS) expect(activeTradeSignals(id, ALL), id).toEqual(TRADE_SIGNALS[id]);
  });
  it('each gate opens on its own keys', () => {
    expect(signalTypeActive('ask', setOf('BRAVE_SEARCH_API_KEY'))).toBe(true);
    expect(signalTypeActive('ask', setOf('SERPER_API_KEY'))).toBe(true);
    expect(signalTypeActive('ask', setOf('BLUESKY_HANDLE'))).toBe(false);
    expect(signalTypeActive('ask', setOf('BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'))).toBe(true);
    expect(signalTypeActive('event', setOf('TICKETMASTER_API_KEY'))).toBe(true);
    expect(signalTypeActive('event', setOf('BRAVE_SEARCH_API_KEY'))).toBe(false);
    expect(signalTypeActive('permit', NONE)).toBe(true);
    expect(Object.keys(SIGNAL_NEEDS_KEY).sort()).toEqual(['ask', 'event']);
  });
  it('unknown trade receives nothing', () => {
    expect(activeTradeSignals('nope', ALL)).toEqual([]);
  });
});

describe('trade pages and the checker use the same gate', () => {
  it('trade page sentences: no ask or event without keys; present with keys when the trade has them', () => {
    for (const t of tradeEntries()) {
      const none = visibleSignals(t, activeTradeSignals(t.id, NONE)).map((s) => s.type);
      expect(none, t.id).not.toContain('ask');
      expect(none, t.id).not.toContain('event');
      const all = visibleSignals(t, activeTradeSignals(t.id, ALL)).map((s) => s.type);
      for (const ty of ['ask', 'event'] as const) {
        if (t.facts.signals.some((s) => s.type === ty) && TRADE_SIGNALS[t.id as keyof typeof TRADE_SIGNALS].includes(ty)) expect(all, `${t.id}/${ty}`).toContain(ty);
      }
    }
  });
  it('FAQ list is built from the gated sentences', () => {
    const t = tradeEntries().find((x) => x.id === 'roofing')!;
    const text = tradeFaq(t).map((f) => f.a).join(' ');
    expect(text).not.toMatch(/asking|recommendation|concert|festival/i);
  });
  it('checker watch list: no ask or event without keys, both with keys', () => {
    for (const id of CATEGORY_IDS) {
      expect(watchTypes(id, 'atlanta-ga', NONE), id).not.toContain('ask');
      expect(watchTypes(id, 'atlanta-ga', NONE), id).not.toContain('event');
    }
    expect(watchList('plumbing', 'atlanta-ga', NONE).join(' ')).not.toMatch(/recommendation/);
    expect(watchTypes('plumbing', 'atlanta-ga', ALL)).toContain('ask');
    expect(watchList('plumbing', 'atlanta-ga', ALL).join(' ')).toMatch(/recommendation/);
    const withEvent = CATEGORY_IDS.find((id) => TRADE_SIGNALS[id].includes('event'));
    if (withEvent) expect(watchTypes(withEvent, 'atlanta-ga', ALL)).toContain('event');
  });
  it('a trade with only key-gated types has an empty list without keys, not a fake one', () => {
    expect(watchList('childcare', 'atlanta-ga', NONE)).toEqual([]);
    expect(watchList('childcare', 'atlanta-ga', ALL).length).toBeGreaterThan(0);
  });
});
