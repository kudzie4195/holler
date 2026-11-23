/**
 * Round 24 FIXMAIL: the fixes to the rebuilt alert email from gates/r24/review/review-EMAIL.md, each pinned on the rendered output.
 *   P1-1  every card's one action leads to something about that card
 *   P1-2  the feed scrolls to the email's card when the list arrives late, says so when the card is not in the list, and log-in keeps the anchor
 *   P1-3  a bare state code or a city the title already names is never the heading
 *   P1-4  every kind's caveat is in the email whenever a card of that kind is (closing line per kind, per-card line for all but permits)
 *   P2-6  every text element of the rendered email is at least 4.5:1, in light and in dark mode
 *   P2-7  subjects that match the record, never "at" a city, never cut mid-word, short where the record allows
 *   P2-8, P2-9, P2-10 and the P3s; the trade-level waitlist confirmation; the Spanish unsubscribe pages
 * The quiet-week sender (P1-5) is in tests/email/quiet-week.test.ts.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SUPPORT_EMAIL = 'help@localholler.com';
});
vi.mock('server-only', () => ({}));
vi.mock('@/app/app/actions', () => ({ setMatchStatus: async () => ({ ok: true }), getRequestReplyStates: async () => ({}), submitFeedback: async () => ({ ok: true }) }));

import { cardIdFromHash, createCardLinkHandler, Feed, type FeedItem } from '@/components/feed';
import { nextWithCardHash } from '@/components/auth-forms';
import { digestAction, digestHonesty, digestPlace, digestSubject, digestWhat, renderDigest, renderWaitlistConfirm, type DigestItem } from '@/lib/email/templates';
import { digestDarkModeCss } from '@/lib/email/theme';
import { approxLocationNote } from '@/lib/signals/approx-location';
import { briefFamilyOf } from '@/lib/signals/brief';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { spanishProblems } from '@/lib/i18n/rules';
import { joinWaitlist } from '@/lib/waitlist/service';
import { isServedZip } from '@/lib/check/coverage';
import { coverageFor } from '@/lib/check/cells';
import { lookupZip } from '@/lib/geo';
import { fakeWaitlist, UNSERVED_ZIP } from '../waitlist/helpers';

const NOW = new Date('2026-11-23T14:00:00Z');
const APP = 'https://localholler.com/app';
const UNSUB = 'https://localholler.com/api/cron/notify/unsubscribe?t=abc';
const render = (items: DigestItem[], over: Partial<Parameters<typeof renderDigest>[0]> = {}) =>
  renderDigest({ businessName: 'Acme Co', items, appUrl: APP, unsubscribeUrl: UNSUB, now: NOW, ...over });
const at = '2026-11-21T12:00:00+00:00';

// Real record shapes from gates/r19 data/signals-14d.json (titles, summaries and places as stored).
const SF_311: DigestItem = { kind: 'civic', matchId: 11, source: 'socrata-sf-311', subtype: '311', title: '311 request in San Francisco: Graffiti Private', summary: 'Graffiti Private | not_offensive', place: 'San Francisco, CA', occurredAt: at, sourceUrl: 'https://data.sfgov.org/d/vw6y-z8j6', label: 'coming_soon', trade: 'painting' };
const NWS_CO: DigestItem = { kind: 'alert', matchId: 12, source: 'nws', subtype: null, title: 'Winter Storm Warning: Central Colorado Mountains', summary: 'Heavy snow expected.', place: 'CO', occurredAt: at, sourceUrl: 'https://api.weather.gov/alerts/x', label: 'coming_soon', trade: 'landscaping' };
const QUAKE: DigestItem = { kind: 'quake', matchId: 13, source: 'usgs', subtype: null, title: 'M3.8 earthquake 244 km WSW of Adak, Alaska', summary: null, place: 'AK', occurredAt: at, sourceUrl: 'https://earthquake.usgs.gov/x', label: 'coming_soon', trade: 'restoration' };
const CHI_PAINT_VIOLATION: DigestItem = { kind: 'civic', matchId: 14, source: 'socrata-chicago-violations', subtype: 'violation', title: 'Code violation in Chicago: FLAKY INTERIOR PAINT', summary: 'FLAKY INTERIOR PAINT | OPEN | 2000 block of N KILPATRICK AVE', place: 'Chicago, IL', occurredAt: at, sourceUrl: 'https://data.cityofchicago.org/d/22u3-xenr', label: 'coming_soon', trade: 'painting' };
const FED_BID: DigestItem = { kind: 'contract', matchId: 15, source: 'sam-gov', subtype: null, title: 'Federal bid in Tulsa, OK: CNG Afton and Bluff Landing PUA Tree Removal', summary: 'S222--Sources Sought | Tree removal', place: 'Tulsa, OK', occurredAt: at, sourceUrl: 'https://sam.gov/opp/x', label: 'coming_soon', trade: 'landscaping' };
const FED_BID_UPPER: DigestItem = { ...FED_BID, matchId: 16, title: 'Federal bid in PHILADELPHIA, PA: 16--GENERATOR CONTROL U, IN REPAIR/MODIFICATION OF', place: 'Philadelphia, PA' };
const SALE: DigestItem = { kind: 'civic', matchId: 17, source: 'socrata-chicago-sales', subtype: 'sale', title: 'Home sold in Chicago, IL', summary: 'Price band: $250k to $500k | Single-family home | 3400 block of N Lakewood Ave', place: 'Chicago, IL', occurredAt: at, sourceUrl: 'https://datacatalog.cookcountyil.gov/d/x', label: 'coming_soon', trade: 'landscaping' };
const COMMERCIAL_SALE: DigestItem = { ...SALE, matchId: 18, title: 'Commercial property sold in Chicago, IL', summary: 'Price band: $1M to $2.5M | Commercial property | 1200 block of W Fulton Market', trade: 'janitorial-commercial' };
const HAIL: DigestItem = { kind: 'report', matchId: 19, source: 'spc', subtype: null, title: '1.75 inch hail reported near 2 ESE Longview, TX', summary: 'HAIL | Ping pong sized hail', place: 'Longview, TX', occurredAt: at, sourceUrl: 'https://www.spc.noaa.gov/x', label: 'act_now', trade: 'siding-gutters' };
const BUSINESS: DigestItem = { kind: 'civic', matchId: 20, source: 'socrata-chicago-business', subtype: 'business', title: 'New business license in Chicago: Retail Food Establishment', summary: null, place: 'Chicago, IL', occurredAt: at, sourceUrl: 'https://data.cityofchicago.org/d/x', label: 'coming_soon', trade: 'cleaning' };
const POST: DigestItem = { kind: 'ask', matchId: 21, source: 'bluesky', subtype: null, title: 'Anyone know a good roofer in Decatur?', summary: 'Anyone know a good roofer in Decatur? Our roof is leaking.', place: 'Decatur, GA', occurredAt: at, sourceUrl: 'https://bsky.app/profile/x/post/1', label: 'act_now', trade: 'roofing' };
const REQUEST: DigestItem = { kind: 'ask', matchId: 22, source: 'holler-request', subtype: null, title: 'Service request in Atlanta: Roofing', summary: null, place: 'Atlanta, GA', occurredAt: at, sourceUrl: 'https://localholler.com/request', label: 'act_now', trade: 'roofing', detail: 'Roof leak over the kitchen.' };
const PERMIT: DigestItem = { kind: 'permit', matchId: 23, source: 'arcgis-atlanta-permits', subtype: 'permit', title: 'Roof and remodel permit in Atlanta', summary: 'Residential Alteration | 771 PALATINE SE, ATLANTA, GA 30316', place: 'Atlanta, GA', occurredAt: at, sourceUrl: 'https://services5.arcgis.com/x', label: 'coming_soon', trade: 'painting' };
const NEW_BUILD: DigestItem = { kind: 'permit', matchId: 24, source: 'socrata-nola-permits', subtype: 'permit', title: 'New construction permit in New Orleans', summary: 'New Construction | Permit Issued | $2,960,343 job value | 1600 Magazine St', place: 'New Orleans, LA', occurredAt: at, sourceUrl: 'https://data.nola.gov/x', label: 'coming_soon', trade: 'landscaping', jobValue: 2960343 };
const NEW_HOME: DigestItem = { ...NEW_BUILD, matchId: 25, title: 'New home permit in Cobb County', summary: 'New Home | $609,273 job value | 5900 SPARROW WAY | Cobb County', place: approxLocationNote({ city: 'Cobb County', source: 'arcgis-cobb-residential-permits', subtype: 'permit' }), source: 'arcgis-cobb-residential-permits' };
const SEWER_311: DigestItem = { kind: 'civic', matchId: 26, source: 'socrata-nyc-311', subtype: '311', title: '311 request in New York City: sewage_back-up_discharge', summary: null, place: 'New York City, NY', occurredAt: at, sourceUrl: 'https://data.cityofnewyork.us/x', label: 'coming_soon', trade: 'plumbing' };
const EVENT: DigestItem = { kind: 'civic', matchId: 27, source: 'socrata-nyc-events', subtype: 'event-permit', title: 'Permitted event in New York City: Religious Event at 147 LEE AVENUE between HEWES STREET and PENN STREET', summary: null, place: 'New York City, NY', occurredAt: at, sourceUrl: 'https://data.cityofnewyork.us/x', label: 'coming_soon', trade: 'event-services' };
const DISASTER: DigestItem = { kind: 'disaster', matchId: 28, source: 'fema', subtype: null, title: 'Major Disaster Declaration: Severe Storms (Fulton County, GA)', summary: 'DR-4899 | Severe Storm', place: 'GA', occurredAt: at, sourceUrl: 'https://www.fema.gov/disaster/4899', label: 'coming_soon', trade: 'restoration' };
const fam = (it: DigestItem) => briefFamilyOf({ source: it.source ?? '', kind: it.kind, subtype: it.subtype, title: it.title, summary: it.summary });

describe('P1-1: the one action of a card always leads to something about that card', () => {
  it('request: reply; weather, storm, disaster, earthquake: the storm hanger, whatever the trade', () => {
    expect(digestAction(REQUEST, APP)).toEqual({ href: `${APP}#card-22`, label: 'Reply to this request' });
    for (const it of [NWS_CO, QUAKE, HAIL, DISASTER, { ...NWS_CO, trade: 'siding-gutters' }, { ...HAIL, trade: 'landscaping' }]) {
      expect(digestAction(it, APP), it.title).toEqual({ href: `${APP}/lists/door-hanger?storm=1`, label: 'Print a storm door hanger' });
    }
  });

  it('a block-level violation, 311 row or sale prints the door hanger, never the trade\'s permit list', () => {
    for (const it of [CHI_PAINT_VIOLATION, SALE, { ...SF_311, summary: 'Graffiti Private | 1500 block of MISSION ST' }]) {
      expect(digestAction(it, APP), it.title).toEqual({ href: `${APP}/lists/door-hanger`, label: 'Print a door hanger' });
    }
  });

  it('a bid, a new business, a public post, an award and a 311 row with no block open their own card', () => {
    for (const it of [FED_BID, BUSINESS, POST, SF_311, { ...FED_BID, source: 'usaspending', kind: 'contract', title: 'Federal contract ($256K) in Duluth, MN: NAICS 562991', place: 'Duluth, MN' }]) {
      expect(digestAction(it, APP), it.title).toEqual({ href: `${APP}#card-${it.matchId}`, label: 'Open this card' });
    }
  });

  it('"Print the <trade> address list" is only ever a building permit whose address could not be read', () => {
    expect(digestAction(PERMIT, APP)).toEqual({ href: `${APP}#card-23`, label: 'Open this card' });
    expect(digestAction({ ...PERMIT, summary: 'Residential Alteration' }, APP)).toEqual({ href: `${APP}/lists/area?trade=painting`, label: 'Print the painting address list' });
    const all = [SF_311, NWS_CO, QUAKE, CHI_PAINT_VIOLATION, FED_BID, SALE, COMMERCIAL_SALE, HAIL, BUSINESS, POST, REQUEST, SEWER_311, EVENT, DISASTER];
    for (const it of all) for (const trade of ['painting', 'landscaping', 'lawn-care', 'siding-gutters', 'cleaning', 'moving', 'real-estate']) {
      expect(digestAction({ ...it, trade }, APP).href, `${it.title} ${trade}`).not.toContain('/lists/area');
    }
  });

  it('the San Francisco painter\'s 311 cards and the Chicago paint violation no longer say "Print the painting address list"', () => {
    const { html, text } = render([SF_311, { ...SF_311, matchId: 31 }, CHI_PAINT_VIOLATION]);
    expect(html + text).not.toContain('Print the painting address list');
  });

  it('a negative or zero match id is not an anchor', () => {
    expect(digestAction({ ...SF_311, matchId: -4 }, APP).href).toBe(APP);
    expect(digestAction({ ...SF_311, matchId: 0 }, APP).href).toBe(APP);
  });
});

describe('P1-3: the heading is never a bare state code or a city the title already names', () => {
  it('a weather alert stored with only a state, and an earthquake, are headed by their own title', () => {
    expect(digestPlace(NWS_CO)).toEqual({ text: 'Winter Storm Warning: Central Colorado Mountains', exact: false, kind: 'title' });
    expect(digestPlace(QUAKE).text).toBe('M3.8 earthquake 244 km WSW of Adak, Alaska');
    expect(digestPlace(DISASTER).kind).toBe('title');
  });

  it('a 311 row, a federal bid and a new business whose title names the city are headed by the title, in any letter case', () => {
    expect(digestPlace(SF_311)).toMatchObject({ text: '311 request in San Francisco: Graffiti Private', kind: 'title' });
    expect(digestPlace(FED_BID_UPPER).kind).toBe('title');
    expect(digestPlace(BUSINESS).kind).toBe('title');
    // Spanish: the localized title is checked too
    expect(digestPlace(SF_311, 'es').kind).toBe('title');
  });

  it('a city the title does not name is still a heading, and the subject says "in", never "at"', () => {
    const odd = { ...FED_BID, title: 'Federal bid: Snow Plowing and Ice Removal', place: 'Irvine, PA' };
    expect(digestPlace(odd)).toEqual({ text: 'Irvine, PA', exact: false, kind: 'place' });
    expect(digestSubject([odd], 1)).toBe('Federal bid in Irvine, PA');
    expect(digestSubject([odd], 1, 'es')).toBe('Licitación federal en Irvine, PA');
  });

  it('no subject reads "at <state>" or "at <city, ST>" for a city-wide record', () => {
    for (const it of [SF_311, NWS_CO, QUAKE, FED_BID, BUSINESS, DISASTER, SEWER_311]) {
      for (const n of [1, 4, 12]) {
        const s = digestSubject([it], n);
        expect(s, s).not.toMatch(/ at [A-Z]{2}\b| at [A-Z][a-z]+(?: [A-Z][a-z]+)*, [A-Z]{2}\b/);
      }
    }
  });
});

describe('P1-4: every kind\'s caveat is in the email whenever a card of that kind is', () => {
  const EVERY = [SF_311, NWS_CO, QUAKE, CHI_PAINT_VIOLATION, FED_BID, SALE, HAIL, BUSINESS, POST, REQUEST, PERMIT, DISASTER, EVENT];

  it('every card but a building permit carries its own uncertainty line, in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      for (const it of EVERY) {
        const { text } = render([it], { lang });
        const card = text.split('\n\n').find((b) => /^1\. /.test(b))!;
        if (fam(it) === 'permit') expect(card, it.title).not.toMatch(/confidence|confianza/i);
        else expect(card, `${lang} ${it.title}`).toMatch(lang === 'en' ? /\n {3}(High|Medium|Low) confidence .+;.+\./ : /\n {3}.*confianza.+/i);
      }
    }
  });

  it('the closing line has one sentence per kind present, and nothing about kinds that are absent', () => {
    const line = digestHonesty(EVERY);
    for (const k of ['permit', 'violation', '311', 'bid', 'business', 'request', 'weather'] as const) expect(line, k).toContain(en[`email.honesty.${k}`]);
    expect(digestHonesty([PERMIT])).toBe(`${en['email.honesty.opening']} ${en['email.honesty.permit']}`);
    expect(digestHonesty([SF_311])).toBe(`${en['email.honesty.opening']} ${en['email.honesty.311']}`);
    expect(digestHonesty([HAIL, QUAKE])).toBe(`${en['email.honesty.opening']} ${en['email.honesty.weather']}`);
    expect(digestHonesty([EVENT])).toBe(en['email.honesty.opening']);
  });

  it('with a resident request or a public post in the email, the closing line does not claim every card is a public record with a source link', () => {
    for (const mix of [[REQUEST], [POST], [PERMIT, POST], [REQUEST, SF_311]]) {
      const line = digestHonesty(mix);
      expect(line).not.toContain('Every card comes from a public record');
      expect(line.startsWith(en['email.honesty.opening_mixed'])).toBe(true);
      expect(line).toContain(en['email.honesty.request']);
      expect(digestHonesty(mix, 'es').startsWith(es['email.honesty.opening_mixed'])).toBe(true);
    }
  });

  it('every new sentence has Spanish that breaks no wording rule and says weather damage is not confirmed', () => {
    for (const k of Object.keys(en).filter((x) => x.startsWith('email.honesty.'))) {
      const v = (es as Record<string, string>)[k];
      expect(v, k).toBeTruthy();
      expect(spanishProblems(v), k).toEqual([]);
    }
    expect(es['email.honesty.weather']).toMatch(/no confirmado/);
    expect(en['email.honesty.weather']).toContain('damage is not confirmed');
  });
});

describe('P2-7: subjects that match the record', () => {
  it('"New home permit" only for a new home; new construction says so; a federal notice is a federal bid unless it is open; a commercial sale is a property sale', () => {
    expect(digestWhat(NEW_HOME)).toBe('New home permit');
    expect(digestWhat(NEW_BUILD)).toBe('New construction permit');
    expect(digestWhat(NEW_BUILD, 'es')).toBe('Permiso de construcción nueva');
    expect(digestSubject([NEW_BUILD], 1)).toBe('New construction permit at 1600 Magazine St');
    expect(digestWhat(FED_BID)).toBe('Federal bid');
    expect(digestWhat({ ...FED_BID, label: 'act_now' })).toBe('Open bid');
    expect(digestWhat(COMMERCIAL_SALE)).toBe('Property sale');
    expect(digestWhat(SALE)).toBe('Home sale');
    expect(digestSubject([COMMERCIAL_SALE], 1)).toBe('Property sale at 1200 block of W Fulton Market');
  });

  it('a long title is cut at a word with "…", the (+N more) count is kept, and the subject is at most 50 where the record allows', () => {
    const county = { ...NWS_CO, title: 'Severe Thunderstorm Warning: Cobb, GA; Cherokee, GA; Fulton, GA; Paulding, GA; Bartow, GA; Douglas, GA; Carroll, GA; Haralson…', place: 'GA' };
    for (const n of [1, 2, 12]) {
      const s = digestSubject([county], n);
      expect(s.length, s).toBeLessThanOrEqual(50);
      if (n > 1) expect(s).toMatch(new RegExp(`\\(\\+${n - 1} more\\)$`));
      const body = s.replace(/ \(\+\d+ more\)$/, '').replace(/…$/, '');
      // the cut subject is the start of the title and ends at a word boundary
      expect(county.title.startsWith(body), s).toBe(true);
      expect(county.title.charAt(body.length), s).toMatch(/^[\s,;…]$/);
    }
    // a 311 subject that would pass 50 says what and where instead of cutting the title
    expect(digestSubject([SF_311], 10)).toBe('311 request in San Francisco, CA (+9 more)');
    // an address or a block is never shortened, even past 50
    const longBlock = { ...CHI_PAINT_VIOLATION, summary: 'X | OPEN | 4500 block of E BEN WHITE BLVD SERVICE ROAD' };
    expect(digestSubject([longBlock], 12)).toBe('Code violation at 4500 block of E BEN WHITE BLVD SERVICE ROAD (+11 more)');
  });

  it('over all the shapes above, in both languages: never over 120, never ending mid-word before the count', () => {
    for (const lang of ['en', 'es'] as const) for (const it of [SF_311, NWS_CO, QUAKE, CHI_PAINT_VIOLATION, FED_BID, FED_BID_UPPER, SALE, COMMERCIAL_SALE, HAIL, BUSINESS, POST, REQUEST, PERMIT, NEW_BUILD, NEW_HOME, SEWER_311, EVENT, DISASTER]) {
      for (const n of [1, 3, 120]) {
        const s = digestSubject([it], n, lang);
        expect(s.length).toBeLessThanOrEqual(120);
        expect(s.trim()).not.toBe('');
        if (n > 1) expect(s).toMatch(lang === 'en' ? /\(\+\d+ more\)$/ : /\(\+\d+ más\)$/);
      }
    }
  });
});

describe('P2-8, P2-10 and the P3s', () => {
  it('an approximate-location note is neither a heading nor on the meta line, and the text never has ".."', () => {
    const { html, text } = render([NEW_HOME]);
    expect(html).not.toContain('no distance is shown');
    expect(text).not.toMatch(/\.\.\s/);
  });

  it('Spanish: Holler\'s own words in a quoted violation order are Spanish; a city\'s own text stays as written', () => {
    const order = { kind: 'civic', matchId: 40, source: 'arcgis-dekalb-violations', subtype: 'violation', title: 'Code violation in DeKalb County: trash or debris and overgrown yard', summary: '2400 block of HARMONY RIDGE CT', place: 'DeKalb County, GA', occurredAt: at, sourceUrl: 'https://x.test/', label: 'act_now' as const, trade: 'lawn-care' };
    const { text } = render([order], { lang: 'es' });
    expect(text).not.toContain('trash or debris and overgrown yard');
    expect(text).toContain('basura o escombros');
    expect(render([CHI_PAINT_VIOLATION], { lang: 'es' }).text).toContain('FLAKY INTERIOR PAINT');
  });

  it('a house number in the title of a record that is not a building permit is printed as its hundred-block, everywhere', () => {
    const { html, text, subject } = render([EVENT]);
    for (const out of [html, text, subject]) expect(out).not.toContain('147 LEE AVENUE');
    expect(text).toContain('100 block of LEE AVENUE');
    expect(render([EVENT], { lang: 'es' }).text).toContain('cuadra 100 de LEE AVENUE');
    // numbered streets with no house number are left alone
    expect(render([{ ...EVENT, title: 'Permitted event in New York City: Street Event at 41 AVENUE between 103 STREET and 104 STREET' }]).text).toContain('41 AVENUE between 103 STREET');
    // a building permit keeps its exact address
    expect(render([PERMIT]).text).toContain('771 PALATINE SE');
  });

  it('raw underscore codes are spaced, a stored cut ends at a whole item, bidi overrides are dropped, and a long token wraps', () => {
    expect(render([SEWER_311]).text).toContain('sewage back-up discharge');
    const cut = { ...NWS_CO, title: 'Flood Watch: Coastal Duval; Eastern Clay; Eastern Putnam; Trout River; Western Clay; Western Putnam; S…' };
    expect(digestPlace(cut).text).toBe('Flood Watch: Coastal Duval; Eastern Clay; Eastern Putnam; Trout River; Western Clay; Western Putnam…');
    const evil = render([{ ...REQUEST, detail: 'call ‮evil‬ now https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }]);
    expect(evil.html + evil.text).not.toMatch(/[‪-‮⁦-⁩]/);
    expect(evil.html).toContain('overflow-wrap:anywhere;word-break:break-word');
  });

  it('a record with no title still has a heading and a subject', () => {
    const blank = { ...SF_311, title: '', place: null };
    expect(digestPlace(blank).text).toBe('311 request');
    expect(digestSubject([blank], 1)).toBe('311 request');
  });
});

describe('P2-9: Outlook on Windows', () => {
  it('every card button carries its padding on the table cell, not on the link; the cards are not a <ul>', () => {
    const { html } = render([SF_311, PERMIT, HAIL, REQUEST]);
    const cells = [...html.matchAll(/<td class="h-btn" style="([^"]+)"><a href="[^"]+" style="([^"]+)">/g)];
    expect(cells).toHaveLength(4);
    for (const [, td, a] of cells) {
      expect(td).toContain('padding:13px 20px');
      expect(a).toMatch(/^display:block;/);
      expect(a).not.toMatch(/padding/);
      expect(a).toContain('line-height:18px');
    }
    expect(html).not.toMatch(/<ul|<li/);
    expect(html.match(/<div role="listitem"/g)).toHaveLength(4);
    expect(html).toContain('<div role="list"');
  });
});

// ---- P2-6: contrast of every text element of the rendered email, light and dark -----------------------------------------------------

type El = { tag: string; style: Record<string, string>; classes: string[]; parent: El | null };
const lum = (hex: string) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const decls = (s: string) => Object.fromEntries(s.split(';').map((d) => d.split(':')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join(':').replace(/!important/, '').trim()]));
/** The dark rules of digestDarkModeCss as [selector, declarations], in order. Selectors: ".a", ".a > p", ".a b". */
const darkRules = (): [string, Record<string, string>][] => {
  const css = digestDarkModeCss();
  const body = css.slice(css.indexOf('{', css.indexOf('@media')) + 1);
  return [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) => m[1].split(',').map((sel) => [sel.trim(), decls(m[2])] as [string, Record<string, string>]));
};
const matches = (el: El, sel: string): boolean => {
  const parts = sel.split(/\s+/).filter((p) => p !== '>');
  const child = sel.includes('>');
  const self = parts[parts.length - 1];
  const okSelf = (e: El, s: string) => (s.startsWith('.') ? e.classes.includes(s.slice(1)) : e.tag === s);
  if (!okSelf(el, self)) return false;
  if (parts.length === 1) return true;
  if (child) return !!el.parent && okSelf(el.parent, parts[0]);
  for (let p = el.parent; p; p = p.parent) if (okSelf(p, parts[0])) return true;
  return false;
};
/** Each run of visible text with the colour and background it is painted with, in light (inline styles only) and dark mode. */
function paints(html: string, dark: boolean): { text: string; fg: string; bg: string }[] {
  const rules = dark ? darkRules() : [];
  const own = (el: El, prop: 'color' | 'background'): string | null => {
    let v: string | null = null;
    const inline = prop === 'color' ? el.style.color : (el.style.background ?? el.style['background-color']);
    if (inline && /^#[0-9A-Fa-f]{6}$/.test(inline.split(' ')[0])) v = inline.split(' ')[0];
    for (const [sel, d] of rules) if (matches(el, sel) && d[prop]) v = d[prop];
    return v;
  };
  const resolve = (el: El | null, prop: 'color' | 'background', fallback: string) => {
    for (let e = el; e; e = e.parent) {
      const v = own(e, prop);
      if (v) return v;
    }
    return fallback;
  };
  const out: { text: string; fg: string; bg: string }[] = [];
  let cur: El | null = null;
  const body = html.replace(/<style>[\s\S]*?<\/style>/, '');
  const VOID = new Set(['img', 'br', 'input', 'meta']);
  for (const m of body.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      const text = m[4].replace(/&nbsp;|&middot;|\s/g, '');
      if (text) out.push({ text: m[4].trim(), fg: resolve(cur, 'color', '#000000'), bg: resolve(cur, 'background', '#FFFFFF') });
    } else if (m[1]) {
      cur = (cur as El | null)?.parent ?? null;
    } else if (!VOID.has(m[2].toLowerCase())) {
      const style = decls(/style="([^"]*)"/.exec(m[3])?.[1] ?? '');
      const classes = (/class="([^"]*)"/.exec(m[3])?.[1] ?? '').split(/\s+/).filter(Boolean);
      cur = { tag: m[2].toLowerCase(), style, classes, parent: cur };
    }
  }
  return out;
}

describe('P2-6: every text element is at least 4.5:1, in light and in dark mode', () => {
  const emails = [
    render([SF_311, NWS_CO, CHI_PAINT_VIOLATION, FED_BID, SALE, HAIL, BUSINESS, POST, { ...PERMIT, contact: { name: 'Peachtree Roofing LLC', role: 'Named on this permit', listing: { phone: '404-555-0123', website: { href: 'https://peachtree.example/', text: 'peachtree.example' }, note: 'n' } } }, REQUEST], { totalCount: 14 }),
    render([REQUEST, PERMIT], { lang: 'es' }),
    render([], { matchedLastWeek: 0 }),
    render([], { matchedLastWeek: 3, lang: 'es' }),
  ];

  it('the mailto link, the eyebrow and the feed button are classed for dark mode', () => {
    const { html } = emails[0];
    expect(html).toMatch(/<p class="h-link"[^>]*>Holler for Acme Co<\/p>/);
    expect(html).toMatch(/<a class="h-link" href="mailto:help@localholler\.com"/);
    expect(html).toMatch(/<a class="h-cta" href="https:\/\/localholler\.com\/app"/);
    expect(digestDarkModeCss()).toMatch(/\.h-cta\{background:#2E5A41 !important;color:#F5F4EF !important;border:1px solid #9FD6B4 !important\}/);
  });

  for (const dark of [false, true]) {
    it(`${dark ? 'dark' : 'light (also: the email with its style block removed)'}: every run of text, including the eyebrow, "Contact us" and the button labels`, () => {
      let n = 0;
      for (const { html } of emails) {
        const runs = paints(html, dark);
        expect(runs.length).toBeGreaterThan(10);
        for (const r of runs) {
          n++;
          expect(ratio(r.fg, r.bg), `${dark ? 'dark' : 'light'}: "${r.text.slice(0, 40)}" ${r.fg} on ${r.bg}`).toBeGreaterThanOrEqual(4.5);
        }
        // the runs the review found unreadable in dark mode are among those checked
        if (dark && html === emails[0].html) {
          for (const t of ['Holler for Acme Co', 'Contact us', 'See all your matches']) expect(runs.some((r) => r.text.includes(t)), t).toBe(true);
        }
      }
      expect(n).toBeGreaterThan(100);
    });
  }

  it('dark mode: the feed button has a visible fill against the dark card (its edge is at least 3:1)', () => {
    const rule = darkRules().find(([s]) => s === '.h-cta')![1];
    expect(ratio(rule.border.split(' ').pop()!, '#17211C')).toBeGreaterThanOrEqual(3);
    expect(ratio(rule.color, rule.background)).toBeGreaterThanOrEqual(4.5);
  });
});

// ---- P1-2: the deep link ----------------------------------------------------------------------------------------------------------

const feedItem = (id: number, status: FeedItem['status'] = 'new'): FeedItem => ({ id, status, kind: 'permit', source: 'arcgis-atlanta-permits', title: `Roof permit ${id}`, summary: null, url: null, distance: null, place: 'Atlanta, GA', ago: '1d', occurredAt: at, draft: null });

describe('P1-2: the feed answers /app#card-<match id>, including when the list arrives late', () => {
  const harness = (hash: string) => {
    const log: string[] = [];
    const frames: (() => void)[] = [];
    const handler = createCardLinkHandler({
      hash: () => hash,
      showClosed: () => log.push('showClosed'),
      scrollTo: (id) => log.push(`scroll ${id}`),
      setMissing: (id) => log.push(`missing ${id}`),
      nextFrame: (fn) => frames.push(fn),
    });
    const flush = () => {
      while (frames.length) frames.shift()!();
    };
    return { log, handler, flush };
  };

  it('reads only #card-<positive integer>', () => {
    expect(cardIdFromHash('#card-40')).toBe(40);
    for (const h of ['', '#card-', '#card-0', '#card--3', '#card-4x', '#cards-4', '#card-12345678901234567890']) expect(cardIdFromHash(h), h).toBeNull();
  });

  it('streaming: the list is empty at first, then arrives: no scroll before it, one scroll after it, painted first', () => {
    const { log, handler, flush } = harness('#card-40');
    handler([]); // the Suspense fallback: no cards yet
    flush();
    expect(log).toEqual(['missing 40']);
    const list = Array.from({ length: 60 }, (_, i) => feedItem(i + 1));
    handler(list); // the streamed chunk with the cards
    expect(log).toEqual(['missing 40', 'missing null']); // nothing scrolled before React has painted the card
    flush();
    expect(log).toEqual(['missing 40', 'missing null', 'scroll 40']);
    handler(list); // a later refresh of the same list never scrolls the member away again
    handler([...list]);
    flush();
    expect(log.filter((l) => l.startsWith('scroll'))).toEqual(['scroll 40']);
  });

  it('a closed card ticks "show closed" before the scroll', () => {
    const { log, handler, flush } = harness('#card-7');
    handler([feedItem(6), feedItem(7, 'dismissed')]);
    flush();
    expect(log).toEqual(['missing null', 'showClosed', 'scroll 7']);
  });

  it('a card that is not loaded (older than the newest 100, or closed and filtered out) shows the notice and keeps it until the card arrives', () => {
    const { log, handler, flush } = harness('#card-999');
    handler(Array.from({ length: 100 }, (_, i) => feedItem(i + 1)));
    flush();
    expect(log).toEqual(['missing 999']);
  });

  it('no card hash: nothing happens, ever', () => {
    const { log, handler, flush } = harness('#top');
    handler([feedItem(1)]);
    handler([feedItem(1)]);
    flush();
    expect(log).toEqual([]);
  });

  it('the notice is one plain sentence in both languages; the server render is unchanged (no notice, every card anchored by match id)', () => {
    for (const lang of ['en', 'es'] as const) {
      const v = (lang === 'en' ? en : es)['card.link_missing'];
      expect(v.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length).toBe(1);
      if (lang === 'es') expect(spanishProblems(v)).toEqual([]);
    }
    const html = renderToStaticMarkup(createElement(Feed, { items: [feedItem(5), feedItem(6, 'done')], cityPage: null }));
    expect(html).not.toContain('card-link-missing');
    expect(html).toContain('id="card-5"');
  });

  it('log-in keeps the card anchor the proxy redirect carried to the login page, and nothing else', () => {
    expect(nextWithCardHash('/app', '#card-123')).toBe('/app#card-123');
    expect(nextWithCardHash('/app/settings', '')).toBe('/app/settings');
    expect(nextWithCardHash('/app', '#top')).toBe('/app');
    expect(nextWithCardHash('/app', '#card-1"><script>')).toBe('/app');
    expect(nextWithCardHash('/app#card-1', '#card-2')).toBe('/app#card-1');
  });
});

// ---- waitlist confirmation and unsubscribe pages ---------------------------------------------------------------------------------

describe('the waitlist confirmation names the trade when Holler already reads the place', () => {
  it('one trade in a served place: "when Holler has lawn care work near Dallas, TX", EN and ES', () => {
    const m = renderWaitlistConfirm({ confirmUrl: 'https://localholler.com/waitlist/confirm?token=a.b', place: 'Dallas, TX', trade: 'lawn-care' });
    expect(m.subject).toBe('Confirm: tell me when Holler has lawn care work near Dallas, TX');
    expect(m.text).toContain('You asked Holler to tell you when it has lawn care work near Dallas, TX.');
    expect(m.subject + m.text).not.toContain('reaches');
    const e = renderWaitlistConfirm({ confirmUrl: 'https://localholler.com/waitlist/confirm?token=a.b', place: 'Dallas, TX', trade: 'lawn-care', lang: 'es' });
    expect(e.subject).toBe('Confirme: avísenme cuando Holler tenga trabajo de cuidado del césped cerca de Dallas, TX');
    expect(spanishProblems(e.subject + e.text)).toEqual([]);
    // an acronym trade keeps its capitals
    const hvac = renderWaitlistConfirm({ confirmUrl: 'https://x.test/', place: 'Dallas, TX', trade: 'hvac' }).subject;
    expect(hvac).toContain('(HVAC) work near Dallas, TX');
    expect(hvac).not.toContain('hVAC');
  });

  it('the sign-up passes the trade only when the ZIP is one Holler serves (a trade-level waitlist), never for an unserved ZIP', async () => {
    // a served ZIP whose cell for some trade is 'waitlist' on /check (Dallas lawn care, per tests/email/int24-coherence.test.ts)
    let pair: { zip: string; trade: string } | null = null;
    for (const zip of ['75201', '75204', '75219', '75206']) {
      const place = lookupZip(zip);
      if (!place || !isServedZip(place)) continue;
      for (const trade of ['lawn-care', 'landscaping', 'pool-spa', 'snow-removal', 'fencing']) if (!pair && coverageFor(place, trade, true).state === 'waitlist') pair = { zip, trade };
    }
    expect(pair, 'a served ZIP with a waitlist trade').not.toBeNull();
    const served = fakeWaitlist();
    expect(await joinWaitlist(served.deps, { email: 'pat@example.com', zip: pair!.zip, trade: pair!.trade, page: 'check', ip: '203.0.113.9' })).toEqual({ code: 'ok' });
    expect(served.sent[0]).toMatchObject({ trade: pair!.trade });
    const unserved = fakeWaitlist();
    expect(await joinWaitlist(unserved.deps, { email: 'pat@example.com', zip: UNSERVED_ZIP, trade: 'roofing', page: 'check', ip: '203.0.113.9' })).toEqual({ code: 'ok' });
    expect(unserved.sent[0]).toMatchObject({ trade: null });
  });

  it('a place Holler does not serve yet: the round 19 email, byte for byte', () => {
    const before = renderWaitlistConfirm({ confirmUrl: 'https://localholler.com/waitlist/confirm?token=a.b', place: 'Billings, MT' });
    expect(renderWaitlistConfirm({ confirmUrl: 'https://localholler.com/waitlist/confirm?token=a.b', place: 'Billings, MT', trade: null })).toEqual(before);
    expect(before.subject).toBe('Confirm: tell me when Holler reaches Billings, MT');
  });
});

describe('the unsubscribe pages speak Spanish when the member does, and English pages keep their bytes', () => {
  const SECRET = 'unit-test-secret-not-real';
  const UID = '11111111-1111-4111-8111-111111111111';

  async function routes(language: string | null | 'error') {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({ env: new Proxy({}, { get: (_t, k) => (k === 'CRON_SECRET' ? SECRET : undefined) }), siteUrl: 'https://localholler.com' }));
    const reads: string[] = [];
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          const q: Record<string, unknown> = {};
          for (const m of ['select', 'eq', 'upsert', 'update']) q[m] = (...a: unknown[]) => (m === 'select' && reads.push(`${table}:${a[0]}`), q);
          q.limit = async () => (language === 'error' ? { data: null, error: { code: '42703', message: 'column language does not exist' } } : { data: [{ language }], error: null });
          q.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
          return q;
        },
      }),
    }));
    const token = await import('@/lib/email/token');
    const life = await import('@/lib/lifecycle/unsub');
    const alerts = await import('@/app/api/cron/notify/unsubscribe/route');
    const trial = await import('@/app/api/cron/lifecycle/unsubscribe/route');
    const page = (await import('@/lib/email/html-page')).htmlPage;
    vi.doUnmock('@/lib/env');
    vi.doUnmock('@/lib/supabase/admin');
    return { alerts, trial, page, alertToken: token.signUnsubscribeToken(UID, SECRET), trialToken: life.signLifecycleUnsub(UID, SECRET), reads };
  }

  it('English member: the GET pages are exactly the pages the old literal strings made', async () => {
    const r = await routes('en');
    const a = await (await r.alerts.GET(new Request(`https://x.test/api/cron/notify/unsubscribe?t=${encodeURIComponent(r.alertToken)}`))).text();
    const old = await r.page('Turn off email alerts?', 'You will stop getting Holler emails. You can turn them back on in settings any time.', {
      form: { action: `/api/cron/notify/unsubscribe?t=${encodeURIComponent(r.alertToken)}`, button: 'Turn off email alerts', fields: { t: r.alertToken } },
      links: [{ href: '/app/settings', label: 'Email settings' }],
    }).text();
    expect(a).toBe(old);
    const tr = await (await r.trial.GET(new Request(`https://x.test/api/cron/lifecycle/unsubscribe?t=${encodeURIComponent(r.trialToken)}`))).text();
    const oldTrial = await r.page('Stop trial emails?', 'You will stop getting the short emails about your trial. Your alert emails are not affected.', {
      form: { action: `/api/cron/lifecycle/unsubscribe?t=${encodeURIComponent(r.trialToken)}`, button: 'Stop these emails', fields: { t: r.trialToken } },
      links: [{ href: '/app/settings', label: 'Email settings' }],
    }).text();
    expect(tr).toBe(oldTrial);
    const bad = await (await r.alerts.GET(new Request('https://x.test/api/cron/notify/unsubscribe?t=nope'))).text();
    expect(bad).toBe(await r.page('Link not valid', 'This unsubscribe link is not valid. You can turn off email alerts in your settings.', { status: 400, links: [{ href: '/app/settings', label: 'Email settings' }] }).text());
  });

  it('Spanish member (profiles.language): Spanish confirm page whose form carries l=es, and a Spanish answer to that POST', async () => {
    const r = await routes('es');
    for (const [route, tok, button, done] of [
      [r.alerts, r.alertToken, es['unsub.alerts.button'], es['unsub.alerts.done_h']],
      [r.trial, r.trialToken, es['unsub.trial.button'], es['unsub.trial.done_h']],
    ] as const) {
      const page = await (await route.GET(new Request(`https://x.test/u?t=${encodeURIComponent(tok)}`))).text();
      expect(page).toContain('<html lang="es">');
      expect(page).toContain(button);
      expect(page).toContain('name="l" value="es"');
      expect(spanishProblems(page.replace(/<[^>]+>/g, ' '))).toEqual([]);
      const posted = await route.POST(new Request('https://x.test/u', { method: 'POST', body: new URLSearchParams({ t: tok, l: 'es' }) }));
      expect(posted.status).toBe(200);
      expect(await posted.text()).toContain(done);
    }
    // the POST never reads the profile (only GET does)
    expect(r.reads.every((x) => x === 'holler_profiles:language')).toBe(true);
  });

  it('a link that says l=es is Spanish even with no valid token; a failed language read is English', async () => {
    const r = await routes('error');
    const bad = await (await r.alerts.GET(new Request('https://x.test/api/cron/notify/unsubscribe?t=nope&l=es'))).text();
    expect(bad).toContain(es['unsub.alerts.invalid_p']);
    const page = await (await r.alerts.GET(new Request(`https://x.test/u?t=${encodeURIComponent(r.alertToken)}`))).text();
    expect(page).toContain('Turn off email alerts?');
    expect(page).not.toContain('lang="es"');
  });
});
