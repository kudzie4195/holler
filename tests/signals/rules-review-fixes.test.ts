// Round 19 RULES, review fixes (review-RULES.md). One block per defect, on real rows from the live export where one exists
// (tests/signals/__data__/rules-audit-rows.json, copied unchanged; public records).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { ItemRow } from '@/app/local/_components/records';
import { buildAlerts } from '@/lib/mobile/feed';
import { parseNws } from '@/lib/signals/adapters/nws';
import { briefFor } from '@/lib/signals/brief';
import { briefForLang } from '@/lib/signals/brief-i18n';
import { stripNotes, titleBodyOf, violationOrders, violationTrades, withHeatMark } from '@/lib/signals/carry';
import { classifyText, type CategoryId } from '@/lib/signals/categories';
import { computeStatus } from '@/lib/signals/health';
import { FIRE_PROTECTION_PART_RE, keptMatchLabel, labelFor, labelForMember, recordLabelInput, ruleFor } from '@/lib/signals/lead-rules';
import { NO_TRADE_WORK_TYPE_RE } from '@/lib/signals/mapping/permit';
import { matchOne, matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { carriedTrades } from '@/lib/signals/permit-routing';
import {
  buildingKeyOf,
  HEAT_CHECK_SOURCE,
  heatTriggers,
  markRepeats,
  nwsRepeatKeyOf,
  nwsRepeats,
  spcReportKeyOf,
  violationVisits,
  visitKeyOf,
  withAlsoCited,
  type TimelineRow,
} from '@/lib/signals/repeat-marks';
import { withRuleChoices } from '@/lib/signals/rule-choices';
import type { SignalRowInput } from '@/lib/signals/store';
import { formatNotes } from '@/lib/signals/summary-i18n';
import { LIVE_ROWS, liveRow, type LiveRow } from './rules-audit-cases';

type Answer = { data: unknown[] | null; error: { message: string; code?: string } | null };

/** A fake Supabase client: every query answers `answer(callIndex, calls)`, and the chain calls are recorded. */
function recordingDb(answer: (n: number, calls: unknown[][]) => Answer) {
  const calls: unknown[][] = [];
  let n = 0;
  const db = {
    calls,
    from: (table: string) => {
      const mine: unknown[] = [['from', table]];
      calls.push(mine);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'ilike', 'gte', 'lte', 'in', 'order', 'range']) q[m] = (...a: unknown[]) => (mine.push([m, ...a]), q);
      q.then = (res: (v: unknown) => unknown) => Promise.resolve(answer(n++, calls)).then(res);
      return q;
    },
  };
  return db;
}

const miles = (a: { lat: number | null; lon: number | null }, b: { lat: number | null; lon: number | null }) => {
  const r = Math.PI / 180;
  const [p1, p2] = [a.lat! * r, b.lat! * r];
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((b.lon! - a.lon!) * r) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
};

describe('P1-A and P1-B: an NWS repeat is the same event for the same place', () => {
  // The reviewer's reproduction (REV-RULES-scripts/county2.ts): one High Wind Warning without a polygon for five Georgia counties.
  const feature = (id: string, sent: string) => ({
    id: `https://api.weather.gov/alerts/${id}`,
    geometry: null,
    properties: {
      '@id': `https://api.weather.gov/alerts/${id}`, id, event: 'High Wind Warning', status: 'Actual', messageType: 'Alert', severity: 'Severe', urgency: 'Expected', certainty: 'Likely',
      areaDesc: 'Fulton; Chatham; Lowndes; Richmond; Muscogee', geocode: { SAME: ['013121', '013051', '013185', '013245', '013215'], UGC: ['GAZ033', 'GAZ034', 'GAZ032'] },
      sent, effective: sent, onset: sent, expires: '2026-12-02T12:00:00-05:00', ends: '2026-12-02T12:00:00-05:00', senderName: 'NWS Peachtree City GA',
      headline: 'High Wind Warning issued', description: 'Northwest winds 30 to 40 mph with gusts up to 60 mph expected.',
    },
  });
  const empty = () => recordingDb(() => ({ data: [], error: null }));
  const stored = (rows: SignalRowInput[]) =>
    rows.map((r, i) => ({ id: i + 1, categories: r.categories, lat: r.lat, lon: r.lon, state: r.state, severity: r.severity, occurred_at: r.occurredAt, subtype: null, data: r.data, source: r.source, title: r.title, summary: r.summary, kind: r.kind })) as unknown as MatchSignal[];

  it('one warning for five counties: every county keeps its card', async () => {
    const sigs = parseNws({ features: [feature('urn:oid:2.49.0.1.840.0.aaa.001.1', '2026-12-01T10:00:00-05:00')] });
    expect(sigs).toHaveLength(5);
    const marked = await markRepeats(empty() as never, sigs.map((s) => ({ ...s, placeSlug: null })) as SignalRowInput[]);
    expect(marked.nwsRepeats).toBe(0);
    for (const r of marked.rows) {
      expect(r.data?.projectOf).toBeUndefined();
      const roofer = { user_id: `near-${r.data?.countyFips}`, categories: ['roofing'], lat: r.lat, lon: r.lon, state: r.state, radius_mi: 25, plan: 'starter' } as unknown as MatchProfile;
      expect(matchSignals(stored(marked.rows), [roofer], 25, new Date('2026-12-01T16:00:00Z'), false)).toHaveLength(1);
    }
  });

  it('the same warning issued again for the same counties within 24 hours is a repeat, county by county', async () => {
    const first = parseNws({ features: [feature('urn:oid:2.49.0.1.840.0.aaa.001.1', '2026-12-01T10:00:00-05:00')] });
    const again = parseNws({ features: [feature('urn:oid:2.49.0.1.840.0.aaa.002.1', '2026-12-01T16:00:00-05:00')] });
    const db = recordingDb(() => ({
      data: first.map((r) => ({ external_id: r.externalId, occurred_at: r.occurredAt, title: r.title, lat: r.lat, lon: r.lon, state: r.state, event: r.data?.event, areaDesc: r.data?.areaDesc, countyFips: r.data?.countyFips, projectOf: null })),
      error: null,
    }));
    const marked = await markRepeats(db as never, again.map((s) => ({ ...s, placeSlug: null })) as SignalRowInput[]);
    expect(marked.nwsRepeats).toBe(5);
    for (const r of marked.rows) {
      const root = first.find((f) => f.data?.countyFips === r.data?.countyFips)!;
      expect(r.data?.projectOf).toBe(`nws:${root.externalId}`);
    }
  });

  it('the key carries the county, else the point to 0.1 degree, else the state', () => {
    const base = { source: 'nws', title: 'High Wind Warning: Fulton', data: { event: 'High Wind Warning', areaDesc: 'Fulton' } };
    expect(nwsRepeatKeyOf({ ...base, lat: 33.79, lon: -84.47, data: { ...base.data, countyFips: '13121' } })).toBe('high wind warning|fulton|c:13121');
    expect(nwsRepeatKeyOf({ ...base, lat: 33.79, lon: -84.47 })).toBe('high wind warning|fulton|p:33.8,-84.5');
    expect(nwsRepeatKeyOf({ ...base, state: 'GA' })).toBe('high wind warning|fulton|s:ga');
    expect(nwsRepeatKeyOf({ ...base })).toBeNull();
  });

  it('live rows: the reviewer\'s far pairs are no longer merged, a true repeat still is, and no merged pair is more than 10 miles apart', () => {
    const nws = LIVE_ROWS.filter((r) => r.source === 'nws');
    const tl: TimelineRow[] = nws.flatMap((r) => {
      const key = nwsRepeatKeyOf(r);
      return key ? [{ key, t: Date.parse(r.occurred_at), id: String(r.id), stored: false }] : [];
    });
    const rep = nwsRepeats(tl);
    expect(rep.get('40567')).not.toBe('29857'); // Flood Warning Monroe FL, 91 miles apart
    expect(rep.get('56638')).not.toBe('55273'); // Flash Flood Warning Santa Barbara CA, 32 miles apart
    expect(rep.get('38810')).toBe('30155'); // Flood Advisory Miami-Dade FL, the same polygon 4.5 hours later
    expect(rep.get('40567')).toBe('38770'); // Flood Warning Monroe FL, the same polygon 3.5 hours later
    const byId = new Map<string, LiveRow>(nws.map((r) => [String(r.id), r]));
    for (const [a, b] of rep) {
      const [ra, rb] = [byId.get(a)!, byId.get(b)!];
      expect(Math.abs(Date.parse(ra.occurred_at) - Date.parse(rb.occurred_at))).toBeLessThan(24 * 3_600_000);
      if (ra.lat != null && rb.lat != null) expect(miles(ra, rb)).toBeLessThanOrEqual(10);
    }
    expect(liveRow(38810).data?.event).toBe('Flood Advisory');
  });
});

// ---- P2-1 ------------------------------------------------------------------------------------------------------------------------------

const NYC = { lat: 40.7128, lon: -74.006, state: 'NY' };
const asSignal = (r: LiveRow, summary = r.summary): MatchSignal =>
  ({ id: r.id, categories: r.categories, lat: r.lat, lon: r.lon, state: r.state, severity: r.severity, occurred_at: r.occurred_at, subtype: (r.data?.subtype as string) ?? null, data: r.data, source: r.source, title: r.title, summary, kind: r.kind }) as MatchSignal;

describe('P2-1: a keyword watch gets the per-building heat rule', () => {
  const watcher = { user_id: 'kw', categories: ['roofing'], ...NYC, radius_mi: 25, plan: 'pro', subscription_status: 'active', keywords: ['heat'] } as unknown as MatchProfile;
  const NOW = Date.parse('2026-11-22T00:00:00Z');
  it('an unmarked whole-building complaint (row 1176) is no card; the marked one is urgent; an apartment complaint (row 1175) is feed only', () => {
    expect(matchOne(asSignal(liveRow(1176)), watcher, false, NOW)).toBeNull();
    expect(matchOne(asSignal(liveRow(1176), withHeatMark(liveRow(1176).summary)), watcher, false, NOW)?.label).toBe('act_now');
    expect(matchOne(asSignal(liveRow(1175)), watcher, false, NOW)?.label).toBe('market_insight');
  });
});

// ---- P2-2 and P3 item 4 ----------------------------------------------------------------------------------------------------------------

const visitInput = (ids: number[]) =>
  ids.map(liveRow).map((r) => ({ key: visitKeyOf({ ...r, occurredAt: r.occurred_at }) as string, id: String(r.id), source: r.source, kind: r.kind, title: r.title, summary: r.summary, categories: r.categories, stored: false }));
const VISIT_4270 = [4270, 4315, 4319, 4320, 4322, 4328, 4329, 60131, 60153, 60154, 60155, 60156, 60157, 60158, 60159];

describe('P2-2: a grouped violation card shows each member the order that names their trade', () => {
  it('on the reviewer\'s 15-order visit (row 4270), every card a trade is urgent on is titled with an order naming that trade', () => {
    const plan = violationVisits(visitInput(VISIT_4270));
    const cards = VISIT_4270.filter((id) => !plan.followerOf.has(String(id)));
    for (const id of cards) {
      const r = liveRow(id);
      const input = { source: r.source, kind: r.kind, subtype: 'violation', title: r.title, summary: plan.alsoCited.has(String(id)) ? withAlsoCited(r.summary, plan.alsoCited.get(String(id))!) : r.summary };
      for (const tr of carriedTrades(input, plan.categories.get(String(id)) ?? r.categories)) {
        if (ruleFor(input, tr as CategoryId)?.id !== 'act-violation-named') continue;
        // the title's own order names the trade, so the title line, the sentence, the email and the push (all built from the title) quote it
        expect(violationTrades(r.title), `${id} ${tr}`).toContain(tr);
        const label = labelFor(input, tr as CategoryId);
        // an urgent card's sentence quotes the title's order
        if (label === 'act_now') expect(briefFor({ ...input, label, trade: tr }).why, `${id} ${tr}`).toContain(titleBodyOf(r.title).toLowerCase().slice(0, 20));
      }
    }
    // the plumber's card is the plumbing order, not "PROVIDE SIDEWALK SHED F/PROTCT"
    const plumbingCards = cards.filter((id) => labelFor({ source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: liveRow(id).title, summary: liveRow(id).summary }, 'plumbing') === 'act_now');
    expect(plumbingCards).not.toContain(4270);
    for (const id of plumbingCards) expect(violationTrades(liveRow(id).title)).toContain('plumbing');
  });

  it('row 4273 "ROACHES" no longer reaches a general contractor; the stair order is the contractor\'s own card', async () => {
    const rowsIn = [4273, 4287, 4290, 4296].map((id) => {
      const r = liveRow(id);
      return { source: r.source, externalId: String(id), kind: r.kind, title: r.title, summary: r.summary, lat: r.lat, lon: r.lon, state: r.state, categories: r.categories, severity: r.severity, occurredAt: r.occurred_at, data: r.data ?? {}, placeSlug: null } as unknown as SignalRowInput;
    });
    const out = await markRepeats(recordingDb(() => ({ data: [], error: null })) as never, rowsIn);
    const gc = { user_id: 'gc', categories: ['general-contractor'], lat: liveRow(4273).lat, lon: liveRow(4273).lon, state: 'IL', radius_mi: 5, plan: 'starter' } as unknown as MatchProfile;
    const stored = out.rows.map((r, i) => ({ id: i + 1, categories: r.categories, lat: r.lat, lon: r.lon, state: r.state, severity: r.severity, occurred_at: r.occurredAt, subtype: 'violation', data: r.data, source: r.source, title: r.title, summary: r.summary, kind: r.kind })) as unknown as MatchSignal[];
    const got = matchSignals(stored, [gc], 5, new Date('2026-11-22T00:00:00Z'), false);
    expect(got.map((m) => stored.find((s) => s.id === m.signal_id)?.title)).toEqual(['Code violation in Chicago: REPAIR INTERIOR STAIR SYSTEM']);
  });
});

describe('P3 item 4: grouping loses no trade', () => {
  it('the four "OR LICENSED CONTRACTOR" orders (93415, 93414, 93417, 126181) keep the general contractor heads-up; DeKalb 55573 keeps junk removal', () => {
    for (const [visit, id] of [[[93411, 93413, 93415], 93415], [[93412, 93414, 93417], 93414], [[93412, 93414, 93417], 93417], [[126174, 126176, 126181], 126181]] as const) {
      const plan = violationVisits(visitInput([...visit]));
      const card = plan.followerOf.get(String(id)) ?? String(id);
      const r = liveRow(Number(card));
      const input = { source: r.source, kind: r.kind, subtype: 'violation', title: r.title, summary: plan.alsoCited.has(card) ? withAlsoCited(r.summary, plan.alsoCited.get(card)!) : r.summary };
      expect(carriedTrades(input, plan.categories.get(card) ?? r.categories), String(id)).toContain('general-contractor');
      expect(labelFor(input, 'general-contractor'), String(id)).toBe('coming_soon');
    }
    const plan = violationVisits(visitInput([55572, 55573]));
    const card = plan.followerOf.get('55573') ?? '55573';
    const r = liveRow(Number(card));
    expect(carriedTrades({ source: r.source, kind: r.kind, subtype: 'violation', title: r.title, summary: r.summary }, plan.categories.get(card) ?? r.categories)).toContain('junk-removal');
  });

  it('an order naming no trade never joins a stored card, and a follower\'s tags join the new card', () => {
    const key = 'k';
    const plan = violationVisits([
      { key, id: 'stored', source: 'socrata-chicago-violations', title: 'Code violation in Chicago: ADJUST BOILER BURNER', summary: 'x', categories: ['hvac'], stored: true },
      { key, id: 'paper', source: 'socrata-chicago-violations', title: 'Code violation in Chicago: OR LICENSED CONTRACTOR', summary: 'x', categories: ['general-contractor'], stored: false },
    ]);
    expect(plan.followerOf.has('paper')).toBe(false);
    const p2 = violationVisits([
      { key, id: 'a', source: 'arcgis-dekalb-violations', title: 'Code violation in DeKalb County: property violation', summary: 'x', categories: ['fencing'], stored: false },
      { key, id: 'b', source: 'arcgis-dekalb-violations', title: 'Code violation in DeKalb County: property violation', summary: 'x', categories: ['fencing'], stored: false },
    ]);
    expect(p2.followerOf.get('b')).toBe('a');
  });
});

// ---- P2-3 ------------------------------------------------------------------------------------------------------------------------------

describe('P2-3: "a gust was reported" only on gust rows', () => {
  it('wind damage rows 145646 and 40650 say a storm report was filed and keep "damage not confirmed", in English and Spanish', () => {
    for (const id of [145646, 40650]) {
      const r = liveRow(id);
      for (const trade of ['roofing', 'restoration', 'tree-service']) {
        const input = { source: r.source, kind: r.kind, title: r.title, summary: r.summary, label: 'coming_soon' as const, trade };
        const en = briefFor(input);
        expect(en.why + en.uncertain, `${id} ${trade}`).not.toMatch(/gust/i);
        expect(en.uncertain).toMatch(/not confirmed/);
        const es = briefForLang(input, 'es');
        expect(es.why + es.uncertain, `${id} ${trade}`).not.toMatch(/ráfaga/i);
        expect(es.uncertain).toMatch(/no confirmad/);
      }
    }
    const gust = { source: 'spc', kind: 'report', title: '60 mph wind gust reported near 1 S Allison, NM', label: 'coming_soon' as const, trade: 'roofing' };
    expect(briefFor(gust).uncertain).toMatch(/a gust was reported/);
    expect(briefForLang(gust, 'es').uncertain).toMatch(/ráfaga/);
  });
});

// ---- P2-5 ------------------------------------------------------------------------------------------------------------------------------

const HEAT: { rows: Array<[number, string, number, number]> } = JSON.parse(readFileSync(join(__dirname, '__data__', 'nyc-whole-building-heat.json'), 'utf8'));

describe('P2-5: the heat card does not depend on arrival order, reads newest first and shows failures in source health', () => {
  type H = (typeof HEAT.rows)[number];
  const tl = (r: H, stored: boolean, marked?: boolean): TimelineRow => ({ key: buildingKeyOf({ lat: r[2], lon: r[3] }) as string, t: Date.parse(r[1]), id: String(r[0]), stored, marked });
  const scan = (batches: H[][]) => {
    const stored: TimelineRow[] = [];
    const cards = new Map<string, number>();
    for (const b of batches) {
      const arriving = b.map((r) => tl(r, false));
      const hit = heatTriggers([...stored, ...arriving]);
      for (const a of arriving) {
        stored.push({ ...a, stored: true, marked: hit.has(a.id) });
        if (hit.has(a.id)) cards.set(a.key, (cards.get(a.key) ?? 0) + 1);
      }
    }
    return cards;
  };
  const shuffle = (xs: H[], seed: number) => {
    const a = [...xs];
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648;
      const j = Math.floor((s / 2147483648) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  it('the 1,063 live whole-building complaints give the same 38 buildings in time order, newest first, id order and random order, never two cards for one', () => {
    expect(HEAT.rows).toHaveLength(1063);
    const days = [...new Set(HEAT.rows.map((r) => r[1].slice(0, 10)))].sort();
    const byDay = (d: string) => HEAT.rows.filter((r) => r[1].startsWith(d));
    const orders: Array<[string, H[][]]> = [
      ['time order, a day per scan', days.map(byDay)],
      ['newest day first', [...days].reverse().map(byDay)],
      ['id order, a row per scan', [...HEAT.rows].sort((a, b) => a[0] - b[0]).map((r) => [r])],
      ['newest first, a row per scan', [...HEAT.rows].sort((a, b) => b[1].localeCompare(a[1]) || b[0] - a[0]).map((r) => [r])],
      ['random 1', shuffle(HEAT.rows, 1).map((r) => [r])],
      ['random 2', shuffle(HEAT.rows, 2).map((r) => [r])],
    ];
    const ref = scan([HEAT.rows]);
    expect(ref.size).toBe(38);
    for (const [name, batches] of orders) {
      const got = scan(batches);
      expect([...got.keys()].sort(), name).toEqual([...ref.keys()].sort());
      expect(Math.max(...got.values()), name).toBe(1);
    }
  });

  it('the third complaint stored before the first two arrive still makes the card, on the newest arriving row', () => {
    const T0 = Date.parse('2026-11-16T00:00:00Z');
    const r = (id: string, h: number, stored = false, marked = false): TimelineRow => ({ key: 'b', t: T0 + h * 3_600_000, id, stored, marked });
    expect([...heatTriggers([r('C', 2, true), r('A', 0), r('B', 1)])]).toEqual(['B']);
    expect([...heatTriggers([r('A', 0), r('B', 1), r('C', 2)])]).toEqual(['C']);
    expect([...heatTriggers([r('A', 0, true), r('C', 2, true), r('B', 1)])]).toEqual(['B']);
    expect([...heatTriggers([r('K', 50, true, true), r('X', 0), r('Y', 1), r('Z', 2)])]).toEqual([]);
  });

  const nycRow = (id: number) => {
    const r = liveRow(id);
    return { source: r.source, externalId: String(id), kind: r.kind, title: r.title, summary: r.summary, lat: r.lat, lon: r.lon, state: r.state, categories: r.categories, severity: r.severity, occurredAt: r.occurred_at, data: r.data ?? {}, placeSlug: null } as unknown as SignalRowInput;
  };

  it('reads newest first, says when the read cap is reached, and reports the check to source health', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ external_id: `old-${i}`, lat: 40.6, lon: -73.9, occurred_at: '2026-11-15T00:00:00Z', summary: null }));
    const db = recordingDb(() => ({ data: page, error: null }));
    const out = await markRepeats(db as never, [nycRow(1176)]);
    const heatCall = db.calls.find((c) => c.some((x) => Array.isArray(x) && x[0] === 'ilike'))!;
    expect(heatCall.filter((x) => Array.isArray(x) && x[0] === 'order')).toEqual([['order', 'occurred_at', { ascending: false }], ['order', 'id', { ascending: false }]]);
    expect(out.logs.join(' ')).toMatch(/heat per building: read cap reached \(10000 stored complaints\)/);
    expect(out.checks).toEqual([expect.objectContaining({ source: HEAT_CHECK_SOURCE, ok: true, error: 'read cap reached', rowsSeen: 10000 })]);
  });

  it('a failed read marks nothing and is a failed run of the heat check; three in a row make it unavailable in source health', async () => {
    const out = await markRepeats(recordingDb(() => ({ data: null, error: { message: 'relation does not exist', code: '42P01' } })) as never, [nycRow(1176)]);
    expect(out.heatMarked).toBe(0);
    expect(out.checks).toEqual([expect.objectContaining({ source: HEAT_CHECK_SOURCE, ok: false })]);
    expect(out.checks[0].error).toMatch(/relation does not exist/);
    // the scan passes the check to source health with the adapters' own outcomes (lib/signals/run.ts)
    const run = readFileSync(join(__dirname, '..', '..', 'lib', 'signals', 'run.ts'), 'utf8');
    expect(run).toMatch(/markChecks\.push\(\.\.\.marks\.checks\)/);
    expect(run).toMatch(/outcomes\.push\(\.\.\.markChecks\)/);
    expect(computeStatus({ source: HEAT_CHECK_SOURCE, now: new Date(), lastSuccessAt: new Date().toISOString(), lastRecordAt: new Date().toISOString(), consecutiveFailures: 3 })).toBe('unavailable');
  });

  it('owner call 1 "no": no heat note is written (review P3 item 17)', async () => {
    const stored = [1, 2].map((i) => ({ external_id: `s${i}`, lat: liveRow(1176).lat, lon: liveRow(1176).lon, occurred_at: liveRow(1176).occurred_at, summary: null }));
    const yes = await markRepeats(recordingDb(() => ({ data: stored, error: null })) as never, [nycRow(1176)]);
    expect(yes.rows[0].summary).toMatch(/3\+ heat complaints/);
    const no = await withRuleChoices({ heatPerBuilding: false }, () => markRepeats(recordingDb(() => ({ data: stored, error: null })) as never, [nycRow(1176)]));
    expect(no.rows[0].summary).toBe(liveRow(1176).summary);
    expect(no.checks).toEqual([]);
  });
});

// ---- P2-6 ------------------------------------------------------------------------------------------------------------------------------

describe('P2-6: a saved or done match stays visible to its member, without an alert chip it no longer earns', () => {
  it('keptMatchLabel: context becomes a feed item for saved and done, nothing else changes', () => {
    expect(keptMatchLabel('context', 'saved')).toBe('market_insight');
    expect(keptMatchLabel('context', 'done')).toBe('market_insight');
    expect(keptMatchLabel('context', 'new')).toBe('context');
    expect(keptMatchLabel('context', 'dismissed')).toBe('context');
    expect(keptMatchLabel('act_now', 'saved')).toBe('act_now');
    expect(keptMatchLabel('coming_soon', 'done')).toBe('coming_soon');
  });

  it('the mobile feed keeps an unmarked whole-building heat card (row 1176) the member saved, as a feed item; a new one is hidden', async () => {
    const r = liveRow(1176);
    const signal = { id: r.id, source: r.source, kind: r.kind, title: r.title, summary: r.summary, url: null, city: 'New York City', state: 'NY', county: null, zip: null, lat: r.lat, lon: r.lon, severity: r.severity, categories: r.categories, occurred_at: r.occurred_at, expires_at: null, subtype: '311' };
    const rows = (['saved', 'done', 'new'] as const).map((status, i) => ({ id: i + 1, status, distance_mi: 1, draft: null, created_at: r.occurred_at, signal }));
    const out = await buildAlerts(rows as never, { userId: 'u', locked: true, db: recordingDb(() => ({ data: [], error: null })) as never, admin: null, siteUrl: 'https://example.com', now: Date.parse('2026-11-22T00:00:00Z'), trades: ['hvac'] });
    expect(out.map((a) => [a.status, a.label])).toEqual([
      ['saved', 'market_insight'],
      ['done', 'market_insight'],
    ]);
  });

  it('the web feed page uses the same rule on every label it shows; the digest and the push read new matches only', () => {
    const page = readFileSync(join(__dirname, '..', '..', 'app', 'app', 'page.tsx'), 'utf8');
    expect(page).toMatch(/keptMatchLabel\(demoteExpired\(labelForMember\(/);
    expect(page.match(/labelOf\(s\)/g)).toBeNull();
    expect((page.match(/labelOf\(.*, m\.status\)/g) ?? []).length).toBe(3);
    const mobile = readFileSync(join(__dirname, '..', '..', 'lib', 'mobile', 'feed.ts'), 'utf8');
    expect(mobile.match(/labelOf\(s\)/g)).toBeNull();
    // a saved or done match is never mailed or pushed again: both read status 'new' only, so the rule has nothing to keep there
    const digest = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'cron', 'notify', 'route.ts'), 'utf8');
    expect(digest).toMatch(/\.eq\('status', 'new'\)/);
    const push = readFileSync(join(__dirname, '..', '..', 'lib', 'push', 'notify.ts'), 'utf8');
    expect(push).toMatch(/\.eq\('status', 'new'\)/);
  });
});

// ---- P3 items ----------------------------------------------------------------------------------------------------------------------

describe('P3 item 6: "tarp" alone is not roof work', () => {
  it('rows 81317 and 90466 (a tarp blown off the ground) are a heads-up for roofers, not urgent', () => {
    for (const id of [81317, 90466]) {
      const r = liveRow(id);
      expect(r.summary).toMatch(/tarp/i);
      expect(labelFor({ source: r.source, kind: r.kind, title: r.title, summary: r.summary }, 'roofing'), String(id)).toBe('coming_soon');
    }
  });
});

describe('P3 item 8: a feed-only hail card has no inspection step', () => {
  it('1.00 inch hail (row 15854) for auto glass is feed only, with the family step; siding keeps the inspection step', () => {
    const r = liveRow(15854);
    const input = { source: r.source, kind: r.kind, title: r.title, summary: r.summary };
    expect(labelFor(input, 'auto-glass')).toBe('market_insight');
    expect(briefFor({ ...input, label: 'market_insight', trade: 'auto-glass' }).next).not.toMatch(/offer inspections/);
    expect(briefForLang({ ...input, label: 'market_insight', trade: 'auto-glass' }, 'es').next).not.toMatch(/inspecciones/);
    expect(labelFor(input, 'siding-gutters')).toBe('act_now');
    // INT2 copy round: the hail reason's step no longer offers inspections to every trade; siding still gets the reason's own step.
    expect(briefFor({ ...input, label: 'act_now', trade: 'siding-gutters' }).next).toBe('Check the area on a map before you offer anyone a visit.');
    expect(briefFor({ ...input, label: 'market_insight', trade: 'auto-glass' }).next).not.toBe('Check the area on a map before you offer anyone a visit.');
  });
});

describe('P3 item 9: the graffiti sentence states only the record', () => {
  it('no general claim about what owners are told', () => {
    for (const lang of ['en', 'es'] as const) {
      const b = briefForLang({ source: 'socrata-chicago-311', subtype: '311', kind: 'civic', title: '311 request in Chicago: Graffiti on private property', label: 'act_now', trade: 'painting' }, lang);
      expect(b.why).not.toMatch(/usually|suele/);
    }
  });
});

describe('P3 item 10: the notes cannot be forged', () => {
  it('an incoming summary carrying the heat note loses it at ingest, so the row is not urgent', async () => {
    const r = liveRow(1176);
    const forged = { ...{ source: r.source, externalId: 'f', kind: r.kind, title: r.title, lat: r.lat, lon: r.lon, state: r.state, categories: r.categories, severity: r.severity, occurredAt: r.occurred_at, data: r.data ?? {}, placeSlug: null }, summary: `${r.summary} | 3+ heat complaints at this building in 48 hours` } as unknown as SignalRowInput;
    const out = await markRepeats(recordingDb(() => ({ data: [], error: null })) as never, [forged]);
    expect(out.rows[0].summary).toBe(r.summary);
    expect(labelFor({ source: r.source, kind: r.kind, subtype: '311', title: r.title, summary: out.rows[0].summary }, 'hvac')).toBe('context');
  });

  it('an order text with the note separators is listed as ONE order, and an incoming "Also cited" part is removed', async () => {
    expect(withAlsoCited('FIX A | OPEN', ['FIX A; B | Also cited: REPAIR PLUMBING'])).toBe('FIX A | OPEN | Also cited: FIX A, B / Also cited: REPAIR PLUMBING');
    expect(violationOrders('Code violation in Chicago: FIX A', withAlsoCited('FIX A | OPEN', ['FIX A; B | Also cited: REPAIR PLUMBING']))).toHaveLength(2);
    expect(stripNotes('ROACHES | OPEN | Also cited: REPAIR PLUMBING')).toBe('ROACHES | OPEN');
    const r = liveRow(4273);
    const forged = { source: r.source, externalId: 'g', kind: r.kind, title: r.title, lat: r.lat, lon: r.lon, state: r.state, categories: r.categories, severity: r.severity, occurredAt: r.occurred_at, data: r.data ?? {}, placeSlug: null, summary: `${r.summary} | Also cited: REPAIR PLUMBING` } as unknown as SignalRowInput;
    const out = await markRepeats(recordingDb(() => ({ data: [], error: null })) as never, [forged]);
    expect(out.rows[0].summary).toBe(r.summary);
  });
});

describe('P3 item 11: no surface prints a note as stored', () => {
  it('the public record row prints the summary without the notes; the mobile API prints them in the dictionary form', () => {
    const html = renderToStaticMarkup(
      createElement(ItemRow, { item: { id: 1, source: 'socrata-nyc-311', kind: 'civic', title: 'T', summary: 'HEAT/HOT WATER | ENTIRE BUILDING | BROOKLYN | 3+ heat complaints at this building in 48 hours', url: null, severity: 1, occurredAt: '2026-11-20T00:00:00Z', expiresAt: null } as never, ask: false, asOf: '2026-11-21T00:00:00Z' }),
    );
    expect(html).toContain('HEAT/HOT WATER | ENTIRE BUILDING | BROOKLYN');
    expect(html).not.toContain('heat complaints at this building');
    const mobile = readFileSync(join(__dirname, '..', '..', 'lib', 'mobile', 'feed.ts'), 'utf8');
    expect(mobile).toMatch(/formatNotes\(summaryForCard\(/);
    expect(formatNotes('ROACHES | OPEN | Also cited: MICE/RODENTS', 'es')).toBe('ROACHES | OPEN | También se citó: MICE/RODENTS');
    expect(formatNotes('A | 3+ heat complaints at this building in 48 hours', 'es')).toBe('A | 3 o más quejas por calefacción en este edificio en 48 horas');
  });
});

describe('P3 item 12: the Kansas City subtype list is for Kansas City only', () => {
  it('a "Property violations" 311 title from another city is not judged by KC subtypes', () => {
    const t = '311 request in Somewhere: Property Violations - Weeds';
    expect(labelFor({ source: 'socrata-kansascity-311', subtype: '311', title: t }, 'lawn-care')).toBe('coming_soon');
    expect(ruleFor({ source: 'socrata-cincinnati-311', subtype: '311', title: t }, 'lawn-care')?.id).not.toBe('property-violation-311');
  });
});

describe('P3 item 13: no inspection, licence or event pair is decided by the bare source default', () => {
  it('every fixture row of those sources, for every carried trade, is decided by a named rule', () => {
    const misses: string[] = [];
    for (const r of LIVE_ROWS.filter((x) => ['inspection', 'business', 'event-permit'].includes(String(x.data?.subtype)))) {
      const input = { source: r.source, kind: r.kind, subtype: String(r.data?.subtype), title: r.title, summary: r.summary };
      for (const t of carriedTrades(input, r.categories)) if (!ruleFor(input, t as CategoryId)) misses.push(`${r.id} ${t}`);
    }
    expect(misses).toEqual([]);
    // the replay checks all 1,523 live rows of those sources (scripts/rules-replay.ts, invariant I6)
    expect(readFileSync(join(__dirname, '..', '..', 'scripts', 'rules-replay.ts'), 'utf8')).toMatch(/inv\('I6 \(review P3 item 13\)'/);
  });
});

describe('P3 items 14 and 15: every surface passes the summary and the stage', () => {
  it('admin metros, metros-load, quality, missed and the preview read and pass them', () => {
    const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
    for (const p of ['lib/admin/metros.ts', 'lib/admin/metros-load.ts', 'lib/admin/quality.ts']) expect(src(p), p).toMatch(/labelFor\(\s*(?:s \? )?recordLabelInput\(s\)/);
    expect(src('lib/admin/metros-load.ts')).toMatch(/permitStage:data->>permitStage/);
    expect(src('lib/admin/quality-load.ts')).toMatch(/permitStage:data->>permitStage/);
    for (const p of ['lib/lifecycle/missed.ts', 'lib/preview/recent.ts']) {
      expect(src(p), p).toMatch(/summary: r\.summary \?\? null,\s+data: \{ permitStage: r\.permitStage \?\? null \}/);
      expect(src(p), p).toMatch(/title,summary,.*permitStage:data->>permitStage/);
    }
    expect(recordLabelInput({ source: 's', title: 't', summary: 'x', permitStage: 'final_inspection' })).toEqual({ source: 's', kind: null, subtype: null, title: 't', summary: 'x', permitStage: 'final_inspection' });
  });
});

describe('P3 item 16: a bare "Sprinkler System" is not assumed to be fire protection or irrigation', () => {
  it('mapping and label agree', () => {
    expect(NO_TRADE_WORK_TYPE_RE.test('Sprinkler System')).toBe(false);
    expect(FIRE_PROTECTION_PART_RE.test('Sprinkler System')).toBe(false);
    for (const v of ['Fire Sprinkler Systems', 'Fire Sprinkler System', 'Sprinkler and Standpipe', 'Sprinklers', 'Standpipe']) {
      expect(NO_TRADE_WORK_TYPE_RE.test(v), v).toBe(true);
      expect(FIRE_PROTECTION_PART_RE.test(v), v).toBe(true);
    }
    expect(classifyText('Sprinkler System')).not.toContain('landscaping');
  });
});

describe('P3 item 18: storm reports stored twice make one card; a federal bid with no point is feed only', () => {
  it('rows 15854 and 24614 (the same 1.00 inch hail report in two day files) are one card', async () => {
    const rowsIn = [15854, 24614].map((id) => {
      const r = liveRow(id);
      return { source: 'spc', externalId: `spc-${id}`, kind: r.kind, title: r.title, summary: r.summary, lat: r.lat, lon: r.lon, state: r.state, categories: r.categories, severity: r.severity, occurredAt: r.occurred_at, data: r.data ?? {}, placeSlug: null } as unknown as SignalRowInput;
    });
    expect(spcReportKeyOf(rowsIn[0])).toBe(spcReportKeyOf(rowsIn[1]));
    const out = await markRepeats(recordingDb(() => ({ data: [], error: null })) as never, rowsIn);
    expect(out.spcRepeats).toBe(1);
    expect(out.rows[1].data?.projectOf).toBe('spc:spc-15854');
    // the same report a day earlier in its own file is found when the first listing is already stored
    const db = recordingDb(() => ({ data: [{ external_id: 'spc-15854', occurred_at: liveRow(15854).occurred_at, lat: liveRow(15854).lat, lon: liveRow(15854).lon, type: 'hail', value: '100', comments: liveRow(15854).data?.comments, projectOf: null }], error: null }));
    const later = await markRepeats(db as never, [rowsIn[1]]);
    expect(later.rows[0].data?.projectOf).toBe('spc:spc-15854');
  });

  it('a federal bid whose city has no point (row 156051) is feed only on every surface; one with a point (156081) stays act now', () => {
    const r = liveRow(156051);
    const asStored = { source: r.source, kind: r.kind, title: r.title, summary: r.summary, lat: r.lat, lon: r.lon, state: r.state, severity: r.severity, categories: r.categories };
    expect(labelForMember({ ...recordLabelInput(asStored), categories: r.categories }, ['general-contractor'])).toBe('market_insight');
    const member = { user_id: 'gc', categories: ['general-contractor'], lat: 42.2, lon: -123.6, state: 'OR', radius_mi: 25, plan: 'starter' } as unknown as MatchProfile;
    expect(matchOne(asSignal(r), member, false, Date.parse('2026-11-22T00:00:00Z'))?.label).toBe('market_insight');
    const p = liveRow(156081);
    expect(labelForMember({ ...recordLabelInput({ ...p, kind: p.kind }), categories: p.categories }, ['general-contractor'])).toBe('act_now');
  });
});

describe('P3 item 2: the choices table says what the code does', () => {
  it('choice 3 says HVAC is not carried on an addition; choice 7 makes no claim about stage updates', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'lib', 'signals', 'rule-choices.ts'), 'utf8');
    expect(src).toMatch(/HVAC is not carried on an\s+\* addition at all/);
    expect(src).not.toMatch(/final-inspection stage update covers the timing/);
  });
});
