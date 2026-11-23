import { createAdminClient } from '@/lib/supabase/admin';
import { env, siteUrl } from '@/lib/env';
import { track } from '@/lib/analytics/server';
import {
  chunk,
  planNotify,
  type PlanProfile,
  renderDigest,
  sendEmail,
  signUnsubscribeToken,
  type DigestItem,
} from '@/lib/email';
import { isCronAuthorized } from '@/lib/email/cron-auth';
import { HOLLER_REQUEST_SOURCE, isEndedRequest } from '@/lib/signals/request-visibility';
import { requestTextByPublicId } from '@/lib/requests/details';
import { loadMemberContacts } from '@/lib/outreach/loader';
import { emailContact, mayHaveContacts, namedContact } from '@/lib/outreach/plan';
import { LOOKUP_CALL_TIMEOUT_MS, LOOKUP_START_CUTOFF_MS, lookupForCards, lookupSettings, newBudget } from '@/lib/enrich/business-lookup';
import { notesFor, rankSignals, scoresFor } from '@/lib/ai';
import { matchScope } from '@/lib/plan/scope';
import { markAlertsEmailed } from '@/lib/moat/log';
import { pushNewMatches } from '@/lib/push/notify';
import { approxLocationNote, hasApproxLocation } from '@/lib/signals/approx-location';
import { MANAGER_SELECT } from '@/lib/signals/managed-by';
import { bidCardLine } from '@/lib/signals/bid-card';
import { dropHiddenBids } from '@/lib/signals/bid-sources';
import { tradeForRecord } from '@/lib/signals/brief';
import { dedupeByAlert } from '@/lib/signals/alert-dedupe';
import { missingStoreColumn, STORE_PROFILE_COLUMNS } from '@/lib/storebilling/source';
import { VALUE_SELECT } from '@/lib/signals/permit-value';
import { isStageUpdate, STAGE_SELECT } from '@/lib/signals/stage';
import { DEADLINE_SELECT, deadlineOf, demoteExpired, isAlertLabel, labelForMember, recordLabelInput, type OpportunityLabel } from '@/lib/signals/lead-rules';
import { feedScoreFor, hasNamedContact, orderByLabelScore } from '@/lib/signals/score';
import { parseLang, type Lang } from '@/lib/i18n';
import { holdOf, missingHoldColumn } from '@/lib/signals/alert-gate';
import { quietWeekEnabled, sendQuietWeek, type QuietWeekCounts } from '@/lib/email/quiet-week';

export const maxDuration = 60;

const MAX_USERS_PER_RUN = 150;
const MAX_ITEMS_IN_DIGEST = 10;
// PostgREST caps a response at 1000 rows, so read in pages of 1000 and stop after MAX_PAGES (newest first).
const PAGE_SIZE = 1000;
const MAX_PAGES = 15;

interface SignalRow {
  id?: number;
  source?: string | null;
  external_id?: string | null;
  expires_at?: string | null;
  kind: string;
  title: string;
  summary?: string | null;
  url: string | null;
  city: string | null;
  state: string | null;
  occurred_at: string;
  subtype?: string | null;
  /** data->>approxLocation ('true' when the point is a city-centre stand-in): no distance is shown for it. */
  approxLocation?: string | null;
  severity?: number | null;
  /** The point, for the label rules that need it (lead-rules recordLabelInput). Never mailed. */
  lat?: number | null;
  lon?: number | null;
  /** The record's trades and any published fix-by or due date, for the opportunity label and deadline (lib/signals/lead-rules.ts). */
  categories?: string[] | null;
  deadline?: string | null;
  /** City open bids only: data.buyer. */
  bidBuyer?: string | null;
  /** NYC no-heat rows only: data.managerName and data.managerRole (company names only). */
  managerName?: string | null;
  managerRole?: string | null;
  /** County-level weather alerts: data.loc and data.alertId (one alert is stored once per county). */
  loc?: string | null;
  alertId?: string | null;
  /** Permits: data.jobValue (text form). */
  jobValue?: string | null;
  /** Permits: data.permitStage and data.permitStageAt (STAGE_SELECT). */
  permitStage?: string | null;
  permitStageAt?: string | null;
  permitStageUpdate?: string | null;
  dueDate?: string | null;
  fixBy?: string | null;
  responseDeadline?: string | null;
}
interface MatchRow {
  id: number;
  user_id: string;
  created_at: string;
  /** Feed-only reason (migration 0027, lib/signals/alert-gate.ts). Absent before 0027. A held match is never emailed. */
  alert_hold?: string | null;
  signal: SignalRow | SignalRow[] | null;
}
interface ProfileRow extends PlanProfile {
  business_name: string;
  categories?: string[] | null;
  plan?: string | null;
}

const PROFILE_COLUMNS: string = 'user_id, business_name, categories, plan, alert_email, subscription_status, trial_ends_at, last_notified_at, email_verified_at, created_at';
// Migration 0020 adds the store columns (a lapsed store plan is not emailed). Before it, the read retries without them.
const PROFILE_COLUMNS_0020: string = `${PROFILE_COLUMNS}, ${STORE_PROFILE_COLUMNS}`;

export async function GET(req: Request) {
  if (!isCronAuthorized(req, env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const started = Date.now();
  const now = new Date();
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  const counts = { users_considered: 0, emailed: 0, matches_marked: 0, matches_skipped_marked: 0, skipped_throttled: 0, skipped_not_entitled: 0, skipped_alerts_off: 0, skipped_unverified: 0, skipped_no_email_provider: 0, failed: 0 };

  // Read every page BEFORE writing anything, so marking rows notified cannot shift the offsets.
  let matches: MatchRow[] = [];
  // alert_hold (migration 0027) is read with the match; before 0027 the read fails on that column and every page is read without it.
  let holdCol = 'alert_hold, ';
  for (let page = 0; page < MAX_PAGES; page++) {
    const readPage = () => admin
      .from('holler_matches')
      .select(`id, user_id, created_at, ${holdCol}signal:holler_signals(id, source, external_id, expires_at, kind, title, summary, url, city, state, lat, lon, occurred_at, severity, categories, subtype:data->>subtype, approxLocation:data->>approxLocation, loc:data->>loc, alertId:data->>alertId, ${DEADLINE_SELECT}, ${VALUE_SELECT}, ${STAGE_SELECT}, bidBuyer:data->>buyer, ${MANAGER_SELECT})`)
      .eq('notified', false)
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    let { data, error } = await readPage();
    if (error && holdCol && missingHoldColumn(error)) {
      holdCol = '';
      ({ data, error } = await readPage());
    }
    if (error) return Response.json({ error: 'query_failed', detail: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as MatchRow[];
    matches.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  // Round 24: every member with an un-notified match, before any filter, so the quiet-week step (off by default) never writes to them.
  const pendingUsers = new Set(matches.map((m) => m.user_id));

  // City bids are never emailed while HOLLER_BIDS_ENABLED is off, including matches stored while it was on, and a bid whose due date has
  // passed is never emailed at all (review P2-14). They are left unnotified (not stamped), so turning the flag back on resumes the open ones.
  matches = dropHiddenBids(matches, undefined, now.getTime());

  const byUser = new Map<string, MatchRow[]>();
  for (const m of matches) {
    const list = byUser.get(m.user_id) ?? [];
    list.push(m);
    byUser.set(m.user_id, list);
  }
  const userIds = [...byUser.keys()];
  counts.users_considered = userIds.length;
  // Round 24 (review P1-5): the quiet-week email, only while HOLLER_QUIET_WEEK_ENABLED is exactly "1" (lib/email/quiet-week.ts). Off,
  // this is never called and the run, its database calls and its JSON are exactly what they were before round 24.
  const emailedThisRun = new Set<string>();
  const quietWeek = (): Promise<QuietWeekCounts> =>
    sendQuietWeek({
      db: admin,
      now,
      siteUrl,
      secret: env.CRON_SECRET!,
      emailOf: async (id) => {
        const { data, error } = await admin.auth.admin.getUserById(id);
        return error ? null : (data?.user?.email ?? null);
      },
      send: (m) => sendEmail(m),
      skip: new Set([...pendingUsers, ...emailedThisRun]),
      cap: MAX_USERS_PER_RUN,
      outOfTime: () => Date.now() - started > 50_000,
    });

  if (userIds.length === 0) {
    // Nothing to email, but push keeps its own record (holler_matches.pushed_at), so it still runs.
    if (quietWeekEnabled()) {
      const quiet = await quietWeek();
      const push = await pushNewMatches(admin, { now, deadline: started + 56_000 });
      return Response.json({ ok: true, ...counts, quiet, push, ms: Date.now() - started });
    }
    const push = await pushNewMatches(admin, { now, deadline: started + 56_000 });
    return Response.json({ ok: true, ...counts, push, ms: Date.now() - started });
  }

  const profiles: ProfileRow[] = [];
  for (const ids of chunk(userIds)) {
    const read = (columns: string) => admin.from('holler_profiles').select(columns).in('user_id', ids);
    let r = await read(PROFILE_COLUMNS_0020);
    if (r.error && missingStoreColumn(r.error.message)) r = await read(PROFILE_COLUMNS);
    if (r.error) return Response.json({ error: 'profiles_failed', detail: r.error.message }, { status: 500 });
    profiles.push(...((r.data ?? []) as unknown as ProfileRow[]));
  }

  // Member language (migration 0024), read on its own so a database without the column changes nothing: the read fails, the map stays
  // empty and every member is emailed in English, exactly as before. Never throws, never blocks the run.
  const langById = new Map<string, Lang>();
  try {
    for (const ids of chunk(userIds)) {
      const { data: langRows, error: langErr } = await admin.from('holler_profiles').select('user_id, language').in('user_id', ids);
      if (langErr) break;
      for (const r of (langRows ?? []) as unknown as Array<{ user_id?: string; language?: unknown }>) {
        if (r && typeof r.user_id === 'string') langById.set(r.user_id, parseLang(r.language));
      }
    }
  } catch {
    langById.clear();
  }

  const plan = planNotify(userIds, profiles, now);
  counts.skipped_throttled = plan.counts.throttled ?? 0;
  counts.skipped_alerts_off = plan.counts.alerts_off ?? 0;
  counts.skipped_unverified = (plan.counts.unverified ?? 0) + (plan.counts.unverified_grace ?? 0);
  counts.skipped_not_entitled = (plan.counts.not_entitled ?? 0) + (plan.counts.past_due ?? 0) + (plan.counts.missing ?? 0);

  // Ineligible users will never be emailed these matches: mark them notified so they stop crowding out paying users.
  const skipMatchIds = plan.skip.flatMap((id) => (byUser.get(id) ?? []).map((m) => m.id));
  for (const ids of chunk(skipMatchIds)) {
    const { error: sErr } = await admin.from('holler_matches').update({ notified: true }).in('id', ids);
    if (sErr) counts.failed++;
    else counts.matches_skipped_marked += ids.length;
  }

  const profileById = new Map(profiles.map((p) => [p.user_id, p]));
  const eligible = plan.send.map((id) => profileById.get(id)).filter((p): p is ProfileRow => !!p);

  // A resident request's filtered description is not in the public record. For the request matches of the members about to be
  // emailed, read it here with the service role by the request's public id (open requests only). A failed read only drops the text.
  const requestIds = eligible
    .slice(0, MAX_USERS_PER_RUN)
    .flatMap((p) => byUser.get(p.user_id) ?? [])
    .map((m) => (Array.isArray(m.signal) ? m.signal[0] : m.signal))
    .filter((s): s is SignalRow => !!s && s.source === HOLLER_REQUEST_SOURCE && typeof s.external_id === 'string')
    .map((s) => s.external_id as string);
  const requestText = requestIds.length > 0 ? await requestTextByPublicId(admin, requestIds, now) : new Map<string, string>();

  // Round 18 (lib/enrich/business-lookup.ts): business phone and website from public listings, for cards about to be emailed only.
  // One budget for the whole run (HOLLER_LOOKUP_MAX_PER_RUN, HOLLER_LOOKUP_MAX_PER_DAY, the DataForSEO monthly cap) and one time budget
  // (LOOKUP_RUN_BUDGET_MS, 6 s in total; each call at most 3 s; none starts after 30 s into the run). At the deadline the email goes out
  // without the lookup. Without DataForSEO credentials, without migration 0026 or with HOLLER_LOOKUP_DRY_RUN set there is no call and
  // every card is as before.
  const lookupBudget = newBudget(lookupSettings());

  for (const p of eligible.slice(0, MAX_USERS_PER_RUN)) {
    if (Date.now() - started > 50_000) break;
    try {
      const userMatches = byUser.get(p.user_id) ?? [];
      const lang: Lang = langById.get(p.user_id) ?? 'en';
      // The plan-limited trades (the ones matching uses): the opportunity label of a record depends on the trade that matched it.
      const trades = matchScope({
        categories: p.categories ?? null,
        lat: null,
        lon: null,
        state: null,
        plan: p.plan ?? null,
        subscription_status: p.subscription_status,
        plan_source: p.plan_source ?? null,
        store_expires_at: p.store_expires_at ?? null,
      }).categories;
      const labelOf = (s: SignalRow): OpportunityLabel =>
        demoteExpired(labelForMember({ ...recordLabelInput(s), categories: s.categories }, trades), deadlineOf(s), now.getTime());
      const current = userMatches
        .map((m) => ({ m, s: Array.isArray(m.signal) ? m.signal[0] : m.signal }))
        // A resident request that has ended is never mailed. Its match is left unmarked: the scan cron deletes the record and the
        // match goes with it (ON DELETE CASCADE).
        .filter((r): r is { m: MatchRow; s: SignalRow } => !!r.s && !isEndedRequest(r.s, now.getTime()));
      // Only Act Now and Coming Soon are mailed (items 0.2 and 0.3). A market_insight match is stored for the in-app feed only, and a
      // context match stored before the label rules existed is hidden: both are marked notified without an email, so neither goes out
      // nor is read again on every run.
      // A feed-only match (alert_hold, migration 0027: a permit with no business or site address, below the member's minimum, or a held
      // trade family) is not an alert: marked notified with the silent ones below, never emailed.
      const held = current.filter((r) => !!holdOf(r.m));
      const live = held.length ? current.filter((r) => !holdOf(r.m)) : current;
      const rows = live.filter((r) => isAlertLabel(labelOf(r.s)));
      // One weather alert stored once per county is one digest item (sendRows). Every duplicate match in `rows` is still marked notified below.
      const sendRows = dedupeByAlert(rows, (r) => r.s);
      const silent = live.filter((r) => !isAlertLabel(labelOf(r.s)));
      for (const part of chunk([...silent, ...held].map((r) => r.m.id))) {
        const { error: qErr } = await admin.from('holler_matches').update({ notified: true }).in('id', part);
        if (qErr) counts.failed++;
        else counts.matches_skipped_marked += part.length;
      }
      if (sendRows.length === 0) continue;

      const { data: userRes, error: uErr } = await admin.auth.admin.getUserById(p.user_id);
      const email = userRes?.user?.email;
      if (uErr || !email) {
        counts.failed++;
        continue;
      }

      // AI ranking and notes (lib/ai): stored results only, no model call. Any failure gives empty maps: newest first, no notes.
      const sigIds = sendRows.map(({ s }) => s.id).filter((x): x is number => typeof x === 'number');
      // `trades` (above) is the plan-limited list: a member who moved from Pro to Solo gets no note for a trade the plan no longer uses.
      const [aiNotes, aiScores] = await Promise.all([notesFor(admin, sigIds, trades), scoresFor(admin, sigIds, trades)]);
      // No stored AI result for any of these (or migration 0014 not applied): keep newest first, exactly as before.
      const ranked = aiScores.size === 0 ? sendRows : rankSignals(
        sendRows.map((r) => ({ id: typeof r.s.id === 'number' ? r.s.id : -1, severity: r.s.severity ?? null, occurred_at: r.s.occurred_at, r })),
        aiScores,
      ).map((x) => x.r);
      // One "Contact:" line per alert whose record names an organization. Loaded for this member's own matches only (the loader checks
      // the owner and current access, and reads at most 200 ids in one query); any failure just leaves the lines out. Read BEFORE the
      // sort because a named contact is part of the score (PLAN-2.0 item 2.7).
      const withContacts = ranked.filter(({ s }) => typeof s.id === 'number' && mayHaveContacts(s.source ?? '', s.kind));
      const contacts = await loadMemberContacts({
        db: admin,
        userId: p.user_id,
        signalIds: withContacts.map(({ s }) => s.id as number),
        places: new Map(withContacts.map(({ s }) => [s.id as number, { city: s.city, state: s.state }])),
      });
      // Act Now first, then the deterministic score, then the AI ranking or newest-first order (a stable sort), then the digest cap.
      const ordered = orderByLabelScore(
        ranked,
        (r) => labelOf(r.s),
        (r) =>
          feedScoreFor(
            { source: r.s.source ?? '', kind: r.s.kind, subtype: r.s.subtype, title: r.s.title, summary: r.s.summary, occurred_at: r.s.occurred_at, categories: r.s.categories },
            trades,
            { hasContact: typeof r.s.id === 'number' && hasNamedContact(contacts.get(r.s.id)), nowMs: now.getTime() },
          ),
      );
      // Stage updates are never cut by the cap of 10: they go first into the cut, and the digest lists them first inside their label.
      const shown = [...ordered.filter((r) => isStageUpdate(r.s)), ...ordered.filter((r) => !isStageUpdate(r.s))].slice(0, MAX_ITEMS_IN_DIGEST);
      // The cards in this email that name a business: look up its public listing (cache first, then at most the budget's calls). Done
      // after the sort and the cap so only cards that are really sent are looked up. Any failure leaves the cards as they are.
      // No email provider means no email goes out (sendEmail skips), so nothing is looked up either.
      let cardContacts = contacts;
      if (env.RESEND_API_KEY && env.EMAIL_FROM && lookupBudget.msLeft > 0 && Date.now() - started < LOOKUP_START_CUTOFF_MS) {
        try {
          cardContacts = await lookupForCards(
            contacts,
            shown
              .filter(({ s }) => typeof s.id === 'number' && contacts.has(s.id))
              .map(({ s }) => ({ signalId: s.id as number, city: s.city, state: s.state, source: s.source ?? null, contact: namedContact({ source: s.source ?? '', kind: s.kind }, contacts.get(s.id as number)) })),
            lookupBudget,
            { db: admin, timeoutMs: LOOKUP_CALL_TIMEOUT_MS, deadline: Math.min(Date.now() + lookupBudget.msLeft, started + LOOKUP_START_CUTOFF_MS + LOOKUP_CALL_TIMEOUT_MS) },
          );
        } catch {
          cardContacts = contacts;
        }
      }
      const items: DigestItem[] = shown.map(({ m, s }) => ({
        kind: s.kind,
        // Round 23: the card's own action deep-links to this card in the feed (/app#card-<match id>, the anchor the feed renders).
        matchId: typeof m.id === 'number' ? m.id : null,
        source: s.source ?? null,
        subtype: s.subtype ?? null,
        title: s.title,
        summary: s.summary ?? null,
        // A Cobb County row's point is a stand-in for the county, so the line says so instead of naming a town.
        place: hasApproxLocation(s) ? approxLocationNote(s, lang) : [s.city, s.state].filter(Boolean).join(', ') || null,
        occurredAt: s.occurred_at,
        sourceUrl: s.url,
        detail: s.source === HOLLER_REQUEST_SOURCE && s.external_id ? (requestText.get(s.external_id) ?? null) : null,
        contact: typeof s.id === 'number' ? emailContact({ source: s.source ?? '', kind: s.kind }, cardContacts.get(s.id), lang) : null,
        note: typeof s.id === 'number' ? (aiNotes.get(s.id) ?? null) : null,
        label: labelOf(s),
        trade: tradeForRecord({ source: s.source ?? '', kind: s.kind, subtype: s.subtype, title: s.title, summary: s.summary }, s.categories, trades),
        deadline: deadlineOf(s),
        jobValue: s.jobValue ?? null,
        permitStage: s.permitStage ?? null,
        permitStageAt: s.permitStageAt ?? null,
        permitStageUpdate: isStageUpdate(s),
        bidLine: s.subtype === 'bid' ? bidCardLine({ buyer: s.bidBuyer, dueDate: s.dueDate, expiresAt: s.expires_at }, now, lang) : null,
        managerName: s.managerName ?? null,
        managerRole: s.managerRole ?? null,
      }));
      const unsubscribeUrl = `${siteUrl}/api/cron/notify/unsubscribe?t=${encodeURIComponent(
        signUnsubscribeToken(p.user_id, env.CRON_SECRET!),
      )}`;
      const mail = renderDigest({
        businessName: p.business_name,
        items,
        totalCount: sendRows.length,
        appUrl: `${siteUrl}/app`,
        unsubscribeUrl,
        now,
        lang,
      });
      const res = await sendEmail({
        to: email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        // RFC 8058 one-click: both headers are required for Gmail/Yahoo bulk-sender rules.
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      if ('skipped' in res && res.skipped) {
        counts.skipped_no_email_provider++;
        continue;
      }
      if (!('ok' in res) || !res.ok) {
        counts.failed++;
        continue;
      }
      const ids = rows.map((r) => r.m.id);
      let mErr = null;
      for (const part of chunk(ids)) {
        const r = await admin.from('holler_matches').update({ notified: true }).in('id', part);
        if (r.error) mErr = r.error;
      }
      const { error: lErr } = await admin
        .from('holler_profiles')
        .update({ last_notified_at: now.toISOString() })
        .eq('user_id', p.user_id);
      if (mErr || lErr) counts.failed++;
      // Outcome log (migration 0015): stamp emailed_at on this member's alert log rows. Best effort, never throws.
      await markAlertsEmailed(admin, p.user_id, rows.map((r) => r.s.id).filter((n): n is number => typeof n === 'number'), now);
      counts.emailed++;
      emailedThisRun.add(p.user_id);
      // Funnel (migration 0017): the member's first digest. `p` was read before this send, so last_notified_at is null only for
      // the first one; the unique index drops any repeat. Never throws, waits at most 1.5 s.
      if (!p.last_notified_at) await track('first_alert', { userId: p.user_id });
      counts.matches_marked += ids.length;
    } catch (e) {
      console.error('[notify] user failed', p.user_id, e instanceof Error ? e.message : e);
      counts.failed++;
    }
  }

  const quiet = quietWeekEnabled() ? await quietWeek() : null;

  // Push (migration 0020): independent of the email above. It reads its own never-pushed matches (holler_matches.pushed_at), so a
  // member with email alerts off or an unconfirmed address still gets one, at most one per member per hour, counting only matches
  // new since the last push. Never throws; not_configured without FIREBASE_SERVICE_ACCOUNT_JSON, not_ready before migration 0020.
  const push = await pushNewMatches(admin, { now, deadline: started + 56_000 });

  // `refused` counts why answers were not attached (truncated, ambiguous, closed, address_mismatch ...); `breaker` is the owner line when the
  // daily circuit breaker stopped lookups ("Business lookups returned no usable match today (N tried). Run the lookup probe.").
  const lookup = { calls: lookupBudget.calls, found: lookupBudget.found, notFound: lookupBudget.notFound, cacheHits: lookupBudget.cacheHits, timedOut: lookupBudget.timedOut, spentUsd: lookupBudget.spentUsd, msLeft: lookupBudget.msLeft, skipped: lookupBudget.skipped, refused: lookupBudget.refused, breaker: lookupBudget.breaker };
  return Response.json({ ok: true, ...counts, ...(quiet ? { quiet } : {}), push, lookup, ms: Date.now() - started });
}
