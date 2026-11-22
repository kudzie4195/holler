import type { SendEmailInput, SendEmailResult } from '../email';
import { bestAlerts } from './best';
import { isReturningMember, selectLifecycle, staleTrialSends, type Candidate, type LifecycleKind } from './select';
import { mayExtendTrial, trialStartOf } from '../auth/trial';
import { NotMigrated, type FullProfile, type LifecycleStore } from './store';
import {
  plain,
  renderWelcomeMatches,
  renderWelcomeQuiet,
  renderTrialEnding,
  trialEndingDays,
  renderTrialEnded,
  type AlertItem,
} from './templates';
import { lifecycleUnsubUrl } from './unsub';
import type { Lang } from '../i18n';

export const MAX_MEMBERS_PER_RUN = 200;
export const MAX_TRIES = 3;
export const RUN_BUDGET_MS = 50_000;

/**
 * What the run hands the sender. idempotencyKey is stable per member and kind (`lifecycle:<user>:<kind>`): lib/email sendEmail passes
 * it to Resend as the Idempotency-Key header, so a repeated send of the same email within 24 h is a no-op on the provider side. A
 * sender that ignores it is still safe, because an ambiguous failure keeps the claim (see runLifecycle).
 */
export type LifecycleSendInput = SendEmailInput;

export function lifecycleIdempotencyKey(userId: string, kind: LifecycleKind): string {
  return `lifecycle:${userId}:${kind}`;
}

/**
 * True only when the sender says the provider refused the email (lib/email: a clean 4xx other than 409), so nothing went out and a
 * retry cannot send twice. A thrown send, a 5xx, a 409 or a network failure is ambiguous and keeps the claim.
 */
function definitelyNotSent(res: SendEmailResult): boolean {
  return 'ok' in res && res.ok === false && res.notSent === true;
}

export interface RunDeps {
  store: LifecycleStore;
  /** Gets a LifecycleSendInput (with idempotencyKey). A sender may ignore the key. */
  send: (input: SendEmailInput) => Promise<SendEmailResult>;
  siteUrl: string;
  /** CRON_SECRET: signs the unsubscribe links. */
  secret: string;
  now?: Date;
  dry?: boolean;
  limit?: number;
  /** Trial-ending hook: integration passes the AI ranking here (lib/ai rankSignals). Receives the default-ordered list. */
  rank?: <T extends AlertItem>(items: T[]) => T[];
  /**
   * Member-aware form of `rank`, for rankings that need a read first (the AI scores are per member trades). Returns the ranker to use
   * for this member's items, or undefined for the default order. A throw or rejection also means the default order. Wins over `rank`.
   */
  rankFor?: (p: FullProfile, items: (AlertItem & { id: number })[]) => Promise<(<T extends AlertItem>(items: T[]) => T[]) | undefined>;
  /**
   * Round 18 (review r2 R2): before a trial_ending or trial_ended email to a member the app would extend (mayExtendTrial: never paid, end
   * earlier than start + TRIAL_DAYS), this extends the row first (lib/auth/trial.ts repairTrialForCron with the admin client) and returns
   * the stored new end, or null when nothing moved. When it moved, the email is skipped: the new end gets its own emails. Absent (tests,
   * or no admin client): the email goes as before.
   */
  repairTrial?: (userId: string, now: Date) => Promise<string | null>;
  /**
   * The member's language (round 18 ES): the cron passes a read of the profile's language column. Absent, a throw, or anything but
   * 'es' means the English email, exactly as before.
   */
  langFor?: (userId: string) => Promise<Lang>;
  /**
   * The same, read once for every member the run picked (one query per 100, review P3-9). Used when langFor is absent. A throw means
   * every email of the run is English.
   */
  langsFor?: (userIds: string[]) => Promise<Map<string, Lang>>;
  /** Wall clock for the time budget; tests pass a fake. */
  clock?: () => number;
  budgetMs?: number;
}

export interface Summary {
  ok: true;
  dry: boolean;
  considered: number;
  selected: number;
  sent: Record<LifecycleKind, number>;
  already_sent: number;
  skipped_opted_out: number;
  skipped_no_data: number;
  skipped_no_email: number;
  skipped_no_provider: number;
  /** A returning member (deleted the profile, then came back): no second welcome. */
  skipped_returning: number;
  /** Sends whose outcome is unknown (the provider may have accepted them) even after the one in-run retry. Kept as sent, logged. */
  send_unknown: number;
  /** Ambiguous sends retried once at once with the same idempotency key (verify-v3 P2, commander decision 10). */
  send_retried: number;
  /** Trial emails skipped because the member's trial was moved to start + TRIAL_DAYS first (round 18, review r2 R2). In dry: would be. */
  skipped_trial_extended: number;
  /** Ledger rows sent for an earlier trial end, cleared before selection (review r2 R3). In dry: found, not cleared. */
  stale_cleared: number;
  failed: number;
  retried: number;
  would_send?: { user_id: string; kind: LifecycleKind; variant: string }[];
}

interface Built {
  subject: string;
  html: string;
  text: string;
  variant: string;
}

/** Builds the email for one member from real rows, or null when there is nothing honest to say (welcome only). Throws when data cannot be read. */
export async function buildMail(
  kind: LifecycleKind,
  p: FullProfile,
  deps: Pick<RunDeps, 'store' | 'siteUrl' | 'secret' | 'rank' | 'rankFor' | 'langFor'>,
  now: Date,
): Promise<Built | null> {
  const base = deps.siteUrl.replace(/\/$/, '');
  let lang: Lang = 'en';
  if (deps.langFor) {
    try {
      lang = (await deps.langFor(p.user_id)) === 'es' ? 'es' : 'en';
    } catch {
      lang = 'en';
    }
  }
  const common = {
    businessName: plain(p.business_name || (lang === 'en' ? 'your business' : 'su negocio')),
    feedUrl: `${base}/app`,
    plansUrl: `${base}/app/settings#billing-h`,
    unsubscribeUrl: lifecycleUnsubUrl(base, p.user_id, deps.secret, now.getTime()),
    // Only a Spanish member's emails carry the field: an English render is called exactly as before.
    ...(lang === 'en' ? {} : { lang }),
  };
  if (kind === 'welcome') {
    const m = await deps.store.matchesOf(p.user_id);
    if (m.total > 0) {
      return { ...renderWelcomeMatches({ ...common, total: m.total, capped: m.capped, items: m.items.slice(0, 5) }), variant: 'matches' };
    }
    const q = await deps.store.quietPreview(p, now);
    if (!q) return null;
    return { ...renderWelcomeQuiet({ ...common, lines: q.lines, total: q.total, capped: q.capped, days: q.days }), variant: 'quiet' };
  }
  if (kind === 'trial_ending') {
    const m = await deps.store.matchesOf(p.user_id);
    let rank = deps.rank;
    if (deps.rankFor) {
      try {
        rank = await deps.rankFor(p, m.items);
      } catch {
        rank = undefined;
      }
    }
    const items = bestAlerts(m.items, rank);
    const hoursLeft = (Date.parse(p.trial_ends_at ?? '') - now.getTime()) / 3_600_000;
    const daysLeft = trialEndingDays(Number.isFinite(hoursLeft) ? hoursLeft : 84);
    return { ...renderTrialEnding({ ...common, items, daysLeft }), variant: items.length ? 'alerts' : 'no_alerts' };
  }
  const missed = await deps.store.missedSince(p, now);
  return { ...renderTrialEnded({ ...common, missed: missed.count, capped: missed.capped }), variant: missed.count > 0 ? 'missed' : 'paused_only' };
}

function emptySummary(dry: boolean): Summary {
  return {
    ok: true,
    dry,
    considered: 0,
    selected: 0,
    sent: { welcome: 0, trial_ending: 0, trial_ended: 0 },
    already_sent: 0,
    skipped_opted_out: 0,
    skipped_no_data: 0,
    skipped_no_email: 0,
    skipped_no_provider: 0,
    skipped_returning: 0,
    send_unknown: 0,
    send_retried: 0,
    skipped_trial_extended: 0,
    stale_cleared: 0,
    failed: 0,
    retried: 0,
  };
}

type Outcome = 'sent' | 'done' | 'retry';

/** A welcome to a returning member is skipped. A stamp that cannot be read counts as a first profile (never blocks a real welcome). */
async function returningWelcome(store: LifecycleStore, c: Candidate, p: FullProfile): Promise<boolean> {
  if (c.kind !== 'welcome' || !store.trialStartedAt) return false;
  try {
    return isReturningMember(p.created_at, await store.trialStartedAt(c.userId));
  } catch {
    return false;
  }
}

/**
 * One cron run. Reads who is due (pure selection), then for each member (at most 200 per run):
 *   1. claim: insert the ledger row. Only the call that inserted it goes on, so overlapping runs send once.
 *   2. re-check the opt-out, build the email from real rows, send it.
 *   3. on a failure before the send, or a send the provider refused (the sender marks it notSent), delete the row so the next attempt
 *      can retry. A send whose outcome is unknown (a plain failure or a throw: the provider may have accepted it and only the answer
 *      was lost) is retried ONCE at once with the identical input and the same idempotency key (verify-v3 P2): the provider keeps the
 *      key for 24 hours and answers a repeat of a request it already took with that request's result, never a second email. If the
 *      retry does not come back ok, the row is kept, so the email goes at most once; it is logged and counted as send_unknown.
 * Failed members are retried in this run, at most MAX_TRIES attempts each in total (counted in memory); after that the row stays
 * deleted and the next hourly run tries again while the member is still inside the window.
 * Every send carries idempotencyKey `lifecycle:<user>:<kind>` for senders that pass it to the provider.
 * A returning member (trial stamp older than this profile) gets no welcome; the row is kept so they are not asked again.
 * dry: nothing is inserted and nothing is sent; the result lists who would get what.
 */
export async function runLifecycle(deps: RunDeps): Promise<Summary | { ok: true; skipped: 'not_migrated' }> {
  const now = deps.now ?? new Date();
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const budget = deps.budgetMs ?? RUN_BUDGET_MS;
  const limit = Math.min(deps.limit ?? MAX_MEMBERS_PER_RUN, MAX_MEMBERS_PER_RUN);
  const dry = !!deps.dry;
  const s = emptySummary(dry);
  const { store } = deps;

  const profiles = await store.loadProfiles(now);
  s.considered = profiles.length;
  let sends;
  try {
    sends = await store.loadSends(profiles.map((p) => p.user_id));
  } catch (e) {
    if (e instanceof NotMigrated) return { ok: true, skipped: 'not_migrated' };
    throw e;
  }
  const byId = new Map(profiles.map((p) => [p.user_id, p]));
  // Review r2 R3: a trial_ending / trial_ended row written for an EARLIER end (the extension moved the end; its ledger reset was lost) does
  // not count as sent (selectLifecycle ignores it) and is cleared here so the claim below can take it. A failed clear is retried next run;
  // until then the claim finds the row and nothing is sent twice.
  const stale = staleTrialSends(profiles, sends);
  for (const r of stale) {
    if (dry) {
      s.stale_cleared++;
      continue;
    }
    try {
      await store.release(r.user_id, r.kind as LifecycleKind);
      s.stale_cleared++;
    } catch (e) {
      console.error('[lifecycle] stale ledger clear failed', r.kind, e instanceof Error ? e.message : e);
    }
  }
  const candidates = selectLifecycle(profiles, sends, now).slice(0, limit);
  s.selected = candidates.length;
  // The members' languages, read once for the whole run (round 18 ES). Only when the caller gives a batch reader and no per-member one.
  if (!deps.langFor && deps.langsFor && candidates.length > 0) {
    let langs = new Map<string, Lang>();
    try {
      langs = await deps.langsFor([...new Set(candidates.map((c) => c.userId))]);
    } catch {
      langs = new Map();
    }
    deps = { ...deps, langFor: async (id: string) => langs.get(id) ?? 'en' };
  }

  /**
   * Review r2 R2: a trial email to a member the app would extend is wrong ("ends in 3 days" when 48 days are left). Extend first, skip
   * the email. Only when the repair really moved the row: a failed or refused repair (or a stamp that cannot be read) sends as before.
   */
  async function extendedFirst(c: Candidate, p: FullProfile): Promise<boolean | 'failed'> {
    if (c.kind === 'welcome') return false;
    let stamp: string | null = null;
    try {
      stamp = store.trialStartedAt ? await store.trialStartedAt(c.userId) : null;
    } catch {
      stamp = null;
    }
    const start = trialStartOf(p.created_at, stamp);
    if (!start || !mayExtendTrial(p, start, now.getTime())) return false;
    if (dry) return true;
    if (!deps.repairTrial) return false;
    let stored: string | null;
    try {
      stored = await deps.repairTrial(c.userId, now);
    } catch {
      return 'failed'; // review r3 D2: the repair was due and failed. Send nothing for the old end; the next run tries again.
    }
    // Skip the email whenever the row no longer holds the end this run loaded: moved by this call, by a page load or by another run.
    return stored !== null && Math.abs(Date.parse(stored) - Date.parse(p.trial_ends_at ?? '')) > 1000;
  }

  if (dry) {
    s.would_send = [];
    for (const c of candidates) {
      if (clock() - started > budget) break;
      const p = byId.get(c.userId);
      if (!p) continue;
      try {
        if (await returningWelcome(store, c, p)) {
          s.skipped_returning++;
          continue;
        }
        if (deps.repairTrial && (await extendedFirst(c, p)) === true) {
          s.skipped_trial_extended++;
          continue;
        }
        const m = await buildMail(c.kind, p, deps, now);
        if (!m) s.skipped_no_data++;
        else s.would_send.push({ user_id: c.userId, kind: c.kind, variant: m.variant });
      } catch {
        s.failed++;
      }
    }
    return s;
  }

  const tries = new Map<string, number>();
  const key = (c: Candidate) => `${c.userId}:${c.kind}`;

  async function attempt(c: Candidate): Promise<Outcome> {
    const p = byId.get(c.userId);
    if (!p) return 'done';
    tries.set(key(c), (tries.get(key(c)) ?? 0) + 1);
    const ext = await extendedFirst(c, p);
    if (ext === 'failed') {
      s.failed++;
      return 'retry'; // no claim, no send
    }
    if (ext) {
      s.skipped_trial_extended++;
      return 'done';
    }
    let claimed: 'claimed' | 'exists';
    try {
      claimed = await store.claim(c.userId, c.kind);
    } catch (e) {
      if (e instanceof NotMigrated) throw e;
      s.failed++;
      return 'retry';
    }
    if (claimed === 'exists') {
      s.already_sent++;
      return 'done';
    }
    // From here on, any early exit that did not send must give the row back.
    const giveBack = async () => {
      try {
        await store.release(c.userId, c.kind);
      } catch (e) {
        console.error('[lifecycle] release failed', c.kind, e instanceof Error ? e.message : e);
      }
    };
    try {
      if (await store.isOptedOut(c.userId)) {
        await giveBack();
        s.skipped_opted_out++;
        return 'done';
      }
      const email = await store.emailOf(c.userId);
      if (!email) {
        await giveBack();
        s.skipped_no_email++;
        return 'done';
      }
      if (await returningWelcome(store, c, p)) {
        // Keep the row: this member is never due a welcome again.
        s.skipped_returning++;
        return 'done';
      }
      const mail = await buildMail(c.kind, p, deps, now);
      if (!mail) {
        await giveBack();
        s.skipped_no_data++;
        return 'done';
      }
      const unsub = lifecycleUnsubUrl(deps.siteUrl, c.userId, deps.secret, now.getTime());
      const input: LifecycleSendInput = {
        to: email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        // RFC 8058 one-click, same as the alert emails.
        headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        idempotencyKey: lifecycleIdempotencyKey(c.userId, c.kind),
      };
      const sendOnce = async (): Promise<{ res: SendEmailResult } | { thrown: unknown }> => {
        try {
          return { res: await deps.send(input) };
        } catch (e) {
          return { thrown: e };
        }
      };
      // Ambiguous: a throw, or a failure the sender did not mark notSent. The request may have reached the provider.
      const ambiguous = (r: { res: SendEmailResult } | { thrown: unknown }) =>
        'thrown' in r || (!('skipped' in r.res && r.res.skipped) && !('ok' in r.res && r.res.ok) && !definitelyNotSent(r.res));
      const why = (r: { res: SendEmailResult } | { thrown: unknown }) =>
        'thrown' in r ? (r.thrown instanceof Error ? r.thrown.message : String(r.thrown)) : 'error' in r.res ? r.res.error : 'send failed';
      const first = await sendOnce();
      if (ambiguous(first)) {
        // One retry, same input and idempotency key: either the provider took the first (it answers with that result, no second
        // email) or it did not (this one goes). Anything but ok keeps the row: at most once.
        s.send_retried++;
        console.warn('[lifecycle] send outcome unknown, retrying once with the same idempotency key', c.kind, why(first));
        const second = await sendOnce();
        if ('res' in second && 'ok' in second.res && second.res.ok) {
          s.sent[c.kind]++;
          return 'sent';
        }
        console.error('[lifecycle] send outcome unknown, kept as sent', c.kind, why(second));
        s.send_unknown++;
        return 'done';
      }
      const res = (first as { res: SendEmailResult }).res;
      if ('skipped' in res && res.skipped) {
        await giveBack();
        s.skipped_no_provider++;
        return 'done';
      }
      if (!('ok' in res) || !res.ok) {
        // Not ambiguous, so the sender marked it notSent: nothing went out.
        await giveBack();
        s.failed++;
        return 'retry';
      }
      s.sent[c.kind]++;
      return 'sent';
    } catch (e) {
      console.error('[lifecycle] member failed', c.kind, e instanceof Error ? e.message : e);
      await giveBack();
      s.failed++;
      return 'retry';
    }
  }

  let pending: Candidate[] = candidates;
  try {
    for (let round = 1; round <= MAX_TRIES && pending.length > 0; round++) {
      const next: Candidate[] = [];
      for (const c of pending) {
        if (clock() - started > budget) break;
        const out = await attempt(c);
        if (out === 'retry' && (tries.get(key(c)) ?? 0) < MAX_TRIES) next.push(c);
      }
      s.retried += next.length;
      pending = next;
    }
  } catch (e) {
    if (e instanceof NotMigrated) return { ok: true, skipped: 'not_migrated' };
    throw e;
  }
  return s;
}
