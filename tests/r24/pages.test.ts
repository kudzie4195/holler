// Round 24 site unit: every public surface asks one function (lib/check/cells.ts coverageFor) and a waitlist answer never shows a
// price, a trial offer or a link to /signup anywhere on the page, the FAQ structured data included.
// The record loaders are mocked (no database); the ZIP lookup, the feed catalogue, the cell table and the pages are real.
import { describe, expect, it, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {}, after: () => {} }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.5' }) }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics/request', () => ({ eventContext: async () => null, trackVisitorStep: async () => {} }));
vi.mock('@/lib/auth/ratelimit', () => ({ hit: async () => 'allowed', clientIp: () => '203.0.113.5' }));
vi.mock('@/lib/check/load', () => ({ loadCheck: async () => ({ ok: true, items: [], checkedAt: new Date().toISOString() }) }));
vi.mock('@/lib/signals/source-state-snapshot', () => ({ loadSourceStateSnapshot: async () => null }));
vi.mock('@/lib/seo/data', async () => {
  const { emptyPlaceData } = await import('@/lib/seo/summarize');
  return {
    loadPlaceData: async (slug: string) => ({
      ...emptyPlaceData(slug, '2026-11-23T12:00:00.000Z', true),
      total: 12,
      latestAt: '2026-11-22T12:00:00.000Z',
      earliestAt: '2026-10-30T12:00:00.000Z',
      sources: ['nws'],
    }),
  };
});
vi.mock('@/lib/seo/trade-data', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/trade-data')>()),
  loadTradeSignals: async (trade: string) => ({ ok: true, trade, asOf: '2026-11-23T12:00:00.000Z', items: [] }),
}));

import CityPage from '@/app/local/[state]/[city]/page';
import TradePage, { generateMetadata as tradeMetadata } from '@/app/for/[trade]/page';
import CheckPage from '@/app/check/page';
import CheckPageEs from '@/app/es/check/page';
import { CITIES, cityBySlug, lookupZip, stateSlugFor } from '@/lib/geo';
import { cityOffer, cityServed, cityTradeRows } from '@/lib/seo/city-offer';
import { checkAnswer } from '@/lib/check/answer';
import { coverageFor, signupClosedTrades } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { CATEGORIES } from '@/lib/signals/categories';
import { tradeOffer } from '@/lib/seo/trade-view';

const NO_OFFER = (html: string, where: string) => {
  expect(html, where).not.toMatch(/free trial|prueba gratis/i);
  expect(html, where).not.toContain('$7.99');
  expect(html, where).not.toMatch(/href="\/(es\/)?signup/);
};
const ldBlocks = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const v = JSON.parse(m[1]);
    return Array.isArray(v) ? v : [v];
  });
const faqLdText = (html: string) =>
  ldBlocks(html)
    .filter((b) => b['@type'] === 'FAQPage')
    .flatMap((b) => b.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => `${q.name} ${q.acceptedAnswer.text}`))
    .join(' ');

async function renderCity(slug: string): Promise<string> {
  const city = cityBySlug(slug)!;
  const el = await CityPage({ params: Promise.resolve({ state: stateSlugFor(city.state)!, city: city.slug }) });
  return renderToStaticMarkup(el as ReactElement);
}
async function renderTrade(id: string): Promise<string> {
  const el = await TradePage({ params: Promise.resolve({ trade: id }) });
  return renderToStaticMarkup(el as ReactElement);
}
type Props = { searchParams: Promise<Record<string, string>> };
function findAsync(node: ReactNode): ReactElement<Props> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findAsync(n);
      if (f) return f;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { searchParams?: unknown; children?: ReactNode };
  if (props.searchParams && typeof node.type === 'function') return node as ReactElement<Props>;
  if (typeof node.type === 'function' && !props.children) return findAsync((node.type as (p: unknown) => ReactNode)(node.props));
  return findAsync(props.children);
}
async function renderCheck(sp: Record<string, string>, lang: 'en' | 'es' = 'en') {
  const page = lang === 'en' ? CheckPage : CheckPageEs;
  const check = findAsync(page({ searchParams: Promise.resolve(sp) } as never) as ReactElement);
  const out = await (check!.type as (p: Props) => Promise<ReactNode>)(check!.props);
  const html = renderToStaticMarkup(createElement('div', null, out));
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ') };
}

describe('every waitlist city page: no price, no trial, no sign-up link, FAQ structured data included', () => {
  const waitlist = CITIES.filter((c) => cityOffer(c).state === 'waitlist');
  it(`covers all ${'waitlist'} cities (more than 600 of the 950)`, () => expect(waitlist.length).toBeGreaterThan(600));
  it('renders each one', async () => {
    for (const c of waitlist) {
      const html = await renderCity(c.slug);
      NO_OFFER(html, c.slug);
      const faq = faqLdText(html);
      expect(faq, c.slug).toContain('is not ready for');
      NO_OFFER(faq, `${c.slug} FAQPage`);
    }
  }, 300_000);
  it('Valdosta: the FAQ answer and its structured data say the waitlist sentence', async () => {
    const html = await renderCity('valdosta-ga');
    expect(faqLdText(html)).toContain('Holler is not ready for Valdosta, GA yet. Check your ZIP code and leave your email, and we will tell you when it is.');
    expect(html).toContain('Join the Valdosta list');
  });
  it('a live city still carries the offer (the check above is not vacuous)', async () => {
    const html = await renderCity('atlanta-ga');
    expect(cityOffer(cityBySlug('atlanta-ga')!).state).toBe('live');
    expect(html).toContain('href="/signup?city=atlanta-ga"');
    expect(faqLdText(html)).toContain('$7.99');
  });
  it('a limited city (Boston, not measured) has no price in the hero and says it was not measured', async () => {
    const html = await renderCity('boston-ma');
    expect(cityOffer(cityBySlug('boston-ma')!)).toMatchObject({ state: 'limited', measured: false });
    expect(html).toContain('has not measured how much work they hold for each trade yet');
    expect(html).not.toContain('href="/signup?city=boston-ma"');
    expect(html).not.toContain('$7.99/mo');
  });
});

describe('every waitlist trade page: no price, no trial, no sign-up link, structured data included', () => {
  const closed = signupClosedTrades();
  it('the waitlist trade pages are exactly the closed trades', () => {
    expect(CATEGORIES.map((c) => c.id as string).filter((t) => tradeOffer(t) === 'waitlist').sort()).toEqual([...closed].sort());
  });
  it('renders each one, with its metadata', async () => {
    for (const id of closed) {
      const html = await renderTrade(id);
      NO_OFFER(html, id);
      NO_OFFER(faqLdText(html), `${id} FAQPage`);
      for (const b of ldBlocks(html)) expect(b.offers, `${id} ${b['@type']}`).toBeUndefined();
      expect(html).toContain(`href="/check?trade=${id}"`);
      expect(html).toContain('Check your ZIP');
      const meta = await tradeMetadata({ params: Promise.resolve({ trade: id }) });
      NO_OFFER(String(meta.description), `${id} meta`);
    }
  }, 120_000);
  it('plumbing: the call to action is the check and the list', async () => {
    const html = await renderTrade('plumbing');
    expect(html).toContain('Holler is not taking sign-ups for plumbing yet.');
    expect(html).not.toContain('before the phone starts ringing');
  });
  it('a storm trade (roofing) has no Start free and no price line, but says how storm alerts work', async () => {
    const html = await renderTrade('roofing');
    // Only the site header's "Start free" (sign-up is open for roofing); none in the page body.
    expect(html.match(/href="\/signup"/g)).toHaveLength(1);
    expect(html.slice(html.indexOf('<main'))).not.toContain('href="/signup"');
    expect(html.slice(html.indexOf('<main'))).not.toContain('a month or $79.99 a year, with a');
    expect(html).toContain('Storm alerts for roofing arrive when a storm hits near you.');
  });
  it('a live trade (landscaping) keeps the full offer', async () => {
    const html = await renderTrade('landscaping');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('$7.99');
  });
});

describe('/check: a waitlist answer has no offer; the header button follows the same answer', () => {
  it('Dallas 75201 lawn care (waitlist): the card, no price, no trial, no sign-up link, in English and Spanish', async () => {
    const en = await renderCheck({ zip: '75201', trade: 'lawn-care' });
    NO_OFFER(en.html, 'en');
    expect(en.text).toContain('Not enough lawn care work near Dallas, TX yet.');
    const es = await renderCheck({ zip: '75201', trade: 'lawn-care' }, 'es');
    NO_OFFER(es.html, 'es');
    expect(es.text).toContain('Todavía no hay suficiente trabajo de cuidado del césped cerca de Dallas, TX');
    expect(checkAnswer('75201', 'lawn-care')?.state).toBe('waitlist');
  });
});

describe('the city page and the ZIP check agree, place by place and trade by trade', () => {
  const cases: Array<{ zip: string; city: string; trade: string; want: { state: string; measured: boolean; storm: boolean }; label: string }> = [
    { label: 'live', zip: '30318', city: 'atlanta-ga', trade: 'landscaping', want: { state: 'live', measured: true, storm: false } },
    { label: 'limited, measured', zip: '30318', city: 'atlanta-ga', trade: 'lawn-care', want: { state: 'limited', measured: true, storm: false } },
    { label: 'limited, not measured', zip: '02108', city: 'boston-ma', trade: 'landscaping', want: { state: 'limited', measured: false, storm: false } },
    { label: 'waitlist', zip: '75201', city: 'dallas-tx', trade: 'lawn-care', want: { state: 'waitlist', measured: true, storm: false } },
    { label: 'storm', zip: '30318', city: 'atlanta-ga', trade: 'siding-gutters', want: { state: 'limited', measured: true, storm: true } },
    { label: 'unserved waitlist', zip: '31601', city: 'valdosta-ga', trade: 'landscaping', want: { state: 'waitlist', measured: false, storm: false } },
  ];
  it.each(cases)('$label: $zip / $city / $trade', async ({ zip, city, trade, want }) => {
    const place = lookupZip(zip)!;
    const c = cityBySlug(city)!;
    // the ZIP check
    const check = checkAnswer(zip, trade)!;
    expect(check).toMatchObject(want);
    expect(coverageFor(place, trade, isServedZip(place))).toEqual(check);
    // the city page's own answer for that trade, and what the rendered page prints for it
    const row = cityTradeRows(c, cityServed(c)).find((r) => r.id === trade)!;
    expect({ state: row.state, measured: row.measured, storm: row.storm }).toEqual(want);
    const html = await renderCity(city);
    expect(html).toContain(`data-trade="${trade}" data-state="${want.state}"`);
    // and the rendered check says the same in words
    const { html: chk, text } = await renderCheck({ zip, trade });
    if (want.state === 'waitlist') NO_OFFER(chk, `${zip} ${trade}`);
    if (want.state === 'limited' && !want.measured) expect(text).toContain('Holler has not measured landscaping work near Boston, MA yet');
    if (want.storm) expect(text).toContain('Storm alerts for siding and gutters arrive when a storm hits near you.');
    if (want.state === 'live') expect(chk).toContain('href="/signup?city=');
  }, 60_000);
});
