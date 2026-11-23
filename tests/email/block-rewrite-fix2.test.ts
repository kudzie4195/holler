// Round 24 FIX2 (review D4): the address-to-block rewrite on non-permit titles never garbles a title that names no house.
import { describe, expect, it } from 'vitest';
import { renderDigest } from '@/lib/email/templates';

const NOW = new Date('2026-11-23T14:00:00Z');
const mail = (it: Record<string, unknown>, lang: 'en' | 'es' = 'en') =>
  renderDigest({ businessName: 'X', items: [{ matchId: 5, occurredAt: NOW.toISOString(), sourceUrl: null, label: 'coming_soon', summary: null, ...it } as never], appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://u', lang, now: NOW });

describe('D4: the three garbled titles from the 14-day export', () => {
  it('NYC street event: "EAST 147 STREET between ..." is a numbered street, not a house', () => {
    for (const lang of ['en', 'es'] as const) {
      const m = mail({ kind: 'civic', source: 'socrata-nyc-events', subtype: 'event-permit', title: 'Permitted event in New York City: Street Event at EAST 147 STREET between WILLIS AVENUE and BERGEN AVENUE', place: 'New York City, NY' }, lang);
      const all = `${m.subject}\n${m.text}\n${m.html}`;
      expect(all).not.toMatch(/block of STREET|100 block|cuadra 100/);
      expect(m.text).toContain('EAST 147 STREET between WILLIS AVENUE and BERGEN AVENUE');
    }
  });
  it('Chicago range "1801-2011 N. Clark St." reads as the 1800 block, never "1801-2000 block"', () => {
    const m = mail({ kind: 'civic', source: 'socrata-chicago-events', subtype: 'event-permit', title: 'Permitted event in Chicago: Permit - Event 4 Cluster 3 at Lincoln Grove 1801-2011 N. Clark St.', place: 'Chicago, IL' });
    expect(m.text).not.toContain('1801-2000');
    expect(m.text).not.toContain('2011 N. Clark');
    expect(m.text).toContain('1800 block of N. Clark St.');
  });
  it('USGS "19 km SW of Toms Place" is a distance: heading and subject keep the title', () => {
    for (const lang of ['en', 'es'] as const) {
      const m = mail({ kind: 'quake', source: 'usgs', subtype: null, title: 'M2.8 earthquake 19 km SW of Toms Place, CA', place: 'CA' }, lang);
      expect(`${m.subject}\n${m.text}`).not.toMatch(/block of km|cuadra 0-99 de km|0-99 block/);
      expect(m.text).toContain('19 km SW of Toms Place');
    }
  });
  it('a real house number on a non-permit title is still printed as its block (privacy unchanged)', () => {
    const m = mail({ kind: 'civic', source: 'socrata-nyc-events', subtype: 'event-permit', title: 'Permitted event in New York City: Block Party at 345 WILLIS AVENUE', place: 'New York City, NY' });
    expect(m.text).not.toContain('345 WILLIS');
    expect(m.text).toContain('300 block of WILLIS AVENUE');
  });
});

describe('D5: a weather alert card never leads to a page that says a storm report exists, and never states damage', () => {
  it('Flood Advisory (NWS): one action, "Open this card"; no storm hanger link; any damage word is "not confirmed"', () => {
    for (const lang of ['en', 'es'] as const) {
      const m = mail({ kind: 'alert', source: 'nws', subtype: null, title: 'Flood Advisory: Miami-Dade, FL', summary: 'Minor flooding.', place: 'Miami-Dade, FL', trade: 'restoration' }, lang);
      expect(m.html).not.toContain('door-hanger');
      expect(m.text).not.toContain('door-hanger');
      for (const line of m.text.split('\n')) if (/damage|daño/i.test(line)) expect(line, line).toMatch(/not confirmed|no confirmado|no está confirmado/i);
    }
  });
});
