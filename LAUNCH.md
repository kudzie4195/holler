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

**Round 23 order** (the website-only launch: home message, no app mentions, honest coverage per city and trade, the 30-day trial, the
sign-up trade list, the data-use consent box, the lists and door hanger on the plan cards, share previews.)

1. Run `0038_holler_trial_30.sql` BEFORE the deploy. Why: until it runs the database gives a new row 60 days while every page says 30.
   It touches no existing row, so nobody's running trial moves.
2. Deploy the round 23 code.
3. Check `select public.holler_trial_db_check();` returns 30 in all three places (the daily health email says so too).
4. NEEDS KUDZI: the trial length in the App Store and Play listings, the RevenueCat intro offers and `mobile/store/` still say the old
   length. They are out of scope for a website-only launch and must be corrected before any store submission.
5. NEEDS KUDZI: set `SUPPORT_EMAIL` (or `EMAIL_FROM`) in Production and confirm the footer "Email support" link renders, so a visitor
   with no account can write in.
6. NEEDS KUDZI (round 24 mail): `HOLLER_QUIET_WEEK_ENABLED` stays empty at the deploy. Turn on after one real-inbox test: set it to `1`
   in Preview, trigger `/api/cron/notify` for a test member with no alert in 7 days, read the quiet-week email in Gmail and Outlook, then
   set it to `1` in Production and redeploy. Why: off, the notify cron sends exactly what it did before; on, a member with nothing to
   alert on for 7 days gets one short email (at most 150 a run, `last_notified_at` stamped), and nothing about it has been seen in a
   real inbox yet.
   NEEDS KUDZI (round 30 season): `HOLLER_SEASON_ENABLED` stays empty at the deploy. Off, the notify cron makes the same calls and
   sends the same bytes as before. Set it to `1` (Preview first, one real-inbox test, then Production) to add the "This week in your
   area" line (lib/season/table.ts) to the alert digest and, with the quiet-week switch also on, to the quiet-week email. For the
   December 1 launch week it must be `1` by the Dec 1 cron run. /check shows the line without any switch.
   NEEDS KUDZI (round 33 business licences): `HOLLER_BUSINESS_TAG_FIX_ENABLED` stays empty at the deploy. Off, the scan tags every new-business
   licence with the same fixed trade set as before. Set it to `1` (Production, after reading gates/r33/r33-la-business/REPORT.md) to tag a
   licence only by its own type (a shop, a restaurant, a parking lot or a storage facility; every other licence gets no trade and is not
   stored), to drop Los Angeles rows farther than 30 miles and New York rows farther than 22 miles from the city centre, or whose ZIP is
   outside that radius or in another state (a radius, not a city line: Santa Monica and Yonkers rows stay, titled with the dataset's city),
   and to make every licence feed only (never emailed or pushed) unless the row names a business. The feed-only rule works with or
   without migration 0027: such a match is stored as already handled (notified, pushed_at set), so no email and no push is ever sent; with 0027 it
   also carries the "Background" label and a licence sentence on the card (without it the card shows as a plain card). Stored rows keep their old tags until you
   run the re-tag in the report (OWNER MUST RUN after review).
   Round 34 switch audit: this switch is INLINED AT BUILD (next.config.ts `env`, lib/build-switches.ts), because the feed card in the
   browser reads it too. Changing it in Vercel does nothing until you redeploy. An instant rollback (or promoting an earlier Production
   deployment) serves that build as it is, with the value it was built with, whatever Vercel shows now. Promoting a Preview deployment to
   Production is a new build with the Production variables, so a value set only in Preview comes out as Production has it (empty: off).
   Off again: empty it and redeploy.
   NEEDS KUDZI (round 33 E-Rate, USAC FCC Form 470 school and library cabling bids): `HOLLER_ERATE_ENABLED` stays empty at the deploy.
   Production already has `HOLLER_BIDS_ENABLED=1` (live bids-sf, bids-la and bids-batonrouge rows), so in Production this switch is the
   only one left to turn. Off, the scan does not request anything from opendata.usac.org, and any stored `bids-erate` row is hidden from
   every feed, email, push and public page (lib/signals/bid-sources.ts `erateHidden`). Order: (a) FIRST ON A PREVIEW DEPLOYMENT, because the
   dry scan is skipped while either switch is off (lib/signals/run.ts `missingEnvFor`, dry runs included), so there is no way to look at the
   first read in Production without turning the source on: in the Preview environment set `HOLLER_BIDS_ENABLED=1` and
   `HOLLER_ERATE_ENABLED=1`, redeploy that preview, then call
   `GET <preview url>/api/cron/scan?dry=1&source=bids-erate` with the cron bearer secret. It makes the one (paged) request to the public
   USAC SODA endpoint, keeps only schools and libraries in served areas with an Internal Connections cabling installation line and an
   allowable contract date at least two days away, and writes nothing. A dry scan shows only the counts in the log, the HTTP status and
   THREE titles per source (lib/signals/run.ts), no summary and no link, so it cannot show what a stored card holds. Read from it: no
   "error: bids-erate HTTP 400" (the combined SoQL query was never run against the live portal by the people who wrote it, so a 400
   means the query needs a fix), the page and kept counts, no "WARNING page limit reached" or "WARNING time budget reached", and three
   titles of the form "A school (or library, district ...) in <city> is asking for bids on network cabling". The card never prints the
   institution's name or the city the applicant typed; the city is the ZIP table's. THEN, still on Preview, run a real (not dry) scan,
   `GET <preview url>/api/cron/scan?source=bids-erate`, and read the first stored cards in the Preview feed or in `holler_signals`
   (`source = 'bids-erate'`): title, summary ("E-Rate request (FCC Form 470) | contract may be signed from <date>"), link (USAC's own
   `publicdata.usac.org` form page, no query string) and the card line. They must show no person, phone, email or street address. If
   Preview uses the Production database, those rows stay hidden in Production while its switch is empty.
   (b) When the sample reads right: set `HOLLER_ERATE_ENABLED=1` in Production and redeploy (env changes reach new deployments only). The
   cards are a heads-up, not an Act now: the record has no bid deadline (its one date is the EARLIEST day a contract may be signed), and
   only providers registered with USAC (a SPIN) can be paid. Rollback: empty the variable and redeploy; stored `bids-erate` cards
   disappear at once, the other bid sources stay. A stored card whose form USAC later lists as Canceled is closed on the next run.
   NEEDS KUDZI (round 33 hail): `HOLLER_HAIL_ROUTING_ENABLED` stays empty at the deploy. Off, every label, carried trade and card is
   exactly as before (replay anchor unchanged: 4,985 / 3,949 / 9.0 / 21.1). On: an NWS alert that names hail of 1 inch or more also
   reaches siding and gutters and roofing, and gusts of 58 mph or more (an alert, or an SPC or LSR gust report) also reach tree service
   and siding and gutters (the NWS severe criteria); a warning gives them a heads-up, a watch or advisory feed only. NWS weather cards
   then show "The weather service warned of hail up to 1.75 inches in this area. Nothing is confirmed for any property." (EN and ES).
   Replay with it on (14-day export): +10 heads-up pairs, all siding and gutters on SPC gusts of 58 to 69 mph; Los Angeles siding and
   gutters 21.1 to 21.5 heads-up a day (ceiling 25). The CAP numbers are stored on every new alert from the deploy on, switch or not.
   NEEDS KUDZI (round 33 LSR): `HOLLER_LSR_ENABLED` stays empty at the deploy; off, no request is made. On: hourly, one request to the
   Iowa Environmental Mesonet LSR GeoJSON for seven NWS offices (Atlanta, Austin, Charlotte, Raleigh, New York, Chicago, Los Angeles),
   storing only non-thunderstorm wind damage and gust reports (SPC already carries hail and thunderstorm wind). The report's remark is
   never stored. Turn on after one look at a scan's `lsr` row in the health email.
   NEEDS KUDZI (round 34 road words): `HOLLER_ROAD_WORDS_ENABLED` stays empty at the deploy; off, every label and every card line is exactly as
   before (replay anchor unchanged: 4,985 / 3,949 / 9.0 / 21.1); the one stored difference is the LSR summary line below, and LSR is off. On:
   in a wind damage report (SPC, and LSR when it is on) a tree tied to a road by freeway, fwy, lanes, ramp, Blvd, boulevard, St, street, Rd, Ave,
   avenue, Pkwy, parkway, interchange, overpass, US-n or SR n ("tree down on ...", "blocking ...", "in lanes", "<road> blocked by trees") is the road
   crew's job: tree service gets a heads-up, not Act now, and the card says "The report names a road; the road crew usually clears trees there.
   Good to know." (EN and ES). The change only ever LOWERS tree service (never raises any label; roofing, restoration and every other trade never
   move). Not read as a road: a street that only describes an area ("between Western Avenue and ...", "along US 270", "near Oak St and Elm St",
   "on the 800 block of ...", "on several streets in <town>", "across the street from ..."), plural streets and avenues, a place name ("Boulevard
   Heights", "Parkway Village"), and any report that also names private property or a thing the tree fell on: a home, yard, apartment, duplex, trailer,
   condo, church, business, school, roof, shingles or gutters, siding, garage, camper, RV, car, SUV, pickup, truck, boat, driveway, parking lot,
   patio, pool, fence, shed, deck, a vehicle or power lines, a hit verb between the tree and the street ("tree crushed a minivan on Elm St": crushed, hit, struck, damaged, smashed, landed on and similar, which ends the tie whatever the thing is), or a second "on / onto / into" in the same sentence ("down on Oak Ave, landed on ...").
   A report with shingles or gutters next to a street therefore keeps Act now (it never drops to feed only). "St" counts only as a street suffix
   ("Elm St", not "St. Louis"); "lane" alone, "Dr" and "Drive" do not count. Real Los Angeles wind remarks of Jan 7 to 9 2025 (124): tree service
   Act now 63 to 37. The switch is inlined at build (next.config.ts `env`), so the feed card in the browser and the server agree: it takes effect with
   the next deployment, on or off, and a Vercel Instant Rollback or a promote of an older build brings back THAT build's value whatever the dashboard
   variable says. LSR rows store a neutral fixed phrase for a tree tied to a street or freeway whatever the switch says and the label reads it at read
   time, so turning the switch off restores main's labels for every stored row at once, and turning it on applies to rows stored before as well (rows
   stored before this deploy have no phrase and keep their old label; 0 LSR rows are stored while `HOLLER_LSR_ENABLED` is empty). With
   `HOLLER_LSR_ENABLED` on, the LSR summary line "It names a street or freeway" appears on those reports (about 1 in 5 real wind damage remarks)
   whatever this switch says; labels and the card line do not change. Rollback: empty the variable and redeploy; nothing to clean up.
7. NEEDS KUDZI (round 24 FIX2, review D6), next to step 1 (0038): the two checks to run in the Supabase SQL editor, BEFORE and AFTER 0038.
   No test in the repo can run 0038 without PGlite (`tests/ops/migration-0038.test.ts` lists its cases as "NEEDS PGlite ... NOT RUN"
   when it is missing). An independent run executed 0038 twice on a database built from the live migration set
   (gates log `PHASEA-rev-mig-live.log`). Copy-paste:
   ```sql
   -- 1. BEFORE 0038. Expected: {"default_days": 60, "guard_cap_days": 60, "stamp_cap_days": 60}
   select public.holler_trial_db_check();
   -- 2. BEFORE 0038: note each profile's trial end (expected today: 1 row, trialing, a 60-day trial).
   select user_id, subscription_status, created_at, trial_ends_at from holler_profiles order by created_at;
   -- run 0038_holler_trial_30.sql, then:
   -- 3. AFTER 0038. Expected: {"default_days": 30, "guard_cap_days": 30, "stamp_cap_days": 30} (new rows get 30 days)
   select public.holler_trial_db_check();
   -- 4. AFTER 0038: the same rows as query 2, with trial_ends_at byte for byte unchanged (the one existing profile keeps its 60-day end).
   select user_id, subscription_status, created_at, trial_ends_at from holler_profiles order by created_at;
   -- 5. AFTER 0038: nobody was shortened. Expected: 0 (except someone who came back after deleting an account).
   select count(*) from holler_profiles
    where subscription_status = 'trialing' and stripe_subscription_id is null and trial_ends_at < created_at + interval '29 days';
   ```
8. NEEDS KUDZI (round 24 FIX2, review D8; FIX3, review F2): run `0039_holler_zip_waitlist_trade.sql` any time (before or after the
   deploy; the code works with 0039 applied and the old index still there). 0039 only ADDS the unique (email, zip, trade) index:
   migrations in this repo never drop an index (tests/signals/core/migration.test.ts), so the old unique (email, zip) index is yours to
   drop. Until it is dropped the ZIP waitlist keeps one row per email and ZIP: a second trade for the same ZIP is not stored, and the
   person gets an email saying they are already on the list for that ZIP and for which trade. After the drop each trade is its own row.
   **Drop the old index only when BOTH are true: 0039 is applied AND this deploy is live in production.** The code that is live today
   saves on (email, zip); without the old index every sign-up fails and the form answers "unavailable". The same happens if the drop
   runs before 0039. **If you roll the deploy back after the drop, the waitlist form stops saving until you redeploy this branch.** The
   block below refuses to drop when 0039 is missing; it cannot see which deploy is live, so check that yourself first. Copy-paste:
   ```sql
   -- expected before: holler_zip_waitlist_email_zip_idx and holler_zip_waitlist_email_zip_trade_idx both listed
   select indexname from pg_indexes where tablename = 'holler_zip_waitlist' order by 1;
   do $$ begin
     if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'holler_zip_waitlist_email_zip_trade_idx')
     then raise exception 'Run 0039 first'; end if;
     drop index if exists public.holler_zip_waitlist_email_zip_idx;
   end $$;
   -- expected after: holler_zip_waitlist_email_zip_trade_idx listed, holler_zip_waitlist_email_zip_idx gone
   select indexname from pg_indexes where tablename = 'holler_zip_waitlist' order by 1;
   ```
9. NEEDS KUDZI (round 24 FIX2, review D8): nothing sends the "Holler is ready in your area" email. The waitlist pages and emails say "we
   will email you" / "we will tell you"; that email is yours to send by hand when a place or a trade opens (no sender was built). Who is
   waiting, by ZIP and trade (read only, Supabase SQL editor, copy-paste):
   ```sql
   select zip, state, coalesce(trade, '(no trade)') as trade, count(*) as waiting,
          min(confirmed_at) as first_confirmed, max(confirmed_at) as last_confirmed
     from holler_zip_waitlist
    where confirmed_at is not null and unsubscribed_at is null and notified_at is null
    group by zip, state, trade
    order by waiting desc, zip, trade;
   ```
   The addresses for one ZIP and trade, when you send: `select email from holler_zip_waitlist where zip = '75201' and trade = 'lawn-care'
   and confirmed_at is not null and unsubscribed_at is null and notified_at is null;` People who joined without a trade wait for the whole
   ZIP; the query above does not return them (FIX3, review F9). When the ZIP opens for any trade, also read them:
   `select email from holler_zip_waitlist where zip = '75201' and trade is null and confirmed_at is not null and unsubscribed_at is null and notified_at is null;`
   After sending, stamp them yourself:
   `update holler_zip_waitlist set notified_at = now() where zip = '75201' and trade = 'lawn-care' and confirmed_at is not null and unsubscribed_at is null and notified_at is null;`
   and, if you wrote to the whole-ZIP people too:
   `update holler_zip_waitlist set notified_at = now() where zip = '75201' and trade is null and confirmed_at is not null and unsubscribed_at is null and notified_at is null;`
   (the two updates write; run them only after the email went out).

**Round 20 order** (one block for the four round 20 units: the would-pay scorecard, violation and inspection feeds with the NYC heat block contact, property sales, and known companies with licence files. Main e3a4fcc with rounds 18 and 19 is already live; their own block below still lists 0026 and 0027.)

Nothing to run before this deploy: no round 20 source needs a migration (probation samples use `holler_source_samples`, migration 0032, already applied live). Numbers 0033, 0034 and 0035 are unused; 0036 is optional and only for licence files; 0037 is an optional one-time data fix run after the deploy (step 10).

1. Deploy the round 20 code. Why: nine new sources go in ON PROBATION and reach no member, page, email or count: `socrata-nyc-hpd-violations`, `socrata-nyc-rodent-violations`, `socrata-montgomery-violations`, `arcgis-phoenix-violations`, `arcgis-dc-311`, `socrata-nyc-acris-sales`, `socrata-cook-sales`, `carto-phl-sales`, `arcgis-miamidade-sales`. Three things change on live cards: NYC whole-building heat cards show the building's BLOCK in "Who to contact" for members with access (never on a public page); contractor names of 61 listed large builders and contractors now show; and "X HOMES OF <STATE> LLC" shows whole instead of "<STATE> LLC" (a name stored earlier as only "<STATE> LLC" is no longer shown). Final review fixes, also live: every NEW 311 row is stored with its map point rounded to 3 decimals (about 100 m), like violations, and a NYC heat row carries a keyed building reference (`data.bref`) instead, so the per-building heat count is unchanged (replay: the same 4,985 / 3,949 / 9.0 / 21.1); the mobile app shows the NYC heat block as "Building: the ... block of ... (the exact address is not published)" under "Who to contact", in the member's language, instead of a "Site" contact row; a 311 or violation status keeps "by" and "per" unless a name or an officer or inspector title follows (0 of 8,309 live rows change).
2. NEEDS KUDZI, right after the deploy: open a few NYC heat cards as a member. Why: the 311 column `incident_address` was never read live; if no heat card shows a "Building: the ... block of ..." line, the column name is wrong and nothing else changes (checklist: "Round 20 NYC 311").
3. NEEDS KUDZI, right after the deploy: probe each of the nine new sources once with `/api/admin/coverage-probe?source=<id>` (Bearer header only, writes nothing). Why: every column name of every new feed is assumed or third-party; a source is promoted only after a good probe (what a good result looks like, per feed: the "Round 20 violations" and "Round 20 sales" checklist items).
4. Daily for a week: `/api/admin/sources`. Why: each probation source's `check` must read `ok` (a new state, `timeout`, means a run was cut off by its time limit); only then are its samples worth reading.
5. NEEDS KUDZI, after a few days: read the samples (`holler_source_samples`, read only) and, for sales, fill in the PRIVACY SIGN-OFF line before any promotion edit. Why: a home sale must read at block level with no house number, no unit and no contact; nothing is promoted without your dated line.
6. Promote one source at a time, by code change, only after steps 3 to 5. Why: the Phoenix complaint rule and the NYC HPD and rodent per-building rules (`PROPOSED_RULES` in `lib/signals/proposed-labels.ts`) are PREREQUISITES: today's violation rule would make every named case urgent, and `npm run replay:rules` on the samples must keep every NYC trade at or under 10 urgent and 25 heads-up cards a day.
7. Licence files, only if you want them: probe `/api/admin/license-probe?state=XX` per state; promote a state by code change; then apply 0036 (`0036_holler_contractor_licenses.sql`) and set `HOLLER_LICENSE_SYNC_ENABLED=1`. Why: the sync is off and every licence source is on probation, so today it fetches and writes nothing even with the switch on (`not_promoted`), and no live permit feed in the 10 metros carries a licence number it may use, so it adds nothing to live cards yet.
8. Leave `HOLLER_BUILDERS_PANEL_ENABLED` unset until you decide. Why: the panel now shows 54 of the test's 60 company names, reached by listing the test's own builder names, not measured on live rows (checklist: "Who's building near you").
9. The scorecard, any time: `npm run score:trades` and `npm run score:trades -- --with-proposed` on a fresh rows export. Why: your rule (a block-level address counts as a place to go) is the official headline; strict is printed beside it, and projected numbers stay apart from measured ones until the probes run.
10. Optional, any time after the deploy, best 9 days after it: run `supabase/migrations/0037_holler_round_311_points.sql` once in the SQL editor, then its check query (must return 0). Why: it rounds the map point of 311 rows stored before this deploy, as new rows already are (the public table then no longer pins a heat complaint's building). The code never needs it. Run earlier, a heat complaint stored before the deploy stops counting toward its building's 3 in 48 h.
11. PREREQUISITES before promoting the probation sources named here (each is a code change with a test; none affects a live card today). Why: the final review found them and they are not safe to leave for a promoted feed:
    - `arcgis-phoenix-violations` (final review P3-6): a name typed between a direction and a street type ("2318 W ZELDA QUIXOTE ST") survives as a street name in the block ("2300 block of W ZELDA QUIXOTE ST"), because a direction counts as street-like in `lib/signals/adapters/nyc-address.ts`. A street named after a person looks the same, so no rule is exact: read the real Phoenix samples first and add a rule for the shapes they show.
    - Any new NYC feed (final review P3-8): `nycBuildingAddress('12 LOPEZ')` gives "0-99 block of LOPEZ" (one bare word after a house number is read as a street, like BROADWAY). Members only, and not a shape the live 311 address column carries; check the samples of a new NYC feed for it.
    - Before NYC heat volume grows (final review P3-8): `lib/outreach/loader.ts` reads contacts for at most 100 signal ids, and NYC 311 ids now take some of them in the email job (`app/api/cron/notify/route.ts`). It only matters for a member with more than 100 pending alert rows; load contacts only for the alerts an email will show.

**Round 21 order** (after the Round 20 order above; one deploy carries both, because the round 21 branch is the round 20 branch plus two units: NEXT, new businesses, Houston permits, certificates of occupancy and the one 311 block rule; WATCH, public bid pages. Do the Round 20 steps as written, then these. No migration: nothing in round 21 needs one (0038 was free then; round 23 uses it for the 30-day trial).)

Decision (round 21 final review P1-1; you can reverse it at any time): a probation source that calls a data API published for machine access (Socrata `/resource/`, ArcGIS REST `/rest/services/`, Carto `/sql`, CKAN `/api/3/`) IS fetched while on probation, so its samples and its probe work, as the round 19 probation sources were. Every probation source declares `access: 'open-data-api'` or `access: 'page'` (lib/signals/types.ts); a test fails if a `page` source sends a request without its terms record, or if an `open-data-api` source's endpoint is not an API path. Pages that are not an API (the 12 page-watch pages and the Houston permit report) send nothing until their own terms record. To stop EVERY probation request at once, set `HOLLER_PROBATION_FETCH=0` in Vercel (Production) and redeploy or wait for the next scan: the scan skips every probation source (`skipped(env)`, naming the key) and the coverage, licence and Firecrawl probes send nothing; live sources are not touched. Unset (the default) means on.

Hosts contacted on probation (open-data APIs only), requests a day at each source's cadence, one page per query and, for ArcGIS, one field-list read plus one query per run (logs/INT21b-probation-hosts.log; more only when a window holds more than one page). NEW hosts the live site has never contacted: `data.texas.gov` and `gisweb.miamidade.gov`.
- `data.texas.gov` (NEW): 8 a day (Texas sales-tax outlets and TABC applications, Dallas and Houston; nothing at all without `SUPABASE_SERVICE_ROLE_KEY` or `HOLLER_BUILDING_REF_SECRET`)
- `gisweb.miamidade.gov` (NEW): 4 a day (Miami-Dade business tax)
- `data.cityofnewyork.us`: 12 a day (HPD violations, rodent findings, certificates of occupancy, ACRIS sales; the live NYC feeds use this host too)
- `phl.carto.com`: 14 a day (Philadelphia permits, violations, business licences, sales)
- `services.arcgis.com`: 36 a day (Miami-Dade permits, violations, building violations, sales; Tempe permits)
- `maps2.dcgis.dc.gov`: 20 a day (DC 311, DC certificates of occupancy)
- `mycity2.houstontx.gov`: 16 a day (Houston 311)
- `maps.phoenix.gov`: 8 a day (Phoenix violations, Phoenix liquor licences)
- `mapportal.phoenix.gov`: 8 a day (Phoenix permits)
- `gis2.arlingtontx.gov`: 8 a day (Arlington permits)
- `www.dallasopendata.com`: 4 a day (Dallas permits)
- `datacatalog.cookcountyil.gov`: 4 a day (Cook County sales)
- `data.montgomerycountymd.gov`: 2 a day (Montgomery County violations)
- `data.lacity.org`: 2 a day (Los Angeles certificates of occupancy)
- In all: about 146 probation requests a day at most by cadence. The final reviewer counted one whole scan of every source (live and probation) with a fake portal: 92 requests with no keys, 94 with the service role key, 117 with today's live keys (live main: 74 / 74 / 97).

1. Deploy (the same deploy as Round 20 step 1). Why: 22 more sources go in ON PROBATION and reach no member, page, email or count: NEXT `socrata-txsales-dallas-business`, `socrata-txsales-houston-business`, `socrata-tabc-dallas-business`, `socrata-tabc-houston-business`, `html-houston-permits`, `arcgis-miamidade-business`, `arcgis-phoenix-liquor-business`, `socrata-la-occupancy-permits`, `socrata-nyc-occupancy-permits`, `arcgis-dc-occupancy-permits`; WATCH `bids-pw-dallas-isd`, `bids-pw-houston-metro`, `bids-pw-hha`, `bids-pw-houston-isd`, `bids-pw-atlanta-housing`, `bids-pw-decatur-housing`, `bids-pw-aps`, `bids-pw-septa`, `bids-pw-philasd-capital`, `bids-pw-miamidade-construction`, `bids-pw-chicago`, `bids-pw-lacounty-dpw`. Nothing is requested from the Houston page or any page-watch site until steps 5 and 6. Live changes: Chicago new-business summaries print the premises address of a storefront whose name passes (never a home-based or home-prone licence, never an address with a unit); Dallas 311 property-condition requests keep a private block (no card changes: Dallas 311 is context); a NYC whole-building heat request whose address names a unit now gets no block (one 311 rule, the stricter of round 20's two); every outbound request names `Holler/1.0 (+https://localholler.com/bot)` (property sales and licence files too); the four live Atlanta Firecrawl pages are skipped when robots.txt answers 401, 403, 429, HTML or a redirect elsewhere, or a Crawl-delay is not met; new public page `/bot`.
2. NEEDS KUDZI, right after the deploy: open the Chicago city page and a few Chicago new-business cards. Why: the summary now ends with the business address; it must be a storefront (a restaurant, a shop), never a home business, a home health or online-sales licence, or an address with an apartment (on the 14-day export: 0 of the 30 home-based or home-prone rows print one).
3. NEEDS KUDZI, right after the deploy: probe the nine NEXT portal sources once each with `/api/admin/coverage-probe?source=<id>` (every id of step 1 from NEXT except `html-houston-permits`). Why: almost every column name is assumed; what a good result looks like is in the "Round 20 next sources" checklist items.
4. Check that `SUPABASE_SERVICE_ROLE_KEY` (or `HOLLER_BUILDING_REF_SECRET`) is set for the scan in Production. Why: the Texas ids and the NYC heat building reference are one keyed hash with one secret (`lib/signals/server-key.ts`); without it the Texas sources send nothing and NYC heat makes no card (both fail closed).
5. NEEDS KUDZI, before the Houston page is read at all: open https://www.houstontx.gov/robots.txt and the city's terms of use in a browser, record them in `HOUSTON_ACCESS` (`lib/signals/adapters/houston-permits-config.ts`: `termsChecked: true`, `robotsUrl`, `termsUrl`, `checkedOn` as YYYY-MM-DD), deploy, then probe `html-houston-permits`. Why: it is read from a web page; its record has the same fields and the same rule as a page-watch page (`lib/signals/access-record.ts`), but it is its own gate: `HOLLER_PAGE_WATCH_ENABLED` does not switch it on or off.
6. NEEDS KUDZI, per page-watch site: read robots.txt and the terms, record them in its entry (the "Round 20 page watch" checklist items), deploy, THEN set `HOLLER_PAGE_WATCH_ENABLED=1` and probe each recorded page. Why: a page-watch page is requested only when BOTH its record and the switch are on (0 requests otherwise, counted through the real scan); a record without the switch, or the switch without a record, fetches nothing.
7. Daily for a week: `/api/admin/sources`. Why: each new probation source's `check` must read `ok` (page watch has its own states: `robots_disallowed`, `robots_unreachable`, `crawl_delay`, `parser_mismatch` and the rest) before its samples are worth reading.
8. NEEDS KUDZI, after a few days: read the samples (Texas privacy check and the page-watch query in the checklist). Why: every Texas row must be a company at a storefront, and no bid row may carry a person's name, e-mail or phone.
9. Promote one source at a time, by code change, only after steps 3 to 8. Why: each needs its label in `SOURCE_DEFAULTS` (proposed in `lib/signals/proposed-labels.ts`) and both flags removed; leave `selectOnly: true` on the NEXT Socrata sources; a promoted bid page reaches members only with `HOLLER_BIDS_ENABLED`, which is unset in Production today.
10. The scorecard, any time: `npm run score:trades` and `npm run score:trades -- --with-proposed`. Why: the projection now counts NEXT's and WATCH's proposed sources too (volumes assumed, unverified until the probes run); measured numbers do not change until a source is promoted.

**Rounds 18 and 19 order** (one block for round 18: trial, names, lookup, routes, lists and the Spanish account pages; and round 19: metros, probation, Philadelphia, the builders panel, the scorecard and the double opt-in waitlist. The two lines of work ship together in one deploy.)

Already applied on the live database, nothing to run: 0021, 0022, 0023, 0024 and 0025, and the SQL of 0031 (`0031_holler_zip_waitlist.sql`) and 0032 (`0032_holler_source_samples.sql`), which are the parallel branch's 0021 and 0022 renamed with the SQL unchanged (running them again changes nothing). On a fresh database run them in number order after 0025. Without 0032 every source on probation is skipped by the scan (no fetch, no error); without 0031 the waitlist card answers "Could not save that. Try again later." and nothing is stored or sent. Spanish account pages (round 18 ES): migration 0024 (`holler_profiles.language`) is already applied on the live database, so the Spanish sign-up, app header and emails work from the deploy; nothing to run for it. The `holler_lang` cookie (en or es only, one year) is set at sign-in, sign-up, onboarding and a language save, and cleared at sign-out and account deletion.

Still to run, in this order:

1. Run 0028 (`0028_holler_trial_60.sql`, free trial 60 days) BEFORE the deploy. Why: until it runs the database gives a new row 14 days while every page says 2 months.
2. Run 0030 (`0030_holler_contact_owner_role.sql`, owner role on contacts) any time. Why: it only widens a role check; until it runs the scan drops owner rows and writes every other contact, and nothing reads owner rows while `HOLLER_VIOLATION_OWNERS_ENABLED` is unset.
3. Deploy the rounds 18 and 19 code. Eleven sources go in ON PROBATION: the three Philadelphia sources `carto-phl-permits`, `carto-phl-violations`, `carto-phl-business` (Philadelphia open data through the Carto SQL API, no key) and the eight round 19 coverage sources `socrata-dallas-permits`, `arcgis-arlington-permits`, `arcgis-miamidade-permits`, `arcgis-miamidade-violations`, `arcgis-miamidade-building-violations`, `arcgis-phoenix-permits`, `arcgis-tempe-permits`, `arcgis-houston-311` (Dallas-Fort Worth, Miami, Phoenix, Houston; no migration, they use 0032). A slow probation portal is cut off after 12 seconds (8 per request) without delaying live sources, and probation sources never trigger an owner alert email. Why: the steps below read what this code adds (the lookup probe route, the health lines, the work profile and contact gate, the metro scorecard). On probation a source is scanned every 6 hours like any other and shows in the health email and `/api/admin/sources`, but its rows go only to `holler_source_samples` (service role only, 300 rows per run, kept 14 days): no card, alert, email, push, list, business lookup, city page, count or coverage list ever shows them.
4. Run 0028 AGAIN right after the deploy. Why: the old code, live until the deploy, cuts a re-onboarding member back to 14 days, which the second run restores.
5. Run the lookup probe on two businesses you know; only if BOTH return `found`, run 0026 (`0026_holler_business_lookup.sql`). Why: how DataForSEO matches a business name is not documented, and without 0026 the alert run makes no lookup call, so nothing is spent or shown until the probe proves it. Probe (Bearer only, one paid call, nothing else written; options in the business listing lookup item under the environment variables): `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/lookup-probe?name=<business%20name>&city=<city>&state=<ST>"`
6. Check one live DeKalb permit read for the site-address field; then run 0027 (`0027_holler_work_profile.sql`, work profile and contact gate). Why: no repo fixture carries DeKalb's site field (`locationLine1`, the adapter's only address column), and if the live field is mostly empty 0027 turns most DeKalb permit alerts into Background cards. Check: `curl -s "https://dcgis.dekalbcountyga.gov/mapping/rest/services/Building_Permit_Applications/MapServer/0/query?where=1%3D1&outFields=locationLine1&resultRecordCount=20&f=json"` and most rows should hold a street address with a house number. After 0027 the health email (Watch) and the quality page flag any source where more than 80% of at least 10 permit cards in 7 days were held, for example "DeKalb County permits: 92% held for no contact path, check the site-address field".
7. Leave `HOLLER_VIOLATION_OWNERS_ENABLED`, `HOLLER_STAGE_UPDATES_ENABLED` and `HOLLER_BUILDERS_PANEL_ENABLED` unset until their own checks. Why: the two owner columns are not verified live (names unit), stage updates need the per-source stage probe first (Round 17 order), and the "Who's building near you" panel ships dark: its business-name rule showed 48 of 60 test company names in round 19 and 54 of the test's 60 since round 20 (reached by listing the test's own builder names; not measured on live rows), and turning it on is your decision (NEEDS KUDZI below).
8. The per-metro scorecard, any time after the deploy: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/metros?format=html"` (JSON without `format`). Why: it is the one read that shows, per metro and trade, cards of the last 7 days by label, the share of alerted cards with a contact path where one can exist, sources healthy and behind, probation sources with their sample counts, and waitlist sign-ups from both waitlist tables. Read only; counts and source ids only. `scripts/metro-scorecard.sql` has the record counts per metro for the SQL editor. Watch the share of NYC no-heat cards with a "Managed by" line: the NYC registration read now asks for `registrationenddate`, and if the portal refuses that column every manager line disappears.
9. NEEDS KUDZI, after a few days: read the Philadelphia samples (read only, Supabase SQL editor): `select source, count(*) from holler_source_samples group by 1;` and `select source, "row"->>'title', "row"->>'summary', "row"->'contacts' from holler_source_samples where source like 'carto-phl-%' order by fetched_at desc limit 30;`. Why: a probation source is taken live by hand only. Check that titles read like permits, violations and new businesses, that no person's name appears anywhere, and that contractor and business contacts are companies. Only then put a source live: remove `probation: true` from its entry in `lib/signals/adapters/carto-datasets.ts` and from `buildCartoAdapter` (lib/signals/adapters/carto.ts), and deploy. Its label defaults are already in `lib/signals/lead-rules.ts` SOURCE_DEFAULTS.
10. NEEDS KUDZI, right after the deploy: probe each of the eight coverage sources once: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/coverage-probe?source=<id>"` (Bearer header only; up to four portal requests of 10 s each, writes nothing; without `source` it lists the ids). Why: their column names were never checked against a live row, so each is promoted only after a good probe. A good result: `httpStatus` 200, `rowCount` 5, `schema` "ok", `missingExpected` empty (a missing contractor or value column only means that field stays empty), `freshness` "ok", no `rowCapNote`, and `mapped` rows that read like permits, violations or 311 requests, with no person's name and with company contacts. Two promotion steps are deferred to this first live probe: if Dallas shows `freshness` "stale", its window must change to an exact match on the text issue dates before promotion; if any source shows a `rowCapNote`, paging must be added before promotion. Promotion needs BOTH flags removed from the source's entry (`probation: true` AND `schemaUnverified: true`, in `lib/signals/adapters/coverage-datasets.ts`, Dallas in `lib/signals/adapters/socrata-datasets.ts`; a test fails if only one is removed) and its label added to `SOURCE_DEFAULTS` (checklist below).
11. NEEDS KUDZI: recapture the store price screenshots; the store listing text and the intro offers still say 14 days; read the new privacy sentence (checklist below). Why: the app stores still advertise the old trial (nothing was changed in App Store Connect, Play Console or RevenueCat), and the privacy page now names the `holler_lang` cookie, which needs your read.
12. Optional, after the deploy: copy the language parked at sign-up into the profile for members who signed up in Spanish before their profile had the column: `update holler_profiles p set language = 'es' from auth.users u where u.id = p.user_id and u.raw_app_meta_data->>'holler_language' = 'es' and p.language = 'en';` Why: only a member whose sign-up language never reached the profile needs it; it changes nobody else, and skipping it leaves those members in English until they pick Español in Settings.

What changes for members with this deploy (round 19 merge): cards, emails and pushes are labelled by this base's rules (lib/signals/lead-rules.ts) again, not by the parallel branch's opportunity rules; `/app` shows "Who's building near you" (companies from permit records near the member, English and Spanish, members with access only); waitlist sign-ups on `/check` keep this base's card but are double opt-in into `holler_zip_waitlist`, as on the live site (one confirmation email per new address, at most 3 sign-ups a day per mailbox; links the live site already sent still confirm; the Spanish check page says to confirm the emailed link); the `nyc-hpd-agents` probation source is gone (its samples expire within 14 days) and NYC no-heat cards name the registered managing company instead.

Migration number 0029 is unused (it was reserved for the lists unit, which needed no schema change); there is no 0029 file to look for.

Details for the trial (steps 1 and 4):

- Owner check BEFORE you announce the 60 days: members who subscribed inside a 14-day trial still have a Stripe subscription whose own trial ends on their old day 14, so Stripe would charge them then while the site now says 2 months. Run (read-only):
   ```
   select user_id, created_at, created_at + interval '60 days' as new_trial_end, stripe_subscription_id
     from holler_profiles
    where subscription_status = 'active' and stripe_subscription_id is not null and created_at > now() - interval '60 days';
   ```
   No rows (today there are none): nothing to do. For each row: open the subscription in the Stripe Dashboard. If it is still `trialing` and its trial ends before `new_trial_end`, change its trial end to `new_trial_end` with no proration (Dashboard: Actions > Update subscription > trial end; or `stripe subscriptions update <sub id> -d trial_end=<unix seconds of new_trial_end> -d proration_behavior=none`). If it was already charged, decide whether to refund the difference. Do not change a subscription that is past its trial and the member chose to pay.
- What 0028 does (`0028_holler_trial_60.sql`, run in steps 1 and 4). It sets the `trial_ends_at` default to 60 days, the one-trial cap and the member-insert guard to 60 days, adds the read-only `holler_trial_db_check()` (service role only), and extends members who never paid and whose original start is less than 60 days ago (a 14-day trial running or ended in the last 46 days) to their original start + 60 days (it also clears their `trial_ending` / `trial_ended` lifecycle rows so those two emails go out again for the new end). An ENDED trial is revived only when more than 72 hours would be left, so the 3-day reminder always comes before a second "Your alerts are paused" email; a member whose start is 57 to 60 days back stays ended. Revived members are not told by email (no "your trial was extended" email exists); their alerts simply start again. Safe to run twice; it never touches a paying, past-due, canceled or store-billed member, and it leaves a row the app already moved to 60 days alone (ledger included). Checks:
   - `select public.holler_trial_db_check();` returns `{"default_days": 60, "guard_cap_days": 60, "stamp_cap_days": 60}`.
   - `select count(*) from holler_profiles where subscription_status = 'trialing' and stripe_subscription_id is null and trial_ends_at > now() and trial_ends_at < created_at + interval '59 days';` is 0 except people who came back after deleting an account (their start is their first account's).
   Why first: until 0028 is applied the database still gives a new row 14 days. The new code moves a never-paid member's row to 60 days at signup and before anything shows or charges against it: /app, Settings, Stripe Checkout, the app's /api/m/me and /api/m/profile, and the hourly lifecycle cron before a trial email (lib/auth/trial.ts), but members already in a trial keep their 14-day end until they come back, while every page promises 2 months.
- Next morning: the health email has a "Free trial length" block that reads `Free trial: the site says 60 days and the database enforces 60 days`. A `MISMATCH` line there (and the subject "free trial length does not match the database") means 0028 is missing, was undone, or the API has not reloaded its schema: apply it (and reload the schema in Supabase: Settings > API). A "could not read" line also changes the subject; look at it the same day.

**NEEDS KUDZI (rounds 18 and 19, and round 20; one list for every owner item; nothing here was changed in App Store Connect, Play Console or RevenueCat, and no live database or portal was touched)**

- [ ] Recapture the 08-price screenshots before ANY store submission. `mobile/store/screenshots/ios/08-price.png` still says "14 days free" and shows the banner "14 days left in your free trial"; `mobile/store/screenshots/android/08-price.png` says "14-day trial"; `contact-sheet.png` and `thumb-strip.png` contain both. On a machine with `mobile/node_modules`, from `mobile/` run `sh store/build-captures.sh` (it ends with `python3 store/check-screenshots.py`, which must exit 0). Until then that check exits 1 with "KNOWN OWNER TASK (round 18)" on purpose. No web gate runs it.
- [ ] App Store Connect and Play Console listing text (description, promotional text, What's New): replace any "14 days" or "14-day trial" with the 60-day trial.
- [ ] Introductory offers on the four subscriptions: none should exist (step 5 of mobile/STORE-SETUP.md). If one exists with 14 days or 2 weeks, remove it or change it (Apple: "2 months"; Play: P60D).
- [ ] RevenueCat dashboard: any paywall or offering text that says 14 days.
- [ ] Read the new privacy sentence (/privacy, "Cookies and visit counts", second paragraph): "Your browser also gets a cookie, holler_lang, that holds only en or es and remembers the language of your account pages in this browser for one year; it is not used for tracking, and logging out or deleting your account removes it." /privacy now shows "Last updated November 22, 2026".
- [ ] Round 19: decide on "Who's building near you" (`HOLLER_BUILDERS_PANEL_ENABLED`, off by default, so the panel is not shown and nothing is read for it). Measured at integration (tests/builders/names-60.test.ts) on the review's 60 hand-written company names: the old strict check showed 15 of 60; the round 18 contractor business-name rule, which the panel now uses, shows 48 of 60 (43 of 48 realistic contractors, 5 of 12 large builders). Not shown: D.R. Horton Inc, Lennar Homes, Toll Brothers, PulteGroup, KB Home, Taylor Morrison, Meritage Homes, Cardinal Development Partners LP, Union Realty Group, Madison Park Properties LLC, Ashford Park Properties LLC, Harbor Point Realty PLLC. The bar was 54 of 60. The rule was not loosened, because the names it refuses look like a private person's to the rule (a bare surname or a surname plus a word that is not a trade); on the round 18 contractor matrix (349 private-person, placeholder and family-holding strings) it names none. **Round 20 update: 54 of the test's 60, reached by listing the test's own large-builder names; not measured on live rows** (the round 20 review counted correct display on 61 builder names it wrote itself: 32 before, 34 after). With the reviewed known-company list (`lib/contacts/known-companies.ts`, 61 large builders and contractors, exact name forms only, each with a source line; business-licence names use it only for names that end with a legal form) the same rule shows 54 of 60 (43 of 48 contractors, 11 of 12 large builders); still not shown: "Taylor Morrison" written bare (a given name plus a surname; the list accepts "Taylor Morrison Homes" and "Taylor Morrison Inc") and the five property or realty names. Every private-person matrix is unchanged at zero. The switch default is unchanged (off). Turn the switch on (set it to `1` in Vercel, Production, and redeploy) if that is acceptable; a builder subsidiary written "X HOMES OF <STATE> LLC" now shows whole instead of "<STATE> LLC"; the names it does show are the same ones the cards show. On the second reviewer's 57 names (review COVERAGE) the same rule shows 48; the licence rule now also accepts a registered name with "Texas" or "Florida" in it (for example SOUTH FLORIDA ROOFING INC), only with a legal form and no person's name beside it (tests/contacts/place-names-r19.test.ts).
- [ ] Round 19: read the Philadelphia probation samples before taking any of the three `carto-phl-*` sources live (step 9 above). Nothing is shown to members until you do.
- [ ] Round 19: read the changed waitlist paragraph on /privacy ("If you check a ZIP code Holler does not cover yet ..."): it now says sign-ups are confirmed by an emailed link (double opt-in), and that the rough center of the ZIP code and the version of the card's wording are kept.
- [ ] Round 19: right after the deploy, check that the NYC registration read still works (review defect 10): the scorecard's share of NYC no-heat cards with a "Managed by" line should not drop to zero (step 8 above).
- [ ] Round 19 coverage: For each source run `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/coverage-probe?source=<id>"` (up to four portal requests of 10 s each, writes nothing). Ids: `socrata-dallas-permits`, `arcgis-arlington-permits`, `arcgis-miamidade-permits`, `arcgis-miamidade-violations`, `arcgis-miamidade-building-violations`, `arcgis-phoenix-permits`, `arcgis-tempe-permits`, `arcgis-houston-311`. Without `source` it lists them.
- [ ] Round 19 coverage: A good result: `httpStatus` 200, `rowCount` 5, `schema` "ok", `missingExpected` empty (a missing contractor or value column only means that field stays empty), `freshness` "ok" (`newestDate` inside the scan window; Dallas: the newest issue date, not the update date), no `rowCapNote` (`windowCount` at or under `rowCap`), and `mapped` rows whose titles read like permits, violations or 311 requests, with no person's name anywhere and contacts that are companies. `schema` "mismatch" names the column that is wrong (for example `expected ISSUDATE`); `unreachable` with a message means the URL or the layer is wrong, or the portal answered an HTML page or an empty body (Miami-Dade and Tempe URLs are the least certain). `freshness` "stale" names the newest date: for Dallas that means `:updated_at` does not track new permits, and the window must change to an exact match on the text dates before promotion. A `rowCapNote` means the weekly batch is bigger than one page: paging must be added before promotion. Send the JSON back to be fixed; do not promote it.
- [ ] Round 19 coverage: Daily, `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/sources"`: the `probation` list shows each source's `check` (`ok`, `not_run`, `no_rows`, `schema_mismatch`, `not_json`, `no_recent_rows`, `row_cap`, `error`; only `ok` is good, and `lastError` or `note` says what is wrong), and `/api/admin/metros?format=html` shows each under its metro with its sample count. After a few days read the samples as for Philadelphia (step 9 above, with `where source = '<id>'`).
- [ ] Round 19 coverage: To promote one: add its label to `SOURCE_DEFAULTS` in `lib/signals/lead-rules.ts` (permits `coming_soon`, the two Miami-Dade violation feeds `act_now`, Houston 311 `coming_soon`), remove `probation: true` AND `schemaUnverified: true` from its entry in `lib/signals/adapters/coverage-datasets.ts` (Dallas: `lib/signals/adapters/socrata-datasets.ts`; a test fails if only one is removed, so an unchecked schema cannot go live), and deploy. The next scan writes it to live records.
- Round 19 coverage: Probation sources never trigger an owner alert email (they are in the daily health report and the sources list instead), and a slow probation portal is cut off after 12 seconds without delaying live sources.
- Round 19 coverage, contractor names: the old shared strict check (`lib/contacts/org.ts`) treats place words such as Texas, Dallas, Florida, Phoenix, Star and Sunshine as possible given names. Contractor columns use the round 18 contractor rule instead, which keeps them (48 of the second reviewer's 57 company names, "NORTH TEXAS ROOFING LLC" included); business-licence names now accept Texas or Florida with a legal form and no person's name beside it (31 of 57). Awardee and buyer names still use the strict check. Check the `contacts` in the samples before promoting (tests/contacts/place-names-r19.test.ts).
- Round 19 coverage: Not added, by decision: Fort Worth (no public layer URL found) and every Houston permit feed (the only fresh one is a weekly HTML report that needs a scraper). Houston gets 311 only. Dallas permits have no coordinates: rows are placed at their ZIP centre.
- [ ] Round 20 sales: right after the deploy, probe each source once: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/coverage-probe?source=<id>"` (Bearer header only; a handful of portal requests of 10 s each, writes nothing). Ids: `socrata-nyc-acris-sales` (New York), `socrata-cook-sales` (Chicago), `carto-phl-sales` (Philadelphia), `arcgis-miamidade-sales` (Miami). No column name was ever read from these portals (research: /home/claude/gates/r20/SALES-research.md); Miami-Dade's layer URL is assumed and NYC's freshness is uncertain.
- [ ] Round 20 sales: a good result: `httpStatus` 200, `schema` "ok", `missingExpected` empty (NYC and Cook County also show `join.missingExpected` empty), `freshness` "ok" (`newestDate` inside the window: NYC 45 days, Cook County 60, Philadelphia 21, Miami 30), no `rowCapNote`, and `mapped` rows whose titles read "Home sold in Brooklyn, NY", "Condo sold in Miami, FL", "Commercial property sold in Philadelphia, PA". A HOME's summary is a price band, a class and its BLOCK only ("Price band: $250k to $500k | Single-family home | 3400 block of N Lakewood Ave": no house number, no unit) and it has NO contact. A COMMERCIAL sale's summary ends with its street address and it has one `site` contact with no name (the probe shows a contact's role, name and phone only; the address is in the summary). Any person's or company's name, a house number on a home, or a unit anywhere in the answer: stop and send it back. `freshness` "stale" (NYC if its extract really stopped on 2026-09-08): do not promote. `schema` "mismatch" names the column; `unreachable` on Miami-Dade means the assumed layer URL is wrong (resolve hub item bf92e51f90a8426cae904ebc15018067). Few or no `mapped` rows with many rows read means a class code table needs a value: send the JSON back.
- [ ] Round 20 sales: daily, `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/sources"`: each sale source's `check` is one of `ok`, `not_run`, `no_rows`, `schema_mismatch`, `not_json`, `no_recent_rows`, `row_cap`, `timeout` (new this round: a run cut off by its time limit), `error`; only `ok` is good. `/api/admin/metros?format=html` lists each under its metro. After a few days read the samples: `select source, "row"->>'title', "row"->>'summary', "row"->'contacts', "row"->'data' from holler_source_samples where source in ('socrata-nyc-acris-sales','socrata-cook-sales','carto-phl-sales','arcgis-miamidade-sales') order by fetched_at desc limit 40;` No name, no exact price.
- [ ] Round 20 sales: PRIVACY SIGN-OFF, before any promotion edit below: the owner writes here, with the date, "I have read the samples and the portal's terms of use for <id>, and I approve showing residential sales at block level only (never a house number or unit, no contact block, no door-to-door kit, never on a public page) and commercial sales with their street address." Signed: ____________ Date: ________. Without this line filled in, no sale source is promoted.
- [ ] Round 20 sales: to promote one (only after the sign-off above), three edits: (1) add `'<id>': 'coming_soon'` to `SOURCE_DEFAULTS` in `lib/signals/lead-rules.ts` (a sale is a heads-up, never urgent; the trades are `saleTradesFor` in `lib/signals/adapters/sales.ts`), (2) set `probation` AND `schemaUnverified` to `false` in its entry in `lib/signals/adapters/sales-datasets.ts` (a test fails if only one is changed, so an unchecked schema cannot go live), (3) remove its two entries (`<id>` and `<id>:commercial`) from `lib/signals/proposed-labels-sales.ts`. Then update the tests that pin the probation set (`tests/signals/sales-r20.test.ts`, `tests/integration/r19-int2-coverage.test.ts`, `tests/integration/r19-int3-rules.test.ts`, `tests/admin/metros.test.ts`) and deploy. No migration is needed: samples use `holler_source_samples` (0032), and a promoted sale is an ordinary `civic` record with `data.subtype = 'sale'`. Note for the owner: once live, a home's block-level summary counts as "a place" for the alert gate, so home sales could be emailed and pushed; if you want them feed-only, say so before promotion.
- Round 20 sales: not added: Washington DC (the daily CAMA sales layer has no address column and its field list could not be read), Atlanta (annual parcel digests only), Dallas-Fort Worth and Houston (Texas does not disclose sale prices; appraisal districts publish bulk value files, no deed feed), Phoenix (the Maricopa sales file is a zip with buyer and seller names in the same rows and month-only dates), Los Angeles (the assessor roll has no sale date or price; the Recorder is not open data).

_Round 20 violations and inspections_ (five new feeds, all on probation and schema-unverified; nothing reaches a member, a page, an email or a count until you promote one; no migration needed)

- [ ] Round 20 violations: right after the deploy, probe each once: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/coverage-probe?source=<id>"` (Bearer header only; writes nothing). Ids: `socrata-nyc-hpd-violations` (NYC HPD housing code violations, classes B and C), `socrata-nyc-rodent-violations` (NYC rodent inspections that found rats), `socrata-montgomery-violations` (Montgomery County MD housing code, Washington metro), `arcgis-phoenix-violations` (Phoenix Neighborhood Services property-maintenance cases), `arcgis-dc-311` (DC 311, last 90 days layer). Why: their column names come from data dictionaries and third-party pages (VIOL-research.md), never from a live row. A good result is the same as for round 19 coverage (step 10): `schema` "ok", `missingExpected` empty, `freshness` "ok", and `mapped` titles that read like code violations or 311 requests with block-level addresses and no person's name.
- [ ] Round 20 violations: what to look for in each probe. HPD: `windowCount` will likely exceed `rowCap` (about 1,000 B and C violations a day); a `rowCapNote` is expected there and acceptable for samples, but tell the worker before promotion so the window can be cut to one day. Rodent: the probe rows show the real `result` values; if rat findings are not spelled with "RAT" (the scan filter assumes "Rat Activity"), send the JSON back. Montgomery: the API column names are a guess (`violation_id`, `date_inspected`, `item`, `condition`, `street_address`, `date_corrected`); a "schema mismatch" names the wrong one. Phoenix: EVERY column name is a guess (the layer's field list could not be read here); the first probe will most likely say `schema` "mismatch" and list the layer's real `columns`: send them back and the entry is fixed in one line. DC 311: read the request types in `mapped`; most will be city work (rodent baiting, bulk pickup) that stays hidden as context.
- [ ] Round 20 violations: to promote one, add its label to `SOURCE_DEFAULTS` in `lib/signals/lead-rules.ts`, remove BOTH `probation: true` and `schemaUnverified: true` from its entry in `lib/signals/adapters/viol-datasets.ts`, remove its id from `VIOL_R20_SOURCES` and `PROPOSED_LABELS`, and deploy. Read a few days of samples first (step 9 queries with `where source = '<id>'`). DO NOT promote `socrata-nyc-hpd-violations` or `socrata-nyc-rodent-violations` on an `act_now` default: at the volumes expected they would send each NYC trade far more than 10 urgent cards a day. They need the per-building rule written in `lib/signals/proposed-labels.ts` (HPD heat one heads-up per building per heating season, apartment-level orders feed only, building-wide class C orders capped per building; rodent: only a failed re-inspection, as a heads-up) reviewed first, and `npm run replay:rules` on their samples must keep every NYC trade at or under 10 urgent and 25 heads-up a day. Montgomery and the round 19 violation feeds: `act_now` like Chicago. Phoenix: PREREQUISITE before promotion: the complaint-level rule `phoenix-complaint-heads-up` (in `lib/signals/proposed-labels.ts` PROPOSED_RULES) must be added to `lib/signals/lead-rules.ts` RULES and reviewed; a `coming_soon` default alone does not cap it, because today's violation rule makes every named case urgent (a test proves it). The same holds for the two NYC feeds (`nyc-hpd-per-building`, `nyc-rodent-reinspection`). DC 311: `context`.
- [ ] Round 20 NYC 311 (LIVE source, changes after the deploy): for whole-building heat requests (HEAT/HOT WATER with ENTIRE BUILDING, and Non-Residential Heat) the card's "Who to contact" block now names the building's BLOCK ("Building: the 6800 block of 4 AVENUE"), for members with access only. It is stored as a private site contact, never in the title or summary, so public city and weekly pages are unchanged. No member gets the house number: the exact address would be shown only for a building with 3 or more residential units, and no feed read here carries a unit count. Since round 21 (one 311 rule for every city): an address that names a unit (APT, UNIT, #, FL, PH, BSMT, REAR and the other spellings the tests cover) gives no block at all, and a bare "4B" or any other form outside those is removed or gives nothing. The column used, `incident_address`, is assumed to be in the live 311 dataset (not checked here): after the deploy, open a few NYC heat cards as a member; if none shows a building block, the column name is wrong (nothing else changes).
- Round 20 violations: not added, by decision (VIOL-research.md): Los Angeles LADBS code cases (case type only, no violation text; freshness in conflict), every restaurant-inspection feed outside Chicago and New York (Los Angeles, Dallas, Houston are stale; Atlanta, Miami, Phoenix and DC have no API), Fort Worth (test servers only), Philadelphia 311 (Carto extract freshness in conflict), Houston code enforcement (the only dataset is XLSX last updated 2023), Dallas code compliance (only monthly totals are published), City of Miami code compliance (no case feed), Tempe code cases (text only in a related table), NYC DOB safety, ECB, boiler and elevator sets (paperwork penalties, person-name columns, no address on boiler rows).

_Round 20 licences_ (unit LIC; nothing here touched a live database or a state portal)

- [ ] Migration 0036 (`supabase/migrations/0036_holler_contractor_licenses.sql`): apply when you want licence files loaded (see the Run line above). Nothing needs it today.
- [ ] Probe each state once after the deploy, before any sync: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/license-probe?state=FL"`, then `state=CA`, `state=AZ`, `state=TX`, `state=NY` (Bearer header only; reads a sample of at most 500 rows, writes nothing; without `state` it lists the states). A good result: `status` "ok", `httpStatus` 200, `schema` "ok" (`missingExpected` empty), `numberPatternShare` near 1, `rowCount` 500 (or the whole small file), `typeValues` that are company types, and a `keptAsCompanies` count that looks plausible for companies (most rows of Florida and Texas are expected to be dropped: their licences belong to people). Florida has no header line: it always answers `schema` "schema unverified: no header" and a `shape` report (shares per position, never a value) until a developer confirms its layout in code. The probe never returns a data row. `unreachable` means the file URL is wrong (every file URL and column name is assumed, see `lib/licenses/sources.ts`); `schema` "mismatch" names the missing columns. Send the JSON back to be fixed.
- [ ] Only after a good probe for a state: promoting it is a CODE change. In `lib/licenses/sources.ts` set that source's `probation: false` and `schemaUnverified: false` (Florida, which has no header line, also needs `headerless.confirmed: true`, set by a developer from the probe's per-position shares: the number column near 1.0 on `numberPattern`, the class column on `companyType`; correct the positions first if they differ) and correct `companyType` from the probe's `typeValues`; deploy. Then set `HOLLER_LICENSE_SYNC_ENABLED=1` (Vercel, Production) and load the state: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/cron/license-sync?state=CA"`; repeat with `&offset=<nextOffset>` from the answer until `done` is true (each call reads at most 20,000 rows: 25 s to read, 45 s in all; `no_progress` means the call could not read past its offset in time: send the JSON back). A state that is not promoted answers `not_promoted` and nothing is fetched. To refresh weekly, add a pg_cron job like the others in `supabase/cron.sql`, for example `select cron.schedule('holler-license-sync-ca', '47 5 * * 0', $$ select net.http_get(url := '<SITE>/api/cron/license-sync?state=CA', headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'holler_cron_secret')), timeout_milliseconds := 58000); $$);` (not added to cron.sql by this unit; one call reads at most 20,000 rows, so a large file needs the offset loop by hand first). Leave the switch unset otherwise.
- [ ] Know what it buys today: **nothing on live cards yet.** No live permit feed in the 10 metros carries a contractor licence number this unit may use (measured on the 14-day live rows: 0 of 408 alerted permit cards in the 10 metros come from a feed with a licence column). The only one with such a column is Miami-Dade `CONTRNUM` (on probation), which round 19 keeps unfetched because a Florida contractor licence belongs to the qualifier, a person. The lookup is built and tested; a feed opts in by adding `licenseState` next to its `licenseFields` in its contact spec, and then the raw number is used only as a lookup key and never shown unless a company is found for it. Decide whether Miami-Dade should opt in after the Florida probe shows how many company (QB) rows the file keeps.
- Round 20 known companies: contractor names now also accept a reviewed list of 61 large builders and contractors, matched on the whole name only (licence and inspection names only when the name ends with a legal form such as LLC or Inc; never a possessive or "Dr." form) (`lib/contacts/known-companies.ts`; "John Horton", "Mary Lennar", "Toll Smith" get nothing from it). Add a company only with a source line.

_Round 20 integration (scorecard and the block rule)_

- [ ] Round 20 scorecard: your decision is applied: a BLOCK-level address ("2300 block of W 52 STREET") counts as a place to go. `npm run score:trades` now prints the headline three ways: with block level (your rule, the official number), strict (a business or an exact street address only), and the per-tier counts. On the 14-day live rows: MEASURED 0 of 41 trades would pay with block level, 0 of 41 strict; covered cells 68 with block, 50 strict. PROJECTED from the proposed probation sources (volumes assumed, unverified until the probes run): 5 of 41 with block (landscaping, lawn-care, cleaning, fencing, handyman), 0 of 41 strict. Logs: /home/claude/gates/r20/logs/INT20-score.txt and INT20-score-proposed.txt.
- [ ] Round 20 scorecard: know what the block rule means for home sales once one is promoted: a home's block-level summary is a place for the live alert gate too (alert-gate.ts), so home-sale heads-ups could be emailed and pushed, not only shown in the feed. Decide at the sales PRIVACY SIGN-OFF above whether they stay feed-only.

_Round 20 next sources_ (unit NEXT: new businesses, Houston permits, certificates of occupancy, the 311 block rule; all on probation, no migration; nothing below reaches a member until you promote each one)

- [ ] Round 20 next sources: probe each once after the deploy, exactly as for the round 19 coverage sources: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/coverage-probe?source=<id>"`. Ids: `socrata-txsales-dallas-business`, `socrata-txsales-houston-business` (Texas Comptroller new sales-tax outlets), `socrata-tabc-dallas-business`, `socrata-tabc-houston-business` (TABC pending liquor applications, the backup), `html-houston-permits` (Houston weekly permit activity report page), `arcgis-miamidade-business` (Miami-Dade business tax), `arcgis-phoenix-liquor-business` (Phoenix restaurant liquor licences), `socrata-la-occupancy-permits`, `socrata-nyc-occupancy-permits`, `arcgis-dc-occupancy-permits` (certificates of occupancy). Why: almost every column name here is assumed (Socrata spellings of published titles, the Phoenix layer index and fields, the TABC columns), so each is promoted only after a good probe. Good: `schema` "ok", `freshness` "ok", `missingExpected` empty or only optional columns, `mapped` rows that read like new businesses, permits or certificates of occupancy, with no person's name anywhere.
- [ ] Round 20 next sources, Texas privacy check before promotion: in the Texas samples (`select "row"->>'title', "row"->>'summary', "row"->'contacts' from holler_source_samples where source like 'socrata-txsales-%' or source like 'socrata-tabc-%' order by fetched_at desc limit 40;`) every row must be a company (its organisation type passed the company-form rule; sole proprietors are dropped before storage) and a storefront NAICS sector. The organisation-type and ownership columns are requested with the rest (review fix), so if the probe shows `parsedRows` 0 with rows read and `missingExpected` empty, the organisation-type values differ from the assumed ones (`lib/signals/adapters/next-filters.ts isCompanyForm`); if `missingExpected` names the column, its name is wrong. Either way send the probe JSON back; do not widen the rule by hand. The Texas ids are a keyed hash: the scan and the probe send nothing without `HOLLER_BUILDING_REF_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` in the environment (the service role key is already set in production).
- [ ] Round 20 next sources, to promote one: add its label to `SOURCE_DEFAULTS` in `lib/signals/lead-rules.ts` (new businesses and certificates of occupancy `coming_soon`, Houston permits `coming_soon`; the per-trade proposal is `lib/signals/proposed-labels.ts`), remove `probation: true` AND `schemaUnverified: true` from its entry in `lib/signals/adapters/next-datasets.ts` (Houston: `lib/signals/adapters/houston-permits-config.ts`), and deploy. Leave `selectOnly: true` in place: it keeps the column allow-list after promotion, so a taxpayer name or address, an owner or an applicant column is never requested (a test fails if a Socrata source of this round sends no `$select`).
- [ ] Round 20 next sources, Houston permit page: NOTHING is requested from houstontx.gov (the page, robots.txt or the probe) until you read https://www.houstontx.gov/robots.txt and the city's terms of use in a browser and record them in `lib/signals/adapters/houston-permits-config.ts` `HOUSTON_ACCESS` (`termsUrl`, `checkedOn` as YYYY-MM-DD, `termsChecked: true`), then deploy. Why: it is the one source read from a web page, not a data portal. After that the scan also asks robots.txt first and skips the page when robots.txt disallows it or cannot be read; requests name `Holler/1.0 (+https://localholler.com/bot)`.
- Round 20 next sources, live changes (no flag): Chicago new-business cards now print the business premises address in their summary, only when the business name passes the licence name rule, the licence or activity is not home-based or home-prone ("Home Based Business", "Home Occupation", home health care, online sales and the like print nothing, whatever the legal form), and the address has no apartment, unit or trailing unit number. On the 190 live Chicago rows of the 14-day export, the 14 home-based ones (and all 30 home-based or home-prone ones) print no address. Dallas 311 (live) and Houston 311 (probation) requests about a property's condition (high weeds, junk vehicle, open or substandard structure, dumping, rodents) keep a private block-level site ("2300 block of W 47TH ST"), never a house number and never on the public row; a request about a home or unit from the inside (apartment, condo, duplex, mobile home, rental, occupied, inside) or an address with a unit never gets one. Dallas 311 stays `context` for every trade, so no member card changes. The Dallas address column name (`address`) is assumed: if it is wrong the site is simply absent.
- Round 20 next sources, certificates of occupancy: a residential certificate (one or two family, single family, dwelling) prints its block only, a home occupation or child development home prints nothing, and New York (no building-type column) prints a block for every row; Washington keeps its quadrant (NW, NE, SW, SE). The DC occupant columns are never requested. Business names: the licence name rule gained a second try for names that end in a legal form and hold only shop, adjective and plain business words ("GOLDEN DRAGON RESTAURANT LLC", "LONE STAR ROOFING LLC"); one given name or surname outside those lists still refuses the name.
- Round 20 next sources, not added: Pearland residential permits (freshness unknown in the research), Houston fire incidents, crash feeds, Florida DBPR new restaurants and TDLR TABS projects (see /home/claude/gates/r20/SCOUT-research.md section 3).

- [ ] Round 21 decision (reversible): open-data APIs on probation are fetched for samples (about 146 requests a day at most, two new hosts: `data.texas.gov`, `gisweb.miamidade.gov`; the full list is under "Round 21 order"). To stop every probation request at once: `HOLLER_PROBATION_FETCH=0` in Vercel (Production). Web pages (page watch, the Houston report) wait for their own terms record either way.

_Round 20 page watch_ (owner items, unit WATCH: public bid and solicitation pages read with a plain fetch; every one ON PROBATION, samples only, nothing reaches a member. Research: gates/r20/WATCH-research.md. Round 20 review fix: **nothing is requested from any of these sites until you have read its robots.txt and terms yourself and recorded them, AND you turn on `HOLLER_PAGE_WATCH_ENABLED`**. Both are off as shipped, so deploying this code fetches nothing.)
- [ ] Round 20 page watch, per source, in a browser, BEFORE anything else. Ids (12 registered): `bids-pw-dallas-isd`, `bids-pw-houston-metro`, `bids-pw-hha`, `bids-pw-houston-isd`, `bids-pw-atlanta-housing`, `bids-pw-decatur-housing`, `bids-pw-aps`, `bids-pw-septa`, `bids-pw-philasd-capital`, `bids-pw-miamidade-construction`, `bids-pw-chicago`, `bids-pw-lacounty-dpw` (the list page of each is its `url` in `lib/signals/adapters/page-watch-datasets.ts`). For each one:
  1. Open `https://<host>/robots.txt`. It must not disallow the page's path for `*` or for `Holler`, and must not answer an error or a login page. Note any `Crawl-delay`.
  2. Open the site's terms of use (footer link: "Terms of Use", "Disclaimer", "Legal"). It must not forbid automated access, scraping, crawling or bots, and must not forbid reusing the listing. Read the whole page; when in doubt, do not turn the source on.
  3. Record it in the source's entry: `termsChecked: true` and, under `evidence`, `robotsUrl` (the robots.txt you read), `termsUrl` (the terms page you read), `checkedOn` (YYYY-MM-DD) and `checkedBy`. A source with `termsChecked: true` but any of those missing still fetches nothing (a test proves it).
  4. Leave `termsChecked: false` for any site whose robots.txt or terms forbid it, and note why in `evidence.terms`.
- [ ] Round 20 page watch, vendor portals (NOT registered: `verified: false`): City of Dallas, DART, Harris County and Philadelphia Housing Authority use a Bonfire (Euna Procurement) list endpoint, and City of Houston (BeaconBid) and City of Phoenix (OpenGov) need Firecrawl. To use one: read the vendor's own terms of service (Euna, BeaconBid, OpenGov), record `termsUrl` as the VENDOR's page, and for Bonfire also `endpointAllowed: true` only if those terms allow an automated client to call the list endpoint; then set `verified: true`. Holler never sends a browser-only header (X-Requested-With) to Bonfire.
- [ ] Round 20 page watch: deploy with the records, set `HOLLER_PAGE_WATCH_ENABLED=1` in Vercel (Production), then probe each recorded page once: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/coverage-probe?source=<id>"` (one robots.txt read and one page read, writes nothing, never calls Firecrawl). Without the record the probe answers `pageWatch.check` "terms_not_checked" and makes no request; with the switch off, "page_watch_off".
- [ ] Round 20 page watch: a good probe: `httpStatus` 200, `pageWatch.check` "ok" (or "empty" when the page itself says nothing is open), `rowCount` above 0, and `pageWatch.rows` whose titles read like bids ("Bid: Roof Replacement at ... (Houston METRO)") with due dates, trades and links to the agency's public page, and `proposedLabel` "act_now" only for rows the page shows as open. No person's name, e-mail or phone anywhere (send the JSON back if there is one). Bad results: `robots_disallowed`, `robots_unreachable` (robots.txt answered 401, 403, 429, an error, an HTML page or a redirect elsewhere: the page is not read), `crawl_delay` (skipped, not an error), `not_html`/`not_json`, `parser_mismatch` (with the header words seen, or only the column count when the table has no header row; a table with headers and no rows reads as a mismatch because a script may fill it), `parse_timeout`, `http_error`, `timeout`. Never promote a source the probe has not shown at least one row for.
- [ ] Round 20 page watch: Firecrawl (only once a vendor page above is cleared and registered): it needs `HOLLER_PAGE_WATCH_ENABLED`, the recorded terms, `HOLLER_LOCAL_BIDS_ENABLED` and `FIRECRAWL_API_KEY`, every 2 days. After two Firecrawl runs in a row that keep no row at the same page, it is not called again until the page changes. Estimate for the two pages together: 30 to 90 credits a month (inside the 500-credit cap in lib/firecrawl/budget.ts). Probe first: `<SITE>/api/admin/firecrawl-probe?source=<id>` (about 5 credits; it lists a page-watch id only once its terms are recorded and the switch is on).
- [ ] Round 20 page watch: daily, `/api/admin/sources` shows each page's `check` (`ok`, `unchanged`, `row_cap`, `robots_disallowed`, `not_html`, `not_json`, `parser_mismatch`, `parse_timeout`, `timeout`, `error`). After a few days read the samples: `select "row"->>'title', "row"->>'summary', "row"->>'url', "row"->'categories', "row"->'data'->>'proposedLabel' from holler_source_samples where source like 'bids-pw-%' order by fetched_at desc limit 50;`.
- [ ] Round 20 page watch: to promote one: remove `probation: true` AND `schemaUnverified: true` from its entry, add its label to `lib/signals/lead-rules.ts` (proposed in `lib/signals/proposed-labels.ts`: urgent only when the row's status is explicitly open, or the page has no status, and it is due 3+ days out; feed-only when anything says closed, awarded, cancelled or under evaluation; school capital and transit lists heads-up only), remove its `PROPOSED_LABELS` entry, and deploy. **`HOLLER_BIDS_ENABLED` must be set (it is unset in Production today) for any bid to reach members**; a promoted page-watch source does not even run while it is off.
- Round 20 page watch: the crawler identifies itself everywhere as `Holler/1.0 (+https://localholler.com/bot)`; the new `/bot` page says what it reads, how often, how to stop it in robots.txt, and gives support@localholler.com. Every Holler request (open-data portals included) now uses that one user agent.
- Round 20 page watch, not added: DHA Housing Solutions for North Texas (list URL not found: paste the "View current business opportunities" link and one entry can be added), Dallas County and City of Miami (BidNet Direct), City of Philadelphia (PHLContracts login), NYCHA/MARTA/Port Houston (applications), M-DCPS capital (contact names inline), Houston Chronicle legal notices (terms not read). New York needs no page: the City Record notice page pattern behind `bids-nyc` was confirmed (a856-cityrecord.nyc.gov/RequestDetail/<id> opened on 2026-11-22); turning `bids-nyc` on is a separate reviewed change.

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
- [ ] Run `supabase/migrations/0021_holler_area_waitlist.sql` (`holler_area_waitlist`, one row per email and ZIP, service role only, no IP or visitor id stored; safe to run twice). Since round 19 the /check waitlist card writes to `holler_zip_waitlist` (0031) with double opt-in and this table is no longer written; it is kept so no row is lost, and the owner scorecard still counts it. Check: `select count(*) from holler_area_waitlist;` returns 0 or more with no error. Rollback: `drop table if exists public.holler_area_waitlist;` (round 19 code no longer writes it; the scorecard then shows its count as blank).
- [ ] Run `supabase/migrations/0022_holler_contact_license.sql` (adds the nullable `license` column to `holler_signal_contacts`: the contractor licence number a permit publishes, for example Raleigh and NYC; RLS and grants are unchanged, service role only; safe to run twice and safe before or after the code deploy: until it is applied the scan writes contacts without licence numbers and the feed reads them without). Check: `select count(license) from holler_signal_contacts;` returns a number with no error. Rollback: `alter table public.holler_signal_contacts drop column if exists license;`.
- [ ] Run `supabase/migrations/0023_holler_grant_hygiene.sql` (security pass r16: revokes the TRUNCATE, TRIGGER and REFERENCES privileges that anon and authenticated still hold on holler_matches, holler_profiles, holler_scan_runs and holler_signals, DELETE on holler_profiles, every write on the holler_place_counts view, anon SELECT on holler_matches, anon and authenticated SELECT on holler_scan_runs (RLS already returned nothing to them; every reader runs as service_role), and EXECUTE on the trigger function holler_set_updated_at; revokes only, nothing created, dropped or rewritten; safe to run twice and safe before or after the code deploy). Check: `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name like 'holler\_%' and grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES','DELETE','INSERT','UPDATE');` returns no rows. Rollback: not needed (the app never used these privileges).
- [ ] Run `supabase/migrations/0024_holler_language.sql` (round 17, Spanish: adds `holler_profiles.language` ('en' or 'es', default 'en', check constraint) and lets a member write their own language; additive and idempotent). Apply it AT OR BEFORE the round 17 deploy: `/es` tells readers to pick Español in Settings, and that control stays hidden until 0024 exists. With it NOT applied the Settings language control is hidden and every alert email, card and draft stays in English. Check: `select language, count(*) from holler_profiles group by 1;` returns one row, 'en'. Rollback: not needed (the app reads the column only when it exists).
- [ ] Run `supabase/migrations/0025_holler_permit_stages.sql` (round 17, optional, safe before or after the code deploy: three new service-role-only tables, holler_permit_stages, holler_project_links and holler_dedupe_drops; it creates nothing else and touches no stored row; safe to run twice). Until it is applied the scan runs exactly as before: no construction stage updates, no second (stage) query to the permit portals, and records that are the same project are not linked (every permit still gets its own card as before). After it, two permit numbers at one address are both stored, the later one is marked as another listing of the first and makes no second card, and the status history of every permit the normal scan sees is recorded. Construction stage updates stay OFF until the owner sets `HOLLER_STAGE_UPDATES_ENABLED=1` (see the next item): with it off there is no second (stage) query to the permit portals and no update card, email or push. Once on, a permit that already has a row in the status history and then reaches final inspection, finished or certificate of occupancy sends ONE update: members who already hold the card get it re-sent once as a "Stage update" email and push; a permit the history has never seen creates nothing (no card, no history row, no alert). At most 5 stage updates per member per day, counted inside the usual 25 per member. A portal that refuses the stage query shows as one `stage query:` line per source in `holler_scan_runs.error` and in the health email's Watch list (it is not a source failure). Check: `select count(*) from holler_permit_stages;` and `select count(*) from holler_dedupe_drops;` both run (0 rows at first). After it, the quality dashboard (`/api/admin/quality?format=html`) shows a "Duplicate listings per source" table instead of "Not recorded". Rollback: `drop table holler_permit_stages, holler_project_links, holler_dedupe_drops;` (the code then falls back to the old behaviour).
- [ ] Run `supabase/migrations/0026_holler_business_lookup.sql` (round 18, optional; one new service-role-only table, `holler_business_lookup`, the cache of business listing lookups; it touches no other object; safe to run twice, and it converges if an earlier version of the file was ever applied). **Apply it ONLY AFTER the owner probe has returned `found` for two businesses you know** (see the business listing lookup item under the environment variables: the probe needs only migration 0011, not 0026). How DataForSEO matches the business name is not documented; if the probe returns `truncated` or `not_found` for businesses you know, do not apply 0026. Until 0026 is applied the alert run makes no DataForSEO lookup call and every card and email is exactly as before. After it, the alert run looks up the business a card names (a contractor on a permit, or a business on a licence or inspection; never a federal awardee, never a person, never a placeholder or generic name such as "General Contractor", "Coin Laundry" or "TBD") when the record has no phone or website: a contractor at its own ZIP when the record gives one, else in the job city; a licensed business only at the site address on the record (same house number and street). It shows "Phone:" and "Website:" from the business's public listing under the name on the card and in the email. Closed listings are never used. Found answers are reused for 90 days, not found for 30, answers cut by the page limit (truncated) for 7, and a timed-out call is not repeated for 6 hours. Circuit breaker: when the first 5 answers of a UTC day hold no usable match, no more lookups run that day, and the daily health email (Watch) and the alert run's JSON say "Business lookups returned no usable match today (N tried). Run the lookup probe." Outage stop (round 18 integration): 3 lookup calls in a row with no answer (a wrong login, an empty balance, HTTP 5xx, timeouts) stop lookups for the rest of the UTC day, and the health email says "Business lookups got no answer N times in a row today, so they stopped for the day. Check the DataForSEO login and balance." The health email runs once a day, so a stop after it is reported the next day as "yesterday". One answered owner probe reopens lookups the same day. Only names the card itself may show are looked up (the round 18 business-name rules of the contact's role, and the strict classifier). Check: `select status, count(*) from holler_business_lookup group by 1;` runs with no error (0 rows at first). Rollback: `drop table holler_business_lookup;` (the lookup turns off again and cards go back to what they showed before).
- [ ] Run `supabase/migrations/0027_holler_work_profile.sql` (round 18 ROUTES, safe before or after the code deploy, additive and idempotent: creates `holler_work_profiles` (one row per member: `work_property` 'residential', 'commercial' or 'both'; `work_min_value` whole dollars or null; `work_type` 'repairs', 'installs' or 'both'; RLS on, a member reads and writes only their own row, nothing for anon, deleted with the profile) and adds `holler_matches.alert_hold` (null, 'background', 'below_min' or 'held'; written by the scan only)). Until it is applied the Settings section "What work do you take?" is hidden, matching is exactly as before, and every card goes out as before (the scan retries its match insert without `alert_hold`). After it, new scans keep a permit card that names no business and no job-site street address in the feed only ("Background"), never emailed or pushed; a member's saved minimum keeps cheaper permits out of alerts ("Below your minimum"). Cards members already hold are never removed. A held card is never sent later, even if its permit later gains a business or an address (it only loses its chip in the feed). Until 0027 is applied the contact gate is completely off: nothing is held, ranked or sent differently from before round 18. Check: `select count(*) from holler_work_profiles;` runs (0 rows at first); `select alert_hold, count(*) from holler_matches where created_at > now() - interval '1 day' group by 1;` runs. Rollback: not needed (the app reads the table and the column only when they exist); to remove, first `update holler_matches set notified = true, pushed_at = coalesce(pushed_at, now()) where alert_hold is not null;` (so held cards are never sent once the column is gone), then `drop table holler_work_profiles; alter table holler_matches drop column alert_hold;`. The file sets `lock_timeout = '5s'` and adds the `alert_hold` check NOT VALID, then validates it in a separate statement (no long lock on `holler_matches`); if that last statement times out, run `alter table public.holler_matches validate constraint holler_matches_alert_hold_check;` again any time.
- [ ] Run `supabase/migrations/0028_holler_trial_60.sql` (round 18, free trial 60 days: column default, the 0003 stamp trigger and the 0019 billing guard set to 60 days, the read-only check `holler_trial_db_check()` for the service role, and members who never paid with an original start less than 60 days ago extended to their trial start + 60 days). Apply it BEFORE the round 18 deploy and once more right after it (see "Round 18 order"). Safe to run twice. If 0004 or 0019 is ever re-run, re-run 0028 right after it, or member sign-ups are refused by the old guard once the 60-day default is in place. Check: `select public.holler_trial_db_check();` shows 60 in all three places.
- [ ] Run `supabase/migrations/0030_holler_contact_owner_role.sql` (round 18, NAMES; numbered 0030 so it could not collide with the numbers reserved for the other round 18 units; 0029 is unused. Any time, before or after the deploy (Round 18 order, step 2). It widens the role check of `holler_signal_contacts` to allow `owner`: the institutional company a code-violation record names as the property owner, shown to members as "Owner on the public record", name only, never a person, phone, email or address, and only while `HOLLER_VIOLATION_OWNERS_ENABLED` is on (off by default; the two owner columns are unverified live, so the feature shows nothing until they are confirmed). It also adds a check that an owner row carries the name only. RLS and grants are unchanged, service role only; safe to run twice and safe before or after the code deploy: until it is applied the scan drops owner rows on the check violation and writes every other contact). Check: `select pg_get_constraintdef(oid) from pg_constraint where conname = 'holler_signal_contacts_role_check';` lists 'owner'. Rollback: `delete from holler_signal_contacts where role = 'owner';` then re-add the old check (`alter table public.holler_signal_contacts drop constraint holler_signal_contacts_role_check, add constraint holler_signal_contacts_role_check check (role in ('site','business','contractor','awardee','buyer'));`).
- [ ] Run `supabase/migrations/0031_holler_zip_waitlist.sql` (ALREADY APPLIED on the live database, under its old name `0021_holler_zip_waitlist.sql` from the parallel branch; round 19 renamed it to 0031 with the SQL unchanged, so running it there changes nothing. `holler_zip_waitlist`: the double opt-in waitlist the live site collected, service role only; and the Coming next list gains `more-areas`). The merged code writes every new sign-up here, double opt-in (a confirmation email with a `/waitlist/confirm` link; only confirmed rows are ever mailed again); the rows already in it are kept and their links keep working. `holler_area_waitlist` (0021) stays and is no longer written; the owner counts read both tables. Without this table the card answers "Could not save that. Try again later." and nothing is stored or sent. Safe to run twice and safe before the code ships. Check: `select count(*) from holler_zip_waitlist;` returns 0 or more with no error, and as the anon key the same query is denied.
- [ ] Run `supabase/migrations/0032_holler_source_samples.sql` (ALREADY APPLIED on the live database, under its old name `0022_holler_source_samples.sql` from the parallel branch; round 19 renamed it to 0032 with the SQL unchanged, so running it there changes nothing. `holler_source_samples`, service role only, RLS on with no policy, nothing granted to anon or authenticated: where a source on probation keeps up to 300 sample rows per run, for 14 days, instead of `holler_signals`). Safe to run twice and safe before or after the code ships. Until it is applied, every probation source (today: `carto-phl-permits`, `carto-phl-violations`, `carto-phl-business` and the eight round 19 coverage sources) is skipped by the scan with no fetch and no error. Check: `select count(*) from holler_source_samples;` returns 0 or more with no error, and as the anon key the same query is denied.
- [ ] Run `supabase/migrations/0036_holler_contractor_licenses.sql` (round 20 LIC, optional; one new service-role-only table, `holler_contractor_licenses`: company contractor licensees loaded from state licence files, keyed by state and licence number, with the source and `fetched_at`; RLS on with no policy, nothing granted to anon or authenticated; safe to run twice and safe before or after the code deploy). Until it is applied the licence sync answers `table_missing` and writes nothing, and the permit lookup attaches nothing (no error). Person licensees are never written: the app drops every row whose licence holder does not pass the company rules before it sends anything. Check: `select count(*) from holler_contractor_licenses;` returns 0 or more with no error, and as the anon key the same query is denied. Rollback: `drop table holler_contractor_licenses;`.
- [ ] Run `supabase/migrations/0037_holler_round_311_points.sql` (round 20 final review P2-1, optional one-time data fix, no schema change: rounds `lat` and `lon` of the rows of the 14 311 sources in `holler_signals` to 3 decimals, as the scan now stores every new 311 row; no other column or row is touched, nothing is granted; safe to run twice). Any time after the deploy, best 9 days after it (Round 20 order, step 10): a NYC heat complaint stored before the deploy then no longer needs its exact point for the per-building count. The code never needs it. Check: the query at the top of the file returns 0. Rollback: none needed (the exact points of old 311 rows are not kept; the public source still has them).
- [ ] Run `supabase/migrations/0038_holler_trial_30.sql` (round 23, free trial 30 days: the `holler_profiles.trial_ends_at` column default, the stamp trigger `holler_profiles_trial_from_stamp` and the member-insert guard `holler_profiles_billing_guard` all move from 60 days to 30, and `holler_trial_db_check()` is re-created unchanged. It has NO extension block: unlike 0028 it reads and writes NOT ONE existing row, because every trial already running keeps its current end date (owner decision, round 23). The app side of the same promise is `TRIAL_MAX_DAYS` in `lib/auth/membership.ts`: the cut-back in `lib/auth/trial.ts` and the Stripe cap in `lib/stripe/scope.ts` are measured against 60 days, so a member still holding a 60-day trial is neither cut back on a page load nor charged early at Checkout. Safe to run twice. Run it BEFORE the round 23 deploy: until it runs the column default is still 60 days, so a brand-new member gets up to 60 days while the site says 30, which is more than promised and never less. If 0019 or 0028 is ever re-run, re-run 0038 right after it. Check: `select public.holler_trial_db_check();` shows 30 in all three places, and `select count(*) from holler_profiles where subscription_status = 'trialing' and stripe_subscription_id is null and trial_ends_at < created_at + interval '29 days';` is 0 except people who came back after deleting an account. Rollback: run 0028 again.)
- [ ] Run `supabase/migrations/0039_holler_zip_waitlist_trade.sql` (round 24 FIX2, review D8: adds a unique index on the ZIP waitlist's (email, zip, trade), with rows that have no trade still one per (email, ZIP) through NULLS NOT DISTINCT. It reads and changes no row and drops nothing; safe before or after the deploy and safe to run twice. The old unique (email, zip) index stays until you drop it by hand (Round 23 order, step 8): until then a second trade for one email and ZIP is not stored (Postgres answers 23505, or 42P10 before 0039, and the code keeps the first row and emails the person that they are already on the list). Check: `select indexname from pg_indexes where tablename = 'holler_zip_waitlist' order by 1;` lists `holler_zip_waitlist_email_zip_trade_idx`. Rollback: not needed.)
- [ ] Run `supabase/migrations/0040_holler_keyword_volume_location.sql` (round 35, OPTIONAL: adds `location_name` and `monthly_searches` to `holler_keyword_volume`, so location mode keeps Google's last 12 months per city. It reads and changes no row and drops nothing; safe before or after the deploy and safe to run twice. Without it location mode still stores its rows (the city sits in the keyword text) and the owner view `/api/admin/keyword-volume` shows one trend point per month the job has run. Check: `select column_name from information_schema.columns where table_name = 'holler_keyword_volume';` lists both. Rollback: not needed.)
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
- [ ] `HOLLER_MANUAL_BIDS_ENABLED` and `HOLLER_OWNER_USER_ID` (round 33, the owner's hand-added bids; the switch is off unless `1`, `true`, `on` or `yes`; leave both empty at the deploy). `HOLLER_OWNER_USER_ID` is the Supabase user id (a UUID) of YOUR own Holler account: Supabase dashboard, Authentication, Users, the row with your e-mail, column UID. Only that account can open the pages; empty or not a UUID means nobody. It is not an e-mail on purpose: an address can be registered first by a stranger or reached through a shared inbox, an id cannot. `ADMIN_EMAIL` is not read for this and keeps routing the health, AI-spend, ingest and request mails. On, three owner pages open: `/app/owner/bids` (quick add: link, title, agency, due date, ZIP or "City, ST", optional trade), `/app/owner/bids/import` (CSV upload, a preview that writes nothing and shows each link's host, then confirm) and `/app/owner/bids/checklist` (the round 32 manual list of government bid pages, with a "checked this week" box per government kept in your browser only; Bonfire portals say "hand-check only, do not enter", governments outside the served area and Baker's wrong URL are marked). Anyone else gets a real 404 (the proxy answers before the page), and every action checks again on the server. Publishing also needs `HOLLER_BIDS_ENABLED` on (a bid stored while it is off would reach nobody). Bids are accepted only inside the areas Holler serves (the same test as /check and the waitlist), with an https link that is not a link shortener and not a portal whose terms ban commercial use; A published record is a normal bid (source `bids-manual`, label "Government bid pages checked by Holler", link to the agency's own page) and is matched at once, so members get it in the next alert run. The Texas ESBD CSV column names are placeholders until you send one real export (`lib/signals/manual-bids/csv.ts`, the TODO); until then use the generic format. Set both variables BEFORE the build and redeploy after any change: the owner pages are prerendered at build time, so a variable changed without a new deployment does not apply (on Vercel a changed variable needs a redeploy, which rebuilds). A signed-out visitor to `/app/owner/*` gets 404, not the log-in page, on purpose (the log-in redirect would say the page exists): sign in at `/login` first, then open `/app/owner/bids`. Quick add has two steps: Preview shows exactly what members will see (nothing saved), then Publish; a bid added by mistake can be retired from the "Open bids you added" list on the same page (it closes at once, leaves members' feeds and is in no new alert e-mail or push; alerts already sent stay sent; the corrected bid can then be added again). A title, agency or solicitation number that looks like it holds a phone number, e-mail address, link, street address or a person's name is refused with that reason, never edited: retype it. Rollback: empty the switch and redeploy (records already published stay until their due date, like every bid).
- [ ] `HOLLER_STAGE_UPDATES_ENABLED` (round 17 construction stage updates; off unless `1`, `true`, `on` or `yes`; leave empty at first). The owner turns it on AFTER ONE DRY CHECK per source: `GET /api/admin/stage-probe?source=<id>` with `Authorization: Bearer <CRON_SECRET>` (Bearer only; ids are listed when `source` is left out). It runs the stage query once for that source, writes nothing, and returns `rowCount`, `sampleStatuses` (the portal's own status text) and `dateColumnAccepted`. Turn the flag on only for a source where `dateColumnAccepted` is true and the sample statuses look like permit statuses. The date columns (SF `status_date`, the others `:updated_at`) are not in this repo's fixtures, so this check is the live proof. Redeploy after setting it (env changes apply to new deployments only). Rollback: empty the variable and redeploy.
- [ ] `HOLLER_VIOLATION_OWNERS_ENABLED` (round 18 owner companies on code-violation cards; off unless `1`, `true`, `on` or `yes`; leave empty). With it off no owner column is read, stored or shown. Two things must be true before it is set: the owner has decided that naming a property's owner beside a code violation is acceptable, and the two owner columns are confirmed on the live portals (Chicago 22u3-xenr `property_owner`, Austin 6wtj-zbtb `owner_name`; both are only in hand-written fixtures; `scripts/check-contact-columns.ts` lists a portal's columns). Until the columns are confirmed the feature shows nothing even when on. Needs migration 0030. Rollback: empty it and redeploy.
- [ ] `HOLLER_LOCAL_BIDS_ENABLED` (Atlanta-area agency bid pages read with Firecrawl; off unless `1`, `true`, `on` or `yes`). Separate from `HOLLER_BIDS_ENABLED` on purpose: turning on the city bids does not start Firecrawl spend. Leave it empty for now; the "Round 16 order" block in step 1 says when to set it (steps 4 and 5: after the deploy and the probes).
- [ ] `HOLLER_ERATE_ENABLED` (round 33 E-Rate school and library network cabling bids from the public USAC open data portal, no key or token; off unless `1`, `true`, `on` or `yes`; leave empty at first; also needs `HOLLER_BIDS_ENABLED`, which Production already has; emptying this one hides every stored E-Rate card at once; try it on a Preview deployment first, because the dry scan does not run while the switch is off; see the "round 33 E-Rate" item in the round 24 order above)
- [ ] `FIRECRAWL_API_KEY` (Firecrawl; Production already has it). For the four Atlanta agency pages Firecrawl runs only when `HOLLER_BIDS_ENABLED`, `HOLLER_LOCAL_BIDS_ENABLED` and this key are ALL set; with any one missing there is no Firecrawl call. The round 20 page-watch pages that use Firecrawl (none registered today) need `HOLLER_PAGE_WATCH_ENABLED`, their own recorded terms check, `HOLLER_LOCAL_BIDS_ENABLED` and this key, and not `HOLLER_BIDS_ENABLED` while on probation (samples only). Since round 20 every Firecrawl page is also skipped when its robots.txt answers 401, 403, 429, an HTML page or a redirect to another host, or when its Crawl-delay is not met (before, only a 5xx skipped it) (the owner probe, `/api/admin/firecrawl-probe`, needs only the key and the Bearer secret). Before turning it on, check each source with `GET /api/admin/firecrawl-probe?source=bids-gwinnett` and `Authorization: Bearer <CRON_SECRET>` (a dry run, about 5 credits, writes no signals; its spend is counted and capped at `FIRECRAWL_PROBE_DAILY_CAP`, default 25 a day). Optional credit caps: `FIRECRAWL_RUN_CREDIT_CAP` (24), `FIRECRAWL_DAILY_CREDIT_CAP` (30), `FIRECRAWL_MONTHLY_CREDIT_CAP` (500), `FIRECRAWL_MIN_REMAINING` (100), `FIRECRAWL_PROBE_DAILY_CAP` (25).
- [ ] `SAM_API_KEY` (federal bids), `TICKETMASTER_API_KEY` (events), `SOCRATA_APP_TOKEN` (city data rate limits)
- [ ] `HOLLER_SAM_BACKFILL_ENABLED` (round 33, OFF unless `1`, `true`, `on` or `yes`; leave empty). Only the owner's one-off `npm run sam:backfill -- --run` reads it; no cron or page does. See "SAM.gov backfill and notice labels (round 33)" below for the exact commands.
- [ ] `HOLLER_SAM_LABELS_ENABLED` (round 33, OFF unless `1`, `true`, `on` or `yes`; leave empty until the wording is read once in Preview). Off, federal notice cards, the app feed and alert emails are exactly what they were. See the same section below.
- [ ] `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` (monthly search volume and AI mention check; both or neither: with either missing the job answers `not_configured` and spends nothing). Optional: `DATAFORSEO_MONTHLY_CAP_USD` (spend cap, default 30). `HOLLER_PREVIEW_FIXTURES` is local only (fixture records on the home page without a database; ignored on Vercel): never set it in Production.
- [ ] `HOLLER_KEYWORD_VOLUME_ENABLED` (round 35, OFF unless `1`, `true`, `on` or `yes`; leave empty at the deploy). The monthly DataForSEO job (`/api/cron/dataforseo`: AI mention check, national "<trade> <city>" volume, and the new location mode) makes no DataForSEO call and books no spend while it is off; it answers `status: disabled`. `?dry=1` still reads state with it off. Server only, read at call time (not inlined). Turn it on only after the dry run below looks right. See "Keyword volume and location mode (round 35)" below.
- [ ] Business listing lookup (round 18, optional caps; uses the DataForSEO login above and counts inside `DATAFORSEO_MONTHLY_CAP_USD`, at most $0.0192 a lookup): `HOLLER_LOOKUP_MAX_PER_RUN` (default 5 per alert run), `HOLLER_LOOKUP_MAX_PER_DAY` (default 25 per UTC day, counted from the DataForSEO ledger; overlapping runs stay at the cap in normal operation, and can pass it by at most 3 x the number of overlapping runs minus 1 when ledger inserts commit out of order, for example 5 calls, $0.10, for two runs), `HOLLER_LOOKUP_DRY_RUN` (`1` makes no lookup call). Set either cap to `0` to turn the lookup off; a value that is not a whole number also turns it off. Lookups run only with migration 0026 applied, only in the alert run, only for cards about to be emailed, one call per business per run, and never hold an email: at most 6 seconds of lookups per run, 3 seconds per call, none after 30 seconds into the run; a call that times out or fails is not tried again for 6 hours. Owner probe, BEFORE applying 0026 (Bearer only; ONE paid call booked in the ledger, nothing else written; `&dry=1` for no call): `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/lookup-probe?name=Acme%20Roofing%20LLC&city=Atlanta&state=GA"` (city path), add `&zip=30318` for the ZIP path (a contractor whose record gives its ZIP), and `&zip=60613&address=200%20W%20Addison%20St` for the site path (a licensed business, which must match the street address). The answer gives `status`, `path`, `wouldAttach`, `costUsd` and, when refused, `reason` (closed, ambiguous, truncated, address_mismatch, state_mismatch, too_far, shared_phone, no_match, no_listing, generic_name ...). Apply 0026 only after two businesses you know come back `found` with the right phone. The alert run's answer carries a `lookup` block (`calls`, `found`, `notFound`, `cacheHits`, `timedOut`, `spentUsd`, `msLeft`, `skipped`, `refused` by reason, `breaker`).
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
- [ ] Know this (round 34 switch audit): every switch listed in next.config.ts `env` is baked in at build time too, as "1" or empty, never
  its raw text (a name that is not a `HOLLER_..._ENABLED` switch stops the build). This change lists `HOLLER_SAM_LABELS_ENABLED` and
  `HOLLER_BUSINESS_TAG_FIX_ENABLED` (lib/build-switches.ts); another change may list its own switch there and says so in its note. Change
  one, redeploy. An instant rollback serves that deployment's own value; promoting a Preview deployment rebuilds it with the Production
  variables. `npm run build`, and so every Vercel build, ends with `node scripts/check-client-switches.mjs`: the build FAILS if a browser
  chunk reads any server variable at runtime (any env read except `NODE_ENV` and `NEXT_PUBLIC_*`, listed in `lib/env.ts` or not). So a
  switch that is not in `env` is read by server code only. A message that only names a variable is a warning, not a failure.
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
- [ ] Run the file. It stores both values in Vault and creates `holler-scan` (every 15 minutes), `holler-notify` (every 15 minutes, offset 7), `holler-health` (daily 13:03 UTC), `holler-dataforseo` (03:23, 09:23, 15:23 and 21:23 UTC on the 1st to 5th of each month since round 35; one run fits about 8 requests in 60 s, and a run with nothing left to do spends nothing), and the round 7 jobs: `holler-ai` (hourly at minute 4), `holler-monitor` (hourly at minute 11, the health route with `?monitor=1`), `holler-lifecycle` (hourly at minute 17), `holler-moat` (daily 18:41 UTC) and `holler-events-prune` (Sundays 04:29 UTC, plain SQL that deletes funnel events older than 400 days). No two jobs start in the same minute.
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


## Keyword volume and location mode (round 35)

Why: `holler_keyword_volume` has 0 rows because the monthly job never ran. This repo has no vercel.json: every cron is a pg_cron job that the owner creates by running `supabase/cron.sql` by hand in the Supabase SQL editor, so the job only exists once that file has been run. Search volume is a planning signal for where to market or expand, not a count of customers. Google gives city level volume only (a ZIP returns nothing).

What it does, all behind `HOLLER_KEYWORD_VOLUME_ENABLED`:

- Location mode (`lib/dataforseo/location-volume.ts`): plain trade words (landscaping, lawn care, gutter installation, pressure washing) with the city as the request location (`location_name` "Marietta,Georgia,United States"), one Live request per city, for the core city and nine suburbs of Atlanta, Austin, Charlotte and Raleigh: 40 requests a month. The national "<trade> <city>" refresh is unchanged.
- Owner view, no public page: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/admin/keyword-volume"` lists per trade the top cities by monthly searches and each city's 12 month trend. Options: `?trade=landscaping|lawn-care|gutters|pressure-washing`, `?metro=atlanta|austin|charlotte|raleigh`, `?limit=1..50`. Empty until one monthly run has stored rows.

Cost (USD 0.075 per Live task, any keyword count up to 1000; the cap `DATAFORSEO_MONTHLY_CAP_USD`, default 30, still stops everything):

| Step | Tasks | Estimate a month |
|---|---|---|
| Location mode | 40 cities x 1 task | 3.00 |
| National volume | about 40 batches | 3.00 |
| AI mention check | 9 calls | about 1.1 (unverified price) |
| Total | | about 7.1, under 10 |

Owner steps, in order:

- [ ] Optional, any time: run `supabase/migrations/0040_holler_keyword_volume_location.sql` (adds `location_name` and `monthly_searches`). Without it everything works and the owner view shows one trend point per month the job has run; with it, the first run also stores Google's last 12 months per city. Check: `select column_name from information_schema.columns where table_name = 'holler_keyword_volume';` lists both.
- [ ] Run `supabase/cron.sql` again (step 7) so `holler-dataforseo` is scheduled (1st to 5th of the month). Check: `select jobname, schedule, active from cron.job where jobname = 'holler-dataforseo';` returns one active row. Until the switch is on the job answers `disabled` and spends nothing.
- [ ] Dry run, no spend, switch still off: `curl -s -H "Authorization: Bearer <CRON_SECRET>" "<SITE>/api/cron/dataforseo?dry=1"` shows `enabled: false`, `expectedMonthlyUsd.total` (about 7.1) and the cap.
- [ ] Set `HOLLER_KEYWORD_VOLUME_ENABLED=1` (Vercel, Production) and redeploy. Next 1st of the month the job runs; or run it once by hand without `?dry=1` and read `location.status` (`time_budget` until all 40 cities are stored, then `complete`) and `location.unknownLocations` (a city name Google does not list; it is marked empty for the month, fix the name in `LOCATION_METROS`).
- [ ] To stop: empty the switch (no spend from the next call) or `select cron.unschedule('holler-dataforseo');`.

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
- [ ] Settings shows monthly and yearly options and the "Paying yearly saves 16%." line when Stripe is configured. The trial banner says 60 days left (the site headline says 2 months) and the welcome email says "60-day free trial".
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
- [ ] App Store Connect and Play Console: create the four subscriptions with those product ids, with no introductory offer (every member already gets the 60-day trial at sign-up, and the /pricing FAQ says a plan bought in the app is charged when you buy it). If you add a store free trial, change that FAQ answer first. `mobile/STORE-SETUP.md` has the full steps (step 5 is this choice).
- [ ] Check: send a TEST event from RevenueCat. The response must be 200 `{"ok":true,"ignored":"test"}`. Then, with `REVENUECAT_ALLOW_SANDBOX=1`, buy in sandbox: `holler_billing_events` gets one `applied` row, and `/api/m/me` shows `paid`.
- [ ] Push needs no new cron job. It rides the existing `holler-notify` job (every 15 minutes), at most one push an hour per member. It does not depend on the email digest: a member with email alerts off or an unconfirmed address still gets pushes.
- [ ] Before App Review, if the app offers Sign in with Apple: Apple requires the server to revoke the member's Apple tokens when they delete their account (POST https://appleid.apple.com/auth/revoke). The server cannot do this yet. It needs `APPLE_TEAM_ID`, `APPLE_SIGN_IN_KEY_ID`, `APPLE_SIGN_IN_PRIVATE_KEY` and `APPLE_CLIENT_ID` in Vercel, plus a step where the app sends Apple's authorization code at sign-in so the server can keep a refresh token to revoke (see the comment in lib/mobile/account.ts). Until then, delete account removes all Holler data but not the Apple link. Decide before submitting.

## Know before you launch

- Past-due payments: someone whose card fails keeps app access during Stripe's retry window, and their email digests wait (they are held, not dropped) until the payment recovers. If Stripe gives up, the subscription is canceled and alerts stop.
- Holler shares sign-in with the other product. A Holler password reset changes the password for both.
- Password change protection is for Holler's own route only: `POST /api/auth/reset` needs a reset link opened in the last 15 minutes (a signed `holler_recovery` cookie, or a recovery sign-in on the session). Someone holding a stolen session token can still call Supabase Auth directly and change the password. Closing that needs Supabase Auth "Secure password change" (reauthentication), a project-wide setting that also affects the other products on the shared project: your decision. A member who waits more than 15 minutes on `/reset` sees "This reset link has expired" and asks for a new link. Holler server calls to sign in all come from Vercel's network, so the sign-in provider's per-IP limit is shared by all Holler users; Holler has its own per-IP limit in front of it.
- Email is never sent from a default address. If `EMAIL_FROM` is missing, digests, verify emails, password resets and the health email are all skipped and the routes say so.
- The health email is the alarm. If it stops arriving, check that `holler-health` still exists in `cron.job`. The hourly ingest monitor (`holler-monitor`) emails only when ingest breaks; if migration 0018 is missing it sends nothing, and the daily health email remains the safety net.

## SAM.gov backfill and notice labels (round 33)

NEEDS KUDZI. Nothing here has been run against production. Two switches, both OFF by default.

1. `HOLLER_SAM_LABELS_ENABLED` (off unless `1`, `true`, `on` or `yes`). Off, every card, email and app answer is exactly what it was before
   round 33. On, a federal notice card says in plain words what the notice itself says, in English and Spanish: an early notice (Sources
   Sought, Presolicitation, Intent to Bundle: "Early notice: the agency is asking who could do this work. Not open for offers yet.") and its
   set-aside ("Set aside for small businesses"); a sole-source notice reads "Planned sole source to one ... business. Not open for offers" and
   is routed as a heads-up (coming soon), never act now; the alert email's closing line changes only for a card that shows a set-aside. This
   switch changes which label a sole-source notice gets, so it can lower the count of act-now cards; it adds no alert. Read the wording once
   in Preview before turning it on. The set-aside CODE is stored in `holler_signals.data.setAside` by the cron whatever the switch says (no
   migration, nothing shown); notices stored before this change have none, so a card with no set-aside line is not proof of an open competition.
   Round 34 switch audit: this switch is INLINED AT BUILD (next.config.ts `env`, lib/build-switches.ts), because the feed card in the browser
   reads it too (before, the browser never saw it and the card's reason line flipped back after the page loaded). Changing it in Vercel does
   nothing until you redeploy. An instant rollback (or promoting an earlier Production deployment) serves that build as it is, with the
   value it was built with, whatever Vercel shows now. Promoting the Preview deployment you read the wording on is a new build with the
   Production variables: set the switch in Production before you promote, or it comes out off. Off again: empty it and redeploy.
2. `HOLLER_SAM_BACKFILL_ENABLED` (off unless `1`, `true`, `on` or `yes`; only the owner's script reads it). The backfill reads still-open
   notices posted in the last 90 days, one request per state and procurement type (GA, TX, NC, SC, AZ, CA, DC, DE, FL, IL, MD, NJ, NY, PA, VA;
   types o, k, r, p: 60 tasks, more when a state has over 1,000). Documented limit (`open.gsa.gov/api/entity-api`): 10 requests a day for a
   key with no SAM.gov role, 1,000 with one. THE CRON ALREADY USES UP TO 6 OF THE 10 (twice a day, up to 3 pages), so the default budget is 1
   request a day (60 days for the whole list). Check the key's role on the SAM.gov Account Details page first: with a role, use `--daily-budget 150`.
   Known gap: `rdlfrom` very likely leaves out notices that have no response date (about 11% of stored Presolicitations); a second pass for
   ptype p and r without `rdlfrom` would cost 30 more requests and is not built.
3. Commands (from a checkout with the Production env pulled into the shell, never committed):
   - `npm run sam:backfill -- --plan` (no request, no write; shows the plan)
   - `HOLLER_SAM_BACKFILL_ENABLED=1 npm run sam:backfill -- --run --dry` (makes real requests, writes nothing, marks no task done: the real run still reads every task)
   - `HOLLER_SAM_BACKFILL_ENABLED=1 npm run sam:backfill -- --run` (stores the notices; the same command resumes tomorrow from `sam-backfill-state.json`, which is git-ignored)
   - key with a SAM role: add `--daily-budget 150`. `--daily-budget` and `--max-requests` must be whole numbers of 1 or more. Add `--no-match` to store without adding the notices to members' feeds.
   Notices are marked `data.backfill` and added to members' feeds quietly (history only: no email, no push, also not by the hourly AI step).
