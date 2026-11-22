import type { SupabaseClient } from '@supabase/supabase-js';
import { LIMITS, type Limit } from '@/lib/auth/limits';
import type { HitResult } from '@/lib/auth/ratelimit';
import { contactAddress } from '@/lib/email/templates';
import { renderRequestAdmin, renderRequestConfirm, renderRequestPublished, renderRequestReply } from '@/lib/email/request-emails';
import { lookupZip, nearestCity } from '@/lib/geo';
import { matchSignals } from '@/lib/signals/match';
import { INSERTED_SIGNAL_COLUMNS, canSeeAlerts, insertMatches, insertNewSignals, loadProfiles, type StoredSignal } from '@/lib/signals/store';

/** The stored request row, read back with what matching needs (kind and the opportunity fields), as the insert reads it. */
const REQUEST_SIGNAL_COLUMNS = INSERTED_SIGNAL_COLUMNS;
import { alertLogRowsFor, logAlerts } from '@/lib/moat/log';
import {
  CONFIRM_DAYS,
  DAY_MS,
  MAX_REPLIES_PER_BUSINESS_PER_DAY,
  MAX_REPLIES_PER_REQUEST,
  OPEN_DAYS,
  PURGE_AFTER_DAYS,
  REQUEST_SOURCE,
} from './constants';
import type { RequestEmail } from './mailer';
import { requestSummary } from './scrub';
import { buildRequestSignal } from './signal';
import {
  emailRateValue,
  hashToken,
  isTokenShape,
  linkToken,
  newPublicId,
  newRequestId,
  randomToken,
} from './tokens';
import { tradeLabel } from './trades';
import { isHoneypotHit, parseReplyMessage, parseRequest, type FieldErrors, type RawRequest } from './validate';

/**
 * Resident service requests: create, confirm, close/remove, business reply, housekeeping.
 * Every function takes its dependencies (service-role database, mail sender, rate limiter, secret, clock) so tests can run them
 * against an in-memory database. Nothing here logs, returns or copies the resident's email address: it is read only to be the `to`
 * of the confirm email and of business replies, and it is set to null when the request is closed or removed.
 */

export type Db = SupabaseClient;

export interface RequestDeps {
  /** Service-role client: holler_requests and holler_request_replies are not readable by anyone else. */
  db: Db;
  send: (msg: RequestEmail) => Promise<boolean>;
  hit: (limits: Limit[]) => Promise<HitResult>;
  /** Server secret for close/remove link tokens and the email rate-limit key (CRON_SECRET). */
  secret: string | undefined;
  siteUrl: string;
  now?: () => Date;
  /** Site owner inbox for new-request notices (ADMIN_EMAIL, else SUPPORT_EMAIL). */
  adminEmail?: string | null;
  isTrade: (id: string) => boolean;
  /** REQUESTS_ENABLED: false pauses new requests (the form shows a note, the API answers 503). Default true. */
  enabled?: boolean;
}

export interface RequestRow {
  id: string;
  public_id: string;
  status: 'pending' | 'open' | 'closed' | 'removed';
  trade: string;
  zip: string;
  city: string | null;
  state: string | null;
  place_slug: string | null;
  lat: number | null;
  lon: number | null;
  description: string | null;
  public_summary: string | null;
  email: string | null;
  created_at: string;
  confirmed_at: string | null;
  expires_at: string | null;
  closed_at: string | null;
  signal_id: number | null;
}

const REQUEST_COLUMNS =
  'id,public_id,status,trade,zip,city,state,place_slug,lat,lon,description,public_summary,email,created_at,confirmed_at,expires_at,closed_at,signal_id';

function clock(deps: Pick<RequestDeps, 'now'>): Date {
  return deps.now ? deps.now() : new Date();
}

function placeLabel(r: Pick<RequestRow, 'city' | 'state' | 'zip'>): string {
  return r.city && r.state ? `${r.city}, ${r.state}` : r.city ?? `ZIP ${r.zip}`;
}

export function closeUrlFor(siteUrl: string, requestId: string, secret: string): string {
  return `${siteUrl}/request/close?token=${linkToken('close', requestId, secret)}`;
}
function removeUrlFor(siteUrl: string, requestId: string, secret: string): string {
  return `${siteUrl}/request/close?token=${linkToken('remove', requestId, secret)}`;
}

/** Columns emptied when a request ends (at once on close or remove, 30 days after it runs out). Kept: trade, ZIP, city, state, dates. */
export const ENDED_WIPE = { email: null, description: null, public_summary: null, lat: null, lon: null } as const;

/** True while a request can still be seen, matched and replied to. Past expiry counts as closed everywhere. */
export function isOpen(r: Pick<RequestRow, 'status' | 'expires_at' | 'email'>, now: Date): boolean {
  if (r.status !== 'open' || !r.expires_at || !r.email) return false;
  const exp = Date.parse(r.expires_at);
  return Number.isFinite(exp) && exp > now.getTime();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------------------------------------------

export type CreateResult =
  | { status: 'accepted' }
  | { status: 'invalid'; errors: FieldErrors }
  | { status: 'limited' }
  | { status: 'paused' }
  | { status: 'unavailable' };

/**
 * Validates, rate limits and stores a pending request, then emails the confirm link.
 * 'accepted' is returned for a new email, a repeated email, an email over its daily limit (silently dropped) and a honeypot hit
 * (silently dropped), so the answer never says whether an address was seen before. Only the per-IP limit gives a different answer.
 */
export async function createRequest(deps: RequestDeps, raw: RawRequest, ip: string): Promise<CreateResult> {
  if (deps.enabled === false) return { status: 'paused' };
  if (isHoneypotHit(raw)) return { status: 'accepted' };

  const parsed = parseRequest(raw, deps.isTrade);
  if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
  const input = parsed.data;

  const place = lookupZip(input.zip);
  if (!place) return { status: 'invalid', errors: { zip: 'We could not find that ZIP code. Check it and try again.' } };

  if (!deps.secret) {
    console.error('[requests] CRON_SECRET missing, cannot sign request links');
    return { status: 'unavailable' };
  }

  const ipHit = await deps.hit([LIMITS.requestIp(ip)]);
  if (ipHit === 'limited') return { status: 'limited' };
  if (ipHit === 'error') return { status: 'unavailable' };
  const emailHit = await deps.hit([LIMITS.requestEmail(emailRateValue(input.email, deps.secret))]);
  if (emailHit === 'limited') return { status: 'accepted' };
  if (emailHit === 'error') return { status: 'unavailable' };
  // Site-wide brake on confirmation emails per day. Counted only for emails we are about to send.
  const globalHit = await deps.hit([LIMITS.requestConfirmGlobal()]);
  if (globalHit === 'limited') return { status: 'paused' };
  if (globalHit === 'error') return { status: 'unavailable' };

  const now = clock(deps);
  const id = newRequestId();
  const confirmToken = randomToken();
  const row = {
    id,
    public_id: newPublicId(),
    status: 'pending' as const,
    trade: input.trade,
    zip: place.zip,
    city: place.city,
    state: place.state,
    place_slug: nearestCity(place.lat, place.lon, 40)?.slug ?? null,
    lat: place.lat,
    lon: place.lon,
    description: input.description,
    public_summary: requestSummary(input.description),
    email: input.email,
    confirm_token_hash: hashToken('confirm', confirmToken),
    close_token_hash: hashToken('close', linkToken('close', id, deps.secret)),
    remove_token_hash: hashToken('remove', linkToken('remove', id, deps.secret)),
    consent_at: now.toISOString(),
    created_at: now.toISOString(),
  };

  const { error } = await deps.db.from('holler_requests').insert(row);
  if (error) {
    console.error('[requests] insert failed', error.code ?? 'unknown');
    return { status: 'unavailable' };
  }

  const mail = renderRequestConfirm({
    confirmUrl: `${deps.siteUrl}/request/confirm?token=${confirmToken}`,
    tradeLabel: tradeLabel(row.trade),
    place: placeLabel(row),
    summary: row.public_summary,
    openDays: OPEN_DAYS,
    confirmDays: CONFIRM_DAYS,
  });
  const sent = await deps.send({ to: input.email, subject: mail.subject, html: mail.html, text: mail.text }).catch(() => false);
  if (!sent) {
    // Nobody can confirm a request whose link never went out; drop it so no email address sits unused.
    await deps.db.from('holler_requests').delete().eq('id', id);
    console.error('[requests] confirm email not sent');
    return { status: 'unavailable' };
  }
  return { status: 'accepted' };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------------------------------------------------------------

export type ConfirmResult =
  | { state: 'confirmed'; closeUrl: string }
  | { state: 'already_open'; closeUrl: string }
  | { state: 'ended' }
  | { state: 'invalid' }
  | { state: 'error' };

async function findBy(db: Db, column: string, value: string): Promise<{ row: RequestRow | null; error: boolean }> {
  const { data, error } = await db.from('holler_requests').select(REQUEST_COLUMNS).eq(column, value).maybeSingle();
  if (error) return { row: null, error: true };
  return { row: (data as RequestRow | null) ?? null, error: false };
}

/** Expires the public record of a request at once (the scan cron deletes it on its next run). Never throws. */
async function expireSignal(db: Db, publicId: string, now: Date): Promise<void> {
  try {
    const { error } = await db
      .from('holler_signals')
      .update({ expires_at: now.toISOString(), summary: null })
      .eq('source', REQUEST_SOURCE)
      .eq('external_id', publicId);
    if (error) console.error('[requests] could not expire public record', error.code ?? 'unknown');
  } catch {
    console.error('[requests] could not expire public record');
  }
}

/** The request as it is in the database right now, or null when it is no longer open (closed, removed, expired, email gone). */
async function stillOpen(db: Db, id: string, now: Date): Promise<RequestRow | null | 'error'> {
  const fresh = await findBy(db, 'id', id);
  if (fresh.error) return 'error';
  return fresh.row && isOpen(fresh.row, now) ? fresh.row : null;
}

/**
 * Writes (or finds) the public holler_signals row and matches it to current members. Safe to run again: the signal insert and the
 * match insert both ignore duplicates. Throws only when the signal row could not be written.
 * A close or remove can land while this runs (review P2-3). So after the public row exists, the request is read again: if it is no
 * longer open the row is expired at once, nothing is matched, and 'ended' is returned. A close that lands after that read expires
 * the row itself (closeRequest always expires the public row after changing the status).
 */
async function publish(deps: RequestDeps, row: RequestRow, expiresAt: Date, now: Date): Promise<'live' | 'ended'> {
  const signal = buildRequestSignal(row, { siteUrl: deps.siteUrl, now, expiresAt });
  const inserted = await insertNewSignals(deps.db, [signal]);
  let stored: StoredSignal | null = inserted[0] ?? null;
  if (!stored) {
    const { data } = await deps.db
      .from('holler_signals')
      .select(REQUEST_SIGNAL_COLUMNS)
      .eq('source', REQUEST_SOURCE)
      .eq('external_id', row.public_id)
      .maybeSingle();
    stored = (data as StoredSignal | null) ?? null;
  }
  if (!stored) throw new Error('signal not stored');

  const fresh = await stillOpen(deps.db, row.id, now);
  if (fresh === 'error') throw new Error('request not readable');
  if (!fresh) {
    await expireSignal(deps.db, row.public_id, now);
    return 'ended';
  }
  if (fresh.signal_id !== stored.id) {
    // Conditional: a request closed in the meantime is never linked to a public row again.
    await deps.db.from('holler_requests').update({ signal_id: stored.id }).eq('id', row.id).eq('status', 'open');
  }
  try {
    const profiles = await loadProfiles(deps.db, now);
    const matches = matchSignals([stored], profiles, undefined, now);
    if (matches.length > 0) {
      await insertMatches(deps.db, matches);
      // Outcome log (migration 0015). Never throws.
      await logAlerts(deps.db, alertLogRowsFor(matches, [stored], profiles));
    }
  } catch (e) {
    // The record is public and stays so; the next confirm click (or a re-run) matches again.
    console.error('[requests] matching failed', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
  }
  return 'live';
}

export async function confirmRequest(deps: RequestDeps, token: unknown): Promise<ConfirmResult> {
  if (!isTokenShape(token) || !deps.secret) return { state: 'invalid' };
  const found = await findBy(deps.db, 'confirm_token_hash', hashToken('confirm', token));
  if (found.error) return { state: 'error' };
  let row = found.row;
  if (!row) return { state: 'invalid' };
  const now = clock(deps);
  const closeUrl = closeUrlFor(deps.siteUrl, row.id, deps.secret);

  if (row.status === 'closed' || row.status === 'removed') return { state: 'ended' };

  if (row.status === 'pending') {
    if (Date.parse(row.created_at) + CONFIRM_DAYS * DAY_MS <= now.getTime()) return { state: 'invalid' };
    const expiresAt = new Date(now.getTime() + OPEN_DAYS * DAY_MS);
    // Conditional on 'pending': a request closed before this click (the close link works on pending requests) is never opened.
    const { data: won, error } = await deps.db
      .from('holler_requests')
      .update({ status: 'open', confirmed_at: now.toISOString(), expires_at: expiresAt.toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id');
    if (error) return { state: 'error' };
    if (won && won.length > 0) {
      const opened: RequestRow = { ...row, status: 'open', confirmed_at: now.toISOString(), expires_at: expiresAt.toISOString() };
      let outcome: 'live' | 'ended';
      try {
        outcome = await publish(deps, opened, expiresAt, now);
      } catch {
        // Put it back so the same link works again; nothing became public.
        await deps.db
          .from('holler_requests')
          .update({ status: 'pending', confirmed_at: null, expires_at: null })
          .eq('id', row.id)
          .eq('status', 'open');
        await expireSignal(deps.db, row.public_id, now);
        return { state: 'error' };
      }
      if (outcome === 'ended') return { state: 'ended' };
      // Read once more right before anything is sent: a close in the last moment means no email goes to a deleted address.
      const latest = await stillOpen(deps.db, row.id, now);
      if (latest === 'error' || !latest) {
        if (latest !== 'error') await expireSignal(deps.db, row.public_id, now);
        return latest === 'error' ? { state: 'confirmed', closeUrl } : { state: 'ended' };
      }
      await notifyAdmin(deps, latest);
      await notifyResidentLive(deps, latest, closeUrl);
      return { state: 'confirmed', closeUrl };
    }
    // Another click won the race: read the row again and answer as "already open".
    const again = await findBy(deps.db, 'id', row.id);
    if (again.error || !again.row) return { state: 'error' };
    row = again.row;
  }

  if (row.status !== 'open') return { state: 'ended' };
  if (!row.expires_at || Date.parse(row.expires_at) <= now.getTime() || !row.email) return { state: 'ended' };
  try {
    const outcome = await publish(deps, row, new Date(row.expires_at), now);
    if (outcome === 'ended') return { state: 'ended' };
  } catch {
    return { state: 'error' };
  }
  return { state: 'already_open', closeUrl };
}

/** Once, on the click that publishes: "your request is live", with the close link. A failed send never undoes the confirm. */
async function notifyResidentLive(deps: RequestDeps, row: RequestRow, closeUrl: string): Promise<void> {
  if (!row.email) return;
  try {
    const mail = renderRequestPublished({
      tradeLabel: tradeLabel(row.trade),
      place: placeLabel(row),
      summary: row.public_summary,
      closeUrl,
      openDays: OPEN_DAYS,
    });
    const ok = await deps.send({ to: row.email, subject: mail.subject, html: mail.html, text: mail.text });
    if (!ok) console.error('[requests] live notice not sent');
  } catch {
    console.error('[requests] live notice failed');
  }
}

async function notifyAdmin(deps: RequestDeps, row: RequestRow): Promise<void> {
  if (!deps.adminEmail || !deps.secret) return;
  try {
    const mail = renderRequestAdmin({
      tradeLabel: tradeLabel(row.trade),
      place: placeLabel(row),
      zip: row.zip,
      description: row.description ?? '',
      summary: row.public_summary,
      publicId: row.public_id,
      removeUrl: removeUrlFor(deps.siteUrl, row.id, deps.secret),
    });
    await deps.send({ to: deps.adminEmail, subject: mail.subject, html: mail.html, text: mail.text });
  } catch {
    console.error('[requests] admin notice failed');
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Close (resident) and remove (site owner)
// ---------------------------------------------------------------------------------------------------------------------------------

export type CloseResult = { state: 'closed' | 'removed' | 'already_closed' | 'invalid' | 'error' };

/**
 * One link format for both: the token is looked up as a close token, then as a remove token.
 * Closing sets the status, deletes the stored email address, the raw description and the filtered text, and expires the public
 * record (expires_at = now), so it leaves public pages, matching, feeds and the reply form. Running it again changes nothing.
 */
export async function closeRequest(deps: RequestDeps, token: unknown): Promise<CloseResult> {
  if (!isTokenShape(token)) return { state: 'invalid' };
  let kind: 'close' | 'remove' = 'close';
  let found = await findBy(deps.db, 'close_token_hash', hashToken('close', token));
  if (!found.error && !found.row) {
    kind = 'remove';
    found = await findBy(deps.db, 'remove_token_hash', hashToken('remove', token));
  }
  if (found.error) return { state: 'error' };
  const row = found.row;
  if (!row) return { state: 'invalid' };

  const nowDate = clock(deps);
  const now = nowDate.toISOString();
  const already = kind === 'close' ? row.status === 'closed' || row.status === 'removed' : row.status === 'removed';
  // Ending a request wipes everything personal at once: the email address, the raw description and the filtered text (and the ZIP
  // mid-point). What stays is the trade, the ZIP code, the city and state, and the dates.
  const patch: Record<string, unknown> = { ...ENDED_WIPE };
  if (!already) patch.purged_at = now;
  if (!already) {
    if (kind === 'close') Object.assign(patch, { status: 'closed', closed_at: now });
    else Object.assign(patch, { status: 'removed', removed_at: now, closed_at: row.closed_at ?? now });
  }
  const { error } = await deps.db.from('holler_requests').update(patch).eq('id', row.id);
  if (error) return { state: 'error' };

  // Always after the status change: a confirm that is publishing at this moment either reads the new status (and expires its row)
  // or has already written the row, which this expires.
  await expireSignal(deps.db, row.public_id, nowDate);

  if (already) return { state: 'already_closed' };
  return { state: kind === 'close' ? 'closed' : 'removed' };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Business reply
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ReplierProfile {
  business_name: string;
  city: string | null;
  state: string | null;
  email_verified_at: string | null;
  subscription_status: string;
  trial_ends_at: string | null;
  /** Migration 0020 (absent before it): a lapsed store plan cannot reply (canSeeAlerts uses isPaidNow). */
  plan_source?: string | null;
  store_expires_at?: string | null;
}

export type ReplyCode =
  | 'sent'
  | 'unauthorized'
  | 'no_profile'
  | 'unverified'
  | 'no_access'
  | 'invalid'
  | 'not_found'
  | 'not_request'
  | 'closed'
  | 'already_replied'
  | 'full'
  | 'daily_limit'
  | 'limited'
  | 'send_failed'
  | 'unavailable';

export const REPLY_RESULTS: Record<ReplyCode, { status: number; message: string }> = {
  sent: { status: 200, message: 'Sent. They will get your reply by email.' },
  unauthorized: { status: 401, message: 'Log in to reply.' },
  no_profile: { status: 403, message: 'Finish setting up your account to reply.' },
  unverified: { status: 403, message: 'Confirm your email address first. Use the link we sent you.' },
  no_access: { status: 403, message: 'Replies need an active trial or plan.' },
  invalid: { status: 400, message: 'Check your reply and try again.' },
  not_found: { status: 404, message: 'We could not find that request.' },
  not_request: { status: 400, message: 'Only resident requests can be answered here.' },
  closed: { status: 409, message: 'This request is closed.' },
  already_replied: { status: 409, message: 'You already replied to this request.' },
  full: { status: 409, message: `This request already has ${MAX_REPLIES_PER_REQUEST} replies.` },
  daily_limit: { status: 429, message: `You can send ${MAX_REPLIES_PER_BUSINESS_PER_DAY} replies a day. Try again tomorrow.` },
  limited: { status: 429, message: 'Too many tries. Wait a bit, then try again.' },
  send_failed: { status: 502, message: 'We could not send that just now. Try again.' },
  unavailable: { status: 503, message: 'Replies are unavailable right now. Try again in a moment.' },
};

export interface ReplyContext {
  user: { id: string; email?: string | null } | null;
  profile: ReplierProfile | null;
  matchId: unknown;
  message: unknown;
}

export async function replyToRequest(
  deps: RequestDeps,
  ctx: ReplyContext,
): Promise<{ code: ReplyCode; error?: string }> {
  const now = clock(deps);
  if (!ctx.user) return { code: 'unauthorized' };
  if (!ctx.profile) return { code: 'no_profile' };
  if (!ctx.profile.email_verified_at || !ctx.user.email) return { code: 'unverified' };
  if (!canSeeAlerts(ctx.profile, now.getTime())) return { code: 'no_access' };

  const matchId = typeof ctx.matchId === 'string' && /^\d+$/.test(ctx.matchId) ? Number(ctx.matchId) : ctx.matchId;
  if (typeof matchId !== 'number' || !Number.isSafeInteger(matchId) || matchId <= 0) return { code: 'invalid' };
  const msg = parseReplyMessage(ctx.message);
  if (!msg.ok) return { code: 'invalid', error: msg.error };
  if (!deps.secret) return { code: 'unavailable' };

  const limited = await deps.hit([LIMITS.requestReplyUser(ctx.user.id)]);
  if (limited === 'limited') return { code: 'limited' };
  // A limiter outage does not block replies: the per-request and per-day caps below are read from the database.

  const db = deps.db;
  const { data: match, error: mErr } = await db
    .from('holler_matches')
    .select('id, user_id, signal_id')
    .eq('id', matchId)
    .eq('user_id', ctx.user.id)
    .maybeSingle();
  if (mErr) return { code: 'unavailable' };
  if (!match) return { code: 'not_found' };

  const { data: signal, error: sErr } = await db
    .from('holler_signals')
    .select('id, source, external_id')
    .eq('id', (match as { signal_id: number }).signal_id)
    .maybeSingle();
  if (sErr) return { code: 'unavailable' };
  if (!signal) return { code: 'not_found' };
  const sig = signal as { source: string; external_id: string };
  if (sig.source !== REQUEST_SOURCE) return { code: 'not_request' };

  const found = await findBy(db, 'public_id', sig.external_id);
  if (found.error) return { code: 'unavailable' };
  const request = found.row;
  if (!request) return { code: 'not_found' };
  if (!isOpen(request, now)) return { code: 'closed' };

  const { data: mine, error: rErr } = await db
    .from('holler_request_replies')
    .select('id')
    .eq('request_id', request.id)
    .eq('user_id', ctx.user.id)
    .maybeSingle();
  if (rErr) return { code: 'unavailable' };
  if (mine) return { code: 'already_replied' };

  const { count: forRequest, error: cErr } = await db
    .from('holler_request_replies')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', request.id);
  if (cErr) return { code: 'unavailable' };
  if ((forRequest ?? 0) >= MAX_REPLIES_PER_REQUEST) return { code: 'full' };

  const { count: today, error: dErr } = await db
    .from('holler_request_replies')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', ctx.user.id)
    .gte('created_at', new Date(now.getTime() - DAY_MS).toISOString());
  if (dErr) return { code: 'unavailable' };
  if ((today ?? 0) >= MAX_REPLIES_PER_BUSINESS_PER_DAY) return { code: 'daily_limit' };

  // Record first (the unique key and the database guard settle races), then send; a failed send removes the record again.
  const { data: rec, error: iErr } = await db
    .from('holler_request_replies')
    .insert({ request_id: request.id, user_id: ctx.user.id, match_id: matchId, created_at: now.toISOString() })
    .select('id')
    .single();
  if (iErr || !rec) {
    const text = `${iErr?.code ?? ''} ${iErr?.message ?? ''}`;
    if (/23505|duplicate|unique/i.test(text)) return { code: 'already_replied' };
    if (/holler_request_reply_cap/.test(text)) return { code: 'full' };
    if (/holler_request_daily_cap/.test(text)) return { code: 'daily_limit' };
    if (/holler_request_not_open/.test(text)) return { code: 'closed' };
    return { code: 'unavailable' };
  }
  const replyId = (rec as { id: number }).id;

  // Read the request again right before sending: a close that landed after the checks above deleted the address, and nothing may go
  // to it (review P2-3). The reply record is removed so it does not count.
  const latest = await stillOpen(db, request.id, now);
  if (latest === 'error' || !latest || !latest.email) {
    await db.from('holler_request_replies').delete().eq('id', replyId);
    return { code: latest === 'error' ? 'unavailable' : 'closed' };
  }

  const businessPlace = [ctx.profile.city, ctx.profile.state].filter(Boolean).join(', ') || null;
  const mail = renderRequestReply({
    businessName: ctx.profile.business_name,
    businessPlace,
    message: msg.message,
    tradeLabel: tradeLabel(request.trade),
    place: placeLabel(request),
    closeUrl: closeUrlFor(deps.siteUrl, request.id, deps.secret),
    reportAddress: contactAddress(),
    replyRef: `${request.public_id}-${replyId}`,
  });
  const sent = await deps
    .send({ to: latest.email, replyTo: ctx.user.email, subject: mail.subject, html: mail.html, text: mail.text })
    .catch(() => false);
  if (!sent) {
    await db.from('holler_request_replies').delete().eq('id', replyId);
    return { code: 'send_failed' };
  }
  return { code: 'sent' };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Feed state
// ---------------------------------------------------------------------------------------------------------------------------------

export type ReplyState = 'open' | 'replied' | 'closed' | 'full';

/** For the signed-in feed: what the Reply control should show for each of this member's request matches. Other ids are left out. */
export async function replyStates(db: Db, userId: string, matchIds: number[], now: Date = new Date()): Promise<Record<number, ReplyState>> {
  const ids = [...new Set(matchIds.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 200);
  const out: Record<number, ReplyState> = {};
  if (ids.length === 0) return out;

  const { data: matches } = await db.from('holler_matches').select('id, signal_id').eq('user_id', userId).in('id', ids);
  const m = (matches ?? []) as { id: number; signal_id: number }[];
  if (m.length === 0) return out;
  const { data: signals } = await db
    .from('holler_signals')
    .select('id, external_id')
    .eq('source', REQUEST_SOURCE)
    .in('id', [...new Set(m.map((x) => x.signal_id))]);
  const s = (signals ?? []) as { id: number; external_id: string }[];
  if (s.length === 0) return out;
  const { data: requests } = await db
    .from('holler_requests')
    .select('id, public_id, status, expires_at, email')
    .in('public_id', s.map((x) => x.external_id));
  const r = (requests ?? []) as Pick<RequestRow, 'id' | 'public_id' | 'status' | 'expires_at' | 'email'>[];
  const reqIds = r.map((x) => x.id);
  const { data: replies } = reqIds.length
    ? await db.from('holler_request_replies').select('request_id, user_id').in('request_id', reqIds)
    : { data: [] };
  const rep = (replies ?? []) as { request_id: string; user_id: string }[];

  const bySignal = new Map(s.map((x) => [x.id, x.external_id]));
  const byPublic = new Map(r.map((x) => [x.public_id, x]));
  for (const match of m) {
    const pub = bySignal.get(match.signal_id);
    const req = pub ? byPublic.get(pub) : undefined;
    if (!req) continue;
    const forReq = rep.filter((x) => x.request_id === req.id);
    if (forReq.some((x) => x.user_id === userId)) out[match.id] = 'replied';
    else if (!isOpen(req, now)) out[match.id] = 'closed';
    else if (forReq.length >= MAX_REPLIES_PER_REQUEST) out[match.id] = 'full';
    else out[match.id] = 'open';
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PurgeResult {
  purged: number;
  deletedPending: number;
  /** Public holler_signals rows of ended requests deleted this run (their holler_matches rows go with them, ON DELETE CASCADE). */
  signalsDeleted: number;
  error: string | null;
}

/** Most rows each sweep touches per run. The cron runs every 15 minutes, so a backlog clears over a few runs. */
export const PURGE_BATCH = 200;

/**
 * Deletes the public record (holler_signals row, source 'holler-request', external_id = public id) of every request that has ended:
 * closed, removed, or open past its expiry. Two bounded sweeps, both safe to run again:
 *  1. public rows whose expires_at has passed (closing sets it to the close time; a request that runs out reaches it after 14 days);
 *  2. ended requests that still point at a public row (for example a close whose expiry update failed).
 * holler_matches rows cascade with the signal (migration 0001), holler_requests.signal_id and holler_request_replies.match_id are set
 * to null by their foreign keys (migration 0005); signal_id is also cleared here so sweep 2 never picks the same request twice.
 */
async function deleteEndedRequestSignals(db: Db, now: Date, errors: string[]): Promise<number> {
  const nowIso = now.toISOString();
  let deleted = 0;

  const expired = await db
    .from('holler_signals')
    .select('id')
    .eq('source', REQUEST_SOURCE)
    .lte('expires_at', nowIso)
    .limit(PURGE_BATCH);
  if (expired.error) errors.push(expired.error.message);
  const expiredIds = ((expired.data ?? []) as { id: number }[]).map((r) => r.id);
  if (expiredIds.length > 0) {
    const del = await db.from('holler_signals').delete().eq('source', REQUEST_SOURCE).in('id', expiredIds).select('id');
    if (del.error) errors.push(del.error.message);
    else {
      deleted += del.data?.length ?? 0;
      const unlink = await db.from('holler_requests').update({ signal_id: null }).in('signal_id', expiredIds);
      if (unlink.error) errors.push(unlink.error.message);
    }
  }

  const [closed, ranOut] = await Promise.all([
    db
      .from('holler_requests')
      .select('id, public_id')
      .in('status', ['closed', 'removed'])
      .not('signal_id', 'is', null)
      .limit(PURGE_BATCH),
    db
      .from('holler_requests')
      .select('id, public_id')
      .eq('status', 'open')
      .lte('expires_at', nowIso)
      .not('signal_id', 'is', null)
      .limit(PURGE_BATCH),
  ]);
  if (closed.error) errors.push(closed.error.message);
  if (ranOut.error) errors.push(ranOut.error.message);
  const ended = [...((closed.data ?? []) as { id: string; public_id: string }[]), ...((ranOut.data ?? []) as { id: string; public_id: string }[])];
  if (ended.length > 0) {
    const del = await db
      .from('holler_signals')
      .delete()
      .eq('source', REQUEST_SOURCE)
      .in('external_id', ended.map((r) => r.public_id))
      .select('id');
    if (del.error) errors.push(del.error.message);
    else {
      deleted += del.data?.length ?? 0;
      const unlink = await db.from('holler_requests').update({ signal_id: null }).in('id', ended.map((r) => r.id));
      if (unlink.error) errors.push(unlink.error.message);
    }
  }
  return deleted;
}

/**
 * For the scan cron (every 15 minutes, not on dry runs). Three jobs, each bounded, idempotent, and never throwing:
 *  - deletes the public record of every request that has ended (closed, removed or past expiry), so it leaves city, weekly and trade
 *    pages, /check, /data, digests and feeds within one cron run;
 *  - wipes the email address, the raw description and the filtered text of requests that ran out more than 30 days ago (closed and
 *    removed requests were wiped when they ended; this sweep also catches any that were not);
 *  - deletes requests never confirmed within 7 days (their link has expired; nothing was public).
 */
export async function purgeEndedRequests(db: Db, now: Date = new Date()): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * DAY_MS).toISOString();
  const pendingCutoff = new Date(now.getTime() - CONFIRM_DAYS * DAY_MS).toISOString();
  const wipe = { ...ENDED_WIPE, purged_at: now.toISOString() };
  let purged = 0;
  let deletedPending = 0;
  let signalsDeleted = 0;
  const errors: string[] = [];
  try {
    signalsDeleted = await deleteEndedRequestSignals(db, now, errors);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  try {
    const ended = await db
      .from('holler_requests')
      .update(wipe)
      .in('status', ['closed', 'removed'])
      .lt('closed_at', cutoff)
      .is('purged_at', null)
      .select('id');
    if (ended.error) errors.push(ended.error.message);
    purged += ended.data?.length ?? 0;

    const expired = await db
      .from('holler_requests')
      .update(wipe)
      .eq('status', 'open')
      .lt('expires_at', cutoff)
      .is('purged_at', null)
      .select('id');
    if (expired.error) errors.push(expired.error.message);
    purged += expired.data?.length ?? 0;

    const pending = await db
      .from('holler_requests')
      .delete()
      .eq('status', 'pending')
      .lt('created_at', pendingCutoff)
      .select('id');
    if (pending.error) errors.push(pending.error.message);
    deletedPending += pending.data?.length ?? 0;
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  return { purged, deletedPending, signalsDeleted, error: errors.length ? errors.join('; ').slice(0, 300) : null };
}
