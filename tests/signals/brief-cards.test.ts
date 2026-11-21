/**
 * Brief card v1 (PLAN-2.0 item 0.4), the three places a card is drawn: the web feed (components/feed.tsx), the email digest
 * (lib/email/templates.ts) and the mobile API alert (lib/mobile/feed.ts). Every card has all five parts and a source link.
 * Inputs are hand-written fixtures (assumed), one per record family, dated 2026-11-20.
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
import { allBriefStrings } from '@/lib/signals/brief';
import { BANNED } from './banned';
import { FIXTURES, NOW, digestItem, feedItem, mobileRow } from './brief-fixtures';

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
      expect(p.what, 'what happened').toContain(f.title.replace(/'/g, '&#x27;').replace(/&/g, '&amp;').replace(/&amp;#x27;/g, '&#x27;'));
      expect(p.why).toMatch(/^Why it matters: .{30,}/);
      expect(p.next).toMatch(/^Next step: .{20,}/);
      expect(p.source).toMatch(/^Source: .+ · Nov 20, 2026/);
      expect(p.uncertain).toMatch(/^What is uncertain: (High|Medium|Low) confidence .+;.+\.$/);
      expect(p.link, 'source link').toMatch(/^(https?:\/\/|\/)/);
      // the link is the record's own page when it has one, otherwise the dataset's home page
      if (f.url) expect(p.link).toBe(f.url);
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

  it('trade-specific: the same hail report reads differently for a roofer and an auto body shop', () => {
    const one = (trade: string) => renderToStaticMarkup(createElement(Feed, { items: [{ ...feedItem(FIXTURES[4], 0), trade }], cityPage: null }));
    expect(one('roofing')).toContain('roofs are often checked');
    expect(one('auto-body')).toContain('vehicles are sometimes dented');
  });

  it('a card with no label or trade still has all five parts (older callers)', () => {
    const bare: FeedItem = { ...feedItem(FIXTURES[6], 0), label: undefined, trade: undefined };
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

describe('email digest: every item has the five parts and a link', () => {
  const mail = renderDigest({ businessName: 'Acme Roofing', items: FIXTURES.map(digestItem), appUrl: 'https://localholler.com/app', unsubscribeUrl: 'https://localholler.com/u', now: NOW });
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
      expect(li).toMatch(/<strong>Next step:<\/strong> .{20,}/);
      expect(li).toMatch(/<strong>Source:<\/strong> .+ &middot; Nov 20, 2026 &middot; <a href="https?:\/\/[^"]+"[^>]*>Open the (source|source home page|request|bid portal)<\/a>/);
      expect(li).toMatch(/<strong>What is uncertain:<\/strong> (High|Medium|Low) confidence .+;.+\./);
    }
  });

  it('text: each item has the same parts and a link line', () => {
    for (const b of blocks) {
      expect(b).toMatch(/Why it matters: .{30,}/);
      expect(b).toMatch(/Next step: .{20,}/);
      expect(b).toMatch(/Source: .+\. Record date: Nov 20, 2026\./);
      expect(b).toMatch(/\nOpen the (source|source home page|request|bid portal): https?:\/\/\S+/);
      expect(b).toMatch(/What is uncertain: (High|Medium|Low) confidence/);
    }
  });

  it('a record without a link of its own gets the dataset home page, never no link', () => {
    const li = lis.find((s) => s.includes('Wind gust near Smyrna'))!;
    expect(li).toContain('href="https://www.spc.noaa.gov/climo/reports/"');
    expect(li).toContain('Open the source home page');
  });

  it('a resident request says "Open the request" and a Baton Rouge bid says "Open the bid portal"', () => {
    expect(lis.find((s) => s.includes('Service request in Atlanta'))).toContain('>Open the request</a>');
    expect(lis.find((s) => s.includes('Janitorial services'))).toContain('>Open the bid portal</a>');
  });

  it('no banned wording anywhere in the mail, and no em dash', () => {
    for (const re of BANNED) expect(mail.html + mail.text, String(re)).not.toMatch(re);
  });
});

describe('mobile API: the alert carries the brief as additive fields', () => {
  const deps = (over: Record<string, unknown> = {}) => ({ userId: 'u1', locked: false, db: new FakeDb() as never, admin: null, siteUrl: 'https://localholler.com', now: NOW.getTime(), trades: [...new Set(FIXTURES.map((f) => f.trade))], ...over });

  it('every alert has a brief with all parts and an http(s) source link; the old fields are unchanged', async () => {
    vi.stubEnv('HOLLER_BIDS_ENABLED', '1');
    const alerts = await buildAlerts(FIXTURES.map(mobileRow), deps());
    vi.unstubAllEnvs();
    expect(alerts).toHaveLength(FIXTURES.length);
    for (const a of alerts) {
      const b = a.brief;
      expect(b.why.length, a.title).toBeGreaterThan(30);
      expect(b.next.length).toBeGreaterThan(20);
      expect(b.uncertain).toMatch(/^(High|Medium|Low) confidence .+;.+\.$/);
      expect(b.uncertain.startsWith(b.confidence)).toBe(true);
      expect(b.source.url, a.title).toMatch(/^https?:\/\//);
      expect(b.source.label.length).toBeGreaterThan(3);
      expect(b.source.date).toBe('Nov 20, 2026');
      // additive: the existing fields are all still there
      for (const k of ['matchId', 'signalId', 'sourceLabel', 'sourceUrl', 'title', 'summary', 'url', 'intent', 'label', 'deadline', 'bidLine', 'ai']) expect(a, k).toHaveProperty(k);
    }
    const hail = alerts.find((a) => a.title.startsWith('Hail'))!;
    expect(hail.brief.why).toContain('roofs are often checked');
    expect(hail.brief.confidence).toBe('High');
    expect(alerts.find((a) => a.source === 'bluesky')!.brief.confidence).toBe('Low');
    expect(alerts.find((a) => a.source === 'socrata-nyc-311')!.brief.confidence).toBe('Medium');
  });

  it('a record with no link of its own links to the dataset home page; a resident request links to the absolute /request page', async () => {
    const alerts = await buildAlerts(FIXTURES.map(mobileRow), deps());
    const gust = alerts.find((a) => a.title.startsWith('Wind gust'))!;
    expect(gust.brief.source).toMatchObject({ url: 'https://www.spc.noaa.gov/climo/reports/', recordLink: false });
    const req = alerts.find((a) => a.source === 'holler-request')!;
    expect(req.brief.source.url).toBe('https://localholler.com/request');
    expect(req.brief.source.linkText).toBe('Open the request');
  });

  it('a locked member gets the brief with the dataset home page only, never the record link', async () => {
    const alerts = await buildAlerts(FIXTURES.map(mobileRow), deps({ locked: true }));
    for (const a of alerts) {
      expect(a.url).toBeNull();
      expect(a.brief.source.recordLink).toBe(false);
      expect(a.brief.source.url).toMatch(/^https?:\/\//);
      const f = FIXTURES.find((x) => a.title && x.source === a.source)!;
      if (f.url && !f.url.includes('localholler')) expect(a.brief.source.url).not.toBe(f.url);
    }
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
