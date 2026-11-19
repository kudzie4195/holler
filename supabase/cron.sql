-- Holler scheduling with pg_cron + pg_net. NOT a migration: do not put this in supabase/migrations.
-- Run it by hand in the Supabase SQL editor AFTER the site is deployed and migrations 0001 to 0003 are applied. The round 7 jobs
-- (holler-ai, holler-monitor, holler-lifecycle, holler-moat, holler-events-prune) each need their own migration first: 0014, 0018,
-- 0016, 0015 and 0017. The four HTTP ones answer 200 with a "not migrated" note and do nothing until then; holler-events-prune
-- calls a function from 0017 directly and its runs fail (logged in cron.job_run_details, nothing else breaks) until 0017 is applied.
--
-- Why this exists: it does not depend on the Vercel plan. Supabase calls the seven Holler cron routes over HTTPS (eight HTTP jobs:
-- holler-monitor calls the health route with ?monitor=1), and one job (holler-events-prune) runs SQL in the database with no HTTP call.
-- Replace the two placeholders in STEP 1 only (<SITE> and <CRON_SECRET>). They are the only values in this file;
-- never commit real ones.
--
-- Shared project note: pg_cron and pg_net may already be enabled for another product. Check
-- Dashboard > Database > Extensions and enable them there if they are off. Holler only adds nine jobs, all named holler-*,
-- and never touches other jobs.
--
-- Sources (checked against the docs when this was written):
--   net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 2000) returns bigint
--     https://supabase.com/docs/guides/database/extensions/pg_net
--   cron.schedule(job_name, schedule, command), cron.unschedule(job_name or job_id)
--     https://github.com/citusdata/pg_cron
--   vault.create_secret(...) and the vault.decrypted_secrets view
--     https://supabase.com/docs/guides/functions/schedule-functions
--
-- pg_cron schedules are in UTC.

-- ---------------------------------------------------------------------------
-- STEP 1. Store the site URL and the cron secret in Supabase Vault (once).
--
-- Do not paste CRON_SECRET inline into the job commands below: cron.job stores command text in plain view of every
-- database role that can read it. Vault keeps it encrypted at rest and the jobs read it when they fire.
-- Caveat from the Supabase docs: pg_net writes the decrypted value into net.http_request_queue until the request is sent,
-- so any role that can log in to the database can read it for that moment. Treat database logins as trusted.
--
-- To change a value later: Dashboard > Project Settings > Vault, edit the secret. Or delete the row in
-- vault.secrets with that name and run this step again.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'holler_site_url') then
    perform vault.create_secret('https://<SITE>', 'holler_site_url');            -- no trailing slash, for example https://holler.example
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'holler_cron_secret') then
    perform vault.create_secret('<CRON_SECRET>', 'holler_cron_secret');          -- the same value as the CRON_SECRET env var on Vercel
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- STEP 2. Remove any earlier copy of the Holler jobs, so this file can be run again safely.
-- (cron.unschedule raises an error for a name that does not exist, so it only runs for names that do.)
-- ---------------------------------------------------------------------------
select cron.unschedule(jobname)
from cron.job
where jobname in (
  'holler-scan', 'holler-notify', 'holler-health', 'holler-dataforseo',
  'holler-ai', 'holler-monitor', 'holler-lifecycle', 'holler-moat', 'holler-events-prune'
);

-- ---------------------------------------------------------------------------
-- STEP 3. The nine jobs. Eight are an HTTP GET with the header  Authorization: Bearer <CRON_SECRET>
-- to https://<SITE>/api/cron/<name>. Each fires and forgets; the response lands in net._http_response (kept for about 6 hours).
-- holler-events-prune is plain SQL. Minutes in use: scan 0,15,30,45; health 3 (13:03 daily); ai 4; notify 7,22,37,52; monitor 11;
-- lifecycle 17; dataforseo 23 (days 1 to 3); events-prune 29 (Sundays 04:29); moat 41 (18:41 daily). No two jobs start in the
-- same minute.
-- ---------------------------------------------------------------------------

-- holler-scan: every 15 minutes (minute 0, 15, 30, 45). Fetches sources that are due and matches new signals to profiles.
-- timeout 58 s: the route is allowed 60 s and stops its own work at about 50 s.
select cron.schedule(
  'holler-scan',
  '*/15 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'holler_site_url') || '/api/cron/scan',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'holler_cron_secret')
    ),
    timeout_milliseconds := 58000
  );
  $job$
);

-- holler-notify: every 15 minutes, offset by 7 minutes so it does not run at the same moment as the scan.
-- Sends the email digests (at most one per user per hour).
select cron.schedule(
  'holler-notify',
  '7,22,37,52 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'holler_site_url') || '/api/cron/notify',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'holler_cron_secret')
    ),
    timeout_milliseconds := 58000
  );
  $job$
);

-- holler-health: once a day at 13:03 UTC (8 or 9 am US Eastern). Emails the health report to ADMIN_EMAIL (or SUPPORT_EMAIL).
-- Minute 3, so it never starts with the 13:00 scan.
select cron.schedule(
  'holler-health',
  '3 13 * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'holler_site_url') || '/api/cron/health',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'holler_cron_secret')
    ),
    timeout_milliseconds := 58000
  );
  $job$
);

-- holler-dataforseo: 03:23, 09:23, 15:23 and 21:23 UTC on the 1st to 3rd of each month. Monthly keyword volume and AI mention check.
-- One run cannot finish all 40 batches inside 60 s, so it fires four times a day for three days; a run with nothing left to do spends nothing.
-- Needs DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD on Vercel (without them the route answers not_configured and spends nothing).
select cron.schedule(
  'holler-dataforseo',
  '23 3,9,15,21 1-3 * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'holler_site_url') || '/api/cron/dataforseo',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'holler_cron_secret')
    ),
    timeout_milliseconds := 58000
  );
  $job$
);

-- holler-ai: every hour at minute 4, after the :00 scan and before the :07 notify, so new notes reach that digest (migration 0014).
-- Sorts new signals by trade with the AI model and writes the short "why it may matter" notes. Hard monthly cap: AI_MONTHLY_CAP_USD.
-- Stops starting model calls at 45 s; the route is allowed 60 s.
select cron.schedule(
  'holler-ai',
  '4 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'holler_site_url') || '/api/cron/ai',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'holler_cron_secret')
    ),
    timeout_milliseconds := 58000
  );
  $job$
);

-- holler-monitor: every hour at minute 11 (scan runs at 0,15,30,45, notify at 7,22,37,52, dataforseo at :23). Emails the owner only when
-- ingest is broken, at most once per problem per 24 hours. Needs migration 0018; until then it answers "monitor table missing" and sends nothing.
select cron.schedule(
  'holler-monitor',
  '11 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'holler_site_url') || '/api/cron/health?monitor=1',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'holler_cron_secret')
    ),
    timeout_milliseconds := 58000
  );
  $job$
);

-- holler-lifecycle: hourly at :17. Welcome, trial-ending and trial-ended emails (lib/lifecycle, migration 0016). At most 200 members per
-- run; ?dry=1 lists without sending.
select cron.schedule(
  'holler-lifecycle',
  '17 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'holler_site_url') || '/api/cron/lifecycle',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'holler_cron_secret')
    ),
    timeout_milliseconds := 58000
  );
  $job$
);

-- holler-moat: once a day at 18:41 UTC (1 or 2 pm US Eastern). Sends the "did you get work from this?" follow-up (at most one email per
-- member per week; migration 0015).
select cron.schedule(
  'holler-moat',
  '41 18 * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'holler_site_url') || '/api/cron/moat',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'holler_cron_secret')
    ),
    timeout_milliseconds := 58000
  );
  $job$
);

-- holler-events-prune: Sundays at 04:29 UTC. Deletes funnel events older than 400 days (migration 0017). Plain SQL, no HTTP call.
-- (Minute 29, not 17: holler-lifecycle runs at minute 17 every hour.)
select cron.schedule('holler-events-prune', '29 4 * * 0', $job$ select public.holler_events_prune(400); $job$);

-- ---------------------------------------------------------------------------
-- CHECK that it is working (run these separately, a few minutes after STEP 3).
-- ---------------------------------------------------------------------------
-- The nine jobs exist:
--   select jobid, jobname, schedule, active from cron.job where jobname like 'holler-%' order by jobname;
-- Did they fire, and did Postgres succeed in handing the request to pg_net:
--   select jobname, status, return_message, start_time
--   from cron.job_run_details d join cron.job j using (jobid)
--   where j.jobname like 'holler-%' order by start_time desc limit 10;
-- What the site answered (200 = good, 401 = wrong secret in Vault, 5xx = check the Vercel logs):
--   select * from net._http_response order by id desc limit 10;

-- ---------------------------------------------------------------------------
-- UNSCHEDULE (run on its own to stop Holler's jobs; for example during an incident or rollback).
-- ---------------------------------------------------------------------------
--   select cron.unschedule('holler-scan');
--   select cron.unschedule('holler-notify');
--   select cron.unschedule('holler-health');
--   select cron.unschedule('holler-dataforseo');
--   select cron.unschedule('holler-ai');
--   select cron.unschedule('holler-monitor');
--   select cron.unschedule('holler-lifecycle');
--   select cron.unschedule('holler-moat');
--   select cron.unschedule('holler-events-prune');
-- Optionally remove the secrets too:
--   delete from vault.secrets where name in ('holler_site_url', 'holler_cron_secret');
