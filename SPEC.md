# Holler: build spec (the contract every worker builds to)

## Product in one paragraph
Holler tells local businesses when their area needs them. It watches public data (weather alerts, hail reports, disasters, building permits, 311 complaints, failed health inspections, federal contracts, big events, airport delays) and public posts where people ask "anyone recommend a ___ near ___?". A business picks what it does and where it works. Holler sends a short alert when something nearby matches. $5/month after a 7-day free trial, no card to start. It never posts anything for the user and never touches anyone's social accounts.

Every city also gets a free public page ("What's happening in Atlanta, GA") built from the same data. Those pages are the SEO and AI-search engine: real, fresh, cited local information in one place, with a call to action to get alerts.

## Positioning vs Bazzly (use in copy, never name Bazzly on the site)
- They charge $199/mo; Holler is $5.
- They watch one site; Holler watches 10+ public sources.
- They sell upvotes and post from bought accounts; Holler never posts for you, so there's nothing to get banned.
- They serve SaaS founders; Holler serves roofers, plumbers, cleaners, food trucks, drivers: people with a truck, not a pitch deck.

## Stack (already installed; do NOT edit package.json, ask the commander via your exception object if you need a package)
Next.js 16 (App Router, React 19, TypeScript, Tailwind v4), @supabase/ssr + @supabase/supabase-js, stripe, resend, ai (Vercel AI SDK v7, use model string "anthropic/claude-haiku-5.5" through the AI Gateway), zod 4, vitest, zipcodes, all-the-cities.
IMPORTANT: this Next.js version has breaking changes from what you may remember (for example `middleware.ts` may be `proxy.ts`, request APIs like `cookies()`/`params` are async). Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code.

## Environment variables (every module must work, or degrade with a clear message, when an optional one is missing)
Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL, CRON_SECRET
Optional: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, EMAIL_FROM, AI_GATEWAY_API_KEY (on Vercel, OIDC auth works without it), BRAVE_SEARCH_API_KEY, SERPER_API_KEY, SAM_API_KEY, TICKETMASTER_API_KEY, SOCRATA_APP_TOKEN
Read env only through `lib/env.ts` (commander-owned, see below).

## Database contract (Postgres on Supabase, shared project, so EVERYTHING is prefixed `holler_` in schema `public`; never touch any other table)
```sql
holler_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null,
  categories text[] not null default '{}',      -- CategoryId values
  zip text, city text, state text, lat double precision, lon double precision,
  radius_mi int not null default 25 check (radius_mi between 5 and 100),
  alert_email boolean not null default true,
  subscription_status text not null default 'trialing', -- trialing|active|past_due|canceled
  trial_ends_at timestamptz not null default now() + interval '7 days',
  stripe_customer_id text, stripe_subscription_id text,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
)  -- RLS: owner can select/insert/update own row
holler_signals (
  id bigserial primary key,
  source text not null, external_id text not null, unique (source, external_id),
  kind text not null, -- ask|alert|report|permit|civic|contract|event|disaster|quake|travel
  title text not null, summary text, url text,
  lat double precision, lon double precision, city text, state text, county text, zip text,
  place_slug text,                -- nearest CITIES slug, e.g. 'atlanta-ga' (null if none within 40 mi)
  categories text[] not null default '{}',
  severity smallint not null default 1 check (severity between 1 and 3),
  occurred_at timestamptz not null, expires_at timestamptz,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
)  -- RLS: anyone (anon, authenticated) may SELECT; only service role writes
   -- indexes: (place_slug, occurred_at desc), (state, occurred_at desc), gin(categories), (occurred_at desc)
holler_matches (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_id bigint not null references holler_signals(id) on delete cascade,
  distance_mi real, status text not null default 'new', -- new|saved|done|dismissed
  draft text, notified boolean not null default false,
  created_at timestamptz not null default now(), unique (user_id, signal_id)
)  -- RLS: owner can select/update own rows
holler_scan_runs (id bigserial pk, source text, started_at timestamptz, finished_at timestamptz,
  fetched int, inserted int, matched int, error text)  -- RLS on, no policies (service role only)
```

## Shared code contracts (exact names; import these, don't redefine them)

`lib/env.ts` (commander writes it): `env` object with every variable above as `string | undefined`, plus `hasEnv(...keys): boolean`.

`lib/signals/types.ts` (W2 owns):
```ts
export type SignalKind = 'ask'|'alert'|'report'|'permit'|'civic'|'contract'|'event'|'disaster'|'quake'|'travel';
export type Severity = 1|2|3;
export interface SignalInput {
  source: string; externalId: string; kind: SignalKind; title: string;
  summary?: string|null; url?: string|null;
  lat?: number|null; lon?: number|null; city?: string|null; state?: string|null; county?: string|null; zip?: string|null;
  categories: CategoryId[]; severity: Severity; occurredAt: string; expiresAt?: string|null;
  data?: Record<string, unknown>;
}
export interface AdapterContext { since: Date; fetch: typeof fetch; env: Record<string,string|undefined>; log: (m: string) => void; }
export interface Adapter {
  id: string; label: string; kind: SignalKind; cadenceMinutes: number;
  requiresEnv?: string[]; sourceUrl: string; // human-readable source home page, shown on public pages as citation
  fetch(ctx: AdapterContext): Promise<SignalInput[]>;
}
```
Every adapter file in `lib/signals/adapters/` exports `export const adapters: Adapter[]` AND exports its pure parser(s) (`parseXxx(raw: unknown): SignalInput[]`) so tests run against fixtures without network. Adapters set a descriptive User-Agent: `Holler/1.0 (+https://<site>/about; contact@holler)` where required (NWS requires one). Every fetch has a timeout (AbortSignal.timeout(15000)) and never throws out of `fetch()`: on error log and return [].

`lib/signals/categories.ts` (W2 owns): `CategoryId` union, `CATEGORIES: {id, label, keywords: string[]}[]` (about 32 local trades incl. roofing, hvac, plumbing, electrical, tree-service, landscaping, lawn-care, snow-removal, pest-control, cleaning, restoration, general-contractor, painting, pool-spa, solar, auto-glass, auto-body, towing, auto-repair, moving, junk-removal, locksmith, real-estate, insurance, food-truck, catering, event-services, rideshare-delivery, childcare, beauty, janitorial-commercial, security), and `classifyText(text): CategoryId[]` keyword classifier.

`lib/geo/index.ts` (W4 owns): `lookupZip(zip): {zip,city,state,lat,lon}|null`, `CITIES: City[]` where `City = {slug,name,state,stateName,lat,lon,population}` (US cities pop ≥ 50k, generated JSON), `cityBySlug(slug)`, `citiesInState(code)`, `STATES: {code,name,slug}[]`, `stateBySlug(slug)`, `nearestCity(lat,lon,maxMi=40): City|null`, `haversineMi(lat1,lon1,lat2,lon2)`.

`lib/supabase/` (W1 owns): `createClient()` server (cookie session), `createBrowserClient()` client, `createAdminClient()` service role (server only, `import 'server-only'`).

## Units and file ownership (touch ONLY your paths; ownership gate checks this)
- W1 app-ui: `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `components/**`, `app/(auth)/**`, `app/auth/**`, `app/api/auth/**`, `app/onboarding/**`, `app/app/**`, `app/about/**`, `app/privacy/**`, `app/terms/**`, `lib/supabase/**`, `lib/auth/**`, `middleware.ts` or `proxy.ts`, `public/` images/icons (not llms.txt).
- W2 engine + hazards: `lib/signals/types.ts`, `categories.ts`, `registry.ts`, `run.ts`, `match.ts`, `store.ts`, adapters `nws.ts`, `spc.ts`, `fema.ts`, `usgs.ts`, `faa.ts`; `app/api/cron/scan/**`; `supabase/migrations/**`; `vercel.json`; `vitest.config.ts`; `tests/signals/core/**`, `tests/fixtures/{nws,spc,fema,usgs,faa}*`.
- W3 civic + commerce adapters: `lib/signals/adapters/{socrata,usaspending,sam,ticketmaster,bluesky,websearch}.ts` (+ `socrata-datasets.ts` config), `tests/signals/adapters/**`, `tests/fixtures/{socrata,usaspending,sam,ticketmaster,bluesky,websearch}*`.
- W4 SEO + geo: `lib/geo/**`, `scripts/**`, `app/local/**`, `app/sitemap.ts`, `app/robots.ts`, `app/llms.txt/**`, `lib/seo/**`, `tests/geo/**`.
- W5 money + mail + AI: `lib/stripe/**`, `app/api/stripe/**`, `lib/email/**`, `app/api/cron/notify/**`, `lib/ai/**`, `app/api/draft/**`, `tests/money/**`.

## Behaviour requirements
1. Auth: email + password. Signup goes through `app/api/auth/signup` which uses the admin client `auth.admin.createUser({email,password,email_confirm:true})` then signs in (this avoids the shared project's CloverMap-branded confirmation emails). Password reset: `auth.admin.generateLink({type:'recovery'})`, take `properties.hashed_token`, email our own link `/auth/confirm?token_hash=…&type=recovery&next=/reset` via `lib/email` (W5 exports `sendEmail`), and `/auth/confirm` calls `verifyOtp`. Rate-limit-friendly errors, never leak whether an email exists on reset.
2. Onboarding (3 fields, one screen): business name, what you do (category chips, pick up to 5), ZIP + radius (5–100 mi, default 25). Geocode ZIP with `lookupZip`. Then go to /app.
3. Dashboard `/app`: feed of the user's matches newest first, filters All / People asking / Signals, card shows source label, time ago, distance, title, 1–2 line summary, actions: Open source (new tab), Draft reply (asks only; calls /api/draft), Save, Done, Dismiss. Empty state explains scans run every 15–60 min and links to their public city page. Trial banner with days left; after trial and not active, feed is blurred behind a $5/mo upgrade card.
4. Settings `/app/settings`: edit onboarding fields, email alerts toggle, billing (Stripe Checkout / Portal; if Stripe env missing show "Billing opens soon, you're on the free trial"), sign out, delete account.
5. Scanner: `/api/cron/scan` (GET, `Authorization: Bearer CRON_SECRET`, or `?key=`), optional `?source=id` and `?dry=1` (fetch + parse, no writes, returns counts and 3 sample titles per source: this is our live probe). Runs each due adapter (cadence vs last holler_scan_runs row), upserts signals with `on conflict do nothing`, sets place_slug via nearestCity, matches NEW signals to profiles (category overlap AND within radius when signal has lat/lon; state-level signals without coordinates match profiles in that state), inserts matches, logs a scan_runs row. Budget: whole run < 50 s; adapters run in parallel with per-adapter timeout. Prune signals older than 120 days once a day.
6. Notify: `/api/cron/notify` (same auth) emails each user with new un-notified matches, at most one email per user per 60 min, plain digest, unsubscribe link (sets alert_email=false via signed token). Marks matches notified.
7. Billing: Stripe Checkout subscription, $5/mo via inline `price_data` (no pre-made price needed), customer created per user, `client_reference_id=user_id`; webhook (raw body, signature verified) updates subscription_status. Portal for manage/cancel.
8. Draft reply: `/api/draft` (auth required, owner of match) → AI Gateway haiku-5.5, 2–3 sentence helpful reply in a neighborly tone, mentions the business once, no links, no hype; falls back to a template if AI unavailable. Store in holler_matches.draft.
9. Public SEO pages: `/local` (all states), `/local/[state]` (cities in state with signal counts), `/local/[state]/[city]` "What's happening in {City}, {ST}": sections for active weather alerts, storm reports, disasters, permits, 311, inspections, federal contracts, events, airport status, people asking (titles + link out only); each item cites its source with link; a "who this helps" block mapping recent signals to trades; FAQ; CTA to start a free trial pre-filled with the city. Server-rendered with `revalidate = 21600` (6 h) to protect the shared DB. `noindex` when the page has fewer than 5 signals in 60 days (no thin pages). JSON-LD: Place + FAQPage + BreadcrumbList (+ ItemList of recent items). `sitemap.ts` lists only indexable city pages (query counts by place_slug, cached). `robots.ts` allows all, points to sitemap. `/llms.txt` describes the site and links state pages.
10. Rate and legality: only official APIs/open data and licensed search APIs. No scraping of sites that forbid it, no LinkedIn/Facebook/Nextdoor/Craigslist, no Reddit API. People-asking items store only title, snippet, URL from the search API.

## Design system (W1 sets tokens in globals.css; everyone uses them)
Simple, calm, confident. Lots of whitespace, one accent. Mobile first; every screen must work at 375 px.
- Colors: background `#FBFAF7` (warm paper), surface `#FFFFFF`, ink `#16181D`, muted `#5D6470`, line `#E7E4DD`, accent `#E8590C` (signal orange) with hover `#C94A08`, success `#2F8F5B`, warn `#B7791F`, danger `#C53030`. Dark mode not required.
- Type: Geist Sans for UI, Geist Mono for numbers/timestamps. Sizes: 14/16/18/24/36/56. Headline letter-spacing -0.02em.
- Radius 12 px cards, 999 px chips/buttons. Shadows: one soft shadow only (`0 1px 2px rgb(0 0 0/.04), 0 4px 16px rgb(0 0 0/.04)`).
- Components: Button (primary/secondary/ghost), Chip (toggle), Card, Badge (per signal kind, each kind gets a quiet tinted color), Input, Select, Slider, EmptyState, TopNav, Footer.
- Accessibility: WCAG AA contrast, focus rings visible, labels on every input, 44 px tap targets.

## Copy rules (deslop gate measures these)
Plain, specific, human. No em dashes (—). Banned words: unlock, supercharge, seamless, elevate, game-changer, revolutionize, leverage, empower, cutting-edge, robust, harness, delve, effortless, journey, "in today's". Vary sentence length; short sentences are fine. Use concrete examples ("Quarter-size hail hit Marietta at 4:12 pm"). Never claim numbers we don't have (no fake user counts, no testimonials).

## Done means (per unit)
`npx tsc --noEmit` passes for your files, `npx vitest run` passes for your tests, `npx next build` is not broken by your files (if another unit's missing file blocks the build, say so), and you list every file you created.

## Spec-attack addendum (things that would pass the rules above but still be wrong)
- A broken adapter that returns [] looks identical to a quiet day. Every parser test must assert a non-zero count on a realistic fixture, and `?dry=1` reports per-source `ok|error|skipped(env)` plus counts so the live probe can tell broken from quiet.
- Fixtures you invent can make a parser pass that fails on the real API. For each fixture, write in the test file header where its shape came from (official docs URL or a fetched sample) and label it `sourced` or `assumed`.
- Signals with no coordinates must not spam a whole state: they only match profiles in that state when categories overlap AND severity >= 2. NWS alerts: use polygon centroid when geometry exists.
- Cap new matches per user per scan at 25, newest/most severe first.
- Do NOT put crons in vercel.json (plan limits unknown); the commander schedules the two cron routes.
- Public pages must never show user data (profiles, matches). Only holler_signals.
