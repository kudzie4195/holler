/**
 * Round 33 (SAM): the one-off backfill. Parameter names are the ones on https://open.gsa.gov/api/get-opportunities-public-api/
 * (checked 2026-11-25); the daily limits are from https://open.gsa.gov/api/entity-api (10/day with no SAM role, 1,000/day with one).
 * No request leaves this file: every fetch is a stub.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METROS } from '@/lib/geo/metros';
import {
  BACKFILL_DEADLINE_DAYS,
  BACKFILL_POSTED_DAYS,
  BACKFILL_PTYPES,
  DEFAULT_DAILY_BUDGET,
  DOCUMENTED_LIMIT_NO_ROLE,
  DOCUMENTED_LIMIT_WITH_ROLE,
  MAX_DAILY_BUDGET,
  PAGE_LIMIT,
  backfillStates,
  backfillTasks,
  backfillWindow,
  buildBackfillUrl,
  clampBudget,
  describePlan,
  filterOpen,
  mdY,
  newState,
  pendingTasks,
  redactUrl,
  requestsLeftToday,
  runBackfill,
  samBackfillEnabled,
  taskKey,
  type BackfillDeps,
  type BackfillState,
} from '@/lib/signals/sam-backfill';
import type { SignalInput } from '@/lib/signals/types';

const NOW = new Date('2026-11-25T15:00:00Z');
const KEY = 'TESTKEY-not-a-real-key-1234567890';

describe('parameter building', () => {
  const w = backfillWindow(NOW);
  it('the window: posted in the last 90 days, response deadline today or later, inside the API one-year range', () => {
    expect(w).toEqual({ postedFrom: '08/27/2026', postedTo: '11/25/2026', rdlfrom: '11/25/2026', rdlto: '11/24/2027' });
    expect(BACKFILL_POSTED_DAYS).toBe(90);
    expect(BACKFILL_DEADLINE_DAYS).toBeLessThan(366);
    expect(mdY(new Date('2026-01-05T00:00:00Z'))).toBe('01/05/2026');
  });
  it('the URL carries exactly the documented parameters, with the documented names', () => {
    const u = new URL(buildBackfillUrl(KEY, { state: 'GA', ptype: 'o' }, w, 0));
    expect(`${u.origin}${u.pathname}`).toBe('https://api.sam.gov/opportunities/v2/search');
    expect([...u.searchParams.keys()].sort()).toEqual(['api_key', 'limit', 'offset', 'postedFrom', 'postedTo', 'ptype', 'rdlfrom', 'rdlto', 'state'].sort());
    expect(Object.fromEntries(u.searchParams)).toEqual({
      api_key: KEY,
      postedFrom: '08/27/2026',
      postedTo: '11/25/2026',
      rdlfrom: '11/25/2026',
      rdlto: '11/24/2027',
      ptype: 'o',
      state: 'GA',
      limit: '1000',
      offset: '0',
    });
  });
  it('offset is the zero-based page index and limit never passes the documented 1000', () => {
    expect(PAGE_LIMIT).toBe(1000);
    expect(new URL(buildBackfillUrl(KEY, { state: 'TX', ptype: 'k' }, w, 3)).searchParams.get('offset')).toBe('3');
  });
  it('one ptype per request, from the documented codes only (o k r p)', () => {
    expect([...BACKFILL_PTYPES]).toEqual(['o', 'k', 'r', 'p']);
    for (const p of BACKFILL_PTYPES) expect('uparsogki').toContain(p);
    expect(new URL(buildBackfillUrl(KEY, { state: 'GA', ptype: 'r' }, w)).searchParams.getAll('ptype')).toEqual(['r']);
  });
  it('the key is redacted in anything printed', () => {
    const url = buildBackfillUrl(KEY, { state: 'GA', ptype: 'o' }, w);
    expect(redactUrl(url)).not.toContain(KEY);
    expect(redactUrl(url)).toContain('api_key=REDACTED&postedFrom=');
  });
  it('the states are the 10 metros states plus NC and SC, the marketed four first, no duplicates', () => {
    const s = backfillStates();
    expect(s.slice(0, 4)).toEqual(['GA', 'TX', 'NC', 'SC']);
    expect(new Set(s).size).toBe(s.length);
    for (const m of METROS) for (const st of m.states) expect(s).toContain(st);
    expect(s).toHaveLength(15);
  });
  it('tasks: real bids (o, k) for every state come before early notices (r, p)', () => {
    const tasks = backfillTasks();
    expect(tasks).toHaveLength(60);
    expect(tasks.slice(0, 15).every((t) => t.ptype === 'o')).toBe(true);
    expect(tasks.slice(15, 30).every((t) => t.ptype === 'k')).toBe(true);
    expect(tasks.slice(30, 45).every((t) => t.ptype === 'r')).toBe(true);
    expect(taskKey(tasks[0])).toBe('GA:o');
  });
});

describe('daily limit', () => {
  it('uses the documented numbers and keeps the default under the no-role limit with room for the cron adapter', () => {
    expect(DOCUMENTED_LIMIT_NO_ROLE).toBe(10);
    expect(DOCUMENTED_LIMIT_WITH_ROLE).toBe(1000);
    expect(DEFAULT_DAILY_BUDGET + 6).toBeLessThan(DOCUMENTED_LIMIT_NO_ROLE);
    expect(MAX_DAILY_BUDGET).toBeLessThanOrEqual(DOCUMENTED_LIMIT_WITH_ROLE * 0.4);
  });
  it('clampBudget: default for junk, never above the ceiling, never below 1', () => {
    expect(clampBudget(undefined)).toBe(DEFAULT_DAILY_BUDGET);
    expect(clampBudget('abc')).toBe(DEFAULT_DAILY_BUDGET);
    expect(clampBudget(0)).toBe(DEFAULT_DAILY_BUDGET);
    expect(clampBudget(-5)).toBe(DEFAULT_DAILY_BUDGET);
    expect(clampBudget('150')).toBe(150);
    expect(clampBudget(5000)).toBe(MAX_DAILY_BUDGET);
    expect(clampBudget(7.9)).toBe(7);
  });
  it('requestsLeftToday counts per UTC day', () => {
    const s = newState(NOW);
    s.requests = { day: '2026-11-25', count: 2 };
    expect(requestsLeftToday(s, NOW, 3)).toBe(1);
    expect(requestsLeftToday(s, new Date('2026-11-26T00:00:01Z'), 3)).toBe(3);
  });
});

describe('the switch', () => {
  it('is off unless 1, true, on or yes', () => {
    expect(samBackfillEnabled(undefined)).toBe(false);
    expect(samBackfillEnabled('')).toBe(false);
    expect(samBackfillEnabled('0')).toBe(false);
    expect(samBackfillEnabled('maybe')).toBe(false);
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(samBackfillEnabled(v)).toBe(true);
  });
  it('nothing but the script and its own module reads the backfill code or flag (no cron, no page)', () => {
    const root = join(__dirname, '../..');
    const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '');
    for (const p of ['app/api/cron/scan/route.ts', 'lib/signals/run.ts', 'lib/signals/registry.ts', 'lib/signals/adapters/sam.ts', 'app/api/cron/notify/route.ts']) {
      const src = read(p);
      expect(src, p).not.toMatch(/from ['"][^'"]*sam-backfill['"]|import\([^)]*sam-backfill|SAM_BACKFILL_ENABLED|samBackfillEnabled/);
    }
  });
});

// ---- the runner, with a stub fetch ------------------------------------------------------------------------------------------------

const notice = (id: string, extra: Record<string, unknown> = {}) => ({
  noticeId: id,
  title: `Grounds maintenance ${id}`,
  type: 'Combined Synopsis/Solicitation',
  naicsCode: '561730',
  postedDate: '2026-11-10',
  responseDeadLine: '2026-12-20',
  typeOfSetAside: 'SBA',
  typeOfSetAsideDescription: 'Total Small Business Set-Aside (FAR 19.5)',
  placeOfPerformance: { city: { name: 'Atlanta' }, state: { code: 'GA' } },
  ...extra,
});
const page = (ids: string[], total: number, extra: Record<string, unknown> = {}) => ({ totalRecords: total, limit: 1000, offset: 0, opportunitiesData: ids.map((i) => notice(i, extra)) });

interface Harness {
  deps: BackfillDeps;
  calls: string[];
  saves: BackfillState[];
  inserted: SignalInput[][];
  clock: { now: Date };
}
function harness(answer: (url: URL, n: number) => { status?: number; body: unknown }, opts: { insert?: boolean; now?: Date } = {}): Harness {
  const calls: string[] = [];
  const saves: BackfillState[] = [];
  const inserted: SignalInput[][] = [];
  const clock = { now: opts.now ?? NOW };
  const stored = new Set<string>();
  const deps: BackfillDeps = {
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(String(input));
      const r = answer(url, calls.length);
      const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      return new Response(text, { status: r.status ?? 200 });
    }) as typeof fetch,
    now: () => clock.now,
    log: () => {},
    save: (s) => saves.push(structuredClone(s)),
    sleep: async () => {},
  };
  if (opts.insert !== false) {
    deps.insert = async (rows) => {
      inserted.push(rows);
      // duplicates are ignored, like the store's on-conflict-do-nothing
      let n = 0;
      for (const r of rows) {
        if (!stored.has(`${r.source}|${r.externalId}`)) {
          stored.add(`${r.source}|${r.externalId}`);
          n++;
        }
      }
      return n;
    };
  }
  return { deps, calls, saves, inserted, clock };
}
const TWO = backfillTasks(['GA', 'TX'], ['o', 'k']); // four tasks: GA:o TX:o GA:k TX:k

describe('runBackfill: paging', () => {
  it('reads every page of a task while totalRecords says there is more, then moves on', async () => {
    const h = harness((u) => {
      const st = u.searchParams.get('state');
      const off = Number(u.searchParams.get('offset'));
      if (st === 'GA' && u.searchParams.get('ptype') === 'o') return { body: page([`ga-o-p${off}-1`, `ga-o-p${off}-2`], 2500) };
      return { body: page([`${st}-${u.searchParams.get('ptype')}-1`], 1) };
    });
    const state = newState(NOW);
    const rep = await runBackfill(state, { apiKey: KEY, dailyBudget: 50, tasks: TWO }, h.deps);
    expect(rep.stopped).toBe('finished');
    const ga = h.calls.filter((c) => c.includes('state=GA') && c.includes('ptype=o'));
    expect(ga.map((c) => new URL(c).searchParams.get('offset'))).toEqual(['0', '1', '2']); // 2500 rows = pages 0, 1, 2
    expect(h.calls).toHaveLength(3 + 3); // GA:o x3 pages, TX:o, GA:k, TX:k
    expect(rep.tasksLeft).toBe(0);
    expect(rep.inserted).toBe(3 * 2 + 3);
    expect(state.tasks['GA:o'].status).toBe('done');
  });
  it('every call uses the frozen window and the documented parameters', async () => {
    const h = harness(() => ({ body: page(['a'], 1) }));
    await runBackfill(newState(NOW), { apiKey: KEY, dailyBudget: 50, tasks: TWO }, h.deps);
    for (const c of h.calls) {
      const p = new URL(c).searchParams;
      expect(p.get('rdlfrom')).toBe('11/25/2026');
      expect(p.get('rdlto')).toBe('11/24/2027');
      expect(p.get('postedFrom')).toBe('08/27/2026');
      expect(['o', 'k']).toContain(p.get('ptype'));
    }
  });
  it('a 404 "No Data found" finishes that task with no rows and no error', async () => {
    const h = harness((u) => (u.searchParams.get('state') === 'GA' ? { status: 404, body: { message: 'No Data found' } } : { body: page(['t'], 1) }));
    const state = newState(NOW);
    const rep = await runBackfill(state, { apiKey: KEY, dailyBudget: 50, tasks: TWO }, h.deps);
    expect(rep.stopped).toBe('finished');
    expect(state.tasks['GA:o'].status).toBe('done');
    expect(state.tasks['GA:o'].rows).toBe(0);
  });
  it('a row that is closed by the time it is stored is not inserted; a notice with no deadline is kept', () => {
    const rows = [
      { externalId: 'a', expiresAt: '2026-11-20T12:00:00.000Z' },
      { externalId: 'b', expiresAt: '2026-12-01T12:00:00.000Z' },
      { externalId: 'c', expiresAt: null },
    ] as SignalInput[];
    expect(filterOpen(rows, NOW).map((r) => r.externalId)).toEqual(['b', 'c']);
  });
  it('rows outside the trades are dropped by the adapter parser before insert', async () => {
    const h = harness(() => ({ body: { totalRecords: 2, opportunitiesData: [notice('keep'), notice('drop', { naicsCode: '511210', title: 'Software licences' })] } }));
    const rep = await runBackfill(newState(NOW), { apiKey: KEY, dailyBudget: 50, tasks: TWO.slice(0, 1) }, h.deps);
    expect(rep.rows).toBe(2);
    expect(rep.parsed).toBe(1);
    expect(h.inserted[0].map((r) => r.externalId)).toEqual(['keep']);
    // the stored row carries the set-aside
    expect(h.inserted[0][0].data).toMatchObject({ setAside: 'SBA' });
  });
  it('stops with a clear error when page 1 opens with the same notice as page 0 (offset is not a page index)', async () => {
    const h = harness(() => ({ body: page(['same-1', 'same-2'], 3000) }));
    const state = newState(NOW);
    const rep = await runBackfill(state, { apiKey: KEY, dailyBudget: 50, tasks: TWO }, h.deps);
    expect(rep.stopped).toBe('error');
    expect(rep.error).toMatch(/offset is not a page index/);
    expect(h.calls).toHaveLength(2);
  });
});

describe('runBackfill: budget and resume', () => {
  it('stops at the daily budget with tasks left, and a second run the next UTC day continues where it stopped', async () => {
    const h = harness((u) => ({ body: page([`${u.searchParams.get('state')}-${u.searchParams.get('ptype')}`], 1) }));
    const state = newState(NOW);
    const a = await runBackfill(state, { apiKey: KEY, dailyBudget: 3, tasks: TWO }, h.deps);
    expect(a.stopped).toBe('budget');
    expect(a.requestsThisRun).toBe(3);
    expect(a.tasksLeft).toBe(1);
    expect(h.calls).toHaveLength(3);
    // the same day again: nothing more is requested
    const same = await runBackfill(state, { apiKey: KEY, dailyBudget: 3, tasks: TWO }, h.deps);
    expect(same.requestsThisRun).toBe(0);
    expect(same.stopped).toBe('budget');
    expect(h.calls).toHaveLength(3);
    // the next UTC day: only the one task that was left
    h.clock.now = new Date('2026-11-26T01:00:00Z');
    const b = await runBackfill(state, { apiKey: KEY, dailyBudget: 3, tasks: TWO }, h.deps);
    expect(b.stopped).toBe('finished');
    expect(b.requestsThisRun).toBe(1);
    expect(h.calls).toHaveLength(4);
    expect(new Set(h.calls).size).toBe(4); // no request was repeated
  });
  it('resumes in the middle of a task: a stored next page is requested, finished pages are not', async () => {
    let first = true;
    const h = harness((u) => {
      const off = Number(u.searchParams.get('offset'));
      if (first) {
        first = false;
        return { body: page(['p0-a'], 2500) };
      }
      return { body: page([`p${off}-a`], 2500) };
    });
    const state = newState(NOW);
    const a = await runBackfill(state, { apiKey: KEY, dailyBudget: 50, maxRequests: 1, tasks: TWO.slice(0, 1) }, h.deps);
    expect(a.stopped).toBe('budget');
    expect(state.tasks['GA:o']).toMatchObject({ status: 'partial', nextPage: 1 });
    // a "new process": the state is read back from what was saved
    const reloaded = JSON.parse(JSON.stringify(h.saves[h.saves.length - 1])) as BackfillState;
    const b = await runBackfill(reloaded, { apiKey: KEY, dailyBudget: 50, tasks: TWO.slice(0, 1) }, h.deps);
    expect(b.stopped).toBe('finished');
    expect(h.calls.map((c) => new URL(c).searchParams.get('offset'))).toEqual(['0', '1', '2']);
  });
  it('the request is counted and saved BEFORE it is made, so a crash mid-request still counts against the day', async () => {
    const seen: number[] = [];
    const h = harness(() => ({ body: page(['x'], 1) }));
    const orig = h.deps.fetch;
    h.deps.fetch = (async (...a: Parameters<typeof fetch>) => {
      seen.push(h.saves[h.saves.length - 1].requests.count);
      return orig(...a);
    }) as typeof fetch;
    await runBackfill(newState(NOW), { apiKey: KEY, dailyBudget: 50, tasks: TWO.slice(0, 2) }, h.deps);
    expect(seen).toEqual([1, 2]);
  });
  it('a 429 stops the run, leaves the task unfinished and blocks the rest of that UTC day', async () => {
    const h = harness(() => ({ status: 429, body: 'Too Many Requests' }));
    const state = newState(NOW);
    const a = await runBackfill(state, { apiKey: KEY, dailyBudget: 50, tasks: TWO }, h.deps);
    expect(a.stopped).toBe('rate-limit');
    expect(a.error).toMatch(/429/);
    expect(state.tasks['GA:o'].status).toBe('pending');
    expect(h.calls).toHaveLength(1);
    const again = await runBackfill(state, { apiKey: KEY, dailyBudget: 50, tasks: TWO }, h.deps);
    expect(again.requestsThisRun).toBe(0);
    expect(h.calls).toHaveLength(1);
  });
  it('401, 403, 500, an HTML page, bad JSON and a changed shape each stop the run with the task unfinished', async () => {
    const cases: [number, unknown, RegExp][] = [
      [401, 'denied', /401.*api_key/],
      [403, 'denied', /403.*api_key/],
      [500, 'boom', /500/],
      [200, '<html><body>x</body></html>', /HTML page/],
      [200, 'not json', /non-JSON/],
      [200, { foo: 1 }, /opportunitiesData/],
      [200, { totalRecords: 5, opportunitiesData: [{ nope: 1 }, { nope: 2 }] }, /shape may have changed/],
    ];
    for (const [status, body, re] of cases) {
      const h = harness(() => ({ status, body }));
      const state = newState(NOW);
      const rep = await runBackfill(state, { apiKey: KEY, dailyBudget: 50, tasks: TWO }, h.deps);
      expect(rep.stopped, String(status)).toBe('error');
      expect(rep.error).toMatch(re);
      expect(state.tasks['GA:o'].status).not.toBe('done');
      expect(h.calls).toHaveLength(1);
    }
  });
  it('an insert failure stops the run and does not mark the page done', async () => {
    const h = harness(() => ({ body: page(['x'], 1) }));
    h.deps.insert = async () => {
      throw new Error('signals upsert failed: boom');
    };
    const state = newState(NOW);
    const rep = await runBackfill(state, { apiKey: KEY, dailyBudget: 50, tasks: TWO }, h.deps);
    expect(rep.stopped).toBe('error');
    expect(state.tasks['GA:o'].status).toBe('pending');
  });
  it('a dry run (no insert) fetches and parses but stores nothing', async () => {
    const h = harness(() => ({ body: page(['x'], 1) }), { insert: false });
    const rep = await runBackfill(newState(NOW), { apiKey: KEY, dailyBudget: 50, tasks: TWO }, h.deps);
    expect(rep.stopped).toBe('finished');
    expect(rep.parsed).toBe(4);
    expect(rep.inserted).toBe(0);
  });
  it('duplicates are ignored: running the same notices again inserts nothing new', async () => {
    const h = harness(() => ({ body: page(['dup-1', 'dup-2'], 2) }));
    const a = await runBackfill(newState(NOW), { apiKey: KEY, dailyBudget: 50, tasks: TWO.slice(0, 1) }, h.deps);
    const b = await runBackfill(newState(NOW), { apiKey: KEY, dailyBudget: 50, tasks: TWO.slice(0, 1) }, h.deps);
    expect(a.inserted).toBe(2);
    expect(b.inserted).toBe(0);
  });
  it('the saved state and the log never contain the API key', async () => {
    const logs: string[] = [];
    const h = harness(() => ({ body: page(['x'], 1) }));
    h.deps.log = (m) => logs.push(m);
    await runBackfill(newState(NOW), { apiKey: KEY, dailyBudget: 50, tasks: TWO }, h.deps);
    expect(JSON.stringify(h.saves)).not.toContain(KEY);
    expect(logs.join('\n')).not.toContain(KEY);
    expect(logs.some((l) => l.startsWith('GET ') && l.includes('api_key=REDACTED'))).toBe(true);
  });
  it('a full list at the default budget needs about 20 days and the plan says so', () => {
    const state = newState(NOW);
    expect(pendingTasks(state)).toHaveLength(60);
    const plan = describePlan(state, NOW, DEFAULT_DAILY_BUDGET).join('\n');
    expect(plan).toMatch(/days to finish at this budget: about 20/);
    expect(plan).toMatch(/10\/day with no SAM role, 1000\/day with one/);
  });
});
