import { Suspense } from 'react';
import Link from 'next/link';
import { BillingButton } from '@/components/billing-button';
import { Card } from '@/components/card';
import { ComingNextForMember } from '@/components/coming-next-member';
import { EmptyFeed, emptyFeedApplies } from '@/components/feed/empty-feed';
import { EmptyFeedShort } from '@/components/feed/empty-feed-es';
import { RecentActivity } from '@/components/feed/recent-activity';
import { Feed, LockedFeed, type FeedItem, type MatchStatus } from '@/components/feed';
import { formatDistance, maskText, timeAgo } from '@/components/format';
import { Notice } from '@/components/notice';
import { VerifyNotice } from './verify-notice';
import { computeAccess } from '@/lib/auth/access';
import { cityPageFor } from '@/lib/auth/city-link';
import { requireProfile } from '@/lib/auth/session';
import { repairShortTrial } from '@/lib/auth/trial';
import { createClient } from '@/lib/supabase/server';
import { priceLabel, renewalNote, TIER_LABEL } from '@/lib/stripe/plans';
import { approxLocationNote, hasApproxLocation } from '@/lib/signals/approx-location';
import { MANAGER_SELECT } from '@/lib/signals/managed-by';
import { bidCardLine } from '@/lib/signals/bid-card';
import { SAM_SELECT, samCardLine } from '@/lib/signals/sam-notice';
import { bidHidden } from '@/lib/signals/bid-sources';
import { matchScope } from '@/lib/plan/scope';
import { HOLLER_REQUEST_SOURCE, isEndedRequest } from '@/lib/signals/request-visibility';
import { createAdminClient } from '@/lib/supabase/admin';
import { requestTextForMember } from '@/lib/requests/details';
import { loadMemberContacts } from '@/lib/outreach/loader';
import { loadFeedback } from '@/lib/feedback/service';
import type { FeedbackState } from '@/lib/feedback/types';
import { mayHaveContacts } from '@/lib/outreach/plan';
import type { ContactRecord } from '@/lib/contacts/types';
import { notesFor, rankSignals, scoresFor } from '@/lib/ai';
import { DEADLINE_SELECT, deadlineOf, demoteExpired, keptMatchLabel, labelForMember, recordLabelInput } from '@/lib/signals/lead-rules';
import { feedScoreFor, hasNamedContact, orderByLabelScore } from '@/lib/signals/score';
import { tradeForRecord } from '@/lib/signals/brief';
import { dedupeByAlert } from '@/lib/signals/alert-dedupe';
import { coverageNotice } from '@/lib/check/coverage-notice';
import { CoverageNoticeLine } from '@/components/coverage-notice';
import { loadSourceStateSnapshot } from '@/lib/signals/source-state-snapshot';
import { LOCAL_COVERAGE_RADIUS_MI } from '@/lib/check/coverage';
import { VALUE_SELECT, jobValueOf, parseMoney } from '@/lib/signals/permit-value';
import { readWorkProfile } from '@/lib/auth/work-profile';
import { STAGE_SELECT } from '@/lib/signals/stage';
import { langOfProfile, t, type Lang } from '@/lib/i18n';
import { BuildersPanel } from '@/components/builders/builders-panel';
import { builderScopeOf } from '@/lib/builders/cached';
import { buildersPanelEnabled } from '@/lib/builders/switch';
import { planNameEs, renewalNoteEs } from '@/lib/plan/price-copy-es';
import { holdOf, missingHoldColumn, shownHold } from '@/lib/signals/alert-gate';
import { isAlertLabel } from '@/lib/signals/lead-rules';
import { stormCardLinks } from '@/lib/lists/load';
import { listLinkFor } from '@/lib/lists/card';

interface SignalRow {
  id: number;
  source: string;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  zip: string | null;
  occurred_at: string;
  expires_at: string | null;
  /** data->>subtype of the record, for the intent label. */
  subtype?: string | null;
  /** data->>approxLocation ('true' when the point is a city-centre stand-in): no distance is shown for it. */
  approxLocation?: string | null;
  /** 1..3, for the AI ranking (lib/ai rankSignals). */
  severity?: number | null;
  /** The point, for the label rules that need it (lead-rules recordLabelInput). Never sent to the page. */
  lat?: number | null;
  lon?: number | null;
  /** The record's trades, for this member's opportunity label (lib/signals/lead-rules.ts). */
  categories?: string[] | null;
  /** A fix-by, due or response date an adapter read from the record (DEADLINE_SELECT aliases). Usually absent. */
  deadline?: string | null;
  fixBy?: string | null;
  responseDeadline?: string | null;
  dueDate?: string | null;
  /** City open bids only (data.buyer): the buyer. The due day comes from dueDate above. */
  bidBuyer?: string | null;
  /** Federal notices only (data.setAside, data.setAsideDescription): the set-aside the notice carries. */
  samSetAside?: string | null;
  samSetAsideDesc?: string | null;
  /** NYC no-heat rows only (data.managerName, data.managerRole): the company the city's building registration names. */
  managerName?: string | null;
  managerRole?: string | null;
  /** County-level weather alerts: data.loc and data.alertId (one alert is stored once per county; the feed shows it once). */
  loc?: string | null;
  alertId?: string | null;
  /** Permits: data.jobValue (text form, VALUE_SELECT), the project value the city published. */
  jobValue?: string | null;
  /** Permits: data.permitStage and data.permitStageAt (STAGE_SELECT), written by a stage update (migration 0025). */
  permitStage?: string | null;
  permitStageAt?: string | null;
}

interface MatchRow {
  id: number;
  status: MatchStatus;
  distance_mi: number | null;
  draft: string | null;
  created_at: string;
  /** Feed-only reason (migration 0027, lib/signals/alert-gate.ts): shown on the card, never alerted. Absent before 0027. */
  alert_hold?: string | null;
  signal: SignalRow | SignalRow[] | null;
}

/** Loads the feed. Kept out of the component so time-dependent values (trial days, "x min ago") are computed per request. */
async function loadDashboard() {
  const { user, profile: loaded } = await requireProfile();
  const supabase = await createClient();

  const now = Date.now();
  // Round 18: a never-paid trial row shorter than start + TRIAL_DAYS (an onboarding server step that failed before migration 0028) is
  // moved there now, with the same guard as onboarding. A row that is already right costs no query. Never throws.
  const repairedEnd = await repairShortTrial(user, loaded, createAdminClient, new Date(now));
  const profile = repairedEnd ? { ...loaded, trial_ends_at: repairedEnd } : loaded;
  const lang = langOfProfile(profile);
  const access = computeAccess(profile, now);
  // Source states (lib/signals/source-state.ts): started here so the cached read runs alongside the feed queries below instead of
  // after them. A locked account sees a masked feed and never triggers a service-role read. Any failure is null (no line).
  const snapshotRead =
    !access.locked && profile.lat !== null && profile.lon !== null ? loadSourceStateSnapshot().catch(() => null) : null;

  // alert_hold (migration 0027) is read with the match; before 0027 that read fails on the column and is made again without it.
  const readFeed = (holdCol: string) => supabase
    .from('holler_matches')
    .select(
      `id,status,distance_mi,draft,created_at,${holdCol}signal:holler_signals(id,source,kind,title,summary,url,city,state,county,zip,lat,lon,occurred_at,expires_at,severity,categories,subtype:data->>subtype,approxLocation:data->>approxLocation,loc:data->>loc,alertId:data->>alertId,${DEADLINE_SELECT},${VALUE_SELECT},${STAGE_SELECT},bidBuyer:data->>buyer,${SAM_SELECT},${MANAGER_SELECT})`,
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  let { data, error } = await readFeed('alert_hold,');
  if (error && missingHoldColumn(error)) ({ data, error } = await readFeed(''));

  const cityPage = cityPageFor(profile.lat, profile.lon);

  // The member's trades under their plan: the opportunity label of a record depends on the trade that matched it.
  const memberTrades = matchScope(profile).categories;
  // An Act Now whose published deadline has passed is shown as Coming soon (demoteExpired). A match the member saved or marked done stays
  // in the feed whatever its label is now, without an alert chip it no longer earns (keptMatchLabel, review P2-6).
  const labelOf = (s: SignalRow, status: string | null | undefined) =>
    keptMatchLabel(demoteExpired(labelForMember({ ...recordLabelInput(s), categories: s.categories }, memberTrades), deadlineOf(s), now), status);

  // Resident requests that have ended (closed, removed, past 14 days) leave the feed at once, before the cron deletes them.
  // Context records (public graffiti, city tree trims, sewer and catch-basin work, park events, blanket licenses) are never shown,
  // including matches stored before the label rules existed (items 0.2 and 0.3). Market insight rows are shown, after every alert.
  const rows = dedupeByAlert(((data ?? []) as unknown as MatchRow[]), (m) => (Array.isArray(m.signal) ? m.signal[0] : m.signal)).filter((m) => {
    const s = Array.isArray(m.signal) ? m.signal[0] : m.signal;
    // A city bid is hidden whenever HOLLER_BIDS_ENABLED is off, including matches stored while it was on.
    return !!s && !isEndedRequest(s, now) && !bidHidden(s, undefined, now) && labelOf(s, m.status) !== 'context';
  });
  // A resident's filtered description is not in the public record. It is read with the service role for this member's own request
  // matches only (requestTextForMember checks user_id and that the request is still open), and never for a locked account.
  const requestMatchIds = rows
    .filter((m) => (Array.isArray(m.signal) ? m.signal[0] : m.signal)?.source === HOLLER_REQUEST_SOURCE)
    .map((m) => m.id);
  let requestText: Record<number, string> = {};
  if (!access.locked && requestMatchIds.length > 0) {
    try {
      requestText = await requestTextForMember(createAdminClient(), user.id, requestMatchIds, new Date(now));
    } catch {
      requestText = {};
    }
  }
  // "Who to contact": organisations and sites the record names. Read with the service role, only for signal ids taken from THIS
  // member's own matches (the query above is filtered by user_id), only for records that can carry contacts, and never for a locked
  // account. The loader checks the match owner again. Any failure means no contacts and the feed renders as before.
  let contactsBySignal = new Map<number, ContactRecord[]>();
  if (!access.locked) {
    const withContacts = rows
      .map((m) => (Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow)
      .filter((s) => mayHaveContacts(s.source, s.kind));
    const signalIds = withContacts.map((s) => s.id);
    if (signalIds.length > 0) {
      try {
        contactsBySignal = await loadMemberContacts({
          db: createAdminClient(),
          userId: user.id,
          signalIds,
          locked: false,
          // Round 18: a business's public listing found earlier by the alert run is shown under its name (cache read only, no call).
          places: new Map(withContacts.map((s) => [s.id, { city: s.city, state: s.state }])),
        });
      } catch {
        contactsBySignal = new Map();
      }
    }
  }
  // The member's own feedback answers (RLS: own rows only). A missing table or any failure just means no answers are shown.
  let feedbackBySignal = new Map<number, FeedbackState>();
  if (!access.locked && rows.length > 0) {
    const ids = rows.map((m) => (Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow).map((s) => s.id);
    feedbackBySignal = await loadFeedback(supabase, user.id, ids);
  }
  // AI notes and ranking (lib/ai): read from holler_signal_ai with the service role, for this member's own matches only, never for
  // a locked account. No model call here. Any failure gives empty maps: chronological order and no notes, exactly as before.
  let aiNotes = new Map<number, string>();
  let ranked = rows;
  if (!access.locked && rows.length > 0) {
    const sigOf = (m: MatchRow) => (Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow;
    const ids = rows.map((m) => sigOf(m).id);
    // Only the trades the current plan covers (a Solo member with 6 saved trades is matched on the first 5).
    const trades = matchScope(profile).categories;
    try {
      const admin = createAdminClient();
      const [notes, scores] = await Promise.all([notesFor(admin, ids, trades), scoresFor(admin, ids, trades)]);
      aiNotes = notes;
      // No stored AI result for any of these (or the table is missing before migration 0014): keep the newest-first order.
      ranked = scores.size === 0 ? rows : rankSignals(
        rows.map((m) => ({ id: sigOf(m).id, severity: sigOf(m).severity ?? null, occurred_at: sigOf(m).occurred_at, m })),
        scores,
      ).map((x) => x.m);
    } catch {
      aiNotes = new Map();
      ranked = rows;
    }
  }
  // Act Now first, then the deterministic score (PLAN-2.0 item 2.7), then the AI ranking or newest-first order the rows already have (a stable sort).
  // A feed-only card (alert_hold) sorts with the market insights, after every alert. A 'background' card whose text or contacts name a
  // place or a business shows no hold (shownHold): the feed never says "no site address" next to one.
  // The member's current minimum (migration 0027): a "Below your minimum" card loses the chip once the minimum is cleared or lowered.
  let minNow: number | null | undefined;
  if (rows.some((m) => holdOf(m) === 'below_min')) {
    const w = await readWorkProfile(supabase, user.id).catch(() => null);
    minNow = w?.available ? w.settings.minValue : undefined;
  }
  const holdShown = (m: MatchRow) => {
    const s = (Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow;
    return shownHold(holdOf(m), contactsBySignal.get(s.id), s.summary, { minValue: minNow, jobValue: jobValueOf({ jobValue: s.jobValue, summary: s.summary }) });
  };
  const ordered = orderByLabelScore(
    ranked,
    (m) => (holdShown(m) ? 'market_insight' : labelOf((Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow, m.status)),
    (m) => {
      const s = (Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow;
      return feedScoreFor(
        { source: s.source, kind: s.kind, subtype: s.subtype, title: s.title, summary: s.summary, occurred_at: s.occurred_at, categories: s.categories },
        memberTrades,
        { hasContact: hasNamedContact(contactsBySignal.get(s.id)), nowMs: now },
      );
    },
  );
  // Address lists (round 18, unit LISTS): an act_now or coming_soon storm card the member already has may point to the permitted addresses
  // near its report. No new card, no new alert: only a line on a card that is already here. Never for a locked account; any failure, no line.
  let stormLinks = new Map<number, { kind: 'hail' | 'wind'; count: number }>();
  if (!access.locked) {
    // The card's own label as the feed shows it (round 19 rules: a saved or done match keeps no alert chip it no longer earns).
    const stormIds = ordered
      .map((m) => ({ s: (Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow, status: m.status }))
      .filter(({ s, status }) => s.source === 'spc' && isAlertLabel(labelOf(s, status)))
      .map(({ s }) => s.id);
    if (stormIds.length > 0) {
      stormLinks = await stormCardLinks(
        supabase,
        { user_id: user.id, categories: profile.categories, lat: profile.lat, lon: profile.lon, state: profile.state, radius_mi: profile.radius_mi, plan: profile.plan ?? null, subscription_status: profile.subscription_status, plan_source: profile.plan_source ?? null, store_expires_at: profile.store_expires_at ?? null, extra_areas: profile.extra_areas, keywords: profile.keywords ?? null },
        stormIds,
        new Date(now),
      );
    }
  }
  const items: FeedItem[] = ordered.map((m) => {
    const s = (Array.isArray(m.signal) ? m.signal[0] : m.signal) as SignalRow;
    const isRequest = s.source === HOLLER_REQUEST_SOURCE;
    const base: FeedItem = {
      id: m.id,
      status: m.status,
      kind: s.kind,
      source: s.source,
      title: s.title,
      summary: isRequest ? (requestText[m.id] ?? null) : s.summary,
      url: s.url,
      distance: hasApproxLocation(s) ? null : formatDistance(m.distance_mi, lang),
      place: [s.city, s.state].filter(Boolean).join(', ') || null,
      // A stand-in position (Cobb County): say so in plain words, never a distance.
      approxNote: hasApproxLocation(s) ? approxLocationNote(s, lang) : null,
      ago: timeAgo(s.occurred_at, now, lang),
      occurredAt: s.occurred_at,
      draft: m.draft,
      city: s.city,
      state: s.state,
      county: s.county,
      zip: s.zip,
      subtype: s.subtype ?? null,
      label: labelOf(s, m.status),
      ...(holdShown(m) ? { hold: holdShown(m) } : {}),
      // The member's trade this record is shown under: the brief's "Why it matters" line is written for it.
      trade: tradeForRecord({ source: s.source, kind: s.kind, subtype: s.subtype, title: s.title, summary: s.summary }, s.categories, memberTrades),
      deadline: deadlineOf(s),
      jobValue: parseMoney(s.jobValue),
      permitStage: s.permitStage ?? null,
      permitStageAt: s.permitStageAt ?? null,
      signalId: s.id,
      feedback: feedbackBySignal.get(s.id) ?? null,
      // The AI note is written in English by the model, so a Spanish member does not get it (no machine translation, no second model call).
      aiNote: lang === 'en' ? (aiNotes.get(s.id) ?? null) : null,
      // NYC no-heat rows: the registered managing agent or owner company (company names only). Never for a locked account (see below).
      managerName: s.managerName ?? null,
      managerRole: s.managerRole ?? null,
      // Open city bids: buyer and due date with days left, worked out on the server at request time.
      // Open city bids: buyer and due date. Federal notices: the early-notice and set-aside words (lib/signals/sam-notice.ts), from the notice's own fields.
      bidLine: s.subtype === 'bid' ? bidCardLine({ buyer: s.bidBuyer, dueDate: s.dueDate, expiresAt: s.expires_at }, new Date(now), lang) : samCardLine({ source: s.source, summary: s.summary, setAside: s.samSetAside, setAsideDescription: s.samSetAsideDesc }, lang),
    };
    const storm = stormLinks.get(s.id);
    if (storm) base.listLink = listLinkFor(s.id, storm.kind, storm.count, lang);
    const found = access.locked ? undefined : contactsBySignal.get(s.id);
    if (found && found.length > 0) base.contacts = found.map((c) => {
        const contact: Partial<ContactRecord> = { ...c };
        delete contact.signalId;
        return contact as Omit<ContactRecord, 'signalId'>;
      });
    // Locked: ship placeholders only, never the real text, link or draft.
    return access.locked
      ? { ...base, title: maskText(s.title), summary: s.summary ? maskText(s.summary) : null, url: null, draft: null, county: null, zip: null, aiNote: null, bidLine: null, jobValue: null, permitStage: null, permitStageAt: null, managerName: null, managerRole: null, listLink: null }
      : base;
  });

  // Accounts under 3 days old were filled from the 14-day backfill at signup.
  const firstRun = now - new Date(profile.created_at).getTime() < 3 * 86_400_000;

  // Source states (lib/signals/source-state.ts): when a source covering the member's area and trades is delayed, degraded or
  // unavailable, the header says so in one line, so a quiet feed is never read as full coverage. Any failure means no line.
  let coverage: string | null = null;
  try {
    if (snapshotRead && profile.lat !== null && profile.lon !== null) {
      const snapshot = await snapshotRead;
      coverage =
        coverageNotice({
          lat: profile.lat,
          lon: profile.lon,
          radiusMi: Math.max(profile.radius_mi ?? 0, LOCAL_COVERAGE_RADIUS_MI),
          trades: memberTrades,
          states: snapshot?.states,
          now,
          lang,
        })?.line ?? null;
    }
  } catch {
    coverage = null;
  }

  // "Who's building near you" ships dark (round 19 integration): rendered only with HOLLER_BUILDERS_PANEL_ENABLED on, never for a locked account.
  const buildersOn = !access.locked && buildersPanelEnabled();
  return { profile, lang, access, cityPage, items, firstRun, failed: Boolean(error), coverage, buildersOn };
}

export default async function AppHome(props: PageProps<'/app'>) {
  const upgraded = (await props.searchParams).upgraded === '1';
  const { profile, lang, access, cityPage, items, firstRun, failed, coverage, buildersOn } = await loadDashboard();

  return (
    <>
      <h1 className="text-5xl text-ink">{t(lang, 'app.title')}</h1>
      <p className="mt-2 text-muted">
        {lang === 'en' ? (
          <>
            {profile.business_name}, within <span className="font-mono tabular-nums">{profile.radius_mi}</span> mi of{' '}
            {profile.city && profile.state ? `${profile.city}, ${profile.state}` : profile.zip}.{' '}
          </>
        ) : (
          <>
            {t(lang, 'app.within', {
              name: profile.business_name,
              radius: profile.radius_mi,
              place: profile.city && profile.state ? `${profile.city}, ${profile.state}` : (profile.zip ?? ''),
            })}{' '}
          </>
        )}
        {cityPage ? (
          <Link href={cityPage.href} className="font-medium text-brand-text underline">
            {t(lang, 'card.empty.see_city', { city: cityPage.label })}
          </Link>
        ) : null}
      </p>
      {/* Address lists (round 18, unit LISTS): reachable at every width; the header link shows from 400 px up. */}
      <p className="mt-1">
        <Link href="/app/lists" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-text underline md:min-h-9">
          {t(lang, 'lists.open_from_app')}
        </Link>
      </p>

      <div className="mt-6 flex flex-col gap-4 empty:hidden">
        {upgraded ? (
          <Notice tone="success" role="status">
            {lang === 'en' ? 'Thanks. Your payment went through. It can take a few seconds to show up here.' : t(lang, 'app.upgraded')}
          </Notice>
        ) : null}
        {profile.email_verified_at ? null : <VerifyNotice lang={lang} />}
        <TrialBanner access={access} lang={lang} />
        <CoverageNoticeLine line={coverage} />
        {failed ? <Notice tone="danger" role="alert">{lang === 'en' ? "We couldn't load your matches. Refresh in a moment." : t(lang, 'app.load_failed')}</Notice> : null}
      </div>

      <div className="mt-6">
        {emptyFeedApplies({ items: items.length, locked: access.locked, failed }) ? (
          // Zero matches: what the area check, the nearby feeds and the last 90 days show, from real rows (components/feed/empty-feed.tsx).
          lang === 'en' ? (
            <Suspense fallback={<Feed items={[]} cityPage={cityPage} firstRun={firstRun} lang={lang} />}>
              <EmptyFeed userId={profile.user_id} />
            </Suspense>
          ) : (
            <div className="space-y-6">
              <EmptyFeedShort lang={lang} zip={profile.zip} trade={profile.categories?.[0] ?? null} />
              {/* The last 90 days near the member, in Spanish (the English panel's counts and examples, from the same rows). */}
              <Suspense fallback={null}>
                <RecentActivity userId={profile.user_id} />
              </Suspense>
            </div>
          )
        ) : access.locked ? (
          <LockedFeed items={items} lang={lang}>
            {lang !== 'en' ? (
              <LockedCard lang={lang} count={items.length} inTrial={!access.trialEnded} />
            ) : (
            <Card className="text-center">
              <h2 className="h-plain text-2xl text-ink">Your free trial is over</h2>
              <p className="mt-2 text-muted">
                {items.length > 0
                  ? `${items.length} ${items.length === 1 ? 'match is' : 'matches are'} waiting. `
                  : ''}
                {TIER_LABEL.starter} is {priceLabel('starter', 'monthly')} a month. {TIER_LABEL.pro} is {priceLabel('pro', 'monthly')} a month and covers more areas
                and trades. Cancel any time.
              </p>
              <div className="mt-5 flex flex-col items-center gap-3">
                <BillingButton
                  endpoint="/api/stripe/checkout"
                  tier="starter"
                  plan="monthly"
                  unavailableMessage="Billing opens soon. Check back shortly."
                  note={renewalNote('starter', 'monthly', { inTrial: !access.trialEnded })}
                >
                  Keep alerts for {priceLabel('starter', 'monthly')}/mo
                </BillingButton>
                <Link href="/app/settings#billing-h" className="text-sm font-medium text-brand-text underline">
                  See both plans and yearly prices
                </Link>
              </div>
            </Card>
            )}
          </LockedFeed>
        ) : (
          <Feed items={items} cityPage={cityPage} firstRun={firstRun} lang={lang} />
        )}
      </div>
      {/* Companies that pulled permits near the member (lib/builders, round 19): cached 15 minutes, in its own Suspense below the feed,
          never for a locked account, and only with HOLLER_BUILDERS_PANEL_ENABLED on (lib/builders/switch.ts). Read only: no card, match or alert. */}
      {access.locked || !buildersOn ? null : (
        <Suspense fallback={null}>
          <BuildersPanel userId={profile.user_id} scope={builderScopeOf(profile)} lang={lang} />
        </Suspense>
      )}
      <ComingNextForMember />
    </>
  );
}

/** The card over a locked feed, in Spanish (round 18 ES). The English card above is unchanged. Prices from the price table. */
function LockedCard({ lang, count, inTrial }: { lang: Lang; count: number; inTrial: boolean }) {
  return (
    <Card className="text-center">
      <h2 className="h-plain text-2xl text-ink">{t(lang, 'app.locked.h')}</h2>
      <p className="mt-2 text-muted">
        {count > 0 ? `${t(lang, count === 1 ? 'app.locked.waiting_one' : 'app.locked.waiting_many', { n: count })} ` : ''}
        {t(lang, 'app.locked.prices', { solo: planNameEs('starter'), soloPrice: priceLabel('starter', 'monthly'), pro: planNameEs('pro'), proPrice: priceLabel('pro', 'monthly') })}
      </p>
      <div className="mt-5 flex flex-col items-center gap-3">
        <BillingButton
          endpoint="/api/stripe/checkout"
          tier="starter"
          plan="monthly"
          lang={lang}
          unavailableMessage={t(lang, 'app.locked.unavailable')}
          note={renewalNoteEs('starter', 'monthly', { inTrial })}
        >
          {t(lang, 'app.locked.cta', { price: priceLabel('starter', 'monthly') })}
        </BillingButton>
        <Link href="/app/settings#billing-h" className="text-sm font-medium text-brand-text underline">
          {t(lang, 'app.locked.both')}
        </Link>
      </div>
    </Card>
  );
}

function TrialBanner({ access, lang = 'en' }: { access: ReturnType<typeof computeAccess>; lang?: Lang }) {
  if (lang !== 'en') return <TrialBannerLang access={access} lang={lang} />;
  if (access.status === 'past_due') {
    return (
      <Notice tone="warn">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Your last payment didn&apos;t go through. Update your card to keep alerts on.</span>
          <BillingButton endpoint="/api/stripe/portal" variant="secondary" size="sm">
            Manage billing
          </BillingButton>
        </div>
      </Notice>
    );
  }
  if (access.status === 'trialing' && !access.trialEnded) {
    return (
      <Notice tone="info">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong className="font-semibold">
              {access.daysLeft} {access.daysLeft === 1 ? 'day' : 'days'} left
            </strong>{' '}
            in your free trial. Plans start at {priceLabel('starter', 'monthly')} a month.
          </span>
          <Link href="/app/settings#billing-h" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline md:min-h-9">
            Pick a plan
          </Link>
        </div>
      </Notice>
    );
  }
  return null;
}

/** The trial and payment banner in Spanish (round 18 ES). Same states and links as TrialBanner. */
function TrialBannerLang({ access, lang }: { access: ReturnType<typeof computeAccess>; lang: Lang }) {
  if (access.status === 'past_due') {
    return (
      <Notice tone="warn">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{t(lang, 'app.past_due')}</span>
          <BillingButton endpoint="/api/stripe/portal" variant="secondary" size="sm" lang={lang}>
            {t(lang, 'app.manage_billing')}
          </BillingButton>
        </div>
      </Notice>
    );
  }
  if (access.status === 'trialing' && !access.trialEnded) {
    return (
      <Notice tone="info">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong className="font-semibold">{t(lang, access.daysLeft === 1 ? 'app.trial.days_one' : 'app.trial.days_many', { n: access.daysLeft })}</strong>{' '}
            {t(lang, 'app.trial.rest', { price: priceLabel('starter', 'monthly') })}
          </span>
          <Link href="/app/settings#billing-h" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline md:min-h-9">
            {t(lang, 'app.pick_plan')}
          </Link>
        </div>
      </Notice>
    );
  }
  return null;
}
