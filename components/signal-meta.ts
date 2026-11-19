import type { SignalKind } from '@/lib/signals/types';
import { getSourceMeta } from '@/lib/signals/source-meta';

/** Plain-language label for each signal kind (shown on badges and filters). */
export const KIND_LABEL: Record<SignalKind, string> = {
  ask: 'Someone asking',
  alert: 'Weather alert',
  report: 'Storm report',
  permit: 'Permit',
  civic: '311 or inspection',
  contract: 'Federal contract',
  event: 'Event',
  disaster: 'Disaster',
  quake: 'Earthquake',
  travel: 'Airport delay',
};

/**
 * Source labels come from lib/signals/source-meta.ts, a static client-safe copy of the real
 * ALL_ADAPTERS labels (the registry itself imports server code). Unknown ids fall back to a tidied id.
 */
export function sourceLabel(source: string): string {
  const meta = getSourceMeta(source);
  if (meta) return meta.label;
  return source.replace(/[_:-]+/g, ' ');
}

export function isKnownKind(kind: string): kind is SignalKind {
  return kind in KIND_LABEL;
}

export function kindLabel(kind: string): string {
  return isKnownKind(kind) ? KIND_LABEL[kind] : 'Signal';
}

/** Record family, same three as the app and the --color-kind-* tokens: weather and hazards, spending, civic and everything else. */
export function kindFamily(kind: string): 'weather' | 'spending' | 'civic' {
  if (kind === 'alert' || kind === 'report' || kind === 'disaster' || kind === 'quake') return 'weather';
  if (kind === 'permit' || kind === 'contract') return 'spending';
  return 'civic';
}

/** Left stripe for a record card in its family color. Always next to a text badge, so color never carries meaning alone. */
export function kindStripe(kind: string): string {
  const f = kindFamily(kind);
  return f === 'weather' ? 'border-l-4 border-l-storm' : f === 'spending' ? 'border-l-4 border-l-sage-mark' : 'border-l-4 border-l-accent';
}
