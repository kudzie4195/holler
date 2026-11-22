// Coverage notice (PLAN-2.0 2.4): the calm one-liner on /check results and in the app feed header, and how it renders.
// Inputs are hand-written source states (assumed); the places and which feeds cover them come from the real registry (sourced).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { coverageNotice, type StateLookup } from '@/lib/check/coverage-notice';
import { CheckResults } from '@/components/check-results';
import { CoverageNoticeLine } from '@/components/coverage-notice';
import { lookupZip } from '@/lib/geo';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const H = 3_600_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const healthyAll = (over: StateLookup = {}): StateLookup => ({
  nws: { state: 'healthy', lastSuccessAt: ago(5 * 60_000) },
  spc: { state: 'healthy', lastSuccessAt: ago(5 * 60_000) },
  ...over,
});
const chicago = lookupZip('60614')!;
const smyrna = lookupZip('30080')!;
const at = (z: { lat: number; lon: number }, trades: string[], states: StateLookup | null | undefined, extra: { radiusMi?: number } = {}) =>
  coverageNotice({ lat: z.lat, lon: z.lon, trades, states, now: NOW, ...extra });

describe('coverageNotice', () => {
  it('has the places it needs', () => {
    expect(chicago).toBeTruthy();
    expect(smyrna).toBeTruthy();
  });

  it('is null when every source near the place is healthy', () => {
    expect(at(chicago, ['roofing'], healthyAll({ 'socrata-chicago-permits': { state: 'healthy', lastSuccessAt: ago(H) } }))).toBeNull();
  });

  it('is null when the states are unknown: no state, no claim', () => {
    expect(at(chicago, ['roofing'], null)).toBeNull();
    expect(at(chicago, ['roofing'], undefined)).toBeNull();
    expect(at(chicago, ['roofing'], {})).toBeNull();
  });

  it('says "Chicago permits are delayed; last update 9 hours ago" for a delayed Chicago permit feed', () => {
    const n = at(chicago, ['roofing'], healthyAll({ 'socrata-chicago-permits': { state: 'delayed', lastSuccessAt: ago(9 * H) } }));
    expect(n).not.toBeNull();
    expect(n!.line.startsWith('Chicago permits are delayed; last update 9 hours ago.')).toBe(true);
    expect(n!.affected).toEqual([{ name: 'Chicago permits', state: 'delayed', lastSuccessAt: ago(9 * H) }]);
  });

  it('is one line: no line break, ends with the honest caveat', () => {
    const n = at(chicago, ['roofing'], healthyAll({ 'socrata-chicago-permits': { state: 'delayed', lastSuccessAt: ago(9 * H) } }))!;
    expect(n.line).not.toMatch(/\n/);
    expect(n.line.endsWith('Some recent records may be missing here.')).toBe(true);
  });

  it('words degraded and unavailable calmly, and handles a source that has never updated', () => {
    const d = at(chicago, ['roofing'], healthyAll({ 'socrata-chicago-permits': { state: 'degraded', lastSuccessAt: ago(3 * H) } }))!;
    expect(d.line).toMatch(/^Chicago permits are not updating reliably; last update 3 hours ago\./);
    const u = at(chicago, ['roofing'], healthyAll({ 'socrata-chicago-permits': { state: 'unavailable', lastSuccessAt: ago(50 * H) } }))!;
    expect(u.line).toMatch(/^Chicago permits are unavailable right now; last update 2 days ago\./);
    const never = at(chicago, ['roofing'], healthyAll({ 'socrata-chicago-permits': { state: 'unavailable', lastSuccessAt: null } }))!;
    expect(never.line).toMatch(/^Chicago permits are unavailable right now; no update yet\./);
  });

  it('never says lead, guaranteed or official record', () => {
    for (const state of ['delayed', 'degraded', 'unavailable']) {
      const n = at(chicago, ['roofing'], healthyAll({ 'socrata-chicago-permits': { state, lastSuccessAt: ago(9 * H) } }))!;
      expect(n.line).not.toMatch(/\blead|guarantee|official record|they need you|you will win/i);
    }
  });

  it('a source that is not set up is never mentioned', () => {
    expect(at(chicago, ['roofing'], healthyAll({ 'socrata-chicago-permits': { state: 'not_set_up', lastSuccessAt: null } }))).toBeNull();
  });

  it('ignores a behind source that is far from the place', () => {
    expect(at(chicago, ['roofing'], healthyAll({ 'socrata-la-permits': { state: 'degraded', lastSuccessAt: ago(2 * H) } }))).toBeNull();
    expect(at(smyrna, ['roofing'], healthyAll({ 'socrata-chicago-permits': { state: 'unavailable', lastSuccessAt: null } }))).toBeNull();
  });

  it('ignores a behind source whose records the trade never receives', () => {
    // Food inspections are not tagged for roofing, so a roofer is not told about them.
    const states = healthyAll({ 'socrata-chicago-inspections': { state: 'unavailable', lastSuccessAt: ago(50 * H) } });
    expect(at(chicago, ['roofing'], states)).toBeNull();
    expect(at(chicago, ['pest-control'], states)?.line).toMatch(/^Chicago food inspections are unavailable right now/);
  });

  it('names the national weather feeds when they are behind', () => {
    const n = at(smyrna, ['roofing'], healthyAll({ nws: { state: 'delayed', lastSuccessAt: ago(2 * H) } }))!;
    expect(n.line).toMatch(/^Weather alerts are delayed; last update 2 hours ago\./);
    const s = at(smyrna, ['roofing'], healthyAll({ spc: { state: 'degraded', lastSuccessAt: ago(2 * H) } }))!;
    expect(s.line).toMatch(/^Storm reports are not updating reliably/);
  });

  it('puts the worst source first and counts the rest', () => {
    const n = at(chicago, ['roofing'], healthyAll({
      'socrata-chicago-permits': { state: 'delayed', lastSuccessAt: ago(9 * H) },
      nws: { state: 'unavailable', lastSuccessAt: ago(30 * H) },
      spc: { state: 'degraded', lastSuccessAt: ago(1 * H) },
    }))!;
    expect(n.line).toMatch(/^Weather alerts are unavailable right now; last update 30 hours ago\. 2 more sources near you are also behind\./);
    expect(n.affected.map((a) => a.state)).toEqual(['unavailable', 'degraded', 'delayed']);
    const one = at(chicago, ['roofing'], healthyAll({
      'socrata-chicago-permits': { state: 'delayed', lastSuccessAt: ago(9 * H) },
      nws: { state: 'delayed', lastSuccessAt: ago(2 * H) },
    }))!;
    expect(one.line).toContain('1 more source near you is also behind.');
  });

  it('merges the three Cobb County permit layers into one entry, worst state, oldest update', () => {
    const states = healthyAll({
      'arcgis-cobb-residential-permits': { state: 'healthy', lastSuccessAt: ago(1 * H) },
      'arcgis-cobb-commercial-permits': { state: 'delayed', lastSuccessAt: ago(20 * H) },
      'arcgis-cobb-multiunit-permits': { state: 'delayed', lastSuccessAt: ago(10 * H) },
    });
    const n = at(smyrna, ['roofing'], states)!;
    expect(n.affected.filter((a) => a.name === 'Cobb County permits')).toHaveLength(1);
    expect(n.line).toMatch(/^Cobb County permits are delayed; last update 20 hours ago\./);
  });

  it('with no trade given, every record type counts', () => {
    const states = healthyAll({ 'socrata-chicago-inspections': { state: 'delayed', lastSuccessAt: ago(30 * H) } });
    expect(at(chicago, [], states)?.line).toMatch(/^Chicago food inspections are delayed/);
  });

  it('a wider member radius reaches more sources', () => {
    const states = healthyAll({ 'arcgis-dekalb-permits': { state: 'delayed', lastSuccessAt: ago(9 * H) } });
    const wide = at(smyrna, ['roofing'], states, { radiusMi: 60 });
    expect(wide).not.toBeNull();
  });
});

describe('render: /check results', () => {
  const props = {
    mode: 'results' as const,
    checkedAt: new Date(NOW - 60_000).toISOString(),
    placeLabel: 'Chicago, IL',
    trade: 'roofing',
    tradeLabel: 'Roofing',
    citySlug: 'chicago-il',
    watches: ['new building permits'],
    now: NOW,
  };
  const LINE = 'Chicago permits are delayed; last update 9 hours ago. Some recent records may be missing here.';
  const item = { id: 1, kind: 'permit', source: 'socrata-chicago-permits', title: 'Re-roof permit', url: 'https://example.com/p/1', place: 'Chicago, IL', lat: null, lon: null, occurredAt: new Date(NOW - 2 * H).toISOString(), severity: 1 };

  it('shows the notice above the results when records exist', () => {
    const html = renderToStaticMarkup(createElement(CheckResults, { ...props, items: [item], coverage: LINE }));
    expect(html).toContain('data-testid="coverage-notice"');
    expect(html).toContain('Chicago permits are delayed; last update 9 hours ago.');
    expect(html.indexOf('coverage-notice')).toBeLessThan(html.indexOf('Re-roof permit'));
    expect(html).toContain('role="status"');
  });

  it('shows the notice on an empty result and does not call it "nothing in the public record"', () => {
    const html = renderToStaticMarkup(createElement(CheckResults, { ...props, items: [], coverage: LINE }));
    expect(html).toContain('data-testid="coverage-notice"');
    expect(html).toContain('In the records Holler has read so far, nothing');
    expect(html).not.toContain('Nothing in the public record');
  });

  it('without a notice the page is unchanged: no notice element, the usual empty wording', () => {
    const full = renderToStaticMarkup(createElement(CheckResults, { ...props, items: [item] }));
    expect(full).not.toContain('coverage-notice');
    const empty = renderToStaticMarkup(createElement(CheckResults, { ...props, items: [], coverage: null }));
    expect(empty).not.toContain('coverage-notice');
    expect(empty).toContain('Nothing in the public record');
  });

  it('does not show the notice on the unreadable and limited states', () => {
    for (const mode of ['unreadable', 'limited'] as const) {
      expect(renderToStaticMarkup(createElement(CheckResults, { ...props, mode, items: [], coverage: LINE }))).not.toContain('coverage-notice');
    }
  });
});

describe('render: app feed header line', () => {
  it('renders the line in a status notice, and nothing for null, undefined or empty', () => {
    const html = renderToStaticMarkup(createElement(CoverageNoticeLine, { line: 'Weather alerts are delayed; last update 2 hours ago. Some recent records may be missing here.' }));
    expect(html).toContain('role="status"');
    expect(html).toContain('Weather alerts are delayed; last update 2 hours ago.');
    for (const line of [null, undefined, '']) expect(renderToStaticMarkup(createElement(CoverageNoticeLine, { line }))).toBe('');
  });
});
