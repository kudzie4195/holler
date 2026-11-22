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
  fetch(ctx: AdapterContext): Promise<SignalInput[]>;
}
