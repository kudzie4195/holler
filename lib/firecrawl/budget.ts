/**
 * Firecrawl credit budget. Pure rules plus one small in-process run counter.
 *
 * Plan facts (docs.firecrawl.dev/billing and firecrawl.dev/pricing, read 2026-11-22): Free plan = 1,000 credits a month, refreshed each
 * cycle, unused credits do not roll over; 10 scrape requests a minute; 2 concurrent browsers. A scrape is 1 credit, +4 with a json format.
 *
 * Holler's cost per source per day: a change check is 1 credit (scrape with change tracking, no extra cost); an extraction (only when the
 * page changed, or a previous extraction was lost) is 1 + 4 = 5 credits. So a quiet day costs 1 and a busy day 6 per source.
 *
 * Four caps, all must pass before a paid call. Defaults are deliberately about half of what the free plan allows:
 *   run      24 credits per scan run   (4 sources x 6, so one run can never spend more than a full day for four sources)
 *   day      30 credits per UTC day    (ledger, holler_scan_runs marker rows `_fc:<source>`)
 *   month   500 credits per UTC month  (the same ledger; 50% of the 1,000 free-plan credits, so two months fit with room to spare)
 *   balance  never draw the account below 100 remaining credits (live GET /v2/team/credit-usage; the account may be shared with other work)
 * Every cap is an env var and a smaller number only makes it stricter. A bad value (not a whole number >= 0) falls back to the default.
 */
export const DEFAULTS = { runCap: 24, dayCap: 30, monthCap: 500, minRemaining: 100 } as const;

export interface BudgetConfig {
  runCap: number;
  dayCap: number;
  monthCap: number;
  minRemaining: number;
}

function whole(v: string | undefined, dflt: number): number {
  const t = (v ?? '').trim();
  if (!/^\d{1,7}$/.test(t)) return dflt;
  return Number(t);
}

export function readBudgetConfig(e: Record<string, string | undefined> = process.env): BudgetConfig {
  return {
    runCap: whole(e.FIRECRAWL_RUN_CREDIT_CAP, DEFAULTS.runCap),
    dayCap: whole(e.FIRECRAWL_DAILY_CREDIT_CAP, DEFAULTS.dayCap),
    monthCap: whole(e.FIRECRAWL_MONTHLY_CREDIT_CAP, DEFAULTS.monthCap),
    minRemaining: whole(e.FIRECRAWL_MIN_REMAINING, DEFAULTS.minRemaining),
  };
}

/** What is known about credits already spent. null = not known (no database on a dry run, or the read failed). */
export interface BudgetSnapshot {
  ledgerToday: number | null;
  ledgerMonth: number | null;
  /** Live remaining credits from Firecrawl, or null when not read. */
  remainingLive: number | null;
}

export type BudgetVerdict = { ok: true } | { ok: false; reason: 'run_cap' | 'day_cap' | 'month_cap' | 'low_balance'; detail: string };

/**
 * May a call costing `cost` credits go ahead? `runSpent` is what this scan run has already spent (all sources together) and is NOT yet in
 * the ledger numbers when the snapshot was taken at the start of the run, so it is added to both.
 */
export function checkBudget(cfg: BudgetConfig, snap: BudgetSnapshot, runSpent: number, cost: number): BudgetVerdict {
  if (runSpent + cost > cfg.runCap) return { ok: false, reason: 'run_cap', detail: `run cap ${cfg.runCap} credits` };
  if (snap.ledgerToday !== null && snap.ledgerToday + runSpent + cost > cfg.dayCap) {
    return { ok: false, reason: 'day_cap', detail: `daily cap ${cfg.dayCap} credits (${snap.ledgerToday + runSpent} used today)` };
  }
  if (snap.ledgerMonth !== null && snap.ledgerMonth + runSpent + cost > cfg.monthCap) {
    return { ok: false, reason: 'month_cap', detail: `monthly cap ${cfg.monthCap} credits (${snap.ledgerMonth + runSpent} used this month)` };
  }
  if (snap.remainingLive !== null && snap.remainingLive - runSpent - cost < cfg.minRemaining) {
    return { ok: false, reason: 'low_balance', detail: `account would drop below ${cfg.minRemaining} remaining credits (${snap.remainingLive} left)` };
  }
  return { ok: true };
}

/** Credits spent so far in one scan run, shared by every Firecrawl source in it. Keyed by the run clock, which every adapter in a run shares. */
export class RunSpend {
  spent = 0;
  /** Live balance read once for the run, so five sources do not make five credit-usage calls. */
  remainingLive: number | null | undefined = undefined;
}

const runs = new Map<string, RunSpend>();

export function runSpendFor(runKey: string): RunSpend {
  let r = runs.get(runKey);
  if (!r) {
    // Keep the map small: a long-lived server sees one key per scan.
    if (runs.size > 20) runs.clear();
    r = new RunSpend();
    runs.set(runKey, r);
  }
  return r;
}

/** Test hook. */
export function resetRunSpend(): void {
  runs.clear();
}
