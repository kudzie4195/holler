// /check page, end to end through the page component: the coverage notice shows when a source covering the ZIP and trade is behind,
// and not otherwise. The check data and the source states are mocked (assumed values); the ZIP lookup and which feeds cover a ZIP are real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {}, after: () => {} }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.5' }) }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics/request', () => ({ eventContext: async () => null, trackVisitorStep: async () => {} }));
vi.mock('@/lib/auth/ratelimit', () => ({ hit: async () => 'allowed', clientIp: () => '203.0.113.5' }));
const item = { id: 1, kind: 'permit', source: 'socrata-chicago-permits', title: 'Re-roof permit on Oak St', url: 'https://example.com/p', place: 'Chicago, IL', lat: 41.9, lon: -87.65, occurredAt: new Date().toISOString(), severity: 1 };
let items: unknown[] = [item];
vi.mock('@/lib/check/load', () => ({ loadCheck: async () => ({ ok: true, items, checkedAt: new Date().toISOString() }) }));
let snapshot: unknown = null;
let snapshotThrows = false;
vi.mock('@/lib/signals/source-state-snapshot', () => ({
  loadSourceStateSnapshot: async () => {
    if (snapshotThrows) throw new Error('cache handler down');
    return snapshot;
  },
}));
vi.mock('@/components/top-nav', () => ({ TopNav: () => null }));
vi.mock('@/components/footer', () => ({ Footer: () => null }));

import CheckPage from '@/app/check/page';

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
async function render(sp: Record<string, string>) {
  const check = findAsync(CheckPage({ searchParams: Promise.resolve(sp) } as never) as ReactElement);
  if (!check) throw new Error('no async Check element found');
  const out = await (check.type as (p: Props) => Promise<ReactNode>)(check.props);
  const html = renderToStaticMarkup(createElement('div', null, out));
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ') };
}
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const states = (over: Record<string, { state: string; lastRecordAt: string | null }>) => ({
  generatedAt: new Date().toISOString(),
  states: { nws: { state: 'healthy', lastRecordAt: ago(0.1) }, spc: { state: 'healthy', lastRecordAt: ago(0.1) }, ...over },
});

beforeEach(() => {
  items = [item];
  snapshot = null;
  snapshotThrows = false;
});

describe('/check coverage notice', () => {
  it('shows "Chicago permits are delayed; last update 9 hours ago" above the records for a Chicago ZIP and roofing', async () => {
    snapshot = states({ 'socrata-chicago-permits': { state: 'delayed', lastRecordAt: ago(9) } });
    const { html, text } = await render({ zip: '60614', trade: 'roofing' });
    expect(text).toContain('Chicago permits are delayed; last update 9 hours ago.');
    expect(html.indexOf('data-testid="coverage-notice"')).toBeGreaterThan(html.indexOf('id="check-heading"'));
    expect(html.indexOf('data-testid="coverage-notice"')).toBeLessThan(html.indexOf('Re-roof permit on Oak St'));
  });
  it('on an empty result it does not claim "nothing in the public record"', async () => {
    items = [];
    snapshot = states({ 'socrata-chicago-permits': { state: 'degraded', lastRecordAt: ago(3) } });
    const { text } = await render({ zip: '60614', trade: 'roofing' });
    expect(text).toContain('Chicago permits are not updating reliably');
    expect(text).toContain('In the records Holler has read so far, nothing');
    expect(text).not.toContain('Nothing in the public record');
  });
  it('shows nothing when every source is healthy', async () => {
    snapshot = states({ 'socrata-chicago-permits': { state: 'healthy', lastRecordAt: ago(1) } });
    const { html } = await render({ zip: '60614', trade: 'roofing' });
    expect(html).not.toContain('coverage-notice');
  });
  it('shows nothing when the states could not be read, and the page still renders', async () => {
    snapshot = null;
    const a = await render({ zip: '60614', trade: 'roofing' });
    expect(a.html).not.toContain('coverage-notice');
    expect(a.text).toContain('Re-roof permit on Oak St');
    snapshotThrows = true;
    const b = await render({ zip: '60614', trade: 'roofing' });
    expect(b.html).not.toContain('coverage-notice');
    expect(b.text).toContain('Re-roof permit on Oak St');
  });
  it('on an empty result with unknown states it words the result as "read so far", never as full coverage', async () => {
    items = [];
    snapshot = null;
    const a = await render({ zip: '60614', trade: 'roofing' });
    expect(a.html).not.toContain('coverage-notice');
    expect(a.text).toContain('In the records Holler has read so far, nothing');
    expect(a.text).not.toContain('Nothing in the public record');
    snapshotThrows = true;
    const b = await render({ zip: '60614', trade: 'roofing' });
    expect(b.text).toContain('In the records Holler has read so far, nothing');
    expect(b.text).not.toContain('Nothing in the public record');
  });
  it('on an empty result with known healthy states the plain wording stays', async () => {
    items = [];
    snapshot = states({});
    const { text } = await render({ zip: '60614', trade: 'roofing' });
    expect(text).toContain('Nothing in the public record');
  });
  it('a quiet source says "no new records since" its newest record date', async () => {
    snapshot = states({ 'socrata-chicago-permits': { state: 'degraded', reason: 'repeated_empty', lastRecordAt: '2026-11-14T08:00:00.000Z' } as never });
    const { text } = await render({ zip: '60614', trade: 'roofing' });
    expect(text).toContain('Chicago permits are not updating reliably; no new records since Nov 14.');
  });
  it('a behind source in another city is not mentioned', async () => {
    snapshot = states({ 'socrata-la-permits': { state: 'degraded', lastRecordAt: ago(2) } });
    const { html } = await render({ zip: '60614', trade: 'roofing' });
    expect(html).not.toContain('coverage-notice');
  });
  it('a delayed national weather feed is named for every ZIP', async () => {
    snapshot = states({ nws: { state: 'delayed', lastRecordAt: ago(2) } });
    const { text } = await render({ zip: '60614', trade: 'roofing' });
    expect(text).toContain('Weather alerts are delayed; last update 2 hours ago.');
  });
});
