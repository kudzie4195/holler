/**
 * Round 30: "This week in your area" on /check and /es/check (components/check-results.tsx SeasonNote, app/check/page.tsx). Rendered
 * through the real pages with the clock at Dec 1 2026: one line under the verdict block on a live or limited answer, never on a waitlist
 * page, nothing when no row applies.
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {}, after: (fn: () => unknown) => void fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics/request', () => ({ eventContext: async () => null, trackVisitorStep: async () => {} }));
const loadCheck = vi.hoisted(() => vi.fn());
vi.mock('@/lib/check/load', () => ({ loadCheck }));
vi.mock('@/lib/check/limit', () => ({ gateCheck: async () => 'ok' }));
vi.mock('@/lib/signals/source-state-snapshot', () => ({ loadSourceStateSnapshot: async () => null }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import CheckPage from '@/app/check/page';
import CheckPageEs from '@/app/es/check/page';
import { CheckResults } from '@/components/check-results';
import { coverageFor } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { lookupZip } from '@/lib/geo';
import { SEASON_TABLE } from '@/lib/season/table';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';

type Props = { searchParams: Promise<Record<string, string>> };
const findAsync = (node: ReactNode): ReactElement<Props> | null => {
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
};
async function render(page: typeof CheckPage | typeof CheckPageEs, sp: Record<string, string>): Promise<string> {
  const tree = page({ searchParams: Promise.resolve(sp) } as never) as ReactElement;
  const check = findAsync(tree);
  const out = check ? await (check.type as (p: Props) => Promise<ReactNode>)(check.props) : null;
  return renderToStaticMarkup(createElement('div', null, out));
}

const row = (id: string) => SEASON_TABLE.find((r) => r.id === id)!;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
const state = (zip: string, trade: string) => {
  const p = lookupZip(zip)!;
  return coverageFor(p, trade, isServedZip(p)).state;
};
const ITEM = { id: 1, kind: 'permit', source: 'x', title: 'Roof permit', url: null, place: 'Charlotte, NC', occurredAt: '2026-11-28T12:00:00Z', severity: 1, delivery: 'email' };

beforeEach(() => {
  loadCheck.mockResolvedValue({ ok: true, clipped: false, checkedAt: '2026-12-01T12:00:00Z', items: [ITEM] });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-01T15:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('/check and /es/check on Dec 1 2026', () => {
  for (const [lang, page, dict] of [['en', CheckPage, en], ['es', CheckPageEs, es]] as const) {
    it(`${lang}: Charlotte 28202 siding and gutters (${state('28202', 'siding-gutters')}): the gutter line under the verdict, with its public source`, async () => {
      expect(state('28202', 'siding-gutters')).not.toBe('waitlist');
      const html = await render(page, { zip: '28202', trade: 'siding-gutters' });
      const r = row('gutters-charlotte');
      expect(html).toContain('data-testid="check-season"');
      expect(html).toContain(`data-season="gutters-charlotte"`);
      expect(html).toContain(esc(lang === 'en' ? r.en : r.es));
      expect(html).toContain(`${dict['season.h']}: `);
      expect(html).toContain(`href="${r.source}"`);
      expect(html).toContain(`>${dict['season.source']}<`);
      const v = html.indexOf('data-testid="check-verdict"');
      expect(v).toBeGreaterThan(-1);
      expect(html.indexOf('data-testid="check-season"')).toBeGreaterThan(v);
      expect(html.indexOf('data-testid="check-season"')).toBeLessThan(html.indexOf('id="check-heading"'));
      expect(html.split('data-season=').length - 1).toBe(1);
    });
    it(`${lang}: Charlotte 28202 landscaping: the leaf clean-up line`, async () => {
      expect(state('28202', 'landscaping')).not.toBe('waitlist');
      const html = await render(page, { zip: '28202', trade: 'landscaping' });
      expect(html).toContain('data-season="leaf-cleanup-charlotte"');
      expect(html).toContain(esc(lang === 'en' ? row('leaf-cleanup-charlotte').en : row('leaf-cleanup-charlotte').es));
    });
    it(`${lang}: Charlotte 28202 pressure washing (the composite chip) gets the gutter line through siding-gutters`, async () => {
      expect(state('28202', 'pressure-washing')).not.toBe('waitlist');
      const html = await render(page, { zip: '28202', trade: 'pressure-washing' });
      expect(html).toContain('data-season="gutters-charlotte"');
    });
    it(`${lang}: a limited cell (Raleigh 27601 siding and gutters, ${state('27601', 'siding-gutters')}) shows it too`, async () => {
      expect(state('27601', 'siding-gutters')).toBe('limited');
      const html = await render(page, { zip: '27601', trade: 'siding-gutters' });
      expect(html).toContain('data-season="gutters-raleigh"');
    });
    it(`${lang}: no line on a waitlist page, though a row applies to the trade (Charlotte lawn care: leaf clean-up)`, async () => {
      expect(state('28202', 'lawn-care')).toBe('waitlist');
      expect(row('leaf-cleanup-charlotte').trades).toContain('lawn-care');
      const html = await render(page, { zip: '28202', trade: 'lawn-care' });
      expect(html).not.toContain('check-season');
      expect(html).not.toContain('data-season=');
      expect(html).not.toContain(dict['season.h']);
    });
    it(`${lang}: Austin 78701 siding and gutters: nothing`, async () => {
      const html = await render(page, { zip: '78701', trade: 'siding-gutters' });
      expect(html).not.toContain('data-season=');
      expect(html).not.toContain(dict['season.h']);
    });
    it(`${lang}: an empty list still shows the line under the verdict`, async () => {
      loadCheck.mockResolvedValue({ ok: true, clipped: false, checkedAt: '2026-12-01T12:00:00Z', items: [] });
      const html = await render(page, { zip: '28202', trade: 'siding-gutters' });
      if (html.includes('data-testid="check-verdict"')) {
        expect(html.indexOf('data-season="gutters-charlotte"')).toBeGreaterThan(html.indexOf('data-testid="check-verdict"'));
      } else {
        expect(html).toContain('data-season="gutters-charlotte"');
      }
    });
  }
  it('Jul 1: no line anywhere', async () => {
    vi.setSystemTime(new Date('2026-07-01T15:00:00Z'));
    for (const [zip, trade] of [['28202', 'siding-gutters'], ['28202', 'landscaping'], ['27601', 'siding-gutters'], ['78701', 'landscaping']]) {
      for (const page of [CheckPage, CheckPageEs]) expect(await render(page, { zip, trade }), `${zip} ${trade}`).not.toContain('data-season=');
    }
  });
});

describe('CheckResults: the component never shows the line on a waitlist answer', () => {
  const base = {
    items: [ITEM] as never[], mode: 'results' as const, checkedAt: '2026-12-01T12:00:00Z', placeLabel: 'Charlotte, NC', trade: 'siding-gutters', tradeLabel: 'Siding and gutters',
    citySlug: 'charlotte-nc', watches: [], now: Date.parse('2026-12-01T15:00:00Z'), verdict: { state: 'live' as const, head: 'Worth a trial here.', count: null },
    season: [{ id: 'gutters-charlotte', text: row('gutters-charlotte').en, source: row('gutters-charlotte').source }],
  };
  it('live and limited: shown; waitlist: not, with or without records', () => {
    for (const coverageState of ['live', 'limited'] as const) {
      expect(renderToStaticMarkup(createElement(CheckResults, { ...base, coverageState } as never))).toContain('data-season="gutters-charlotte"');
    }
    for (const items of [[ITEM], []]) {
      expect(renderToStaticMarkup(createElement(CheckResults, { ...base, items, coverageState: 'waitlist' } as never))).not.toContain('data-season=');
    }
  });
  it('no season passed, or an empty list: the page is exactly as before', () => {
    const without = renderToStaticMarkup(createElement(CheckResults, { ...base, season: undefined, coverageState: 'live' } as never));
    expect(renderToStaticMarkup(createElement(CheckResults, { ...base, season: [], coverageState: 'live' } as never))).toBe(without);
    expect(renderToStaticMarkup(createElement(CheckResults, { ...base, season: null, coverageState: 'live' } as never))).toBe(without);
    expect(without).not.toContain('check-season');
  });
});
