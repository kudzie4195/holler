/**
 * Round 33 (SAM): owner-run, one-off, resumable backfill of still-open SAM.gov notices posted in the last 90 days (see
 * lib/signals/sam-backfill.ts for the request shape, the documented daily limits and the resume rules). It is NOT run by any cron and the
 * session that wrote it did not run it against production.
 *
 *   npm run sam:backfill -- --plan                       print the plan, make NO request, write nothing (default)
 *   npm run sam:backfill -- --run --dry                  make the requests but write nothing to the database (needs only SAM_API_KEY)
 *   HOLLER_SAM_BACKFILL_ENABLED=1 npm run sam:backfill -- --run          store the notices (SAM_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *
 * Options:
 *   --state <file>         resume file (default ./sam-backfill-state.json in the current folder). Delete it to start over.
 *   --daily-budget <n>     requests allowed per UTC day (default 3, which fits a key with NO SAM role: 10/day, and leaves room for the
 *                          steady-state adapter's up to 6). For a key with a SAM role (1,000/day) use e.g. 150. Never above 400.
 *   --max-requests <n>     stop this run after n requests, whatever the daily budget
 *   --no-match             store the notices but do not add them to members' feeds (default: they are added QUIETLY, as feed history with
 *                          no email and no push, by lib/signals/rematch.ts rematchSignals(quiet))
 *
 * The key is read from SAM_API_KEY, never printed, never written to the state file.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SAM_BACKFILL_FLAG,
  backfillTasks,
  clampBudget,
  describePlan,
  newState,
  redactUrl,
  runBackfill,
  samBackfillEnabled,
  buildBackfillUrl,
  type BackfillState,
} from '../lib/signals/sam-backfill';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string): string | undefined => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};

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

async function main(): Promise<number> {
  const file = resolve(opt('--state') ?? 'sam-backfill-state.json');
  const budget = clampBudget(opt('--daily-budget'));
  const maxRequests = opt('--max-requests') !== undefined ? Number(opt('--max-requests')) : undefined;
  const now = new Date();
  const state = loadState(file, now);
  const run = flag('--run');
  const dry = flag('--dry');

  if (!run) {
    for (const l of describePlan(state, now, budget)) console.log(l);
    const first = backfillTasks()[0];
    console.log(`first request (key hidden): ${redactUrl(buildBackfillUrl('KEY', first, state.window, 0))}`);
    console.log('plan only: no request was made. Add --run to start.');
    return 0;
  }
  if (!samBackfillEnabled()) {
    console.error(`${SAM_BACKFILL_FLAG} is not on. Set it to 1 for this run to make requests.`);
    return 2;
  }
  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    console.error('SAM_API_KEY is not set.');
    return 2;
  }

  let insert: ((rows: import('../lib/signals/types').SignalInput[]) => Promise<number>) | undefined;
  if (!dry) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to store notices (or use --dry).');
      return 2;
    }
    const [{ createClient }, { insertNewSignals }, { placeSlugFor }, { rematchSignals }] = await Promise.all([
      import('@supabase/supabase-js'),
      import('../lib/signals/store'),
      import('../lib/signals/run'),
      import('../lib/signals/rematch'),
    ]);
    const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    insert = async (rows) => {
      const stored = await insertNewSignals(db, rows.map((s) => ({ ...s, placeSlug: placeSlugFor(s) })), { dedupe: true, log: (m) => console.log(m) });
      const ids = stored.map((r) => r.id).filter((x): x is number => typeof x === 'number');
      if (ids.length && !flag('--no-match')) {
        const r = await rematchSignals(db, ids, { quiet: true, log: (m) => console.log(m) });
        console.log(`  added to feeds quietly: ${r.created}${r.error ? ` (${r.error})` : ''}`);
      }
      return stored.length;
    };
  }

  const report = await runBackfill(
    state,
    { apiKey, dailyBudget: budget, maxRequests },
    { fetch, now: () => new Date(), log: (m) => console.log(m), save: (s) => saveState(file, s), insert },
  );
  console.log(JSON.stringify(report, null, 2));
  console.log(report.stopped === 'finished' ? 'All tasks done.' : `Not finished (${report.stopped}). Run the same command again later; it resumes from ${file}.`);
  return report.stopped === 'error' || report.stopped === 'rate-limit' ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
