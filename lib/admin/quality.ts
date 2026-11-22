import type { CategoryId } from '@/lib/signals/categories';
import { isAlertLabel, labelFor, type OpportunityLabel } from '@/lib/signals/lead-rules';
import { computeAccess } from '@/lib/auth/access';
import { matchScope } from '@/lib/plan/scope';
import type { DuplicateReport } from '@/lib/signals/dedupe-metrics';

/**
 * Alert-quality dashboard numbers (PLAN-2.0 item 3.4). Pure: rows in, report out. lib/admin/quality-load.ts reads the rows (read-only
 * selects), app/api/admin/quality/route.ts serves the report to the owner. Nothing here touches a database, the network or the clock.
 *
 * Per trade, for the last 14 days:
 *   sent       alerts that went out by email (holler_alert_log.emailed_at inside the window), counted by opportunity label
 *              (lib/signals/lead-rules.ts labelFor for the signal and that trade). usefulShare = (act_now + coming_soon) / sent, the
 *              PLAN-2.0 target is 60% or more for every trade. A context row that was sent is a bug and is shown.
 *   logged     every holler_alert_log row created in the window, same labels (what matching produced, sent or not).
 *   feedback   answers members gave (holler_signal_feedback, answered in the window). falsePositiveRate = "not relevant" answers
 *              over all answers: it is what members told us, not a proof the record was wrong. lowSample is set under 10 answers.
 *   firstCard  new members (profile created in the window): time from signup to the first card in their feed whose label is
 *              act_now or coming_soon for one of their trades (any match row counts, including the signup backfill, because it is a
 *              card they can open). withoutCard are new members that have none yet. Median and 90th percentile, in hours.
 *   members    members who receive this trade (their plan's trades: lib/plan/scope.ts) and how many of them have access right now.
 *
 * "Sent" is the email log only. Push is not logged per alert, and holler_matches.notified also marks history and skipped rows, so it is
 * not used. An empty `sent` therefore means "no logged emails", which the report says in `notes`.
 */

export const QUALITY_WINDOW_DAYS = 14;
/** PLAN-2.0 section 5: at least 60% of sent alerts are Act Now or Coming Soon, per trade. */
export const USEFUL_SHARE_TARGET = 0.6;
/** Fewer answers than this and a false-positive rate is shown but flagged as a small sample. */
export const MIN_FEEDBACK_SAMPLE = 10;
/** A new member counts as served "the same day" when the first useful card is this soon after signup. */
export const SAME_DAY_HOURS = 24;
/** Trade bucket for a match that was made by a keyword watch, not by a trade. */
export const KEYWORD_TRADE = '(keyword watch)';

export interface AlertRow {
  user_id: string;
  signal_id: number | null;
  source: string | null;
  kind: string | null;
  subtype: string | null;
  trade: string | null;
  created_at: string;
  emailed_at: string | null;
}
export interface SignalLite {
  id: number;
  source: string;
  kind: string;
  title: string | null;
  /** The record's summary: labels read it (a permit's class, a closed status, the NYC heat mark of round 19). Optional for older callers. */
  summary?: string | null;
  subtype: string | null;
  categories: string[] | null;
}
export interface FeedbackRow {
  user_id: string;
  signal_id: number;
  verdict: string;
  updated_at: string;
}
export interface ProfileLite {
  user_id: string;
  created_at: string;
  categories: string[] | null;
  plan?: string | null;
  subscription_status: string;
  trial_ends_at: string;
  plan_source?: string | null;
  store_expires_at?: string | null;
}
export interface MatchLite {
  user_id: string;
  signal_id: number;
  created_at: string;
}

/** ok = fully read. partial = the read hit its page cap, so the figures cover only the newest rows. unavailable = the read failed: blank, not zero. */
export type SectionStatus = 'ok' | 'partial' | 'unavailable';

export interface QualityInputs {
  now: Date;
  alerts: AlertRow[];
  signals: SignalLite[];
  feedback: FeedbackRow[];
  profiles: ProfileLite[];
  matches: MatchLite[];
  /** Which reads worked. A section that did not read is reported as unavailable, never as zero. */
  status?: Partial<Record<'alerts' | 'feedback' | 'members' | 'firstCard', SectionStatus>>;
}

export type LabelCounts = Record<OpportunityLabel, number>;

export interface TradeQuality {
  trade: string;
  members: number;
  membersWithAccess: number;
  sent: LabelCounts & { total: number; usefulShare: number | null; meetsTarget: boolean | null };
  logged: LabelCounts & { total: number; usefulShare: number | null };
  feedback: { answered: number; notRelevant: number; useful: number; falsePositiveRate: number | null; lowSample: boolean };
  firstCard: { newMembers: number; withUsefulCard: number; withoutCard: number; within24h: number; medianHours: number | null; p90Hours: number | null };
}

export interface QualityReport {
  generatedAt: string;
  windowDays: number;
  since: string;
  target: number;
  sections: Record<'alerts' | 'feedback' | 'members' | 'firstCard', SectionStatus>;
  /** Everything, all trades together. members here counts people, not (person, trade) pairs. */
  all: TradeQuality;
  trades: TradeQuality[];
  /** Trades whose sent alerts are below the target (only trades with at least one sent alert). */
  belowTarget: string[];
  notes: string[];
  /** Duplicates dropped per source in the last 7 days (PLAN-2.0 2.3). Added by loadQualityReport; absent from the pure builder's output. */
  duplicates?: DuplicateReport;
}

const emptyLabels = (): LabelCounts => ({ act_now: 0, coming_soon: 0, market_insight: 0, context: 0 });

function usefulShare(c: LabelCounts, total: number): number | null {
  return total > 0 ? (c.act_now + c.coming_soon) / total : null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Nearest-rank percentile of a sorted list, or null when empty. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

interface Bucket {
  trade: string;
  members: Set<string>;
  withAccess: Set<string>;
  sent: LabelCounts;
  sentTotal: number;
  logged: LabelCounts;
  loggedTotal: number;
  fbAnswered: number;
  fbNotRelevant: number;
  fbUseful: number;
  newMembers: Set<string>;
  firstHours: Map<string, number>;
}

function bucket(trade: string): Bucket {
  return {
    trade,
    members: new Set(),
    withAccess: new Set(),
    sent: emptyLabels(),
    sentTotal: 0,
    logged: emptyLabels(),
    loggedTotal: 0,
    fbAnswered: 0,
    fbNotRelevant: 0,
    fbUseful: 0,
    newMembers: new Set(),
    firstHours: new Map(),
  };
}

function finish(b: Bucket): TradeQuality {
  const hours = [...b.firstHours.values()].sort((x, y) => x - y);
  const answered = b.fbAnswered;
  const sentUseful = usefulShare(b.sent, b.sentTotal);
  return {
    trade: b.trade,
    members: b.members.size,
    membersWithAccess: b.withAccess.size,
    sent: { ...b.sent, total: b.sentTotal, usefulShare: sentUseful, meetsTarget: sentUseful === null ? null : sentUseful >= USEFUL_SHARE_TARGET },
    logged: { ...b.logged, total: b.loggedTotal, usefulShare: usefulShare(b.logged, b.loggedTotal) },
    feedback: {
      answered,
      notRelevant: b.fbNotRelevant,
      useful: b.fbUseful,
      falsePositiveRate: answered > 0 ? b.fbNotRelevant / answered : null,
      lowSample: answered < MIN_FEEDBACK_SAMPLE,
    },
    firstCard: {
      newMembers: b.newMembers.size,
      withUsefulCard: b.firstHours.size,
      withoutCard: b.newMembers.size - b.firstHours.size,
      within24h: hours.filter((h) => h <= SAME_DAY_HOURS).length,
      medianHours: percentile(hours, 50) === null ? null : round1(percentile(hours, 50) as number),
      p90Hours: percentile(hours, 90) === null ? null : round1(percentile(hours, 90) as number),
    },
  };
}

export function buildQualityReport(input: QualityInputs): QualityReport {
  const nowMs = input.now.getTime();
  const sinceMs = nowMs - QUALITY_WINDOW_DAYS * 86_400_000;
  const status = { alerts: 'ok', feedback: 'ok', members: 'ok', firstCard: 'ok', ...input.status } as QualityReport['sections'];
  const sigBy = new Map(input.signals.map((s) => [s.id, s]));

  const buckets = new Map<string, Bucket>();
  const all = bucket('all trades');
  const get = (t: string) => {
    let b = buckets.get(t);
    if (!b) buckets.set(t, (b = bucket(t)));
    return b;
  };

  const labelOf = (
    ref: { source: string | null; kind: string | null; subtype: string | null; signalId: number | null },
    trade: string | null,
  ): OpportunityLabel => {
    const s = ref.signalId === null ? undefined : sigBy.get(ref.signalId);
    return labelFor(
      { source: s?.source ?? ref.source ?? '', kind: s?.kind ?? ref.kind, subtype: s?.subtype ?? ref.subtype, title: s?.title ?? null, summary: s?.summary ?? null },
      trade as CategoryId | null,
    );
  };

  // Members per trade: the trades each member's plan covers (what they actually receive).
  const profileBy = new Map(input.profiles.map((p) => [p.user_id, p]));
  const tradesOf = (p: ProfileLite): string[] =>
    matchScope({ categories: p.categories, lat: null, lon: null, state: null, plan: p.plan, subscription_status: p.subscription_status, plan_source: p.plan_source, store_expires_at: p.store_expires_at }).categories;
  if (status.members !== 'unavailable') {
    for (const p of input.profiles) {
      const open = !computeAccess(p, nowMs).locked;
      all.members.add(p.user_id);
      if (open) all.withAccess.add(p.user_id);
      for (const t of tradesOf(p)) {
        get(t).members.add(p.user_id);
        if (open) get(t).withAccess.add(p.user_id);
      }
    }
  }

  // Alerts by label.
  if (status.alerts !== 'unavailable') {
    for (const a of input.alerts) {
      const created = ms(a.created_at);
      const emailed = ms(a.emailed_at);
      const trade = a.trade ?? KEYWORD_TRADE;
      const label = labelOf({ source: a.source, kind: a.kind, subtype: a.subtype, signalId: a.signal_id }, a.trade);
      if (created !== null && created >= sinceMs && created <= nowMs) {
        for (const b of [all, get(trade)]) {
          b.logged[label]++;
          b.loggedTotal++;
        }
      }
      if (emailed !== null && emailed >= sinceMs && emailed <= nowMs) {
        for (const b of [all, get(trade)]) {
          b.sent[label]++;
          b.sentTotal++;
        }
      }
    }
  }

  // Feedback: the trade comes from the member's plan trades the signal carries (the first one), as the alert log does.
  if (status.feedback !== 'unavailable') {
    for (const f of input.feedback) {
      const t = ms(f.updated_at);
      if (t === null || t < sinceMs || t > nowMs) continue;
      const sig = sigBy.get(f.signal_id);
      const prof = profileBy.get(f.user_id);
      const mine = prof ? tradesOf(prof) : [];
      const trade = (sig?.categories ?? []).find((c) => mine.includes(c)) ?? KEYWORD_TRADE;
      const notRelevant = f.verdict === 'not_relevant';
      const useful = f.verdict === 'useful' || f.verdict === 'led_to_work';
      if (!notRelevant && !useful) continue;
      for (const b of [all, get(trade)]) {
        b.fbAnswered++;
        if (notRelevant) b.fbNotRelevant++;
        else b.fbUseful++;
      }
    }
  }

  // Time to first useful card, for members who signed up inside the window.
  if (status.firstCard !== 'unavailable' && status.members !== 'unavailable') {
    const byUser = new Map<string, MatchLite[]>();
    for (const m of input.matches) {
      const list = byUser.get(m.user_id);
      if (list) list.push(m);
      else byUser.set(m.user_id, [m]);
    }
    for (const p of input.profiles) {
      const joined = ms(p.created_at);
      if (joined === null || joined < sinceMs || joined > nowMs) continue;
      const trades = tradesOf(p);
      all.newMembers.add(p.user_id);
      for (const t of trades) get(t).newMembers.add(p.user_id);
      const mine = (byUser.get(p.user_id) ?? [])
        .filter((m) => ms(m.created_at) !== null)
        .sort((a, b) => (ms(a.created_at) as number) - (ms(b.created_at) as number));
      for (const m of mine) {
        const sig = sigBy.get(m.signal_id);
        if (!sig) continue;
        const hours = Math.max(0, ((ms(m.created_at) as number) - joined) / 3_600_000);
        const lite = { source: sig.source, kind: sig.kind, subtype: sig.subtype, signalId: sig.id };
        const shared = (sig.categories ?? []).filter((c) => trades.includes(c));
        for (const t of shared) {
          const b = get(t);
          if (!b.firstHours.has(p.user_id) && isAlertLabel(labelOf(lite, t))) b.firstHours.set(p.user_id, hours);
        }
        if (!all.firstHours.has(p.user_id)) {
          const best = shared.length > 0 ? shared.some((t) => isAlertLabel(labelOf(lite, t))) : isAlertLabel(labelOf(lite, null));
          if (best) all.firstHours.set(p.user_id, hours);
        }
      }
    }
  }

  const rows = [...buckets.values()].map(finish).sort((a, b) => b.sent.total - a.sent.total || b.members - a.members || a.trade.localeCompare(b.trade));
  const allRow = finish(all);
  const belowTarget = rows.filter((r) => r.sent.total > 0 && r.sent.meetsTarget === false).map((r) => r.trade);

  const notes: string[] = [];
  if (status.alerts !== 'unavailable' && allRow.sent.total === 0) {
    notes.push(
      allRow.logged.total === 0
        ? 'No alert emails are logged in this window (holler_alert_log is empty here), so sent shares have nothing to show yet.'
        : 'Alerts were matched in this window but none is logged as emailed.',
    );
  }
  if (status.alerts !== 'unavailable' && allRow.sent.context > 0) notes.push(`${allRow.sent.context} sent alert(s) carry the Context label. Context should never be sent: check the label rules.`);
  for (const [k, v] of Object.entries(status)) {
    if (v === 'unavailable') notes.push(`The ${k} read was unavailable, so that part is blank, not zero.`);
    if (v === 'partial') notes.push(`The ${k} read hit its row limit, so that part covers only the newest rows and the true numbers are higher: partial, not complete.`);
  }
  // Labels are worked out now, from each record's source, kind, subtype and title, with the label rules in force today. Rules change
  // (lib/signals/lead-rules.ts), so an older alert may have carried a different label when it was sent.
  notes.push("Labels are worked out with today's label rules, not the rules in force when each alert was sent. The log stores no label.");
  if (allRow.feedback.answered > 0 && allRow.feedback.lowSample) notes.push(`Only ${allRow.feedback.answered} feedback answers: the false-positive rate is a small sample.`);

  return {
    generatedAt: input.now.toISOString(),
    windowDays: QUALITY_WINDOW_DAYS,
    since: new Date(sinceMs).toISOString(),
    target: USEFUL_SHARE_TARGET,
    sections: status,
    all: allRow,
    trades: rows,
    belowTarget,
    notes,
  };
}
