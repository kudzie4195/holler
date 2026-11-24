// R25 check fix, review R25CHECK P3-4: a trade name inside an English /check sentence keeps its acronym in capitals ("HVAC", "IT"), as
// the Spanish page and the emails already do (lib/email/templates.ts tradeWords).
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import { checkVerdict } from '@/lib/check/verdict';
import { tradeInSentence, tradeLabel } from '@/lib/check/trades';
import { CheckResults } from '@/components/check-results';

const t = { count: 12, places: 9, oldest: null, atLeast: false };

describe('acronyms stay upper case in English sentences', () => {
  it('tradeInSentence', () => {
    expect(tradeInSentence(tradeLabel('hvac'))).toBe('heating and air (HVAC)');
    expect(tradeInSentence(tradeLabel('business-services'))).toBe('bookkeeping, payroll and IT setup');
    expect(tradeInSentence(tradeLabel('lawn-care'))).toBe('lawn care');
    expect(tradeInSentence(tradeLabel('pressure-washing'))).toBe('pressure washing');
    expect(tradeInSentence(tradeLabel('hvac', 'es'))).toBe('calefacción y aire acondicionado (HVAC)');
  });
  it('the verdict sentence', () => {
    expect(checkVerdict('live', t, { tradeLabel: tradeLabel('hvac'), zip: '30318', lang: 'en' })!.count).toContain('would have reached a heating and air (HVAC) business as alerts');
    expect(checkVerdict('live', t, { tradeLabel: tradeLabel('business-services'), zip: '30318', lang: 'en' })!.count).toContain('a bookkeeping, payroll and IT setup business');
    expect(checkVerdict('live', { ...t, count: 0, places: 0 }, { tradeLabel: tradeLabel('hvac'), zip: '30318', lang: 'en' })!.count).toBe('Recently, no alerts would have been emailed to a heating and air (HVAC) business within 25 miles of 30318.');
  });
  it('the limited line and the empty-list heading on /check', () => {
    const html = renderToStaticMarkup(
      createElement(CheckResults, { items: [], mode: 'results', checkedAt: '2026-11-23T12:00:00Z', placeLabel: 'Atlanta, GA', trade: 'hvac', tradeLabel: tradeLabel('hvac'), citySlug: null, watches: [], now: Date.parse('2026-11-23T13:00:00Z'), lang: 'en', coverageState: 'limited' }),
    );
    expect(html).toContain('Holler is watching near Atlanta, GA for heating and air (HVAC) work');
    expect(html).toContain('Few heating and air (HVAC) records near here so far');
    expect(html).toContain('matched heating and air (HVAC) in the last 30 days');
    expect(html).not.toMatch(/\(hvac\)/);
  });
});
