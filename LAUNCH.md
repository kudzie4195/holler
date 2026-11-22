# Holler launch day

Do the steps in order. Tick each box. If a step fails, stop and fix it before the next one.
Anything in `<ANGLE_BRACKETS>` is yours to fill in. Never paste real secrets into a file in this repo.

Time needed: about 90 minutes, plus DNS waiting time. Do step 2 first thing so the waiting happens while you do the rest.

## 0. Before you start

- [ ] You have: the Supabase project (shared with the other product), a Vercel project, a Stripe account, a Resend account, and a domain.
- [ ] `<SITE>` below means the final https address, for example `https://holler.example`. No trailing slash.
- [ ] Generate the cron secret once and keep it in your password manager: `openssl rand -hex 32`. Call it `<CRON_SECRET>`. Do not rotate it later: it also signs unsubscribe and email-verify links and the close link in every resident-request email, so rotating breaks every link already emailed. After a rotation, a resident cannot close an open request from an older email, and the owner's remove links stop working too. The request still ends by itself after 14 days. To end one by hand: `update holler_requests set status='closed', closed_at=now(), email=null, description=null, public_summary=null where public_id='<req_...>';` (the next scan cron run deletes its public record).

## 1. Apply the database migrations (Supabase SQL editor, in this order, each file once)

**Round 5 order (0006 to 0008)**

1. Run 0006 and 0008 (any time).
2. Deploy the code.
3. Run 0007.
4. Run the two check queries and expire the page cache.

**Round 6 order**

1. Run 0009, 0010, 0011 and 0012, in that order (any time, before or after the deploy; 0012 needs 0009 first, the others are safe to run first). If 0009 is already applied, run only the ones you have not run.
2. Deploy the code.
3. Add the DataForSEO cron job (step 7: run `supabase/cron.sql` again, or add the `holler-dataforseo` job on its own).

**Round 7 order**

1. BEFORE the deploy: run 0015 and 0019 (each is safe with the old code too).
   - 0015 first. The new prune archives a coarse copy, then deletes. Without 0015 it falls back to a plain delete, so the next daily prune after the deploy would delete 120-day-old rows with no archive copy.
   - 0019. Without it, new signups get the database default of 7 days while every page and email says 14.
2. Any time, before or after the deploy, in number order: 0013, 0014, 0016, 0017, 0018. With none of them applied the site works as before: the AI notes, lifecycle emails, funnel counts, outcome follow-up and ingest monitor each answer "not migrated" (or stay quiet) and do nothing, and the feed shows no AI line.
   - 0013 deletes nothing and changes no schema. It prints that 0 rows were removed and how many same-place, same-day rows under different ids are kept as separate records. It is safe to run again.
3. Deploy the code.
4. Set `AI_MONTHLY_CAP_USD` if you want a cap other than 10 (step 3), then redeploy.
5. Run `supabase/cron.sql` again (step 7). It adds `holler-ai`, `holler-monitor`, `holler-lifecycle`, `holler-moat` and `holler-events-prune`, and keeps the four existing jobs.
6. Run the round 7 dry-run checks (step 7) and the owner report queries below once there is data.
7. Run 0020 (mobile: push tokens and store billing) after 0019, any time before or after the deploy. It is safe before the code ships. Until it is applied, push sends nothing and the RevenueCat webhook answers 500, so RevenueCat tries again later. The rest of the mobile setup (Firebase, RevenueCat, two env keys) waits for the app release: see "Mobile app" below.

**Round 16 order (already live)**

1. Run 0021, 0022 and 0023, in that order (each is safe before or after the deploy). Run the 0023 check query: it must return no rows.
2. Deploy the code. Leave `HOLLER_LOCAL_BIDS_ENABLED` empty.
3. Check the security pass: `curl -sI <SITE>/login` shows `X-Frame-Options: DENY` and `Content-Security-Policy`. Then request `<SITE>/api/admin/sources` with the secret as a query-string parameter named `key` (not the header): it must print 401 (`curl -s -o /dev/null -w '%{http_code}' "<SITE>/api/admin/sources"` with that parameter added). The same URL with no query string and with `-H "Authorization: Bearer <CRON_SECRET>"` prints 200.
4. Probe each agency source once: `curl -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/firecrawl-probe?source=bids-gwinnett"`, then `bids-rockdale`, `bids-tucker`, `bids-dunwoody` (about 5 credits each, 20 in all, inside the 25-a-day probe cap). Expect `ok: true`, kept rows with future due dates and links on the agency's own site, and a robots note.
5. Only if the probes look right: set `HOLLER_BIDS_ENABLED` and `HOLLER_LOCAL_BIDS_ENABLED` to `1` in Vercel (Production) and redeploy (env changes apply to new deployments only).
6. Next morning: the health email's "Firecrawl (agency bid pages)" block starts with "On:", and the credits used are within the caps.

**Round 17 order**

1. Apply migration 0024 (`0024_holler_language.sql`) AT OR BEFORE THE DEPLOY, never after it. Reason: the new `/es` page goes live with the deploy and tells Spanish readers to pick Español in Settings, but the Settings language control stays hidden until 0024 exists, so a deploy without 0024 sends them to a control they cannot find. Then apply 0025 (`0025_holler_permit_stages.sql`). Both are in the `supabase/migrations` folder, in that order. The code does not break with either one missing: with 0024 missing the Settings language control is hidden and every email, card and push stays in English (only the `/es` promise is wrong); with 0025 missing the scan runs as before (no stage updates, no linking of repeated permits), and 0025 is safe before or after the deploy. Checks: `select language, count(*) from holler_profiles group by 1;` returns one row, `en`; `select count(*) from holler_permit_stages;` and `select count(*) from holler_dedupe_drops;` both run with no error (0 rows at first).
2. Deploy the code. Leave `HOLLER_STAGE_UPDATES_ENABLED` empty. Nothing else is needed for the AI part: the hourly AI step already runs; its new limits default to 200 a run and 1500 a day (see `AI_MAX_SIGNALS_PER_RUN` and `AI_MAX_SIGNALS_PER_DAY` in step 3).
3. Dry-check every source's stage query once. Each call makes one request to one city portal, writes nothing and costs nothing. Leave `source` out to list the source ids that have a stage query (HTTP 400 with `knownSources`; they are `socrata-chicago-permits`, `socrata-sf-permits`, `socrata-nola-permits`, `socrata-cambridge-permits`, `socrata-norfolk-permits` and `socrata-montgomery-permits` today):
   ```
   curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/stage-probe"
   curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/stage-probe?source=socrata-sf-permits"
   curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/stage-probe?source=socrata-chicago-permits"
   curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/stage-probe?source=socrata-nola-permits"
   curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/stage-probe?source=socrata-cambridge-permits"
   curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/stage-probe?source=socrata-norfolk-permits"
   curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/stage-probe?source=socrata-montgomery-permits"
   ```
   For each source expect `dateColumnAccepted: true`, a `rowCount` above 0 on a normal week, `sampleStatuses` that read like permit statuses (final, finaled, certificate of occupancy) and `wroteNothing: true`. A source where `dateColumnAccepted` is false, `state` is `rejected` or `failed`, or the statuses look wrong keeps its stage query unused: do not count it as checked.
4. Only when every source you want has passed its dry check, set `HOLLER_STAGE_UPDATES_ENABLED` to `1` in Vercel (Production) and redeploy (env changes apply to new deployments only). Until then it stays empty: no second query to the portals, no stage update card, email or push. Rollback: empty it and redeploy.
5. Next morning, read the health email (`/api/cron/health`, or the daily mail to `ADMIN_EMAIL`):
   - The status line should stay `ok`. A stage-query problem never changes it.
   - Look in the "Watch" block for lines that start with a source id and then `stage query:`, for example `socrata-sf-permits: stage query: date column status_date not accepted (code 400)`, `no usable answer` or `full page, newest changes only`. One line per source per day means that source's stage query is not working; the source's normal permits still arrive. Fix or leave it off; it is not an outage.
   - The "Needs attention" and source-state blocks should look the same as the day before. A `stage query:` note must never appear there. If it does, that is a bug to report.
   - Quality page, `<SITE>/api/admin/quality?format=html` with the Bearer secret: the AI coverage line near the top shows the share of new permit and civic rows classified in the last 24 hours (blank or "unavailable" is not 0%), and the "Duplicate listings per source" table replaces "Not recorded" once 0025 is applied. The AI step's own answer is `<SITE>/api/cron/ai` (`limits.usedToday`, `reason`, `poisonSkipped`).
6. Spanish: in Settings, switch a test account to Español and trigger the digest by hand; the email, the cards and a stage-update push for that member read in Spanish. English members are unchanged.

- [ ] Run `supabase/migrations/0001_holler.sql`
- [ ] Run `supabase/migrations/0002_holler_hardening.sql`
- [ ] Run `supabase/migrations/0003_holler_ops.sql`
- [ ] Run `supabase/migrations/0004_holler_plans.sql` (Solo, internal id `starter`, and Pro: `plan`, `extra_areas`, `keywords` on `holler_profiles`, and the plan-limits trigger)
- [ ] Run `supabase/migrations/0005_holler_requests.sql` (resident requests: `holler_requests`, `holler_request_replies`, the reply guard with the 5-per-request and 10-per-business-per-day caps, a check that keeps free text off the public request record, and a trigger that deletes a business's reply records when its profile is deleted)
- [ ] Run `supabase/migrations/0006_holler_contacts.sql` (who to contact: `holler_signal_contacts`, service role only; safe to run before or after the code deploy). Contacts cannot be backfilled for records already stored: they appear from the first scan after the deploy.
- [ ] Run `supabase/migrations/0007_holler_public_name_scrub.sql` (data fix: removes establishment names and street addresses from stored failed-inspection signals and the "Awarded to" recipient from stored federal contract summaries; run it right after the code deploy so new scans stop writing that text. It is safe to re-run at any time, also after scans have resumed. A re-run clears the summary of new inspection rows and shortens a new federal award title that has a trade label but no NAICS code to "federal award"; nothing personal is involved either way. Run it once after the deploy)
- [ ] Run `supabase/migrations/0008_holler_feature_interest.sql` (the "Coming next" list: `holler_feature_interest`, service role only, no visitor identifier stored; safe to run before or after the code deploy, and the buttons show "Could not save that. Try again later." until it is applied)
- [ ] Run `supabase/migrations/0009_holler_signal_feedback.sql` (member feedback on alerts: `holler_signal_feedback`; members read and write only their own rows for alerts they were sent, no delete, no anon; safe to run before or after the code deploy: until it is applied the feedback buttons show "That didn't save. Try again." and no saved answers appear). Rollback: `drop table if exists public.holler_signal_feedback; drop function if exists public.holler_profiles_delete_feedback() cascade;` (redeploy the previous code first, or the buttons show the soft error).
- [ ] Run `supabase/migrations/0010_holler_source_health.sql` (one internal table, `holler_source_health`, service role only; safe to run twice and safe to run before or after the code deploy: until it is applied the health write and read fail quietly). Then run `curl -H "Authorization: Bearer <CRON_SECRET>" <SITE>/api/admin/sources` and expect JSON with a `sources` list (empty until the next scan tick).
- [ ] Run `supabase/migrations/0011_holler_dataforseo.sql` (creates `holler_keyword_volume`, `holler_llm_mentions` and `holler_dataforseo_spend`, all service role only; safe to run twice and before or after the deploy).
- [ ] Run `supabase/migrations/0012_holler_feedback_grants.sql` AFTER 0009 (follow-up to 0009, which is already applied and not edited: members may now write only `user_id`, `signal_id`, `verdict` and `job_value_usd`, so they cannot set `created_at` or `updated_at`; privileges only, safe to run twice, safe before or after the code deploy because the app writes only those four columns). Check: `select grantee, privilege_type, column_name from information_schema.column_privileges where table_name = 'holler_signal_feedback' and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE') order by 2, 3;` returns 8 rows (four columns for each) and no `created_at`. Rollback: `grant insert, update on table public.holler_signal_feedback to authenticated;`
- [ ] Run `supabase/migrations/0013_holler_signal_dedupe.sql`: no-delete; prints that 0 rows were removed and how many same-place same-day rows under different ids are kept as separate records; safe to re-run. It changes no row, table or index. Any time, before or after the deploy.
- [ ] Run `supabase/migrations/0014_holler_ai.sql` (AI step: `holler_signal_ai`, `holler_ai_cache`, `holler_ai_spend` with its `day` column (the "model has no price" alert goes out at most once a day) and the `draft` kind for reply drafts, the function `holler_ai_apply`, and the month-spend function `holler_ai_month_spend` that sums the month in SQL, all service role only; safe to run twice and before or after the deploy: until it is applied `/api/cron/ai` answers `not_migrated` and spends nothing, and the feed and digest show no AI line). Check: `select count(*) from holler_ai_spend;` returns 0 or more with no error.
- [ ] Run `supabase/migrations/0015_holler_moat.sql` BEFORE the code deploy (coarse archive `holler_signal_archive` with no title, summary, link, street address, coordinates or free text; `holler_prune_signals` archives then deletes in one transaction; `holler_outcome_asks`, `holler_alert_log`, the view `holler_conversion_by_source` with the columns window_days, source, kind, intent, trade, alerts, emailed, answered, useful, not_relevant, led_to_work and total_job_value_usd and no member identity (dropped and re-created on each run, so a re-run picks up the column list); a delete-account trigger; and a one-time archive of every current row). Safe to run twice; re-running archives nothing new. If the code ships first, the daily prune deletes 120-day-old rows without an archive copy until 0015 runs. Check after the first scan past 120 days: `select count(*) from holler_signal_archive;` is above 0 and no `_prune` row in `holler_scan_runs` has an error.
- [ ] Run `supabase/migrations/0016_holler_lifecycle.sql` (`holler_lifecycle_sends`: one row per member and email kind, plus `optout` rows for the lifecycle unsubscribe; service role only; a delete-account trigger; safe to run twice and before or after the deploy: until it is applied `/api/cron/lifecycle` answers `skipped: not_migrated` and sends nothing).
- [ ] Run `supabase/migrations/0017_holler_analytics.sql` (creates holler_events and holler_attribution, service role only, plus holler_events_prune and a delete-account trigger; safe to run twice and before or after the deploy; the app ignores a missing table). Check: select count(*) from holler_events; returns 0 rows or more with no error, and as the anon key the same query is denied.
- [ ] Run `supabase/migrations/0018_holler_ops_alerts.sql` (internal table holler_ops_alerts, service role only, plus three columns on holler_source_health; safe to run twice and safe before or after the code deploy: until it is applied the monitor answers "monitor table missing" and emails nothing).
- [ ] Run `supabase/migrations/0019_holler_trial_14.sql` (free trial 14 days: column default, the 0003 stamp trigger and the 0004 billing guard set to 14 days, and running trials of members with no subscription extended to their trial start + 14 days. It extends running trials only: a trial that already ended stays ended. One trial per person is kept, and the billing guard also stops a member from changing `created_at`. Run it BEFORE or together with the code deploy, or new signups get 7 days while the site says 14. Safe to run twice. If 0004 is ever re-run, re-run 0019 right after it, or member sign-ups are refused by the 7-day guard. Check: `select pg_get_expr(adbin, adrelid) from pg_attrdef a join pg_attribute t on t.attrelid=a.adrelid and t.attnum=a.adnum where t.attrelid='public.holler_profiles'::regclass and t.attname='trial_ends_at';` shows `(now() + '14 days'::interval)`.)
- [ ] Run `supabase/migrations/0020_holler_mobile.sql` after 0019 (mobile app: `holler_push_tokens` and `holler_billing_events`, both service role only; on `holler_profiles` the columns `plan_source`, `store_product_id`, `store_expires_at`, `store_env`, `last_pushed_at`, which only the server can write, and `push_alerts`, which members can switch; the function `holler_apply_store_event` for the service role only; `holler_billing_shadow` (what the billing source that is not live last said, so a member who pays in two places moves to the other source when one ends instead of being locked; service role only) with the internal function `holler_billing_fallback`; `holler_stripe_state`, which the Stripe webhook calls (service role only); a trigger that applies the Solo limits to a Pro row whose App Store or Google Play plan has lapsed; a delete-account trigger that removes push tokens, and `holler_matches.pushed_at` (which matches were counted in a delivered push; server only; when the column is first added, every match already there is marked as pushed, so no old match is ever pushed). Safe to run twice. Safe before the code ships. Check: `select count(*) from holler_push_tokens;` returns 0 or more with no error, and as the anon key the same query is denied.)
- [ ] Run `supabase/migrations/0021_holler_area_waitlist.sql` (the "Coming to your area" waitlist on /check: `holler_area_waitlist`, one row per email and ZIP, service role only, no IP or visitor id stored; safe to run twice and safe before or after the code deploy: until it is applied the card answers "Could not save that. Try again later."). Check: `select count(*) from holler_area_waitlist;` returns 0 or more with no error. Rollback: `drop table if exists public.holler_area_waitlist;` (redeploy the previous code first, or the card shows the soft error).
- [ ] Run `supabase/migrations/0022_holler_contact_license.sql` (adds the nullable `license` column to `holler_signal_contacts`: the contractor licence number a permit publishes, for example Raleigh and NYC; RLS and grants are unchanged, service role only; safe to run twice and safe before or after the code deploy: until it is applied the scan writes contacts without licence numbers and the feed reads them without). Check: `select count(license) from holler_signal_contacts;` returns a number with no error. Rollback: `alter table public.holler_signal_contacts drop column if exists license;`.
- [ ] Run `supabase/migrations/0023_holler_grant_hygiene.sql` (security pass r16: revokes the TRUNCATE, TRIGGER and REFERENCES privileges that anon and authenticated still hold on holler_matches, holler_profiles, holler_scan_runs and holler_signals, DELETE on holler_profiles, every write on the holler_place_counts view, anon SELECT on holler_matches, anon and authenticated SELECT on holler_scan_runs (RLS already returned nothing to them; every reader runs as service_role), and EXECUTE on the trigger function holler_set_updated_at; revokes only, nothing created, dropped or rewritten; safe to run twice and safe before or after the code deploy). Check: `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name like 'holler\_%' and grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','DELETE','INSERT','UPDATE');` returns no rows. Rollback: not needed (the app never used these privileges).
- [ ] Run `supabase/migrations/0024_holler_language.sql` (round 17, Spanish: adds `holler_profiles.language` ('en' or 'es', default 'en', check constraint) and lets a member write their own language; additive and idempotent). Apply it AT OR BEFORE the round 17 deploy: `/es` tells readers to pick Español in Settings, and that control stays hidden until 0024 exists. With it NOT applied the Settings language control is hidden and every alert email, card and draft stays in English. Check: `select language, count(*) from holler_profiles group by 1;` returns one row, 'en'. Rollback: not needed (the app reads the column only when it exists).
- [ ] Run `supabase/migrations/0025_holler_permit_stages.sql` (round 17, optional, safe before or after the code deploy: three new service-role-only tables, holler_permit_stages, holler_project_links and holler_dedupe_drops; it creates nothing else and touches no stored row; safe to run twice). Until it is applied the scan runs exactly as before: no construction stage updates, no second (stage) query to the permit portals, and records that are the same project are not linked (every permit still gets its own card as before). After it, two permit numbers at one address are both stored, the later one is marked as another listing of the first and makes no second card, and the status history of every permit the normal scan sees is recorded. Construction stage updates stay OFF until the owner sets `HOLLER_STAGE_UPDATES_ENABLED=1` (see the next item): with it off there is no second (stage) query to the permit portals and no update card, email or push. Once on, a permit that already has a row in the status history and then reaches final inspection, finished or certificate of occupancy sends ONE update: members who already hold the card get it re-sent once as a "Stage update" email and push; a permit the history has never seen creates nothing (no card, no history row, no alert). At most 5 stage updates per member per day, counted inside the usual 25 per member. A portal that refuses the stage query shows as one `stage query:` line per source in `holler_scan_runs.error` and in the health email's Watch list (it is not a source failure). Check: `select count(*) from holler_permit_stages;` and `select count(*) from holler_dedupe_drops;` both run (0 rows at first). After it, the quality dashboard (`/api/admin/quality?format=html`) shows a "Duplicate listings per source" table instead of "Not recorded". Rollback: `drop table holler_permit_stages, holler_project_links, holler_dedupe_drops;` (the code then falls back to the old behaviour).
- [ ] Run `supabase/migrations/0026_holler_business_lookup.sql` (round 18, optional, safe before or after the code deploy and safe to run twice: one new service-role-only table, `holler_business_lookup`, the cache of business listing lookups; it touches no other object). Until it is applied the business phone and website lookup is OFF: the alert run makes no DataForSEO lookup call and every card and email is exactly as before. After it, the alert run looks up the business a card names (contractor, business or awardee, only a name the business classifier accepts, never a person, never a placeholder or generic name) when the record has no phone or website, where the record says the business is (its own ZIP, else the job city), and shows "Phone:" and "Website:" from the business's public listing under the name on the card and in the email. Found answers are reused for 90 days, not found for 30, a timed-out call is not repeated for 6 hours. Check: `select status, count(*) from holler_business_lookup group by 1;` runs with no error (0 rows at first). Rollback: `drop table holler_business_lookup;` (the lookup turns off again and cards go back to what they showed before).
- [ ] Check right after running 0007, both must return 0: `select count(*) from holler_signals where right(source,12)='-inspections' and (summary is not null or title not like '%: food establishment');` and `select count(*) from holler_signals where source='usaspending' and summary like 'Awarded to %';`
- [ ] After 0007, redeploy or expire the page cache: public pages are cached for up to 48 hours, so old names can stay visible until then.
- [ ] Owner check after the feedback migration: run this report in the Supabase SQL editor (read only, last 30 days). Keep its intent mapping in step with `lib/signals/intent.ts` (`intentOf`).

```sql
-- Holler feedback report, last 30 days. Run in the Supabase SQL editor (service role / postgres). Read only.
-- Intent mapping mirrors lib/signals/intent.ts intentOf (keep the two in step).
-- alerts_sent counts match rows created in the window (one per member per alert in the feed). marked_notified is the subset with
-- notified = true; the notify cron also sets it for members it skips, so it is an upper bound on emails, not an exact email count.
-- Feedback is counted by when the member last answered (updated_at). A member's one answer per alert is counted once.
with sig as (
  select s.id, s.source,
         case
           when s.kind = 'ask' or s.source in ('holler-request', 'bluesky', 'websearch-brave', 'websearch-serper') then 'asking'
           when s.data->>'subtype' in ('permit', 'business', 'event-permit') then 'spending'
           when s.data->>'subtype' in ('311', 'violation', 'inspection') then 'demand'
           when s.kind in ('permit', 'contract') then 'spending'
           else 'demand'
         end as intent
  from public.holler_signals s
  where s.id in (
    select signal_id from public.holler_matches where created_at >= now() - interval '30 days'
    union
    select signal_id from public.holler_signal_feedback where updated_at >= now() - interval '30 days'
  )
),
sent as (
  select sig.source, sig.intent,
         count(*) as alerts_sent,
         count(*) filter (where m.notified) as marked_notified
  from public.holler_matches m
  join sig on sig.id = m.signal_id
  where m.created_at >= now() - interval '30 days'
  group by sig.source, sig.intent
),
fb as (
  select sig.source, sig.intent,
         count(*) filter (where f.verdict = 'useful') as useful,
         count(*) filter (where f.verdict = 'not_relevant') as not_relevant,
         count(*) filter (where f.verdict = 'led_to_work') as led_to_work,
         count(*) filter (where f.verdict = 'led_to_work' and f.job_value_usd is not null) as led_to_work_with_value,
         coalesce(sum(f.job_value_usd) filter (where f.verdict = 'led_to_work'), 0) as job_value_usd
  from public.holler_signal_feedback f
  join sig on sig.id = f.signal_id
  where f.updated_at >= now() - interval '30 days'
  group by sig.source, sig.intent
)
select source,
       intent,
       coalesce(sent.alerts_sent, 0) as alerts_sent,
       coalesce(sent.marked_notified, 0) as marked_notified,
       coalesce(fb.useful, 0) as useful,
       coalesce(fb.not_relevant, 0) as not_relevant,
       coalesce(fb.led_to_work, 0) as led_to_work,
       coalesce(fb.led_to_work_with_value, 0) as led_to_work_with_value,
       coalesce(fb.job_value_usd, 0) as job_value_usd
from sent
full join fb using (source, intent)
order by intent, alerts_sent desc nulls last, source;

-- Same numbers, one row per intent plus a total row.
-- (paste the first query's CTEs above this select to run it on its own)
--   select coalesce(intent, 'ALL') as intent, sum(alerts_sent) as alerts_sent, sum(useful) as useful, sum(not_relevant) as not_relevant,
--          sum(led_to_work) as led_to_work, sum(job_value_usd) as job_value_usd
--   from (<first query>) t group by rollup (intent) order by intent nulls last;
```

- [ ] Owner check for source health (read only): `select source, status, consecutive_failures, last_success_at, last_record_at, last_error from public.holler_source_health where status <> 'healthy' order by status, source;`

**Round 7 owner reports** (Supabase SQL editor, service role, all read only; each needs its migration first)

- [ ] Funnel by source (0017): visits, area checks, signups, first alerts, trials and paid, last 7 and 30 days, plus paid members and campaigns by first-touch source. People are counted once per step; `direct` means no source tag was recorded.

```sql
-- Holler funnel report. Run in the Supabase SQL editor (service role). Read only.

-- 1. Funnel counts and step conversion by source, last 7 and last 30 days.
--    People are counted once per step: a visitor by session id, a member by user id. A step is counted in the window where it happened,
--    so a signup this week from a visit last week counts under signups. Source is the first-touch source ('direct' = none recorded).
with windows(days) as (values (7), (30)),
ev as (
  select e.name,
         e.created_at,
         coalesce(e.user_id::text, e.session_id) as who,
         coalesce(e.source, a.source, 'direct') as source
  from public.holler_events e
  left join public.holler_attribution a on a.user_id = e.user_id
  where e.created_at >= now() - interval '30 days'
    and coalesce(e.user_id::text, e.session_id) is not null
),
counts as (
  select w.days, ev.source,
         count(distinct who) filter (where name in ('visit', 'app_open')) as visits,
         count(distinct who) filter (where name = 'area_check')           as area_checks,
         count(distinct who) filter (where name = 'signup')               as signups,
         count(distinct who) filter (where name = 'first_alert')          as first_alerts,
         count(distinct who) filter (where name = 'trial_start')          as trials,
         count(distinct who) filter (where name = 'paid')                 as paid
  from windows w
  join ev on ev.created_at >= now() - make_interval(days => w.days)
  group by w.days, ev.source
)
select days, source, visits, area_checks, signups, first_alerts, trials, paid,
       round(100.0 * area_checks / nullif(visits, 0), 1)       as pct_visit_to_check,
       round(100.0 * signups / nullif(visits, 0), 1)           as pct_visit_to_signup,
       round(100.0 * first_alerts / nullif(signups, 0), 1)     as pct_signup_to_first_alert,
       round(100.0 * trials / nullif(signups, 0), 1)           as pct_signup_to_trial,
       round(100.0 * paid / nullif(trials, 0), 1)              as pct_trial_to_paid
from counts
order by days, visits desc, source;

-- 2. Paid members by signup source (first touch). Two views: members paying now, and members whose first payment landed in the last 30 days.
select coalesce(a.source, 'direct') as signup_source,
       coalesce(a.medium, '')       as signup_medium,
       count(*) filter (where p.subscription_status in ('active', 'past_due')) as paying_now,
       count(*) filter (where pe.created_at >= now() - interval '30 days')     as first_paid_last_30d
from public.holler_profiles p
left join public.holler_attribution a on a.user_id = p.user_id
left join public.holler_events pe on pe.user_id = p.user_id and pe.name = 'paid'
where p.subscription_status in ('active', 'past_due') or pe.user_id is not null
group by 1, 2
order by paying_now desc, signup_source;

-- 3. Campaigns behind the sources (last 30 days, members who signed up).
select coalesce(source, 'direct') as source, coalesce(campaign, '') as campaign, count(*) as signups
from public.holler_events
where name = 'signup' and created_at >= now() - interval '30 days'
group by 1, 2
order by signups desc;
```

- [ ] Alerts that led to work, by source, kind, intent and trade (0015). One answer per member per alert. `emailed` counts alerts that went out in an alert email, `answered` counts any verdict, `useful` counts useful or led to work (so it never shrinks when a follow-up answer turns useful into led to work), and `led_to_work` is the subset that led to work. Export it before 120 days if you want a longer history; trend counts by area live on in `holler_signal_archive`, for example `select state, county, date_trunc('week', occurred_on) w, count(*) from holler_signal_archive group by 1,2,3;`.

```sql
select window_days, source, kind, intent, trade, alerts, emailed, answered, useful, not_relevant, led_to_work, total_job_value_usd,
       round(100.0 * answered / nullif(alerts, 0), 1) as answered_pct,
       round(100.0 * led_to_work / nullif(alerts, 0), 1) as led_to_work_pct
from public.holler_conversion_by_source
order by window_days, led_to_work desc, alerts desc;
```

- [ ] AI spend (0014). Before launch, estimate the month from production data: Q3 gives the skipped share S, Q2 a lower bound on the cache-hit share H, and the expected month is `rows_24h * 30.4 * (1 - skipped_share) * (1 - hit_share_one_day) * 0.000068` dollars. If that is above the cap (`AI_MONTHLY_CAP_USD`, default 10), the step pauses near the end of the month and one email goes to `ADMIN_EMAIL`; alerts keep going out. After launch, Q4 shows the real split and cost per 1,000 signals.

```sql
-- Q3. Share of signals from the skipped sources, last 24 hours.
select count(*) as rows_24h,
       count(*) filter (where source in ('nws', 'spc', 'fema', 'usgs', 'faa')) as skipped_rows,
       round(avg((source in ('nws', 'spc', 'fema', 'usgs', 'faa'))::int), 3) as skipped_share
from public.holler_signals
where created_at >= now() - interval '24 hours';

-- Q2. Closer to the real cache key: source, kind, subtype, and title and summary with ZIP codes, street addresses and digits removed,
-- case and spaces normalized (a SQL approximation of lib/ai/classify.ts normalizeForKey).
with s as (
  select source, kind, coalesce(data->>'subtype', '') as subtype, lower(title) as t0, lower(coalesce(summary, '')) as m0
  from public.holler_signals
  where created_at >= now() - interval '24 hours'
    and source not in ('nws', 'spc', 'fema', 'usgs', 'faa')
), n as (
  select source, kind, subtype,
    btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(t0,
      '\m\d{5}(-\d{4})?\M', ' ', 'g'),
      '\m\d+[a-z]{0,2}\s+((n|s|e|w|ne|nw|se|sw|north|south|east|west)\.?\s+)?([a-z0-9''.-]+\s+){0,4}(st|street|ave|av|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|pl|place|way|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|trl|trail)\M', ' ', 'g'),
      '[^a-z]+', ' ', 'g'), '\s+', ' ', 'g')) as t,
    btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(m0,
      '\m\d{5}(-\d{4})?\M', ' ', 'g'),
      '\m\d+[a-z]{0,2}\s+((n|s|e|w|ne|nw|se|sw|north|south|east|west)\.?\s+)?([a-z0-9''.-]+\s+){0,4}(st|street|ave|av|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|pl|place|way|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|trl|trail)\M', ' ', 'g'),
      '[^a-z]+', ' ', 'g'), '\s+', ' ', 'g')) as m
  from s
)
select count(*) as rows_24h,
       count(distinct (source, kind, subtype, t, m)) as distinct_keys,
       round(1 - count(distinct (source, kind, subtype, t, m))::numeric / nullif(count(*), 0), 3) as hit_share_one_day
from n;

-- Q4. After launch: the real volume split and effective cost per 1,000 signals, per month.
select month,
       sum(signals) filter (where kind = 'run') as signals_written,
       sum(skipped) filter (where kind = 'run') as skipped,
       sum(cache_hits) filter (where kind = 'run') as cache_hits,
       sum(cache_misses) filter (where kind = 'run') as model_classified,
       round(sum(cost_usd), 4) as cost_usd,
       round(sum(cost_usd) * 1000 / nullif(sum(signals) filter (where kind = 'run'), 0), 5) as usd_per_1k_effective
from public.holler_ai_spend
group by month
order by month desc;
```

- [ ] Matching check for the owner account (round 7 re-map): run it after the deploy and after the next scan has run the re-map. Row 1 `a` is the account's roofing-tagged matches and `b` all its matches. Category rows: `a` is the 14-day count and `b` the all-stored count inside the radius. After the re-map the `cleaning` row is absent and roofing is absent or 0 unless a re-roof permit or a hail, wind or tornado report landed inside 25 miles. The re-map covers the last 14 days only, so `b` of the old-mapping row can stay above 0 until those rows age out.

```sql
with p as (
  select user_id, lat, lon, coalesce(radius_mi, 25)::float8 as r
  from public.holler_profiles
  where zip = '30080' and 'roofing' = any(categories)
  order by created_at
  limit 1
),
near as (
  select s.id, s.categories, s.occurred_at, s.data
  from public.holler_signals s, p
  where s.lat is not null
    and 3958.76 * 2 * asin(sqrt(power(sin(radians(s.lat - p.lat) / 2), 2)
        + cos(radians(p.lat)) * cos(radians(s.lat)) * power(sin(radians(s.lon - p.lon) / 2), 2))) <= p.r
)
select 'MATCHES smyrna roofing account: a = roofing-tagged, b = all' as metric,
       (select count(*) from public.holler_matches m join p on m.user_id = p.user_id
          join public.holler_signals s on s.id = m.signal_id where 'roofing' = any(s.categories)) as a,
       (select count(*) from public.holler_matches m join p on m.user_id = p.user_id) as b
union all
select 'category ' || c || ' inside radius: a = last 14 days, b = all stored', count(*) filter (where occurred_at >= now() - interval '14 days'), count(*)
from near, unnest(categories) as c
group by c
union all
select 'old mapping (permit/violation, no cat_v) inside radius: a = 14 days, b = all',
       count(*) filter (where occurred_at >= now() - interval '14 days'), count(*)
from near where data->>'cat_v' is null and data->>'subtype' in ('permit', 'violation')
order by 1;
```

- [ ] Check: `select * from holler_place_counts limit 1;` returns without error and the columns are `place_slug, signals_60d, latest_at`.
- [ ] Check: `select count(*) from holler_scan_runs;` returns 0 (no error).
- [ ] Check: `select plan, extra_areas, keywords from holler_profiles limit 1;` and `select count(*) from holler_requests;` both return without error.

Every object is named `holler_*`. Nothing else in the shared project is touched. 0001 to 0006 and 0008 to 0025 are additive and safe to run again (0013 only prints counts and changes nothing); 0007 is a data fix that is safe to re-run at any time (each statement only rewrites rows that still hold the old text). If you ever re-run one of the additive files, run 0001 to 0006 and 0008 to 0025 in order (so a re-run ends with the 0023 revokes and the 0024 language grant): re-running 0001 on its own revokes the column grants that 0002, 0004 and 0024 add (a member could then not save their language until 0024 is run again). The tested one-file bundle `holler-round3.sql` (0004 then 0005) is the same SQL as those two files. The `holler_place_counts` view is defined identically in 0001 and 0003, so re-running either one never changes it. Run 0003 before the code that calls `holler_signals_near` is deployed: it adds `p_min_severity` and `p_before_id` and drops the earlier 8-argument version of that function, so the checker and the backfill never meet two overloads.

## 2. Resend: verify your sending domain (start now, DNS can take hours)

- [ ] Resend dashboard > Domains > Add domain. Use a domain you control, ideally a subdomain such as `mail.<yourdomain>`.
- [ ] Add the DNS records Resend shows (SPF, DKIM, and the return-path record) at your DNS host.
- [ ] Wait until the domain shows Verified.
- [ ] Create an API key (sending access). This is `RESEND_API_KEY`.
- [ ] Decide the From address: `Holler <alerts@mail.<yourdomain>>`. This is `EMAIL_FROM`. Without it Holler sends nothing, on purpose.
- [ ] Pick a monitored inbox for `SUPPORT_EMAIL` (it becomes reply-to on every email and shows on the Privacy and Terms pages) and `ADMIN_EMAIL` (gets the daily health email).
- [ ] Resend dashboard > Domains > this domain > Configuration: keep **open tracking and click tracking OFF**. Holler promises no tracking pixels (Privacy), and click tracking would rewrite the one-time confirm and close links through a Resend redirect, so the tokens would sit in Resend's link logs.
- [ ] If the other product uses the same Resend account and has a webhook there, check that Holler mail does not feed its bounce and complaint numbers. A separate domain or webhook filter avoids it.

## 3. Set environment variables (Vercel > Project > Settings > Environment Variables, Production)

Copy the names from `.env.example`. Required:

- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `NEXT_PUBLIC_SITE_URL` = `<SITE>`
- [ ] `CRON_SECRET` = `<CRON_SECRET>`

Needed for a real launch:

- [ ] `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL`, `ADMIN_EMAIL` (step 2)
- [ ] `STRIPE_SECRET_KEY` (after step 8 test pass, the live key)
- [ ] `STRIPE_WEBHOOK_SECRET` (step 8)

Optional data sources. Each missing key shows up as "skipped(env)" in the scan table and under "Not configured" in the health email. That is not an error: the smoke test prints a `WARN` line and still passes, and the health subject does not say "need attention". Public pages (trade pages and the /check "what Holler watches" list) also stop naming a signal type whose key is missing: "people asking" needs a Brave or Serper key, or both Bluesky keys; "big events" needs the Ticketmaster key.

- [ ] `BRAVE_SEARCH_API_KEY` or `SERPER_API_KEY` (people asking for a recommendation)
- [ ] `BLUESKY_HANDLE` and `BLUESKY_APP_PASSWORD`, both or neither (Bluesky search needs a login: make a free Bluesky account and create an app password under Settings > Privacy and security; Bluesky is checked every 6 hours because account logins are limited per day). With only one of the two, or neither, the Bluesky source is skipped. For each matched post Holler keeps the snippet, the link and the author's public handle.
- [ ] `HOLLER_BIDS_ENABLED` (city open bids; off unless `1`, `true`, `on` or `yes`; leave empty until bids are reviewed)
- [ ] `HOLLER_STAGE_UPDATES_ENABLED` (round 17 construction stage updates; off unless `1`, `true`, `on` or `yes`; leave empty at first). The owner turns it on AFTER ONE DRY CHECK per source: `GET /api/admin/stage-probe?source=<id>` with `Authorization: Bearer <CRON_SECRET>` (Bearer only; ids are listed when `source` is left out). It runs the stage query once for that source, writes nothing, and returns `rowCount`, `sampleStatuses` (the portal's own status text) and `dateColumnAccepted`. Turn the flag on only for a source where `dateColumnAccepted` is true and the sample statuses look like permit statuses. The date columns (SF `status_date`, the others `:updated_at`) are not in this repo's fixtures, so this check is the live proof. Redeploy after setting it (env changes apply to new deployments only). Rollback: empty the variable and redeploy.
- [ ] `HOLLER_LOCAL_BIDS_ENABLED` (Atlanta-area agency bid pages read with Firecrawl; off unless `1`, `true`, `on` or `yes`). Separate from `HOLLER_BIDS_ENABLED` on purpose: turning on the city bids does not start Firecrawl spend. Leave it empty for now; the "Round 16 order" block in step 1 says when to set it (steps 4 and 5: after the deploy and the probes).
- [ ] `FIRECRAWL_API_KEY` (Firecrawl; Production already has it). Firecrawl runs only when `HOLLER_BIDS_ENABLED`, `HOLLER_LOCAL_BIDS_ENABLED` and this key are ALL set; with any one missing there is no Firecrawl call (the owner probe, `/api/admin/firecrawl-probe`, needs only the key and the Bearer secret). Before turning it on, check each source with `GET /api/admin/firecrawl-probe?source=bids-gwinnett` and `Authorization: Bearer <CRON_SECRET>` (a dry run, about 5 credits, writes no signals; its spend is counted and capped at `FIRECRAWL_PROBE_DAILY_CAP`, default 25 a day). Optional credit caps: `FIRECRAWL_RUN_CREDIT_CAP` (24), `FIRECRAWL_DAILY_CREDIT_CAP` (30), `FIRECRAWL_MONTHLY_CREDIT_CAP` (500), `FIRECRAWL_MIN_REMAINING` (100), `FIRECRAWL_PROBE_DAILY_CAP` (25).
- [ ] `SAM_API_KEY` (federal bids), `TICKETMASTER_API_KEY` (events), `SOCRATA_APP_TOKEN` (city data rate limits)
- [ ] `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` (monthly search volume and AI mention check; both or neither: with either missing the job answers `not_configured` and spends nothing). Optional: `DATAFORSEO_MONTHLY_CAP_USD` (spend cap, default 30). `HOLLER_PREVIEW_FIXTURES` is local only (fixture records on the home page without a database; ignored on Vercel): never set it in Production.
- [ ] Business listing lookup (round 18, optional caps; uses the DataForSEO login above and counts inside `DATAFORSEO_MONTHLY_CAP_USD`, at most $0.0192 a lookup): `HOLLER_LOOKUP_MAX_PER_RUN` (default 5 per alert run), `HOLLER_LOOKUP_MAX_PER_DAY` (default 25 per UTC day, counted from the DataForSEO ledger and held across overlapping runs), `HOLLER_LOOKUP_DRY_RUN` (`1` makes no lookup call). Set either cap to `0` to turn the lookup off; a value that is not a whole number also turns it off. Lookups run only with migration 0026 applied, only in the alert run, only for cards about to be emailed, and never hold an email: at most 6 seconds of lookups per run, 3 seconds per call, none after 30 seconds into the run; a call that times out or fails is not tried again for 6 hours. Placeholder or generic names ("General Contractor", "Home Daycare", "TBD", "Owner") and person names are never looked up. Owner check of one business: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/lookup-probe?name=Acme%20Roofing%20LLC&city=Atlanta&state=GA"` (Bearer only; ONE paid call booked in the ledger, nothing else written; it returns what would be attached and `costUsd`; add `&dry=1` for no call; like the alert run it makes no call before 0026 is applied). Before relying on it, probe five businesses whose listings you know and check `status`, `wouldAttach` and `costUsd`. The alert run's answer carries a `lookup` block (`calls`, `found`, `notFound`, `cacheHits`, `timedOut`, `spentUsd`, `msLeft`, `skipped`).
- [ ] `AI_GATEWAY_API_KEY` (draft replies and the hourly AI sorting step; on Vercel the platform token also works)
- [ ] `AI_MONTHLY_CAP_USD` (hard monthly cap in dollars for the AI sorting step; empty means 10). Run the AI spend queries under step 1 first: if the expected month is above 10, raise it or accept that the step pauses near the month's end (alerts keep going out with the keyword-rule trades, and one email goes to `ADMIN_EMAIL` at 80% and one at the cap).
- [ ] `AI_CLASSIFY_MODEL` (leave empty for the default `anthropic/claude-haiku-5.5` on the AI Gateway)
- [ ] `AI_MAX_SIGNALS_PER_RUN` (round 17; most records the hourly AI step sends to the model in one run; empty means 200) and `AI_MAX_SIGNALS_PER_DAY` (most records sent to the model in one UTC day, counted from today's `holler_ai_spend` rows; empty means 1500). Both sit under the monthly dollar cap, which still applies. Records that need no model call (structured sources, text already in the cache) do not count. A day that has used its limit stops with `reason: day_limit` (not an error) and the next UTC day continues; permits and civic records are taken oldest first so a backlog drains instead of falling out of the 14 day window. Leave both empty unless the owner wants a lower or higher volume; at the defaults the worst case is roughly $4.50 a month at the day limit (an estimate, check `/api/cron/ai?dry=1` and the AI spend queries).
- [ ] `REVENUECAT_WEBHOOK_SECRET` and `FIREBASE_SERVICE_ACCOUNT_JSON` (mobile app store billing and push; set them with the app release, see "Mobile app" below). Without the first, `/api/revenuecat/webhook` answers 503. Without the second, no push is sent. `REVENUECAT_ALLOW_SANDBOX`: set to `1` only while TestFlight, license testing or App Review needs sandbox purchases to give a plan (see "Mobile app" below); empty otherwise. Redeploy after each change.
- [ ] `INDEXNOW_KEY` (tells Bing and other IndexNow search engines about new pages; set it in step 10, where it is explained)
- [ ] Before you set any optional source key later (Bluesky, Serper or Brave, Ticketmaster, SAM.gov), update `app/privacy/page.tsx` first. The Privacy page today names only the keyless public sources. Bluesky in particular stores each post's author handle, and web search stores snippets of public posts, so the page must say so before those sources run.

## 4. Deploy

- [ ] Run `npm run typecheck` once and fix anything it reports. It runs `next typegen` first, then the TypeScript check; a bare `tsc --noEmit` on a fresh checkout fails on the generated page types.
- [ ] Push to the production branch (or `vercel --prod`). `NEXT_PUBLIC_*` values are baked in at build time, so change one, redeploy.
- [ ] Confirm the build is green and `<SITE>` loads.
- [ ] Know this: `REQUESTS_ENABLED` is the off switch for new resident requests. Leave it unset (on). Set it to `0` if the form is abused: the API answers 503 at once, and the `/request` page shows "Requests are paused" after the next deploy. Requests already made keep working. On top of that, at most 300 confirmation emails go out per day site-wide.
- [ ] Know this: adding or removing an optional key (Brave, Serper, Bluesky, Ticketmaster, SAM) needs a redeploy before the public pages change. The home page, /about and /llms.txt are built at deploy time and name a source only when its key was set then. Onboarding and Settings read the keys on each request, so off Vercel they can disagree with the home page until you rebuild.
- [ ] Know this: the free /check page caches database reads with `use cache: remote`, which Next.js documents as a cache shared by all server instances that the hosting provider supplies. If you host somewhere other than Vercel, set `cacheHandlers.remote` in `next.config.ts` or every instance caches alone.
- [ ] Add the domain in Vercel > Domains if you have not, and confirm HTTPS works.

## 5. Run the smoke test

```
node scripts/smoke.mjs <SITE> <CRON_SECRET>
```

- [ ] The script also loads the round 3 pages: `/pricing`, `/request`, `/guides`, `/faq` and `/data`. Each must answer 200. Open `/request` in a browser once and check the form shows.
- [ ] The last line says `PASS`. Exit code 0. This holds with only the required keys set: a source skipped for a missing optional key (Bluesky, Brave, Serper, Ticketmaster, SAM) is a `WARN` line, never a `FAIL`.
- [ ] Every `FAIL` line is fixed. Common ones: a cron route that answers 200 without a key means the auth check did not ship, and a cron route that answers 401 with the right secret means `CRON_SECRET` on Vercel differs from the one you passed; `/app` not redirecting means the proxy is not deployed; 404 check failing on the bad city page means the city validation did not ship.
- [ ] `WARN` lines are fine if you understand them (optional pages, sources skipped for a missing key).

## 6. Review the dry-run table

The smoke test prints one row per source: `status`, `fetched`, `parsed`, `latestOccurredAt`. It wrote nothing to the database.

- [ ] No source is `error`.
- [ ] No source has `fetched` above 0 with `parsed` at 0. That means the source changed its format.
- [ ] Sources with `fetched` 0 are quiet or broken. For `nws`, `faa` and the city feeds, 0 is suspicious: open that source's page from `lib/signals/source-meta.ts` and compare.
- [ ] `latestOccurredAt` is recent for the fast sources (`nws`, `faa`). Old dates mean a stale feed.
- [ ] Every `skipped(env)` is a key you chose not to set. It does not count as `error`.

## 7. Schedule the cron jobs

- [ ] Supabase Dashboard > Database > Extensions: `pg_cron` and `pg_net` are on.
- [ ] Open `supabase/cron.sql`. In STEP 1 replace `<SITE>` and `<CRON_SECRET>` in the SQL editor only. Do not save the edited file into git.
- [ ] Run the file. It stores both values in Vault and creates `holler-scan` (every 15 minutes), `holler-notify` (every 15 minutes, offset 7), `holler-health` (daily 13:03 UTC), `holler-dataforseo` (03:23, 09:23, 15:23 and 21:23 UTC on the 1st to 3rd of each month; one run cannot finish all 40 batches inside 60 s, and a run with nothing left to do spends nothing), and the round 7 jobs: `holler-ai` (hourly at minute 4), `holler-monitor` (hourly at minute 11, the health route with `?monitor=1`), `holler-lifecycle` (hourly at minute 17), `holler-moat` (daily 18:41 UTC) and `holler-events-prune` (Sundays 04:29 UTC, plain SQL that deletes funnel events older than 400 days). No two jobs start in the same minute.
- [ ] After 20 minutes run the CHECK queries at the bottom of the file: nine jobs, `succeeded` in `cron.job_run_details`, status 200 in `net._http_response`.
- [ ] Round 7 dry runs (each reads only: no model call, no email, no write). Use `curl -H "Authorization: Bearer <CRON_SECRET>" "<URL>"` for each:
  - `<SITE>/api/cron/ai?dry=1`: expect `reason: null` and `candidates` above 0, with the planned batches, the worst-case cost, this month's spend and the cap. `reason: not_migrated` means 0014 is missing; `no_gateway_auth` means no gateway key or platform token.
  - `<SITE>/api/cron/lifecycle?dry=1`: lists `{user_id, kind, variant}` for each member who would get a welcome, trial-ending or trial-ended email now. `skipped: not_migrated` means 0016 is missing. Only members with a verified email are listed, and a returning member (deleted the profile, then came back) gets no second welcome. In a real run, `send_unknown` counts emails whose send result was lost (the provider may have sent them); they are kept as sent and never retried, so nobody gets one twice.
  - `<SITE>/api/cron/moat?dry=1`: `ok: true` with counts and nothing sent. Before 0015 it returns `skipped: migration_0015_not_applied`.
  - `<SITE>/api/cron/health?monitor=1&dry=1`: expect `monitor.status` `ok` and, on a healthy site, `conditions: []`. Right after launch it may list sources that have not run yet; that clears within a day.
- [ ] After the first hour of `holler-ai`: `select kind, count(*), sum(cost_usd), avg(usd_per_1k) from holler_ai_spend group by kind;` shows `run` rows and, once records go to the model, `classify` rows.
- [ ] `holler-monitor` exists in `cron.job` (hourly at minute 11). Ingest alert emails go to `ADMIN_EMAIL` (else `SUPPORT_EMAIL`), subject starts "Holler ingest:". A healthy site sends none.
- [ ] Lifecycle unsubscribe: open a received lifecycle email's "Stop these emails" link, press the button, and confirm a row with kind `optout` in `holler_lifecycle_sends` for that member.
- [ ] Funnel counting: open the site once in a normal window, then `select name, source, path from holler_events order by id desc limit 3;` shows one visit with no IP, user agent or referrer column. Open it again with Global Privacy Control on (Firefox or Brave): no new row and no holler_ cookies.
- [ ] `select source, started_at, fetched, inserted, error from holler_scan_runs order by started_at desc limit 20;` shows real rows.
- [ ] DataForSEO dry run, no spend: `curl -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/cron/dataforseo?dry=1"` shows the month's spend, the stored keyword count and the expected plan cost (about 40 tasks, $3.00 for volume). Then run it once without `?dry=1`; `volume.status` stays `time_budget` until the month is fully stored (about 5 runs), then `complete`.
- [ ] Storm pages, after deploy: run this page count query in the Supabase SQL editor (read only). Expect a small number in a quiet month. `/storms` stays noindex until 3 qualifying pages exist, which is correct. It mirrors the code (zone map, 3 report rule, the exact FEMA storm incident types, 60 day window) but skips the plain place name filter, so the app can show slightly fewer pages than the query, never more.

```sql
with zones(state, tz) as (values ('AL','America/Chicago'),('AK','America/Anchorage'),('AZ','America/Phoenix'),('AR','America/Chicago'),('CA','America/Los_Angeles'),('CO','America/Denver'),('CT','America/New_York'),('DE','America/New_York'),('DC','America/New_York'),('FL','America/New_York'),('GA','America/New_York'),('HI','Pacific/Honolulu'),('ID','America/Denver'),('IL','America/Chicago'),('IN','America/New_York'),('IA','America/Chicago'),('KS','America/Chicago'),('KY','America/New_York'),('LA','America/Chicago'),('ME','America/New_York'),('MD','America/New_York'),('MA','America/New_York'),('MI','America/New_York'),('MN','America/Chicago'),('MS','America/Chicago'),('MO','America/Chicago'),('MT','America/Denver'),('NE','America/Chicago'),('NV','America/Los_Angeles'),('NH','America/New_York'),('NJ','America/New_York'),('NM','America/Denver'),('NY','America/New_York'),('NC','America/New_York'),('ND','America/Chicago'),('OH','America/New_York'),('OK','America/Chicago'),('OR','America/Los_Angeles'),('PA','America/New_York'),('RI','America/New_York'),('SC','America/New_York'),('SD','America/Chicago'),('TN','America/Chicago'),('TX','America/Chicago'),('UT','America/Denver'),('VT','America/New_York'),('VA','America/New_York'),('WA','America/Los_Angeles'),('WV','America/New_York'),('WI','America/Chicago'),('WY','America/Denver')),
spc as (
  select s.state,
         coalesce(nullif(trim(s.county), ''), nullif(trim(s.city), '')) as place,
         (s.occurred_at at time zone z.tz)::date as local_date,
         count(*) as n
  from holler_signals s
  join zones z on z.state = upper(trim(s.state))
  where s.source = 'spc'
    and s.data->>'type' in ('torn', 'hail', 'wind')
    and s.occurred_at >= now() - interval '63 days'
    and coalesce(nullif(trim(s.county), ''), nullif(trim(s.city), '')) is not null
  group by 1, 2, 3
),
spc_pages as (
  select * from spc
  where n >= 3 and local_date >= (now() at time zone 'utc')::date - 60
),
fema_pages as (
  select distinct upper(trim(state)) as state, (occurred_at at time zone 'utc')::date as d
  from holler_signals
  where source = 'fema'
    and lower(trim(data->>'incidentType')) in ('severe storm','severe storm(s)','tornado','hurricane','flood','snowstorm','snow','severe ice storm','coastal storm','tropical storm','typhoon','winter storm','straight-line winds')
    and (occurred_at at time zone 'utc')::date >= (now() at time zone 'utc')::date - 60
)
select (select count(*) from spc_pages) as county_or_city_pages,
       (select count(*) from fema_pages) as fema_state_pages,
       (select count(*) from spc_pages) + (select count(*) from fema_pages) as total_pages,
       ((select count(*) from spc_pages) + (select count(*) from fema_pages)) >= 3 as storms_index_is_indexable;
```

- [ ] Open `<SITE>/sitemap.xml`: `/storms/...` URLs appear only when that count is above 0 (and `/storms` itself only at 3 or more), and `<SITE>/llms.txt` ends with the Storm reports line. Storm pages need no new env var, migration or cron: they read `holler_signals` and refresh every 30 minutes.
- [ ] Trigger the health email once by hand and confirm it arrives at `ADMIN_EMAIL`: `curl -H "Authorization: Bearer <CRON_SECRET>" <SITE>/api/cron/health`. The JSON has `email.status`: `sent` is good. `skipped` means `RESEND_API_KEY` or `EMAIL_FROM` is missing. `no_recipient` means neither `ADMIN_EMAIL` nor `SUPPORT_EMAIL` is set. Right after launch it will list sources that have not run yet; that clears within a day. Sources skipped for a missing optional key are listed under "Not configured" and never make the subject say "need attention"; once every configured source has run cleanly the subject reads "Holler health: all sources OK".

## 8. Stripe

Do this once in test mode (use `sk_test_...` and a test webhook) to prove it works, then repeat with live keys.

- [ ] Stripe Dashboard > Settings > Billing > Customer portal: save the portal settings. The Manage billing button fails until you do.
  - Cancel subscription: on, and set to cancel **at the end of the billing period**. The Terms promise the plan stays on until the end of the period already paid for.
  - Switching plans (customers can switch plans or prices): **off**. Plan switches must go through Settings in Holler (`/api/stripe/change-plan`), which sets `metadata.tier` and prorates. A switch made in the portal would leave Holler on the wrong plan.
- [ ] Developers > Webhooks > Add endpoint: `<SITE>/api/stripe/webhook`
- [ ] Events to send, exactly these five: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`
- [ ] Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`. Set `STRIPE_SECRET_KEY`. Redeploy.
- [ ] Prices are created inline at checkout: Solo `$7.99` a month or `$79.99` a year, Pro `$13.99` a month or `$139.99` a year (the plan stored as `starter` is shown as Solo). There is nothing to create in the Stripe product catalog. The first checkout or plan switch creates two products, `holler_starter` (named "Holler Solo") and `holler_pro`, by itself; an existing `holler_starter` product named "Holler Starter" is renamed in place on first use, same id. Existing subscriptions keep the price they signed up at: nothing re-prices them; a member who switches plan or interval moves to today's price.
- [ ] The Stripe account may be shared with the other product. Holler tags everything `metadata.app = holler` and ignores events without it. If the other product uses the same webhook URL style, give Holler its own endpoint, as above.
- [ ] Test pass: complete a checkout with card `4242 4242 4242 4242` for monthly, then again on a second test account for yearly. After each, `select subscription_status, stripe_subscription_id from holler_profiles where user_id = '<USER_ID>';` shows `active`.
- [ ] Cancel from Manage billing. The status becomes `canceled` within a minute.
- [ ] Test a plan switch: on the monthly test account, Settings > Move to Pro. `select plan from holler_profiles where user_id = '<USER_ID>';` shows `pro`, and the next Stripe invoice preview shows a prorated line.
- [ ] Webhook delivery log in Stripe shows 200 for all five events.
- [ ] Live: repeat the endpoint creation in live mode, swap in the live `STRIPE_SECRET_KEY` and live `STRIPE_WEBHOOK_SECRET`, redeploy.

## 9. First real signup test (use a real inbox you can read)

- [ ] Go to `<SITE>/signup` and sign up. You land signed in.
- [ ] The confirm email arrives within a minute. From is your `EMAIL_FROM`. Reply-to is `SUPPORT_EMAIL`. The text says the trial starts when you finish setup.
- [ ] Click the confirm link. It works once.
- [ ] Onboarding: pick two trades (they are grouped), a ZIP, a radius. Finish. You land on `/app`.
- [ ] The feed already has items, or the empty state names what Holler watches near you.
- [ ] Settings shows monthly and yearly options and the "Paying yearly saves 16%." line when Stripe is configured. The trial banner and the welcome email both say 14 days.
- [ ] Wait for the next scan and notify cycle (up to 30 minutes). With a matching item you get a digest email with an unsubscribe link that works.
- [ ] Settings > Delete account removes your Holler profile and matches.
- [ ] `<SITE>/privacy` and `<SITE>/terms` show your `SUPPORT_EMAIL`.

## 10. Tell search engines about the pages (IndexNow, Bing Webmaster Tools)

IndexNow is a free protocol: Holler sends a short list of changed URLs to `https://api.indexnow.org/indexnow` and the participating search engines share it. It helps Bing, and through Bing the assistants that read its index (Copilot and others). It does not replace the sitemap.

- [ ] Make a key: `openssl rand -hex 16`. It must be 8 to 128 characters: letters, digits and dashes only. Set it as `INDEXNOW_KEY` in Vercel (Production), then redeploy.
- [ ] Open `<SITE>/indexnow-key.txt`. It must show exactly the key and nothing else. A 404 means the key is unset, malformed, or the redeploy has not finished.
- [ ] Verify the site in Bing Webmaster Tools (https://www.bing.com/webmasters): add `<SITE>`, then verify with the DNS record or the meta tag. Under Sitemaps, submit `<SITE>/sitemap.xml`.
- [ ] Launch-day ping, once. First `curl -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/cron/indexnow?dry=1"` shows how many sitemap URLs would go out. Then run the same URL without `?dry=1`. Each batch should say `sent` with HTTP 200 or 202. A 403 means the engine could not read the key file at `keyLocation`. A 422 means the URLs are not on the host in `NEXT_PUBLIC_SITE_URL`. A 429 means wait before trying again.
- [ ] Do not put that route on a schedule. IndexNow asks for changed URLs only, and every scan that writes new records already pings once (at most 200 URLs): city pages with 5 or more records in 60 days, and the current weekly page when that week has 10 or more.
- [ ] No `INDEXNOW_KEY`, or a `localhost` site URL, means no pings and no errors. A failed ping is logged as `[indexnow] ping failed` and never fails or slows a scan by more than 5 seconds.

## 11. Rollback

Pick the smallest one that fixes the problem.

- Bad deploy: Vercel > Deployments > the last good one > Promote to Production (instant). Database changes are additive, so the old code runs against the new schema.
- Stop all background work: run these in the SQL editor.
  ```
  select cron.unschedule('holler-scan');
  select cron.unschedule('holler-notify');
  select cron.unschedule('holler-health');
  select cron.unschedule('holler-dataforseo');
  select cron.unschedule('holler-ai');
  select cron.unschedule('holler-monitor');
  select cron.unschedule('holler-lifecycle');
  select cron.unschedule('holler-moat');
  select cron.unschedule('holler-events-prune');
  ```
  Restart later by running `supabase/cron.sql` again.
- Stop emails only: unschedule `holler-notify` (alerts), `holler-lifecycle` (trial emails) and `holler-moat` (follow-ups), or remove `EMAIL_FROM` (email is skipped, nothing else changes) and redeploy.
- Stop the AI step only: unschedule `holler-ai`. Notes already stored stay on the cards, and new records keep the keyword-rule trades.
- Stop billing: remove `STRIPE_SECRET_KEY` and redeploy (Settings shows "Billing opens soon"), or disable the webhook endpoint in Stripe.
- Bad data: `delete from holler_signals where source = '<SOURCE_ID>';` removes one source's signals (matches go with them).
- Undo migration 0003 (only if you must): the code reads `latest_at`, so redeploy the previous code first, then
  ```
  drop view public.holler_place_counts;
  create view public.holler_place_counts with (security_invoker = true) as
  select place_slug, count(*)::int as signals_60d from public.holler_signals
  where place_slug is not null and occurred_at > now() - interval '60 days' group by place_slug;
  grant select on public.holler_place_counts to anon, authenticated;
  drop index if exists public.holler_scan_runs_started_idx;
  ```

## Mobile app (with the app release)

Do this when the iOS and Android app ships. The website does not need any of it.

- [ ] Migration 0020 is applied (step 1, after 0019).
- [ ] Migration 0021 is applied (step 1). Check a ZIP Holler does not cover (for example 59001 with any trade): the Coming to your area card shows, a test email saves, and a covered ZIP (for example 60614) never shows it.
- [ ] Vercel env: set `REVENUECAT_WEBHOOK_SECRET` (for example the output of `openssl rand -hex 32`) and `FIREBASE_SERVICE_ACCOUNT_JSON`. Redeploy.
- [ ] Firebase: create a project. Add the iOS app `com.localholler.app` and the Android app `com.localholler.app`. Upload the APNs auth key (.p8) under Cloud Messaging. Create a service account key with the Firebase Cloud Messaging API on, and paste it (the JSON, or its base64) into `FIREBASE_SERVICE_ACCOUNT_JSON`.
- [ ] RevenueCat webhook: URL `<SITE>/api/revenuecat/webhook`. Authorization header value: the exact value of `REVENUECAT_WEBHOOK_SECRET`, with no "Bearer" in front. Send events for both production and sandbox. Leave Restore behavior on its default (transfer): Restore purchases on a second account moves a paid plan that is still running to that account, and the first account loses it.
- [ ] Sandbox purchases: set `REVENUECAT_ALLOW_SANDBOX=1` in Vercel for TestFlight, Play license testing and App Review, then redeploy. When review is done, set it back to empty (and redeploy), or accept that anyone who can buy in sandbox (TestFlight testers, license testers) gets a real Holler plan for the sandbox period. While it is off, a sandbox purchase is recorded in `holler_billing_events` with result `sandbox` and gives no plan. Either way a sandbox event never ends or changes a plan bought for real.
- [ ] RevenueCat app user id: the Supabase user id (the app calls `Purchases.logIn(user.id)` after sign-in). Never anonymous purchases.
- [ ] RevenueCat products: `com.localholler.app.solo.monthly`, `com.localholler.app.solo.yearly`, `com.localholler.app.pro.monthly`, `com.localholler.app.pro.yearly`. On Play these are the same subscription ids with base plans `monthly` and `yearly`.
- [ ] RevenueCat entitlements: `solo` (both Solo products) and `pro` (both Pro products).
- [ ] RevenueCat offering: `default`, marked Current, with the packages `solo_monthly`, `solo_annual`, `pro_monthly`, `pro_annual` (custom ids, because two plans share one offering). These match `PACKAGE_IDS` in `lib/mobile/types.ts`.
- [ ] App Store Connect and Play Console: create the four subscriptions with those product ids, with no introductory offer (every member already gets the 14-day trial at sign-up, and the /pricing FAQ says a plan bought in the app is charged when you buy it). If you add a store free trial, change that FAQ answer first. `mobile/STORE-SETUP.md` has the full steps (step 5 is this choice).
- [ ] Check: send a TEST event from RevenueCat. The response must be 200 `{"ok":true,"ignored":"test"}`. Then, with `REVENUECAT_ALLOW_SANDBOX=1`, buy in sandbox: `holler_billing_events` gets one `applied` row, and `/api/m/me` shows `paid`.
- [ ] Push needs no new cron job. It rides the existing `holler-notify` job (every 15 minutes), at most one push an hour per member. It does not depend on the email digest: a member with email alerts off or an unconfirmed address still gets pushes.
- [ ] Before App Review, if the app offers Sign in with Apple: Apple requires the server to revoke the member's Apple tokens when they delete their account (POST https://appleid.apple.com/auth/revoke). The server cannot do this yet. It needs `APPLE_TEAM_ID`, `APPLE_SIGN_IN_KEY_ID`, `APPLE_SIGN_IN_PRIVATE_KEY` and `APPLE_CLIENT_ID` in Vercel, plus a step where the app sends Apple's authorization code at sign-in so the server can keep a refresh token to revoke (see the comment in lib/mobile/account.ts). Until then, delete account removes all Holler data but not the Apple link. Decide before submitting.

## Know before you launch

- Past-due payments: someone whose card fails keeps app access during Stripe's retry window, and their email digests wait (they are held, not dropped) until the payment recovers. If Stripe gives up, the subscription is canceled and alerts stop.
- Holler shares sign-in with the other product. A Holler password reset changes the password for both.
- Password change protection is for Holler's own route only: `POST /api/auth/reset` needs a reset link opened in the last 15 minutes (a signed `holler_recovery` cookie, or a recovery sign-in on the session). Someone holding a stolen session token can still call Supabase Auth directly and change the password. Closing that needs Supabase Auth "Secure password change" (reauthentication), a project-wide setting that also affects the other products on the shared project: your decision. A member who waits more than 15 minutes on `/reset` sees "This reset link has expired" and asks for a new link. Holler server calls to sign in all come from Vercel's network, so the sign-in provider's per-IP limit is shared by all Holler users; Holler has its own per-IP limit in front of it.
- Email is never sent from a default address. If `EMAIL_FROM` is missing, digests, verify emails, password resets and the health email are all skipped and the routes say so.
- The health email is the alarm. If it stops arriving, check that `holler-health` still exists in `cron.job`. The hourly ingest monitor (`holler-monitor`) emails only when ingest breaks; if migration 0018 is missing it sends nothing, and the daily health email remains the safety net.
