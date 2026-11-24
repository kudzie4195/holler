/**
 * Round 24 INT2 (email review P2-10, the feed card half): a violation's reason line quotes the order the record names. When that order is
 * Holler's own words it is said in the card's language on the member's feed card too, not only in the email. English is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { cardBrief } from '@/lib/signals/brief';
import { cardBriefLang } from '@/lib/signals/brief-i18n';

const base = { source: 'arcgis-dekalb-violations', kind: 'civic', subtype: 'violation', summary: '2400 block of HARMONY RIDGE CT', label: 'act_now' as const, trade: 'lawn-care', url: 'https://x.test/', occurredAt: '2026-11-20T10:00:00Z' };

describe('the feed card says a quoted order in the card language', () => {
  it("Holler's own words are Spanish on the Spanish card; English is byte for byte the English brief", () => {
    const card = { ...base, title: 'Code violation in DeKalb County: trash or debris and overgrown yard' };
    const es = cardBriefLang(card, 'es');
    expect(es.why).not.toContain('trash or debris and overgrown yard');
    expect(es.why).toContain('basura o escombros');
    expect(cardBriefLang(card, 'en')).toEqual(cardBrief(card));
    expect(cardBrief(card).why).toContain('trash or debris and overgrown yard');
  });

  it("a city's own text stays as the city wrote it", () => {
    const card = { ...base, source: 'socrata-chicago-violations', title: 'Code violation in Chicago: FLAKY INTERIOR PAINT' };
    // the brief lower-cases the quoted order in every language; it is not translated
    expect(cardBriefLang(card, 'es').why).toContain(': flaky interior paint');
  });
});
