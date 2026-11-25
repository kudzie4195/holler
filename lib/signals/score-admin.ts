import type { SupabaseClient } from '@supabase/supabase-js';
import { matchScope } from '@/lib/plan';
import { demoteExpired, deadlineOf, DEADLINE_SELECT, labelForMember, LABEL_RANK, recordLabelInput, type OpportunityLabel } from './lead-rules';
import { STAGE_SELECT } from './stage';
import { WEATHER_SELECT } from './weather-hazard';
import { membersOfTrade, type MatchSignal } from './match';
import { tradeForRecord } from './brief';
import { isExactTradeFit, scoreOf, valueUsdOf, type ScoreParts } from './score';
import { loadProfiles } from './store';
import { signalIdsWithNamedContact } from '@/lib/contacts/load';

/**
 * Admin score report (PLAN-2.0 item 2.7: "score visible in admin"). The score is never shown to members. This builds the rows the
 * owner-only JSON route (app/api/admin/scores/route.ts, same secret as /api/admin/sources) returns.
 *
 * Reads, in total and NOT per signal: one holler_matches page joined to its signals, the profiles (loadProfiles: one or two reads), and
 * the contacts table for the distinct signal ids of the page through lib/contacts/load.ts (existence only, named organisations only: the signal id,
 * never a name, phone or e-mail), in chunks of 200. Competition is counted in memory from those profiles. Output carries no user id, no e-mail and no contact.
 */
type Db = SupabaseClient;

export const SCORE_REPORT_MAX_ROWS = 500;
const DAY = 86_400_000;

interface SignalRow {
  id: number;
  source: string;
  kind: string | null;
  title: string;
  summary: string | null;
  occurred_at: string;
  expires_at: string | null;
  categories: string[] | null;
  lat: number | null;
  lon: number | null;
  state: string | null;
  severity: number | null;
  subtype: string | null;
  deadline?: string | null;
  fixBy?: string | null;
  dueDate?: string | null;
  responseDeadline?: string | null;
  /** data->>permitStage (STAGE_SELECT): passed to the labeller only. */
  permitStage?: string | null;
  /** Round 33: WEATHER_SELECT aliases (an NWS alert's hail size and gust), passed to the labeller only. */
  maxHailSizeIn?: string | null;
  maxWindGustMph?: string | null;
}

interface MatchRowIn {
  id: number;
  user_id: string;
  signal: SignalRow | SignalRow[] | null;
}

export interface ScoreReportRow {
  signalId: number;
  source: string;
  title: string;
  label: OpportunityLabel;
  trade: string | null;
  score: number;
  parts: ScoreParts;
  /** Members of that trade who see the record, the member included. */
  competitors: number | null;
  hasContact: boolean;
  valueUsd: number | null;
}

export interface ScoreReport {
  generatedAt: string;
  windowDays: number;
  rows: ScoreReportRow[];
  /** Reads made, to show it does not grow with the number of signals. */
  reads: { matches: number; profiles: number; contacts: number };
}

export async function buildScoreReport(db: Db, now: Date, opts: { days?: number; limit?: number } = {}): Promise<ScoreReport> {
  const days = Math.min(Math.max(Math.floor(opts.days ?? 14), 1), 30);
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 200), 1), SCORE_REPORT_MAX_ROWS);
  const since = new Date(now.getTime() - days * DAY).toISOString();
  const reads = { matches: 0, profiles: 1, contacts: 0 };

  reads.matches++;
  const { data, error } = await db
    .from('holler_matches')
    .select(
      `id,user_id,signal:holler_signals(id,source,kind,title,summary,occurred_at,expires_at,categories,lat,lon,state,severity,subtype:data->>subtype,${DEADLINE_SELECT},${STAGE_SELECT},${WEATHER_SELECT})`,
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error('matches read failed');
  const matches = ((data ?? []) as unknown as MatchRowIn[])
    .map((m) => ({ m, s: Array.isArray(m.signal) ? m.signal[0] : m.signal }))
    .filter((r): r is { m: MatchRowIn; s: SignalRow } => !!r.s);

  const profiles = await loadProfiles(db, now);
  const byUser = new Map(profiles.map((p) => [p.user_id, p]));

  const named = await signalIdsWithNamedContact(db, matches.map((r) => r.s.id));
  const withContact = named.ids;
  reads.contacts = named.reads;

  const nowMs = now.getTime();
  const rows: ScoreReportRow[] = [];
  for (const { m, s } of matches) {
    const p = byUser.get(m.user_id);
    if (!p) continue;
    const trades = matchScope(p).categories;
    const input = { source: s.source, kind: s.kind, subtype: s.subtype, title: s.title, summary: s.summary };
    // Round 19 integration: the same label input as every member surface (summary, permit stage, place: recordLabelInput).
    const label = demoteExpired(labelForMember({ ...recordLabelInput(s), categories: s.categories }, trades), deadlineOf(s), nowMs);
    if (label === 'context') continue;
    const trade = tradeForRecord(input, s.categories, trades);
    const sig: MatchSignal = {
      id: s.id,
      categories: s.categories ?? [],
      lat: s.lat,
      lon: s.lon,
      state: s.state,
      severity: s.severity ?? 1,
      occurred_at: s.occurred_at,
      subtype: s.subtype,
      source: s.source,
      kind: s.kind,
      title: s.title,
    };
    const competitors = trade ? membersOfTrade(sig, trade, profiles) : null;
    const valueUsd = valueUsdOf({ summary: s.summary });
    const { score, parts } = scoreOf({
      hasContact: withContact.has(s.id),
      valueUsd,
      occurredAt: s.occurred_at,
      nowMs,
      tradeFit: isExactTradeFit(input, s.categories, trade),
      competitors,
    });
    rows.push({ signalId: s.id, source: s.source, title: s.title, label, trade, score, parts, competitors, hasContact: withContact.has(s.id), valueUsd });
  }
  rows.sort((a, b) => LABEL_RANK[a.label] - LABEL_RANK[b.label] || b.score - a.score || b.signalId - a.signalId);
  return { generatedAt: now.toISOString(), windowDays: days, rows, reads };
}
