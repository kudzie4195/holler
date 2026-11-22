import type { SignalKind } from '@/lib/signals/types';
import { kindLabel } from './signal-meta';
import type { Lang } from '@/lib/i18n';

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

// Neutral tag: muted on sand is 5.15:1.
const NEUTRAL = 'bg-sand text-muted';

/** Small mono tag (the "PERMIT" tag in the design): 13 px JetBrains Mono 500, uppercase, 6 px corners. */
const tag = 'inline-flex items-center rounded-chip px-2 py-0.5 font-mono text-xs font-medium uppercase leading-5 tracking-[0.02em]';

/**
 * Badge for a signal kind, in its family tint: weather sky (storm-ink 7.6:1), permits and spending sage (sage-ink 7.7:1),
 * 311 and civic purple (civic-ink 7.1:1). Unknown kinds render neutral rather than crash.
 */
export function Badge({ kind, label, lang = 'en' }: { kind: string; label?: string; lang?: Lang }) {
  const cls = (KIND_CLASS as Record<string, string>)[kind] ?? NEUTRAL;
  return <span className={`${tag} ${cls}`}>{label ?? kindLabel(kind, lang)}</span>;
}

const TONES = {
  neutral: NEUTRAL,
  // brand-text on sage: 6.0:1. "Saved" and other positive-but-not-done states.
  brand: 'bg-sage text-brand-text',
  success: 'bg-success-soft text-success-ink',
  warn: 'bg-warn-soft text-warn-ink',
  danger: 'bg-danger-soft text-danger',
} as const;
export type StatusTone = keyof typeof TONES;

/**
 * Generic status badge (Saved, Done, Trial). A tone name this file does not know (a caller still on a round 8 name) renders
 * neutral instead of failing, so pages owned by other units keep building until they move to a tone listed here.
 */
export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: StatusTone | (string & {});
  children: React.ReactNode;
}) {
  const cls = (TONES as Record<string, string>)[tone] ?? NEUTRAL;
  return <span className={`${tag} ${cls}`}>{children}</span>;
}
