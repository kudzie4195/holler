/**
 * Daily health report. Everything here is pure (no database, no clock reads, no email), so it is tested without mocks.
 * The route at app/api/cron/health reads holler_scan_runs and the counts, calls planHealth, then sends renderHealthEmail.
 */

import { EMAIL_STYLE, cardClose, wrapOpen, WRAP_CLOSE } from './theme';
import { isStageNote } from '../signals/stage';
import { isProbationNote } from '../signals/probation-note';
import { agePhrase, STATE_LABEL, type SourceStateSummary } from '../signals/source-state';
import { firecrawlLines, type FirecrawlHealth } from '../firecrawl/health';
import { trialCheckLine, type TrialDbCheck } from '../auth/trial-check';

export interface HealthAdapter {
  id: string;
  label: string;
  kind: string;
  cadenceMinutes: number;
  /** Env keys the adapter needs that are not set. Such a source is "not configured", never "broken". */
  missingEnv?: string[];
}

/** One holler_scan_runs row. */
export interface HealthRun {
  source: string | null;
  started_at: string | null;
  fetched: number | null;
  inserted: number | null;
  error: string | null;
}

export interface HealthCounts {
  newSignups24h: number | null;
  activeSubscribers: number | null;
  trialing: number | null;
  /** Users whose last_notified_at is inside 24 h. One digest per user per run, so this is "emails sent" within a rounding error. */
  usersEmailed24h: number | null;
}

export type ProblemCode = 'errored' | 'stale' | 'never_ran' | 'zero_rows_3d';

export interface SourceHealth {
  id: string;
  label: string;
  kind: string;
  cadenceMinutes: number;
  status: 'ok' | 'error' | 'never' | 'not_configured';
  lastRunAt: string | null;
  lastError: string | null;
  runs24h: number;
  fetched24h: number;
  inserted24h: number;
  problems: ProblemCode[];
}

export interface HealthReport {
  generatedAt: string;
  ok: boolean;
  /** Number of sources (plus the scanner itself) with at least one problem. */
  problemCount: number;
  subject: string;
  /** One line each, worst first. */
  problems: string[];
  /** Not broken yet, worth a look: an expected-to-produce source with nothing fetched in 24 h. */
  watch: string[];
  notConfigured: string[];
  scanner: { lastRunAt: string | null; minutesSinceLastRun: number | null };
  totals24h: { runs: number; fetched: number; inserted: number };
  counts: HealthCounts;
  sources: SourceHealth[];
  /**
   * Source states (lib/signals/source-state.ts): healthy, delayed, degraded, unavailable, not set up yet. Attached by the route after
   * planHealth; absent when the state read failed. Shown in the email as its own block, and it changes the subject only when the
   * run-level checks found nothing (so "all sources OK" is never printed over a degraded source).
   */
  sourceStates?: SourceStateSummary | null;
  /** Firecrawl credits and per-source state (lib/firecrawl/health.ts). Absent when nothing is configured or the read failed. */
  firecrawl?: FirecrawlHealth | null;
  /**
   * Advertised free trial (TRIAL_DAYS) against what the database enforces (lib/auth/trial-check.ts, migration 0028). Attached by the route;
   * absent when not checked. A mismatch, a missing migration or a read error replaces the all-clear subject and is appended to any other
   * subject (review r2 R6).
   */
  trialCheck?: TrialDbCheck | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A source is flagged when it has not run in this many cadences. */
export const STALE_CADENCES = 3;
/** Days of zero rows before a normally-productive source is flagged. */
export const ZERO_ROW_DAYS = 3;
/** The fastest adapters run every 15 minutes, so 3 missed ticks means the schedule itself is down. */
export const SCANNER_STALE_MINUTES = 45;
/** How far back the route must read runs: 3 days of zero rows needs 72 h of history, plus slack. */
export const HEALTH_LOOKBACK_HOURS = 96;

/** Kinds that produce rows nearly every day: weather alerts, storm reports, and city records (permits, 311, inspections, licenses). */
const PRODUCTIVE_KINDS = new Set(['alert', 'report', 'permit', 'civic']);

/** Kinds that can be empty for days in calm weather. They keep the errored, stale and watch rules but never raise zero_rows_3d. */
const MAY_BE_EMPTY_FOR_DAYS = new Set(['report']);

/**
 * Does this source normally return rows every day? Decided from the registry's kind and cadence:
 * productive kind, and checked at least daily (a source polled less often than that is too quiet to judge by days).
 * Storm reports (spc) can legitimately be empty for days in calm weather, so planHealth never raises zero_rows_3d for them.
 */
export function expectsRows(a: Pick<HealthAdapter, 'kind' | 'cadenceMinutes'>): boolean {
  return PRODUCTIVE_KINDS.has(a.kind) && a.cadenceMinutes <= 24 * 60;
}

export function formatAge(ms: number): string {
  const mins = Math.max(0, Math.round(ms / MIN));
  if (mins < 90) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h`;
  return `${Math.round(hrs / 24)} days`;
}

function formatCadence(minutes: number): string {
  if (minutes < 90) return `${minutes} min`;
  const hrs = minutes / 60;
  return Number.isInteger(hrs) ? `${hrs} h` : `${hrs.toFixed(1)} h`;
}

function oneLine(s: string, max = 140): string {
  const t = s.replace(/\s+/g, ' ').replace(/\u2014/g, '-').trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

function ts(iso: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

export function planHealth(input: {
  adapters: HealthAdapter[];
  runs: HealthRun[];
  counts: HealthCounts;
  now: Date;
}): HealthReport {
  const nowMs = input.now.getTime();
  const known = new Set(input.adapters.map((a) => a.id));

  const bySource = new Map<string, { t: number; r: HealthRun }[]>();
  for (const r of input.runs) {
    if (!r.source || !known.has(r.source)) continue; // ignores '_prune' and retired sources
    const t = ts(r.started_at);
    if (!Number.isFinite(t)) continue;
    const list = bySource.get(r.source);
    if (list) list.push({ t, r });
    else bySource.set(r.source, [{ t, r }]);
  }
  for (const list of bySource.values()) list.sort((a, b) => b.t - a.t);

  const sources: SourceHealth[] = [];
  const problemLines: { sev: number; line: string }[] = [];
  const watch: string[] = [];
  const notConfigured: string[] = [];
  const problemSources = new Set<string>();
  let newestRun = NaN;
  const totals = { runs: 0, fetched: 0, inserted: 0 };

  for (const a of input.adapters) {
    const base = { id: a.id, label: a.label, kind: a.kind, cadenceMinutes: a.cadenceMinutes };
    if (a.missingEnv && a.missingEnv.length > 0) {
      notConfigured.push(`${a.id}: needs ${a.missingEnv.join(', ')}`);
      sources.push({ ...base, status: 'not_configured', lastRunAt: null, lastError: null, runs24h: 0, fetched24h: 0, inserted24h: 0, problems: [] });
      continue;
    }

    const rows = bySource.get(a.id) ?? [];
    const last = rows[0];
    const in24 = rows.filter((x) => x.t >= nowMs - DAY);
    const in72 = rows.filter((x) => x.t >= nowMs - ZERO_ROW_DAYS * DAY);
    const fetched24 = in24.reduce((n, x) => n + (x.r.fetched ?? 0), 0);
    const inserted24 = in24.reduce((n, x) => n + (x.r.inserted ?? 0), 0);
    totals.runs += in24.length;
    totals.fetched += fetched24;
    totals.inserted += inserted24;
    if (last && !(newestRun >= last.t)) newestRun = last.t;

    const problems: ProblemCode[] = [];
    // A stage-query note ("stage query: ...") is the optional second query failing or being refused. The source itself ran fine, so it is
    // one watch line for the source, never an error.
    // A probation note ("probation note: row cap reached ...", round 19 coverage) is a watch line the same way.
    const stageNote = last && (isStageNote(last.r.error) || isProbationNote(last.r.error)) ? oneLine(last.r.error as string) : null;
    const lastError = last?.r.error && !stageNote ? oneLine(last.r.error) : null;
    if (stageNote) watch.push(`${a.id}: ${stageNote}`);

    if (!last) {
      problems.push('never_ran');
      problemLines.push({ sev: 2, line: `${a.id}: no run in the last ${HEALTH_LOOKBACK_HOURS} h (expected every ${formatCadence(a.cadenceMinutes)})` });
    } else {
      if (nowMs - last.t > STALE_CADENCES * a.cadenceMinutes * MIN) {
        problems.push('stale');
        problemLines.push({ sev: 2, line: `${a.id}: no run in ${formatAge(nowMs - last.t)} (expected every ${formatCadence(a.cadenceMinutes)})` });
      }
      if (lastError) {
        problems.push('errored');
        problemLines.push({ sev: 1, line: `${a.id}: errored on its latest run: ${lastError}` });
      }
    }

    if (last && !lastError && expectsRows(a)) {
      // 3 days of history means a run at (or just after) the 72 h mark; a source that only started yesterday is not judged yet.
      const earliest = rows[rows.length - 1].t;
      const coversWindow = earliest <= nowMs - ZERO_ROW_DAYS * DAY + 1.5 * a.cadenceMinutes * MIN;
      // `inserted` (new rows), not `fetched`: fetched counts every row inside the dataset's lookback window (7 to 30 days), so a portal that
      // stopped publishing still "fetches" the same old rows for that long and would be flagged only after the window drains plus 3 days.
      const inserted72 = in72.reduce((n, x) => n + (x.r.inserted ?? 0), 0);
      if (coversWindow && in72.length > 0 && inserted72 === 0 && !MAY_BE_EMPTY_FOR_DAYS.has(a.kind)) {
        problems.push('zero_rows_3d');
        problemLines.push({ sev: 3, line: `${a.id}: no new rows for ${ZERO_ROW_DAYS} days running` });
      } else if (in24.length > 0 && fetched24 === 0) {
        watch.push(`${a.id}: nothing fetched in the last 24 h`);
      }
    }

    if (problems.length) problemSources.add(a.id);
    sources.push({
      ...base,
      status: !last ? 'never' : lastError ? 'error' : 'ok',
      lastRunAt: last ? new Date(last.t).toISOString() : null,
      lastError,
      runs24h: in24.length,
      fetched24h: fetched24,
      inserted24h: inserted24,
      problems,
    });
  }

  // Scanner-level: if nothing at all has run recently the schedule itself is down, which matters more than any one source.
  const configured = sources.filter((s) => s.status !== 'not_configured');
  const minutesSince = Number.isFinite(newestRun) ? Math.round((nowMs - newestRun) / MIN) : null;
  const scannerDown = configured.length > 0 && (minutesSince === null || minutesSince > SCANNER_STALE_MINUTES);
  const lines: string[] = [];
  if (scannerDown) {
    problemSources.add('scanner');
    lines.push(
      minutesSince === null
        ? `scanner: no scan has run in the last ${HEALTH_LOOKBACK_HOURS} h. Check the schedule (supabase/cron.sql) and CRON_SECRET.`
        : `scanner: last scan ran ${formatAge(minutesSince * MIN)} ago. Check the schedule (supabase/cron.sql) and CRON_SECRET.`,
    );
  }
  lines.push(...problemLines.sort((x, y) => x.sev - y.sev).map((p) => p.line));

  const problemCount = problemSources.size;
  const subject =
    problemCount === 0
      ? 'Holler health: all sources OK'
      : `Holler health: ${problemCount} ${problemCount === 1 ? 'source needs' : 'sources need'} attention`;

  return {
    generatedAt: input.now.toISOString(),
    ok: problemCount === 0,
    problemCount,
    subject,
    problems: lines,
    watch,
    notConfigured,
    scanner: { lastRunAt: Number.isFinite(newestRun) ? new Date(newestRun).toISOString() : null, minutesSinceLastRun: minutesSince },
    totals24h: totals,
    counts: input.counts,
    sources,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const n = (v: number | null): string => (v === null ? 'unknown' : String(v));

/** Plain text first: problems at the top, one line each, then the 24 h numbers. At most `maxLines` problem lines. */
export function renderHealthEmail(report: HealthReport, maxLines = 25): { subject: string; text: string; html: string } {
  const blocks: { title: string; lines: string[] }[] = [];
  if (report.problems.length) {
    const shown = report.problems.slice(0, maxLines);
    if (report.problems.length > shown.length) shown.push(`...and ${report.problems.length - shown.length} more. Open the JSON report for the rest.`);
    blocks.push({ title: 'Needs attention', lines: shown });
  }
  if (report.watch.length) blocks.push({ title: 'Watch', lines: report.watch.slice(0, 10) });
  if (report.notConfigured.length) blocks.push({ title: 'Not configured (skipped on purpose)', lines: report.notConfigured });
  const states = report.sourceStates;
  let subject = report.subject;
  if (states) {
    const c = states.counts;
    const lines = [
      `${c.healthy} healthy, ${c.delayed} delayed, ${c.degraded} degraded, ${c.unavailable} unavailable, ${c.not_set_up} ${STATE_LABEL.not_set_up.toLowerCase()} (of ${states.total})`,
    ];
    for (const r of states.attention.filter((x) => x.state !== 'not_set_up').slice(0, maxLines)) {
      const run = r.sinceSuccessMs === null ? 'no successful run yet' : `last successful run ${agePhrase(r.sinceSuccessMs)} ago`;
      const rec = r.lastRecordAt === null ? 'no record received yet' : `newest record ${agePhrase(Math.max(0, Date.parse(report.generatedAt) - Date.parse(r.lastRecordAt)))} ago`;
      lines.push(`${r.id}: ${STATE_LABEL[r.state].toLowerCase()}, ${run}, ${rec} (${r.detail})`);
    }
    // Healthy by the rules (it runs and does not fail) but has never returned a row in its history: worth a look, not an alarm.
    if (states.quiet.length > 0) {
      lines.push(`Running but never returned a row in the history we hold (check the source is still right): ${states.quiet.map((q) => q.id).join(', ')}`);
    }
    blocks.push({ title: 'Source states', lines });
    if (states.behind > 0 && report.problemCount === 0) {
      subject = `Holler health: ${states.behind} ${states.behind === 1 ? 'source is' : 'sources are'} behind on data`;
    }
  }
  if (report.firecrawl) blocks.push({ title: 'Firecrawl (agency bid pages)', lines: firecrawlLines(report.firecrawl) });
  if (report.trialCheck) {
    blocks.push({ title: 'Free trial length', lines: [trialCheckLine(report.trialCheck)] });
    // A mismatch or a read failure (which must not hide a mismatch behind an all-clear, review F10) is ADDED to the subject: it replaces
    // only the all-clear, never "N sources need attention" or "N sources are behind on data" (review r2 R6).
    const trialPart =
      report.trialCheck.status === 'mismatch' || report.trialCheck.status === 'not_applied'
        ? 'free trial length does not match the database'
        : report.trialCheck.status === 'error'
          ? 'could not check the free trial length'
          : null;
    if (trialPart) subject = report.problemCount === 0 && subject === report.subject ? `Holler health: ${trialPart}` : `${subject}; ${trialPart}`;
  }
  const c = report.counts;
  blocks.push({
    title: 'Last 24 hours',
    lines: [
      `Scans: ${report.totals24h.runs} runs, ${report.totals24h.fetched} rows fetched, ${report.totals24h.inserted} new`,
      `New signups: ${n(c.newSignups24h)}`,
      `Active subscribers: ${n(c.activeSubscribers)} (in free trial: ${n(c.trialing)})`,
      `Users emailed: ${n(c.usersEmailed24h)}`,
    ],
  });

  const text = [subject, ...blocks.map((b) => `\n${b.title}\n${b.lines.map((l) => `- ${l}`).join('\n')}`)].join('\n') + '\n';
  const html =
    wrapOpen(600) +
    `<h1 style="${EMAIL_STYLE.h1};font-size:22px;margin:0 0 12px 0">${esc(subject)}</h1>` +
    blocks
      .map((b) => `<h2 style="${EMAIL_STYLE.h2};font-size:15px;margin:16px 0 4px 0">${esc(b.title)}</h2><ul style="margin:0;padding-left:20px">${b.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`)
      .join('') +
    cardClose() +
    WRAP_CLOSE;
  return { subject, text, html };
}
