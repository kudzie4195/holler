import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CHECK_MAX_VIEWS, CHECK_WINDOW_SECONDS, checkIpLimit, gateCheck } from '@/lib/check/limit';
import { CheckResults, type CheckMode } from '@/components/check-results';
import { watchList, watchTypes } from '@/lib/check/watch';
import { CITY_FEEDS, TRADE_SIGNALS } from '@/lib/signals/capabilities';
import { CITY_TYPES } from '@/lib/seo/signal-types';
import { CATEGORIES } from '@/lib/signals/categories';
import { TRIAL_DAYS } from '@/lib/auth/membership';

describe('per-IP rate limit on the results view', () => {
  it('hashes the IP into the key and uses the shared limiter shape', () => {
    const l = checkIpLimit('203.0.113.9');
    expect(l.key).toMatch(/^check:ip:[0-9a-f]{32}$/);
    expect(l.key).not.toContain('203.0.113.9');
    expect(l.max).toBe(CHECK_MAX_VIEWS);
    expect(l.windowSeconds).toBe(CHECK_WINDOW_SECONDS);
  });
  it('maps limiter answers to gate states, never throwing', async () => {
    expect(await gateCheck('1.1.1.1', async () => 'allowed')).toBe('allowed');
    expect(await gateCheck('1.1.1.1', async () => 'limited')).toBe('limited');
    expect(await gateCheck('1.1.1.1', async () => 'error')).toBe('unavailable');
    expect(await gateCheck('1.1.1.1', async () => { throw new Error('not configured'); })).toBe('unavailable');
  });
  it('counts one hit against the check key', async () => {
    const hit = vi.fn(async () => 'allowed' as const);
    await gateCheck('9.9.9.9', hit);
    expect(hit).toHaveBeenCalledTimes(1);
    expect((hit.mock.calls as unknown as unknown[][])[0][0]).toEqual([checkIpLimit('9.9.9.9')]);
  });
});

const NOW = Date.UTC(2026, 10, 17, 12, 0);
const render = (mode: CheckMode, over: Partial<Parameters<typeof CheckResults>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(CheckResults, {
      items: [],
      mode,
      checkedAt: new Date(NOW - 5 * 60_000).toISOString(),
      placeLabel: 'Absarokee, MT',
      trade: 'roofing',
      tradeLabel: 'Roofing',
      citySlug: null,
      watches: watchList('roofing', null),
      now: NOW,
      ...over,
    }),
  );

describe('checker states', () => {
  it('limited: friendly "try again in a minute", watch list, trial CTA, no error text', () => {
    const html = render('limited');
    expect(html).toContain('Try again in a minute');
    expect(html).toContain('What Holler watches');
    expect(html).toContain(`${TRIAL_DAYS} days free`);
    expect(html.toLowerCase()).not.toContain('error');
  });
  it('uncovered territory: says plainly that Holler does not cover it yet, no watch list', () => {
    const html = render('uncovered', { placeLabel: 'San Juan, PR' });
    expect(html).toContain('Holler does not cover San Juan, PR yet');
    expect(html).not.toContain('What Holler watches');
  });
  it('empty results use the honest "about 25 to 50 miles" wording and do not promise instant alerts', () => {
    const html = render('results');
    expect(html).toContain('within about 25 to 50 miles of Absarokee, MT');
    expect(html).not.toMatch(/the moment/i);
    expect(html).toContain('every 15 minutes to 12 hours');
    expect(html).toContain('at most once an hour');
  });
  it('a source link is at least 44px tall', () => {
    const html = render('results', {
      items: [{ id: 1, kind: 'report', source: 'spc', title: 'Hail near Absarokee', url: 'https://www.spc.noaa.gov/', place: 'MT', occurredAt: new Date(NOW - 3600_000).toISOString(), severity: 2 }],
    });
    expect(html).toMatch(/<a [^>]*class="[^"]*min-h-11[^"]*"[^>]*>Source:/);
  });
  it('no em dashes in any state', () => {
    for (const m of ['results', 'unreadable', 'limited', 'uncovered'] as CheckMode[]) expect(render(m)).not.toMatch(/[—–]/);
  });
});

describe('the "watching" list names only what is really sent', () => {
  it('Absarokee, MT (no city feed) lists no permits, 311, inspections or violations', () => {
    const types = watchTypes('roofing', null);
    for (const t of CITY_TYPES) expect(types).not.toContain(t);
    expect(watchList('roofing', null).join(' ')).not.toMatch(/permit/i);
  });
  it('Atlanta lists permits for roofing because Atlanta has a permit feed and roofing receives permits', () => {
    expect(CITY_FEEDS['atlanta-ga']).toContain('permit');
    expect(watchTypes('roofing', 'atlanta-ga')).toContain('permit');
  });
  it('every listed type is received by the trade, and every city type is in that city\'s feed, for all trades and all feed cities', () => {
    for (const c of CATEGORIES) {
      for (const slug of [null, ...Object.keys(CITY_FEEDS)]) {
        for (const t of watchTypes(c.id, slug)) {
          expect(TRADE_SIGNALS[c.id], `${c.id}/${t}`).toContain(t);
          if (CITY_TYPES.includes(t)) expect(CITY_FEEDS[slug as string], `${c.id}/${slug}/${t}`).toContain(t);
        }
      }
    }
  });
  it('never mentions outages', () => {
    for (const c of CATEGORIES) expect(watchList(c.id, 'atlanta-ga').join(' ')).not.toMatch(/outage/i);
  });
});
