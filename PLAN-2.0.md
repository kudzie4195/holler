# Holler 2.0 — Plan of record (unbuilt work only)

**Date:** Nov 19, 2026 · **Owner:** Kudzi · **Status:** active
**Built from:** LocalHoller 2.0 Strategy doc (Nov 19), the alert-quality audit of 14 days of live data (Nov 19), and the permit-source column audit (Nov 19).
**Rule:** this file lists only what is NOT built yet. When an item ships, delete it here and note it in ROUND/LAUNCH docs.
**Not in scope here (another chat owns it):** pricing ($7.99 / $13.99), App Store, Google Play, RevenueCat, `mobile/`.

---

## 1. What changes and why

Holler stops being an alert feed and becomes an **opportunity engine**: every card says what happened, why it matters to this trade, what to do, how we know, and what is uncertain.

The 14-day audit showed why today's alerts feel weak:

| Finding | Evidence (live DB, Nov 19) |
|---|---|
| A permit goes to the trade that already won the job | Roof permits → roofers (645), HVAC permits → HVAC (1,060), electrical → electricians (1,594) |
| Most 311 is city work, not private demand | Painters: 867 of 1,051 are public graffiti. Tree service: 428 "Tree Trim Request (NO LONGER BEING ACCEPTED)". Plumbing: sewer/catch-basin requests |
| Business licences are blanket-tagged | 517 each to locksmith, insurance, business-services |
| The best signals are buried | NYC no heat/hot water (887), code violations (~250), failed food inspections (77), wind/hail damage reports (20), sewage back-ups (~100) |
| Almost nothing names anyone | 3.6% of permits have a named company. 19 of 21 permit sources have no contact extractor |

## 2. Already built — do not rebuild

Signup backfill (empty-feed fix) · intent labels (`lib/signals/intent.ts`: demand / spending / asking) · AI notes + ranking (`lib/ai`, spend cap) · source health (`holler_source_health`) · raw archive before prune (`holler_signal_archive`) · private contacts table (`holler_signal_contacts`, companies only) · feedback + outcome follow-up emails (`lib/moat`) · training log (`holler_alert_log`) · resident requests (`/request`) · honest "nothing yet" state (`lib/check/watch.ts`) · push + digest · Coming next interest cards · ~~"Coming to your area" waitlist~~ (the `area-waitlist` branch was never pushed and is lost; rebuilt as item 0.5).

The strategy doc's Days 8–14 (provenance, source health, raw records) are mostly done. Evolve these tables; do not create a parallel `sources / source_records / opportunities` schema.

## 3. Opportunity taxonomy (new)

Every signal gets ONE label **per trade**. The label decides delivery. It extends `intent.ts`; it does not replace it.

| Label | Meaning | Delivery | Examples |
|---|---|---|---|
| **Act Now** | Someone must or has asked to buy, with a deadline | Instant push/email, top of feed, deadline shown | Open solicitation; code violation with a fix-by date; NYC no-heat building; failed food inspection (pest/cleaning); sewage back-up; wind/hail damage report; private-property graffiti; resident request on Holler |
| **Coming Soon** | Evidence of likely future demand | Daily digest | Another trade's permit (downstream); final inspection / certificate of occupancy; new business with 2+ corroborating records |
| **Market Insights** | Trend or competitor activity | Weekly email | Permits in your own trade ("who is winning roofs near you"); awarded contracts; area trend vs baseline |
| **Context** | City work, public property, generic records | Never alerted; SEO pages only | Public graffiti, city tree trims, sewer/catch basin, debris in right of way, missed trash, rodent baiting on public land, tree planting, permitted park events |

Wording rule (from the strategy): never say "lead", "they need you" or "you will win". A weather event never proves damage; a permit never proves a vendor is being chosen.

## 4. Backlog by phase

Each item has an acceptance check. Run `/bug-bash` before any item is called done.

### Phase 0 — before launch (target Mon Nov 23)

| # | Item | Acceptance |
|---|---|---|
| 0.1 | **Lead-rules table** `holler_lead_rules` (source + subtype/title pattern × trade → label). Seed from the audit above | Every source/subtype has a rule; unknown = Context; tests cover every registered source |
| 0.2 | **Turn off Context alerts** | Painter, tree-service and plumbing feeds contain zero public-work rows in a 14-day replay |
| 0.3 | **Required-repairs playbook → Act Now** (violations, NYC heat, failed inspections, sewage back-up, damage reports) with deadline where the record has one | Shows first in feed and digest; deadline shown or "no deadline published" |
| 0.4 | **Brief card v1**: What happened · Why it matters (trade-specific) · Next step · Source + date · **What's uncertain** + confidence ("High that the inspection failed; vendor need unconfirmed") | Every card renders all five parts; no card without a source link |
| 0.5 | **Merge waitlist** (`area-waitlist`) and run migration 0021 | LAUNCH.md check passes |
| 0.6 | **Quality gate:** grade 50 random cards across 5 trades | ≥ 80% pass factual + relevance review; failures fixed or rule changed |

### Phase 1 — week 1

| # | Item | Acceptance |
|---|---|---|
| 1.1 | **Downstream permit routing** (matrix below). Same-trade permits move to Market Insights | 14-day replay: roofers get 0 roof permits as alerts |
| 1.2 | **Contractor extractors** Tier A: Orlando (name + phone), Raleigh (company, phone, license), DeKalb (primary contact, companies only), Dallas. Tier B: NYC (applicant/owner business + license), DC, NOLA, Buffalo, Seattle, Baton Rouge. Never homeowner phones (e.g. Mecklenburg owner_phone) | Named-company rate on permits ≥ 30% (from 3.6%) |
| 1.3 | **Site-address rows** for every permit with an address; **project value** read where published | ≥ 85% of permits carry value; address-only cards offer the owner-letter template |
| 1.4 | **Cobb residential permits** (Accela dashboard layer 4) | Signals flowing; Smyrna roofer test shows Coming Soon cards |
| 1.5 | **SAM.gov open opportunities** adapter (Playbook A). Verify API key, terms and rate limits first. Match on NAICS + place of performance + deadline. Existing USAspending awards → Market Insights | Open solicitations near Atlanta appear as Act Now with deadline; nothing labelled eligible unless the notice says so |
| 1.6 | **Atlanta pilot recruitment:** 10 businesses (landscapers, commercial cleaners, small subcontractors). Free in exchange for weekly feedback | 10 signed up; interview notes in `marketing/pilot/` |

**Downstream matrix (1.1):**

| Permit / stage | Coming Soon for |
|---|---|
| Re-roof | Gutters, siding, solar, junk removal; roofers get "homes within 0.3 mi" as Market Insights |
| New home / new construction | Movers, landscaping, fencing, cleaning, security, pool, windows/doors |
| Remodel / addition | Flooring, painting, cleaning, junk removal, handyman |
| Solar | Electrical, roofing inspection |
| Demolition | Junk removal, fencing, concrete |
| Commercial build-out / tenant improvement | Commercial cleaning, signs, security, pest control, IT |

### Phase 2 — week 2

| # | Item | Acceptance |
|---|---|---|
| 2.1 | **Construction stage tracking** (Playbook B): store permit status history; emit Coming Soon on final inspection / certificate of occupancy for cleaners, landscapers, security | Stage change creates one update, not a new lead each time |
| 2.2 | **Watchlists**: save a project, address, territory or procurement category; notify only on meaningful change (new stage, deadline amendment, closure, new evidence) | No duplicate alerts for the same project across sources |
| 2.3 | **Dedupe + corroboration**: separate duplicate records from independent evidence; link to one project only on stable IDs or strong match | Duplicate rate measured per source; Austin E 14th St double rows gone |
| 2.4 | **Source states** Healthy / Delayed / Degraded / Unavailable on top of `holler_source_health`; show coverage gaps honestly on the check page and in the app | Stale source shows a notice; never presented as full coverage |
| 2.5 | **AI classify permits + civic** (today AI runs on weather only): trade label check, trade-specific "why it matters", citations only, no invented facts | 0% → 100% of new permits/civic; spend under cap |
| 2.6 | **NYC managing agent** on no-heat cards (HPD Registration Contacts: corporate owner / managing agent, company names only) | ≥ 60% of NYC heat cards show a company |
| 2.7 | **Deterministic score v1** (contact +30, value > $10k +20, fresh < 48h +20, trade fit +20, low competition +10); feed sorted by label then score | Score visible in admin; documented in code |

### Phase 3 — week 3

| # | Item | Acceptance |
|---|---|---|
| 3.1 | **Business-opening playbook** (Playbook C): only with 2+ corroborating records (licence + renovation permit / food licence / occupancy). LLC formation alone is never shown | Fixes the locksmith/insurance blanket tags |
| 3.2 | **Market insight reports** (Playbook E): Cobb / Atlanta / DeKalb pages built from event dates and consistent baselines, with sample size and reporting lag shown. Prune thin city pages | Each page cites sources and dates |
| 3.3 | **Roofer neighbor lists**: hail/wind report polygon → recently permitted addresses inside it (addresses only, no owner names) | Shown as Market Insights, labelled "damage not confirmed" |
| 3.4 | **Alert-quality dashboard**: share of Act Now / Coming Soon / Market Insights / Context sent per trade; false-positive rate from feedback; time to first useful card | Target: ≥ 60% of sent alerts are Act Now or Coming Soon for every trade |
| 3.5 | **Viewer cap test** on Pro: each Act Now card shown to at most N subscribers per area ("3 of 5 spots left") | A/B on pilot cohort before rollout |
| 3.6 | **Pilot review** at day 30: decide which segment and playbook to double down on | Written decision in this file |

### Later (only with evidence)

Spanish (UI, cards, outreach templates) · Georgia Procurement Registry (after terms check; not assumed machine-readable) · local procurement portals (Smyrna, Atlanta, Cobb) · property transitions (aggregate area reports only; no homeowner contact lists) · waitlist launch-email cron (send when a new area goes live) · Census permit trends as baselines · Canada (first city per expansion research) · supplier/distributor territory intelligence.

### Deferred (do not build)

Full CRM · automated homeowner outreach · skip tracing / homeowner phone lookup · nationwide municipal scraping · predictive ML · autonomous agents · Kafka / vector DB · scraping Nextdoor or Facebook groups.

## 5. Metrics and gates

**North star:** businesses per week taking a logged action (contacted / saved / led to work) on an Act Now or Coming Soon card.

| Gate | Target (hypothesis, re-baseline after pilot) |
|---|---|
| Card review pass rate | ≥ 80% of sampled cards |
| Pilot action rate | ≥ 50% of pilot businesses act on 1+ card in 30 days |
| Willingness to pay | ≥ 20% of pilot say they would keep paying |
| Time to first useful card | Same day for covered ZIPs |
| Useful-alert share | ≥ 60% of sent alerts are Act Now or Coming Soon, per trade |
| Source reliability | No recurring critical source failure; stale sources flagged |

Self-reported wins are not proof Holler caused the sale; report them as "influenced".

## 6. Open questions (answer with data)

1. Which segment acts most per card: landscapers, commercial cleaners, subcontractors, or roofers/HVAC?
2. Can Atlanta-area permits give stage changes (final / CO) reliably and legally?
3. Will small contractors act on SAM.gov notices, or are most out of reach (bonding, past performance)?
4. How many Act Now + Coming Soon cards per month keep a subscriber paying?
5. Do the Cobb/Atlanta market reports bring signups at a sane cost?
