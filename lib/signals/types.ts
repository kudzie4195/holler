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
   * Probation: a new source whose live responses have not been checked by a person yet. Its rows are stored with `data.probation = true`
   * and counted in scan_runs and source health, but never matched, pushed, emailed or shown to members or on public pages
   * (lib/signals/probation.ts). Flip it live by removing this flag after checking real rows, and clear `data.probation` on the stored rows.
   */
  probation?: boolean;
  fetch(ctx: AdapterContext): Promise<SignalInput[]>;
}
