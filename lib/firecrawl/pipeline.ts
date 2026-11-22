import type { Db } from '@/lib/signals/store';
import type { SignalInput } from '@/lib/signals/types';
import { bidsEnabled, BIDS_FLAG } from '@/lib/signals/bid-sources';
import { createFirecrawlClient, firecrawlApiKey, FirecrawlError, type FirecrawlClient, type ScrapeResult } from './client';
import { checkBudget, readBudgetConfig, runSpendFor, type BudgetSnapshot } from './budget';
import { checkRobots } from './robots';
import { lastScanFinish, readLedger, writeLedger, type LedgerState, type LedgerSummary } from './ledger';
import { changeTag, EXTRACT_SCHEMA, extractionPrompt, rowsFromJson, validateRows, type DroppedRow } from './extract';
import type { LocalBidSource } from './local-sources';

/**
 * One agency page, start to finish. Used by the scheduled adapter and by the owner probe, so what the probe shows is what the scan does.
 *
 *   gates     HOLLER_BIDS_ENABLED and FIRECRAWL_API_KEY must both be set, else nothing at all happens (no robots.txt fetch, no Firecrawl call).
 *   robots    the agency's robots.txt must allow the page path (fetched directly, free).
 *   budget    run, day, month caps and the live balance floor (budget.ts) are checked before every paid call.
 *   check     1 credit: scrape with change tracking. "same" ends the run (no extraction, no rows, the stored bids stay as they are).
 *   extract   5 credits (1 + 4 for json): only for a new or changed page, or when the last extraction was lost (state "pending", or its
 *             rows were never stored because the scan ran out of time). Rows are then validated (extract.ts) and returned.
 * The probe (`dry` + `force`) runs the extraction only: 5 credits, no change tracking (so it never moves the page's change baseline),
 * no ledger row.
 */
export interface PipelineDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: Date;
  log: (m: string) => void;
  db?: Db | null;
  dry?: boolean;
  /** Probe: skip the change check and extract now. */
  force?: boolean;
  /** Probe: run without HOLLER_BIDS_ENABLED (the owner tests a source before turning bids on). The key is always required. */
  ignoreBidsFlag?: boolean;
  makeClient?: (apiKey: string) => FirecrawlClient;
  /** Wall-clock budget for the whole source, ms. Default 36 000 (the scan gives an adapter 40 s). */
  budgetMs?: number;
  clock?: () => number;
}

export type PipelineStatus = 'ok' | 'unchanged' | 'skipped' | 'error';
export type SkipReason = 'flag_off' | 'no_key' | 'robots_disallowed' | 'robots_unreachable' | 'ledger_unreadable' | 'run_cap' | 'day_cap' | 'month_cap' | 'low_balance' | 'no_time';

export interface PipelineReport {
  source: string;
  status: PipelineStatus;
  reason: SkipReason | 'page_removed' | 'check_failed' | 'extract_failed' | null;
  /** Firecrawl scrape calls made (credit-usage reads are not counted). */
  calls: number;
  creditsEstimated: number;
  creditsReported: number | null;
  changeStatus: string | null;
  rowsExtracted: number;
  kept: SignalInput[];
  dropped: DroppedRow[];
  /** Firecrawl error code and HTTP status when a call failed, never a message body. */
  error: { code: string; status: number | null } | null;
  notes: string[];
}

function emptyReport(source: string): PipelineReport {
  return { source, status: 'skipped', reason: null, calls: 0, creditsEstimated: 0, creditsReported: null, changeStatus: null, rowsExtracted: 0, kept: [], dropped: [], error: null, notes: [] };
}

const errInfo = (e: unknown): { code: string; status: number | null } => (e instanceof FirecrawlError ? { code: e.code, status: e.status } : { code: 'unexpected', status: null });

export async function runLocalBidSource(src: LocalBidSource, deps: PipelineDeps): Promise<PipelineReport> {
  const rep = emptyReport(src.id);
  const clock = deps.clock ?? Date.now;
  const startedMs = clock();
  const deadline = startedMs + (deps.budgetMs ?? 36_000);

  // 1. gates: zero calls of any kind when either is missing.
  const flagOn = deps.ignoreBidsFlag || bidsEnabled(deps.env[BIDS_FLAG]);
  if (!flagOn) return { ...rep, reason: 'flag_off' };
  const apiKey = firecrawlApiKey(deps.env);
  if (!apiKey) return { ...rep, reason: 'no_key' };

  // 2. robots.txt of the agency.
  const robots = await checkRobots(src.listUrl, deps.fetch, deps.now.getTime());
  if (!robots.allowed) return { ...rep, reason: robots.reason === 'disallowed' ? 'robots_disallowed' : 'robots_unreachable' };

  const client = (deps.makeClient ?? ((k: string) => createFirecrawlClient({ apiKey: k })))(apiKey);
  const cfg = readBudgetConfig(deps.env);
  const rs = runSpendFor(deps.now.toISOString());
  const ledgerOn = !!deps.db && !deps.dry;

  // 3. what has been spent (the ledger) and what is pending for this source.
  let ledger: LedgerSummary | null = null;
  let needExtract = !!deps.force;
  if (deps.db) {
    try {
      ledger = await readLedger(deps.db, deps.now);
      const mine = ledger.bySource[src.id];
      if (mine?.lastState === 'pending') needExtract = true;
      else if (mine?.lastState === 'extracted' && mine.lastAt) {
        // Rows were handed to the scan. The scan logs this source's own scan_runs row only after it stored them, so a scan row older than
        // the extraction means the rows were lost (the scan ran out of time): extract again rather than wait for the page to change.
        const finished = await lastScanFinish(deps.db, src.id);
        if (finished === null || finished < Date.parse(mine.lastAt)) {
          needExtract = true;
          rep.notes.push('last extraction was not stored; extracting again');
        }
      }
    } catch {
      return { ...rep, reason: 'ledger_unreadable' };
    }
  }

  const snapshotFor = async (): Promise<BudgetSnapshot> => {
    if (rs.remainingLive === undefined) {
      try {
        rs.remainingLive = (await client.creditUsage()).remainingCredits;
      } catch {
        rs.remainingLive = null; // the caps still apply; only the live floor is unknown
      }
    }
    return { ledgerToday: ledger ? ledger.today : null, ledgerMonth: ledger ? ledger.month : null, remainingLive: rs.remainingLive ?? null };
  };

  let credits = 0;
  const write = async (state: LedgerState, kept = 0, dropped = 0) => {
    if (!ledgerOn || !deps.db) return;
    try {
      await writeLedger(deps.db, { source: src.id, at: deps.now, credits, kept, dropped, state });
    } catch {
      rep.notes.push('ledger write skipped');
    }
  };
  const account = (r: ScrapeResult) => {
    rep.calls += 1;
    rep.creditsEstimated += r.creditsEstimated;
    if (r.creditsReported !== null) rep.creditsReported = (rep.creditsReported ?? 0) + r.creditsReported;
    credits += r.creditsEstimated;
    rs.spent += r.creditsEstimated;
  };
  const blocked = async (cost: number) => {
    const v = checkBudget(cfg, await snapshotFor(), rs.spent, cost);
    return v.ok ? null : v;
  };

  // 4. change check.
  let markdown: string | null = null;
  if (!needExtract) {
    const b = await blocked(1);
    if (b) {
      await write('skipped');
      return { ...rep, reason: b.reason, notes: [...rep.notes, b.detail] };
    }
    const left = deadline - clock();
    if (left < 6000) return { ...rep, reason: 'no_time' };
    let a: ScrapeResult;
    try {
      a = await client.scrape({
        url: src.listUrl,
        formats: ['markdown', { type: 'changeTracking', tag: changeTag(src) }],
        timeoutMs: Math.min(15_000, left),
        deadlineMs: deadline,
      });
    } catch (e) {
      await write('failed');
      return { ...rep, status: 'error', reason: 'check_failed', error: errInfo(e) };
    }
    account(a);
    rep.changeStatus = a.changeStatus;
    if (a.warning) rep.notes.push(`warning: ${a.warning}`);
    if (a.changeStatus === 'same') {
      await write('unchanged');
      return { ...rep, status: 'unchanged' };
    }
    if (a.changeStatus === 'removed') {
      await write('failed');
      return { ...rep, status: 'error', reason: 'page_removed' };
    }
    markdown = a.markdown; // new, changed, or no change information: all mean "extract"
  }

  // 5. extraction.
  const b = await blocked(5);
  if (b) {
    await write('pending');
    return { ...rep, reason: b.reason, notes: [...rep.notes, b.detail] };
  }
  const left = deadline - clock();
  if (left < 8000) {
    await write('pending');
    return { ...rep, reason: 'no_time' };
  }
  let x: ScrapeResult;
  try {
    x = await client.scrape({
      url: src.listUrl,
      formats: ['markdown', { type: 'json', schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>, prompt: extractionPrompt(src) }],
      timeoutMs: Math.min(30_000, left),
      // the check call just fetched the page; reuse it for a few minutes instead of asking the agency's site a second time
      maxAgeMs: needExtract ? 0 : 600_000,
      deadlineMs: deadline,
    });
  } catch (e) {
    await write('pending');
    return { ...rep, status: 'error', reason: 'extract_failed', error: errInfo(e) };
  }
  account(x);
  if (x.warning) rep.notes.push(`warning: ${x.warning}`);
  const rows = rowsFromJson(x.json);
  rep.rowsExtracted = rows.length;
  const v = validateRows(rows, src, { now: deps.now, markdown: x.markdown ?? markdown });
  rep.kept = v.items;
  rep.dropped = v.dropped;
  rep.status = 'ok';
  await write('extracted', v.items.length, v.dropped.length);
  return rep;
}
