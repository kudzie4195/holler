import { HOLLER_UA } from '@/lib/user-agent';
import { runStageQuery } from './adapters/socrata';
import { SOCRATA_DATASETS, type SocrataDataset } from './adapters/socrata-datasets';
import { env } from '@/lib/env';
import { stageUpdatesEnabled } from './stage';

/** Source ids the owner can dry check: the verified permit datasets that have a stage query. */
export function stageProbeSourceIds(): string[] {
  return SOCRATA_DATASETS.filter((d) => d.verified && d.subtype === 'permit' && d.statusField && d.stageQuery).map((d) => d.id);
}

export interface StageProbeResult {
  status: 'ok' | 'unknown_source';
  source: string;
  /** The date column the stage query filters on. */
  dateField: string | null;
  /** True when the portal ANSWERED the query with a list of rows (so the date column exists). False for an error answer or no answer. */
  dateColumnAccepted: boolean;
  /** ok, rejected (the portal refused the query, usually an unknown column), failed (no usable answer) or full_page. */
  state: string | null;
  httpStatus: number | null;
  rowCount: number;
  /** The status text of the first rows exactly as the portal wrote it (at most 5, 40 characters each). */
  sampleStatuses: string[];
  /** How many of the rows read map to a stage this feature tracks. */
  stageRows: number;
  /** The portal's own error message, shortened, when it refused the query. */
  message?: string;
  /** Whether HOLLER_STAGE_UPDATES_ENABLED is on right now (this check does not change it). */
  flagEnabled: boolean;
  /** Always true: the check writes nothing (no signal, no history row, no scan run, no alert). */
  wroteNothing: true;
}

/**
 * The owner's dry check of ONE source's stage query (GET /api/admin/stage-probe?source=<id>). Runs the same query the scan would run,
 * once, and reports the row count, a few raw status texts, and whether the portal accepted the date column. It never touches the database.
 * `doFetch` is passed in so a test can answer without a network.
 */
export async function runStageProbe(source: string, doFetch: typeof fetch, now: Date = new Date(), flag: string | undefined = process.env.HOLLER_STAGE_UPDATES_ENABLED): Promise<StageProbeResult> {
  const ds: SocrataDataset | undefined = SOCRATA_DATASETS.find((d) => d.id === source && d.verified && d.subtype === 'permit' && d.statusField && d.stageQuery);
  const flagEnabled = stageUpdatesEnabled(flag);
  if (!ds) return { status: 'unknown_source', source, dateField: null, dateColumnAccepted: false, state: null, httpStatus: null, rowCount: 0, sampleStatuses: [], stageRows: 0, flagEnabled, wroteNothing: true };
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': HOLLER_UA };
  const token = process.env.SOCRATA_APP_TOKEN ?? env.SOCRATA_APP_TOKEN;
  if (token) headers['X-App-Token'] = token;
  const run = await runStageQuery(ds, doFetch, headers, now);
  return {
    status: 'ok',
    source,
    dateField: ds.stageQuery?.dateField ?? null,
    dateColumnAccepted: run.outcome.state === 'ok' || run.outcome.state === 'full_page',
    state: run.outcome.state,
    httpStatus: run.outcome.httpStatus ?? null,
    rowCount: run.outcome.rows,
    sampleStatuses: run.sampleStatuses,
    stageRows: run.items.length,
    ...(run.message ? { message: run.message } : {}),
    flagEnabled,
    wroteNothing: true,
  };
}
