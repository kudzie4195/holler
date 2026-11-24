// Round 24 FIX3 (review-FIX2 F1, F7, F8): a house number on a street whose name starts with a street word is a block, a numbered
// street after a house number is a block, a Queens house number is a block of its own kind, and a numeric city is not a place.
import { describe, expect, it } from 'vitest';
import { renderDigest } from '@/lib/email/templates';

const NOW = new Date('2026-11-23T14:00:00Z');
const mail = (it: Record<string, unknown>, lang: 'en' | 'es' = 'en') =>
  renderDigest({ businessName: 'X', items: [{ matchId: 5, occurredAt: NOW.toISOString(), sourceUrl: null, label: 'coming_soon', summary: null, ...it } as never], appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://u', lang, now: NOW });
const nycEvent = (title: string, lang: 'en' | 'es' = 'en') =>
  mail({ kind: 'civic', source: 'socrata-nyc-events', subtype: 'event-permit', title: `Permitted event in New York City: ${title}`, place: 'New York City, NY' }, lang);
const all = (m: { subject: string; text: string; html: string }) => `${m.subject}\n${m.text}\n${m.html}`;

describe('F1: a street name that starts with a street word still hides the house number', () => {
  const cases: [string, string, string, string][] = [
    ['Religious Event at 350 ST NICHOLAS AVENUE between WEST 127 STREET and WEST 128 STREET', '350 ST NICHOLAS', '300 block of ST NICHOLAS AVENUE', 'cuadra 300 de ST NICHOLAS AVENUE'],
    ['Block Party at 25 COURT STREET', '25 COURT', '0-99 block of COURT STREET', 'cuadra 0-99 de COURT STREET'],
    ['Street Event at 88 ST MARKS PLACE', '88 ST MARKS', '0-99 block of ST MARKS PLACE', 'cuadra 0-99 de ST MARKS PLACE'],
    ['Sidewalk Sale at 310 LANE AVENUE', '310 LANE', '300 block of LANE AVENUE', 'cuadra 300 de LANE AVENUE'],
    ['Parade at 841 58 STREET, 58 STREET between 8 AVENUE and 9 AVENUE', '841 58', '800 block of 58 STREET', 'cuadra 800 de 58 STREET'],
  ];
  for (const [title, exact, en, es] of cases) {
    it(title, () => {
      const e = nycEvent(title, 'en');
      const s = nycEvent(title, 'es');
      expect(all(e)).not.toContain(exact);
      expect(all(s)).not.toContain(exact);
      expect(e.text).toContain(en);
      expect(s.text).toContain(es);
    });
  }
  it('a numbered street with no house number is left alone ("EAST 147 STREET between ...", "WEST 127 STREET and ...")', () => {
    const e = nycEvent('Religious Event at 350 ST NICHOLAS AVENUE between WEST 127 STREET and WEST 128 STREET');
    expect(e.text).toContain('between WEST 127 STREET and WEST 128 STREET');
    expect(all(e)).not.toMatch(/block of STREET|100 block of/);
  });
});

describe('F7: Queens house numbers and a lawn number', () => {
  it('"33-15 DITMARS BOULEVARD" is the 33-00 block, never the house and never "0-99 block"', () => {
    const title = 'Athletic Race / Tour at 33-15 DITMARS BOULEVARD, DITMARS BOULEVARD between 35 STR...';
    const e = nycEvent(title, 'en');
    const s = nycEvent(title, 'es');
    for (const m of [e, s]) {
      expect(all(m)).not.toContain('33-15');
      expect(all(m)).not.toMatch(/0-99 block|cuadra 0-99/);
    }
    expect(e.text).toContain('33-00 block of DITMARS BOULEVARD');
    expect(s.text).toContain('cuadra 33-00 de DITMARS BOULEVARD');
  });
  it('"Great Lawn 02 Ditmars Blvd" is a lawn, not a house: the title is not rewritten', () => {
    for (const lang of ['en', 'es'] as const) {
      const m = nycEvent('Special Event at Astoria Park: Great Lawn 02 Ditmars Blvd', lang);
      expect(m.text).toContain('Great Lawn 02 Ditmars Blvd');
      expect(all(m)).not.toMatch(/block of Ditmars|cuadra \S+ de Ditmars/);
    }
  });
  it('a range outside New York keeps its first number\'s block ("1801-2011 N. Clark St.")', () => {
    const m = mail({ kind: 'civic', source: 'socrata-chicago-events', subtype: 'event-permit', title: 'Permitted event in Chicago: Festival at 1801-2011 N. Clark St.', place: 'Chicago, IL' });
    expect(m.text).toContain('1800 block of N. Clark St.');
  });
});

describe('F8: a federal bid whose city is a number names the state only', () => {
  for (const [title, bad] of [['Federal bid in 76525, MI: Roof Replacement', /76525, MI/], ['Federal bid in 3772, SC: Janitorial Services', /3772, SC/]] as const) {
    it(title, () => {
      for (const lang of ['en', 'es'] as const) {
        const m = mail({ kind: 'contract', source: 'sam-gov', subtype: 'bid', title, place: title.includes('MI') ? '76525, MI' : '3772, SC' }, lang);
        expect(all(m), lang).not.toMatch(bad);
      }
    });
  }
});
