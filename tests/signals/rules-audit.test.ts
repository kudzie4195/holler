// Round 19 RULES: the audited rule list (review-ENGINE-compare.md section 5), one or more cases per line on REAL live rows, plus the
// pieces that are not a single label: the per-building heat count (line 3, owner call 1), repeated NWS alerts and undeliverable rows
// (criterion 4), code-violation visits, the fire-sprinkler mapping fix (line 64) and the statewide federal bid (UNIFY review, defect 2).
import { describe, expect, it, vi } from 'vitest';
import { CATEGORY_IDS, classifyText, type CategoryId } from '@/lib/signals/categories';
import { cannotBeDelivered, labelFor, labelForMember, RULES, ruleFor, SOURCE_DEFAULTS } from '@/lib/signals/lead-rules';
import { carriedTrades, expandCategoriesForRouting } from '@/lib/signals/permit-routing';
import { matchOne, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { WEATHER_EVENTS, nwsEventOf, weatherRowFor, violationTradeRoles } from '@/lib/signals/carry';
import {
  HEAT_MARK,
  buildingKeyOf,
  hasHeatMark,
  heatTriggers,
  isWholeBuildingHeat,
  markRepeats,
  nwsRepeatKeyOf,
  nwsRepeats,
  violationVisits,
  visitKeyOf,
  withAlsoCited,
  withHeatMark,
} from '@/lib/signals/repeat-marks';
import { NO_TRADE_WORK_TYPE_RE } from '@/lib/signals/mapping/permit';
import { remapRow } from '@/lib/signals/mapping/remap';
import { parseSam } from '@/lib/signals/adapters/sam';
import type { SignalRowInput } from '@/lib/signals/store';
import { AUDIT_CASES, LIVE_ROWS, inputOf, liveRow, type LiveRow } from './rules-audit-cases';

vi.mock('server-only', () => ({}));

const linesOf = (id: string | undefined) => {
  const r = RULES.find((x) => x.id === id);
  return r?.line === undefined ? [] : Array.isArray(r.line) ? (r.line as number[]) : [r.line as number];
};

describe('the audited list: every line on real rows', () => {
  it.each(AUDIT_CASES.map((c) => [`line ${c.line}: row ${c.row} ${c.trade} -> ${c.want}${c.note ? ` (${c.note})` : ''}`, c] as const))('%s', (_name, c) => {
    const r = liveRow(c.row);
    const sig = inputOf(r, { noLocation: c.noLocation });
    const carried = carriedTrades(sig, r.categories);
    if (c.want === 'none') {
      expect(carried).not.toContain(c.trade);
      return;
    }
    expect(carried, 'the trade sees the record').toContain(c.trade);
    expect(labelFor(sig, c.trade)).toBe(c.want);
  });

  it('each case is decided by a rule that names its audit line (or, for line 62 and 64 lawn care, by not being carried)', () => {
    const bad: string[] = [];
    for (const c of AUDIT_CASES) {
      if (c.want === 'none') continue;
      const r = liveRow(c.row);
      const rule = ruleFor(inputOf(r, { noLocation: c.noLocation }), c.trade);
      const lines = linesOf(rule?.id);
      // lines whose case keeps an outcome through a general rule (the open bid, private graffiti, act-no-heat, the routed heads-up)
      const general = ['act-open-bid', 'act-private-graffiti', 'act-no-heat', 'soon-permit-downstream', 'act-storm-report'];
      // line 10 is the 311 default itself: those cases are decided by SOURCE_DEFAULTS, which the test checks is context
      if (!rule && c.line === 10 && SOURCE_DEFAULTS[r.source] === 'context') continue;
      if (!lines.includes(c.line) && !general.includes(rule?.id ?? '')) bad.push(`line ${c.line} row ${c.row} ${c.trade}: ${rule?.id ?? 'default'}`);
    }
    expect(bad).toEqual([]);
  });

  it('every one of the 65 lines has at least one case', () => {
    const covered = new Set(AUDIT_CASES.map((c) => c.line));
    const missing = Array.from({ length: 65 }, (_, i) => i + 1).filter((n) => !covered.has(n));
    expect(missing).toEqual([]);
  });

  it('every rule that carries a line number decides at least one live case or a test below', () => {
    const used = new Set<string>();
    for (const c of AUDIT_CASES) {
      if (c.want === 'none') continue;
      const id = ruleFor(inputOf(liveRow(c.row), { noLocation: c.noLocation }), c.trade)?.id;
      if (id) used.add(id);
    }
    used.add('heat-per-building'); // marked rows: see the heat tests
    used.add('closed-case');
    const unused = RULES.filter((r) => r.line !== undefined && !used.has(r.id)).map((r) => r.id);
    expect(unused).toEqual([]);
  });
});

describe('line 2: plumbing is act now only when the complaint names hot water alone (no live row does)', () => {
  it('a fixture title in the same NYC shape', () => {
    const sig = { source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in New York City: HEAT/HOT WATER / NO HOT WATER', summary: 'HEAT/HOT WATER | NO HOT WATER | QUEENS' };
    expect(labelFor(sig, 'plumbing')).toBe('act_now');
    expect(labelFor(sig, 'hvac')).toBe('act_now'); // not a whole-building or apartment-only complaint: the general heat rule
  });
});

describe('line 3 and owner call 1: NYC whole-building heat, one urgent card per building', () => {
  const t = (r: LiveRow) => Date.parse(r.occurred_at);
  const timeline = (ids: number[]) => ids.map((id) => liveRow(id)).map((r) => ({ key: buildingKeyOf(r) as string, t: t(r), id: String(r.id), stored: false }));

  it('a building is its point to 4 decimals: the six live complaints at 40.8300,-73.9018 share one key', () => {
    const keys = new Set([1191, 22112, 21989, 21949, 54354, 128083].map((id) => buildingKeyOf(liveRow(id))));
    expect([...keys]).toEqual(['40.8300,-73.9018']);
    expect(isWholeBuildingHeat(liveRow(21989))).toBe(true);
    expect(isWholeBuildingHeat(liveRow(1175))).toBe(false); // apartment only
  });

  it('the third complaint within 48 hours makes the card; earlier ones and the later ones within 7 days do not', () => {
    // 1191 Nov 16 04:48, 22112 Nov 17 03:01, 21989 Nov 17 04:06 (the third inside 48 h), then 21949, 54354, 128083
    expect([...heatTriggers(timeline([1191, 22112, 21989, 21949, 54354, 128083]))]).toEqual(['21989']);
  });

  it('a building with two complaints never gets a card (87677, 128005)', () => {
    expect(heatTriggers(timeline([87677, 128005])).size).toBe(0);
  });

  it('a late-arriving older complaint cannot make a second card next to a stored one', () => {
    const rows = timeline([1191, 22112, 21989, 21949]).map((r) => (r.id === '21989' ? { ...r, stored: true, marked: true } : r.id === '21949' ? r : { ...r, stored: true }));
    expect(heatTriggers(rows).size).toBe(0);
  });

  it('the marked row is urgent for HVAC, the same row unmarked is nothing, plumbing stays feed only', () => {
    const r = liveRow(21989);
    const marked = inputOf(r, { summary: withHeatMark(r.summary) });
    expect(hasHeatMark(marked.summary)).toBe(true);
    expect(marked.summary).toBe(`HEAT/HOT WATER | ENTIRE BUILDING | BRONX | ${HEAT_MARK}`);
    expect(labelFor(marked, 'hvac')).toBe('act_now');
    expect(ruleFor(marked, 'hvac')?.id).toBe('heat-per-building');
    expect(labelFor(inputOf(r), 'hvac')).toBe('context');
    expect(labelFor(marked, 'plumbing')).toBe('market_insight');
  });

  it('I4 rewritten (was: every NYC heat row is urgent for HVAC): on the fixture rows, HVAC is urgent only on a marked whole-building row', () => {
    const heat = LIVE_ROWS.filter((r) => r.source === 'socrata-nyc-311' && /HEAT\/HOT WATER/.test(r.title));
    const hit = heatTriggers(heat.filter((r) => isWholeBuildingHeat(r)).map((r) => ({ key: buildingKeyOf(r) as string, t: t(r), id: String(r.id), stored: false })));
    const bad: string[] = [];
    for (const r of heat) {
      const sig = inputOf(r, { summary: hit.has(String(r.id)) ? withHeatMark(r.summary) : r.summary });
      const want = isWholeBuildingHeat(r) ? (hit.has(String(r.id)) ? 'act_now' : 'context') : 'market_insight';
      if (labelFor(sig, 'hvac') !== want) bad.push(`${r.id} ${labelFor(sig, 'hvac')} != ${want}`);
    }
    expect(heat.length).toBeGreaterThanOrEqual(10);
    expect(bad).toEqual([]);
  });

  it('works at scan time from the stored rows, and with no stored rows readable it marks nothing (no heat alerts rather than hundreds)', async () => {
    const rowsIn = [1191, 22112, 21989].map((id) => {
      const r = liveRow(id);
      return { source: r.source, externalId: `ext-${id}`, kind: 'civic', title: r.title, summary: r.summary, lat: r.lat, lon: r.lon, categories: r.categories, severity: 2, occurredAt: r.occurred_at, data: r.data ?? {}, placeSlug: null } as unknown as SignalRowInput;
    });
    const empty = { data: [], error: null };
    const okDb = fakeDb(() => empty);
    const ok = await markRepeats(okDb as never, rowsIn);
    expect(ok.heatMarked).toBe(1);
    expect(ok.rows.find((r) => r.externalId === 'ext-21989')?.summary).toContain(HEAT_MARK);
    expect(ok.logs).toEqual([]);
    for (const code of ['PGRST205', '42P01']) {
      const bad = await markRepeats(fakeDb(() => ({ data: null, error: { message: `relation does not exist (${code})`, code } })) as never, rowsIn);
      expect(bad.heatMarked).toBe(0);
      expect(bad.rows.every((r) => !hasHeatMark(r.summary))).toBe(true);
      expect(bad.logs.join(' ')).toMatch(/no heat row is marked/);
    }
  });
});

/** A read-only PostgREST stand-in: every chained filter returns itself; awaiting it gives `answer()`. */
function fakeDb(answer: () => { data: unknown[] | null; error: { message: string; code?: string } | null }) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'ilike', 'gte', 'lte', 'in', 'order', 'range']) q[m] = () => q;
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(answer()).then(res);
  return { from: () => q };
}

describe('criterion 4: weather rows without coordinates and repeated NWS alerts', () => {
  it('a row no member can receive is context when its location is given, and the matcher agrees', () => {
    const nwsZone = liveRow(8); // Winter Weather Advisory, no point
    const orlando = liveRow(76848); // Orlando permit, no point, severity 1
    for (const r of [nwsZone, orlando]) {
      expect(cannotBeDelivered(r)).toBe(true);
      for (const tr of carriedTrades(inputOf(r), r.categories)) expect(labelFor(inputOf(r), tr as CategoryId)).toBe('context');
      const member: MatchProfile = { user_id: 'u', categories: [...CATEGORY_IDS], lat: 40.7, lon: -111.5, state: r.state, radius_mi: 500, plan: 'pro', subscription_status: 'active' };
      expect(matchOne(r as unknown as MatchSignal, member, false, Date.parse('2026-11-22T00:00:00Z'))).toBeNull();
    }
    expect(cannotBeDelivered(liveRow(1))).toBe(false); // a Flood Advisory with a point is deliverable
  });

  it('the label rules alone (no location passed: a delivered match) are unchanged', () => {
    expect(labelFor(inputOf(liveRow(8), { noLocation: true }), 'snow-removal')).toBe('coming_soon');
  });

  it('the live rows carry no alert id; repeats are found by data.event, data.areaDesc and the place (review P1-B)', () => {
    for (const r of LIVE_ROWS.filter((x) => x.source === 'nws')) expect(r.data?.alertId).toBeUndefined();
    const [a, b, c] = [8834, 15702, 30155].map(liveRow); // three Flood Advisories for Miami-Dade, FL, three different polygons
    expect(nwsRepeatKeyOf(a)).toBe('flood advisory|miami-dade, fl|p:25.9,-80.3');
    const tl = [a, b, c].map((r) => ({ key: nwsRepeatKeyOf(r) as string, t: Date.parse(r.occurred_at), id: String(r.id), stored: false }));
    // 15702 sits 22 miles south of 8834: a different place, so its own card
    expect(nwsRepeats(tl).size).toBe(0);
  });

  it('a repeat is stored as a follower, and a follower makes no card for anyone', async () => {
    // 30155 (Nov 18 14:17) and 38810 (Nov 18 18:44): the same Miami-Dade advisory polygon issued again (same centre)
    const rowsIn = [30155, 38810].map((id) => {
      const r = liveRow(id);
      return { source: 'nws', externalId: `nws-${id}`, kind: 'alert', title: r.title, summary: r.summary, lat: r.lat, lon: r.lon, categories: r.categories, severity: 2, occurredAt: r.occurred_at, data: r.data ?? {}, placeSlug: null } as unknown as SignalRowInput;
    });
    const out = await markRepeats(fakeDb(() => ({ data: [], error: null })) as never, rowsIn);
    expect(out.nwsRepeats).toBe(1);
    const follower = out.rows.find((r) => r.externalId === 'nws-38810')!;
    expect(follower.data?.projectOf).toBe('nws:nws-30155');
    const member: MatchProfile = { user_id: 'u', categories: ['restoration'], lat: 25.76, lon: -80.19, state: 'FL', radius_mi: 50, plan: 'pro', subscription_status: 'active' };
    const sig = (r: SignalRowInput, id: number) => ({ id, categories: r.categories, lat: r.lat, lon: r.lon, state: 'FL', severity: 2, occurred_at: r.occurredAt, data: r.data, source: 'nws', kind: 'alert', title: r.title, summary: r.summary }) as unknown as MatchSignal;
    expect(matchOne(sig(out.rows[0], 1), member, false)).not.toBeNull();
    expect(matchOne(sig(follower, 2), member, false)).toBeNull();
  });

  it('a failed read leaves the NWS rows as they came', async () => {
    const r = liveRow(15702);
    const rowsIn = [{ source: 'nws', externalId: 'x', kind: 'alert', title: r.title, summary: r.summary, lat: r.lat, lon: r.lon, categories: r.categories, severity: 2, occurredAt: r.occurred_at, data: r.data ?? {}, placeSlug: null } as unknown as SignalRowInput];
    const out = await markRepeats(fakeDb(() => ({ data: null, error: { message: 'Could not find the table', code: 'PGRST205' } })) as never, rowsIn);
    expect(out.rows[0].data?.projectOf).toBeUndefined();
    expect(out.logs.join(' ')).toMatch(/nws repeats/);
  });

  it('every NWS event in the live rows has a row in the event table; nws defaults to context (line 29)', () => {
    expect(SOURCE_DEFAULTS.nws).toBe('context');
    for (const r of LIVE_ROWS.filter((x) => x.source === 'nws')) expect(weatherRowFor(r.title), r.title).not.toBeNull();
    expect(weatherRowFor('Volcano Warning: Somewhere')).toBeNull();
    expect(labelFor({ source: 'nws', kind: 'alert', title: 'Volcano Warning: Somewhere' }, 'restoration')).toBe('context');
    expect(WEATHER_EVENTS.length).toBeGreaterThan(5);
    expect(nwsEventOf('Flood Advisory: Coconino, AZ')).toBe('flood advisory');
  });
});

describe('code-violation visits: the orders of one inspection are one card, and no named trade is lost', () => {
  const visit = [4273, 4287, 4290, 4296].map(liveRow); // ROACHES, RAT PROOF OPENINGS, MICE/RODENTS, REPAIR INTERIOR STAIR SYSTEM
  it('the four live orders share one visit key; the three pest orders become one card, the stair order keeps its own (review P2-2)', () => {
    const keys = new Set(visit.map((r) => visitKeyOf({ ...r, occurredAt: r.occurred_at })));
    expect(keys.size).toBe(1);
    const plan = violationVisits(visit.map((r) => ({ key: visitKeyOf({ ...r, occurredAt: r.occurred_at }) as string, id: String(r.id), source: r.source, kind: r.kind, title: r.title, summary: r.summary, categories: r.categories, stored: false })));
    expect(plan.alsoCited.get('4273')).toEqual(['RAT PROOF OPENINGS', 'MICE/RODENTS']);
    expect([...plan.followerOf.keys()].sort()).toEqual(['4287', '4290']);
    const lead = inputOf(visit[0], { summary: withAlsoCited(visit[0].summary, plan.alsoCited.get('4273')!) });
    expect(lead.summary).toBe('ROACHES | OPEN | 4000 block of S ELLIS AVE | Also cited: RAT PROOF OPENINGS; MICE/RODENTS');
    expect(labelFor(lead, 'pest-control')).toBe('act_now');
    // a general contractor no longer gets a card titled "ROACHES": the stair order is its own card, titled with the stair
    expect(carriedTrades(lead, visit[0].categories)).not.toContain('general-contractor');
    const stair = inputOf(visit[3]);
    expect(labelFor(stair, 'general-contractor')).toBe('act_now');
    expect(labelFor(stair, 'handyman')).toBe('coming_soon');
  });

  it('the handyman is primary on an order no specialist shares (smoke detectors)', () => {
    expect(violationTradeRoles('Code violation in Chicago: INSTALL SMOKE DETECTORS').get('handyman')).toBe('primary');
    expect(violationTradeRoles('Code violation in Chicago: REPAIR PORCH SYSTEM').get('handyman')).toBe('secondary');
  });

  it('a new order joins a stored card only when the card already names its trades', () => {
    const key = 'k';
    const plan = violationVisits([
      { key, id: 'stored', title: 'Code violation in Chicago: ROACHES', summary: 'ROACHES | OPEN | x', stored: true },
      { key, id: 'mice', title: 'Code violation in Chicago: MICE/RODENTS', summary: 'MICE/RODENTS | OPEN | x', stored: false },
      { key, id: 'stair', title: 'Code violation in Chicago: REPAIR INTERIOR STAIR SYSTEM', summary: 'x', stored: false },
    ]);
    expect(plan.followerOf.get('mice')).toBe('stored');
    expect(plan.followerOf.has('stair')).toBe(false);
  });
});

describe('line 64: fire sprinkler and standpipe permits are not landscaping or lawn care', () => {
  it('the mapping treats the live fire-protection work types as no-trade work (fixed at the source, mapping/permit.ts)', () => {
    for (const v of ['Sprinklers', 'Sprinkler and Standpipe', 'Fire Sprinkler System', 'Standpipe']) expect(NO_TRADE_WORK_TYPE_RE.test(v), v).toBe(true);
    for (const v of ['sprinkler head', 'Lawn Sprinkler', 'Irrigation']) expect(NO_TRADE_WORK_TYPE_RE.test(v), v).toBe(false);
  });

  it('the stored rows 764, 817, 9559 and 3174 lose the landscaping tag on the re-map (they are version 2)', () => {
    for (const id of [764, 817, 9559, 3174]) {
      const r = liveRow(id);
      const out = remapRow({ id: r.id, source: r.source, title: r.title, summary: r.summary, city: r.city, categories: r.categories, data: r.data });
      expect(out?.categories, String(id)).toEqual([]);
      expect(out?.title, String(id)).toMatch(/^Permit in /);
    }
  });

  it('the keyword list only reads "lawn sprinkler": fire sprinkler text is not landscaping', () => {
    expect(classifyText('fire sprinkler system and standpipe')).not.toContain('landscaping');
    expect(classifyText('new lawn sprinkler heads')).toContain('landscaping');
  });

  it('until the re-map runs, the label keeps them out of landscaping and lawn care', () => {
    for (const id of [764, 817, 9559, 3174]) {
      const r = liveRow(id);
      expect(labelFor(inputOf(r), 'landscaping'), String(id)).toBe('context');
      expect(labelFor(inputOf(r), 'lawn-care'), String(id)).toBe('context');
    }
  });
});

describe('UNIFY review defect 2: a federal bid that names a state and no city is feed only', () => {
  const ga = parseSam({
    opportunitiesData: [
      {
        noticeId: 'n-ga-1', type: 'Solicitation', title: 'Grounds maintenance services', naicsCode: '561730', postedDate: '2026-11-22', responseDeadLine: '2026-12-10', fullParentPathName: 'DEFENSE.ARMY',
        officeAddress: { city: 'ATLANTA', state: 'GA', zipcode: '30303' },
        placeOfPerformance: { state: { code: 'GA' } },
      },
    ],
  })[0];

  it('the parsed notice is titled "Federal bid in GA: ..." and is market insight (no email, no push)', () => {
    expect(ga.title).toMatch(/^Federal bid in GA: /);
    const sig = { source: ga.source, kind: ga.kind, title: ga.title, summary: ga.summary };
    expect(labelFor(sig, 'landscaping')).toBe('market_insight');
    expect(ruleFor(sig, 'landscaping')?.id).toBe('mi-bid-statewide');
    expect(ruleFor(sig, 'landscaping')?.why).toBe('Out for bid, but the notice names a state and no city, so it cannot be placed near the member.');
    expect(labelForMember({ ...sig, categories: ga.categories }, ['landscaping'])).toBe('market_insight');
  });

  it('a bid that names a city and has a point is unchanged (act now); one without a point is feed only (review P3 item 18)', () => {
    const placed = liveRow(156081);
    expect(placed.title).toMatch(/^Federal bid in Temple, TX: /);
    expect(labelFor(inputOf(placed), 'general-contractor')).toBe('act_now');
    const r = liveRow(156051);
    expect(r.title).toMatch(/^Federal bid in Cave Junction, OR: /);
    expect(r.lat).toBeNull();
    expect(labelFor(inputOf(r), 'general-contractor')).toBe('market_insight');
    expect(ruleFor(inputOf(r), 'general-contractor')?.id).toBe('mi-bid-unplaced');
  });
});

describe('carried trades are also read from the database for those members (wider read only)', () => {
  it('a restoration member reads plumbing-tagged rows (sewage back-ups), a siding member roofing-tagged rows', () => {
    expect(expandCategoriesForRouting(['restoration'])).toContain('plumbing');
    expect(expandCategoriesForRouting(['siding-gutters'])).toContain('roofing');
    expect(expandCategoriesForRouting(['lawn-care'])).toContain('general-contractor');
  });

  it('every carried pair on the fixture rows has a tag that the member\'s read fetches', () => {
    const misses: string[] = [];
    for (const r of LIVE_ROWS) {
      const carried = carriedTrades(inputOf(r), r.categories);
      for (const t of carried) {
        if (r.categories.includes(t)) continue;
        const read = expandCategoriesForRouting([t]);
        if (!r.categories.some((c) => read.includes(c))) misses.push(`${r.id} ${t}`);
      }
    }
    expect(misses).toEqual([]);
  });
});

describe('criterion 6: stage updates reach the same trades as before', () => {
  it('the label code keeps its own copy of the finished stages and the stage trades, equal to lib/signals/stage.ts', async () => {
    const { FINISHED_STAGES, FINISHED_STAGE_TRADES } = await import('@/lib/signals/carry');
    const { STAGE_TRADES, TRIGGER_STAGES } = await import('@/lib/signals/stage');
    expect([...FINISHED_STAGES]).toEqual([...TRIGGER_STAGES]);
    expect([...FINISHED_STAGE_TRADES]).toEqual([...STAGE_TRADES]);
  });
  it('a finished new construction (row 61, no residential class) is a heads-up again for cleaning and security, never for fencing or windows', () => {
    const r = liveRow(61);
    const finished = { ...inputOf(r), permitStage: 'finaled' };
    expect(labelFor(inputOf(r), 'cleaning')).toBe('market_insight');
    expect(labelFor(finished, 'cleaning')).toBe('coming_soon');
    expect(labelFor(finished, 'security')).toBe('coming_soon');
    expect(labelFor(finished, 'fencing')).toBe('market_insight');
    expect(labelFor(finished, 'windows-doors')).toBe('context');
  });
});

describe('engine B is loaded by the replay script only', () => {
  it('no product file names reference/r10-engine; among scripts only scripts/rules-replay.ts does, at run time', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs)$/.test(n) ? [p] : [];
      });
    // code that could load it: an import, a require or a path built from 'r10-engine' (comments that cite the reference copy are fine)
    const loads = (f: string) => readFileSync(f, 'utf8').split('\n').some((l) => !/^\s*(?:\*|\/\/)/.test(l) && /r10-engine/.test(l));
    expect(['app', 'lib', 'components'].flatMap(files).filter(loads)).toEqual([]);
    expect(files('scripts').filter(loads)).toEqual(['scripts/rules-replay.ts']);
    expect(readFileSync('scripts/rules-replay.ts', 'utf8')).not.toMatch(/^import .*r10-engine/m);
  });
});

describe('criterion 5: card text in English and Spanish', () => {
  it('on every audit case the dictionary brief in English equals the English brief, and Spanish has every key', async () => {
    const { briefFor } = await import('@/lib/signals/brief');
    const { briefFromDict } = await import('@/lib/signals/brief-i18n');
    for (const c of AUDIT_CASES) {
      if (c.want === 'none' || c.want === 'context') continue;
      const r = liveRow(c.row);
      const input = { ...inputOf(r, { noLocation: true }), label: c.want, trade: c.trade };
      expect(briefFromDict(input, 'en'), `${c.row} ${c.trade}`).toEqual(briefFor(input));
      const es = briefFromDict(input, 'es');
      for (const part of [es.why, es.next, es.uncertain]) expect(part, `${c.row} ${c.trade}`).not.toMatch(/^brief\.|\{\w+\}/);
    }
  });

  it('the sentences the audit flagged are gone: no chosen vendor, no legal duty stated as fact, no guess about what failed', async () => {
    const { allBriefStrings } = await import('@/lib/signals/brief');
    const all = allBriefStrings().join('\n');
    expect(all).not.toMatch(/another company likely has this job|landlords must|must restore heat|failures often involve|will need to pass a follow-up|is in effect here|request for city work/i);
    const { en } = await import('@/lib/i18n/en');
    const { es } = await import('@/lib/i18n/es');
    expect(JSON.stringify(en)).not.toMatch(/failures often involve|landlords must/i);
    expect(JSON.stringify(es)).not.toMatch(/muchas veces hay problemas de plagas|muchas veces hay fallas de limpieza/i);
  });

  it('a paperwork-only order is not quoted as a repair (row 4313 "OR LICENSED CONTRACTOR")', async () => {
    const { briefFor, violationOrderOf } = await import('@/lib/signals/brief');
    const r = liveRow(4313);
    expect(violationOrderOf(r.title)).toBeNull();
    const b = briefFor({ ...inputOf(r, { noLocation: true }), label: 'coming_soon', trade: 'general-contractor' });
    expect(b.why).toBe('A code violation here is about a permit or a license, not a named repair.');
    expect(b.why).not.toMatch(/or licensed contractor/i);
  });

  it('the heat card states the count, not a duty; the weather heads-up never presumes damage reports', async () => {
    const { briefFor } = await import('@/lib/signals/brief');
    const r = liveRow(21989);
    const heat = briefFor({ ...inputOf(r, { summary: withHeatMark(r.summary), noLocation: true }), label: 'act_now', trade: 'hvac' });
    expect(heat.why).toBe('Three or more heat complaints were filed at this building in 48 hours.');
    expect(heat.next).toBe("Contact the building's owner or managing agent.");
    const warn = briefFor({ ...inputOf(liveRow(14), { noLocation: true }), label: 'coming_soon', trade: 'roofing' });
    expect(warn.next).toBe('Be ready in case calls come once it passes.');
    expect(warn.uncertain).toMatch(/damage is not confirmed/);
  });

  it('the two new summary parts read in Spanish; the orders themselves stay as the city wrote them', async () => {
    const { localizeSummary } = await import('@/lib/signals/summary-i18n');
    expect(localizeSummary(`HEAT/HOT WATER | ENTIRE BUILDING | BRONX | ${HEAT_MARK}`, 'es', 'socrata-nyc-311')).toBe('HEAT/HOT WATER | ENTIRE BUILDING | BRONX | 3 o más quejas por calefacción en este edificio en 48 horas');
    expect(localizeSummary('ROACHES | OPEN | 4000 block of S ELLIS AVE | Also cited: MICE/RODENTS; RAT PROOF OPENINGS', 'es', 'socrata-chicago-violations')).toBe('ROACHES | OPEN | 4000 block of S ELLIS AVE | También se citó: MICE/RODENTS; RAT PROOF OPENINGS');
    expect(localizeSummary(`X | ${HEAT_MARK}`, 'en', 'socrata-nyc-311')).toBe(`X | ${HEAT_MARK}`);
  });
});
