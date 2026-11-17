// Criterion 2: the public row never holds free text (title from the trade list, summary null); the filtered text businesses see has
// phones, emails, links and names removed.
import { describe, expect, it } from 'vitest';
import { requestSummary } from '@/lib/requests/scrub';
import { buildRequestSignal, requestTitle } from '@/lib/requests/signal';

/** Anything that still looks like a way to reach someone. */
function leaks(s: string): string[] {
  const found: string[] = [];
  if (/@/.test(s)) found.push('@');
  if (/https?:|www\.|\.(?:com|net|org|io|co)\b/i.test(s)) found.push('link');
  const digits = s.replace(/[^\d]/g, ' ').split(/\s+/).filter(Boolean);
  if (digits.some((d) => d.length >= 7)) found.push('long number');
  if (/\d{3}[\s.)-]*\d{3,4}/.test(s)) found.push('phone-like');
  return found;
}

const ADVERSARIAL: { text: string; mustNotContain: string[]; keeps?: string }[] = [
  { text: 'call me at 404-555-1212 about my roof leak, it is getting worse', mustNotContain: ['404', '555', '1212'], keeps: 'roof leak' },
  { text: 'Roof leak in the kitchen. Email john@x.com for details please.', mustNotContain: ['john', 'x.com'], keeps: 'Roof leak' },
  { text: 'My name is Sarah Connor and I need a plumber for a leaking water heater', mustNotContain: ['Sarah', 'Connor'], keeps: 'plumber' },
  { text: 'See photos at https://example.com/pics of the cracked driveway, need a quote', mustNotContain: ['example', 'https', 'pics'], keeps: 'driveway' },
  { text: 'JOHN SMITH needs gutters cleaned this week on a two story house', mustNotContain: ['JOHN', 'SMITH', 'John', 'Smith'], keeps: 'gutters' },
  { text: 'Text (404) 555 1212 or 4045551212 anytime, the AC died last night', mustNotContain: ['404', '555', '1212'], keeps: 'AC died' },
  { text: 'AC broken, write to john at gmail dot com or find me @sarahc on www.facebook.com/sarah.c', mustNotContain: ['john', 'gmail', 'sarahc', 'facebook'] },
  { text: 'I live at 123 Peachtree St NE Apt 4B and need a new wood fence', mustNotContain: ['123', 'Peachtree', '4B'], keeps: 'wood fence' },
  { text: 'Need a roofer for a small leak over the porch.\nThanks,\nMike Jones', mustNotContain: ['Mike', 'Jones'], keeps: 'roofer' },
  { text: 'MY ROOF IS LEAKING. PLEASE CALL JOHN AT 404 555 1212 TODAY', mustNotContain: ['JOHN', 'john', 'John', '404', '1212'] },
  { text: "my name's bob jones, need two movers on Saturday for a small apartment", mustNotContain: ['bob', 'jones'], keeps: 'movers' },
  { text: 'Need my furnace serviced before winter, ask for Linda Parker at the front desk', mustNotContain: ['Linda', 'Parker'], keeps: 'furnace' },
  { text: 'Sarah here, our fence blew down in the storm and needs fixing', mustNotContain: ['Sarah'], keeps: 'fence' },
  { text: 'Call +1 (678) 555-0199 or 555.0199 after work, need tree removal near the house', mustNotContain: ['678', '0199'], keeps: 'tree removal' },
  { text: 'Water heater is out. Reach me at sarah.connor+jobs@mail.example.co.uk or sarahconnor.com', mustNotContain: ['sarah', 'connor', 'mail.example'] },
];

describe('requestSummary (public summary of a resident description)', () => {
  it.each(ADVERSARIAL)('removes contact details and names: $text', ({ text, mustNotContain, keeps }) => {
    const out = requestSummary(text) ?? '';
    expect(leaks(out)).toEqual([]);
    for (const bad of mustNotContain) expect(out).not.toContain(bad);
    if (keeps) expect(out).toContain(keeps);
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out).not.toMatch(/—/);
  });

  it('cuts long text to 140 characters at a word boundary', () => {
    const long = 'need someone to look at the roof over the garage because water comes in when it rains hard and the ceiling is stained '.repeat(4);
    const out = requestSummary(long)!;
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out.endsWith('...')).toBe(true);
  });

  it('keeps an ordinary description readable', () => {
    expect(requestSummary('Need a quote to replace the shingles on a one story ranch house. Some were blown off last week.')).toBe(
      'Need a quote to replace the shingles on a one story ranch house. Some were blown off last week.',
    );
  });

  it('returns null when nothing useful is left', () => {
    expect(requestSummary('John Smith 404-555-1212 john@x.com')).toBeNull();
  });
});

describe('public title and signal row', () => {
  it('title is built only from the trade list and the ZIP lookup', () => {
    expect(requestTitle('Atlanta', 'roofing')).toBe('Service request in Atlanta: Roofing');
    expect(requestTitle('Decatur', 'hvac')).toBe('Service request in Decatur: Heating and air (HVAC)');
  });

  it.each(ADVERSARIAL)('no description words reach the title: $text', ({ text }) => {
    const row = buildRequestSignal(
      {
        public_id: 'req_0123456789abcdef0123',
        trade: 'roofing',
        zip: '30301',
        city: 'Atlanta',
        state: 'GA',
        place_slug: 'atlanta-ga',
        lat: 33.84,
        lon: -84.47,
      },
      { siteUrl: 'https://holler.test', now: new Date('2026-11-17T12:00:00Z'), expiresAt: new Date('2026-12-01T12:00:00Z') },
    );
    expect(row.title).toBe('Service request in Atlanta: Roofing');
    const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const titleWords = new Set(row.title.toLowerCase().match(/[a-z]+/g));
    expect(words.filter((w) => titleWords.has(w) && !['roof', 'roofing', 'service', 'request'].includes(w))).toEqual([]);
    expect(row.url).toBe('https://holler.test/request');
    expect(row.data).toEqual({});
    // P1-1: the public row carries no free text at all, whatever the description held.
    expect(row.summary).toBeNull();
    expect(JSON.stringify(row).toLowerCase()).not.toContain(text.toLowerCase().slice(0, 12));
    expect(row.kind).toBe('ask');
    expect(row.source).toBe('holler-request');
    expect(row.severity).toBe(2);
  });
});
