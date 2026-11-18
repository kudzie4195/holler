import type { StormRow } from '@/lib/storms/report';

export function spc(over: Partial<StormRow> & Record<string, unknown> = {}): StormRow {
  return {
    source: 'spc',
    state: 'GA',
    county: 'Cobb',
    city: 'Marietta',
    url: 'https://www.spc.noaa.gov/climo/reports/261114_rpts.html',
    occurred_at: '2026-11-14T20:00:00.000Z',
    created_at: '2026-11-14T21:00:00.000Z',
    type: 'hail',
    hail: '1.75',
    wind: null,
    ...over,
  };
}

export function fema(over: Partial<StormRow> & Record<string, unknown> = {}): StormRow {
  return {
    source: 'fema',
    state: 'GA',
    county: null,
    city: null,
    url: 'https://www.fema.gov/disaster/4955',
    occurred_at: '2026-10-27T00:00:00.000Z',
    created_at: '2026-10-28T10:00:00.000Z',
    incident: 'Severe Storm(s)',
    decl: 'DR',
    disaster: 4955,
    counties: ['Cobb', 'Fulton'],
    ...over,
  };
}

/** Three hail/wind/tornado rows in Cobb County on Nov 14, 2026 (afternoon EST). */
export function cobbDay(): StormRow[] {
  return [
    spc({ occurred_at: '2026-11-14T20:10:00.000Z', type: 'hail', hail: '1.75' }),
    spc({ occurred_at: '2026-11-14T21:30:00.000Z', type: 'wind', hail: null, wind: '62' }),
    spc({ occurred_at: '2026-11-14T22:40:00.000Z', type: 'torn', hail: null }),
  ];
}
