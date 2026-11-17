-- Holler scheduling with pg_cron + pg_net. NOT a migration: do not put this in supabase/migrations.
-- Run it by hand in the Supabase SQL editor AFTER the site is deployed and migrations 0001 to 0003 are applied.
--
-- Why this exists: it does not depend on the Vercel plan. Supabase calls the three Holler cron routes over HTTPS.
-- Replace the two placeholders in STEP 1 only (<SITE> and <CRON_SECRET>). They are the only values in this file;
-- never commit real ones.
--
-- Shared project note: pg_cron and pg_net may already be enabled for another product. Check
-- Dashboard > Database > Extensions and enable them there if they are off. Holler only adds three jobs, all named holler-*,
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
where jobname in ('holler-scan', 'holler-notify', 'holler-health');

-- ---------------------------------------------------------------------------
-- STEP 3. The three jobs. Each one is an HTTP GET with the header  Authorization: Bearer <CRON_SECRET>
-- to https://<SITE>/api/cron/<name>. Each fires and forgets; the response lands in net._http_response (kept for about 6 hours).
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

-- holler-health: once a day at 13:00 UTC (8 or 9 am US Eastern). Emails the health report to ADMIN_EMAIL (or SUPPORT_EMAIL).
select cron.schedule(
  'holler-health',
  '0 13 * * *',
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

-- ---------------------------------------------------------------------------
-- CHECK that it is working (run these separately, a few minutes after STEP 3).
-- ---------------------------------------------------------------------------
-- The three jobs exist:
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
-- Optionally remove the secrets too:
--   delete from vault.secrets where name in ('holler_site_url', 'holler_cron_secret');
