import type { SupabaseClient } from '@supabase/supabase-js';
import { chunk } from '../email/notify-logic';
import { isProbation } from '../signals/probation';
import { HOLLER_REQUEST_SOURCE } from '../signals/request-visibility';
import { recentPreviewFor, typeLabel, PREVIEW_DAYS, type PreviewProfile } from '../preview/recent';
import { trialStartedAt as readTrialStamp } from '../auth/membership';
import { missedSince } from './missed';
import { queryRanges, type LifecycleKind, type LifecycleProfile, type SendRow } from './select';
import type { AlertItem, TypeLine } from './templates';
import { matchScope } from '../plan/scope';
import { OPPORTUNITY_DATA_COLUMNS, memberOpportunity } from '../signals/member-opportunity';

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
   * With `profile`, each item carries its opportunity label for the member's plan-limited trades and keyword watches, and records that
   * are only 'context' for them are left out (they may be in holler_matches from before trade matching used opportunity).
   */
  matchesOf(userId: string, profile?: FullProfile): Promise<MatchesOf>;
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
  opp_type?: string | null;
  opp_event?: string | null;
  opp_hail?: string | null;
  opp_comments?: string | null;
  opp_mag?: string | null;
  city: string | null;
  state: string | null;
  severity: number | null;
  occurred_at: string;
  subtype: string | null;
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
        const { data, error } = await sends().select('user_id, kind').in('user_id', ids);
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

    async matchesOf(userId, profile) {
      const scope = profile ? matchScope(profile) : null;
      const { data, error } = await db
        .from('holler_matches')
        .select(`signal:holler_signals(id, source, kind, title, summary, categories, city, state, severity, occurred_at, subtype:data->>subtype, ${OPPORTUNITY_DATA_COLUMNS})`)
        .eq('user_id', userId)
        .neq('status', 'dismissed')
        .order('created_at', { ascending: false })
        .limit(MATCH_ROW_CAP);
      if (error) throw new Error(`matches: ${error.message}`);
      const rows = (data ?? []) as unknown as { signal: SignalEmbed | SignalEmbed[] | null }[];
      const items: (AlertItem & { id: number })[] = [];
      for (const r of rows) {
        const s = Array.isArray(r.signal) ? r.signal[0] : r.signal;
        if (!s || !s.title?.trim()) continue;
        if (s.source === HOLLER_REQUEST_SOURCE || s.kind === 'ask') continue;
        if (isProbation(s)) continue; // a source on probation is never shown or counted for a member
        const opportunity = scope ? memberOpportunity(s, scope.categories, scope.keywords).label : null;
        if (opportunity === 'context') continue;
        items.push({
          opportunity,
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
      return { items, total: items.length, capped: rows.length >= MATCH_ROW_CAP };
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
      const lines = p.byType.filter((t) => t.count > 0).map((t) => ({ label: typeLabel(t.key, t.count), count: t.count }));
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
