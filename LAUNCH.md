# Holler launch day

Do the steps in order. Tick each box. If a step fails, stop and fix it before the next one.
Anything in `<ANGLE_BRACKETS>` is yours to fill in. Never paste real secrets into a file in this repo.

Time needed: about 90 minutes, plus DNS waiting time. Do step 2 first thing so the waiting happens while you do the rest.

## 0. Before you start

- [ ] You have: the Supabase project (shared with the other product), a Vercel project, a Stripe account, a Resend account, and a domain.
- [ ] `<SITE>` below means the final https address, for example `https://holler.example`. No trailing slash.
- [ ] Generate the cron secret once and keep it in your password manager: `openssl rand -hex 32`. Call it `<CRON_SECRET>`. Do not rotate it later: it also signs unsubscribe and email-verify links, so rotating breaks every link already emailed.

## 1. Apply the database migrations (Supabase SQL editor, in this order, each file once)

- [ ] Run `supabase/migrations/0001_holler.sql`
- [ ] Run `supabase/migrations/0002_holler_hardening.sql`
- [ ] Run `supabase/migrations/0003_holler_ops.sql`
- [ ] Check: `select * from holler_place_counts limit 1;` returns without error and the columns are `place_slug, signals_60d, latest_at`.
- [ ] Check: `select count(*) from holler_scan_runs;` returns 0 (no error).

Every object is named `holler_*`. Nothing else in the shared project is touched. Each file is safe to run again: all three are additive and idempotent, and re-running them in any order is tested to succeed. The `holler_place_counts` view is defined identically in 0001 and 0003, so re-running either one never changes it. Run 0003 before the code that calls `holler_signals_near` is deployed: it adds `p_min_severity` and `p_before_id` and drops the earlier 8-argument version of that function, so the checker and the backfill never meet two overloads.

## 2. Resend: verify your sending domain (start now, DNS can take hours)

- [ ] Resend dashboard > Domains > Add domain. Use a domain you control, ideally a subdomain such as `mail.<yourdomain>`.
- [ ] Add the DNS records Resend shows (SPF, DKIM, and the return-path record) at your DNS host.
- [ ] Wait until the domain shows Verified.
- [ ] Create an API key (sending access). This is `RESEND_API_KEY`.
- [ ] Decide the From address: `Holler <alerts@mail.<yourdomain>>`. This is `EMAIL_FROM`. Without it Holler sends nothing, on purpose.
- [ ] Pick a monitored inbox for `SUPPORT_EMAIL` (it becomes reply-to on every email and shows on the Privacy and Terms pages) and `ADMIN_EMAIL` (gets the daily health email).
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
- [ ] `SAM_API_KEY` (federal bids), `TICKETMASTER_API_KEY` (events), `SOCRATA_APP_TOKEN` (city data rate limits)
- [ ] `AI_GATEWAY_API_KEY` (draft replies; on Vercel the platform token also works)
- [ ] `INDEXNOW_KEY` (tells Bing and other IndexNow search engines about new pages; set it in step 10, where it is explained)

## 4. Deploy

- [ ] Run `npm run typecheck` once and fix anything it reports. It runs `next typegen` first, then the TypeScript check; a bare `tsc --noEmit` on a fresh checkout fails on the generated page types.
- [ ] Push to the production branch (or `vercel --prod`). `NEXT_PUBLIC_*` values are baked in at build time, so change one, redeploy.
- [ ] Confirm the build is green and `<SITE>` loads.
- [ ] Know this: adding or removing an optional key (Brave, Serper, Bluesky, Ticketmaster, SAM) needs a redeploy before the public pages change. The home page, /about and /llms.txt are built at deploy time and name a source only when its key was set then. Onboarding and Settings read the keys on each request, so off Vercel they can disagree with the home page until you rebuild.
- [ ] Know this: the free /check page caches database reads with `use cache: remote`, which Next.js documents as a cache shared by all server instances that the hosting provider supplies. If you host somewhere other than Vercel, set `cacheHandlers.remote` in `next.config.ts` or every instance caches alone.
- [ ] Add the domain in Vercel > Domains if you have not, and confirm HTTPS works.

## 5. Run the smoke test

```
node scripts/smoke.mjs <SITE> <CRON_SECRET>
```

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
- [ ] Run the file. It stores both values in Vault and creates `holler-scan` (every 15 minutes), `holler-notify` (every 15 minutes, offset 7), `holler-health` (daily 13:00 UTC).
- [ ] After 20 minutes run the CHECK queries at the bottom of the file: three jobs, `succeeded` in `cron.job_run_details`, status 200 in `net._http_response`.
- [ ] `select source, started_at, fetched, inserted, error from holler_scan_runs order by started_at desc limit 20;` shows real rows.
- [ ] Trigger the health email once by hand and confirm it arrives at `ADMIN_EMAIL`: `curl -H "Authorization: Bearer <CRON_SECRET>" <SITE>/api/cron/health`. The JSON has `email.status`: `sent` is good. `skipped` means `RESEND_API_KEY` or `EMAIL_FROM` is missing. `no_recipient` means neither `ADMIN_EMAIL` nor `SUPPORT_EMAIL` is set. Right after launch it will list sources that have not run yet; that clears within a day. Sources skipped for a missing optional key are listed under "Not configured" and never make the subject say "need attention"; once every configured source has run cleanly the subject reads "Holler health: all sources OK".

## 8. Stripe

Do this once in test mode (use `sk_test_...` and a test webhook) to prove it works, then repeat with live keys.

- [ ] Stripe Dashboard > Settings > Billing > Customer portal: save the portal settings (cancel subscription on). The Manage billing button fails until you do.
- [ ] Developers > Webhooks > Add endpoint: `<SITE>/api/stripe/webhook`
- [ ] Events to send, exactly these three: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- [ ] Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`. Set `STRIPE_SECRET_KEY`. Redeploy.
- [ ] Prices are created inline at checkout: `$5` a month or `$48` a year. There is nothing to create in the Stripe product catalog.
- [ ] The Stripe account may be shared with the other product. Holler tags everything `metadata.app = holler` and ignores events without it. If the other product uses the same webhook URL style, give Holler its own endpoint, as above.
- [ ] Test pass: complete a checkout with card `4242 4242 4242 4242` for monthly, then again on a second test account for yearly. After each, `select subscription_status, stripe_subscription_id from holler_profiles where user_id = '<USER_ID>';` shows `active`.
- [ ] Cancel from Manage billing. The status becomes `canceled` within a minute.
- [ ] Webhook delivery log in Stripe shows 200 for all three events.
- [ ] Live: repeat the endpoint creation in live mode, swap in the live `STRIPE_SECRET_KEY` and live `STRIPE_WEBHOOK_SECRET`, redeploy.

## 9. First real signup test (use a real inbox you can read)

- [ ] Go to `<SITE>/signup` and sign up. You land signed in.
- [ ] The confirm email arrives within a minute. From is your `EMAIL_FROM`. Reply-to is `SUPPORT_EMAIL`. The text says the trial starts when you finish setup.
- [ ] Click the confirm link. It works once.
- [ ] Onboarding: pick two trades (they are grouped), a ZIP, a radius. Finish. You land on `/app`.
- [ ] The feed already has items, or the empty state names what Holler watches near you.
- [ ] Settings shows monthly and yearly options and the "save 20%" line when Stripe is configured.
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
  ```
  Restart later by running `supabase/cron.sql` again.
- Stop emails only: unschedule `holler-notify`, or remove `EMAIL_FROM` (email is skipped, nothing else changes) and redeploy.
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

## Know before you launch

- Past-due payments: someone whose card fails keeps app access during Stripe's retry window, and their email digests wait (they are held, not dropped) until the payment recovers. If Stripe gives up, the subscription is canceled and alerts stop.
- Holler shares sign-in with the other product. A Holler password reset changes the password for both. Holler server calls to sign in all come from Vercel's network, so the sign-in provider's per-IP limit is shared by all Holler users; Holler has its own per-IP limit in front of it.
- Email is never sent from a default address. If `EMAIL_FROM` is missing, digests, verify emails, password resets and the health email are all skipped and the routes say so.
- The health email is the alarm. If it stops arriving, check that `holler-health` still exists in `cron.job`.
