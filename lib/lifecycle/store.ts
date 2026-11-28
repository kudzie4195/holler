import type { SupabaseClient } from '@supabase/supabase-js';
import { chunk } from '../email/notify-logic';
import { HOLLER_REQUEST_SOURCE } from '../signals/request-visibility';
import { isFeedLabel, keptMatchLabel, labelForMember, recordLabelInput } from '../signals/lead-rules';
import { missingHoldColumn } from '../signals/alert-gate';
import { FOLLOWUP_SIGNAL_SELECT, followupDrop, followupFilterEnabled, type FollowupDrop } from '../signals/followup-filter';
import { STAGE_SELECT } from '../signals/stage';
import { WEATHER_SELECT } from '../signals/weather-hazard';
import { recentPreviewFor, typeLabel, PREVIEW_DAYS, type PreviewProfile } from '../preview/recent';
import { trialStartedAt as readTrialStamp } from '../auth/membership';
import { missedSince } from './missed';
import { queryRanges, type LifecycleKind, type LifecycleProfile, type SendRow } from './select';
import type { AlertItem, TypeLine } from './templates';

type Db = Pick<SupabaseClient, 'from' | 'auth'>;

export interface FullProfile extends LifecycleProfile {
  business_name: string;
  categories: string[] | null;
  lat: number | null;
  lon: number | null;
  state: string | null;
  radius_mi: number | null;
  plan?: string | null;
  extra_areas?: unknown;
  keywords?: unknown;
}

export interface MatchesOf {
  /** Newest first. Resident requests are never included. */
  items: (AlertItem & { id: number })[];
  total: number;
  capped: boolean;
  /**
   * Round 35: how many matches the follow-up filter left out, by reason (lib/signals/followup-filter.ts). Present only while
   * HOLLER_FOLLOWUP_FILTER_ENABLED is on; absent otherwise, so the answer is what it was.
   */
  dropped?: Record<FollowupDrop, number>;
}

export interface QuietPreview {
  lines: TypeLine[];
  total: number;
  capped: boolean;
  days: number;
}

/** Everything the cron needs from the outside world. The supabase-backed one is createStore; tests pass an in-memory one. */
export interface LifecycleStore {
  loadProfiles(now: Date): Promise<FullProfile[]>;
  loadSends(userIds: string[]): Promise<SendRow[]>;
  /** 'claimed' when this call inserted the row, 'exists' when it was already there. Throws on any other error. */
  claim(userId: string, kind: LifecycleKind): Promise<'claimed' | 'exists'>;
  release(userId: string, kind: LifecycleKind): Promise<void>;
  isOptedOut(userId: string): Promise<boolean>;
  emailOf(userId: string): Promise<string | null>;
  /**
   * The person's one-trial stamp (auth app_metadata holler_trial_started_at), or null when there is none. Optional: a store without it
   * never skips a welcome. Throws or null on a read failure (both mean "treat as a first profile").
   */
  trialStartedAt?(userId: string): Promise<string | null>;
  /**
   * The member's matches for the welcome and trial-ending mail. With `trades` (the plan's trades, matchScope), each item carries this
   * base's label for the member (lead-rules labelForMember, the feed's own rule) and a match whose label is not a feed label (context)
   * is left out, exactly as the feed hides it (round 19 review, defect 9). Without `trades` every match is listed, unlabelled.
   */
  matchesOf(userId: string, trades?: readonly string[]): Promise<MatchesOf>;
  /** Null when there is no usable area, no trades, or the records cannot be read. A total of 0 is also null: nothing to say. */
  quietPreview(profile: FullProfile, now: Date): Promise<QuietPreview | null>;
  /** Throws when the records cannot be read. */
  missedSince(profile: FullProfile, now: Date): Promise<{ count: number; capped: boolean }>;
}

/** The ledger table is not there yet (migration 0016 not applied). The cron answers "skipped" instead of failing. */
export class NotMigrated extends Error {
  constructor() {
    super('holler_lifecycle_sends is missing');
  }
}

export function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message ?? '';
  return err.code === '42P01' || err.code === 'PGRST205' || (/holler_lifecycle_sends/.test(msg) && /does not exist|schema cache|not find/i.test(msg));
}

const PROFILE_COLUMNS =
  'user_id, business_name, created_at, email_verified_at, subscription_status, trial_ends_at, stripe_subscription_id, categories, lat, lon, state, radius_mi, plan, extra_areas, keywords';
const PROFILE_ROW_CAP = 1000;
const MATCH_ROW_CAP = 500;

interface SignalEmbed {
  id: number;
  source: string;
  kind: string;
  title: string | null;
  summary?: string | null;
  categories?: string[] | null;
  city: string | null;
  state: string | null;
  severity: number | null;
  occurred_at: string;
  subtype: string | null;
  lat?: number | null;
  lon?: number | null;
  /** data->>permitStage (STAGE_SELECT), passed to the labeller only. */
  permitStage?: string | null;
  /** Round 33: WEATHER_SELECT aliases (an NWS alert's hail size and gust), passed to the labeller only. */
  maxHailSizeIn?: string | null;
  maxWindGustMph?: string | null;
  /** Round 35 (FOLLOWUP_SIGNAL_SELECT, only while the follow-up filter is on): what the bid test reads. */
  expires_at?: string | null;
  dueDate?: string | null;
  retiredAt?: string | null;
}

export function createStore(db: Db): LifecycleStore {
  const sends = () => db.from('holler_lifecycle_sends');
  // One auth read per member per run, shared by emailOf and trialStartedAt.
  const users = new Map<string, Promise<{ email: string | null; stamp: string | null; ok: boolean }>>();
  const userOf = (userId: string) => {
    let p = users.get(userId);
    if (!p) {
      p = Promise.resolve(db.auth.admin.getUserById(userId)).then(
        ({ data, error }) => ({ email: error ? null : (data?.user?.email ?? null), stamp: error ? null : readTrialStamp(data?.user?.app_metadata), ok: !error }),
        () => ({ email: null, stamp: null, ok: false }),
      );
      users.set(userId, p);
    }
    return p;
  };
  return {
    async loadProfiles(now) {
      const r = queryRanges(now);
      const or = [
        `and(created_at.gte.${r.created.gte},created_at.lte.${r.created.lte})`,
        `and(trial_ends_at.gte.${r.endsSoon.gte},trial_ends_at.lte.${r.endsSoon.lte})`,
        `and(trial_ends_at.gte.${r.endedRecently.gte},trial_ends_at.lte.${r.endedRecently.lte})`,
      ].join(',');
      const { data, error } = await db.from('holler_profiles').select(PROFILE_COLUMNS).or(or).order('created_at', { ascending: true }).limit(PROFILE_ROW_CAP);
      if (error) throw new Error(`profiles: ${error.message}`);
      return (data ?? []) as unknown as FullProfile[];
    },

    async loadSends(userIds) {
      const out: SendRow[] = [];
      for (const ids of chunk(userIds)) {
        // sent_at: a trial_ending / trial_ended row written for an earlier trial end is stale (select.ts staleTrialSends).
        const { data, error } = await sends().select('user_id, kind, sent_at').in('user_id', ids);
        if (error) {
          if (isMissingTable(error)) throw new NotMigrated();
          throw new Error(`sends: ${error.message}`);
        }
        out.push(...((data ?? []) as SendRow[]));
      }
      return out;
    },

    async claim(userId, kind) {
      // Insert first, send second. ignoreDuplicates makes this INSERT ... ON CONFLICT DO NOTHING, and the select returns only the row
      // this call actually inserted: an empty array means another run (or an earlier run) already holds it.
      const { data, error } = await sends()
        .upsert([{ user_id: userId, kind }], { onConflict: 'user_id,kind', ignoreDuplicates: true })
        .select('user_id');
      if (error) {
        if (isMissingTable(error)) throw new NotMigrated();
        throw new Error(`claim: ${error.message}`);
      }
      return Array.isArray(data) && data.length > 0 ? 'claimed' : 'exists';
    },

    async release(userId, kind) {
      const { error } = await sends().delete().eq('user_id', userId).eq('kind', kind);
      if (error) throw new Error(`release: ${error.message}`);
    },

    async isOptedOut(userId) {
      const { data, error } = await sends().select('user_id').eq('user_id', userId).eq('kind', 'optout').limit(1);
      if (error) throw new Error(`optout: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async emailOf(userId) {
      return (await userOf(userId)).email || null;
    },

    async trialStartedAt(userId) {
      return (await userOf(userId)).stamp;
    },

    async matchesOf(userId, trades) {
      // Round 35: with HOLLER_FOLLOWUP_FILTER_ENABLED on, the read also takes what the feed's bid test and the alert hold need. Off, the select is
      // the one below, character for character.
      const filter = followupFilterEnabled();
      const signalColumns = `id, source, kind, title, summary, categories, city, state, lat, lon, severity, occurred_at, subtype:data->>subtype, ${STAGE_SELECT}, ${WEATHER_SELECT}`;
      const read = (withHold: boolean) =>
        db
          .from('holler_matches')
          .select(`status, ${withHold ? 'alert_hold, ' : ''}signal:holler_signals(${signalColumns}${filter ? `, ${FOLLOWUP_SIGNAL_SELECT}` : ''})`)
          .eq('user_id', userId)
          .neq('status', 'dismissed')
          .order('created_at', { ascending: false })
          .limit(MATCH_ROW_CAP);
      let { data, error } = await read(filter);
      // Before migration 0027 there is no alert_hold column: read again without it (bids and retired bids are still filtered).
      if (error && filter && missingHoldColumn(error)) ({ data, error } = await read(false));
      if (error) throw new Error(`matches: ${error.message}`);
      const rows = (data ?? []) as unknown as { status?: string | null; alert_hold?: string | null; signal: SignalEmbed | SignalEmbed[] | null }[];
      const items: (AlertItem & { id: number })[] = [];
      const dropped: Record<FollowupDrop, number> = { retired: 0, bid_hidden: 0, held: 0 };
      const nowMs = Date.now();
      for (const r of rows) {
        const s = Array.isArray(r.signal) ? r.signal[0] : r.signal;
        if (!s || !s.title?.trim()) continue;
        if (s.source === HOLLER_REQUEST_SOURCE || s.kind === 'ask') continue;
        // Round 35: what the feed and the alert email already hide is never named in a follow-up email either (lib/signals/followup-filter.ts).
        if (filter) {
          const why = followupDrop(s, r, { nowMs });
          if (why) {
            dropped[why]++;
            continue;
          }
        }
        // Round 19 integration: the same label input as the feed (recordLabelInput: summary, permit stage, place) and the same rule for a
        // match the member saved or marked done (keptMatchLabel: it stays listed as a feed item whatever its label is now).
        const label = trades
          ? keptMatchLabel(labelForMember({ ...recordLabelInput(s), categories: s.categories ?? null }, trades), r.status)
          : null;
        // A record this base calls context for the member's trades is hidden in the feed, so it is never listed or counted in mail either.
        if (label && !isFeedLabel(label)) continue;
        items.push({
          ...(label ? { label } : {}),
          id: s.id,
          title: s.title,
          city: s.city,
          state: s.state,
          occurredAt: s.occurred_at,
          kind: s.kind,
          source: s.source,
          subtype: s.subtype,
          severity: s.severity,
        });
      }
      items.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
      return { items, total: items.length, capped: rows.length >= MATCH_ROW_CAP, ...(filter ? { dropped } : {}) };
    },

    async quietPreview(profile, now) {
      const pp: PreviewProfile = {
        categories: profile.categories,
        lat: profile.lat,
        lon: profile.lon,
        state: profile.state,
        radius_mi: profile.radius_mi,
        plan: profile.plan ?? null,
        subscription_status: profile.subscription_status,
        extra_areas: profile.extra_areas,
        keywords: profile.keywords,
      };
      const p = await recentPreviewFor(pp, { db: db as unknown as SupabaseClient, now });
      if (!p || p.total <= 0) return null;
      const lines = p.byType.filter((t) => t.count > 0).map((t) => ({ label: typeLabel(t.key, t.count), count: t.count, key: t.key }));
      if (lines.length === 0) return null;
      return { lines, total: p.total, capped: p.capped, days: PREVIEW_DAYS };
    },

    async missedSince(profile, now) {
      const end = Date.parse(profile.trial_ends_at ?? '');
      if (!Number.isFinite(end)) throw new Error('no trial end');
      return missedSince(db, profile, new Date(end), now);
    },
  };
}
