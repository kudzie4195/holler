/**
 * Round 33 (SAM): one-off, resumable backfill of SAM.gov notices that were posted before the SAM_API_KEY was added (Nov 20) and are
 * still open. Nothing here runs by itself: scripts/sam-backfill.ts is the only caller, it refuses to make a request unless
 * HOLLER_SAM_BACKFILL_ENABLED is on, and the cron scan never imports this file.
 *
 * Request shape (parameter names confirmed against https://open.gsa.gov/api/get-opportunities-public-api/ on 2026-11-25):
 *   GET https://api.sam.gov/opportunities/v2/search
 *     api_key, postedFrom, postedTo (MM/dd/yyyy, required, at most 1 year apart), rdlfrom, rdlto (response deadline, MM/dd/yyyy, "if response
 *     date From & To is provided, then the date range is 1 year"), ptype (ONE procurement type code per call), state (place of performance
 *     state), limit (max 1000), offset ("Indicates the page index. Default offset starts with 0").
 *   One call per (state, ptype) task, paged while totalRecords says there is more. The rows then go through parseSam (the adapter's own
 *   parser: NAICS rules, supply buys dropped, state of performance required) and normalizeSignals, and are inserted by the caller with
 *   insertNewSignals (on conflict (source, external_id) do nothing), so a notice that is already stored is never written twice.
 *
 * DAILY REQUEST LIMIT. The Get Opportunities page gives no number. The official "Default API Daily Rate Limit" table
 * (https://open.gsa.gov/api/entity-api, checked 2026-11-25) says: non-federal user without a SAM.gov role 10 requests/day, non-federal user
 * with a role 1,000/day, federal user 1,000/day, non-federal system account 1,000/day, federal system account 10,000/day. A request over the
 * limit gets HTTP 429 (https://api.sam.gov/docs/rate-limits). The same key also serves the steady-state adapter (lib/signals/adapters/sam.ts:
 * up to 3 pages x 2 runs = 6 requests a day), so this module counts every request it makes per UTC day in its state file and stops at a daily
 * budget: DEFAULT_DAILY_BUDGET (3) fits a key with no role next to the adapter; the owner raises it only for a key that has a role, and it can
 * never exceed MAX_DAILY_BUDGET (400, 40% of the 1,000 role limit), whatever is asked.
 *
 * RESUME. State is a small JSON file (no database, no schema): the frozen date window, per task its next page or done, and today's request
 * count. It is written before each request (the request is counted even if the process dies) and after each answer, so a re-run continues
 * exactly where the last one stopped and never repeats a finished page. A 429, a 4xx or a changed response shape stops the run with the
 * task left unfinished.
 */
import { METROS } from '@/lib/geo/metros';
import { adapters as samAdapters, parseSam, samRowStats } from '@/lib/signals/adapters/sam';
import { normalizeSignals } from '@/lib/signals/run';
import type { SignalInput } from '@/lib/signals/types';

export const SAM_BACKFILL_FLAG = 'HOLLER_SAM_BACKFILL_ENABLED';

/** On only for "1", "true", "on" or "yes" (any case). Read at call time. */
export function samBackfillEnabled(value: string | undefined = typeof process !== 'undefined' ? process.env?.HOLLER_SAM_BACKFILL_ENABLED : undefined): boolean {
  return typeof value === 'string' && /^(?:1|true|on|yes)$/i.test(value.trim());
}

export const ENDPOINT = 'https://api.sam.gov/opportunities/v2/search';
export const BACKFILL_POSTED_DAYS = 90;
/** rdlfrom to rdlto must be within one year when both are sent: 364 days is inside it. */
export const BACKFILL_DEADLINE_DAYS = 364;
export const PAGE_LIMIT = 1000;
/** Documented daily limits (see the header). */
export const DOCUMENTED_LIMIT_NO_ROLE = 10;
export const DOCUMENTED_LIMIT_WITH_ROLE = 1000;
/** Fits a key with no role (10/day) next to the steady-state adapter (up to 6 requests a day). */
export const DEFAULT_DAILY_BUDGET = 3;
/** Hard ceiling: 40% of the role limit, so the adapter and any other use of the key always have room. */
export const MAX_DAILY_BUDGET = 400;
/** Procurement types, in the order they are worked: real bids first (o Solicitation, k Combined Synopsis/Solicitation), then early notices (r Sources Sought, p Presolicitation). */
export const BACKFILL_PTYPES = ['o', 'k', 'r', 'p'] as const;
export type BackfillPtype = (typeof BACKFILL_PTYPES)[number];
/** Charlotte and Raleigh are served (their permit feeds are live) and Charlotte spans the SC line: not in METROS' state lists. */
const EXTRA_STATES = ['NC', 'SC'] as const;
/** Worked first, in this order, because the marketed metros are there; the other served states follow in alphabetical order. */
const FIRST_STATES = ['GA', 'TX', 'NC', 'SC'] as const;

/** The states Holler serves: every state of the 10 metros (lib/geo/metros.ts) plus NC and SC, the four marketed ones first. */
export function backfillStates(): string[] {
  const all = new Set<string>([...METROS.flatMap((m) => m.states), ...EXTRA_STATES]);
  const first = FIRST_STATES.filter((s) => all.has(s));
  const rest = [...all].filter((s) => !first.includes(s as (typeof FIRST_STATES)[number])).sort();
  return [...first, ...rest];
}

export interface BackfillTask {
  state: string;
  ptype: BackfillPtype;
}
export const taskKey = (t: BackfillTask): string => `${t.state}:${t.ptype}`;

/** Every (state, ptype) task in work order: all states for ptype o, then k, then r, then p. */
export function backfillTasks(states: readonly string[] = backfillStates(), ptypes: readonly BackfillPtype[] = BACKFILL_PTYPES): BackfillTask[] {
  const out: BackfillTask[] = [];
  for (const ptype of ptypes) for (const state of states) out.push({ state, ptype });
  return out;
}

export interface BackfillWindow {
  postedFrom: string;
  postedTo: string;
  rdlfrom: string;
  rdlto: string;
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** MM/dd/yyyy in UTC, the format every date parameter takes. */
export function mdY(d: Date): string {
  return `${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}/${d.getUTCFullYear()}`;
}
const DAY = 86_400_000;

/** Notices posted in the last 90 days whose response deadline is today or later (and within the one-year range the API allows). */
export function backfillWindow(now: Date): BackfillWindow {
  return {
    postedFrom: mdY(new Date(now.getTime() - BACKFILL_POSTED_DAYS * DAY)),
    postedTo: mdY(now),
    rdlfrom: mdY(now),
    rdlto: mdY(new Date(now.getTime() + BACKFILL_DEADLINE_DAYS * DAY)),
  };
}

/** `page` is the zero-based page index (the docs define offset as a page index). */
export function buildBackfillUrl(apiKey: string, task: BackfillTask, window: BackfillWindow, page = 0): string {
  const p = new URLSearchParams({
    api_key: apiKey,
    postedFrom: window.postedFrom,
    postedTo: window.postedTo,
    rdlfrom: window.rdlfrom,
    rdlto: window.rdlto,
    ptype: task.ptype,
    state: task.state,
    limit: String(PAGE_LIMIT),
    offset: String(page),
  });
  return `${ENDPOINT}?${p.toString()}`;
}

/** The same URL with the key hidden, for logs and the printed plan. The key is never written anywhere. */
export function redactUrl(url: string): string {
  return url.replace(/([?&]api_key=)[^&]*/i, '$1REDACTED');
}

// ---- state --------------------------------------------------------------------------------------------------------------------------

export interface TaskState {
  /** 'done' once every page was read; otherwise the next zero-based page to request. */
  status: 'pending' | 'partial' | 'done';
  nextPage: number;
  totalRecords: number | null;
  /** Notice id that opened page 0: a later page that opens with the same id means offset is not a page index. */
  firstId: string | null;
  rows: number;
  parsed: number;
  inserted: number;
}

export interface BackfillState {
  version: 1;
  createdAt: string;
  window: BackfillWindow;
  tasks: Record<string, TaskState>;
  /** Requests made on one UTC day (YYYY-MM-DD). */
  requests: { day: string; count: number };
  totalRequests: number;
  lastError: string | null;
}

export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

export function newState(now: Date): BackfillState {
  return { version: 1, createdAt: now.toISOString(), window: backfillWindow(now), tasks: {}, requests: { day: utcDay(now), count: 0 }, totalRequests: 0, lastError: null };
}

const emptyTask = (): TaskState => ({ status: 'pending', nextPage: 0, totalRecords: null, firstId: null, rows: 0, parsed: 0, inserted: 0 });

/** A budget the owner asked for, clamped to 1..MAX_DAILY_BUDGET. A missing or invalid value is the default. */
export function clampBudget(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAILY_BUDGET;
  return Math.min(MAX_DAILY_BUDGET, Math.floor(n));
}

/** Requests still allowed today under `budget`, given the state's counter (a new UTC day starts at 0). */
export function requestsLeftToday(state: BackfillState, now: Date, budget: number): number {
  const used = state.requests.day === utcDay(now) ? state.requests.count : 0;
  return Math.max(0, clampBudget(budget) - used);
}

/** Tasks not yet done, in work order. */
export function pendingTasks(state: BackfillState, tasks: readonly BackfillTask[] = backfillTasks()): BackfillTask[] {
  return tasks.filter((t) => state.tasks[taskKey(t)]?.status !== 'done');
}

// ---- run ----------------------------------------------------------------------------------------------------------------------------

export interface BackfillDeps {
  fetch: typeof fetch;
  now: () => Date;
  log: (m: string) => void;
  /** Persist the state (a file). Called before every request and after every answer. */
  save: (s: BackfillState) => void;
  /** Store rows through the normal insert path (insertNewSignals, duplicates ignored). Returns how many were new. Absent on a dry run. */
  insert?: (rows: SignalInput[]) => Promise<number>;
  /** Pause between requests (default 1.2 s). Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

export interface BackfillOptions {
  apiKey: string;
  /** Requests allowed per UTC day, clamped to 1..MAX_DAILY_BUDGET. */
  dailyBudget?: number;
  /** Optional lower cap for this run only. */
  maxRequests?: number;
  tasks?: readonly BackfillTask[];
}

export type BackfillStop = 'finished' | 'budget' | 'rate-limit' | 'error';

export interface BackfillReport {
  stopped: BackfillStop;
  requestsThisRun: number;
  requestsToday: number;
  dailyBudget: number;
  tasksDone: number;
  tasksLeft: number;
  rows: number;
  parsed: number;
  inserted: number;
  error: string | null;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fail(state: BackfillState, report: BackfillReport, stopped: BackfillStop, msg: string, deps: BackfillDeps): BackfillReport {
  state.lastError = msg.slice(0, 300);
  deps.save(state);
  deps.log(`stopped: ${msg}`);
  return { ...report, stopped, error: msg };
}

/**
 * Works the pending tasks until the daily budget, the per-run cap or the end of the list, writing the state as it goes. Never throws.
 * `state` is mutated in place (the caller loads it from the file, or uses newState).
 */
export async function runBackfill(state: BackfillState, opts: BackfillOptions, deps: BackfillDeps): Promise<BackfillReport> {
  const sleep = deps.sleep ?? defaultSleep;
  const tasks = opts.tasks ?? backfillTasks();
  const adapter = samAdapters[0];
  const dailyBudget = clampBudget(opts.dailyBudget);
  const report: BackfillReport = { stopped: 'finished', requestsThisRun: 0, requestsToday: 0, dailyBudget, tasksDone: 0, tasksLeft: 0, rows: 0, parsed: 0, inserted: 0, error: null };
  const finish = (r: BackfillReport): BackfillReport => {
    const now = deps.now();
    r.requestsToday = state.requests.day === utcDay(now) ? state.requests.count : 0;
    r.tasksLeft = pendingTasks(state, tasks).length;
    r.tasksDone = tasks.length - r.tasksLeft;
    return r;
  };
  try {
    for (const task of pendingTasks(state, tasks)) {
      const key = taskKey(task);
      const ts = (state.tasks[key] ??= emptyTask());
      for (;;) {
        const now = deps.now();
        if (state.requests.day !== utcDay(now)) state.requests = { day: utcDay(now), count: 0 };
        const left = requestsLeftToday(state, now, dailyBudget);
        const runCap = opts.maxRequests !== undefined ? Math.max(0, Math.floor(opts.maxRequests)) - report.requestsThisRun : Infinity;
        if (left <= 0 || runCap <= 0) {
          deps.log(left <= 0 ? `daily budget of ${dailyBudget} requests reached; run again tomorrow` : `per-run cap reached`);
          return finish({ ...report, stopped: 'budget' });
        }
        const page = ts.nextPage;
        const url = buildBackfillUrl(opts.apiKey, task, state.window, page);
        // Count and save BEFORE the request: a crash mid-request must still count against the day.
        state.requests.count += 1;
        state.totalRequests += 1;
        report.requestsThisRun += 1;
        deps.save(state);
        deps.log(`GET ${redactUrl(url)}`);
        let res: Response;
        let body: string;
        try {
          res = await deps.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Holler/1.0 (+https://localholler.com)' }, signal: AbortSignal.timeout(30_000) });
          body = await res.text();
        } catch (e) {
          return finish(fail(state, report, 'error', `${key} page ${page}: ${e instanceof Error ? e.message : String(e)}`, deps));
        }
        if (res.status === 404 && /no data found/i.test(body)) {
          Object.assign(ts, { status: 'done', nextPage: page });
          state.lastError = null;
          deps.save(state);
          deps.log(`${key}: no data found (done)`);
          break;
        }
        if (res.status === 429) {
          // The day's allowance is spent whatever our own count says: block the rest of the UTC day.
          state.requests.count = Math.max(state.requests.count, dailyBudget);
          return finish(fail(state, report, 'rate-limit', `${key}: HTTP 429, the key's daily request limit is used up; nothing was lost, run again tomorrow`, deps));
        }
        if (!res.ok) {
          const hint = res.status === 401 || res.status === 403 ? ' (api_key invalid, missing or not allowed)' : '';
          const detail = /^\s*</.test(body) ? '' : ` ${body.replace(/\s+/g, ' ').slice(0, 120)}`;
          return finish(fail(state, report, 'error', `${key}: HTTP ${res.status}${hint}${detail}`, deps));
        }
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return finish(fail(state, report, 'error', `${key}: ${/^\s*</.test(body) ? 'an HTML page instead of JSON' : 'non-JSON text'}`, deps));
        }
        const stats = samRowStats(json);
        if (!stats) return finish(fail(state, report, 'error', `${key}: no opportunitiesData array, the response shape may have changed`, deps));
        const data = (json as { opportunitiesData: unknown[]; totalRecords?: unknown }).opportunitiesData;
        const firstId = firstNoticeId(data);
        if (page === 0) ts.firstId = firstId;
        else if (firstId && ts.firstId && firstId === ts.firstId) {
          return finish(fail(state, report, 'error', `${key}: page ${page} opens with the same notice as page 0, so offset is not a page index; stop and check the docs`, deps));
        }
        if (stats.rows > 0 && stats.usable === 0) return finish(fail(state, report, 'error', `${key}: ${stats.rows} rows and none with an id and a title, the response shape may have changed`, deps));
        const parsed = filterOpen(normalizeSignals(adapter, parseSam(json), deps.now()), deps.now());
        let inserted = 0;
        if (deps.insert && parsed.length) {
          try {
            inserted = await deps.insert(parsed);
          } catch (e) {
            return finish(fail(state, report, 'error', `${key} page ${page}: insert failed: ${e instanceof Error ? e.message : String(e)}`, deps));
          }
        }
        ts.rows += stats.rows;
        ts.parsed += parsed.length;
        ts.inserted += inserted;
        report.rows += stats.rows;
        report.parsed += parsed.length;
        report.inserted += inserted;
        const total = Number((json as { totalRecords?: unknown }).totalRecords);
        ts.totalRecords = Number.isFinite(total) ? total : ts.totalRecords;
        const more = Number.isFinite(total) && (page + 1) * PAGE_LIMIT < total && stats.rows > 0;
        ts.nextPage = more ? page + 1 : page;
        ts.status = more ? 'partial' : 'done';
        state.lastError = null;
        deps.save(state);
        deps.log(`${key} page ${page}: ${stats.rows} rows, ${parsed.length} in Holler's trades, ${inserted} new${more ? ' (more pages)' : ' (done)'}`);
        if (!more) break;
        await sleep(1200);
      }
      await sleep(1200);
    }
    return finish({ ...report, stopped: 'finished' });
  } catch (e) {
    return finish(fail(state, report, 'error', e instanceof Error ? e.message : String(e), deps));
  }
}

function firstNoticeId(data: unknown[]): string | null {
  for (const it of data) {
    if (it && typeof it === 'object' && !Array.isArray(it)) {
      const id = (it as { noticeId?: unknown }).noticeId;
      if (typeof id === 'string' && id.trim()) return id.trim();
    }
  }
  return null;
}

/** Drops a notice whose response deadline is already behind us (the frozen window can be a few days old). A notice with no deadline is kept. */
export function filterOpen(rows: SignalInput[], now: Date): SignalInput[] {
  return rows.filter((r) => {
    if (!r.expiresAt) return true;
    const t = Date.parse(r.expiresAt);
    return !Number.isFinite(t) || t > now.getTime();
  });
}

/** Printed plan: the tasks, the budget and how many days the whole list takes at that budget. Makes no request. */
export function describePlan(state: BackfillState, now: Date, budget: number, tasks: readonly BackfillTask[] = backfillTasks()): string[] {
  const left = pendingTasks(state, tasks);
  const b = clampBudget(budget);
  const lines = [
    `states: ${backfillStates().join(' ')}`,
    `ptypes: ${BACKFILL_PTYPES.join(' ')} (o Solicitation, k Combined Synopsis/Solicitation, r Sources Sought, p Presolicitation)`,
    `window: posted ${state.window.postedFrom} to ${state.window.postedTo}, response deadline ${state.window.rdlfrom} to ${state.window.rdlto}`,
    `tasks: ${tasks.length} total, ${left.length} left; at least one request each, more when a state has over ${PAGE_LIMIT} open notices`,
    `daily budget: ${b} requests (documented limits: ${DOCUMENTED_LIMIT_NO_ROLE}/day with no SAM role, ${DOCUMENTED_LIMIT_WITH_ROLE}/day with one; ceiling ${MAX_DAILY_BUDGET})`,
    `requests used on ${utcDay(now)}: ${state.requests.day === utcDay(now) ? state.requests.count : 0}`,
    `days to finish at this budget: about ${Math.ceil(left.length / b)}`,
  ];
  return lines;
}
