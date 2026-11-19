/**
 * Coverage checks for the two national weather feeds.
 * Provenance: on 2026-11-19 the live NWS list (api.weather.gov/alerts/active?status=actual&message_type=alert) held 333 alerts, 138 Small Craft
 * Advisories and 132 Gale Warnings among them, and "Brisk Wind Advisory" rows whose only zones were Alaska marine zones (PKZ809, PKZ813, PKZ860).
 * Those used to pass the wind rule and be stored with state "PK". The SPC rows below are the live yesterday_filtered.csv content of the same day
 * (a combined file with one header per hazard section).
 */
import { describe, expect, it } from 'vitest';
import { LAND_STATE_CODES, isMarineOnly, parseNws, statesFromUgc } from '@/lib/signals/adapters/nws';
import { parseSpc, scanSpc } from '@/lib/signals/adapters/spc';

type Alert = { event: string; ugc: string[]; areaDesc?: string; geometry?: unknown };
const feature = (a: Alert, i: number) => ({
  id: `https://api.weather.gov/alerts/urn:oid:test.${i}`,
  geometry: a.geometry ?? null,
  properties: {
    id: `urn:oid:test.${i}`,
    '@id': `https://api.weather.gov/alerts/urn:oid:test.${i}`,
    event: a.event,
    status: 'Actual',
    messageType: 'Alert',
    areaDesc: a.areaDesc ?? 'Test area',
    geocode: { UGC: a.ugc },
    sent: '2026-11-19T10:00:00-05:00',
    effective: '2026-11-19T10:00:00-05:00',
    expires: '2026-11-19T18:00:00-05:00',
    severity: 'Moderate',
    headline: `${a.event} issued`,
    description: 'Test.',
  },
});

describe('NWS: no state list, marine zones are not states', () => {
  it('keeps a land alert for every kind of state or territory code', () => {
    const codes = ['GAZ045', 'AKZ101', 'HIZ001', 'PRZ001', 'TXC201', 'WAZ503', 'FLZ066', 'NYZ072'];
    const out = parseNws({ features: codes.map((u, i) => feature({ event: 'Severe Thunderstorm Warning', ugc: [u] }, i)) });
    expect(out.map((s) => s.state)).toEqual(['GA', 'AK', 'HI', 'PR', 'TX', 'WA', 'FL', 'NY']);
  });

  it('drops an alert whose only zones are marine zones (live 2026-11-19: Brisk Wind Advisory on PKZ809)', () => {
    const out = parseNws({
      features: [
        feature({ event: 'Brisk Wind Advisory', ugc: ['PKZ809'], areaDesc: 'Motherwood Point to Cape Krusenstern out to 10 NM' }, 1),
        feature({ event: 'Flood Advisory', ugc: ['GMZ044', 'LMZ740'] }, 2),
        feature({ event: 'Wind Advisory', ugc: ['GAZ045'] }, 3),
      ],
    });
    expect(out.map((s) => s.title.split(':')[0])).toEqual(['Wind Advisory']);
    expect(out.every((s) => s.state === 'GA')).toBe(true);
  });

  it('keeps a mixed land and marine alert and gives it the land state only', () => {
    const out = parseNws({ features: [feature({ event: 'Coastal Flood Advisory', ugc: ['AMZ354', 'FLZ066'] }, 1)] });
    expect(out.length).toBe(1);
    expect(out[0].state).toBe('FL');
  });

  it('knows the marine prefixes are not state codes', () => {
    for (const m of ['AM', 'AN', 'GM', 'LC', 'LE', 'LH', 'LM', 'LO', 'LS', 'PH', 'PK', 'PM', 'PS', 'PZ', 'SL']) expect(LAND_STATE_CODES.has(m), m).toBe(false);
    expect(statesFromUgc(['PKZ809', 'GMZ044'])).toEqual([]);
    expect(statesFromUgc(['GAC067', 'GAZ045', 'ALZ010'])).toEqual(['GA', 'AL']);
    expect(isMarineOnly(['PKZ809'])).toBe(true);
    expect(isMarineOnly(['PKZ809', 'AKZ101'])).toBe(false);
    expect(isMarineOnly([])).toBe(false);
    expect(isMarineOnly(undefined)).toBe(false);
  });

  it('keeps Cold Weather Advisory (the 2024 rename of Wind Chill Advisory) for heating and plumbing trades', () => {
    const out = parseNws({ features: [feature({ event: 'Cold Weather Advisory', ugc: ['GAZ045'] }, 1), feature({ event: 'Extreme Cold Warning', ugc: ['MNZ001'] }, 2)] });
    expect(out.length).toBe(2);
    expect(out[0].categories).toEqual(expect.arrayContaining(['hvac', 'plumbing']));
  });

  it('still ignores boating and visibility products on the list', () => {
    const out = parseNws({
      features: ['Small Craft Advisory', 'Gale Warning', 'Dense Fog Advisory', 'High Surf Advisory', 'Rip Current Statement', 'Air Quality Alert'].map((event, i) => feature({ event, ugc: ['GAZ045'] }, i)),
    });
    expect(out).toEqual([]);
  });
});

describe('SPC: no state list; the only filters are size and speed', () => {
  // Live 2026-11-19 content of yesterday_filtered.csv (combined file), plus two rows below the thresholds and one tornado row from another state.
  const csv = [
    'Time,F_Scale,Location,County,State,Lat,Lon,Comments',
    '0100,EF1,3 N Example,Cobb,GA,33.95,-84.55,Tornado reported (test row)',
    'Time,Speed,Location,County,State,Lat,Lon,Comments',
    '2342,60,1 S Allison,McKinley,NM,35.51,-108.79,Peak wind gust from passing thunderstorm. (ABQ)',
    '2300,45,2 W Lowwind,Fulton,GA,33.80,-84.40,Gust at 45 mph (test row below the 50 mph line)',
    '1200,UNK,2 W Boca Chica,GMZ044,FL,24.58,-81.72,Palm trees felled and mobile sign blown over (live 2026-11-19 today file)',
    'Time,Size,Location,County,State,Lat,Lon,Comments',
    '0410,100,2 W Hollywood,Broward,FL,26.03,-80.19,Quarter size hail reported to fall in Hollywood associated with a severe thunderstorm over the area. (MFL)',
    '0500,75,1 N Smallhail,Cobb,GA,33.90,-84.50,Penny size hail (test row below the 1.00 inch line)',
    '0600,175,4 E Bighail,Gwinnett,GA,33.95,-84.00,Golf ball hail (test row)',
  ].join('\n');

  it('keeps tornado, wind and hail rows from every state and drops the rows under the thresholds', () => {
    const out = parseSpc({ csv, type: 'torn', day: '2026-11-18' });
    expect(out.map((s) => `${s.state}:${s.data?.type}`).sort()).toEqual(['FL:hail', 'FL:wind', 'GA:hail', 'GA:torn', 'NM:wind']);
    const hail = out.filter((s) => s.data?.type === 'hail').map((s) => s.data?.hailInches).sort();
    expect(hail).toEqual([1, 1.75]);
    expect(out.find((s) => s.state === 'NM')!.title).toBe('60 mph wind gust reported near 1 S Allison, NM');
  });

  it('reads the headers of a combined file section by section and counts rows', () => {
    const scan = scanSpc({ csv, type: 'torn', day: '2026-11-18' });
    expect(scan.headerOk).toBe(true);
    expect(scan.rows).toBe(7);
    expect(scan.usable).toBe(7);
  });
});
