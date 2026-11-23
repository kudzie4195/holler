import { probationFetchOn } from '@/lib/signals/probation-fetch';
import type { Db } from '@/lib/signals/store';
import { createFirecrawlClient, firecrawlApiKey, type FirecrawlClient } from './client';
import { runLocalBidSource, type PipelineReport } from './pipeline';
import { LOCAL_BID_SOURCES, localSourceById } from './local-sources';
import { PAGE_WATCH_DATASETS } from '@/lib/signals/adapters/page-watch-datasets';
import { asLocalBidSource, pageWatchGate } from '@/lib/signals/adapters/page-watch';

/**
 * Round 20 page watch: the pages read through Firecrawl (`firecrawl: 'only'` or 'fallback') are probed here too, with the same caps, but
 * ONLY once the owner recorded their terms check and the page-watch switch is on (round 20 review P0): until then no Firecrawl call is made
 * for them. Read at call time.
 */
function pageWatchFirecrawl(e: Record<string, string | undefined>) {
  // Round 21 final review P1-1: page-watch pages are probation sources; the one off switch hides them from this probe too.
  if (!probationFetchOn()) return [];
  return PAGE_WATCH_DATASETS.filter((d) => d.verified && d.firecrawl !== 'off' && !pageWatchGate(d, e));
}

/**
 * The owner probe behind GET /api/admin/firecrawl-probe?source=<id>. A dry run of one source: it reads the page once with the
 * extraction (5 credits by the documented formula; the change baseline is not touched), validates the rows exactly as the scan would, and
 * writes no signal. It does write one `probe` ledger row, so its credits count in the day and month totals and in its own daily cap
 * (FIRECRAWL_PROBE_DAILY_CAP, default 25). It runs even while the bid switches are off, so a source can be tested before bids go live, but
 * it still needs FIRECRAWL_API_KEY and a database, still honours robots.txt, and still obeys the credit caps and the balance floor.
 * Credits are reported three ways: estimated (documented formula), reported (only if the API says), and measured (the balance read from
 * /v2/team/credit-usage before and after, so it also shows anything else spending on the same account).
 */
export interface ProbeResult {
  ok: boolean;
  source: string;
  page: string;
  status: PipelineReport['status'] | 'unknown_source' | 'no_key';
  reason: string | null;
  error: PipelineReport['error'];
  changeStatus: string | null;
  rowsExtracted: number;
  kept: Array<{ title: string; solicitation: string | null; dueDate: string | null; dueInstant: string | null; trades: string[]; url: string | null; linkKind: unknown; summary: string | null }>;
  dropped: PipelineReport['dropped'];
  credits: { calls: number; estimated: number; reported: number | null; measured: number | null; remainingBefore: number | null; remainingAfter: number | null; planCredits: number | null };
  notes: string[];
  knownSources: string[];
}

export async function runProbe(opts: {
  source: string | null;
  env: Record<string, string | undefined>;
  now: Date;
  fetch: typeof fetch;
  db?: Db | null;
  makeClient?: (apiKey: string) => FirecrawlClient;
}): Promise<ProbeResult> {
  const PAGE_WATCH_FIRECRAWL = pageWatchFirecrawl(opts.env);
  const known = [...LOCAL_BID_SOURCES.map((s) => s.id), ...PAGE_WATCH_FIRECRAWL.map((d) => d.id)];
  const base = { ok: false, page: '', reason: null, error: null, changeStatus: null, rowsExtracted: 0, kept: [], dropped: [], notes: [], knownSources: known, credits: { calls: 0, estimated: 0, reported: null, measured: null, remainingBefore: null, remainingAfter: null, planCredits: null } };
  const pw = opts.source ? PAGE_WATCH_FIRECRAWL.find((d) => d.id === opts.source) : undefined;
  const src = opts.source ? localSourceById(opts.source) ?? (pw ? asLocalBidSource(pw) : undefined) : undefined;
  if (!src) return { ...base, source: opts.source ?? '', status: 'unknown_source', reason: 'unknown_source' };
  const key = firecrawlApiKey(opts.env);
  if (!key) return { ...base, source: src.id, page: src.listUrl, status: 'no_key', reason: 'no_key' };

  const client = (opts.makeClient ?? ((k: string) => createFirecrawlClient({ apiKey: k })))(key);
  let before: { remainingCredits: number | null; planCredits: number | null } | null = null;
  try {
    before = await client.creditUsage();
  } catch {
    before = null;
  }
  const report = await runLocalBidSource(src, {
    fetch: opts.fetch,
    env: opts.env,
    now: opts.now,
    log: () => undefined,
    db: opts.db ?? null,
    dry: true,
    force: true,
    ignoreBidsFlag: true,
    makeClient: () => client,
  });
  let after: { remainingCredits: number | null } | null = null;
  if (report.calls > 0) {
    try {
      after = await client.creditUsage();
    } catch {
      after = null;
    }
  }
  const rb = before?.remainingCredits ?? null;
  const ra = after?.remainingCredits ?? null;
  return {
    ok: report.status === 'ok',
    source: src.id,
    page: src.listUrl,
    status: report.status,
    reason: report.reason,
    error: report.error,
    changeStatus: report.changeStatus,
    rowsExtracted: report.rowsExtracted,
    kept: report.kept.map((s) => ({
      title: s.title,
      solicitation: ((s.data?.solicitationId as string | null) ?? null) || null,
      dueDate: (s.data?.dueDate as string | null) ?? null,
      dueInstant: s.expiresAt ?? null,
      trades: s.categories,
      url: s.url ?? null,
      linkKind: s.data?.linkKind,
      summary: s.summary ?? null,
    })),
    dropped: report.dropped,
    credits: {
      calls: report.calls,
      estimated: report.creditsEstimated,
      reported: report.creditsReported,
      measured: rb !== null && ra !== null ? rb - ra : null,
      remainingBefore: rb,
      remainingAfter: ra,
      planCredits: before?.planCredits ?? null,
    },
    notes: report.notes,
    knownSources: known,
  };
}
