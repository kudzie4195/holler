/**
 * Round 33 (SAM): owner-run, one-off, resumable backfill of still-open SAM.gov notices posted in the last 90 days. The logic is in
 * lib/signals/sam-backfill.ts (requests, limits, resume) and lib/signals/sam-backfill-cli.ts (options, switch, dry run, insert). It is NOT
 * run by any cron and was not run against production by the session that wrote it.
 *
 *   npm run sam:backfill -- --plan                       print the plan, make NO request, write nothing (default)
 *   HOLLER_SAM_BACKFILL_ENABLED=1 npm run sam:backfill -- --run --dry     make the requests, write nothing to the database, change no task
 *                                                         (needs the switch and SAM_API_KEY; the requests still count against the daily limit)
 *   HOLLER_SAM_BACKFILL_ENABLED=1 npm run sam:backfill -- --run          store the notices (+ NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *
 * Options (any other option, such as --dry-run or --dryrun, is refused with exit 2 and the list below; nothing is requested or written):
 *   --state <file>         resume file (default ./sam-backfill-state.json, git-ignored). Delete it to start over.
 *   --daily-budget <n>     whole number of requests allowed per UTC day (default 1; the cron already uses up to 6 of a no-role key's 10).
 *                          For a key with a SAM role (1,000/day) use e.g. 150. Above 400 is cut to 400. Anything not a whole number is refused.
 *   --max-requests <n>     whole number; stop this run after n requests, whatever the daily budget
 *   --no-match             store the notices but do not add them to members' feeds (default: added QUIETLY, as feed history with no
 *                          email and no push)
 *
 * The key is read from SAM_API_KEY, never printed, never written to the state file.
 */
import { buildRealInsert, runCli } from '../lib/signals/sam-backfill-cli';

runCli(process.argv.slice(2), {
  env: process.env,
  out: (m) => console.log(m),
  err: (m) => console.error(m),
  now: () => new Date(),
  fetch,
  buildInsert: (o) => buildRealInsert(process.env, o),
}).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
