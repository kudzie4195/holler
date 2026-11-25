/**
 * Round 33 (SAM): the command-line side of the backfill (scripts/sam-backfill.ts is a three-line wrapper), kept in lib so tests can drive it
 * with a stub fetch and stub store. Owns: the option checks, the HOLLER_SAM_BACKFILL_ENABLED check, the state file, the dry run, and the
 * insert (insertNewSignals with dedupe, then a QUIET rematch).
 *
 * DRY RUN. `--run --dry` makes real requests and writes nothing to the database. It runs on a COPY of the state: task progress (done, next
 * page) of the real state file is never changed by it, so the real run that follows still reads every task. Only the request counter is
 * carried back to the real file, because the requests really were made against the key's daily limit.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_DAILY_BUDGET,
  SAM_BACKFILL_FLAG,
  backfillTasks,
  buildBackfillUrl,
  clampBudget,
  describePlan,
  newState,
  redactUrl,
  runBackfill,
  samBackfillEnabled,
  DEFAULT_DAILY_BUDGET,
  type BackfillReport,
  type BackfillState,
} from './sam-backfill';
import type { SignalInput } from './types';

export type InsertFn = (rows: SignalInput[]) => Promise<number>;

/** What makeInsert needs from the store; injected so a test can see exactly how it is called. */
export interface StoreMods {
  insertNewSignals: (db: never, rows: Array<SignalInput & { placeSlug: string | null }>, opts: { dedupe: boolean; log: (m: string) => void }) => Promise<Array<{ id?: unknown }>>;
  rematchSignals: (db: never, ids: number[], opts: { quiet: boolean; log: (m: string) => void }) => Promise<{ created: number; error?: string }>;
  placeSlugFor: (s: SignalInput) => string | null;
}

/**
 * The insert of the backfill. Rows go in through insertNewSignals with dedupe on (on conflict (source, external_id) do nothing, so a stored
 * notice is never written twice) and are marked data.backfill = true: the quiet rematch, and any later rematch (the hourly AI step), treat
 * a marked row as history, never as a new alert (lib/signals/rematch.ts). The feed step is a QUIET rematch (no email, no push), unless
 * --no-match.
 */
export function makeInsert(db: unknown, mods: StoreMods, opts: { match: boolean; log: (m: string) => void }): InsertFn {
  return async (rows) => {
    const marked = rows.map((s) => ({ ...s, data: { ...(s.data ?? {}), backfill: true }, placeSlug: mods.placeSlugFor(s) }));
    const stored = await mods.insertNewSignals(db as never, marked, { dedupe: true, log: opts.log });
    const ids = stored.map((r) => r.id).filter((x): x is number => typeof x === 'number');
    if (ids.length && opts.match) {
      const r = await mods.rematchSignals(db as never, ids, { quiet: true, log: opts.log });
      opts.log(`  added to feeds quietly: ${r.created}${r.error ? ` (${r.error})` : ''}`);
    }
    return stored.length;
  };
}

export interface CliIo {
  env: Record<string, string | undefined>;
  out: (m: string) => void;
  err: (m: string) => void;
  now: () => Date;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Builds the real insert from the environment (Supabase service role). Tests pass a stub. */
  buildInsert?: (opts: { match: boolean; log: (m: string) => void }) => Promise<InsertFn>;
}

/** A positive whole number from an option, or null when it is missing; throws on anything else ("abc", "0", "-1", "1.5", "3x"). */
export function positiveInt(name: string, raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (!/^[1-9]\d*$/.test(raw.trim())) throw new Error(`${name} must be a whole number of 1 or more (got "${raw}")`);
  return Number(raw.trim());
}

function loadState(file: string, now: Date): BackfillState {
  if (!existsSync(file)) return newState(now);
  const s = JSON.parse(readFileSync(file, 'utf8')) as BackfillState;
  if (s?.version !== 1 || !s.window || !s.tasks) throw new Error(`${file} is not a sam-backfill state file; move it away to start over`);
  return s;
}

function saveState(file: string, s: BackfillState): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, file);
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const has = (n: string) => argv.includes(n);
  const opt = (n: string): string | undefined => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  let budget = DEFAULT_DAILY_BUDGET;
  let maxRequests: number | undefined;
  try {
    const b = positiveInt('--daily-budget', opt('--daily-budget'));
    if (b !== null) {
      if (b > MAX_DAILY_BUDGET) io.err(`--daily-budget ${b} is above the ceiling; using ${MAX_DAILY_BUDGET}`);
      budget = clampBudget(b);
    }
    maxRequests = positiveInt('--max-requests', opt('--max-requests')) ?? undefined;
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const file = resolve(opt('--state') ?? 'sam-backfill-state.json');
  const now = io.now();
  let state: BackfillState;
  try {
    state = loadState(file, now);
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const run = has('--run');
  const dry = has('--dry');

  if (!run) {
    for (const l of describePlan(state, now, budget)) io.out(l);
    io.out(`first request (key hidden): ${redactUrl(buildBackfillUrl('KEY', backfillTasks()[0], state.window, 0))}`);
    io.out('plan only: no request was made. Add --run to start.');
    return 0;
  }
  // The switch is checked for every run, dry or not: a dry run spends the key's daily requests too.
  if (!samBackfillEnabled(io.env[SAM_BACKFILL_FLAG])) {
    io.err(`${SAM_BACKFILL_FLAG} is not on. Set it to 1 for this run to make requests.`);
    return 2;
  }
  const apiKey = io.env.SAM_API_KEY;
  if (!apiKey) {
    io.err('SAM_API_KEY is not set.');
    return 2;
  }
  let insert: InsertFn | undefined;
  if (!dry) {
    if (!io.buildInsert) {
      io.err('no store is configured');
      return 2;
    }
    try {
      insert = await io.buildInsert({ match: !has('--no-match'), log: io.out });
    } catch (e) {
      io.err(e instanceof Error ? e.message : String(e));
      return 2;
    }
  }

  // A dry run works on a copy; only its request counter goes back to the real state file.
  const work: BackfillState = dry ? structuredClone(state) : state;
  const save = (s: BackfillState) => {
    if (dry) {
      state.requests = { ...s.requests };
      state.totalRequests = s.totalRequests;
      saveState(file, state);
    } else saveState(file, s);
  };
  const report: BackfillReport = await runBackfill(
    work,
    { apiKey, dailyBudget: budget, maxRequests },
    { fetch: io.fetch, now: io.now, log: io.out, save, insert, sleep: io.sleep },
  );
  io.out(JSON.stringify(report, null, 2));
  if (dry) io.out('Dry run: nothing was stored and no task was marked done. The real run reads every task.');
  io.out(report.stopped === 'finished' ? 'All tasks done.' : `Not finished (${report.stopped}). Run the same command again later; it resumes from ${file}.`);
  return report.stopped === 'error' || report.stopped === 'rate-limit' ? 1 : 0;
}

/** The real insert: a Supabase service-role client from the environment, the store's insertNewSignals and the quiet rematch. */
export async function buildRealInsert(env: Record<string, string | undefined>, opts: { match: boolean; log: (m: string) => void }): Promise<InsertFn> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to store notices (or use --dry).');
  const [{ createClient }, store, run, rematch] = await Promise.all([import('@supabase/supabase-js'), import('./store'), import('./run'), import('./rematch')]);
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return makeInsert(db, { insertNewSignals: store.insertNewSignals as unknown as StoreMods['insertNewSignals'], rematchSignals: rematch.rematchSignals as unknown as StoreMods['rematchSignals'], placeSlugFor: run.placeSlugFor }, opts);
}
