import { describe, expect, it } from 'vitest';
import { isUpcoming, newestPast, orderLatest, relativeTime, UPCOMING_DAYS } from '@/lib/time';
import { timeAgo } from '@/components/format';
import { timeAgo as emailTimeAgo, renderDigest } from '@/lib/email/templates';
import { groupItems, MAX_ITEMS, type CheckItem } from '@/lib/check/group';
import { orderTradeItems, TRADE_LIST_LIMIT, TRADE_UPCOMING_LIMIT, type TradeSignalItem } from '@/lib/seo/trade-data';
import { summarize, type SignalRowDb } from '@/lib/seo/summarize';
import { buildIntro, fmtItemTime } from '@/lib/seo/view';

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('relativeTime (app style)', () => {
  it('past times read "ago"', () => {
    expect(relativeTime(at(-30 * 1000), NOW)).toBe('just now');
    expect(relativeTime(at(-5 * MIN), NOW)).toBe('5 min ago');
    expect(relativeTime(at(-3 * HOUR), NOW)).toBe('3 hr ago');
    expect(relativeTime(at(-1 * DAY), NOW)).toBe('1 day ago');
    expect(relativeTime(at(-5 * DAY), NOW)).toBe('5 days ago');
    expect(relativeTime(at(-20 * DAY), NOW)).toBe('Oct 28');
  });
  it('future times read "in ...", never "ago" and never negative', () => {
    expect(relativeTime(at(20 * MIN), NOW)).toBe('in 20 min');
    expect(relativeTime(at(5 * HOUR), NOW)).toBe('in 5 hr');
    expect(relativeTime(at(1 * DAY), NOW)).toBe('in 1 day');
    expect(relativeTime(at(3 * DAY), NOW)).toBe('in 3 days');
    expect(relativeTime(at(40 * DAY), NOW)).toBe('Dec 27');
  });
  it('a few seconds ahead (clock skew) is "just now", not "in 0 min"', () => {
    expect(relativeTime(at(20 * 1000), NOW)).toBe('just now');
  });
  it('never contains a minus sign, "ago" for the future, or NaN, across a sweep of offsets', () => {
    for (let h = -24 * 30; h <= 24 * 90; h += 7) {
      const s = relativeTime(at(h * HOUR + 13 * MIN), NOW);
      expect(s, `offset ${h} h`).not.toMatch(/-|NaN|undefined/);
      if (h > 0) expect(s, `offset ${h} h`).not.toMatch(/ago/);
      if (h < -1) expect(s, `offset ${h} h`).not.toMatch(/^in /);
    }
  });
  it('returns an empty string for a bad date', () => expect(relativeTime('not a date', NOW)).toBe(''));
});

describe('formatters that wrap it', () => {
  it('components timeAgo handles the future', () => {
    expect(timeAgo(at(3 * DAY), NOW)).toBe('in 3 days');
    expect(timeAgo(at(-3 * HOUR), NOW)).toBe('3 hr ago');
  });
  it('email timeAgo keeps its past style and gains a future style', () => {
    const now = new Date(NOW);
    expect(emailTimeAgo(at(-1 * MIN), now)).toBe('just now');
    expect(emailTimeAgo(at(-90 * MIN), now)).toBe('2 hr ago');
    expect(emailTimeAgo(at(-3 * DAY), now)).toBe('3 days ago');
    expect(emailTimeAgo(at(3 * HOUR), now)).toBe('in 3 hr');
    expect(emailTimeAgo(at(3 * DAY), now)).toBe('in 3 days');
  });
  it('the digest shows an upcoming event as "in 3 days", not "ago"', () => {
    const r = renderDigest({
      businessName: 'Acme',
      items: [{ kind: 'event', title: 'Stadium concert', place: 'Atlanta, GA', occurredAt: at(3 * DAY) }],
      appUrl: 'https://holler.example/app',
      unsubscribeUrl: 'https://holler.example/u',
      now: new Date(NOW),
    });
    expect(r.html).toContain('in 3 days');
    expect(r.text).toContain('in 3 days');
    expect(r.html + r.text).not.toMatch(/-\d+ (min|hr|days)|\d+ days ago/);
  });
  it('public page time says "Starts" for an event that has not happened as of the page data time', () => {
    expect(fmtItemTime(at(2 * DAY), at(0))).toBe('Starts Nov 19, 12:00 UTC');
    expect(fmtItemTime(at(-2 * DAY), at(0))).toBe('Nov 15, 12:00 UTC');
  });
});

describe('isUpcoming and newestPast', () => {
  it('isUpcoming ignores clock skew under a minute', () => {
    expect(isUpcoming(at(30 * 1000), NOW)).toBe(false);
    expect(isUpcoming(at(2 * MIN), NOW)).toBe(true);
    expect(isUpcoming(at(-2 * MIN), NOW)).toBe(false);
  });
  it('newestPast skips future times and returns null when there is none', () => {
    expect(newestPast([at(3 * DAY), at(-2 * DAY), at(-5 * DAY)], NOW)).toBe(at(-2 * DAY));
    expect(newestPast([at(3 * DAY)], NOW)).toBeNull();
    expect(newestPast([], NOW)).toBeNull();
  });
});

describe('orderLatest', () => {
  const t = (s: string) => s;
  it('upcoming first in start order, then the rest newest first', () => {
    const items = [at(-1 * DAY), at(9 * DAY), at(-3 * HOUR), at(2 * DAY), at(-5 * DAY)];
    expect(orderLatest(items, t, NOW)).toEqual([at(2 * DAY), at(9 * DAY), at(-3 * HOUR), at(-1 * DAY), at(-5 * DAY)]);
  });
  it('maxUpcoming drops the later ones, never the recent records', () => {
    const items = [at(1 * DAY), at(2 * DAY), at(3 * DAY), at(-1 * HOUR)];
    expect(orderLatest(items, t, NOW, { maxUpcoming: 2 })).toEqual([at(1 * DAY), at(2 * DAY), at(-1 * HOUR)]);
  });
});

const check = (id: number, kind: string, offsetMs: number): CheckItem => ({ id, kind, source: 'x', title: `t${id}`, url: null, place: null, occurredAt: at(offsetMs), severity: 2 });

describe('checker ordering (groupItems)', () => {
  it('shows upcoming events soonest first inside the Events group, then past events newest first', () => {
    const g = groupItems([check(1, 'event', -2 * DAY), check(2, 'event', 5 * DAY), check(3, 'event', 1 * DAY), check(4, 'event', -1 * DAY)], NOW);
    expect(g).toHaveLength(1);
    expect(g[0].items.map((i) => i.id)).toEqual([3, 2, 4, 1]);
  });
  it('a far-future event does not pin its group above groups with recent records', () => {
    const g = groupItems([check(1, 'event', 13 * DAY), check(2, 'alert', -10 * MIN), check(3, 'permit', -2 * DAY)], NOW);
    expect(g.map((x) => x.id)).toEqual(['weather', 'permit', 'event']);
  });
  it('other groups stay newest first, and a dozen upcoming events do not crowd out the permits', () => {
    const many = Array.from({ length: 30 }, (_, i) => check(i + 1, 'permit', -(i + 1) * HOUR));
    const events = Array.from({ length: 12 }, (_, i) => check(100 + i, 'event', (i + 1) * DAY));
    const g = groupItems([...events, ...many], NOW);
    expect(g.reduce((n, x) => n + x.items.length, 0)).toBeLessThanOrEqual(MAX_ITEMS);
    const permits = g.find((x) => x.id === 'permit')!;
    expect(permits.items.map((i) => i.id).slice(0, 3)).toEqual([1, 2, 3]);
    expect(permits.items.length).toBeGreaterThanOrEqual(8);
    const ev = g.find((x) => x.id === 'event')!;
    expect(ev.items[0].id).toBe(100);
  });
});

const trade = (id: number, kind: string, offsetMs: number): TradeSignalItem => ({ id, source: 'x', kind, title: `t${id}`, url: null, city: null, state: null, occurredAt: at(offsetMs) });

describe('trade page ordering (orderTradeItems)', () => {
  it('leads with at most 3 upcoming events, soonest first, then newest first, 10 in all', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => trade(100 + i, 'event', (5 - i) * DAY)),
      ...Array.from({ length: 12 }, (_, i) => trade(i + 1, 'permit', -(i + 1) * HOUR)),
    ];
    const out = orderTradeItems(items, NOW);
    expect(out).toHaveLength(TRADE_LIST_LIMIT);
    expect(out.slice(0, TRADE_UPCOMING_LIMIT).map((i) => i.id)).toEqual([104, 103, 102]);
    expect(out.slice(TRADE_UPCOMING_LIMIT).map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('with nothing upcoming it is plain newest first', () => {
    const out = orderTradeItems([trade(1, 'permit', -3 * DAY), trade(2, 'permit', -1 * DAY)], NOW);
    expect(out.map((i) => i.id)).toEqual([2, 1]);
  });
});

const row = (id: number, kind: string, offsetMs: number, extra: Partial<SignalRowDb> = {}): SignalRowDb => ({
  id, source: 'x', kind, title: `t${id}`, summary: null, url: null, categories: ['roofing'], severity: 1, occurred_at: at(offsetMs), expires_at: null, ...extra,
});

describe('city page data (summarize)', () => {
  const nowIso = at(0);
  it('latestAt and the intro never name a future date', () => {
    const d = summarize('atlanta-ga', [row(1, 'event', 6 * DAY), row(2, 'permit', -2 * DAY), row(3, 'permit', -4 * DAY)], nowIso);
    expect(d.latestAt).toBe(at(-2 * DAY));
  });
  it('events further out than the upcoming window are left out entirely', () => {
    const d = summarize('atlanta-ga', [row(1, 'event', (UPCOMING_DAYS + 5) * DAY), row(2, 'permit', -1 * DAY)], nowIso);
    expect(d.total).toBe(1);
    expect(d.sections.events).toBeUndefined();
  });
  it('events starting within the next 7 days count as this week, later ones do not', () => {
    const d = summarize('atlanta-ga', [row(1, 'event', 3 * DAY), row(2, 'event', 10 * DAY), row(3, 'event', -2 * DAY)], nowIso);
    expect(d.weekCounts.events).toBe(2);
    expect(d.windowCounts.events).toBe(3);
  });
  it('the Events section lists upcoming events soonest first, before past ones', () => {
    const d = summarize('atlanta-ga', [row(1, 'event', -1 * DAY), row(2, 'event', 4 * DAY), row(3, 'event', 2 * DAY)], nowIso);
    expect(d.sections.events!.map((i) => i.id)).toEqual([3, 2, 1]);
  });
  it('the intro text for a place with only an upcoming event does not crash and names no future date', () => {
    const d = summarize('atlanta-ga', [row(1, 'event', 3 * DAY), row(2, 'permit', -2 * DAY)], nowIso);
    // INT2: without the header summary the intro says the date range it counted (with one, the summary carries the counts).
    const text = buildIntro({ slug: 'atlanta-ga', name: 'Atlanta', state: 'GA' }, d, null);
    expect(text).toContain('Nov 15, 2026');
    expect(text).not.toContain('Nov 20, 2026');
  });
});
