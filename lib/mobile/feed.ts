import 'server-only';
import { holdOf, missingHoldColumn, shownHold, type AlertHold } from '@/lib/signals/alert-gate';
import { readWorkProfile } from '@/lib/auth/work-profile';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDistance, maskText } from '@/components/format';
import type { ContactRecord } from '@/lib/contacts/types';
import { loadFeedback } from '@/lib/feedback/service';
import type { FeedbackState } from '@/lib/feedback/types';
import { loadMemberContacts } from '@/lib/outreach/loader';
import { buildingBlockLine, mayHaveContacts, recordClass, type PlanContact } from '@/lib/outreach/plan';
import { t, type Lang } from '@/lib/i18n';
import { requestTextForMember } from '@/lib/requests/details';
import { intentLabel, intentLine, intentLineKey } from '@/lib/signals/intent';
import { approxLocationNote, hasApproxLocation } from '@/lib/signals/approx-location';
import { bidCardLine } from '@/lib/signals/bid-card';
import { SAM_SELECT, samCardLine } from '@/lib/signals/sam-notice';
import { bidHidden } from '@/lib/signals/bid-sources';
import { HOLLER_REQUEST_SOURCE, isEndedRequest } from '@/lib/signals/request-visibility';
import { getSourceMeta } from '@/lib/signals/source-meta';
import { DEADLINE_SELECT, deadlineOf, demoteExpired, keptMatchLabel, labelForMember, recordLabelInput, type OpportunityLabel } from '@/lib/signals/lead-rules';
import { cardBrief, summaryForCard, tradeForRecord } from '@/lib/signals/brief';
import { formatNotes } from '@/lib/signals/summary-i18n';
import { dedupeByAlert } from '@/lib/signals/alert-dedupe';
import { MANAGER_SELECT } from '@/lib/signals/managed-by';
import { VALUE_SELECT, jobValueOf } from '@/lib/signals/permit-value';
import { STAGE_SELECT } from '@/lib/signals/stage';
import { WEATHER_SELECT, weatherCardFields, weatherFactsOf } from '@/lib/signals/weather-hazard';
import { FEED_PAGE_SIZE, type AlertDto, type BriefDto, type ContactDto, type MatchStatus } from './types';

/**
 * The member's alerts for the app, built the way the web feed (app/app/page.tsx) builds them: the member's own matches read with
 * their own RLS client; for members with access, the resident request text (requestTextForMember), "who to contact" (the
 * lib/outreach loader, service role, only for signal ids from this member's matches) and their feedback answers; for a locked member,
 * masked text and nothing else. Any failure of an extra (contacts, request text, feedback) leaves that extra out, never the alert.
 */

export const MATCH_SELECT =
  `id,status,distance_mi,draft,created_at,alert_hold,signal:holler_signals(id,source,kind,title,summary,url,city,state,county,zip,lat,lon,severity,categories,occurred_at,expires_at,subtype:data->>subtype,approxLocation:data->>approxLocation,loc:data->>loc,alertId:data->>alertId,${DEADLINE_SELECT},${VALUE_SELECT},${STAGE_SELECT},${WEATHER_SELECT},bidBuyer:data->>buyer,${SAM_SELECT},${MANAGER_SELECT})`;

/** MATCH_SELECT without alert_hold, for a database without migration 0027. */
export const MATCH_SELECT_BEFORE_0027 = MATCH_SELECT.replace('alert_hold,', '');

export interface SignalRow {
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
  severity?: number | null;
  /** The point, for the label rules that need it (lead-rules recordLabelInput). Never sent to the app. */
  lat?: number | null;
  lon?: number | null;
  occurred_at: string;
  expires_at: string | null;
  subtype?: string | null;
  /** data->>approxLocation ('true' when the point is a city-centre stand-in): no distance is shown for it. */
  approxLocation?: string | null;
  /** The record's trades and any published fix-by or due date, for the opportunity label and deadline. */
  categories?: string[] | null;
  deadline?: string | null;
  fixBy?: string | null;
  responseDeadline?: string | null;
  dueDate?: string | null;
  /** City open bids only: data.buyer. */
  bidBuyer?: string | null;
  /** Federal notices only: data.setAside (lib/signals/sam-notice.ts SAM_SELECT). */
  samSetAside?: string | null;
  /** County-level weather alerts: data.loc and data.alertId (one alert is stored once per county; a page shows it once). */
  loc?: string | null;
  alertId?: string | null;
  /** NYC no-heat rows only (data.managerName, data.managerRole), read with MANAGER_SELECT. */
  managerName?: string | null;
  managerRole?: string | null;
  /** Permits: data.jobValue (text form), the project value the city published. */
  jobValue?: string | null;
  /** Permits: data.permitStage and data.permitStageAt (STAGE_SELECT, migration 0025 feature). Absent before it and on rows with no stage update. */
  permitStage?: string | null;
  permitStageAt?: string | null;
  /** Round 33: WEATHER_SELECT aliases (an NWS alert's CAP hail size and gust, text form). Read only while HOLLER_HAIL_ROUTING_ENABLED is on. */
  maxHailSizeIn?: string | null;
  maxWindGustMph?: string | null;
}

export interface MatchRow {
  id: number;
  /** Feed-only reason (migration 0027, lib/signals/alert-gate.ts). Absent before 0027. */
  alert_hold?: string | null;
  status: string;
  distance_mi: number | null;
  draft: string | null;
  created_at: string;
  signal: SignalRow | SignalRow[] | null;
}

export interface Cursor {
  createdAt: string;
  id: number;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.createdAt, c.id]), 'utf8').toString('base64url');
}

/** Null for anything that is not a cursor this server made (wrong shape, bad date, bad id). */
export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(v) || v.length !== 2) return null;
    const [createdAt, id] = v as [unknown, unknown];
    if (typeof createdAt !== 'string' || createdAt.length > 40 || !/^[0-9T:.+\- Z]+$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) return null;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

const signalOf = (m: MatchRow): SignalRow | null => (Array.isArray(m.signal) ? (m.signal[0] ?? null) : m.signal);

const STATUSES: readonly MatchStatus[] = ['new', 'saved', 'done', 'dismissed'];

function absolute(url: string | null | undefined, siteUrl: string): string | null {
  if (!url) return null;
  if (url.startsWith('/')) return `${siteUrl}${url}`;
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * One contact for the app. An owner company on a code violation (round 18, role 'owner') is not sent: the app has no "Owner on the
 * public record" wording or source link yet, and older app builds would print it under a bare role label.
 */
function contactDto(c: ContactRecord): ContactDto | null {
  if (c.role === 'owner') return null;
  const out: ContactDto = { role: c.role, name: c.name };
  for (const k of ['attn', 'address', 'city', 'state', 'zip', 'phone', 'email', 'website', 'license'] as const) {
    if (c[k] !== undefined) out[k] = c[k] ?? null;
  }
  return out;
}

export interface BuildDeps {
  userId: string;
  locked: boolean;
  /** The member's own RLS client (feedback answers). */
  db: Pick<SupabaseClient, 'from'>;
  /** Service-role client for contacts and request text, or null when not configured. */
  admin: SupabaseClient | null;
  siteUrl: string;
  now: number;
  /** The member's trades under their plan (matchScope(profile).categories). Without it a record is labelled with the trade unknown. */
  trades?: readonly string[];
  /** The member's saved language (langOfProfile). Used for the building line only; the rest of the app API is English. Default 'en'. */
  lang?: Lang;
}

/**
 * Final review P3-1: an area record (311, code violation, weather) shows no contact row in the app, as on the web card (lib/outreach/plan.ts
 * outreachPlan ignores an area record's contacts). A whole-building NYC 311 request's block-level site is sent as `building` instead: the
 * web card's own line ("Building: the 2300 block of ... (the exact address is not published)"), in the member's language, under the
 * "Who to contact" heading, never under "Organizations and public offices only".
 */
export function areaContactParts(s: { source: string; kind: string }, list: ContactRecord[], lang: Lang): { contacts: ContactDto[]; building: { heading: string; line: string } | null } {
  if (recordClass(s.source, s.kind) !== 'area') return { contacts: list.map(contactDto).filter((c): c is ContactDto => c !== null), building: null };
  const line = buildingBlockLine(s, list as unknown as PlanContact[], lang);
  return { contacts: [], building: line ? { heading: t(lang, 'who.heading'), line } : null };
}

/**
 * Brief card v1 for the app (additive field). Same five parts as the web card: the record's own title and summary are the alert's
 * title and summary (part 1); a locked member's brief is built WITHOUT the record's text (the alert's own title and summary are masked for them, and the brief must not leak a permit type, a contract's work or storm remarks). The link is the record's page, else the dataset's home page; a locked member gets the home page only.
 */
function briefDto(s: SignalRow, label: OpportunityLabel, deps: BuildDeps): BriefDto {
  const trade = tradeForRecord({ source: s.source, kind: s.kind, subtype: s.subtype, title: s.title, summary: s.summary, weather: weatherFactsOf(s) }, s.categories, deps.trades ?? []);
  const b = cardBrief({ source: s.source, kind: s.kind, subtype: s.subtype, title: deps.locked ? null : s.title, summary: deps.locked ? null : s.summary, label, trade, url: deps.locked ? null : s.url, occurredAt: s.occurred_at, base: deps.siteUrl, managerName: deps.locked ? null : s.managerName, managerRole: deps.locked ? null : s.managerRole, jobValue: deps.locked ? null : s.jobValue, permitStage: deps.locked ? null : s.permitStage, permitStageAt: deps.locked ? null : s.permitStageAt, ...(deps.locked ? { alertHailIn: null, alertGustMph: null } : weatherCardFields(s)) });
  return {
    why: b.why,
    next: b.next,
    source: { label: b.source.label, url: b.source.href, linkText: b.source.linkText, recordLink: b.source.recordLink, date: b.source.dateText },
    uncertain: b.uncertain,
    confidence: b.confidence,
    ...(b.managedBy ? { managedBy: b.managedBy } : {}),
    valueLine: b.valueLine,
    ...(b.stageLine ? { stageLine: b.stageLine } : {}),
    ...(b.alertLine ? { alertLine: b.alertLine } : {}),
  };
}

/** Match rows (this member's own) to AlertDto, newest first as given. Ended resident requests and context records are dropped. */
export async function buildAlerts(rows: MatchRow[], deps: BuildDeps): Promise<AlertDto[]> {
  // A match the member saved or marked done stays whatever its label is now, without an alert chip it no longer earns (review P2-6).
  const labelOf = (s: SignalRow, status: string | null | undefined) =>
    keptMatchLabel(demoteExpired(labelForMember({ ...recordLabelInput(s), categories: s.categories }, deps.trades ?? []), deadlineOf(s), deps.now), status);
  // Context records (public graffiti, city tree trims, sewer work, park events) are never shown as alerts, even matches stored earlier.
  const live = dedupeByAlert(rows, (m) => signalOf(m)).filter((m) => {
    const s = signalOf(m);
    // City bids are hidden whenever HOLLER_BIDS_ENABLED is off, including matches stored while it was on.
    return !!s && !isEndedRequest(s, deps.now) && !bidHidden(s, undefined, deps.now) && labelOf(s, m.status) !== 'context';
  });
  if (live.length === 0) return [];

  let requestText: Record<number, string> = {};
  let contacts = new Map<number, ContactRecord[]>();
  let feedback = new Map<number, FeedbackState>();
  if (!deps.locked) {
    const requestMatchIds = live.filter((m) => signalOf(m)?.source === HOLLER_REQUEST_SOURCE).map((m) => m.id);
    if (deps.admin && requestMatchIds.length > 0) {
      try {
        requestText = await requestTextForMember(deps.admin, deps.userId, requestMatchIds, new Date(deps.now));
      } catch {
        requestText = {};
      }
    }
    const contactIds = live.map((m) => signalOf(m)!).filter((s) => mayHaveContacts(s.source, s.kind)).map((s) => s.id);
    if (deps.admin && contactIds.length > 0) {
      contacts = await loadMemberContacts({ db: deps.admin, userId: deps.userId, signalIds: contactIds, locked: false });
    }
    feedback = await loadFeedback(deps.db, deps.userId, live.map((m) => signalOf(m)!.id));
  }

  // The member's current minimum (migration 0027): a "Below your minimum" card loses the hold once the minimum is cleared or lowered.
  let minNow: number | null | undefined;
  if (!deps.locked && live.some((m) => holdOf(m) === 'below_min')) {
    const w = await readWorkProfile(deps.db, deps.userId).catch(() => null);
    minNow = w?.available ? w.settings.minValue : undefined;
  }
  return live.map((m) => {
    const s = signalOf(m)!;
    const hold = shownHold(holdOf(m), contacts.get(s.id), s.summary, { minValue: minNow, jobValue: jobValueOf({ jobValue: s.jobValue, summary: s.summary }) }, { subtype: s.subtype });
    const meta = getSourceMeta(s.source);
    const isRequest = s.source === HOLLER_REQUEST_SOURCE;
    const intentIn = { kind: s.kind, subtype: s.subtype ?? null, source: s.source, summary: s.summary, setAside: s.samSetAside };
    // A permit prints its value once: the brief's valueLine, so the summary's "$N job value" part is left out of the alert's summary (display only).
    const summary = isRequest
      ? (requestText[m.id] ?? null)
      : deps.locked
        ? s.summary
        : formatNotes(summaryForCard({ source: s.source, kind: s.kind, subtype: s.subtype, title: s.title, summary: s.summary, jobValue: s.jobValue }), 'en');
    const item: AlertDto = {
      matchId: m.id,
      signalId: s.id,
      matchedAt: m.created_at,
      status: (STATUSES as readonly string[]).includes(m.status) ? (m.status as MatchStatus) : 'new',
      kind: s.kind,
      source: s.source,
      sourceLabel: meta?.label ?? null,
      sourceUrl: absolute(meta?.sourceUrl, deps.siteUrl),
      title: s.title,
      summary,
      url: absolute(s.url, deps.siteUrl),
      city: s.city,
      state: s.state,
      county: s.county,
      zip: s.zip,
      // The app prints `place` on every card. A stand-in position (Cobb County) says so there, in plain words, with no distance.
      place: hasApproxLocation(s) ? approxLocationNote(s) : [s.city, s.state].filter(Boolean).join(', ') || null,
      occurredAt: s.occurred_at,
      expiresAt: s.expires_at,
      severity: typeof s.severity === 'number' ? s.severity : 1,
      intent: { key: intentLineKey(intentIn), label: intentLabel(intentIn), line: intentLine(intentIn, deps.lang ?? 'en') },
      label: labelOf(s, m.status) as AlertDto['label'],
      ...(hold ? { hold: hold as AlertHold } : {}),
      deadline: deadlineOf(s),
      brief: briefDto(s, labelOf(s, m.status), deps),
      bidLine: s.subtype === 'bid' ? bidCardLine({ buyer: s.bidBuyer, dueDate: s.dueDate, expiresAt: s.expires_at, source: s.source }, new Date(deps.now)) : samCardLine({ source: s.source, summary: s.summary, setAside: s.samSetAside }, deps.lang ?? 'en'),
      distanceMi: hasApproxLocation(s) ? null : (typeof m.distance_mi === 'number' && Number.isFinite(m.distance_mi) ? Math.round(m.distance_mi * 10) / 10 : null),
      distanceLabel: hasApproxLocation(s) ? null : formatDistance(m.distance_mi),
      feedback: feedback.get(s.id) ?? null,
      ...(() => {
        const parts = areaContactParts(s, contacts.get(s.id) ?? [], deps.lang ?? 'en');
        return { contacts: parts.contacts, ...(parts.building ? { building: parts.building } : {}) };
      })(),
      draft: m.draft,
      ai: { note: null },
    };
    // Locked: placeholders only, never the real text, link, draft or contacts (the web's LockedFeed rule).
    return deps.locked
      ? { ...item, title: maskText(s.title), summary: summary ? maskText(summary) : null, url: null, draft: null, county: null, zip: null, feedback: null, contacts: [], bidLine: null }
      : item;
  });
}

/** One page of the member's matches, newest first (created_at desc, id desc), keyset-paged. */
export async function readFeedPage(
  db: Pick<SupabaseClient, 'from'>,
  userId: string,
  cursor: Cursor | null,
): Promise<{ rows: MatchRow[]; nextCursor: Cursor | null; error: boolean }> {
  const read = (cols: string) => {
    let q = db.from('holler_matches').select(cols).eq('user_id', userId);
    if (cursor) q = q.or(`created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`);
    return q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(FEED_PAGE_SIZE);
  };
  let { data, error } = await read(MATCH_SELECT);
  // Before migration 0027 there is no alert_hold column: read again without it.
  if (error && missingHoldColumn(error)) ({ data, error } = await read(MATCH_SELECT_BEFORE_0027));
  if (error) return { rows: [], nextCursor: null, error: true };
  const rows = (data ?? []) as unknown as MatchRow[];
  const last = rows[rows.length - 1];
  return { rows, nextCursor: rows.length === FEED_PAGE_SIZE && last ? { createdAt: last.created_at, id: last.id } : null, error: false };
}

/** The member's own match for one signal, or null. */
export async function readOneMatch(db: Pick<SupabaseClient, 'from'>, userId: string, signalId: number): Promise<{ row: MatchRow | null; error: boolean }> {
  const read = (cols: string) => db.from('holler_matches').select(cols).eq('user_id', userId).eq('signal_id', signalId).limit(1);
  let { data, error } = await read(MATCH_SELECT);
  if (error && missingHoldColumn(error)) ({ data, error } = await read(MATCH_SELECT_BEFORE_0027));
  if (error) return { row: null, error: true };
  const rows = (data ?? []) as unknown as MatchRow[];
  return { row: rows[0] ?? null, error: false };
}
