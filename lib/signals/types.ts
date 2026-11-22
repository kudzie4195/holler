import type { CategoryId } from './categories';
import type { ContactInput } from '@/lib/contacts/types';
import type { Db } from './store';
import type { PermitStage } from './stage';

export type SignalKind =
  | 'ask'
  | 'alert'
  | 'report'
  | 'permit'
  | 'civic'
  | 'contract'
  | 'event'
  | 'disaster'
  | 'quake'
  | 'travel';
export type Severity = 1 | 2 | 3;

export interface SignalInput {
  source: string;
  externalId: string;
  kind: SignalKind;
  title: string;
  summary?: string | null;
  url?: string | null;
  lat?: number | null;
  lon?: number | null;
  city?: string | null;
  state?: string | null;
  county?: string | null;
  zip?: string | null;
  categories: CategoryId[];
  severity: Severity;
  occurredAt: string;
  expiresAt?: string | null;
  data?: Record<string, unknown>;
  /**
   * Who to contact about this record: organisations and the site address the record names (lib/contacts). PRIVATE: the store writes
   * these to holler_signal_contacts (service role only) for newly inserted signals and never copies them into title, summary or data.
   */
  contacts?: ContactInput[];
  /**
   * Permits: the stage the portal's status column shows, as one of the fixed codes (lib/signals/stage.ts). NOT stored by the plain upsert:
   * lib/signals/projects.ts reads it when migration 0025 is applied and ignores it otherwise.
   */
  permitStage?: PermitStage;
  /**
   * Set only on a row that came from an adapter's STAGE QUERY and was not in the adapter's normal read: a status probe for a permit that
   * may already be tracked. lib/signals/projects.ts uses it ONLY to move a permit that already has a status history to a new stage; a
   * probe row of a permit with no history is dropped before anything is stored, carded or logged, and a probe row is never inserted.
   */
  stageProbe?: boolean;
}

export interface AdapterContext {
  since: Date;
  /** run clock; adapters that use fixed lookback windows read this instead of `since` */
  now?: Date;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  log: (m: string) => void;
  /** Service-role client for the few adapters that keep their own bookkeeping (lib/firecrawl ledger). Absent on a dry run and in unit tests. */
  db?: Db | null;
  /** True for a dry scan (?dry=1): fetch and parse only, write nothing anywhere. */
  dry?: boolean;
  /**
   * True only when the scan found migration 0025's stage table (lib/signals/projects.ts stageTrackingAvailable). An adapter with a stage
   * query makes it only then; absent or false means exactly the fetch an adapter made before 0025.
   */
  stageTracking?: boolean;
  /** An adapter with a stage query reports how it went (once per fetch). run.ts turns a failure into a note on that source's scan_runs row. */
  stageOutcome?: (o: StageQueryOutcome) => void;
}

/** How a stage query went. 'ok' with rows is the normal case; the others are shown to the owner (holler_scan_runs.error, health email). */
export interface StageQueryOutcome {
  state: 'ok' | 'rejected' | 'failed' | 'full_page';
  rows: number;
  /** The date column the query filtered on. */
  dateField: string;
  /** HTTP status when the portal answered. */
  httpStatus?: number;
}

export interface Adapter {
  id: string;
  label: string;
  kind: SignalKind;
  cadenceMinutes: number;
  requiresEnv?: string[];
  /** Human-readable source home page, shown on public pages as citation. */
  sourceUrl: string;
  /**
   * Feature switch. When present and it returns false, the scan skips the adapter (reported as skipped(env) with the flag name) and it
   * does not run. Absent means always enabled. City bids use it (lib/signals/bid-sources.ts).
   */
  enabled?: () => boolean;
  /** Name of the env var behind `enabled`, shown when the adapter is switched off (missingEnvFor). Absent: 'feature flag'. City bids: HOLLER_BIDS_ENABLED. */
  flag?: string;
  /**
   * More switches that must ALL be on besides `enabled` (the Firecrawl agency feeds need HOLLER_LOCAL_BIDS_ENABLED too). Each off one is
   * named by missingEnvFor. Absent: none.
   */
  extraFlags?: Array<{ name: string; on: () => boolean }>;
  /** True when `fetch` also runs a stage query (a second, capped read for permits whose status changed) while ctx.stageTracking is on. */
  stageQuery?: boolean;
  /**
   * Probation: a new source whose live output nobody has checked yet. The scan runs it like any source (same fetch, parsing, privacy
   * sanitizing and contact extraction) but writes up to 300 rows per run to holler_source_samples (migration 0032, service role only,
   * kept 14 days) instead of holler_signals / holler_signal_contacts. It is never matched, labelled into a card, notified, AI-classified,
   * pinged to IndexNow or counted on a public page, and no member or public page can read its rows. scan_runs and source health log it
   * as usual (inserted = samples written). With migration 0032 not applied the scan skips it (no fetch, no error). To put it live, remove
   * `probation: true`: the next scan writes to holler_signals normally. Nothing else to clean up or migrate.
   */
  probation?: boolean;
  fetch(ctx: AdapterContext): Promise<SignalInput[]>;
}
