// Round 33 (HAIL): CAP hail size and gust parameters, the hail and gust routing behind HOLLER_HAIL_ROUTING_ENABLED, the weather card's
// alert line (EN and ES, never a damage claim), and the NWS local storm report adapter behind HOLLER_LSR_ENABLED.
//
// Fixtures are REAL alerts and reports, saved verbatim (one feature each) from public captures of public NWS products:
//   tests/fixtures/nws-cap/omaha-svr-2022-06-11.json              github.com/riccozzz/Weather-Tools docs/api_examples/svr_0.json
//   tests/fixtures/nws-cap/norman-tor-2025-04-19-observed.json    github.com/jseyfert3/hybrid-weather-radio "test jsons/2025-04-19 2009 OK alerts.json"
//   tests/fixtures/nws-cap/norman-svr-2025-04-19-upto-075.json    same repo, "test jsons/2025-04-19 2324 OK alerts.json"
//   tests/fixtures/nws-cap/tulsa-svr-2025-05-18-upto-50mph.json   same repo, 2025-05-18_13:41:53...OK_alerts.json
//   tests/fixtures/nws-cap/midland-sws-2026-09-30.json            github.com/saulbanov/hill-country-hydro _cloud-captures (nws-alerts-TX)
//   tests/fixtures/lsr/derecho-2022-05-12-sample.geojson          github.com/thekarstens/wdl-data-derecho-2022 (an IEM lsr.geojson capture)
// (api.weather.gov refuses automated fetches from this sandbox by robots.txt, so captures made by others are the real source here.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseNws } from '@/lib/signals/adapters/nws';
import { LSR_DAMAGE_PART, LSR_EMPTY_LOG, LSR_LOOKBACK_HOURS, LSR_TREE_PART, LSR_TYPES, LSR_WFOS, lsrAdapter, lsrEnabled, lsrGustMph, lsrPlace, lsrUrl, parseLsr, remarkNamesTrees, scanLsr } from '@/lib/signals/adapters/lsr';
import { LSR_PARTS, lsrSummaryOf } from '@/lib/signals/adapters/lsr-parts';
import { SKIP_SOURCES } from '@/lib/ai/classify';
import { feedCount } from '@/lib/seo/home-live';
import {
  capHazardOf,
  hailRoutingEnabled,
  hazardFromText,
  parseHailSize,
  parseWindGust,
  weatherCardFields,
  weatherFactsOf,
  WEATHER_SELECT,
} from '@/lib/signals/weather-hazard';
import { GUST_ROUTE_MIN_MPH, HAIL_ROUTE_MIN_INCHES, HAZARD_ROUTES, hazardRouteTrades, windDamageFactsOf, windDamageLevelOf } from '@/lib/signals/carry';
import { labelFor, labelForMember, recordLabelInput, ruleFor, SOURCE_DEFAULTS, type LabelInput } from '@/lib/signals/lead-rules';
import { carriedTrades } from '@/lib/signals/permit-routing';
import { alertLineFor, ALERT_LINE_NOTE, briefFamilyOf, cardBrief } from '@/lib/signals/brief';
import { alertLineLang, cardBriefLang } from '@/lib/signals/brief-i18n';
import { localizeSummary } from '@/lib/signals/summary-i18n';
import { localizeTitle } from '@/lib/signals/title-i18n';
import { getSourceMeta } from '@/lib/signals/source-meta';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { ENV_KEYS } from '@/lib/env';
import type { CategoryId } from '@/lib/signals/categories';

const ROOT = join(__dirname, '..', '..');
const cap = (name: string) => JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'nws-cap', `${name}.json`), 'utf8'));
const capProps = (name: string) => cap(name).features[0].properties as Record<string, unknown>;
const lsrFixture = () => JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'lsr', 'derecho-2022-05-12-sample.geojson'), 'utf8'));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('CAP parameters on real alerts', () => {
  it('reads maxHailSize, maxWindGust and the threat tags as the API writes them', () => {
    const omaha = capHazardOf(capProps('omaha-svr-2022-06-11').parameters);
    expect(omaha).toEqual({
      maxHailSizeIn: 2,
      maxWindGustMph: 60,
      hailThreat: 'RADAR INDICATED',
      windThreat: 'RADAR INDICATED',
      tornadoDetection: 'POSSIBLE',
      thunderstormDamageThreat: 'CONSIDERABLE',
      tornadoDamageThreat: null,
      hazardFrom: 'cap',
    });
    const tor = capHazardOf(capProps('norman-tor-2025-04-19-observed').parameters);
    expect(tor.maxHailSizeIn).toBe(1.75);
    expect(tor.maxWindGustMph).toBeNull();
    expect(tor.tornadoDetection).toBe('OBSERVED');
    // "Up to .75" and "Up to 50 MPH" are the two "up to" forms the live API uses.
    const upTo = capHazardOf(capProps('norman-svr-2025-04-19-upto-075').parameters);
    expect(upTo.maxHailSizeIn).toBe(0.75);
    expect(upTo.maxWindGustMph).toBe(70);
    const tulsa = capHazardOf(capProps('tulsa-svr-2025-05-18-upto-50mph').parameters);
    expect(tulsa.maxHailSizeIn).toBe(1.25);
    expect(tulsa.maxWindGustMph).toBe(50);
    // A Special Weather Statement writes "0.00" for no hail.
    const sws = capHazardOf(capProps('midland-sws-2026-09-30').parameters);
    expect(sws.maxHailSizeIn).toBeNull();
    expect(sws.maxWindGustMph).toBe(55);
  });

  it('parses the value forms and rejects nonsense', () => {
    expect(parseHailSize(['1.00'])).toBe(1);
    expect(parseHailSize(['Up to .75'])).toBe(0.75);
    expect(parseHailSize(['0.00'])).toBeNull();
    expect(parseHailSize([])).toBeNull();
    expect(parseHailSize(undefined)).toBeNull();
    expect(parseHailSize(['12'])).toBeNull();
    expect(parseWindGust(['60 MPH'])).toBe(60);
    expect(parseWindGust(['Up to 50 MPH'])).toBe(50);
    expect(parseWindGust(['50 KT'])).toBe(58);
    expect(parseWindGust(['n/a'])).toBeNull();
    expect(parseWindGust(['999 MPH'])).toBeNull();
  });

  it('parseNws stores the numbers and tags in data, and leaves title, summary, categories and severity as they were', () => {
    const rows = parseNws(cap('omaha-svr-2022-06-11'));
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.data).toMatchObject({ maxHailSizeIn: 2, maxWindGustMph: 60, hailThreat: 'RADAR INDICATED', tornadoDetection: 'POSSIBLE', thunderstormDamageThreat: 'CONSIDERABLE', hazardFrom: 'cap' });
    expect(r.data).not.toHaveProperty('tornadoDamageThreat');
    // Unchanged tags. (Found here: the older text test for auto body and glass, NWS_HAIL_EXTRA, misses "Two inch hail" because it wants
    // digits; it is left as it was, since the weather table gives those trades no alert from a warning anyway.)
    expect(r.categories).toEqual(['roofing', 'tree-service', 'restoration', 'insurance', 'public-adjuster']);
    expect(r.title.startsWith('Severe Thunderstorm Warning: ')).toBe(true);
    // The switch does not change what is stored.
    vi.stubEnv('HOLLER_HAIL_ROUTING_ENABLED', '1');
    expect(parseNws(cap('omaha-svr-2022-06-11'))).toEqual(rows);
  });

  it('an alert without hail or gust parameters falls back to its own text, and a row without either stores nothing new', () => {
    // The live export's High Wind Warning text (no CAP gust parameter on this product).
    expect(hazardFromText('* WHAT...Southwest winds 30 to 40 mph with gusts of 50 to 60 mph expected. Gusts of 60 to 70 mph are expected across the south side of Casper toward Casper Mountain.')).toEqual({ hailInches: null, gustMph: 70 });
    expect(hazardFromText('* WHAT...West winds 35 to 45 mph with gusts up to 75 mph expected.')).toEqual({ hailInches: null, gustMph: 75 });
    // The HAZARD lines of the real fixtures.
    for (const [name, want] of [
      ['omaha-svr-2022-06-11', { hailInches: 2, gustMph: 60 }],
      ['norman-tor-2025-04-19-observed', { hailInches: 1.75, gustMph: null }],
      ['norman-svr-2025-04-19-upto-075', { hailInches: null, gustMph: 70 }],
      ['tulsa-svr-2025-05-18-upto-50mph', { hailInches: 1.25, gustMph: null }],
      ['midland-sws-2026-09-30', { hailInches: null, gustMph: 55 }],
    ] as const) {
      const hz = /HAZARD\.\.\.[^\n]*/.exec(String(capProps(name).description))?.[0];
      expect(hazardFromText(hz), name).toEqual(want);
    }
    expect(capHazardOf({}, 'gusts up to 65 mph').hazardFrom).toBe('text');
    expect(capHazardOf({}, 'Flooding of streets.')).toMatchObject({ maxHailSizeIn: null, maxWindGustMph: null, hazardFrom: 'none' });
    expect(hazardFromText('Downtown streets near Hailey Road. 40 mph winds.')).toEqual({ hailInches: null, gustMph: null });
  });
});

describe('thresholds (NWS severe criteria: 1 inch hail, 58 mph gusts)', () => {
  it('are the documented numbers and route the documented trades', () => {
    expect(HAIL_ROUTE_MIN_INCHES).toBe(1);
    expect(GUST_ROUTE_MIN_MPH).toBe(58);
    expect(HAZARD_ROUTES.find((r) => r.id === 'hail')?.trades).toEqual(['siding-gutters', 'roofing']);
    expect(HAZARD_ROUTES.find((r) => r.id === 'gust')?.trades).toEqual(['tree-service', 'siding-gutters']);
  });
  it('fire at the line and not below it', () => {
    expect(hazardRouteTrades({ hailInches: 0.99, gustMph: null })).toEqual([]);
    expect(hazardRouteTrades({ hailInches: 1, gustMph: null })).toEqual(['siding-gutters', 'roofing']);
    expect(hazardRouteTrades({ hailInches: null, gustMph: 57 })).toEqual([]);
    expect(hazardRouteTrades({ hailInches: null, gustMph: 58 })).toEqual(['tree-service', 'siding-gutters']);
    expect(hazardRouteTrades({ hailInches: 1.75, gustMph: 70 })).toEqual(['siding-gutters', 'roofing', 'tree-service']);
    expect(hazardRouteTrades(null)).toEqual([]);
  });
});

describe('the switch', () => {
  it('is off unless 1, true, on or yes', () => {
    expect(hailRoutingEnabled(undefined)).toBe(false);
    expect(hailRoutingEnabled('')).toBe(false);
    expect(hailRoutingEnabled('0')).toBe(false);
    expect(hailRoutingEnabled('false')).toBe(false);
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(hailRoutingEnabled(v)).toBe(true);
    expect(ENV_KEYS).toContain('HOLLER_HAIL_ROUTING_ENABLED');
    expect(ENV_KEYS).toContain('HOLLER_LSR_ENABLED');
  });
  it('off: no facts reach the rules or the card', () => {
    const row = { source: 'nws', title: 'Severe Thunderstorm Warning: Seward, NE', summary: 'x', maxHailSizeIn: '2', maxWindGustMph: '60' };
    expect(weatherFactsOf(row, false)).toBeNull();
    expect(weatherCardFields(row, false)).toEqual({ alertHailIn: null, alertGustMph: null });
    expect(recordLabelInput(row).weather).toBeUndefined();
    vi.stubEnv('HOLLER_HAIL_ROUTING_ENABLED', '1');
    expect(weatherFactsOf(row)).toEqual({ hailInches: 2, gustMph: 60 });
    expect(weatherCardFields(row)).toEqual({ alertHailIn: 2, alertGustMph: 60 });
    expect(recordLabelInput(row).weather).toEqual({ hailInches: 2, gustMph: 60 });
    expect(WEATHER_SELECT).toBe('maxHailSizeIn:data->>maxHailSizeIn,maxWindGustMph:data->>maxWindGustMph,hazardFrom:data->>hazardFrom');
  });
});

/**
 * The label a member of `trade` gets, with the routing facts as the surfaces build them (recordLabelInput). A record that does not carry the
 * trade is never matched to that member at all ('not carried'); labelForMember alone would label it as a keyword match.
 */
function memberLabel(row: Parameters<typeof recordLabelInput>[0] & { categories: string[] }, trade: CategoryId) {
  const input = recordLabelInput(row);
  if (!carriedTrades(input, row.categories).includes(trade)) return 'not carried';
  return labelForMember({ ...input, categories: row.categories }, [trade]);
}

describe('routing, switch off and on', () => {
  // Real rows of the live export (gates/r19/data/signals-14d.json): an SPC gust and NWS wind products (the SVR row with this fixture's CAP numbers).
  const spcGust = { source: 'spc', kind: 'report', title: '62 mph wind gust reported near 2 NE Summerland, CA', summary: null, categories: ['tree-service', 'roofing', 'restoration', 'insurance', 'public-adjuster'], lat: 34.44, lon: -119.58, state: 'CA', severity: 2 };
  const spcSmallGust = { ...spcGust, title: '55 mph wind gust reported near 2 NE Summerland, CA', severity: 1 };
  const svr = {
    source: 'nws',
    kind: 'alert',
    title: 'Severe Thunderstorm Warning: Saline, NE; Seward, NE',
    summary: 'Severe Thunderstorm Warning issued June 11 at 4:25PM CDT until June 11 at 5:15PM CDT by NWS Omaha/Valley NE.',
    categories: ['roofing', 'tree-service', 'restoration', 'insurance', 'public-adjuster', 'auto-body', 'auto-glass'],
    lat: 40.7,
    lon: -97.3,
    state: 'NE',
    severity: 2,
    maxHailSizeIn: '2',
    maxWindGustMph: '60',
  };
  const watch = {
    source: 'nws',
    kind: 'alert',
    title: 'High Wind Watch: Central Laramie County',
    summary: 'High Wind Watch issued November 17 at 1:49AM MST until November 18 at 5:00PM MST by NWS Cheyenne WY. * WHAT...West winds 30 to 40 mph with gusts up to 60 mph possible. * WHERE...Central Laramie County.',
    categories: ['tree-service', 'roofing', 'restoration', 'electrical'],
    lat: 41.1,
    lon: -104.8,
    state: 'WY',
    severity: 1,
  };
  const winter = {
    source: 'nws',
    kind: 'alert',
    title: 'Winter Storm Warning: Kuskokwim Delta Coast',
    summary: 'Winter Storm Warning issued November 16 at 1:31PM AKST until November 18 at 1:00AM AKST by NWS Anchorage AK. * WHAT...Blizzard conditions expected. Total snow accumulations of 1 to 3 inches. Winds will gust as high as 65 mph, reducing visibility to one quarter mile or less.',
    categories: ['snow-removal', 'towing', 'hvac', 'tree-service', 'plumbing'],
    lat: 61.5,
    lon: -165.5,
    state: 'AK',
    severity: 2,
  };

  it('switch OFF: every label is what it was before round 33', () => {
    expect(memberLabel(spcGust, 'siding-gutters')).toBe('not carried');
    expect(memberLabel(spcGust, 'tree-service')).toBe('coming_soon');
    expect(memberLabel(svr, 'siding-gutters')).toBe('coming_soon');
    expect(memberLabel(svr, 'roofing')).toBe('coming_soon');
    expect(memberLabel(watch, 'siding-gutters')).toBe('not carried');
    expect(memberLabel(winter, 'tree-service')).toBe('context');
    expect(memberLabel(winter, 'siding-gutters')).toBe('not carried');
    expect(ruleFor(recordLabelInput(svr), 'roofing')?.id).toBe('weather-table');
  });

  it('switch ON: a gust of 58 mph or more reaches siding and gutters; under 58 it does not', () => {
    vi.stubEnv('HOLLER_HAIL_ROUTING_ENABLED', '1');
    expect(memberLabel(spcGust, 'siding-gutters')).toBe('coming_soon');
    expect(memberLabel(spcGust, 'tree-service')).toBe('coming_soon');
    expect(memberLabel(spcGust, 'roofing')).toBe('market_insight');
    expect(memberLabel(spcSmallGust, 'siding-gutters')).toBe('not carried');
  });

  it('switch ON: an alert row decides the level (warning heads-up, watch feed only), never weaker than before', () => {
    vi.stubEnv('HOLLER_HAIL_ROUTING_ENABLED', '1');
    // A Severe Thunderstorm Warning with 2 inch hail and 60 mph gusts: roofing, siding and gutters, trees stay heads-up (as before).
    for (const t of ['roofing', 'siding-gutters', 'tree-service'] as CategoryId[]) {
      expect(memberLabel(svr, t), t).toBe('coming_soon');
      expect(ruleFor(recordLabelInput(svr), t)?.id).toBe('hazard-route');
    }
    expect(memberLabel(svr, 'restoration')).toBe('coming_soon');
    // A watch names gusts "possible": feed only, as audited line 34 has watches.
    expect(memberLabel(watch, 'siding-gutters')).toBe('market_insight');
    expect(memberLabel(watch, 'tree-service')).toBe('market_insight');
    // A Winter Storm Warning that names 65 mph gusts: trees and gutters get the warning's heads-up.
    expect(memberLabel(winter, 'tree-service')).toBe('coming_soon');
    expect(memberLabel(winter, 'siding-gutters')).toBe('coming_soon');
    expect(memberLabel(winter, 'snow-removal')).toBe('coming_soon');
  });

  it('switch ON: hail under 1 inch and gusts under 58 mph route nothing; an event row with no cells routes nothing', () => {
    vi.stubEnv('HOLLER_HAIL_ROUTING_ENABLED', '1');
    const small = { ...svr, title: 'Flood Advisory: Seward, NE', maxHailSizeIn: '0.75', maxWindGustMph: '50', categories: ['restoration'] };
    expect(carriedTrades(recordLabelInput(small), small.categories)).toEqual(['restoration']);
    const statement = { ...svr, title: 'Special Weather Statement: Ector, TX', categories: [] as string[] };
    expect(carriedTrades(recordLabelInput(statement), statement.categories)).toEqual([]);
    expect(memberLabel(statement, 'siding-gutters')).toBe('not carried');
  });

  it('an undeliverable zone alert stays context with the switch on', () => {
    vi.stubEnv('HOLLER_HAIL_ROUTING_ENABLED', '1');
    const zone = { ...winter, lat: null, lon: null };
    expect(memberLabel(zone, 'tree-service')).toBe('context');
  });

  it('the label input without a location (a delivered match) routes the same way', () => {
    const input: LabelInput = { source: 'nws', title: svr.title, summary: svr.summary, weather: { hailInches: 2, gustMph: 60 } };
    expect(labelFor(input, 'siding-gutters')).toBe('coming_soon');
    expect(labelFor({ ...input, weather: null }, 'siding-gutters')).toBe('coming_soon');
  });
});

// Words that would say damage happened. The alert line may only say what the alert warned of.
const DAMAGE_CLAIM = /\bdamag|\bdestroy|\bhit\b|\bstruck\b|\bdented\b|\bbroken\b|\bdañ|\bdestru|\bgolpe|\babollad|\brot[oa]s?\b/i;
const BANNED = /\blead(s)?\b|guaranteed|you will win|they need you|knock doors|canvass|\u2014/i;

describe('the alert line, EN and ES', () => {
  const nws = { source: 'nws', kind: 'alert' };
  it('says only what the alert says', () => {
    expect(alertLineFor({ ...nws, alertHailIn: 1.75 })).toBe('The weather service warned of hail up to 1.75 inches in this area. Nothing is confirmed for any property.');
    expect(alertLineFor({ ...nws, alertHailIn: 1 })).toBe('The weather service warned of hail up to 1.00 inches in this area. Nothing is confirmed for any property.');
    expect(alertLineFor({ ...nws, alertGustMph: 70 })).toBe('The weather service warned of wind gusts up to 70 mph in this area. Nothing is confirmed for any property.');
    expect(alertLineFor({ ...nws, alertHailIn: 2, alertGustMph: 60 })).toBe('The weather service warned of hail up to 2.00 inches and wind gusts up to 60 mph in this area. Nothing is confirmed for any property.');
    expect(alertLineFor({ ...nws })).toBeNull();
    expect(alertLineFor({ source: 'spc', kind: 'report', alertHailIn: 1.75 })).toBeNull();
    expect(alertLineFor({ source: 'socrata-chicago-permits', kind: 'permit', alertHailIn: 1.75 })).toBeNull();
    expect(alertLineLang({ ...nws, alertHailIn: 1.75 }, 'es')).toBe('El Servicio Meteorológico Nacional advirtió de granizo de hasta 1.75 pulgadas en esta zona. No hay nada confirmado sobre ninguna propiedad.');
    expect(alertLineLang({ ...nws, alertGustMph: 70 }, 'es')).toBe('El Servicio Meteorológico Nacional advirtió de ráfagas de viento de hasta 70 mph en esta zona. No hay nada confirmado sobre ninguna propiedad.');
    expect(alertLineLang({ ...nws, alertHailIn: 2, alertGustMph: 60 }, 'es')).toBe('El Servicio Meteorológico Nacional advirtió de granizo de hasta 2.00 pulgadas y ráfagas de viento de hasta 60 mph en esta zona. No hay nada confirmado sobre ninguna propiedad.');
    expect(alertLineLang({ ...nws, alertHailIn: 1.75 }, 'en')).toBe(alertLineFor({ ...nws, alertHailIn: 1.75 }));
  });

  it('never asserts damage and follows the copy rules, in both languages', () => {
    const lines: string[] = [ALERT_LINE_NOTE];
    for (const lang of ['en', 'es'] as const) {
      for (const hail of [null, 0.75, 1, 1.75, 4.5]) {
        for (const gust of [null, 50, 58, 70, 100]) {
          const l = alertLineLang({ ...nws, alertHailIn: hail, alertGustMph: gust }, lang);
          if (l) lines.push(l);
        }
      }
    }
    expect(lines.length).toBeGreaterThan(40);
    for (const l of lines) {
      expect(l, l).not.toMatch(DAMAGE_CLAIM);
      expect(l, l).not.toMatch(BANNED);
    }
  });

  it('is on the card only when the surface passes the numbers (it does so only with the switch on)', () => {
    const input = { source: 'nws', kind: 'alert', title: 'Severe Thunderstorm Warning: Seward, NE', summary: 's', label: 'coming_soon' as const, trade: 'siding-gutters' };
    expect(cardBrief(input).alertLine).toBeNull();
    expect(cardBrief({ ...input, alertHailIn: 2, alertGustMph: 60 }).alertLine).toContain('hail up to 2.00 inches');
    expect(cardBriefLang({ ...input, alertHailIn: 2, alertGustMph: 60 }, 'es').alertLine).toContain('granizo de hasta 2.00 pulgadas');
    expect(cardBriefLang({ ...input, alertHailIn: 2 }, 'en')).toEqual(cardBrief({ ...input, alertHailIn: 2 }));
    expect(weatherCardFields({ source: 'nws', maxHailSizeIn: '2' }, false)).toEqual({ alertHailIn: null, alertGustMph: null });
  });
});

describe('NWS local storm reports (IEM GeoJSON), behind HOLLER_LSR_ENABLED', () => {
  it('keeps only the types SPC does not carry, and never stores the remark', () => {
    const scan = scanLsr(lsrFixture());
    expect(scan.rows).toBe(7);
    expect(scan.usable).toBe(7);
    // Hail, thunderstorm wind damage and thunderstorm gusts come from SPC already (spc.ts): skipped here.
    expect(scan.signals.map((s) => s.data?.lsrType)).toEqual(['NON-TSTM WND DMG', 'NON-TSTM WND DMG']);
    const s = scan.signals[0];
    expect(s).toMatchObject({ source: 'lsr', kind: 'report', title: 'Wind damage reported near Chokio, MN', summary: LSR_DAMAGE_PART, city: 'Chokio', county: 'Stevens', state: 'MN', lat: 45.57, lon: -96.19, severity: 2 });
    expect(s.categories).toEqual(['tree-service', 'roofing', 'restoration', 'insurance', 'public-adjuster']);
    expect(s.url).toBe('https://mesonet.agron.iastate.edu/p.php?pid=202205130002-KMPX-NWUS53-LSRMPX');
    expect(s.data).toMatchObject({ type: 'wind', windDamage: true, treeDown: false, wfo: 'MPX' });
    const stored = JSON.stringify(scan.signals);
    for (const f of lsrFixture().features) {
      const remark = String(f.properties.remark ?? '');
      if (remark) expect(stored).not.toContain(remark);
    }
    expect(stored).not.toMatch(/TRAINED SPOTTER|PUBLIC/);
    for (const t of LSR_TYPES) expect(t.why).not.toMatch(BANNED);
  });

  it('reads trees from a remark in memory (real remarks of the capture)', () => {
    const remarks = lsrFixture().features.map((f: { properties: { remark: string } }) => f.properties.remark);
    expect(remarks.filter(remarkNamesTrees)).toEqual(['MEDIUM SIZE TREE BRANCH DOWN IN GRAETTINGER. REPORT FROM SOCIAL MEDIA.', 'TREE DOWN ON HOUSE.']);
    expect(remarkNamesTrees('POWER LINES DOWN.')).toBe(false);
    // A tree report becomes the tree summary part.
    const tree = lsrFixture();
    tree.features = tree.features.filter((f: { id: string }) => f.id === '32').map((f: { properties: Record<string, unknown> }) => ({ ...f, properties: { ...f.properties, typetext: 'NON-TSTM WND DMG', type: 'O' } }));
    const [row] = parseLsr(tree);
    expect(row.summary).toBe(`${LSR_TREE_PART} | It names a home`);
    expect(row.data?.treeDown).toBe(true);
  });

  it('a gust row is kept from 50 mph, with the SPC title template', () => {
    const g = lsrFixture();
    g.features = g.features.filter((f: { id: string }) => f.id === '49' || f.id === '59').map((f: { properties: Record<string, unknown> }) => ({ ...f, properties: { ...f.properties, typetext: 'NON-TSTM WND GST', type: 'N' } }));
    const rows = parseLsr(g);
    expect(rows.map((r) => r.title)).toEqual(['58 mph wind gust reported near Mitchell, SD', '60 mph wind gust reported near Elk Point, SD']);
    expect(rows.map((r) => r.data?.windMph)).toEqual([58, 60]);
  });

  it('labels: the same storm rules as SPC; gusts of 58 mph reach siding and gutters only with the routing switch on', () => {
    const [damage] = parseLsr(lsrFixture());
    const row = { ...damage, categories: damage.categories as string[], lat: damage.lat ?? null, lon: damage.lon ?? null, state: damage.state ?? null, severity: damage.severity };
    expect(memberLabel(row, 'tree-service')).toBe('coming_soon');
    expect(memberLabel(row, 'roofing')).toBe('coming_soon');
    expect(memberLabel(row, 'insurance')).toBe('market_insight');
    const gust = { ...row, title: '60 mph wind gust reported near Elk Point, SD', summary: null };
    expect(memberLabel(gust, 'siding-gutters')).toBe('not carried');
    vi.stubEnv('HOLLER_HAIL_ROUTING_ENABLED', '1');
    expect(memberLabel(gust, 'siding-gutters')).toBe('coming_soon');
    expect(memberLabel(gust, 'tree-service')).toBe('coming_soon');
    expect(SOURCE_DEFAULTS.lsr).toBe('act_now');
    expect(briefFamilyOf({ source: 'lsr' })).toBe('storm-report');
  });

  it('Spanish: the title and the summary part are said in Spanish', () => {
    expect(localizeTitle('Wind damage reported near Chokio, MN', 'es', 'lsr')).not.toBe('Wind damage reported near Chokio, MN');
    expect(localizeSummary(LSR_TREE_PART, 'es', 'lsr')).toBe('El reporte menciona árboles o ramas caídos');
    expect(localizeSummary(LSR_DAMAGE_PART, 'es', 'lsr')).toBe('El reporte menciona daños por viento, no confirmado');
  });

  it('is off by default: no request at all', async () => {
    expect(lsrEnabled(undefined)).toBe(false);
    expect(lsrAdapter.enabled?.()).toBe(false);
    const fetch = vi.fn();
    const out = await lsrAdapter.fetch({ since: new Date(), fetch: fetch as unknown as typeof globalThis.fetch, env: {}, log: () => {} });
    expect(out).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('on: one request to the IEM GeoJSON with the metro offices and a 36 hour window', async () => {
    const now = new Date('2026-11-25T12:00:00Z');
    expect(lsrUrl(now)).toBe('https://mesonet.agron.iastate.edu/geojson/lsr.geojson?wfos=FFC,EWX,GSP,RAH,OKX,LOT,LOX&sts=2026-11-24T00:00Z&ets=2026-11-25T12:00Z');
    const fetch = vi.fn(async () => new Response(JSON.stringify(lsrFixture()), { status: 200 }));
    const logs: string[] = [];
    const out = await lsrAdapter.fetch({ since: now, now, fetch: fetch as unknown as typeof globalThis.fetch, env: { HOLLER_LSR_ENABLED: '1' }, log: (m) => logs.push(m) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(2);
    expect(logs).toEqual([]);
    const html = vi.fn(async () => new Response('<html>error</html>', { status: 200 }));
    expect(await lsrAdapter.fetch({ since: now, now, fetch: html as unknown as typeof globalThis.fetch, env: { HOLLER_LSR_ENABLED: '1' }, log: (m) => logs.push(m) })).toEqual([]);
    expect(logs[0]).toMatch(/HTML page/);
  });

  it('is registered with a source label', () => {
    expect(ALL_ADAPTERS.map((a) => a.id)).toContain('lsr');
    expect(getSourceMeta('lsr')?.label).toBe('NWS local storm reports');
  });
});

// ---- Review fixes (round 33 review of PR 21) ---------------------------------------------------------------------------------------------

describe('review P1-2: the text fallback reads only the exact NWS phrasing', () => {
  // Every text of the reviewer's table (gates/r33/review/r33-hail/scripts/parser-table.ts), with the product it is read for.
  const SVR = 'Severe Thunderstorm Warning';
  const CASES: Array<[string, string, string, { hailInches: number | null; gustMph: number | null }]> = [
    ['rain totals', 'Flood Watch', 'Rain totals up to 2 inches are expected. Additional rainfall of 1 to 2 inches possible.', { hailInches: null, gustMph: null }],
    ['knots, below the line', 'Gale Warning', 'Northwest winds 20 to 30 knots with gusts up to 40 knots.', { hailInches: null, gustMph: 46 }],
    ['knots', 'High Wind Warning', 'gusts up to 55 kt expected', { hailInches: null, gustMph: 63 }],
    ['knots with mph in brackets', 'High Wind Warning', 'gusts up to 50 knots (58 mph)', { hailInches: null, gustMph: 58 }],
    ['real High Wind Warning', 'High Wind Warning', 'West winds 35 to 45 mph with gusts up to 75 mph expected.', { hailInches: null, gustMph: 75 }],
    ['gusting as high as', 'High Wind Warning', 'Winds gusting as high as 65 mph.', { hailInches: null, gustMph: 65 }],
    ['could gust as high as', 'High Wind Warning', 'Winds could gust as high as 65 mph.', { hailInches: null, gustMph: 65 }],
    ['negated gust', 'High Wind Warning', 'Gusts up to 60 mph are no longer expected, but gusts up to 45 mph will continue.', { hailInches: null, gustMph: null }],
    ['negated gust, next sentence kept', 'High Wind Warning', 'Gusts up to 60 mph are no longer expected. Gusts up to 45 mph will continue.', { hailInches: null, gustMph: 45 }],
    ['not expected', 'High Wind Watch', 'Gusts up to 70 mph are not expected.', { hailInches: null, gustMph: null }],
    ['storm motion then gusty', SVR, 'moving east at 60 mph gusty winds and small hail are possible', { hailInches: null, gustMph: null }],
    ['storm motion with a period', SVR, 'moving east at 60 mph. Gusty winds of 40 mph.', { hailInches: null, gustMph: null }],
    ['sustained then mph gusts', 'Wind Advisory', 'sustained winds of 40 mph gusts to 55', { hailInches: null, gustMph: null }],
    ['hail depth', SVR, 'Accumulating hail up to 3 inches deep was covering roads.', { hailInches: null, gustMph: null }],
    ['hail depth, flash flood product', 'Flash Flood Warning', 'Accumulating hail up to 3 inches deep was covering roads.', { hailInches: null, gustMph: null }],
    ['hail depth 2', SVR, 'pea size hail 2 inches deep on Interstate 25', { hailInches: 0.25, gustMph: null }],
    ['hail accumulations', SVR, 'hail accumulations of 2 inches', { hailInches: null, gustMph: null }],
    ['town named Hailey', 'Winter Storm Warning', 'Total snow accumulations of 3 to 5 inches in the valley, 5 to 8 in Hailey and Ketchum.', { hailInches: null, gustMph: null }],
    ['town named Hailey, severe product', SVR, 'Total snow accumulations of 3 to 5 inches in the valley, 5 to 8 in Hailey and Ketchum.', { hailInches: null, gustMph: null }],
    ['town named Hailey with inches', 'Winter Storm Warning', 'Total snow accumulations of 5 to 8 inches in Hailey.', { hailInches: null, gustMph: null }],
    ['Hail Creek road', SVR, 'flooding on Highway 6 in Hail Creek', { hailInches: null, gustMph: null }],
    ['snow then hail not expected', SVR, 'snow totals of 4 inches hail is not expected', { hailInches: null, gustMph: null }],
    ['watch text', 'Severe Thunderstorm Watch', 'isolated very large hail events to 2 inches in diameter possible, scattered damaging wind gusts to 70 mph likely', { hailInches: null, gustMph: 70 }],
    ['HAZARD line', SVR, 'HAZARD...60 mph wind gusts and quarter size hail.', { hailInches: 1, gustMph: 60 }],
    ['HAZARD words', SVR, 'HAZARD...Two inch hail and 70 mph wind gusts.', { hailInches: 2, gustMph: 70 }],
    ['golf ball sized', SVR, 'golf ball sized hail was reported', { hailInches: 1.75, gustMph: null }],
    ['half dollar', SVR, 'HAZARD...Half dollar size hail.', { hailInches: 1.25, gustMph: null }],
    ['penny to quarter', SVR, 'penny to quarter size hail', { hailInches: 1, gustMph: null }],
    ['tea cup', SVR, 'tea cup size hail', { hailInches: 3, gustMph: null }],
    ['no hail expected', SVR, 'quarter size hail is no longer expected with this storm', { hailInches: null, gustMph: null }],
    ['temperature', SVR, 'temperatures of 60 mph gusts', { hailInches: null, gustMph: null }],
    ['km/h', 'High Wind Warning', 'gusts up to 100 km/h', { hailInches: null, gustMph: null }],
    ['hail up to N inches', SVR, 'Hail up to 1.75 inches in diameter is possible.', { hailInches: 1.75, gustMph: null }],
    ['N inch hail on a winter product', 'Winter Storm Warning', 'HAZARD...Two inch hail and 70 mph wind gusts.', { hailInches: null, gustMph: 70 }],
    ['wind gusts of N mph', 'Special Weather Statement', 'HAZARD...Wind gusts of 50 to 55 mph.', { hailInches: null, gustMph: 55 }],
  ];
  for (const [name, event, text, want] of CASES) {
    it(name, () => expect(hazardFromText(text, event)).toEqual(want));
  }

  it('a CAP parameter that is present wins, including 0.00, and the text is never read for it', () => {
    // A real Tornado Warning whose CAP says maxHailSize 0.00, with a sentence about another storm's hail in its text.
    const tor = capHazardOf({ maxHailSize: ['0.00'], tornadoDetection: ['RADAR INDICATED'] }, 'HAZARD...Tornado. A storm to the north produced quarter size hail.', 'Tornado Warning');
    expect(tor).toMatchObject({ maxHailSizeIn: null, maxWindGustMph: null, hazardFrom: 'cap' });
    // CAP hail present, gust absent: the gust may come from the text.
    expect(capHazardOf({ maxHailSize: ['1.75'] }, 'HAZARD...70 mph wind gusts.', 'Tornado Warning')).toMatchObject({ maxHailSizeIn: 1.75, maxWindGustMph: 70, hazardFrom: 'cap+text' });
    expect(capHazardOf({}, 'Nothing here.', 'High Wind Warning').hazardFrom).toBe('none');
    // The stored row says ingest decided: the read never falls back to the summary text.
    const row = { source: 'nws', title: 'Tornado Warning: Seward, NE', summary: 'Quarter size hail fell north of here. 70 mph wind gusts.', data: { hazardFrom: 'cap' } };
    expect(weatherFactsOf(row, true)).toBeNull();
    expect(weatherFactsOf({ ...row, data: null, hazardFrom: 'none' }, true)).toBeNull();
    // A row stored before round 33 (no hazardFrom) is read from its summary.
    expect(weatherFactsOf({ ...row, data: null }, true)).toEqual({ hailInches: 1, gustMph: 70 });
  });

  it('parseNws stores hazardFrom on every alert, and a CAP 0.00 alert stores no hail', () => {
    const sws = parseNws(cap('midland-sws-2026-09-30'));
    expect(sws).toEqual([]); // a Special Weather Statement is not ingested
    const p = cap('norman-tor-2025-04-19-observed');
    p.features[0].properties.parameters.maxHailSize = ['0.00'];
    const [tor] = parseNws(p);
    expect(tor.data).toMatchObject({ hazardFrom: 'cap', tornadoDetection: 'OBSERVED' });
    expect(tor.data).not.toHaveProperty('maxHailSizeIn');
    expect(WEATHER_SELECT).toContain('hazardFrom:data->>hazardFrom');
  });
});

describe('review P2-1: any watch or advisory naming 58+ mph gusts is feed only', () => {
  const at = (title: string) => ({ source: 'nws', kind: 'alert', title, summary: 's', categories: ['snow-removal', 'tree-service', 'roofing'], lat: 33.7, lon: -84.4, state: 'GA', severity: 2, maxWindGustMph: '60', hazardFrom: 'text' });
  it('watches, advisories and statements: feed only; warnings: the row level; floods: nothing', () => {
    vi.stubEnv('HOLLER_HAIL_ROUTING_ENABLED', '1');
    for (const ev of ['Winter Weather Advisory', 'Winter Storm Watch', 'Wind Advisory', 'High Wind Watch', 'Freeze Warning']) {
      const want = ev === 'Freeze Warning' ? 'market_insight' : 'market_insight';
      expect(memberLabel(at(`${ev}: Fulton, GA`), 'tree-service'), ev).toBe(want);
      expect(memberLabel(at(`${ev}: Fulton, GA`), 'siding-gutters'), ev).toBe(want);
    }
    for (const ev of ['Winter Storm Warning', 'Blizzard Warning', 'High Wind Warning']) {
      expect(memberLabel(at(`${ev}: Fulton, GA`), 'tree-service'), ev).toBe('coming_soon');
      expect(memberLabel(at(`${ev}: Fulton, GA`), 'siding-gutters'), ev).toBe('coming_soon');
    }
    for (const ev of ['Coastal Flood Warning', 'Flash Flood Warning', 'Flood Advisory']) {
      expect(memberLabel({ ...at(`${ev}: Fulton, GA`), categories: ['restoration'] }, 'siding-gutters'), ev).toBe('not carried');
    }
    // The winter advisory row gives snow removal a heads-up; that does not lift the routed trades.
    expect(memberLabel(at('Winter Weather Advisory: Fulton, GA'), 'snow-removal')).toBe('coming_soon');
  });
});

describe('review P1-3: an LSR report routes exactly like the SPC report with the same remark', () => {
  // The reviewer's remarks (lsr-probe.ts) plus real SPC remark wordings; never stored, read in memory only.
  const REMARKS = [
    'TREE DOWN BLOCKING HIGHWAY 9 NEAR MILE MARKER 4.',
    'TREE FELL ON HOME.',
    'TREE DOWN ON HOUSE.',
    'SHINGLES AND SIDING BLOWN OFF A HOUSE.',
    'STREET SIGN BLOWN DOWN.',
    'POWER LINES DOWN.',
    'TREES DOWN IN YARD ON MAIN ROAD.',
    'LARGE LIMB ON CAR IN DRIVEWAY.',
    'GARAGE DOOR BLOWN IN.',
    'TREE ACROSS INTERSTATE 75 RAMP.',
    'ROOF BLOWN OFF BARN AND TREES UPROOTED.',
    'WATERPROOF TARP BLOWN AWAY.',
  ];
  const TRADES = ['tree-service', 'roofing', 'restoration'] as const;
  it('every one of the 32 fact combinations is read back identically from the stored phrases', () => {
    for (let mask = 0; mask < 32; mask++) {
      const f = { trees: !!(mask & 1), road: !!(mask & 2), roof: !!(mask & 4), structure: !!(mask & 8) || !!(mask & 4), homeOrYard: !!(mask & 16) };
      const back = windDamageFactsOf(lsrSummaryOf(f));
      for (const t of TRADES) expect(windDamageLevelOf(back, t), `${mask} ${t}`).toBe(windDamageLevelOf(f, t));
    }
  });
  it('labels match SPC for every trade, and the remark is not stored', () => {
    for (const remark of REMARKS) {
      const lsr = parseLsr({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: { wfo: 'FFC', type: 'O', typetext: 'NON-TSTM WND DMG', magnitude: '', unit: null, county: 'FULTON', state: 'GA', city: '2 NW ATLANTA', valid: '2026-11-25T10:00:00Z', lat: 33.77, lon: -84.42, product_id: 'P', remark } }] })[0];
      expect(JSON.stringify(lsr), remark).not.toContain(remark);
      const spc = { source: 'spc', kind: 'report', title: 'Wind damage reported near Atlanta, GA', summary: remark };
      for (const t of ['tree-service', 'roofing', 'restoration', 'insurance', 'public-adjuster', 'siding-gutters'] as CategoryId[]) {
        expect(labelFor({ source: 'lsr', kind: 'report', title: lsr.title, summary: lsr.summary }, t), `${remark} ${t}`).toBe(labelFor(spc, t));
      }
    }
    // Tree across a road: the road crew's job (line 39), as SPC: a heads-up, not act now. On a home: restoration act now, as SPC.
    const road = parseLsr({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { typetext: 'NON-TSTM WND DMG', county: 'FULTON', state: 'GA', city: 'ATLANTA', valid: '2026-11-25T10:00:00Z', lat: 33.77, lon: -84.42, remark: REMARKS[0] } }] })[0];
    expect(road.data).toMatchObject({ treeDown: true, blocksRoad: true, onStructure: false });
    expect(labelFor({ source: 'lsr', title: road.title, summary: road.summary }, 'tree-service')).toBe('coming_soon');
    const home = parseLsr({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { typetext: 'NON-TSTM WND DMG', county: 'FULTON', state: 'GA', city: 'ATLANTA', valid: '2026-11-25T10:00:00Z', lat: 33.77, lon: -84.42, remark: REMARKS[1] } }] })[0];
    expect(labelFor({ source: 'lsr', title: home.title, summary: home.summary }, 'restoration')).toBe('act_now');
    expect(labelFor({ source: 'lsr', title: home.title, summary: home.summary }, 'tree-service')).toBe('act_now');
    // Every part has a Spanish twin.
    for (const part of LSR_PARTS) expect(localizeSummary(part, 'es', 'lsr'), part).not.toBe(part);
  });
});

describe('review P2-4 and P2-5: LSR unit, place, AI and the empty answer', () => {
  it('a gust in knots is converted; an unknown unit is skipped', () => {
    expect(lsrGustMph('62', 'MPH')).toBe(62);
    expect(lsrGustMph('50', 'KTS')).toBe(58);
    expect(lsrGustMph('50', 'KT')).toBe(58);
    expect(lsrGustMph('60', null)).toBe(60);
    expect(lsrGustMph('60', 'M/S')).toBeNull();
  });
  it('a free-text location never reaches the title; the county is used instead', () => {
    expect(lsrPlace('1 W CHOKIO')).toBe('Chokio');
    expect(lsrPlace('JOHN Q PUBLIC RESIDENCE 123 MAPLE ST')).toBeNull();
    const [row] = parseLsr({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { typetext: 'NON-TSTM WND DMG', county: 'FULTON', state: 'GA', city: 'JOHN Q PUBLIC RESIDENCE 123 MAPLE ST', valid: '2026-11-25T10:00:00Z', lat: 33.77, lon: -84.42, remark: 'TREE DOWN.' } }] });
    expect(row.title).toBe('Wind damage reported near Fulton, GA');
    expect(JSON.stringify(row)).not.toMatch(/JOHN|MAPLE/);
  });
  it('lsr is not sent to the AI classifier, like the other weather sources', () => {
    expect(SKIP_SOURCES.has('lsr')).toBe(true);
    expect(SKIP_SOURCES.has('spc')).toBe(true);
  });
  it('an answer with no features at all is logged as an error (more than 24 hours with no report of any kind)', async () => {
    const now = new Date('2026-11-25T12:00:00Z');
    const logs: string[] = [];
    const empty = vi.fn(async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 }));
    expect(await lsrAdapter.fetch({ since: now, now, fetch: empty as unknown as typeof globalThis.fetch, env: { HOLLER_LSR_ENABLED: '1' }, log: (m) => logs.push(m) })).toEqual([]);
    expect(logs).toEqual([LSR_EMPTY_LOG]);
    expect(LSR_EMPTY_LOG).toMatch(/^error: lsr returned 0 reports of any kind from 7 NWS offices over 36 hours/);
    expect(LSR_LOOKBACK_HOURS).toBeGreaterThan(24);
  });
  it('the saved real IEM response (lsr.geojson capture) parses with the adapter; the request is the form checked live', () => {
    // Checked live 2026-11-25 (fetch tool): this exact form with wfos=FFC,EWX,GSP,RAH,OKX,LOT,LOX&sts=2026-01-24T12:00Z&ets=2026-01-26T00:00Z
    // answered 210+ features, every one inside the window (2026-01-24T14:00Z to 2026-01-26T00:00Z) and only from the listed offices.
    expect(lsrUrl(new Date('2026-01-26T00:00:00Z'), LSR_WFOS, 36)).toBe('https://mesonet.agron.iastate.edu/geojson/lsr.geojson?wfos=FFC,EWX,GSP,RAH,OKX,LOT,LOX&sts=2026-01-24T12:00Z&ets=2026-01-26T00:00Z');
    const scan = scanLsr(lsrFixture());
    expect(scan.usable).toBe(scan.rows);
  });
});

describe('review P1-1: the home page source count does not change while the new switches are off', () => {
  it('counts 48 sources with every round 33 switch off (main counts 48), and 49 with HOLLER_LSR_ENABLED on', () => {
    expect(feedCount(ALL_ADAPTERS, {})).toBe(48);
    vi.stubEnv('HOLLER_LSR_ENABLED', '1');
    expect(feedCount(ALL_ADAPTERS, {})).toBe(49);
  });
});
