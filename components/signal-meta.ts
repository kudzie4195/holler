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
