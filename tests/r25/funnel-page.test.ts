// Round 25 part 4: the area_check event path is the answer the visitor got (/check/live, /check/limited, /check/waitlist,
// /es/check/<state>), never a ZIP or a trade. Rendered through the real /check and /es/check pages; the page body also shows the verdict
// block from the same coverageFor answer.
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tracked = vi.hoisted(() => [] as Array<{ name: string; path: string }>);
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {}, after: (fn: () => unknown) => void fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics/request', () => ({ eventContext: async () => ({}), trackVisitorStep: async (name: string, _ctx: unknown, path: string) => void tracked.push({ name, path }) }));
const loadCheck = vi.hoisted(() => vi.fn());
vi.mock('@/lib/check/load', () => ({ loadCheck }));
vi.mock('@/lib/check/limit', () => ({ gateCheck: async () => 'ok' }));
vi.mock('@/lib/signals/source-state-snapshot', () => ({ loadSourceStateSnapshot: async () => null }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import CheckPage from '@/app/check/page';
import CheckPageEs from '@/app/es/check/page';
import { areaCheckPath } from '@/lib/check/funnel';
import { cleanPath } from '@/lib/analytics/attr';
import { coverageFor } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { lookupZip } from '@/lib/geo';

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

const CASES: Array<[string, string]> = [
  ['28202', 'siding-gutters'], // live (R35: Charlotte landscaping was re-measured to limited)
  ['27601', 'siding-gutters'], // limited (storm cell)
  ['28202', 'lawn-care'], // waitlist
  ['28202', 'pressure-washing'], // the composite cell: live
];

describe('area_check path = the answer given', () => {
  beforeEach(() => {
    tracked.length = 0;
    loadCheck.mockResolvedValue({
      ok: true,
      clipped: false,
      checkedAt: '2026-11-23T12:00:00Z',
      // R25 check fix (review R25CHECK P1-2): a live cell with nothing counted says "too early", so the mock carries one emailed record
      // and the block shows the cell's own answer.
      items: [{ id: 1, kind: 'permit', source: 'x', title: 'Roof permit', url: null, place: 'Charlotte, NC', occurredAt: '2026-11-20T12:00:00Z', severity: 1, delivery: 'email' }],
    });
  });
  it('areaCheckPath: /check/<state> and /es/check/<state>; every one passes cleanPath', () => {
    for (const st of ['live', 'limited', 'waitlist'] as const) {
      expect(areaCheckPath(st)).toBe(`/check/${st}`);
      expect(areaCheckPath(st, 'es')).toBe(`/es/check/${st}`);
      expect(cleanPath(areaCheckPath(st))).toBe(`/check/${st}`);
      expect(cleanPath(areaCheckPath(st, 'es'))).toBe(`/es/check/${st}`);
    }
  });
  for (const [zip, trade] of CASES) {
    it(`${zip} ${trade}: EN and ES pages record the coverageFor state, never the ZIP or the trade`, async () => {
      const place = lookupZip(zip)!;
      const state = coverageFor(place, trade, isServedZip(place)).state;
      const en = await render(CheckPage, { zip, trade });
      const es = await render(CheckPageEs, { zip, trade });
      expect(tracked).toEqual([
        { name: 'area_check', path: `/check/${state}` },
        { name: 'area_check', path: `/es/check/${state}` },
      ]);
      for (const t of tracked) {
        expect(t.path).not.toContain(zip);
        expect(t.path).not.toContain(trade);
      }
      // The verdict block on the page is the same answer.
      if (state === 'waitlist') {
        expect(en).not.toContain('check-verdict');
        expect(es).not.toContain('check-verdict');
      } else {
        expect(en).toContain(`data-verdict="${state}"`);
        expect(es).toContain(`data-verdict="${state}"`);
        expect(en).toContain(state === 'live' ? 'Worth a trial here.' : 'Too early to say here.');
      }
    });
  }
  it('the states seen above are live, limited, waitlist and live (pressure washing)', () => {
    expect(CASES.map(([zip, trade]) => coverageFor(lookupZip(zip)!, trade, true).state)).toEqual(['live', 'limited', 'waitlist', 'live']);
  });
});
