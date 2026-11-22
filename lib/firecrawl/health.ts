import type { Db } from '@/lib/signals/store';
import { bidsEnabled, localBidsEnabled, BIDS_FLAG, LOCAL_BIDS_FLAG } from '@/lib/signals/bid-sources';
import { createFirecrawlClient, firecrawlApiKey, type FirecrawlClient } from './client';
import { readBudgetConfig, type BudgetConfig } from './budget';
import { readLedger } from './ledger';
import { LOCAL_BID_SOURCES } from './local-sources';

/** Firecrawl block of the daily health email: credits used today and this month (ledger), live balance, and each source's last state. */
export interface FirecrawlHealth {
  /** All three gates open: HOLLER_BIDS_ENABLED, HOLLER_LOCAL_BIDS_ENABLED and FIRECRAWL_API_KEY. */
  running: boolean;
  keySet: boolean;
  bidsOn: boolean;
  localOn: boolean;
  creditsToday: number | null;
  creditsMonth: number | null;
  caps: BudgetConfig;
  remainingLive: number | null;
  planCredits: number | null;
  sources: Array<{ id: string; state: string; lastAt: string | null; lastKept: number; lastCredits: number; creditsMonth: number }>;
}

/**
 * Makes NO Firecrawl call and NO ledger read unless the feed is running (all three switches set): while it is off the daily health email must
 * not cost a credit-usage request or a database read for a feature nobody turned on (round 16 review). Returns null when none of the three is
 * set, and an "Off" block that names what is missing when some are.
 */
export async function loadFirecrawlHealth(opts: { db: Db; now: Date; env: Record<string, string | undefined>; makeClient?: (k: string) => FirecrawlClient }): Promise<FirecrawlHealth | null> {
  const key = firecrawlApiKey(opts.env);
  const bidsOn = bidsEnabled(opts.env[BIDS_FLAG]);
  const localOn = localBidsEnabled(opts.env[LOCAL_BIDS_FLAG]);
  if (!key && !bidsOn && !localOn) return null;
  const running = !!key && bidsOn && localOn;
  const caps = readBudgetConfig(opts.env);
  if (!running) {
    return { running, keySet: !!key, bidsOn, localOn, creditsToday: null, creditsMonth: null, caps, remainingLive: null, planCredits: null, sources: [] };
  }
  let remaining: number | null = null;
  let plan: number | null = null;
  let cycleStart: string | null = null;
  try {
    const u = await (opts.makeClient ?? ((k: string) => createFirecrawlClient({ apiKey: k })))(key).creditUsage();
    remaining = u.remainingCredits;
    plan = u.planCredits;
    cycleStart = u.billingPeriodStart;
  } catch {
    /* balance unknown */
  }
  let ledger: Awaited<ReturnType<typeof readLedger>> | null = null;
  try {
    ledger = await readLedger(opts.db, opts.now, cycleStart);
  } catch {
    ledger = null;
  }
  return {
    running,
    keySet: true,
    bidsOn,
    localOn,
    creditsToday: ledger ? ledger.today : null,
    creditsMonth: ledger ? ledger.month : null,
    caps,
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
  if (!f.running) {
    const missing = [!f.bidsOn && `${BIDS_FLAG} is not set`, !f.localOn && `${LOCAL_BIDS_FLAG} is not set`, !f.keySet && 'FIRECRAWL_API_KEY is not set'].filter(Boolean).join(', ');
    return [`Off: ${missing}. No Firecrawl call is made and no credits are used.`];
  }
  const lines = [
    `On: ${BIDS_FLAG}, ${LOCAL_BIDS_FLAG} and FIRECRAWL_API_KEY are all set.`,
    `Credits used today: ${n(f.creditsToday)} of ${f.caps.dayCap}. Month to date: ${n(f.creditsMonth)} of ${f.caps.monthCap} (estimated from the documented 1 + 4 credits per scrape; includes owner probes).`,
    `Account balance now: ${n(f.remainingLive)} remaining${f.planCredits !== null ? ` of a ${f.planCredits} credit plan` : ''}; spending stops below ${f.caps.minRemaining}.`,
  ];
  for (const s of f.sources) {
    lines.push(`${s.id}: ${s.state}${s.lastAt ? ` at ${s.lastAt.slice(0, 16).replace('T', ' ')} UTC` : ''}, ${s.lastKept} rows kept, ${s.creditsMonth} credits this month`);
  }
  return lines;
}
