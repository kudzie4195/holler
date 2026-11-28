/**
 * Round 35: the new season rows on /check and /es/check, rendered through the real pages (same harness as check.test.ts). With
 * HOLLER_SEASON_R35_ENABLED off the page has no new line; on, it has one, in English and in Spanish, with its public source.
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
import { coverageFor } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { lookupZip } from '@/lib/geo';
import { SEASON_TABLE_R35 } from '@/lib/season/table-r35';
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

const row = (id: string) => SEASON_TABLE_R35.find((r) => r.id === id)!;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
const state = (zip: string, trade: string) => {
  const p = lookupZip(zip)!;
  return coverageFor(p, trade, isServedZip(p)).state;
};
const ITEM = { id: 1, kind: 'permit', source: 'x', title: 'Roof permit', url: null, place: 'Raleigh, NC', occurredAt: '2027-03-30T12:00:00Z', severity: 1, delivery: 'email' };

beforeEach(() => {
  loadCheck.mockResolvedValue({ ok: true, clipped: false, checkedAt: '2027-03-31T12:00:00Z', items: [ITEM] });
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// [zip, trade, clock, row id]: each pair is a member the page serves (not waitlist) on a day inside the row's window.
const CASES: [string, string, string, string][] = [
  ['27601', 'siding-gutters', '2027-04-20T15:00:00Z', 'pollen-gutters-raleigh'],
  ['28202', 'siding-gutters', '2027-04-20T15:00:00Z', 'pollen-gutters-charlotte'],
  ['30303', 'siding-gutters', '2027-04-20T15:00:00Z', 'pollen-gutters-atlanta'],
  ['27601', 'cleaning', '2027-03-31T15:00:00Z', 'pollen-cleaning-raleigh'],
  ['78701', 'cleaning', '2027-03-31T15:00:00Z', 'pollen-cleaning-austin'],
  ['78701', 'pressure-washing', '2027-04-10T15:00:00Z', 'pollen-wash-austin'],
  ['27601', 'lawn-care', '2027-09-01T15:00:00Z', 'armyworm-raleigh'],
  ['78701', 'lawn-care', '2027-09-15T15:00:00Z', 'armyworm-austin'],
];

describe('/check and /es/check: the round 35 rows', () => {
  for (const [lang, page, dict] of [['en', CheckPage, en], ['es', CheckPageEs, es]] as const) {
    for (const [zip, trade, clock, id] of CASES) {
      it(`${lang}: ${zip} ${trade} on ${clock.slice(0, 10)}: switch on shows ${id} with its public source (nothing on a waitlist cell); switch off shows no new line`, async () => {
        const waitlist = state(zip, trade) === 'waitlist';
        vi.setSystemTime(new Date(clock));
        vi.stubEnv('HOLLER_SEASON_R35_ENABLED', '1');
        const on = await render(page, { zip, trade });
        const r = row(id);
        if (waitlist) {
          expect(on, `${id} waitlist, switch on`).not.toContain('data-season=');
        } else {
          expect(on, id).toContain(`data-season="${id}"`);
          expect(on).toContain(esc(lang === 'en' ? r.en : r.es));
          expect(on).toContain(`href="${r.source}"`);
          expect(on).toContain(`>${dict['season.source']}<`);
        }
        vi.stubEnv('HOLLER_SEASON_R35_ENABLED', '');
        const off = await render(page, { zip, trade });
        for (const rr of SEASON_TABLE_R35) expect(off, `${id} off, ${rr.id}`).not.toContain(`data-season="${rr.id}"`);
      });
    }
    // review: the two new rows no /check page can show, with the switch on (Charlotte lawn care and house cleaning are waitlist cells)
    for (const [zip, trade, clock] of [['28202', 'lawn-care', '2027-09-01T15:00:00Z'], ['28202', 'cleaning', '2027-03-31T15:00:00Z']] as const) {
      it(`${lang}: ${zip} ${trade} is a waitlist page and shows no season line even with the switch on`, async () => {
        expect(state(zip, trade)).toBe('waitlist');
        vi.setSystemTime(new Date(clock));
        vi.stubEnv('HOLLER_SEASON_R35_ENABLED', '1');
        const html = await render(page, { zip, trade });
        expect(html).not.toContain('data-season=');
        expect(html).not.toContain(dict['season.h']);
      });
    }
  }
  it('at least six of the eight cases are served (not waitlist), so the test above is not empty', () => {
    expect(CASES.filter(([zip, trade]) => state(zip, trade) !== 'waitlist').length).toBeGreaterThanOrEqual(6);
  });
});
