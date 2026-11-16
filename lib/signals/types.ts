import type { CategoryId } from './categories';

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
}

export interface AdapterContext {
  since: Date;
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
  fetch(ctx: AdapterContext): Promise<SignalInput[]>;
}
