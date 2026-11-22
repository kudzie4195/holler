import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDistance, maskText } from '@/components/format';
import type { ContactRecord } from '@/lib/contacts/types';
import { loadFeedback } from '@/lib/feedback/service';
import type { FeedbackState } from '@/lib/feedback/types';
import { loadMemberContacts } from '@/lib/outreach/loader';
import { mayHaveContacts } from '@/lib/outreach/plan';
import { requestTextForMember } from '@/lib/requests/details';
import { INTENT_LABEL, intentLine, intentLineKey, intentOf } from '@/lib/signals/intent';
import { approxLocationNote, hasApproxLocation } from '@/lib/signals/approx-location';
import { HOLLER_REQUEST_SOURCE, isEndedRequest } from '@/lib/signals/request-visibility';
import { getSourceMeta } from '@/lib/signals/source-meta';
import { OPPORTUNITY_DATA_COLUMNS, memberOpportunity, opportunityDto, type OpportunityRowFields } from '@/lib/signals/member-opportunity';
import { FEED_PAGE_SIZE, type AlertDto, type ContactDto, type MatchStatus } from './types';

/**
 * The member's alerts for the app, built the way the web feed (app/app/page.tsx) builds them: the member's own matches read with
 * their own RLS client; for members with access, the resident request text (requestTextForMember), "who to contact" (the
 * lib/outreach loader, service role, only for signal ids from this member's matches) and their feedback answers; for a locked member,
 * masked text and nothing else. Any failure of an extra (contacts, request text, feedback) leaves that extra out, never the alert.
 */

export const MATCH_SELECT = `id,status,distance_mi,draft,created_at,signal:holler_signals(id,source,kind,title,summary,url,city,state,county,zip,severity,occurred_at,expires_at,categories,subtype:data->>subtype,${OPPORTUNITY_DATA_COLUMNS})`;

export interface SignalRow extends OpportunityRowFields {
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
  occurred_at: string;
  expires_at: string | null;
  subtype?: string | null;
}

export interface MatchRow {
  id: number;
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

function contactDto(c: ContactRecord): ContactDto {
  const out: ContactDto = { role: c.role, name: c.name };
  for (const k of ['attn', 'address', 'city', 'state', 'zip', 'phone', 'email', 'website'] as const) {
    if (c[k] !== undefined) out[k] = c[k] ?? null;
  }
  return out;
}

/** The DTO without 'context' (buildAlerts never sends a context row, so this only narrows the type). */
function shownOpportunity(o: ReturnType<typeof opportunityDto>): AlertDto['opportunity'] {
  return { ...o, label: o.label === 'context' ? 'intel' : o.label };
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
  /**
   * The member's plan-limited trades and keyword watches (lib/plan matchScope), for each alert's `opportunity`. Rows whose best label
   * is 'context' are dropped (they may be in holler_matches from before trade matching used opportunity).
   */
  trades: readonly string[];
  keywords?: readonly string[];
}

/** Match rows (this member's own) to AlertDto, newest first as given. Ended resident requests and context rows are dropped. */
export async function buildAlerts(rows: MatchRow[], deps: BuildDeps): Promise<AlertDto[]> {
  const opp = new Map<number, ReturnType<typeof memberOpportunity>>();
  const live = rows.filter((m) => {
    const s = signalOf(m);
    if (!s || isEndedRequest(s, deps.now)) return false;
    const o = memberOpportunity(s, deps.trades, deps.keywords ?? []);
    if (o.label === 'context') return false;
    opp.set(m.id, o);
    return true;
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

  return live.map((m) => {
    const s = signalOf(m)!;
    const meta = getSourceMeta(s.source);
    const isRequest = s.source === HOLLER_REQUEST_SOURCE;
    const intentIn = { kind: s.kind, subtype: s.subtype ?? null, source: s.source };
    const summary = isRequest ? (requestText[m.id] ?? null) : s.summary;
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
      intent: { key: intentLineKey(intentIn), label: INTENT_LABEL[intentOf(intentIn)], line: intentLine(intentIn) },
      opportunity: shownOpportunity(opportunityDto(opp.get(m.id)!)),
      distanceMi: hasApproxLocation(s) ? null : (typeof m.distance_mi === 'number' && Number.isFinite(m.distance_mi) ? Math.round(m.distance_mi * 10) / 10 : null),
      distanceLabel: hasApproxLocation(s) ? null : formatDistance(m.distance_mi),
      feedback: feedback.get(s.id) ?? null,
      contacts: (contacts.get(s.id) ?? []).map(contactDto),
      draft: m.draft,
      ai: { note: null },
    };
    // Locked: placeholders only, never the real text, link, draft or contacts (the web's LockedFeed rule).
    return deps.locked
      ? { ...item, title: maskText(s.title), summary: summary ? maskText(summary) : null, url: null, draft: null, county: null, zip: null, feedback: null, contacts: [], opportunity: { ...item.opportunity, why: maskText(item.opportunity.why) } }
      : item;
  });
}

/** One page of the member's matches, newest first (created_at desc, id desc), keyset-paged. */
export async function readFeedPage(
  db: Pick<SupabaseClient, 'from'>,
  userId: string,
  cursor: Cursor | null,
): Promise<{ rows: MatchRow[]; nextCursor: Cursor | null; error: boolean }> {
  let q = db.from('holler_matches').select(MATCH_SELECT).eq('user_id', userId);
  if (cursor) q = q.or(`created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`);
  const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(FEED_PAGE_SIZE);
  if (error) return { rows: [], nextCursor: null, error: true };
  const rows = (data ?? []) as unknown as MatchRow[];
  const last = rows[rows.length - 1];
  return { rows, nextCursor: rows.length === FEED_PAGE_SIZE && last ? { createdAt: last.created_at, id: last.id } : null, error: false };
}

/** The member's own match for one signal, or null. */
export async function readOneMatch(db: Pick<SupabaseClient, 'from'>, userId: string, signalId: number): Promise<{ row: MatchRow | null; error: boolean }> {
  const { data, error } = await db.from('holler_matches').select(MATCH_SELECT).eq('user_id', userId).eq('signal_id', signalId).limit(1);
  if (error) return { row: null, error: true };
  const rows = (data ?? []) as unknown as MatchRow[];
  return { row: rows[0] ?? null, error: false };
}
