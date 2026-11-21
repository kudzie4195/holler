/**
 * Flag and matching for city bids. Fixtures: the live Los Angeles RAMP row for the cooling tower bid (tests/signals/adapters/fixtures/
 * bids-la-live-2026-11-21.json). Rows marked SYNTHETIC change the title of that real row so it names roofing, a trade no live LA row
 * named that day. Test clock 2026-11-21T22:00:00Z.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BID_DATASETS, buildBidAdapter, parseBids } from '@/lib/signals/adapters/city-bids';
import { BIDS_FLAG, BID_SOURCE_IDS, bidsEnabled, isBidSignal } from '@/lib/signals/bid-sources';
import { matchOne, matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { runScan } from '@/lib/signals/run';
import { APPROX_LOCATION_SOURCES, approxLocationNote, hasApproxLocation } from '@/lib/signals/approx-location';
import type { SignalInput } from '@/lib/signals/types';

const NOW = new Date('2026-11-21T22:00:00Z');
const LA = BID_DATASETS.find((d) => d.id === 'bids-la')!;
const laRows = JSON.parse(readFileSync(join(__dirname, 'adapters', 'fixtures', 'bids-la-live-2026-11-21.json'), 'utf8')) as Record<string, unknown>[];
const coolingTower = laRows.find((r) => r.rampid === '233195')!;

function asMatchSignal(s: SignalInput, id: number): MatchSignal {
  return {
    id,
    categories: s.categories,
    lat: s.lat ?? null,
    lon: s.lon ?? null,
    state: s.state ?? null,
    severity: s.severity,
    occurred_at: s.occurredAt,
    source: s.source,
    title: s.title,
    summary: s.summary ?? null,
    data: s.data as MatchSignal['data'],
  };
}

const hvacBid = asMatchSignal(parseBids([coolingTower], LA, NOW).items[0], 1);
// SYNTHETIC: the same real row with a roofing title.
const roofBid = asMatchSignal(parseBids([{ ...coolingTower, rampid: '999001', title: 'REPLACE ROOFS AT TWO FIRE STATIONS' }], LA, NOW).items[0], 2);

// Los Angeles City Hall area, 10 mile radius.
const profile = (categories: string[], over: Partial<MatchProfile> = {}): MatchProfile => ({
  user_id: 'u-la',
  categories,
  lat: 34.0537,
  lon: -118.2428,
  state: 'CA',
  radius_mi: 10,
  ...over,
});

afterEach(() => vi.unstubAllEnvs());

describe('the flag', () => {
  it('is off unless it is 1, true, on or yes', () => {
    expect(BIDS_FLAG).toBe('HOLLER_BIDS_ENABLED');
    for (const v of [undefined, '', '0', 'false', 'off', 'no', 'maybe', '2']) expect(bidsEnabled(v), String(v)).toBe(false);
    for (const v of ['1', 'true', 'TRUE', 'on', 'Yes', ' 1 ']) expect(bidsEnabled(v), v).toBe(true);
  });

  it('reads process.env at call time and is off by default', () => {
    vi.stubEnv(BIDS_FLAG, '');
    expect(bidsEnabled()).toBe(false);
    vi.stubEnv(BIDS_FLAG, '1');
    expect(bidsEnabled()).toBe(true);
  });

  it('isBidSignal sees the subtype, the data subtype and the source', () => {
    expect(isBidSignal({ subtype: 'bid' })).toBe(true);
    expect(isBidSignal({ data: { subtype: 'bid' } })).toBe(true);
    for (const id of BID_SOURCE_IDS) expect(isBidSignal({ source: id })).toBe(true);
    expect(isBidSignal({ source: 'sam-gov', data: { subtype: 'permit' } })).toBe(false);
    expect(isBidSignal({ source: 'usaspending' })).toBe(false);
    expect(isBidSignal(null)).toBe(false);
  });
});

describe('flag OFF: zero bid rows reach matching', () => {
  it('matchSignals returns nothing for a bid that would match a nearby roofer, by default (env empty)', () => {
    vi.stubEnv(BIDS_FLAG, '');
    expect(matchSignals([roofBid, hvacBid], [profile(['roofing', 'hvac'])], undefined, NOW)).toEqual([]);
  });

  it('matchSignals with the flag passed as false returns nothing; with true the same input matches', () => {
    expect(matchSignals([roofBid], [profile(['roofing'])], undefined, NOW, false)).toEqual([]);
    expect(matchSignals([roofBid], [profile(['roofing'])], undefined, NOW, true)).toHaveLength(1);
  });

  it('matchOne (backfill, rematch, previews) is gated too, and so are keyword watches on a bid', () => {
    vi.stubEnv(BIDS_FLAG, '0');
    expect(matchOne(roofBid, profile(['roofing']))).toBeNull();
    expect(matchOne(roofBid, profile([], { plan: 'pro', subscription_status: 'active', keywords: ['fire stations'] }))).toBeNull();
  });

  it('a stored bid row (only source and subtype known, as the rematch and backfill reads give it) is also never matched', () => {
    const stored: MatchSignal = { id: 3, categories: ['roofing'], lat: 34.0522, lon: -118.2437, state: 'CA', severity: 2, occurred_at: '2026-11-20T00:00:00Z', subtype: 'bid', source: 'bids-la' };
    expect(matchSignals([stored], [profile(['roofing'])], undefined, NOW, false)).toEqual([]);
    const sourceOnly: MatchSignal = { ...stored, subtype: null };
    expect(matchSignals([sourceOnly], [profile(['roofing'])], undefined, NOW, false)).toEqual([]);
  });

  it('other signals are not affected by the flag', () => {
    const permit: MatchSignal = { id: 4, categories: ['roofing'], lat: 34.05, lon: -118.24, state: 'CA', severity: 1, occurred_at: '2026-11-20T00:00:00Z', subtype: 'permit', source: 'socrata-la-permits' };
    expect(matchSignals([permit], [profile(['roofing'])], undefined, NOW, false)).toHaveLength(1);
    const fed: MatchSignal = { ...permit, id: 5, subtype: null, source: 'sam-gov' };
    expect(matchSignals([fed], [profile(['roofing'])], undefined, NOW, false)).toHaveLength(1);
  });

  it('the scan does not run the bid adapters: skipped(env) naming the flag, and no request is made', async () => {
    vi.stubEnv(BIDS_FLAG, '');
    const f = vi.fn(async () => new Response('[]', { status: 200 })) as unknown as typeof fetch;
    const report = await runScan({ dry: true, now: NOW, adapters: [buildBidAdapter(LA)], fetchImpl: f });
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]).toMatchObject({ id: 'bids-la', status: 'skipped(env)', missingEnv: ['HOLLER_BIDS_ENABLED'], fetched: 0 });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('flag ON: bids match by distance and trade', () => {
  it('a bid in Los Angeles matches an LA roofing profile inside its radius, with no distance (the position is the city centre)', () => {
    const rows = matchSignals([roofBid], [profile(['roofing'])], undefined, NOW, true);
    expect(rows).toEqual([{ user_id: 'u-la', signal_id: 2, distance_mi: null }]);
    vi.stubEnv(BIDS_FLAG, '1');
    // The label is act_now (every open city bid is, lead-rules SOURCE_DEFAULTS) and the deadline is the bid's due day (data.dueDate).
    expect(matchOne(roofBid, profile(['roofing']))).toEqual({ distance_mi: null, label: 'act_now', deadline: '2027-01-08T12:00:00.000Z' });
  });

  it('the real cooling tower bid matches an LA HVAC profile and not a roofing one', () => {
    expect(matchSignals([hvacBid], [profile(['hvac'])], undefined, NOW, true)).toHaveLength(1);
    expect(matchSignals([hvacBid], [profile(['roofing'])], undefined, NOW, true)).toEqual([]);
  });

  it('a profile far away does not match (San Diego, 120 mi), a profile about 20 miles out does (radius 10 + 15 stand-in slack)', () => {
    const sanDiego = profile(['roofing'], { user_id: 'u-sd', lat: 32.7157, lon: -117.1611 });
    expect(matchSignals([roofBid], [sanDiego], undefined, NOW, true)).toEqual([]);
    // Irvine, about 35 miles from the LA centre, is past 25
    const irvine = profile(['roofing'], { user_id: 'u-irv', lat: 33.6846, lon: -117.8265 });
    expect(matchSignals([roofBid], [irvine], undefined, NOW, true)).toEqual([]);
    // Pasadena, about 10 miles
    const pasadena = profile(['roofing'], { user_id: 'u-pas', lat: 34.1478, lon: -118.1445, radius_mi: 5 });
    expect(matchSignals([roofBid], [pasadena], undefined, NOW, true)).toHaveLength(1);
  });

  it('the scan runs the adapter and returns its bids', async () => {
    vi.stubEnv(BIDS_FLAG, '1');
    const f = vi.fn(async () => new Response(JSON.stringify([coolingTower]), { status: 200 })) as unknown as typeof fetch;
    const report = await runScan({ dry: true, now: NOW, adapters: [buildBidAdapter(LA)], fetchImpl: f });
    expect(report.sources[0]).toMatchObject({ id: 'bids-la', status: 'ok', fetched: 1, parsed: 1 });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('bid rows are approximate-location rows', () => {
  it('every bid source reads as approximate by its source id alone, so no screen prints a distance; the Cobb list is unchanged', () => {
    for (const id of BID_SOURCE_IDS) {
      expect(hasApproxLocation({ source: id })).toBe(true);
      expect(APPROX_LOCATION_SOURCES.has(id)).toBe(false);
    }
    expect([...APPROX_LOCATION_SOURCES]).toEqual(['arcgis-cobb-residential-permits', 'arcgis-cobb-commercial-permits', 'arcgis-cobb-multiunit-permits']);
    expect(hasApproxLocation({ source: 'bids-la', data: { loc: 'approx' } })).toBe(true);
  });

  it('the note names the buyer and the missing job site, never a county', () => {
    const note = approxLocationNote({ city: 'Los Angeles', source: 'bids-la' });
    expect(note).toBe('Buyer in Los Angeles. A bid names the buyer, not a job site, so no distance is shown.');
    expect(approxLocationNote({ city: 'Baton Rouge', subtype: 'bid' })).toMatch(/^Buyer in Baton Rouge\./);
    // Cobb wording is unchanged
    expect(approxLocationNote({ city: 'Cobb County' })).toMatch(/^In Cobb County\. /);
  });
});
