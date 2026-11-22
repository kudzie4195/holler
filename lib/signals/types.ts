import type { CategoryId } from './categories';
import type { ContactInput } from '@/lib/contacts/types';

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
}

export interface AdapterContext {
  since: Date;
  /** run clock; adapters that use fixed lookback windows read this instead of `since` */
  now?: Date;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  log: (m: string) => void;
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
   * Probation: a new source whose live output nobody has checked yet. The scan runs it like any source (same fetch, parsing, privacy
   * sanitizing and contact extraction) but writes up to 300 rows per run to holler_source_samples (migration 0022, service role only,
   * kept 14 days) instead of holler_signals / holler_signal_contacts. It is never matched, notified, AI-classified or pinged to IndexNow,
   * and no member or public page can read its rows. scan_runs and source health log it as usual (inserted = samples written).
   * Look at the samples with the second query in scripts/metro-scorecard.sql. To flip it live, remove `probation: true`: the next scan
   * writes to holler_signals normally. Nothing else to clean up or migrate.
   */
  probation?: boolean;
  fetch(ctx: AdapterContext): Promise<SignalInput[]>;
}
