// Round 7 MATCH item 6: hail, wind and tornado records map to the trades the product copy promises, in any state, and a member there
// matches them. SPC rows are written in the real CSV shape (tests/fixtures/spc-*.csv); NWS features in the api.weather.gov shape.
import { describe, expect, it } from 'vitest';
import { parseSpc, HAIL_CATS, TORNADO_CATS, WIND_CATS } from '@/lib/signals/adapters/spc';
import { parseNws } from '@/lib/signals/adapters/nws';
import { matchOne, type MatchProfile } from '@/lib/signals/match';
import { TRADE_SIGNALS } from '@/lib/signals/capabilities';
import { TRADE_FACTS } from '@/lib/seo/trade-pages';
import type { CategoryId } from '@/lib/signals/categories';

const DAY = '2026-11-16';
const PLACES: [state: string, lat: number, lon: number][] = [
  ['GA', 33.8796, -84.5023],
  ['TX', 32.78, -96.8],
  ['MN', 44.98, -93.27],
  ['CO', 39.74, -104.99],
  ['FL', 28.54, -81.38],
  ['NY', 42.89, -78.88],
  ['OK', 36.15, -95.99],
  ['NC', 35.23, -80.84],
];
const hail = (st: string, lat: number, lon: number) =>
  parseSpc({ type: 'hail', day: DAY, csv: `Time,Size,Location,County,State,Lat,Lon,Comments\n2012,175,2 N Town,County,${st},${lat},${lon},golf ball size hail\n` });
const wind = (st: string, lat: number, lon: number) =>
  parseSpc({ type: 'wind', day: DAY, csv: `Time,Speed,Location,County,State,Lat,Lon,Comments\n2012,70,2 N Town,County,${st},${lat},${lon},trees down on homes\n` });
const torn = (st: string, lat: number, lon: number) =>
  parseSpc({ type: 'torn', day: DAY, csv: `Time,F_Scale,Location,County,State,Lat,Lon,Comments\n2012,EF1,2 N Town,County,${st},${lat},${lon},roofs damaged\n` });

const STORM_PROMISE: CategoryId[] = ['roofing', 'tree-service', 'restoration', 'insurance', 'public-adjuster'];

describe('SPC storm reports map to the promised trades in every state', () => {
  for (const [st, lat, lon] of PLACES) {
    it(`${st}: hail, wind and tornado`, () => {
      const [h] = hail(st, lat, lon);
      const [w] = wind(st, lat, lon);
      const [t] = torn(st, lat, lon);
      expect(h.state).toBe(st);
      expect(h.categories).toEqual(expect.arrayContaining(['roofing', 'restoration', 'auto-glass', 'auto-body', 'insurance', 'public-adjuster']));
      expect(w.categories).toEqual(expect.arrayContaining(['roofing', 'tree-service', 'restoration', 'insurance', 'public-adjuster']));
      expect(t.categories).toEqual(expect.arrayContaining([...STORM_PROMISE, 'general-contractor', 'junk-removal', 'electrical', 'auto-body', 'auto-glass']));
      // a member at that place with the trade matches the report
      for (const [sig, trade] of [[h, 'roofing'], [w, 'tree-service'], [t, 'restoration'], [h, 'auto-glass']] as const) {
        const p: MatchProfile = { user_id: `u-${st}`, categories: [trade], lat: lat + 0.05, lon: lon + 0.05, state: st, radius_mi: 25 };
        const m = matchOne({ id: 1, kind: sig.kind, source: sig.source, title: sig.title, summary: sig.summary ?? null, data: (sig.data ?? null) as Record<string, unknown> | null, categories: sig.categories, lat: sig.lat ?? null, lon: sig.lon ?? null, state: sig.state ?? null, severity: sig.severity, occurred_at: sig.occurredAt }, p);
        expect(m, `${st} ${trade}`).not.toBeNull();
      }
    });
  }

  it('the Smyrna roofer gets a hail report 10 miles away and not one 40 miles away', () => {
    const p: MatchProfile = { user_id: 'smyrna', categories: ['roofing'], lat: 33.8796, lon: -84.5023, state: 'GA', radius_mi: 25 };
    const near = hail('GA', 33.95, -84.35)[0];
    const far = hail('GA', 34.45, -84.5)[0];
    const asSig = (s: typeof near) => ({ id: 1, kind: s.kind, source: s.source, title: s.title, summary: s.summary ?? null, data: (s.data ?? null) as Record<string, unknown> | null, categories: s.categories, lat: s.lat ?? null, lon: s.lon ?? null, state: s.state ?? null, severity: s.severity, occurred_at: s.occurredAt });
    expect(matchOne(asSig(near), p)).not.toBeNull();
    expect(matchOne(asSig(far), p)).toBeNull();
  });
});

describe('NWS warnings carry the storm trades in any state', () => {
  const feature = (event: string, ugc: string, description = '') => ({
    id: `https://api.weather.gov/alerts/urn:${event}:${ugc}`,
    geometry: null,
    properties: { id: `urn:${event}:${ugc}`, event, status: 'Actual', messageType: 'Alert', severity: 'Severe', areaDesc: 'Somewhere', geocode: { UGC: [ugc] }, onset: '2026-11-17T10:00:00Z', ends: '2026-11-17T20:00:00Z', description },
  });
  for (const ugc of ['GAZ045', 'TXZ119', 'MNZ060', 'COZ039', 'NYZ010']) {
    it(`${ugc.slice(0, 2)}: tornado warning and a severe thunderstorm warning with hail`, () => {
      const [t] = parseNws({ features: [feature('Tornado Warning', ugc)] });
      const [s] = parseNws({ features: [feature('Severe Thunderstorm Warning', ugc, 'Quarter size hail and 60 mph winds expected.')] });
      expect(t.categories).toEqual(expect.arrayContaining(['roofing', 'restoration', 'tree-service', 'general-contractor', 'public-adjuster']));
      expect(s.categories).toEqual(expect.arrayContaining(['roofing', 'tree-service', 'restoration', 'auto-body', 'auto-glass']));
      expect(t.state).toBe(ugc.slice(0, 2));
    });
  }
});

describe('the trade pages promise storm reports only where the parsers deliver them', () => {
  const anyStorm = new Set<CategoryId>([...HAIL_CATS, ...WIND_CATS, ...TORNADO_CATS]);
  it('every trade whose page shows storm reports is tagged by at least one of hail, wind or tornado', () => {
    for (const [trade, facts] of Object.entries(TRADE_FACTS)) {
      const shown = (TRADE_SIGNALS[trade as CategoryId] ?? []).includes('storm-report');
      const promises = facts.signals.some((s) => s.type === 'storm-report');
      if (promises && shown) expect(anyStorm.has(trade as CategoryId), trade).toBe(true);
      if (shown) expect(anyStorm.has(trade as CategoryId), trade).toBe(true);
    }
  });

  it('a page line that names hail is backed by hail reports for that trade, unless the line also names wind or storms that the trade gets', () => {
    for (const [trade, facts] of Object.entries(TRADE_FACTS)) {
      if (!(TRADE_SIGNALS[trade as CategoryId] ?? []).includes('storm-report')) continue; // the page hides the line
      for (const s of facts.signals.filter((x) => x.type === 'storm-report')) {
        const t = trade as CategoryId;
        const ok =
          (/hail/i.test(s.signal) && HAIL_CATS.includes(t)) ||
          (/wind/i.test(s.signal) && (WIND_CATS.includes(t) || TORNADO_CATS.includes(t))) ||
          (/tornado/i.test(s.signal) && TORNADO_CATS.includes(t)) ||
          (/storm/i.test(s.signal) && anyStorm.has(t));
        expect(ok, `${trade}: "${s.signal}"`).toBe(true);
      }
    }
  });

  it('roofing, tree service and restoration pages show storm reports', () => {
    for (const t of ['roofing', 'tree-service', 'restoration'] as CategoryId[]) expect(TRADE_SIGNALS[t]).toContain('storm-report');
  });
});
