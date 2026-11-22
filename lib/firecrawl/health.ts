import type { Db } from '@/lib/signals/store';
import { bidsEnabled } from '@/lib/signals/bid-sources';
import { createFirecrawlClient, firecrawlApiKey, type FirecrawlClient } from './client';
import { readBudgetConfig, type BudgetConfig } from './budget';
import { readLedger } from './ledger';
import { LOCAL_BID_SOURCES } from './local-sources';

/** Firecrawl block of the daily health email: credits used today and this month (ledger), live balance, and each source's last state. */
export interface FirecrawlHealth {
  /** Both gates open: HOLLER_BIDS_ENABLED and FIRECRAWL_API_KEY. */
  running: boolean;
  keySet: boolean;
  bidsOn: boolean;
  creditsToday: number | null;
  creditsMonth: number | null;
  caps: BudgetConfig;
  remainingLive: number | null;
  planCredits: number | null;
  sources: Array<{ id: string; state: string; lastAt: string | null; lastKept: number; lastCredits: number; creditsMonth: number }>;
}

export async function loadFirecrawlHealth(opts: { db: Db; now: Date; env: Record<string, string | undefined>; makeClient?: (k: string) => FirecrawlClient }): Promise<FirecrawlHealth | null> {
  const key = firecrawlApiKey(opts.env);
  const bidsOn = bidsEnabled(opts.env.HOLLER_BIDS_ENABLED);
  let ledger: Awaited<ReturnType<typeof readLedger>> | null = null;
  try {
    ledger = await readLedger(opts.db, opts.now);
  } catch {
    ledger = null;
  }
  // Nothing configured and nothing ever spent: leave the block out of the email.
  if (!key && !bidsOn && (!ledger || ledger.month === 0)) return null;
  let remaining: number | null = null;
  let plan: number | null = null;
  if (key) {
    try {
      const u = await (opts.makeClient ?? ((k: string) => createFirecrawlClient({ apiKey: k })))(key).creditUsage();
      remaining = u.remainingCredits;
      plan = u.planCredits;
    } catch {
      /* balance unknown */
    }
  }
  return {
    running: !!key && bidsOn,
    keySet: !!key,
    bidsOn,
    creditsToday: ledger ? ledger.today : null,
    creditsMonth: ledger ? ledger.month : null,
    caps: readBudgetConfig(opts.env),
    remainingLive: remaining,
    planCredits: plan,
    sources: LOCAL_BID_SOURCES.map((s) => {
      const l = ledger?.bySource[s.id];
      return { id: s.id, state: l?.lastState ?? 'no run yet', lastAt: l?.lastAt ?? null, lastKept: l?.lastKept ?? 0, lastCredits: l?.lastCredits ?? 0, creditsMonth: l?.creditsMonth ?? 0 };
    }),
  };
}

const n = (v: number | null) => (v === null ? 'unknown' : String(v));

/** Lines for the email. */
export function firecrawlLines(f: FirecrawlHealth): string[] {
  const lines = [
    f.running
      ? 'On: HOLLER_BIDS_ENABLED and FIRECRAWL_API_KEY are both set.'
      : `Off: ${[!f.bidsOn && 'HOLLER_BIDS_ENABLED is not set', !f.keySet && 'FIRECRAWL_API_KEY is not set'].filter(Boolean).join(' and ')}; no Firecrawl call is made.`,
    `Credits used today: ${n(f.creditsToday)} of ${f.caps.dayCap}. Month to date: ${n(f.creditsMonth)} of ${f.caps.monthCap} (estimated from the documented 1 + 4 credits per scrape).`,
    `Account balance now: ${n(f.remainingLive)} remaining${f.planCredits !== null ? ` of a ${f.planCredits} credit plan` : ''}; spending stops below ${f.caps.minRemaining}.`,
  ];
  for (const s of f.sources) {
    lines.push(`${s.id}: ${s.state}${s.lastAt ? ` at ${s.lastAt.slice(0, 16).replace('T', ' ')} UTC` : ''}, ${s.lastKept} rows kept, ${s.creditsMonth} credits this month`);
  }
  return lines;
}
