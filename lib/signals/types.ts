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
   * Feature switch. When present and it returns false, the scan skips the adapter (reported as skipped(env) with the flag name) and it
   * does not run. Absent means always enabled. City bids use it (lib/signals/bid-sources.ts).
   */
  enabled?: () => boolean;
  fetch(ctx: AdapterContext): Promise<SignalInput[]>;
}
