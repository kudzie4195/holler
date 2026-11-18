import { describe, expect, it } from 'vitest';
import { buildReports, buildSlug, cleanPlace, countyLabel, indexWindow, officialUrl, parseSlug, qualifies, slugify } from '@/lib/storms/report';
import { localDate, localTime } from '@/lib/storms/zones';
import { cobbDay, fema, spc } from './helpers';

describe('threshold', () => {
  it('2 SPC reports in a county on a day do not qualify, 3 do', () => {
    const two = buildReports(cobbDay().slice(0, 2));
    expect(two).toHaveLength(1);
    expect(two[0].spcTotal).toBe(2);
    expect(two[0].qualifies).toBe(false);
    const three = buildReports(cobbDay());
    expect(three[0].spcTotal).toBe(3);
    expect(three[0].qualifies).toBe(true);
  });
  it('reports in different counties are not added together', () => {
    const rows = [spc({ county: 'Cobb' }), spc({ county: 'Cobb' }), spc({ county: 'Fulton' })];
    const reports = buildReports(rows);
    expect(reports.map((r) => r.qualifies)).toEqual([false, false]);
  });
  it('a FEMA storm declaration qualifies by itself; a fire declaration makes no report', () => {
    const r = buildReports([fema()]);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('state');
    expect(r[0].qualifies).toBe(true);
    expect(r[0].declarations).toBe(1);
    expect(buildReports([fema({ incident: 'Fire' }), fema({ incident: 'Biological' })])).toHaveLength(0);
  });
  it('rows with an unknown type, an unknown state, or no county and no usable city are ignored', () => {
    expect(buildReports([spc({ type: 'other' }), spc({ state: 'ZZ' }), spc({ county: null, city: null }), spc({ county: null, city: '12 Main St' })])).toHaveLength(0);
  });
  it('with no county, the city is the place', () => {
    const rows = [0, 1, 2].map((i) => spc({ county: null, city: 'Marietta', occurred_at: `2026-11-14T2${i}:00:00.000Z` }));
    const r = buildReports(rows);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('city');
    expect(r[0].place).toBe('Marietta, GA');
    expect(r[0].qualifies).toBe(true);
    expect(r[0].slug).toBe('city-of-marietta-2026-11-14');
  });
  it('qualifies() is the rule', () => {
    expect(qualifies({ kind: 'county', spcTotal: 3, declarations: 0 })).toBe(true);
    expect(qualifies({ kind: 'county', spcTotal: 2, declarations: 0 })).toBe(false);
    expect(qualifies({ kind: 'state', spcTotal: 0, declarations: 1 })).toBe(true);
  });
  it('record values: counts by type, largest hail, peak wind, first and last time, only when the record has them', () => {
    const r = buildReports(cobbDay())[0];
    expect(r.counts).toEqual({ tornado: 1, hail: 1, wind: 1 });
    expect(r.largestHailIn).toBe(1.75);
    expect(r.peakWindMph).toBe(62);
    expect(r.firstLabel).toBe('3:10 PM EST');
    expect(r.lastLabel).toBe('5:40 PM EST');
    const noValues = buildReports([spc({ type: 'torn', hail: null }), spc({ type: 'torn', hail: null }), spc({ type: 'wind', hail: null, wind: null })])[0];
    expect(noValues.largestHailIn).toBeNull();
    expect(noValues.peakWindMph).toBeNull();
  });
  it('county labels: parish in Louisiana, names that already carry the word are kept', () => {
    expect(countyLabel('Cobb', 'GA')).toBe('Cobb County');
    expect(countyLabel('Orleans', 'LA')).toBe('Orleans Parish');
    expect(countyLabel('Richmond City', 'VA')).toBe('Richmond City');
  });
});

describe('local date grouping (the state main time zone, DST aware)', () => {
  it('splits a storm across local midnight, not UTC midnight', () => {
    const rows = [
      spc({ occurred_at: '2026-11-15T03:30:00.000Z' }), // 10:30 PM EST, Nov 14
      spc({ occurred_at: '2026-11-15T04:45:00.000Z' }), // 11:45 PM EST, Nov 14
      spc({ occurred_at: '2026-11-15T04:59:00.000Z' }), // 11:59 PM EST, Nov 14
      spc({ occurred_at: '2026-11-15T05:10:00.000Z' }), // 12:10 AM EST, Nov 15
    ];
    const reports = buildReports(rows);
    const byDate = Object.fromEntries(reports.map((r) => [r.date, r.spcTotal]));
    expect(byDate).toEqual({ '2026-11-14': 3, '2026-11-15': 1 });
    expect(reports.find((r) => r.date === '2026-11-14')!.qualifies).toBe(true);
    expect(reports.find((r) => r.date === '2026-11-15')!.qualifies).toBe(false);
  });
  it('uses the state zone: the same instant is a different date in GA and in TX', () => {
    expect(localDate('2026-11-15T05:30:00.000Z', 'America/New_York')).toBe('2026-11-15');
    expect(localDate('2026-11-15T05:30:00.000Z', 'America/Chicago')).toBe('2026-11-14');
    const tx = buildReports([0, 1, 2].map(() => spc({ state: 'TX', county: 'Harris', occurred_at: '2026-11-15T05:30:00.000Z' })));
    expect(tx[0].date).toBe('2026-11-14');
  });
  it('follows daylight saving time', () => {
    // 04:30 UTC is 11:30 PM CDT the night before in July (UTC-5) and 10:30 PM CST the night before in December (UTC-6).
    expect(localDate('2026-07-01T04:30:00.000Z', 'America/Chicago')).toBe('2026-06-30');
    expect(localDate('2026-07-01T05:30:00.000Z', 'America/Chicago')).toBe('2026-07-01');
    expect(localTime('2026-07-01T04:30:00.000Z', 'America/Chicago')).toBe('11:30 PM CDT');
    expect(localDate('2026-12-01T05:30:00.000Z', 'America/Chicago')).toBe('2026-11-30');
  });
  it('first and last times are shown in the local zone of the state', () => {
    const r = buildReports([0, 1, 2].map((i) => spc({ state: 'TX', county: 'Harris', occurred_at: `2026-11-14T2${i}:00:00.000Z` })))[0];
    expect(r.firstLabel).toBe('2:00 PM CST');
    expect(r.lastLabel).toBe('4:00 PM CST');
  });
});

describe('slugs', () => {
  it('builds county-date slugs and parses them back', () => {
    const r = buildReports(cobbDay())[0];
    expect(r.slug).toBe('cobb-county-2026-11-14');
    expect(parseSlug(r.slug)).toEqual({ base: 'cobb-county', date: '2026-11-14' });
    expect(buildSlug('Cobb County', '2026-11-14')).toBe(r.slug);
  });
  it('round-trips every report, including names with punctuation, accents and saints', () => {
    const rows = [
      ...['St. Landry', "Prince George's", 'Doña Ana', 'DeKalb'].flatMap((c) => [0, 1, 2].map(() => spc({ county: c }))),
      fema(),
    ];
    const reports = buildReports(rows);
    expect(reports).toHaveLength(5);
    for (const r of reports) {
      const p = parseSlug(r.slug)!;
      expect(p.date).toBe(r.date);
      expect(r.slug).toBe(buildSlug(p.base, p.date));
      expect(slugify(r.slug)).toBe(r.slug);
    }
    expect(new Set(reports.map((r) => r.slug)).size).toBe(5);
  });
  it('rejects slugs that are not name-date', () => {
    for (const bad of ['', 'cobb-county', '2026-11-14', 'cobb-county-2026-13-45', 'cobb-county-2026-02-30', 'Cobb-County-2026-11-14', 'cobb county-2026-11-14', '-2026-11-14', 'x'.repeat(200) + '-2026-11-14']) {
      expect(parseSlug(bad), bad).toBeNull();
    }
  });
});

describe('what reaches the output', () => {
  const REMARK = 'Reported by John Q Smith, call 404-555-0199, at 1234 Elm Street';
  const rows = cobbDay().map((r, i) => ({
    ...r,
    // Fields the real table has. The loader does not select them and the builder must not copy them.
    summary: REMARK,
    title: `Hail near 1234 Elm Street ${i}`,
    data: { comments: REMARK },
    comments: REMARK,
    lat: 33.9,
    lon: -84.5,
    id: 99 + i,
    zip: '30060',
  }));
  const reports = buildReports(rows);
  const text = JSON.stringify(reports);
  it('has no remark, address, coordinate or id field and none of their text', () => {
    expect(reports).toHaveLength(1);
    const keys = new Set<string>();
    const walk = (o: unknown) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
        keys.add(k);
        walk(v);
      }
    };
    walk(reports);
    for (const bad of ['summary', 'title', 'comments', 'remarks', 'data', 'lat', 'lon', 'id', 'zip', 'address', 'street', 'externalId']) {
      expect(keys.has(bad), bad).toBe(false);
    }
    for (const needle of ['John', 'Smith', '555', 'Elm', '1234', '30060', '33.9', '-84.5']) expect(text).not.toContain(needle);
  });
  it('shows a city only when it is a plain place name', () => {
    expect(cleanPlace('Marietta')).toBe('Marietta');
    expect(cleanPlace('Port St Lucie')).toBe('Port St Lucie');
    expect(cleanPlace("O'Fallon")).toBe("O'Fallon");
    expect(cleanPlace('MARIETTA')).toBe('Marietta');
    for (const bad of ['1234 Elm Street', 'I-85 MM 20', 'Hwy 20', 'Main Street', 'x'.repeat(41), '', null, 'Joe (555) 1234']) expect(cleanPlace(bad as string | null), String(bad)).toBeNull();
    const r = buildReports([0, 1, 2].map(() => spc({ city: '1234 Elm Street' })))[0];
    expect(r.records.every((x) => x.place === 'Cobb County')).toBe(true);
  });
  it('links are kept only for official hosts over https', () => {
    const r = buildReports([spc({ url: 'https://evil.example/x' }), spc({ url: 'http://www.spc.noaa.gov/x' }), spc()])[0];
    expect(r.records.filter((x) => x.url).length).toBe(1);
  });
});

describe('window and sort', () => {
  it('lists qualifying reports from the last 60 days, newest first', () => {
    const day = (d: string) => [0, 1, 2].map((i) => spc({ occurred_at: `${d}T2${i}:00:00.000Z` }));
    const rows = [...day('2026-09-01'), ...day('2026-10-01'), ...day('2026-11-10'), spc({ county: 'Fulton', occurred_at: '2026-11-17T20:00:00.000Z' })];
    const reports = buildReports(rows);
    const win = indexWindow(reports, Date.parse('2026-11-18T12:00:00Z'));
    expect(win.map((r) => r.date)).toEqual(['2026-11-10', '2026-10-01']);
  });
});

describe('FEMA fields are allowlisted (review P1-1)', () => {
  const hostile = fema({ incident: 'Severe Storm call Jane Doe 404-555-0100 jane@example.com', decl: 'Jane Doe 555', disaster: 4955 });
  const PII = /Jane|Doe|555|0100|@example/i;
  it('the review hostile row makes no report: the incident type is not an exact known value', () => {
    expect(buildReports([hostile])).toHaveLength(0);
  });
  it('a known incident with a hostile declaration type prints neither the type nor the number', () => {
    const r = buildReports([fema({ decl: 'Jane Doe 555', disaster: 4955 })]);
    expect(r).toHaveLength(1);
    const detail = r[0].records[0].detail ?? '';
    expect(detail).toBe('Disaster declaration, severe storm, 2 designated areas');
    expect(JSON.stringify(r)).not.toMatch(PII);
    expect(detail).not.toContain('4955');
  });
  it('DR and EM print as major disaster and emergency; the number only when it is a positive integer', () => {
    expect(buildReports([fema({ decl: 'DR' })])[0].records[0].detail).toBe('Major disaster declaration DR-4955, severe storm, 2 designated areas');
    expect(buildReports([fema({ decl: 'em', disaster: '3600' })])[0].records[0].detail).toBe('Emergency declaration EM-3600, severe storm, 2 designated areas');
    for (const bad of [-5, 0, 1.5, 'abc', 'Jane 555', 1e9, null]) {
      expect(buildReports([fema({ decl: 'DR', disaster: bad as never })])[0].records[0].detail, String(bad)).toBe('Major disaster declaration, severe storm, 2 designated areas');
    }
  });
  it('only exact known storm incident types are admitted and printed as the fixed label', () => {
    const ok = ['Severe Storm', 'Severe Storm(s)', 'Tornado', 'Hurricane', 'Flood', 'Snowstorm', 'Severe Ice Storm', 'Coastal Storm', 'Tropical Storm', 'Typhoon', 'Winter Storm', 'Straight-Line Winds', ' TORNADO '];
    for (const incident of ok) expect(buildReports([fema({ incident })]), incident).toHaveLength(1);
    for (const incident of ['Fire', 'Biological', 'Storm of Jane Doe', 'severe storm 404-555-0100', 'Flood, call me', '', null, 'storm']) {
      expect(buildReports([fema({ incident: incident as never })]), String(incident)).toHaveLength(0);
    }
    expect(buildReports([fema({ incident: ' TORNADO ' })])[0].records[0].detail).toContain(', tornado,');
  });
});

describe('SPC links and place strings (review P2)', () => {
  it('official links drop the query string and fragment', () => {
    expect(officialUrl('https://www.spc.noaa.gov/climo/reports/261114_rpts.html?name=Jane+Doe&phone=4045550100#x')).toBe('https://www.spc.noaa.gov/climo/reports/261114_rpts.html');
    expect(officialUrl('https://www.fema.gov/disaster/4955?x=1')).toBe('https://www.fema.gov/disaster/4955');
    const r = buildReports([spc({ url: 'https://www.spc.noaa.gov/x?name=Jane+Doe' }), spc(), spc()])[0];
    expect(JSON.stringify(r)).not.toMatch(/Jane|\?/);
  });
  it('"2 ESE Longview" prints only the city part', () => {
    expect(cleanPlace('2 ESE Longview')).toBe('Longview');
    expect(cleanPlace('10.5 NNW Port St Lucie')).toBe('Port St Lucie');
    expect(cleanPlace('3 N 1234 Elm Street')).toBeNull();
    const rows = [0, 1, 2].map((i) => spc({ county: null, city: '2 ESE Longview', state: 'TX', occurred_at: `2026-11-14T2${i}:00:00.000Z` }));
    const r = buildReports(rows)[0];
    expect(r.place).toBe('Longview, TX');
    expect(JSON.stringify(r)).not.toContain('ESE');
  });
  it('a county and a city with the same name get different slugs and both reports exist', () => {
    const rows = [
      ...[0, 1, 2].map((i) => spc({ county: 'Carson City', city: null, state: 'NV', occurred_at: `2026-11-14T2${i}:00:00.000Z` })),
      ...[0, 1, 2, 3].map((i) => spc({ county: null, city: 'Carson', state: 'NV', occurred_at: `2026-11-14T2${i}:00:00.000Z` })),
      ...[0, 1, 2].map((i) => spc({ county: null, city: 'Carson City', state: 'NV', occurred_at: `2026-11-14T1${i}:00:00.000Z` })),
    ];
    const reports = buildReports(rows);
    const slugs = reports.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain('carson-city-2026-11-14');
    expect(slugs).toContain('city-of-carson-2026-11-14');
    expect(slugs).toContain('city-of-carson-city-2026-11-14');
    for (const r of reports) expect(parseSlug(r.slug)).not.toBeNull();
  });
  it('city-kind pages say near, county pages say in', async () => {
    const { h1 } = await import('@/lib/storms/copy');
    const city = buildReports([0, 1, 2].map((i) => spc({ county: null, city: 'Longview', state: 'TX', occurred_at: `2026-11-14T2${i}:00:00.000Z` })))[0];
    expect(h1(city)).toBe('Storm reports near Longview, TX on November 14, 2026');
    expect(h1(buildReports(cobbDay())[0])).toBe('Storm reports in Cobb County, GA on November 14, 2026');
  });
});
