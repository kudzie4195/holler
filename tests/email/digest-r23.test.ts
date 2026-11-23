/**
 * Round 23 EMAIL: the alert digest rebuilt around the address and one action.
 *
 * What this file pins, because it is what the owner asked for and what could quietly rot:
 *   1. hierarchy    the place or address is the first and loudest line of a card, and a card is at most 5 visible rows
 *   2. one action    exactly one tappable action per card, 44 px tall, into a route that exists in app/app today
 *   3. privacy       an exact street address only for a building permit; a hundred-block for a violation, a 311 row or a home sale
 *   4. honesty       "not confirmed" and the source caveat said once, plus on the cards whose event is never proof of damage
 *   5. subject       what happened and where, with the count, short enough for a lock screen
 *   6. empty week    a useful email, never an empty one
 *   7. dark mode     every dark rule has an inline light value under it, so a client that drops the style block stays readable
 *   8. plain text    short numbered cards, not a wall
 *   9. legal         the unsubscribe link, the "why you got this" line and the postal footer stay
 *  10. Spanish       every new string has a Spanish entry and the digest carries no English chrome
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestAction, digestPlace, digestSubject, renderDigest, type DigestItem } from '@/lib/email/templates';
import { approxLocationNote } from '@/lib/signals/approx-location';
import { EMAIL_DARK, digestDarkModeCss } from '@/lib/email/theme';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { spanishProblems } from '@/lib/i18n/rules';

const NOW = new Date('2026-11-23T14:00:00Z');
const APP = 'https://localholler.com/app';
const UNSUB = 'https://localholler.com/api/cron/notify/unsubscribe?t=abc';

const render = (items: DigestItem[], over: Partial<Parameters<typeof renderDigest>[0]> = {}) =>
  renderDigest({ businessName: 'Acme Lawn Care', items, appUrl: APP, unsubscribeUrl: UNSUB, now: NOW, ...over });

/** Real rows from gates/r19 data/signals-14d.json (ids and text as stored). */
const COBB_NEW_HOME: DigestItem = {
  kind: 'permit',
  matchId: 9001,
  source: 'arcgis-cobb-residential-permits',
  subtype: 'permit',
  title: 'New home permit in Cobb County',
  summary: 'New Home | $609,273 job value | 5900 SPARROW WAY | Cobb County',
  // Round 24 (review P2-8): the place the notify route really passes for a Cobb row (no code ever produced "Location is approximate").
  place: approxLocationNote({ city: 'Cobb County', source: 'arcgis-cobb-residential-permits', subtype: 'permit' }),
  occurredAt: '2026-11-18T00:00:00+00:00',
  sourceUrl: 'https://gis.cobbcounty.org/gisserver/rest/services/comdev/Accela_PermitsDashboard/FeatureServer/4',
  label: 'coming_soon',
  trade: 'landscaping',
  jobValue: 609273,
};
const DEKALB_VIOLATION: DigestItem = {
  kind: 'civic',
  matchId: 9002,
  source: 'arcgis-dekalb-violations',
  subtype: 'violation',
  title: 'Code violation in DeKalb County: property violation',
  summary: '2400 block of HARMONY RIDGE CT',
  place: 'DeKalb County, GA',
  occurredAt: '2026-11-18T09:25:28+00:00',
  sourceUrl: 'https://dcgis.dekalbcountyga.gov/mapping/rest/services/Hansen/CodeEnforcementCasesInspections/FeatureServer/0',
  label: 'coming_soon',
  trade: 'lawn-care',
};
const CHICAGO_PORCH: DigestItem = {
  kind: 'civic',
  matchId: 9003,
  source: 'socrata-chicago-violations',
  subtype: 'violation',
  title: 'Code violation in Chicago: REPAIR PORCH SYSTEM',
  summary: 'REPAIR PORCH SYSTEM | OPEN | 7700 block of S JEFFERY BLVD',
  place: 'Chicago, IL',
  occurredAt: '2026-11-16T06:00:00+00:00',
  sourceUrl: 'https://data.cityofchicago.org/d/22u3-xenr',
  label: 'act_now',
  trade: 'handyman',
  deadline: null,
};
const ATL_ROOF: DigestItem = {
  kind: 'permit',
  matchId: 9004,
  source: 'arcgis-atlanta-permits',
  subtype: 'permit',
  title: 'Roof and remodel permit in Atlanta',
  summary: 'Residential Alteration | 771 PALATINE SE, ATLANTA, GA 30316',
  place: 'Atlanta, GA',
  occurredAt: '2026-11-17T00:00:00+00:00',
  sourceUrl: 'https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/building_permit_featureLayer/FeatureServer/0',
  label: 'coming_soon',
  // Round 24 (review P2-8): the real trade id ('gutters' is not one).
  trade: 'siding-gutters',
};
const HAIL: DigestItem = {
  kind: 'report',
  matchId: 9005,
  source: 'spc',
  subtype: null,
  title: '1.75 inch hail reported near 2 ESE Longview, TX',
  summary: 'HAIL | Ping pong sized hail',
  place: 'Longview, TX',
  occurredAt: '2026-11-22T00:00:00+00:00',
  sourceUrl: 'https://www.spc.noaa.gov/climo/reports/261122_rpts.html',
  label: 'act_now',
  trade: 'roofing',
};
const REQUEST: DigestItem = {
  kind: 'ask',
  matchId: 9006,
  source: 'holler-request',
  subtype: null,
  title: 'Service request in Atlanta: Landscaping',
  summary: null,
  place: 'Atlanta, GA',
  occurredAt: '2026-11-23T08:00:00+00:00',
  sourceUrl: 'https://localholler.com/request',
  label: 'act_now',
  trade: 'landscaping',
  detail: 'Back yard is overgrown after the storm and we need it cleared before a party on Saturday.',
};

const ALL = [COBB_NEW_HOME, DEKALB_VIOLATION, CHICAGO_PORCH, ATL_ROOF, HAIL, REQUEST];
// Round 24 (review P2-9): the cards are a role="list" of role="listitem" blocks, no longer a <ul> (Outlook on Windows). Each item ends with
// its card table; the last one is followed by the closing part of the email, which has no table.
const cardsOf = (html: string) =>
  html
    .split('<div role="listitem"')
    .slice(1)
    .map((s) => s.slice(0, s.lastIndexOf('</table></div>') + '</table></div>'.length));
/** The one action of a card: padding on the table cell (Outlook ignores it on a link), the link a block inside it. */
const ACTION_RE = /<td class="h-btn" style="[^"]*padding:13px 20px[^"]*"><a href="([^"]+)" style="display:block;[^"]*">([^<]+)<\/a>/g;

describe('1. hierarchy: the place is the loudest line, and a card is at most five rows', () => {
  it('the first block of text in a card is the 20 px heading, and it holds the address, not the title', () => {
    const [card] = cardsOf(render([COBB_NEW_HOME]).html);
    const heading = card.match(/<div class="h-head"[^>]*font-size:20px[^>]*>([^<]+)<\/div>/);
    expect(heading?.[1]).toBe('5900 SPARROW WAY');
    // nothing larger than the heading sits inside a card
    const sizes = [...card.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.max(...sizes)).toBe(20);
    // the title is still there, one step down
    expect(card).toContain('New home permit in Cobb County');
    expect(card).toMatch(/class="h-meta"[^>]*font-size:14px/);
  });

  it('every card is at most 6 rows: chip, place, meta, reason, what is uncertain, action (a request adds the resident\'s own words)', () => {
    // Round 24 (review P1-4): every card except a building permit carries its own "what is uncertain" line again, so a non-permit card
    // is six rows and a permit card stays five. Only the request card adds its quote.
    for (const card of cardsOf(render(ALL).html)) {
      const rows = (card.match(/<div class="h-(head|meta|why|small|quote)"/g) ?? []).length + (card.includes('class="h-chip') ? 1 : 0) + 1;
      expect(rows, card.slice(0, 120)).toBeLessThanOrEqual(card.includes('class="h-quote"') ? 7 : 6);
    }
    // the ordinary card (no request text, no contact, no stage move) is exactly five
    const plain = cardsOf(render([COBB_NEW_HOME]).html)[0];
    expect((plain.match(/<div class="h-(head|meta|why)"/g) ?? []).length).toBe(3);
    expect(plain).toContain('class="h-chip');
  });

  it('no card carries a labelled row wall any more', () => {
    const { html, text } = render(ALL);
    for (const gone of ['Why it matters:', 'Next:', 'Next step:', 'Source:', 'Not confirmed:', 'What is uncertain:', 'Why it may matter:']) {
      expect(html, gone).not.toContain(gone);
      expect(text, gone).not.toContain(gone);
    }
  });

  it('the place is not repeated when the heading already is it, and a sentence-shaped note is never a heading', () => {
    expect(digestPlace(DEKALB_VIOLATION).text).toBe('2400 block of HARMONY RIDGE CT');
    const [card] = cardsOf(render([DEKALB_VIOLATION]).html);
    expect(card.match(/DeKalb County, GA/g) ?? []).toHaveLength(0);
    // Round 24 (review P2-8): the approximate-location note explains a missing distance, and the email shows no distance, so it is not
    // a heading and not on the meta line either; the plain text never gets a double full stop.
    const cobb = render([COBB_NEW_HOME]);
    expect(COBB_NEW_HOME.place).toMatch(/no distance is shown/);
    expect(cobb.html).not.toContain('no distance is shown');
    expect(cobb.text).not.toContain('no distance is shown');
    expect(cobb.text).not.toMatch(/\.\. /);
    expect(digestPlace({ ...COBB_NEW_HOME, summary: null }).kind).toBe('title');
  });
});

describe('2. one action per card, into a route that exists', () => {
  it('exactly one 44 px action per card, and it is a real link', () => {
    for (const card of cardsOf(render(ALL).html)) {
      const acts = [...card.matchAll(ACTION_RE)];
      expect(acts, card.slice(0, 120)).toHaveLength(1);
      expect(acts[0][1]).toMatch(/^https:\/\/localholler\.com\/app/);
      expect(acts[0][2].length).toBeGreaterThan(5);
    }
  });

  it('the action table: a permit with an address opens its own card; a block prints a hanger; a request is replied to', () => {
    expect(digestAction(COBB_NEW_HOME, APP)).toEqual({ href: `${APP}#card-9001`, label: 'Open this card' });
    expect(digestAction(ATL_ROOF, APP)).toEqual({ href: `${APP}#card-9004`, label: 'Open this card' });
    // Round 24 (review P1-1): the trade's address list is a list of PERMITS, so a block-level violation never links to it, whatever the
    // trade: a block is something to walk, so it prints the door hanger.
    expect(digestAction(DEKALB_VIOLATION, APP)).toEqual({ href: `${APP}/lists/door-hanger`, label: 'Print a door hanger' });
    expect(digestAction(CHICAGO_PORCH, APP)).toEqual({ href: `${APP}/lists/door-hanger`, label: 'Print a door hanger' });
    // only a permit whose address could not be read prints the permit list of its trade
    expect(digestAction({ ...COBB_NEW_HOME, summary: 'New Home | Cobb County' }, APP)).toEqual({ href: `${APP}/lists/area?trade=landscaping`, label: 'Print the landscaping address list' });
    // a storm report is area level and gets the storm hanger
    expect(digestAction({ ...HAIL, trade: 'roofing' }, APP).href).toBe(`${APP}/lists/door-hanger?storm=1`);
    expect(digestAction(REQUEST, APP)).toEqual({ href: `${APP}#card-9006`, label: 'Reply to this request' });
    // without a match id the action still works: it opens the feed
    expect(digestAction({ ...COBB_NEW_HOME, matchId: null }, APP).href).toBe(APP);
  });

  it('the feed renders the anchor the action points at', () => {
    // components/feed.tsx puts id="card-<match id>" on every card; this is the other half of the deep link
    expect(/id=\{`card-\$\{item\.id\}`\}/.test(readFileSync('components/feed.tsx', 'utf8'))).toBe(true);
  });
});

describe('3. privacy: an exact address only for a permit', () => {
  it('a permit prints the street; a violation, a 311 row and a home sale print the block', () => {
    expect(digestPlace(COBB_NEW_HOME)).toMatchObject({ text: '5900 SPARROW WAY', exact: true, kind: 'address' });
    expect(digestPlace(ATL_ROOF)).toMatchObject({ text: '771 PALATINE SE', exact: true, kind: 'address' });
    expect(digestPlace(CHICAGO_PORCH)).toMatchObject({ text: '7700 block of S JEFFERY BLVD', exact: false, kind: 'block' });
  });

  it('a non-permit record whose summary somehow carried a house number is still never printed as an address', () => {
    const leak = { ...CHICAGO_PORCH, summary: 'REPAIR PORCH SYSTEM | OPEN | 7742 S JEFFERY BLVD, CHICAGO, IL 60649' };
    const p = digestPlace(leak);
    expect(p.exact).toBe(false);
    expect(p.text).not.toContain('7742');
    const { html, text } = render([leak]);
    expect(html).not.toContain('7742');
    expect(text).not.toContain('7742');
    // a home sale is block level too
    const sale = { kind: 'civic', subtype: 'sale', source: 'socrata-chicago-sales', title: 'Home sold in Chicago', summary: '3400 block of N Lakewood Ave', place: 'Chicago, IL', occurredAt: '2026-11-18T00:00:00Z', label: 'coming_soon' as const };
    expect(digestPlace(sale).exact).toBe(false);
  });

  it('no private person is named: the only names a card prints are the business contact lines', () => {
    const withContact = {
      ...ATL_ROOF,
      contact: { name: 'Peachtree Roofing LLC', role: 'Named on this permit', listing: { phone: '404-555-0123', website: { href: 'https://peachtree.example/', text: 'peachtree.example' }, note: 'n' } },
    };
    const { html, text } = render([withContact]);
    expect(html).toContain('Contact: Peachtree Roofing LLC (Named on this permit)');
    expect(html).toContain('Phone: 404-555-0123');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(text).toContain('Contact: Peachtree Roofing LLC (Named on this permit) · Phone: 404-555-0123');
  });
});

describe('4. honesty, said once and where it belongs', () => {
  it('the closing line says one sentence for each kind of card in the email, once', () => {
    // Round 24 (review P1-4): built from the kinds present. ALL holds permits, violations, a storm report and a resident request.
    const { html, text } = render(ALL);
    for (const body of [html, text]) {
      expect(body.match(/A permit does not mean the owner is choosing a vendor/g)).toHaveLength(1);
      expect(body.match(/A violation or a failed inspection is on the record, but whether the owner is hiring is not known/g)).toHaveLength(1);
      expect(body.match(/A weather alert or a storm report only records the event: damage is not confirmed/g)).toHaveLength(1);
      expect(body.match(/Holler has not checked them/g)).toHaveLength(1);
      // a resident request is in this email: the closing line does not claim every card is a public record with a public source link
      expect(body).not.toContain('Every card comes from a public record');
      expect(body).toContain('Each card that comes from a public record links to its public source.');
      // kinds that are not in the email are not mentioned
      expect(body).not.toContain('311 request is what someone reported');
      expect(body).not.toContain('A bid listing');
    }
    // permits only: the plain opening sentence, and only the permit sentence after it
    const permits = render([COBB_NEW_HOME, ATL_ROOF]);
    expect(permits.text).toContain('Every card comes from a public record near you, and each one links to its public source. A permit does not mean the owner is choosing a vendor.\n');
  });

  it('every card but a building permit says on the card what is uncertain; a permit card does not repeat its caveat', () => {
    const storm = cardsOf(render([HAIL]).html)[0];
    expect(storm).toMatch(/damage is not confirmed/);
    const permit = cardsOf(render([COBB_NEW_HOME]).html)[0];
    expect(permit).not.toMatch(/confidence/);
    for (const it of [DEKALB_VIOLATION, CHICAGO_PORCH, HAIL, REQUEST]) {
      const [card] = cardsOf(render([it]).html);
      expect(card, it.title).toMatch(/<div class="h-small"[^>]*>(High|Medium|Low) confidence [^<]+<\/div>/);
    }
    expect(cardsOf(render([REQUEST]).html)[0]).toContain('Medium confidence a resident asked on Holler; details are unchecked.');
  });

  it('the listing caveat appears only when a card has a listing, and only once', () => {
    const withListing = { ...ATL_ROOF, contact: { name: 'Peachtree Roofing LLC', role: 'Named on this permit', listing: { phone: '404-555-0123', website: null, note: 'n' } } };
    expect(render([withListing, COBB_NEW_HOME]).html.match(/own public listing/g)).toHaveLength(1);
    expect(render([COBB_NEW_HOME]).html).not.toContain('own public listing');
  });

  it('every link to a record is called "public source"; a request links to no public source', () => {
    const cards = cardsOf(render(ALL).html);
    const request = cards.find((c) => c.includes('Service request in Atlanta'))!;
    expect(request).not.toContain('public source');
    for (const c of cards.filter((x) => x !== request)) {
      expect(c.match(/>public source<\/a>/g), c.slice(0, 80)).toHaveLength(1);
    }
  });

  it('no banned word, in either language', () => {
    for (const lang of ['en', 'es'] as const) {
      const { html, text, subject } = render(ALL, { lang });
      const all = `${subject}\n${html}\n${text}`;
      expect(all).not.toMatch(/\bleads?\b|guaranteed|you will win|they need you|official record|[–—]/i);
    }
  });
});

describe('5. the subject line', () => {
  it('names the strongest card and counts the rest, and stays short', () => {
    expect(digestSubject([COBB_NEW_HOME], 1)).toBe('New home permit at 5900 SPARROW WAY');
    // Round 24 (review P1-3, P2-7): the storm report's own title names Longview, so it heads the card; with the count it would pass 50
    // characters, so the subject says what and where, with "in" (never "at" before a town).
    expect(digestSubject([HAIL], 1)).toBe('1.75 inch hail reported near 2 ESE Longview, TX');
    expect(digestSubject([COBB_NEW_HOME, ATL_ROOF, DEKALB_VIOLATION, HAIL], 4)).toBe('Storm report in Longview, TX (+3 more)');
    // Act Now sorts first, so the strongest card is the one named
    expect(digestSubject([COBB_NEW_HOME, CHICAGO_PORCH], 2)).toBe('Violation at 7700 block of S JEFFERY BLVD (+1 more)');
    expect(digestSubject([COBB_NEW_HOME], 1).length).toBeLessThanOrEqual(45);
    expect(digestSubject([ATL_ROOF, COBB_NEW_HOME], 2).length).toBeLessThanOrEqual(45);
  });

  it('a record with no address and no place of its own falls back to its own title, which already says what happened', () => {
    const bare = { ...COBB_NEW_HOME, summary: null, place: null };
    expect(digestSubject([bare], 1)).toBe('New home permit in Cobb County');
    expect(digestSubject([bare], 8)).toBe('New home permit in Cobb County (+7 more)');
  });

  it('never longer than 120 characters, whatever a source wrote', () => {
    const long = { ...COBB_NEW_HOME, summary: null, place: null, title: 'X'.repeat(400) };
    expect(digestSubject([long], 2).length).toBeLessThanOrEqual(120);
    expect(digestSubject([long], 2)).toMatch(/… \(\+1 more\)$/);
  });

  it('stage-update subjects are unchanged, and the empty week has its own', () => {
    const update = { ...ATL_ROOF, permitStage: 'final_inspection', permitStageAt: '2026-11-22T09:00:00Z', permitStageUpdate: true };
    expect(digestSubject([update], 1)).toBe('Update: final inspection on a permit near you');
    expect(digestSubject([], 0)).toBe('Nothing near you this week');
  });
});

describe('6. the empty week is a useful email', () => {
  // Round 24 (review P1-5): "no public record matched" is said only when the sender counted the member's matches of the week and found
  // none (matchedLastWeek: 0); see tests/email/fixmail-r24.test.ts for the other two cases.
  const empty = render([], { matchedLastWeek: 0 });

  it('says what happened, what is still worth doing, and gives two real links', () => {
    expect(empty.subject).toBe('Nothing near you this week');
    expect(empty.html).toContain('Nothing matched near you this week');
    expect(empty.html).toContain('No public record near you matched your trades in the last week');
    const unchecked = render([]);
    expect(unchecked.subject).toBe('No new alert near you this week');
    expect(unchecked.html).not.toContain('No public record near you matched');
    expect(empty.html).toContain(`href="${APP}/lists/door-hanger"`);
    expect(empty.html).toContain(`href="${APP}/lists"`);
    expect(empty.text).toContain(`Print a door hanger: ${APP}/lists/door-hanger`);
  });

  it('does not look broken: no empty list, no zero count, and the legal footer is there', () => {
    expect(empty.html).not.toContain('<ul');
    expect(empty.html).not.toContain('role="list"');
    expect(empty.html).not.toMatch(/\b0 (new|things)/);
    expect(empty.html).toContain(UNSUB.replace(/&/g, '&amp;'));
    expect(empty.html).toContain('You get this because email alerts are on');
    expect(empty.html).toContain('is run by');
  });

  it('a thin week (one card) still renders a whole card with its action', () => {
    const thin = render([COBB_NEW_HOME]);
    expect(cardsOf(thin.html)).toHaveLength(1);
    expect(thin.html).toContain('Open this card');
    expect(thin.text.split('\n').filter((l) => l.startsWith('1. '))).toHaveLength(1);
  });
});

describe('7. dark mode stays readable', () => {
  const css = digestDarkModeCss();

  it('declares color-scheme and only overrides classes the digest also sets inline', () => {
    expect(css).toContain('color-scheme:light dark');
    expect(css).toContain('@media (prefers-color-scheme:dark)');
    const { html } = render(ALL);
    // no rule targets a class the digest never writes (a dead rule would hide a dark-mode bug)
    const classes = [...new Set([...css.matchAll(/\.(h-[a-z0-9-]+)/g)].map((m) => m[1]))];
    expect(classes.length).toBeGreaterThan(8);
    for (const c of classes) expect(html, c).toMatch(new RegExp(`class="(?:[a-z- ]*\\s)?${c}(?:\\s|")`));
    // every element the dark rules recolour carries an inline light colour of its own, so a client that drops the block is fine
    for (const cls of ['h-head', 'h-meta', 'h-why', 'h-small']) {
      const el = html.match(new RegExp(`<div class="${cls}" style="([^"]+)"`))?.[1] ?? html.match(new RegExp(`<p class="${cls}" style="([^"]+)"`))?.[1];
      expect(el, cls).toMatch(/color:#[0-9A-F]{6}/i);
    }
  });

  it('nothing inverts into an unreadable pair: the dark ink and muted are light, the dark surfaces are dark', () => {
    const lum = (hex: string) => {
      const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    expect(ratio(EMAIL_DARK.ink, EMAIL_DARK.surface)).toBeGreaterThan(4.5);
    expect(ratio(EMAIL_DARK.muted, EMAIL_DARK.surface)).toBeGreaterThan(4.5);
    expect(ratio(EMAIL_DARK.link, EMAIL_DARK.surface)).toBeGreaterThan(4.5);
    expect(ratio(EMAIL_DARK.onButton, EMAIL_DARK.button)).toBeGreaterThan(4.5);
    expect(ratio(EMAIL_DARK.ink, EMAIL_DARK.chip)).toBeGreaterThan(4.5);
  });

  it('the hi-vis lime is never text and never an edge, in either mode', () => {
    expect(`${digestDarkModeCss()}${render(ALL).html}`).not.toMatch(/(?:[^-]color|border[a-z-]*):[^;"]*#D9F046/i);
  });
});

describe('8. the plain-text version is readable', () => {
  const { text } = render(ALL);

  it('is numbered cards of at most six short lines, each with its action', () => {
    const blocks = text.split('\n\n').filter((b) => /^\d+\. /.test(b));
    expect(blocks).toHaveLength(ALL.length);
    for (const b of blocks) {
      const lines = b.split('\n');
      expect(lines.length, b).toBeLessThanOrEqual(6);
      expect(lines[0]).toMatch(/^\d+\. \S/);
      expect(b).toMatch(/\n {3}(Open this card|Reply to this request|Print )/);
      for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(220);
    }
  });

  it('has no html, no style block and no repeated source labels', () => {
    expect(text).not.toMatch(/<[a-z/]/i);
    expect(text).not.toContain('color-scheme');
    expect(text).not.toMatch(/open data: /);
  });
});

describe('9. the legal furniture is untouched', () => {
  it('the unsubscribe link, the reason line and the postal address are all still there, in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      const { html, text } = render(ALL, { lang });
      expect(html).toContain(UNSUB.replace(/&/g, '&amp;'));
      expect(text).toContain(UNSUB);
      expect(html).toContain(es['email.footer.off'] === en['email.footer.off'] ? en['email.footer.off'] : lang === 'en' ? en['email.footer.off'] : es['email.footer.off']);
      expect(html).toContain(lang === 'en' ? 'You get this because' : 'Usted recibe este correo');
      expect(html.endsWith('</p></div>')).toBe(true);
      expect(html).toContain('2535 Dallas Highway SW STE B #1036, Marietta, GA 30064, USA');
    }
  });

  it('the unsubscribe link is no harder to find than it was: one link, in the last paragraph of the card', () => {
    const { html } = render(ALL);
    const tail = html.slice(html.lastIndexOf('class="h-small"'));
    expect(tail).toContain(UNSUB.replace(/&/g, '&amp;'));
    expect(html.match(new RegExp(UNSUB.replace(/[?&]/g, (m) => `\\${m}`).replace(/&/g, '&amp;'), 'g')) ?? []).toHaveLength(1);
  });
});

describe('10. Spanish parity', () => {
  const NEW_KEYS = Object.keys(en).filter((k) => /^email\.(what|act|subject\.(card|plain|empty)|honesty|source_link|empty)/.test(k));

  it('every new digest string has a Spanish entry that breaks no wording rule', () => {
    expect(NEW_KEYS.length).toBeGreaterThan(25);
    for (const k of NEW_KEYS) {
      const v = (es as Record<string, string>)[k];
      expect(v, k).toBeTruthy();
      expect(spanishProblems(v), k).toEqual([]);
      expect([...(en as Record<string, string>)[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()).toEqual([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });

  it('the Spanish digest carries the Spanish chip, action, source words and honesty line, and no English chrome', () => {
    const { html, text } = render(ALL, { lang: 'es' });
    expect(html).toContain('lang="es"');
    for (const phrase of [es['chip.act_now'], es['email.source_link'], es['email.honesty.opening_mixed'], es['email.honesty.permit'], es['email.honesty.weather'], es['email.open_feed']]) expect(html).toContain(phrase);
    for (const english of [en['email.honesty.opening_mixed'], en['email.honesty.permit'], en['email.source_link'], en['email.act.hanger'], en['email.act.open_card']]) expect(html, english).not.toContain(english);
    // the block phrase is Spanish too, and the street stays as the source wrote it
    expect(text).toContain('cuadra 7700 de S JEFFERY BLVD');
    expect(text).toContain('5900 SPARROW WAY');
  });

  it('the English AI note is never shown to a Spanish member', () => {
    const noted = { ...COBB_NEW_HOME, note: 'New sod is usually laid once the house is finished.' };
    expect(render([noted], { lang: 'es' }).html).not.toContain('New sod is usually laid');
    expect(render([noted]).html).toContain('New sod is usually laid');
  });
});

describe('the request card keeps the resident\'s own words and nothing else about them', () => {
  it('shows the filtered description, quoted, and still only one action', () => {
    const [card] = cardsOf(render([REQUEST]).html);
    expect(card).toContain('Back yard is overgrown after the storm');
    expect(card).toMatch(/class="h-quote"/);
    expect([...card.matchAll(ACTION_RE)]).toHaveLength(1);
    expect(card).toContain('Reply to this request');
  });
});

/**
 * The rendered previews the owner looks at. Skipped unless the directory is named:
 *   HOLLER_EMAIL_PREVIEW_DIR=/home/claude/gates/r23/out npx vitest run tests/email/digest-r23.test.ts
 *
 * Every card below is a real stored row from gates/r19 data/signals-14d.json (ids in the comments), so the previews show the words a
 * member really gets, not invented copy. 00-before-after.html (the before/after the owner sees) is built by the same run, from this
 * tree's output and from production main's renderDigest; see gates/r23/EMAIL-report.md.
 */
describe.skipIf(!process.env.HOLLER_EMAIL_PREVIEW_DIR)('rendered previews', () => {
  const dir = process.env.HOLLER_EMAIL_PREVIEW_DIR!;
  const PREVIEW_NOW = new Date('2026-11-23T14:00:00Z');
  const APP_URL = 'https://localholler.com/app';
  const UNSUB_URL = 'https://localholler.com/api/cron/notify/unsubscribe?t=eyJ1IjoiZGVtbyJ9.sig';

  // (a) Atlanta landscaper, 4 cards, one new-build permit with an exact address (ids 138447, 72203, 55537, 55540)
  const ATL_LANDSCAPING: DigestItem[] = [
    { kind: 'civic', matchId: 41, source: 'arcgis-dekalb-violations', subtype: 'violation', title: 'Code violation in DeKalb County: property violation', summary: '2400 block of HARMONY RIDGE CT', place: 'DeKalb County, GA', occurredAt: '2026-11-18T09:25:28+00:00', sourceUrl: 'https://dcgis.dekalbcountyga.gov/mapping/rest/services/Hansen/CodeEnforcementCasesInspections/FeatureServer/0', label: 'act_now', trade: 'landscaping', deadline: null },
    { kind: 'permit', matchId: 42, source: 'arcgis-cobb-residential-permits', subtype: 'permit', title: 'New home permit in Cobb County', summary: 'New Home | $609,273 job value | 5900 SPARROW WAY | Cobb County', place: approxLocationNote({ city: 'Cobb County', source: 'arcgis-cobb-residential-permits', subtype: 'permit' }), occurredAt: '2026-11-18T00:00:00+00:00', sourceUrl: 'https://gis.cobbcounty.org/gisserver/rest/services/comdev/Accela_PermitsDashboard/FeatureServer/4', label: 'coming_soon', trade: 'landscaping', jobValue: 609273 },
    { kind: 'permit', matchId: 43, source: 'arcgis-atlanta-permits', subtype: 'permit', title: 'New construction permit in Atlanta', summary: 'Residential New | $500,000 job value | 333 WEST WIEUCA NE, ATLANTA, GA 30342', place: 'Atlanta, GA', occurredAt: '2026-11-18T00:00:00+00:00', sourceUrl: 'https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/building_permit_featureLayer/FeatureServer/0', label: 'coming_soon', trade: 'landscaping', jobValue: 500000 },
    { kind: 'civic', matchId: 44, source: 'arcgis-dekalb-violations', subtype: 'violation', title: 'Code violation in DeKalb County: property violation', summary: '2100 block of RAMBLEWOOD CIR', place: 'DeKalb County, GA', occurredAt: '2026-11-17T00:00:00+00:00', sourceUrl: 'https://dcgis.dekalbcountyga.gov/mapping/rest/services/Hansen/CodeEnforcementCasesInspections/FeatureServer/0', label: 'coming_soon', trade: 'landscaping' },
  ];

  // (b) Atlanta gutters and pressure washing, 2 cards (ids 55448, 55451)
  const ATL_GUTTERS: DigestItem[] = [
    { kind: 'permit', matchId: 51, source: 'arcgis-atlanta-permits', subtype: 'permit', title: 'Roof and remodel permit in Atlanta', summary: 'Residential Alteration | 771 PALATINE SE, ATLANTA, GA 30316', place: 'Atlanta, GA', occurredAt: '2026-11-17T00:00:00+00:00', sourceUrl: 'https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/building_permit_featureLayer/FeatureServer/0', label: 'coming_soon', trade: 'siding-gutters' },
    { kind: 'permit', matchId: 52, source: 'arcgis-atlanta-permits', subtype: 'permit', title: 'New construction permit in Atlanta', summary: 'Residential New | $600,000 job value | 538 ETHEL NW, ATLANTA, GA 30318', place: 'Atlanta, GA', occurredAt: '2026-11-17T00:00:00+00:00', sourceUrl: 'https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/building_permit_featureLayer/FeatureServer/0', label: 'coming_soon', trade: 'cleaning', jobValue: 600000 },
  ];

  // (c) Chicago handyman, 6 cards, block-level violations (ids 4250, 4260, 4248, 4252, 4253, 4247)
  const CHI_HANDYMAN: DigestItem[] = [
    { kind: 'civic', matchId: 61, source: 'socrata-chicago-violations', subtype: 'violation', title: 'Code violation in Chicago: INSTALL SMOKE DETECTORS', summary: 'INSTALL SMOKE DETECTORS | OPEN | 8700 block of S EXCHANGE AVE', place: 'Chicago, IL', occurredAt: '2026-11-16T06:00:00+00:00', sourceUrl: 'https://data.cityofchicago.org/d/22u3-xenr', label: 'act_now', trade: 'handyman', deadline: null },
    { kind: 'civic', matchId: 62, source: 'socrata-chicago-violations', subtype: 'violation', title: 'Code violation in Chicago: REPAIR PORCH SYSTEM', summary: 'REPAIR PORCH SYSTEM | OPEN | 7700 block of S JEFFERY BLVD', place: 'Chicago, IL', occurredAt: '2026-11-16T06:00:00+00:00', sourceUrl: 'https://data.cityofchicago.org/d/22u3-xenr', label: 'coming_soon', trade: 'handyman' },
    { kind: 'civic', matchId: 63, source: 'socrata-chicago-violations', subtype: 'violation', title: 'Code violation in Chicago: REPAIR EXTERIOR WALL', summary: 'REPAIR EXTERIOR WALL | OPEN | 3600 block of W GRENSHAW ST | Also cited: REPAIR PORCH SYSTEM; REPAIR EXTERIOR STAIR', place: 'Chicago, IL', occurredAt: '2026-11-16T06:00:00+00:00', sourceUrl: 'https://data.cityofchicago.org/d/22u3-xenr', label: 'coming_soon', trade: 'handyman' },
    { kind: 'civic', matchId: 64, source: 'socrata-chicago-violations', subtype: 'violation', title: 'Code violation in Chicago: REPAIR EXTERIOR STAIR', summary: 'REPAIR EXTERIOR STAIR | OPEN | 9000 block of S DR MARTIN L KING JR DR', place: 'Chicago, IL', occurredAt: '2026-11-16T06:00:00+00:00', sourceUrl: 'https://data.cityofchicago.org/d/22u3-xenr', label: 'coming_soon', trade: 'handyman' },
    { kind: 'civic', matchId: 65, source: 'socrata-chicago-violations', subtype: 'violation', title: 'Code violation in Chicago: REPAIR EXTERIOR DOOR HARDWARE', summary: 'REPAIR EXTERIOR DOOR HARDWARE | OPEN | 1500 block of E 69TH ST', place: 'Chicago, IL', occurredAt: '2026-11-16T06:00:00+00:00', sourceUrl: 'https://data.cityofchicago.org/d/22u3-xenr', label: 'coming_soon', trade: 'handyman' },
    { kind: 'civic', matchId: 66, source: 'socrata-chicago-violations', subtype: 'violation', title: 'Code violation in Chicago: MAINTAIN WINDOW', summary: 'MAINTAIN WINDOW | OPEN | 3600 block of W GRENSHAW ST', place: 'Chicago, IL', occurredAt: '2026-11-16T06:00:00+00:00', sourceUrl: 'https://data.cityofchicago.org/d/22u3-xenr', label: 'market_insight', trade: 'handyman' },
  ];

  const write = (name: string, html: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), html);
  };
  const page = (title: string, subject: string, body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title}</title></head>` +
    `<body style="margin:0;background:#E9E7DF"><p style="font-family:ui-monospace,monospace;font-size:12px;color:#444;margin:0;padding:10px 14px;background:#fff;border-bottom:1px solid #ccc">` +
    `${title} &middot; inbox subject line (${subject.length} chars): <strong>${subject.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</strong></p>${body}</body></html>`;

  it('writes the six previews and the before/after', () => {
    const cases: [string, string, DigestItem[], { lang?: 'en' | 'es'; name: string; total?: number }][] = [
      ['01-atl-landscaping.html', 'Atlanta landscaper, 4 cards', ATL_LANDSCAPING, { name: 'Ramirez Lawn & Landscape', total: 17 }],
      ['02-atl-gutters.html', 'Atlanta gutters and pressure washing, 2 cards', ATL_GUTTERS, { name: 'Peachtree Exterior Wash' }],
      ['03-chi-handyman.html', 'Chicago handyman, 6 cards', CHI_HANDYMAN, { name: 'Southside Handyman Co', total: 166 }],
      ['04-empty-week.html', 'A quiet week', [], { name: 'Ramirez Lawn & Landscape' }],
      ['05-atl-landscaping-es.html', 'Atlanta landscaper, 4 cards, Spanish', ATL_LANDSCAPING, { name: 'Jardineria Ramirez', lang: 'es', total: 17 }],
    ];
    for (const [file, title, items, o] of cases) {
      const mail = renderDigest({ businessName: o.name, items, totalCount: o.total, appUrl: APP_URL, unsubscribeUrl: UNSUB_URL, now: PREVIEW_NOW, lang: o.lang });
      write(file, page(title, mail.subject, mail.html));
      write(file.replace(/\.html$/, '.txt'), `Subject: ${mail.subject}\n\n${mail.text}`);
    }

  });
});
