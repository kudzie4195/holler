import type { SignalKind } from '@/lib/signals/types';
import { kindLabel } from './signal-meta';

const KIND_CLASS: Record<SignalKind, string> = {
  ask: 'bg-kind-ask-bg text-kind-ask-fg',
  alert: 'bg-kind-alert-bg text-kind-alert-fg',
  report: 'bg-kind-report-bg text-kind-report-fg',
  permit: 'bg-kind-permit-bg text-kind-permit-fg',
  civic: 'bg-kind-civic-bg text-kind-civic-fg',
  contract: 'bg-kind-contract-bg text-kind-contract-fg',
  event: 'bg-kind-event-bg text-kind-event-fg',
  disaster: 'bg-kind-disaster-bg text-kind-disaster-fg',
  quake: 'bg-kind-quake-bg text-kind-quake-fg',
  travel: 'bg-kind-travel-bg text-kind-travel-fg',
};

const NEUTRAL = 'bg-line/60 text-muted';

const pill = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5';

/** Badge for a signal kind. Unknown kinds render neutral rather than crash. */
export function Badge({ kind, label }: { kind: string; label?: string }) {
  const cls = (KIND_CLASS as Record<string, string>)[kind] ?? NEUTRAL;
  return <span className={`${pill} ${cls}`}>{label ?? kindLabel(kind)}</span>;
}

/** Generic status badge (Saved, Done, Trial). */
export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'accent';
  children: React.ReactNode;
}) {
  const tones = {
    neutral: NEUTRAL,
    success: 'bg-success-soft text-success-ink',
    warn: 'bg-warn-soft text-warn-ink',
    danger: 'bg-danger-soft text-danger',
    accent: 'bg-accent-soft text-accent-text',
  } as const;
  return <span className={`${pill} ${tones[tone]}`}>{children}</span>;
}
