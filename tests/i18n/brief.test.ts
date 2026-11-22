import { describe, expect, it } from 'vitest';
import { allBriefStringsLang, briefForLang, briefFromDict, briefProbeInputs, MAX_WHY_BY_LANG, cardBriefLang } from '@/lib/signals/brief-i18n';
import { briefFor, cardBrief, MAX_NEXT } from '@/lib/signals/brief';

describe('brief in the dictionary: English is exactly the existing brief', () => {
  const inputs = briefProbeInputs();
  it('probes a large, varied set', () => {
    expect(inputs.length).toBeGreaterThan(10_000);
  });
  it('briefFromDict(en) equals briefFor for every probe', () => {
    const bad: string[] = [];
    for (const input of inputs) {
      const a = briefFromDict(input, 'en');
      const b = briefFor(input);
      if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(`${input.source}|${input.label}|${input.trade}|${input.title}|${input.summary}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
  it('cardBriefLang(en) is cardBrief', () => {
    const i = { source: 'socrata-chicago-permits', kind: 'permit', title: 'Roof permit in X', summary: 'A | $12,500 job value', label: 'coming_soon' as const, trade: 'roofing', occurredAt: '2026-11-20T15:00:00Z', url: 'https://x.test/p/1' };
    expect(cardBriefLang(i, 'en')).toEqual(cardBrief(i));
  });
});

describe('brief in Spanish', () => {
  it('every sentence is complete: no unfilled {placeholder}, not empty', () => {
    const all = allBriefStringsLang('es');
    expect(all.length).toBeGreaterThan(10_000);
    for (const s of new Set(all)) {
      expect(s).not.toMatch(/\{\w+\}/);
      expect(s.trim().length).toBeGreaterThan(10);
      expect(s).not.toMatch(/—/);
    }
  });
  it('"why it matters" stays short on a phone, "next step" too', () => {
    const long: string[] = [];
    for (const input of briefProbeInputs()) {
      const b = briefForLang(input, 'es');
      if (b.why.length > MAX_WHY_BY_LANG.es + (input.title && /violation/i.test(input.title) ? 40 : 0)) long.push(b.why);
      if (b.next.length > MAX_NEXT + 20) long.push(b.next);
    }
    expect([...new Set(long)].slice(0, 5)).toEqual([]);
  });
  it('keeps the same facts as English: family, label, trade, confidence', () => {
    for (const input of briefProbeInputs().slice(0, 3000)) {
      const en = briefFor(input);
      const es = briefForLang(input, 'es');
      expect([es.family, es.label, es.trade, es.confidence]).toEqual([en.family, en.label, en.trade, en.confidence]);
    }
  });
  it('a record title stays as the source wrote it (data fields are not translated)', () => {
    const b = briefForLang({ source: 'socrata-chicago-permits', label: 'coming_soon', trade: 'plumbing', title: 'HVAC permit in Chicago' }, 'es');
    expect(b.why).toContain('(HVAC)');
    const v = briefForLang({ source: 'socrata-chicago-violations', label: 'act_now', trade: 'roofing', title: 'Code violation in X: REPAIR GUTTER & DOWNSPOUT' }, 'es');
    expect(v.why).toContain('repair gutter & downspout');
  });
  it('weather and storm cards never claim damage: they say "daño no confirmado"', () => {
    for (const source of ['nws', 'spc', 'usgs']) {
      const b = briefForLang({ source, label: 'act_now', trade: 'roofing', title: 'T', summary: undefined }, 'es');
      expect(b.uncertain).toMatch(/daño no confirmado/);
    }
    const mention = briefForLang({ source: 'spc', label: 'act_now', trade: 'roofing', title: 'T', summary: 'Roof damage reported.' }, 'es');
    expect(mention.uncertain).toMatch(/menciona .*, no confirmado/);
  });
  it('reads in usted form with the family sentence for a sample card', () => {
    const c = cardBriefLang(
      { source: 'spc', kind: 'report', title: 'Hail report', label: 'act_now', trade: 'roofing', occurredAt: '2026-11-20T15:00:00Z', url: 'https://x.test/r' },
      'es',
    );
    expect(c.why).toBe('Se presentó un reporte de tormenta cerca; los techos suelen revisarse después de las tormentas.');
    expect(c.source.linkText).toBe('Abrir la fuente pública');
    expect(c.source.dateText).toMatch(/^\d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic) 2026$/);
  });
});
