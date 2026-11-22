import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';
import { BIDS_FLAG, LOCAL_BIDS_FLAG, bidsEnabled, localBidsEnabled } from '@/lib/signals/bid-sources';
import { LOCAL_BID_SOURCES, type LocalBidSource } from '@/lib/firecrawl/local-sources';
import { runLocalBidSource, type PipelineDeps, type PipelineReport } from '@/lib/firecrawl/pipeline';

/**
 * Open bids from Atlanta-area agencies' own web pages, read with Firecrawl (round 16 unit FC). One adapter per agency, ids bids-gwinnett,
 * bids-rockdale, bids-tucker, bids-dunwoody (lib/firecrawl/local-sources.ts), registered under the existing bids-* pattern: kind
 * 'contract', data.subtype 'bid', label Act Now with the due date as the deadline (lead-rules SOURCE_DEFAULTS), tradeable through bid-trades.
 *
 * On only when HOLLER_BIDS_ENABLED, HOLLER_LOCAL_BIDS_ENABLED and FIRECRAWL_API_KEY are ALL set: run.ts skips the adapter naming whichever is
 * missing, and fetch() itself makes no robots.txt or Firecrawl request without all three. A dry scan makes none either (pipeline.ts). Daily cadence. How the credits are spent: lib/firecrawl/pipeline.ts.
 */
export const LOCAL_BIDS_CADENCE_MINUTES = 1440;

export function logLine(src: LocalBidSource, r: PipelineReport): string {
  if (r.status === 'skipped') return `${src.id}: skipped, ${r.reason ?? 'not run'}${r.notes.length ? ` (${r.notes[0]})` : ''}`;
  if (r.status === 'unchanged') return `${src.id}: page unchanged, ${r.creditsEstimated} credit${r.creditsEstimated === 1 ? '' : 's'}`;
  if (r.status === 'error') return `error: ${src.id}: ${r.reason ?? 'failed'}${r.error ? ` (${r.error.code}${r.error.status ? ` ${r.error.status}` : ''})` : ''}`;
  const reasons = new Map<string, number>();
  for (const d of r.dropped) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
  const why = [...reasons].map(([k, n]) => `${n} ${k}`).join(', ');
  return `${src.id}: ${r.rowsExtracted} rows read, ${r.kept.length} kept${why ? `, dropped: ${why}` : ''}, ${r.creditsEstimated} credits`;
}

export function buildLocalBidAdapter(src: LocalBidSource, over: Partial<Pick<PipelineDeps, 'makeClient'>> = {}): Adapter {
  return {
    id: src.id,
    label: src.label,
    kind: 'contract',
    cadenceMinutes: LOCAL_BIDS_CADENCE_MINUTES,
    requiresEnv: ['FIRECRAWL_API_KEY'],
    sourceUrl: src.listUrl,
    enabled: () => bidsEnabled(),
    flag: BIDS_FLAG,
    extraFlags: [{ name: LOCAL_BIDS_FLAG, on: () => localBidsEnabled() }],
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        const e: Record<string, string | undefined> = {
          ...ctx.env,
          [BIDS_FLAG]: ctx.env[BIDS_FLAG] ?? env.HOLLER_BIDS_ENABLED ?? process.env[BIDS_FLAG],
          [LOCAL_BIDS_FLAG]: ctx.env[LOCAL_BIDS_FLAG] ?? env.HOLLER_LOCAL_BIDS_ENABLED ?? process.env[LOCAL_BIDS_FLAG],
          FIRECRAWL_API_KEY: ctx.env.FIRECRAWL_API_KEY ?? env.FIRECRAWL_API_KEY ?? process.env.FIRECRAWL_API_KEY,
          FIRECRAWL_RUN_CREDIT_CAP: ctx.env.FIRECRAWL_RUN_CREDIT_CAP ?? env.FIRECRAWL_RUN_CREDIT_CAP,
          FIRECRAWL_DAILY_CREDIT_CAP: ctx.env.FIRECRAWL_DAILY_CREDIT_CAP ?? env.FIRECRAWL_DAILY_CREDIT_CAP,
          FIRECRAWL_MONTHLY_CREDIT_CAP: ctx.env.FIRECRAWL_MONTHLY_CREDIT_CAP ?? env.FIRECRAWL_MONTHLY_CREDIT_CAP,
          FIRECRAWL_MIN_REMAINING: ctx.env.FIRECRAWL_MIN_REMAINING ?? env.FIRECRAWL_MIN_REMAINING,
        };
        const report = await runLocalBidSource(src, { fetch: ctx.fetch, env: e, now: ctx.now ?? new Date(), log: ctx.log, db: ctx.db ?? null, dry: ctx.dry, ...over });
        ctx.log(logLine(src, report));
        return report.kept;
      } catch (err) {
        // Never log a message: it could carry request detail. The class of failure is enough.
        ctx.log(`error: ${src.id}: unexpected ${err instanceof Error ? err.name : 'failure'}`);
        return [];
      }
    },
  };
}

export const adapters: Adapter[] = LOCAL_BID_SOURCES.map((s) => buildLocalBidAdapter(s));
