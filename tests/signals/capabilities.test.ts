/**
 * Proof for lib/signals/capabilities.ts. Every claimed (trade, signal type) pair is shown by running the REAL rule, classifier or parser
 * on an example input and checking that the trade comes out. Nothing here reads the tables back out of capabilities.ts to prove itself.
 * Fixtures: the repo fixtures in tests/fixtures (see each test file header for sourced/assumed); inline probes are hand-written examples of
 * each rule's vocabulary (assumed values, real code under test).
 */
import { APPROX_LOCATION_SOURCES } from '@/lib/signals/approx-location';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORY_IDS, classifyText, type CategoryId } from '@/lib/signals/categories';
import {
  CITY_FEEDS,
  COUNTY_FEEDS,
  FEMA_INCIDENT_TYPES,
  SIGNAL_NEEDS_KEY,
  SIGNAL_TRADES,
  SIGNAL_TYPE_IDS,
  TRADE_SIGNALS,
  TRADE_SIGNALS_KEYLESS,
  enabledDatasets,
  placeSlugOfDataset,
  type SignalTypeId,
} from '@/lib/signals/capabilities';
import { parseNws } from '@/lib/signals/adapters/nws';
import { parseSpc } from '@/lib/signals/adapters/spc';
import { parseFema } from '@/lib/signals/adapters/fema';
import { parseUsgs } from '@/lib/signals/adapters/usgs';
import { parseFaa } from '@/lib/signals/adapters/faa';
import { naicsToCategories } from '@/lib/signals/adapters/usaspending';
import { parseTicketmaster } from '@/lib/signals/adapters/ticketmaster';
import { parseBluesky } from '@/lib/signals/adapters/bluesky';
import { ASK_TERMS } from '@/lib/signals/adapters/websearch';
import { categorize, parseSocrata } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { placeSlugFor } from '@/lib/signals/run';
import { cityBySlug, haversineMi } from '@/lib/geo';

const fx = (n: string): string => readFileSync(join(__dirname, '../fixtures', n), 'utf8');
const NOW = new Date('2026-11-17T12:00:00Z');

function nwsFeature(event: string, description = '') {
  return {
    id: `https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.${event.length}`,
    geometry: null,
    properties: {
      id: `urn:oid:2.49.0.1.840.0.${event.length}`, event, status: 'Actual', messageType: 'Alert', severity: 'Severe',
      areaDesc: 'Fulton, GA', geocode: { UGC: ['GAZ045'] }, onset: '2026-11-17T10:00:00Z', ends: '2026-11-17T20:00:00Z', description,
    },
  };
}

/** Categories the real code produces for each example, per signal type. */
const PRODUCED: Record<SignalTypeId, () => CategoryId[][]> = {
  'weather-alert': () => {
    const events = [
      'Tornado Warning', 'Hurricane Warning', 'Severe Thunderstorm Warning', 'Flash Flood Warning', 'Ice Storm Warning',
      'Winter Storm Warning', 'Extreme Cold Warning', 'Freeze Warning', 'Excessive Heat Warning', 'High Wind Warning', 'Red Flag Warning',
    ];
    const out = parseNws({ features: events.map((e) => nwsFeature(e)) });
    const hail = parseNws({ features: [nwsFeature('Severe Thunderstorm Warning', 'Quarter size hail and 60 mph winds expected.')] });
    return [...out, ...hail].map((s) => s.categories);
  },
  'storm-report': () => {
    const day = '2026-11-16';
    const hail = parseSpc({ type: 'hail', day, csv: 'Time,Size,Location,County,State,Lat,Lon,Comments\n2012,175,2 N Tulsa,Tulsa,OK,36.2,-95.9,golf ball\n' });
    const wind = parseSpc({ type: 'wind', day, csv: 'Time,Speed,Location,County,State,Lat,Lon,Comments\n2012,70,2 N Tulsa,Tulsa,OK,36.2,-95.9,trees down\n' });
    const torn = parseSpc({ type: 'torn', day, csv: 'Time,F_Scale,Location,County,State,Lat,Lon,Comments\n2012,UNK,2 N Tulsa,Tulsa,OK,36.2,-95.9,tornado\n' });
    return [...hail, ...wind, ...torn].map((s) => s.categories);
  },
  disaster: () => {
    const rows = FEMA_INCIDENT_TYPES.map((incidentType, i) => ({
      disasterNumber: 4000 + i, state: 'TX', declarationType: 'DR', declarationDate: '2026-11-01T00:00:00.000Z', incidentType,
      declarationTitle: incidentType, designatedArea: 'Harris (County)', iaProgramDeclared: true,
    }));
    return parseFema({ DisasterDeclarationsSummaries: rows }).map((s) => s.categories);
  },
  quake: () => {
    const raw = JSON.parse(fx('usgs-2.5_day.json')) as { features: { properties: { mag: number; place: string } }[] };
    // force one US M4.5 so the example does not depend on today's fixture mix
    raw.features[0].properties.mag = 4.5;
    raw.features[0].properties.place = '5 km NNE of Ridgecrest, CA';
    return parseUsgs(raw).map((s) => s.categories);
  },
  airport: () => parseFaa(fx('faa-status.xml')).map((s) => s.categories),
  permit: () => {
    const ds = SOCRATA_DATASETS.find((d) => d.subtype === 'permit')!;
    const texts = [
      'Re-roof single family house', 'Install swimming pool', 'Solar photovoltaic system', 'HVAC furnace replacement', 'Water heater plumbing',
      'Electrical panel upgrade', 'Demolition of garage', 'New construction commercial office building', 'New single family residence',
      'New construction | Single Family Residential', 'Install fence', 'Concrete driveway', 'Window and door replacement', 'Vinyl siding and gutters',
      'Flooring replacement hardwood', 'Install sign', 'Tree removal', 'Retaining wall', 'Exterior painting', 'Fire damage repair',
    ];
    return texts.map((t) => categorize(ds, t).categories);
  },
  '311': () => {
    const ds = SOCRATA_DATASETS.find((d) => d.subtype === '311')!;
    const texts = ['Rodent complaint', 'Tree limb down', 'Graffiti removal', 'Illegal dumping', 'Overgrown weeds', 'Property violation', 'No heat', 'Sewer backup', 'Mold in unit'];
    return texts.map((t) => categorize(ds, t).categories);
  },
  inspection: () => {
    const ds = SOCRATA_DATASETS.find((d) => d.subtype === 'inspection')!;
    return [categorize(ds, 'Rodent droppings observed').categories];
  },
  business: () => {
    const ds = SOCRATA_DATASETS.find((d) => d.subtype === 'business')!;
    return ['Limited Business License', 'Retail Food Establishment restaurant'].map((t) => categorize(ds, t).categories);
  },
  violation: () => {
    const ds = SOCRATA_DATASETS.find((d) => d.subtype === 'violation')!;
    const texts = [
      'Overgrown weeds', 'Property Abatement', 'Trash and debris', 'Inoperable vehicle', 'Rodent infestation', 'Roof leak', 'Siding and gutter',
      'Exterior wall facade', 'Unsafe structure', 'Fence in disrepair', 'Broken windows and doors', 'Peeling paint', 'Plumbing leak', 'Electrical wiring',
      'No heat furnace', 'Mold and water damage', 'Driveway and sidewalk', 'Floors', 'Tree limbs', 'Swimming pool',
    ];
    return texts.map((t) => categorize(ds, t).categories);
  },
  event: () => parseTicketmaster(JSON.parse(fx('ticketmaster-events.json'))).map((s) => s.categories),
  'event-permit': () => {
    const ds = SOCRATA_DATASETS.find((d) => d.subtype === 'event-permit')!;
    return [categorize(ds, 'Street Festival').categories];
  },
  contract: () =>
    ['561720', '561730', '561710', '561740', '561210', '561612', '561621', '238160', '238220', '238210', '238320', '238910', '238990', '236220', '237310', '562910', '562111', '722330'].map(
      (c) => naicsToCategories(c),
    ),
  ask: () =>
    CATEGORY_IDS.map((id) => {
      const post = { uri: `at://did:plc:x/app.bsky.feed.post/${id}`, author: { handle: 'someone.bsky.social' }, record: { text: `Can anyone recommend a ${ASK_TERMS[id]} in Atlanta, GA?`, createdAt: NOW.toISOString() } };
      return parseBluesky({ posts: [post] }, NOW).flatMap((s) => s.categories);
    }),
};

describe('TRADE_SIGNALS: every claimed pair is produced by the real code', () => {
  const produced = Object.fromEntries(SIGNAL_TYPE_IDS.map((t) => [t, PRODUCED[t]()])) as Record<SignalTypeId, CategoryId[][]>;

  for (const type of SIGNAL_TYPE_IDS) {
    it(`${type}: every trade it claims is produced by a real example`, () => {
      expect(produced[type].length).toBeGreaterThan(0);
      const seen = new Set(produced[type].flat());
      for (const trade of SIGNAL_TRADES[type]) {
        expect(seen.has(trade), `${type} claims ${trade} but no example produced it`).toBe(true);
      }
    });
  }

  it('every (trade, type) pair in TRADE_SIGNALS is in the produced set', () => {
    let pairs = 0;
    for (const trade of CATEGORY_IDS) {
      for (const type of TRADE_SIGNALS[trade]) {
        pairs++;
        expect(produced[type].some((cats) => cats.includes(trade)), `${trade} / ${type}`).toBe(true);
      }
    }
    expect(pairs).toBeGreaterThan(150);
  });

  it('the pure-rule types claim nothing the examples did not show (no over-claiming)', () => {
    for (const type of ['weather-alert', 'storm-report', 'disaster', 'quake', 'airport', 'business', 'event-permit', 'contract', 'event'] as SignalTypeId[]) {
      const seen = new Set(produced[type].flat());
      for (const trade of seen) expect(SIGNAL_TRADES[type], `${type} produced ${trade}`).toContain(trade);
    }
  });

  it('the review cases: rules added where the claim is true', () => {
    expect(TRADE_SIGNALS['public-adjuster']).toEqual(expect.arrayContaining(['weather-alert', 'storm-report', 'disaster']));
    expect(TRADE_SIGNALS['real-estate']).toContain('permit');
    expect(TRADE_SIGNALS.moving).toContain('permit');
    expect(TRADE_SIGNALS.locksmith).toContain('business');
  });

  it('nothing is invented to fill the table: a trade with no real source keeps only people-asking', () => {
    for (const trade of ['childcare', 'beauty'] as CategoryId[]) expect(TRADE_SIGNALS[trade]).toEqual(['ask']);
    // winter storm and freeze do not call a locksmith (the review's "not defensible" case)
    const winter = parseNws({ features: [nwsFeature('Winter Storm Warning'), nwsFeature('Freeze Warning')] });
    for (const s of winter) expect(s.categories).not.toContain('locksmith');
    expect(TRADE_SIGNALS.locksmith).not.toContain('weather-alert');
  });

  it('every trade has at least one entry and the keyless view drops only key-gated types', () => {
    for (const trade of CATEGORY_IDS) {
      expect(TRADE_SIGNALS[trade].length).toBeGreaterThan(0);
      for (const t of TRADE_SIGNALS_KEYLESS[trade]) expect(SIGNAL_NEEDS_KEY[t]).toBeUndefined();
    }
    expect(TRADE_SIGNALS_KEYLESS.childcare).toEqual([]);
    expect(TRADE_SIGNALS_KEYLESS.roofing).toEqual(expect.arrayContaining(['weather-alert', 'storm-report', 'permit']));
  });

  it('key-gated types really are gated by every adapter that feeds them', () => {
    const gate = (ids: string[]) => ALL_ADAPTERS.filter((a) => ids.includes(a.id));
    for (const a of gate(['ticketmaster', 'websearch-brave', 'websearch-serper', 'bluesky'])) expect(a.requiresEnv?.length).toBeGreaterThan(0);
    const bluesky = ALL_ADAPTERS.find((a) => a.id === 'bluesky')!;
    expect(bluesky.requiresEnv).toEqual(['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD']);
  });

  it('classifier-only hits are not claimed: a permit that says "locksmith" is incidental', () => {
    expect(classifyText('locksmith deadbolt')).toContain('locksmith');
    expect(TRADE_SIGNALS.locksmith).not.toContain('permit');
  });
});

describe('CITY_FEEDS', () => {
  it('every enabled dataset resolves to a city page slug', () => {
    for (const ds of enabledDatasets()) {
      // Round 7 fix-a (review r1 P1): an approximate-location feed (Cobb County, rows at the county seat) is never listed on a city page,
      // so no city claims it. Its rows get no place slug (tests/match/review-r1-fix.test.ts).
      if (APPROX_LOCATION_SOURCES.has(ds.id)) continue;
      const slug = placeSlugOfDataset(ds);
      expect(slug, ds.id).not.toBeNull();
      expect(cityBySlug(slug!), ds.id).toBeDefined();
      expect(CITY_FEEDS[slug!], ds.id).toContain(ds.subtype);
    }
  });

  it('disabled datasets are not claimed', () => {
    for (const ds of [...SOCRATA_DATASETS, ...ARCGIS_DATASETS].filter((d) => !d.verified)) {
      const slug = placeSlugOfDataset(ds as never);
      const others = enabledDatasets().filter((d) => placeSlugOfDataset(d) === slug && d.subtype === ds.subtype);
      if (others.length === 0 && slug) expect(CITY_FEEDS[slug] ?? [], `${ds.id} is disabled`).not.toContain(ds.subtype);
    }
  });

  it('proof by parsing: each dataset with a fixture produces rows that land on the claimed city slug', () => {
    let proven = 0;
    for (const ds of enabledDatasets()) {
      let raw: unknown;
      try {
        raw = JSON.parse(fx(`${ds.id}.json`));
      } catch {
        continue;
      }
      const items = SOCRATA_DATASETS.some((d) => d.id === ds.id)
        ? parseSocrata(raw, SOCRATA_DATASETS.find((d) => d.id === ds.id)!)
        : parseArcgis(raw, ARCGIS_DATASETS.find((d) => d.id === ds.id)!);
      expect(items.length, ds.id).toBeGreaterThan(0);
      const slug = placeSlugOfDataset(ds)!;
      // place_slug is the NEAREST city, so a west-side Chicago row can land on cicero-il: the claim is "on or beside this city".
      const home = cityBySlug(slug)!;
      for (const s of items) {
        const landed = placeSlugFor(s);
        expect(landed, `${ds.id} row has no place`).not.toBeNull();
        const c = cityBySlug(landed!)!;
        expect(haversineMi(home.lat, home.lon, c.lat, c.lon), `${ds.id} landed on ${landed}, claimed ${slug}`).toBeLessThan(15);
      }
      expect(items.every((s) => s.data?.subtype === ds.subtype)).toBe(true);
      proven++;
    }
    expect(proven).toBeGreaterThanOrEqual(15);
  });

  it('Atlanta has permits only because of DeKalb County, and says so', () => {
    expect(CITY_FEEDS['atlanta-ga']).toContain('permit');
    expect(COUNTY_FEEDS['atlanta-ga']).toContain('permit');
    expect(CITY_FEEDS['atlanta-ga']).not.toContain('311');
    expect(CITY_FEEDS['atlanta-ga']).toContain('airport');
  });

  it('cities with no feed are absent, not empty', () => {
    expect(CITY_FEEDS['billings-mt']).toBeUndefined();
    expect(CITY_FEEDS['chicago-il']).toEqual(expect.arrayContaining(['permit', '311', 'inspection', 'business', 'violation', 'event-permit']));
  });
});
