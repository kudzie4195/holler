import { describe, expect, it, vi } from 'vitest';
import { BATCH_SIZE, CALL_SPACING_MS, buildKeywordPlan, expectedVolumeCostUsd, normalizeKeyword, planBatches, refreshVolumes } from '../../lib/dataforseo/volume';
import { CITIES } from '../../lib/geo';
import { CATEGORIES } from '../../lib/signals/categories';
import { MONTH, deps, jsonRes, okBody } from './helpers';

const city = (slug: string, name: string, state: string, population: number) => ({ slug, name, state, stateName: state, lat: 0, lon: 0, population });
const SMALL = [city('big-ga', 'Bigtown', 'GA', 900), city('mid-ga', 'Midtown', 'GA', 500), city('springfield-il', 'Springfield', 'IL', 300), city('springfield-mo', 'Springfield', 'MO', 300), city('st-louis-mo', "St. Louis", 'MO', 100)];
const TRADES = ['roofing', 'plumbing'];

function echo(volumeFor: (k: string) => number | null = () => 10, cost = 0.075) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const kws: string[] = JSON.parse(String(init.body))[0].keywords;
    return jsonRes(okBody(kws.map((keyword) => ({ keyword, search_volume: volumeFor(keyword) })), cost));
  });
}
const sentBatches = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body))[0].keywords as string[]);

describe('keyword plan', () => {
  it('builds "<trade> <city>" in a stable order: population desc, trades in list order, slug breaks ties', () => {
    const plan = buildKeywordPlan(SMALL, TRADES);
    expect(plan.map((c) => c.slug)).toEqual(['big-ga', 'mid-ga', 'springfield-il', 'springfield-mo', 'st-louis-mo']);
    expect(plan[0].keywords.map((k) => k.keyword)).toEqual(['roofing bigtown', 'plumber bigtown']);
    expect(buildKeywordPlan([...SMALL].reverse(), TRADES)).toEqual(plan);
  });

  it('shared city names get the state code, so no two places share a keyword', () => {
    const all = buildKeywordPlan(SMALL, TRADES).flatMap((c) => c.keywords.map((k) => k.keyword));
    expect(all).toContain('roofing springfield il');
    expect(all).toContain('roofing springfield mo');
    expect(all).not.toContain('roofing springfield');
    expect(new Set(all).size).toBe(all.length);
  });

  it('normalizes punctuation and accents', () => {
    expect(normalizeKeyword("St. Louis")).toBe('st louis');
    expect(normalizeKeyword("O'Fallon")).toBe('ofallon');
    expect(normalizeKeyword('San José')).toBe('san jose');
  });

  it('the real plan: every keyword is within the API limits and unique', () => {
    const plan = buildKeywordPlan();
    const all = plan.flatMap((c) => c.keywords.map((k) => k.keyword));
    expect(plan.length).toBe(CITIES.length);
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((k) => k.length <= 80 && k.split(' ').length <= 10 && /^[a-z0-9 ]+$/.test(k))).toBe(true);
    expect(plan[0].keywords).toHaveLength(CATEGORIES.length);
  });

  it('batches hold whole cities, at most 1000 keywords, and skip what is done', () => {
    const plan = buildKeywordPlan();
    const batches = planBatches(plan, new Set());
    expect(batches.every((b) => b.length <= BATCH_SIZE)).toBe(true);
    expect(batches.flat().length).toBe(plan.reduce((n, c) => n + c.keywords.length, 0));
    const done = new Set(plan[0].keywords.map((k) => k.keyword));
    expect(planBatches(plan, done).flat()).not.toContain(plan[0].keywords[0].keyword);
    expect(planBatches(plan, done)[0][0]).toBe(plan[1].keywords[0].keyword);
    expect(expectedVolumeCostUsd(plan).usd).toBeCloseTo(expectedVolumeCostUsd(plan).tasks * 0.075, 3);
  });
});

describe('refreshVolumes', () => {
  it('not_configured: no database access, no fetch', async () => {
    const { d, db, fetch } = deps({ env: {} });
    const r = await refreshVolumes({ deps: d, plan: buildKeywordPlan(SMALL, TRADES) });
    expect(r.status).toBe('not_configured');
    expect(fetch).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  it('stores every keyword with its volume, null where Google returned none, and records the cost', async () => {
    const f = echo((k) => (k === 'plumber midtown' ? null : 40));
    const { d, db } = deps({ fetch: f });
    const r = await refreshVolumes({ deps: d, plan: buildKeywordPlan(SMALL, TRADES) });
    expect(r).toMatchObject({ status: 'complete', batchesRun: 1, keywordsDone: 10, keywordsRemaining: 0, spentUsd: 0.075 });
    const rows = db.tables.holler_keyword_volume;
    expect(rows).toHaveLength(10);
    expect(rows.find((x) => x.keyword === 'plumber midtown')).toMatchObject({ volume: null, month: MONTH, location_code: 2840 });
    expect(rows.find((x) => x.keyword === 'roofing bigtown')).toMatchObject({ volume: 40 });
    expect(db.tables.holler_dataforseo_spend[0]).toMatchObject({ cost_usd: 0.075, units: 10 });
  });

  it('resume order: skips keywords stored this month and continues with the next city in plan order', async () => {
    const plan = buildKeywordPlan(SMALL, TRADES);
    const f = echo();
    const { d, db } = deps({ fetch: f });
    for (const k of [...plan[0].keywords, ...plan[1].keywords]) db.tables.holler_keyword_volume.push({ keyword: k.keyword, location_code: 2840, month: MONTH, volume: 1 });
    // a row from LAST month must not count as done
    db.tables.holler_keyword_volume.push({ keyword: 'roofing springfield il', location_code: 2840, month: '2026-10-01', volume: 1 });
    const r = await refreshVolumes({ deps: d, plan });
    const sent = sentBatches(f);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(plan.slice(2).flatMap((c) => c.keywords.map((k) => k.keyword)));
    expect(sent[0][0]).toBe('roofing springfield il');
    expect(r).toMatchObject({ status: 'complete', keywordsDone: 10, keywordsRemaining: 0 });
  });

  it('a finished month makes no call', async () => {
    const plan = buildKeywordPlan(SMALL, TRADES);
    const f = echo();
    const { d, db } = deps({ fetch: f });
    for (const c of plan) for (const k of c.keywords) db.tables.holler_keyword_volume.push({ keyword: k.keyword, location_code: 2840, month: MONTH, volume: 0 });
    const r = await refreshVolumes({ deps: d, plan });
    expect(r).toMatchObject({ status: 'complete', batchesRun: 0, keywordsRemaining: 0 });
    expect(f).not.toHaveBeenCalled();
  });

  it('spaces calls 5.1 s apart (12 a minute) and stops on the time budget, resuming later', async () => {
    const plan = buildKeywordPlan(CITIES.slice(0, 60), CATEGORIES.map((c) => c.id)); // 60 x 41 = 2460 keywords = 3 batches
    const f = echo();
    const sleeps: number[] = [];
    let t = 0;
    const { d, db } = deps({ fetch: f, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
    // each call takes 1 s of the clock; a 16 s budget allows two calls
    const clock = () => t;
    const f2 = vi.fn(async (u: string, i: RequestInit) => { t += 1000; return f(u, i); });
    d.fetch = f2 as unknown as typeof fetch;
    const r1 = await refreshVolumes({ deps: d, plan, budgetMs: 16_000, clock });
    expect(r1.status).toBe('time_budget');
    expect(r1.batchesRun).toBe(2);
    expect(sleeps.filter((s) => s > 0).every((s) => s <= CALL_SPACING_MS)).toBe(true);
    expect(sleeps.some((s) => s >= CALL_SPACING_MS - 1000)).toBe(true);
    const stored = db.tables.holler_keyword_volume.length;
    expect(stored).toBe(r1.keywordsDone);
    // second run, fresh budget: only the rest is requested
    const before = f.mock.calls.length;
    const r2 = await refreshVolumes({ deps: d, plan, budgetMs: 60_000, clock });
    expect(r2.status).toBe('complete');
    expect(f.mock.calls.length - before).toBe(1);
    expect(db.tables.holler_keyword_volume).toHaveLength(2460);
    expect(new Set(db.tables.holler_keyword_volume.map((x) => x.keyword)).size).toBe(2460);
  });

  it('stops with cap_reached and keeps what was stored', async () => {
    const plan = buildKeywordPlan(CITIES.slice(0, 60), CATEGORIES.map((c) => c.id));
    const f = echo();
    const { d, db } = deps({ fetch: f, env: { DATAFORSEO_LOGIN: 'a', DATAFORSEO_PASSWORD: 'b', DATAFORSEO_MONTHLY_CAP_USD: '0.1' } });
    const r = await refreshVolumes({ deps: d, plan });
    expect(r.status).toBe('cap_reached');
    expect(r.batchesRun).toBe(1); // 0.075 spent, the next 0.075 would pass 0.10
    expect(f).toHaveBeenCalledTimes(1);
    expect(db.tables.holler_keyword_volume.length).toBe(r.keywordsDone);
  });

  it('a task without a result array stores nothing and reports an error', async () => {
    const { d, db } = deps({ fetch: vi.fn(async () => jsonRes(okBody(null, 0.075))) });
    const r = await refreshVolumes({ deps: d, plan: buildKeywordPlan(SMALL, TRADES) });
    expect(r.status).toBe('error');
    expect(db.tables.holler_keyword_volume).toHaveLength(0);
  });

  it('an API failure stops the run without throwing', async () => {
    const { d } = deps({ fetch: vi.fn(async () => new Response('', { status: 402 })) });
    const r = await refreshVolumes({ deps: d, plan: buildKeywordPlan(SMALL, TRADES) });
    expect(r.status).toBe('error');
    expect(r.detail).toContain('http_error');
  });
});
