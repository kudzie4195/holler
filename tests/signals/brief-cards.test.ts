/**
 * Brief card v1 (PLAN-2.0 item 0.4), the three places a card is drawn: the web feed (components/feed.tsx), the email digest
 * (lib/email/templates.ts) and the mobile API alert (lib/mobile/feed.ts). Every card has all five parts and a source link.
 * Inputs are tests/signals/brief-fixtures.ts: real adapter parser output, run through the real matcher for a fixture member, so each
 * card is shown only to a trade the label rules allow and its label, trade and deadline are the matcher's, not hand-assigned.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';

vi.mock('server-only', () => ({}));
vi.mock('@/app/app/actions', () => ({
  setMatchStatus: async () => ({ ok: true }),
  getRequestReplyStates: async () => ({}),
  submitFeedback: async () => ({ ok: true }),
}));

import { Feed, type FeedItem } from '@/components/feed';
import { renderDigest } from '@/lib/email/templates';
import { buildAlerts } from '@/lib/mobile/feed';
import { allBriefStrings, briefFor, WHY_OVERRIDES, workFor } from '@/lib/signals/brief';
import { matchOne } from '@/lib/signals/match';
import { BANNED } from './banned';
import { FIXTURES, NOW, digestItem, feedItem, briefInputOf, matchSignalOf, mobileRow, profileFor } from './brief-fixtures';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The five parts, each present and non-empty, in the web card html of ONE article. */
function webParts(article: string) {
  const grab = (id: string) => (article.match(new RegExp(`data-testid="${id}"[^>]*>([\\s\\S]*?)</p>`))?.[1] ?? '').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return {
    what: article.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? '',
    why: grab('brief-why'),
    next: grab('brief-next'),
    source: grab('brief-source'),
    uncertain: grab('brief-uncertain'),
    link: article.match(/data-testid="brief-link"/) ? (article.match(/<a href="([^"]+)"[^>]*data-testid="brief-link"/)?.[1] ?? '') : '',
  };
}

describe('web feed: every card has the five parts and a source link', () => {
  const html = renderToStaticMarkup(createElement(Feed, { items: FIXTURES.map(feedItem), cityPage: null }));
  const articles = html.split('<article').slice(1);

  it('renders one article per fixture, so every family is covered', () => {
    expect(articles).toHaveLength(FIXTURES.length);
  });

  FIXTURES.forEach((f, i) => {
    it(`${f.name}`, () => {
      const p = webParts(articles[i]);
      expect(p.what, 'what happened').toContain(esc(f.signal.title));
      expect(p.why).toMatch(/^Why it matters: .{30,}/);
      expect(p.next).toMatch(/^Next step: .{15,}/);
      expect(p.source).toMatch(/^Source: .+ · [A-Z][a-z]{2} \d{1,2}, 2026/);
      expect(p.uncertain).toMatch(/^What is uncertain: (High|Medium|Low) confidence .+;.+\.$/);
      expect(p.link, 'source link').toMatch(/^(https?:\/\/|\/)/);
      // the link is the record's own page when it has one, otherwise the dataset's home page
      if (f.signal.url) expect(p.link).toBe(f.signal.url);
      else expect(p.link).toMatch(/^https:\/\//);
    });
  });

  it('the source link opens in a new tab with rel noopener, except Holler\'s own request page', () => {
    for (const a of articles) {
      const tag = a.match(/<a [^>]*data-testid="brief-link"[^>]*>/)![0];
      expect(tag).toMatch(/target="_blank"/);
      expect(tag).toMatch(/rel="noopener noreferrer"/);
    }
  });

  it('the source link keeps a 44 px tap target (py-3 around a 20 px line) without making the row taller (review P2-8)', () => {
    for (const a of articles) expect(a.match(/<a [^>]*data-testid="brief-link"[^>]*>/)![0]).toMatch(/class="[^"]*\bpy-3\b[^"]*"/);
  });

  it('trade-specific: the same hail report reads differently for a roofer and an auto body shop', () => {
    const hail = FIXTURES.find((c) => c.name === 'hail report')!;
    const one = (trade: string) => renderToStaticMarkup(createElement(Feed, { items: [{ ...feedItem(hail, 0), trade }], cityPage: null }));
    expect(one('roofing')).toContain('roofs are often checked');
    expect(one('auto-body')).toContain('cars are sometimes dented');
  });

  it('a card with no label or trade still has all five parts (older callers)', () => {
    const bare: FeedItem = { ...feedItem(FIXTURES.find((c) => c.name === 'weather alert')!, 0), label: undefined, trade: undefined };
    const p = webParts(renderToStaticMarkup(createElement(Feed, { items: [bare], cityPage: null })).split('<article')[1]);
    expect([p.why, p.next, p.source, p.uncertain, p.link].every(Boolean)).toBe(true);
  });

  it('keeps the card calm: no new colors, wraps long text (no nowrap rows), no fixed widths', () => {
    const block = html.match(/data-testid="brief"[\s\S]*?<\/div>/)![0];
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|text-(red|green|blue|amber|orange|yellow)-|bg-(red|green|blue|amber|orange|yellow)-/i);
    expect(block).not.toMatch(/\bw-\[|\bmin-w-|\bwidth:/);
    expect(block.match(/break-words/g)!.length).toBe(4);
  });
});

describe('web card: no duplicate of the brief (the old intent block and the header source line are gone)', () => {
  const html = renderToStaticMarkup(createElement(Feed, { items: FIXTURES.map(feedItem), cityPage: null }));
  const articles = html.split('<article').slice(1);

  it('has no "Might need work / The event is on record" intent block and no intent line on any card', () => {
    for (const a of articles) {
      expect(a).not.toMatch(/Might need work|Money being spent|Someone asked|The event is on record|Money is being spent here|A resident asked for this service|This work is out for bid|A public post asked about this|A new business registered here/);
    }
  });

  it('the source is named once per card, in the brief (the header line "Source name ·" is gone)', () => {
    for (const a of articles) {
      const text = a.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const p = webParts(a);
      const label = p.source.replace(/^Source: /, '').split(' · ')[0];
      expect(text.split(label).length - 1, label).toBe(1);
    }
  });

  it('the opportunity chip and the deadline line are still there for Act now cards', () => {
    expect(articles.filter((a) => a.includes('Act now')).length).toBeGreaterThan(5);
    const fed = articles[FIXTURES.findIndex((c) => c.name === 'federal bid')];
    expect(fed).toMatch(/Act now/);
    expect(fed).toMatch(/data-testid="bid-line"|Respond by|Due/i);
  });
});

describe('trade wording matches the fixture profile trade, for every fixture card', () => {
  const html = renderToStaticMarkup(createElement(Feed, { items: FIXTURES.map(feedItem), cityPage: null }));
  const articles = html.split('<article').slice(1);

  FIXTURES.forEach((f, i) => {
    it(`${f.name}: card trade is one of the member's trades, and the why line is the table's line for that trade`, () => {
      // the card trade is a trade the profile picked (or null for a keyword-only match, which no fixture is)
      expect(f.profile.categories).toContain(f.trade);
      expect(f.trade, 'a trade-matched card').not.toBeNull();
      const p = webParts(articles[i]);
      const why = p.why.replace(/^Why it matters: /, '');
      const want = briefFor(briefInputOf(f));
      expect(why).toBe(want.why);
      // an override sentence is only ever shown to the member who picked that override's trade
      for (const [key, text] of Object.entries(WHY_OVERRIDES)) {
        if (why === text) expect(key.split('|')[2], `${key} shown to ${f.profile.categories.join(',')}`).toBe(f.trade);
      }
      // the sentence names the matched trade's work, except a market-insight permit or a federal award: those describe the record from the
      // record's own words (its permit type or contract work) and never from the trade tag (review P1-2)
      if (!Object.values(WHY_OVERRIDES).includes(why)) {
        const w = workFor(f.trade);
        const fromRecord = f.label === 'market_insight' && ['permit', 'federal-award'].includes(want.family);
        if (fromRecord) {
          expect(why, f.name).not.toContain(w);
          expect(why, f.name).toMatch(/\((Roof)\)|awarded for Plumbing/);
        } else {
          // Round 15 quality gate: a code violation card quotes the order's own title, not the trade's work (a gutter order is no roof repair)
          const quotesOrder = want.family === 'violation' && /^A code violation was recorded nearby: .+\.$/.test(why);
          expect(why.includes(w) || why.includes('work like') || why.includes('a resident') || why.includes('Someone posted') || quotesOrder, `${f.signal.source}: ${why}`).toBe(true);
        }
      }
      // never "your trade", and never another trade's work phrase
      expect(why).not.toMatch(/your trade/i);
    });
  });

  it('a card never says another trade\'s override: a roofer\'s hail card is not the auto-body hail card', () => {
    const hail = FIXTURES.find((c) => c.name === 'hail report')!;
    const a = webParts(renderToStaticMarkup(createElement(Feed, { items: [feedItem(hail, 0)], cityPage: null })).split('<article')[1]);
    expect(a.why).toContain('roofs are often checked');
    expect(a.why).not.toContain('dented');
  });
});

describe('the label rules decide who sees a card (no rules bug: a roofer cannot be shown a failed food inspection)', () => {
  const inspection = FIXTURES.find((c) => c.name === 'failed food inspection')!;
  const asMember = (categories: string[], extra: Record<string, unknown> = {}) => ({ ...profileFor(inspection.signal, categories, 'Test'), ...extra });
  const m = (categories: string[], extra: Record<string, unknown> = {}) => matchOne(matchSignalOf(inspection.signal), asMember(categories, extra) as never, true);

  it('a roofing member does not match a failed food inspection at all (inspections are tagged only for the trades the rules allow)', () => {
    expect(m(['roofing'])).toBeNull();
    expect(m(['roofing', 'siding-gutters', 'painting'])).toBeNull();
  });
  it('a pest-control member gets it as Act now; so do cleaning trades (INSPECTION_TRADES)', () => {
    expect(m(['pest-control'])?.label).toBe('act_now');
    expect(m(['janitorial-commercial'])?.label).toBe('act_now');
  });
  it('the FIXTURE record is tagged with trades the rules give it to (live inspections carry more tags, see the review P1-3 tests in brief.test.ts)', () => {
    expect(inspection.signal.categories.every((c) => ['pest-control', 'cleaning', 'janitorial-commercial'].includes(c))).toBe(true);
  });
  it('every fixture record is refused for a trade it is not tagged with (no member sees a card for a trade the record does not carry)', () => {
    for (const f of FIXTURES) {
      const outside = ['roofing', 'pest-control', 'hvac', 'plumbing', 'catering', 'moving', 'tree-service', 'restoration', 'cleaning', 'general-contractor']
        .filter((t) => !(f.signal.categories as string[]).includes(t) && !(f.profile.categories as string[]).includes(t));
      for (const t of outside.slice(0, 3)) {
        const r = matchOne(matchSignalOf(f.signal), { ...f.profile, categories: [t] } as never, true);
        expect(r, `${f.name} for ${t}`).toBeNull();
      }
    }
  });
});

describe('email digest: every item has the five parts and a link', () => {
  const mail = renderDigest({ businessName: 'Fixture members', items: FIXTURES.map(digestItem), appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW });
  const lis = mail.html.split('<li ').slice(1).map((s) => s.split('</li>')[0]);
  const blocks = mail.text.split('\n\n').filter((b) => b.includes('Why it matters:'));

  it('has one list item and one text block per fixture (the digest orders them, Act now first)', () => {
    expect(lis).toHaveLength(FIXTURES.length);
    expect(blocks).toHaveLength(FIXTURES.length);
  });

  it('html: each item has what happened, why, next step, source with date and link, and the uncertainty line', () => {
    for (const li of lis) {
      expect(li).toMatch(/font-weight:600[^>]*>[^<]+<\/div>/); // title
      expect(li).toMatch(/<strong>Why it matters:<\/strong> .{30,}/);
      expect(li).toMatch(/<strong>Next step:<\/strong> .{15,}/);
      expect(li).toMatch(/<strong>Source:<\/strong> .+ &middot; [A-Z][a-z]{2} \d{1,2}, 2026 &middot; <a href="https?:\/\/[^"]+"[^>]*>Open the (source|source home page|request form|bid portal)<\/a>/);
      expect(li).toMatch(/<strong>What is uncertain:<\/strong> (High|Medium|Low) confidence .+;.+\./);
    }
  });

  it('text: each item has the same parts and a link line', () => {
    for (const b of blocks) {
      expect(b).toMatch(/Why it matters: .{30,}/);
      expect(b).toMatch(/Next step: .{15,}/);
      expect(b).toMatch(/Source: .+\. Record date: [A-Z][a-z]{2} \d{1,2}, 2026\./);
      expect(b).toMatch(/\nOpen the (source|source home page|request form|bid portal): https?:\/\/\S+/);
      expect(b).toMatch(/What is uncertain: (High|Medium|Low) confidence/);
    }
  });

  it('has no intent block ("Might need work ... The event is on record") in html or text, and no header source line', () => {
    expect(mail.html + mail.text).not.toMatch(/Might need work|Money being spent|Someone asked|The event is on record|Money is being spent here|A resident asked for this service|This work is out for bid|A public post asked about this|A new business registered here/);
    for (const li of lis) {
      // the only place the source name appears is the Source row
      const label = li.match(/<strong>Source:<\/strong> (.+?) &middot;/)![1];
      expect(li.split(label).length - 1, label).toBe(1);
    }
  });

  it('a record without a link of its own gets the dataset home page, never no link', () => {
    const gust = FIXTURES.find((c) => c.name === 'wind gust')!;
    const bare = renderDigest({ businessName: 'Fixture members', items: [{ ...digestItem(gust), sourceUrl: null }], appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW });
    expect(bare.html).toContain('href="https://www.spc.noaa.gov/climo/reports/"');
    expect(bare.html).toContain('Open the source home page');
    expect(bare.text).toContain('Open the source home page: https://www.spc.noaa.gov/climo/reports/');
  });

  it('a resident request says "Open the request form" (a request has no page of its own) and a Baton Rouge bid says "Open the bid portal"', () => {
    expect(lis.find((s) => s.includes('Service request in Atlanta'))).toContain('>Open the request form</a>');
    expect(lis.find((s) => s.includes('Window Washing Library Sites'))).toContain('>Open the bid portal</a>');
  });

  it('no banned wording anywhere in the mail, and no em dash', () => {
    for (const re of BANNED) expect(mail.html + mail.text, String(re)).not.toMatch(re);
  });
});

describe('mobile API: the alert carries the brief as additive fields', () => {
  const deps = (over: Record<string, unknown> = {}) => ({ userId: 'u1', locked: false, db: new FakeDb() as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: [...new Set(FIXTURES.map((f) => f.trade).filter((t): t is string => !!t))], ...over });
  const OLD_FIELDS = ['matchId', 'signalId', 'sourceLabel', 'sourceUrl', 'title', 'summary', 'url', 'intent', 'label', 'deadline', 'bidLine', 'ai'];

  it('every alert has a brief with all parts and an http(s) source link; the old fields (intent, sourceLabel, ...) are unchanged', async () => {
    vi.stubEnv('HOLLER_BIDS_ENABLED', '1');
    const alerts = await buildAlerts(FIXTURES.map(mobileRow), deps());
    vi.unstubAllEnvs();
    expect(alerts).toHaveLength(FIXTURES.length);
    for (const a of alerts) {
      const b = a.brief;
      expect(b.why.length, a.title).toBeGreaterThan(30);
      expect(b.next.length).toBeGreaterThan(15);
      expect(b.uncertain).toMatch(/^(High|Medium|Low) confidence .+;.+\.$/);
      expect(b.uncertain.startsWith(b.confidence)).toBe(true);
      expect(b.source.url, a.title).toMatch(/^https?:\/\//);
      expect(b.source.label.length).toBeGreaterThan(3);
      expect(b.source.date).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2026$/);
      // additive: the existing fields are all still there, and the contract's intent is still filled in
      for (const k of OLD_FIELDS) expect(a, k).toHaveProperty(k);
      expect(a.intent, a.title).toBeTruthy();
      expect((a.sourceLabel ?? '').length).toBeGreaterThan(3);
    }
    const hail = alerts.find((a) => a.title.startsWith('1.50 inch hail'))!;
    expect(hail.brief.why).toContain('roofs are often checked');
    expect(hail.brief.confidence).toBe('High');
    expect(alerts.find((a) => a.source === 'bluesky')!.brief.confidence).toBe('Low');
    expect(alerts.find((a) => a.source === 'socrata-nyc-311')!.brief.confidence).toBe('Medium');
  });

  it('the brief trade for each alert is the trade its fixture member picked', async () => {
    vi.stubEnv('HOLLER_BIDS_ENABLED', '1');
    for (const f of FIXTURES) {
      const [a] = await buildAlerts([mobileRow(f, 0)], deps({ trades: f.trades }));
      expect(a, f.name).toBeTruthy();
      expect(a.brief.why, f.name).toBe(briefFor(briefInputOf(f)).why);
    }
    vi.unstubAllEnvs();
  });

  it('a record with no link of its own links to the dataset home page; a resident request links to the absolute /request page', async () => {
    const gustCase = FIXTURES.find((c) => c.name === 'wind gust')!;
    const row = mobileRow(gustCase, 0) as unknown as { signal: { url: string | null } };
    row.signal.url = null;
    const alerts = await buildAlerts([row as never, ...FIXTURES.map(mobileRow).filter((r) => (r as never as { id: number }).id !== 1)], deps());
    const gust = alerts.find((a) => a.title.includes('wind gust'))!;
    expect(gust.brief.source).toMatchObject({ url: 'https://www.spc.noaa.gov/climo/reports/', recordLink: false });
    const req = alerts.find((a) => a.source === 'holler-request')!;
    expect(req.brief.source.url).toBe('https://localholler.com/request');
    expect(req.brief.source.linkText).toBe('Open the request form');
  });

  it('a locked member gets the brief with the dataset home page only, never the record link', async () => {
    const alerts = await buildAlerts(FIXTURES.map(mobileRow), deps({ locked: true }));
    for (const a of alerts) {
      expect(a.url).toBeNull();
      expect(a.brief.source.recordLink).toBe(false);
      expect(a.brief.source.url).toMatch(/^https?:\/\//);
      // a record page that is a distinct URL (hail, weather alert, a bid) is not exposed: the link is the dataset's home page
      const f = FIXTURES.find((x) => x.signal.id === a.signalId)!;
      if (['hail report', 'weather alert', 'federal bid', 'public post'].includes(f.name)) expect(a.brief.source.url, f.name).not.toBe(f.signal.url);
    }
  });
});

describe('mobile, locked member: the brief carries no record text (review R2-2)', () => {
  const deps = (over: Record<string, unknown> = {}) => ({ userId: 'u1', locked: false, db: new FakeDb() as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: [...new Set(FIXTURES.map((f) => f.trade).filter((t): t is string => !!t))], ...over });
  const byName = (n: string) => FIXTURES.find((c) => c.name === n)!;

  it('a locked permit, award and storm card are the generic lines: no permit type, no contract work, no storm remarks', async () => {
    vi.stubEnv('HOLLER_BIDS_ENABLED', '1');
    const storm = mobileRow(byName('wind gust'), 0) as unknown as { signal: { summary: string | null } };
    storm.signal.summary = 'Several trees down on homes and power lines down. (FFC)';
    const rows = [mobileRow(byName('own-trade permit'), 1), mobileRow(byName('federal award'), 2), storm as never];
    const unlocked = await buildAlerts(rows, deps());
    const locked = await buildAlerts(rows, deps({ locked: true }));
    vi.unstubAllEnvs();
    expect(unlocked).toHaveLength(3);
    expect(locked).toHaveLength(3);
    // unlocked members do get the record's own words
    expect(unlocked.map((a) => a.brief.why + ' ' + a.brief.uncertain).join(' ')).toMatch(/\(Roof\)/);
    expect(unlocked.map((a) => a.brief.why + ' ' + a.brief.uncertain).join(' ')).toMatch(/awarded for Plumbing/);
    expect(unlocked.map((a) => a.brief.uncertain).join(' ')).toMatch(/it mentions trees down/);
    for (const a of locked) {
      const text = `${a.brief.why} ${a.brief.uncertain}`;
      expect(text, a.source).not.toMatch(/\(Roof\)|Plumbing|trees down|power lines|NAICS|Roof permit/);
      expect(text, a.source).not.toContain('mentions');
    }
    // and the locked text is exactly the table's text for a record with no title and no summary
    const lockedPermit = locked.find((a) => a.source === 'socrata-chicago-permits')!;
    expect(lockedPermit.brief.why).toBe(briefFor({ source: 'socrata-chicago-permits', subtype: 'permit', label: 'market_insight', trade: 'roofing' }).why);
    const lockedAward = locked.find((a) => a.source === 'usaspending')!;
    expect(lockedAward.brief.why).toBe(briefFor({ source: 'usaspending', label: 'market_insight', trade: 'plumbing' }).why);
    const lockedStorm = locked.find((a) => a.source === 'spc')!;
    expect(lockedStorm.brief.uncertain).toBe('High confidence a gust was reported; damage is not confirmed.');
  });
});

describe('the brief strings the cards print come from the table (no free text)', () => {
  it('every card sentence is in the table, so the banned-word test over the table covers it', () => {
    const table = new Set(allBriefStrings());
    const html = renderToStaticMarkup(createElement(Feed, { items: FIXTURES.map(feedItem), cityPage: null }));
    const articles = html.split('<article').slice(1);
    articles.forEach((a) => {
      const p = webParts(a);
      expect(table.has(p.why.replace(/^Why it matters: /, ''))).toBe(true);
      expect(table.has(p.next.replace(/^Next step: /, ''))).toBe(true);
      expect(table.has(p.uncertain.replace(/^What is uncertain: /, ''))).toBe(true);
    });
  });
});
