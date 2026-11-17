# Holler round 2: the contract for this round (read SPEC.md first; this file wins where they differ)

## Why this round exists
Holler sells $5/month alerts to local businesses, nationally, with no sales team. That only works if a stranger
gets value in the first minute and the site finds its own traffic. Round 1 built the engine. Round 2 fixes the
four things that would stop it from working, without adding moving parts:

1. First-minute value. Today a new user sees an empty feed and waits. Fix: a free "check your area" tool before
   signup, and a feed that is already filled at first login.
2. Traffic that matches real searches. Nobody searches "what's happening in Atlanta". They search "Atlanta
   building permits" or "hail reports Marietta". Retarget city pages and add one page per trade.
3. Coverage. Only 10 cities have permits/311 data and Atlanta has none. Add verified cities and three new
   record types that reach business-to-business trades.
4. Nothing may fail silently. Real API shapes for every adapter, drift detection, a daily health email, a
   one-command smoke test, and a launch runbook.

## Rules for every worker
- Next.js 16 with `cacheComponents: true`: no `export const dynamic` / `revalidate`. Read AGENTS.md and the docs
  in node_modules/next/dist/docs before framework code.
- Touch ONLY the paths listed for your unit. Do not edit package.json. Do not run `git commit`, `git stash`,
  `git checkout` or `next build` (five workers share this tree; the commander builds and commits).
- Verify with `npx tsc --noEmit` (errors caused by another unit's in-flight files: list them, don't fix them),
  `npx eslint <your paths>`, and `npx vitest run <your test dirs>`.
- The sandbox shell cannot reach the internet. WebFetch and WebSearch can. Never invent an API field, dataset ID
  or URL: fetch it, or mark it `assumed` and keep the feature disabled.
- Copy rules from SPEC.md apply (no em dashes, banned words, no invented numbers, no testimonials). New public
  pages must pass `python3 /home/claude/gates/prose_metrics.py <rendered html>` when the commander renders them:
  vary sentence length (some 20 to 30 words, some 3 to 6).
- Price: $5 a month or $48 a year, 7-day free trial, no card to start.
- Hand back: files changed, per-criterion status with evidence, sourced vs assumed, anything you could not do.

## Shared contracts (exact)
- Env: `SUPPORT_EMAIL` (reply-to and legal pages), `ADMIN_EMAIL` (health email; falls back to SUPPORT_EMAIL).
  Both already exist in lib/env.ts. `ENV_KEYS` is exported from lib/env.ts.
- Categories (U3 owns lib/signals/categories.ts): each entry gains `group: 'home'|'storm'|'auto'|'business'|'food-events'|'other'`.
  New ids added this round: fencing, concrete-paving, windows-doors, siding-gutters, flooring, handyman,
  signs-printing, business-services, public-adjuster. Everyone else reads labels/groups from CATEGORIES; nobody
  keeps a private copy of the list.
- Socrata/ArcGIS record subtypes in `data.subtype`: 'permit' | '311' | 'inspection' | 'business' (new business
  license, kind 'civic') | 'violation' (code/building violation, kind 'civic') | 'event-permit' (kind 'event').
- View `holler_place_counts(place_slug, signals_60d, latest_at timestamptz)` (U4 adds latest_at in migration 0003).
- Checkout: POST /api/stripe/checkout with JSON `{ plan: 'monthly' | 'annual' }` (default monthly).
- Backfilled matches are inserted with `notified = true` so the first email never dumps old items.
- Silent-empty rule: any adapter that receives N > 0 raw rows and parses 0 items must call
  `ctx.log('error: parsed 0 of N rows, shape may have changed')` (run.ts already turns error-like logs into
  status `error`).

## Units and ownership
U1 First-minute value: lib/signals/backfill.ts, lib/signals/match.ts (exports only), lib/check/**, app/check/**,
   components/check-*, app/page.tsx, components/example-alert*, app/onboarding/actions.ts,
   app/app/settings/actions.ts, app/app/page.tsx, components/feed.tsx, tests/check/**, tests/signals/core/backfill.test.ts
U2 Search-matched SEO: app/local/**, app/for/**, lib/seo/**, app/sitemap.ts, app/robots.ts, app/llms.txt/**,
   proxy.ts, components/footer*, components/top-nav*, tests/geo/**, tests/seo/**
U3 Coverage: lib/signals/categories.ts, lib/signals/adapters/socrata*.ts, lib/signals/adapters/arcgis*.ts,
   lib/signals/registry.ts, lib/signals/source-meta.ts, tests/signals/adapters/socrata*.test.ts,
   tests/signals/adapters/arcgis*.test.ts, tests/fixtures/socrata*, tests/fixtures/arcgis*,
   tests/signals/core/categories.test.ts, tests/signals/core/source-meta.test.ts
U4 Bulletproof ops: lib/signals/run.ts, lib/signals/store.ts, app/api/cron/**, lib/email/**, lib/stripe/**,
   app/api/stripe/**, app/app/settings/page.tsx, components/billing-button*, components/profile-form*,
   app/onboarding/page.tsx, app/privacy/**, app/terms/**, supabase/migrations/0003_*, supabase/cron.sql,
   .env.example, LAUNCH.md, scripts/smoke.mjs, tests/money/**, tests/ops/**,
   tests/signals/core/{run,route,migration}.test.ts, /home/claude/gates/pg/migtest.mjs
U5 Real API contracts: lib/signals/adapters/{nws,spc,fema,usgs,faa,usaspending,sam,ticketmaster,bluesky,websearch}.ts,
   tests/fixtures/{nws,spc,fema,usgs,faa,usaspending,sam,ticketmaster,bluesky,websearch}*,
   tests/signals/core/adapters.test.ts, tests/signals/adapters/{usaspending-sam,ticketmaster,bluesky-websearch,robustness}.test.ts

## Spec attack (things that pass the criteria above and are still wrong)
- A free checker keyed on raw ZIP gives 41,000 x 41 cache keys and lets a bot hammer the shared database.
  Key the cached query on (nearest city slug, trade), at most a few tens of thousands of keys, one hour lifetime,
  one indexed query each, hard row limit.
- The checker must never say "0 results" in a way that sells against us: when an area has no data yet, say what
  Holler watches there and when it last checked, and still offer the trial.
- Backfill that runs on every settings save can insert hundreds of rows: cap 25, last 14 days, unexpired only,
  idempotent upsert, never throws into the user's save.
- A city page title that promises "building permits" for a city with no permit feed is a lie and a bounce.
  Titles name only record types that the city actually has in the last 60 days.
- 41 trade pages with one template and swapped nouns are thin duplicate pages. Each trade page needs its own
  facts (which signals matter to that trade and why, in concrete terms) plus live examples, and stays noindex
  until it has live examples to show.
- A new dataset verified only by its metadata page can still return nothing. Every new dataset ships with the
  silent-empty rule and shows up in the daily health email after its first empty day.
- The health email must be boring when healthy and loud when not: problems first, one line per broken source.
- An annual plan that forgets the trial end would charge on day one. Same trial rules as monthly.
