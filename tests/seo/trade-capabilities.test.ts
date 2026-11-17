import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../lib/signals/categories';
import { SIGNAL_TYPE_IDS, TRADE_SIGNALS } from '../../lib/signals/capabilities';
import { TRADE_FACTS } from '../../lib/seo/trade-pages';
import { tradeDescription, tradeEntries, tradeFaq, tradeHeadline, tradeLead, visibleSignals } from '../../lib/seo/trade-view';
import { SIGNAL_PHRASES } from '../../lib/seo/signal-types';

// Words that name a record type, and the types that make the claim true. A headline or lead that uses the word
// for a type the trade never receives is a promise nobody keeps.
const WORDS: [RegExp, string[]][] = [
  [/hail|\bwinds?\b|tornado|storm|debris/i, ['storm-report', 'weather-alert']],
  [/heat|cold|freeze|flood|winter|snow|weather|blizzard|\bice\b|rain/i, ['weather-alert']],
  [/permit|new-home|new homes|build-out|construction/i, ['permit', 'event-permit']],
  [/new-business|new business|opening|registered/i, ['business']],
  [/violation|cited/i, ['violation']],
  [/311|complaint/i, ['311']],
  [/inspection/i, ['inspection']],
  [/airport/i, ['airport']],
  [/disaster|FEMA/i, ['disaster']],
  [/event|crowd|festival/i, ['event', 'event-permit']],
  [/\bcontracts?\b/i, ['contract']],
];

describe('trade pages only promise what the trade receives', () => {
  it('every sentence has a real signal type', () => {
    for (const [id, f] of Object.entries(TRADE_FACTS)) for (const s of f.signals) expect(SIGNAL_TYPE_IDS, `${id}/${s.signal}`).toContain(s.type);
  });
  it('a page could never show a type the trade never receives (all 41 trades)', () => {
    for (const t of tradeEntries()) {
      const received = TRADE_SIGNALS[t.id as keyof typeof TRADE_SIGNALS];
      for (const s of visibleSignals(t)) expect(received, `${t.id}/${s.type}`).toContain(s.type);
    }
  });
  it('the filter really removes a type that is not received (fake capability list)', () => {
    const t = tradeEntries().find((x) => x.id === 'roofing')!;
    const all = visibleSignals(t, SIGNAL_TYPE_IDS);
    expect(all).toHaveLength(t.facts.signals.length);
    const without = visibleSignals(t, SIGNAL_TYPE_IDS.filter((x) => x !== 'storm-report'));
    expect(without.some((s) => s.type === 'storm-report')).toBe(false);
    expect(without.length).toBeLessThan(all.length);
    expect(visibleSignals(t, [])).toEqual([]);
  });
  it('the trade page renders visibleSignals, never the raw list', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../app/for/[trade]/page.tsx'), 'utf8');
    expect(src).toContain('visibleSignals(t)');
    expect(src).not.toMatch(/t\.facts\.signals\.map/);
  });
  it('every page keeps at least one sentence when keys are set, and thin trades are shorter, not padded', () => {
    const all = (id: string) => TRADE_SIGNALS[id as keyof typeof TRADE_SIGNALS];
    for (const t of tradeEntries()) expect(visibleSignals(t, all(t.id)).length, t.id).toBeGreaterThanOrEqual(1);
    const childcare = tradeEntries().find((x) => x.id === 'childcare')!;
    expect(visibleSignals(childcare, all('childcare')).length).toBeLessThan(childcare.facts.signals.length);
  });
  it('with no optional keys only trades fed by a key alone show no sentence, and their copy says so', () => {
    const empty = tradeEntries().filter((t) => visibleSignals(t).length === 0).map((t) => t.id).sort();
    expect(empty).toEqual(['beauty', 'childcare']);
    for (const id of empty) {
      const t = tradeEntries().find((x) => x.id === id)!;
      expect(tradeHeadline(t, () => false)).toBe(t.facts.keyless!.headline);
      expect(tradeLead(t, () => false)).toMatch(/not switched on/);
    }
  });
  it('keyless headline and lead name no ask or event wording; keyed ones fall back to the default', () => {
    for (const t of tradeEntries()) {
      const off = `${tradeHeadline(t, () => false)} ${tradeLead(t, () => false)}`;
      const needsKey = (TRADE_SIGNALS[t.id as keyof typeof TRADE_SIGNALS] ?? []).some((x) => x === 'ask' || x === 'event');
      if (t.facts.keyless) expect(needsKey, t.id).toBe(true);
      expect(off, `${t.id} copy with no keys`).not.toMatch(/asking|posting|requests? alerts|big events?|concerts?|\bgames\b/i);
      expect(tradeHeadline(t, () => true), t.id).toBe(t.facts.headline);
      expect(tradeLead(t, () => true), t.id).toBe(t.facts.lead);
    }
  });
  it('headlines and leads name only record types the trade receives', () => {
    for (const [id, f] of Object.entries(TRADE_FACTS)) {
      const received: string[] = TRADE_SIGNALS[id as keyof typeof TRADE_SIGNALS] ?? [];
      for (const [label, text] of [['headline', f.headline], ['lead', f.lead]] as const) {
        const bad = WORDS.filter(([re, types]) => re.test(text) && !types.some((x) => received.includes(x))).map(([re]) => String(re));
        expect(bad, `${id} ${label}: ${text}`).toEqual([]);
      }
    }
  });
  it('FAQ answers and descriptions list only visible signals', () => {
    for (const t of tradeEntries()) {
      const received: string[] = TRADE_SIGNALS[t.id as keyof typeof TRADE_SIGNALS];
      const hiddenNames = t.facts.signals.filter((s) => !received.includes(s.type)).map((s) => s.signal.toLowerCase());
      const answer = tradeFaq(t)[0].a.toLowerCase();
      for (const n of hiddenNames) expect(answer, `${t.id}: ${n}`).not.toContain(n);
      const desc = tradeDescription(t);
      expect(desc.length).toBeLessThanOrEqual(155);
      for (const [type, phrase] of Object.entries(SIGNAL_PHRASES)) if (!received.includes(type)) expect(desc).not.toContain(phrase);
    }
  });
  it('there is no outage claim anywhere on a trade page', () => {
    for (const [id, f] of Object.entries(TRADE_FACTS)) {
      const text = [f.headline, f.lead, ...f.signals.flatMap((s) => [s.signal, s.why])].join(' ');
      expect(text, id).not.toMatch(/outage/i);
    }
  });
  it('the six trades the review named no longer promise unsent alerts', () => {
    for (const id of ['childcare', 'real-estate', 'moving', 'beauty', 'locksmith', 'public-adjuster']) {
      const t = tradeEntries().find((x) => x.id === id)!;
      const received: string[] = TRADE_SIGNALS[id as keyof typeof TRADE_SIGNALS];
      for (const s of visibleSignals(t)) expect(received).toContain(s.type);
    }
  });
  it('covers every category', () => {
    expect(CATEGORIES.every((c) => TRADE_FACTS[c.id])).toBe(true);
  });
});
