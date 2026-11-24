// R25 check fix, review R25CHECK P2-5: the "free public records" link on a limited answer opens a city page with records. It links the
// nearest city within 25 miles whose slug has rows in holler_place_counts (lib/seo/data.ts loadPlaceCounts, the same read the city pages and
// the sitemap use), and no link at all when none has or the counts cannot be read. Rendered through the real /check and /es/check pages.
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ counts: { ok: true, counts: {} as Record<string, number>, latest: {}, partial: false } }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {}, after: () => {} }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics/request', () => ({ eventContext: async () => null, trackVisitorStep: async () => {} }));
vi.mock('@/lib/check/load', () => ({ loadCheck: async () => ({ ok: true, clipped: false, checkedAt: '2026-11-23T12:00:00Z', items: [] }) }));
vi.mock('@/lib/check/limit', () => ({ gateCheck: async () => 'ok' }));
vi.mock('@/lib/signals/source-state-snapshot', () => ({ loadSourceStateSnapshot: async () => null }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/seo/data', () => ({ loadPlaceCounts: async () => h.counts }));

import CheckPage from '@/app/check/page';
import CheckPageEs from '@/app/es/check/page';
import { nearestCityWithRecords } from '@/lib/check/reads';
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

describe('02135 Brighton, MA landscaping (limited): the records link opens a page with records', () => {
  beforeEach(() => {
    h.counts = { ok: true, counts: {}, latest: {}, partial: false };
  });
  it('the answer is limited', () => {
    const place = lookupZip('02135')!;
    expect(coverageFor(place, 'landscaping', isServedZip(place)).state).toBe('limited');
  });
  it('Brookline (the nearest city) has no rows, Boston has: the link goes to Boston, EN and ES', async () => {
    h.counts.counts = { 'brookline-ma': 0, 'boston-ma': 812 };
    const en = await render(CheckPage, { zip: '02135', trade: 'landscaping' });
    expect(en).toContain('href="/local/massachusetts/boston-ma"');
    expect(en).toContain('See the free public records for Boston');
    expect(en).not.toContain('/local/massachusetts/brookline-ma');
    const es = await render(CheckPageEs, { zip: '02135', trade: 'landscaping' });
    expect(es).toContain('href="/local/massachusetts/boston-ma"');
    expect(es).toContain('Vea gratis los registros públicos de Boston (página en inglés)');
  });
  it('a nearer city with rows wins: Newton', async () => {
    h.counts.counts = { 'newton-ma': 3, 'boston-ma': 812 };
    expect(await render(CheckPage, { zip: '02135', trade: 'landscaping' })).toContain('href="/local/massachusetts/newton-ma"');
  });
  it('no city within 25 miles has rows, or the counts cannot be read: no link', async () => {
    h.counts.counts = { 'worcester-ma': 400 };
    expect(await render(CheckPage, { zip: '02135', trade: 'landscaping' })).not.toContain('check-city-link');
    h.counts = { ok: false, counts: { 'boston-ma': 812 }, latest: {}, partial: false };
    expect(await render(CheckPage, { zip: '02135', trade: 'landscaping' })).not.toContain('check-city-link');
    expect(await render(CheckPageEs, { zip: '02135', trade: 'landscaping' })).not.toContain('check-city-link');
  });
  it('nearestCityWithRecords: nearest with a count above zero, inside the radius only', () => {
    const z = lookupZip('02135')!;
    expect(nearestCityWithRecords(z.lat, z.lon, { 'brookline-ma': 5, 'boston-ma': 9 })?.slug).toBe('brookline-ma');
    expect(nearestCityWithRecords(z.lat, z.lon, { 'brookline-ma': 0, 'cambridge-ma': 1 })?.slug).toBe('cambridge-ma');
    expect(nearestCityWithRecords(z.lat, z.lon, {})).toBeNull();
    expect(nearestCityWithRecords(z.lat, z.lon, { 'worcester-ma': 400 })).toBeNull();
  });
});
