import type { SignalKind } from '@/lib/signals/types';
import { getSourceMeta } from '@/lib/signals/source-meta';
import { t, type Lang } from '@/lib/i18n';
import { sourceLabelLang } from '@/lib/signals/source-label-i18n';

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
export function sourceLabel(source: string, lang: Lang = 'en'): string {
  const meta = getSourceMeta(source);
  if (meta) return lang === 'en' ? meta.label : (sourceLabelLang(source, lang) ?? meta.label);
  return source.replace(/[_:-]+/g, ' ');
}

export function isKnownKind(kind: string): kind is SignalKind {
  return kind in KIND_LABEL;
}

export function kindLabel(kind: string, lang: Lang = 'en'): string {
  if (lang !== 'en') return isKnownKind(kind) ? t(lang, `kind.${kind}`) : t(lang, 'kind.unknown');
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
  return f === 'weather' ? 'border-l-4 border-l-storm' : f === 'spending' ? 'border-l-4 border-l-sage-mark' : 'border-l-4 border-l-civic-mark';
}

/**
 * Family dot, with shape as well as color so color never carries the meaning alone: square for weather and permits
 * (spending), round for 311 and the civic family. `onBrand` picks the lighter marks drawn on green (4.3:1 or better on
 * brand-raised). Size and border are left to the caller.
 */
export function kindDot(kind: string, { onBrand = false }: { onBrand?: boolean } = {}): string {
  const f = kindFamily(kind);
  const shape = f === 'civic' ? 'rounded-full' : 'rounded-[3px]';
  const fill = onBrand
    ? f === 'weather'
      ? 'bg-weather-on-brand'
      : f === 'spending'
        ? 'bg-permit-on-brand'
        : 'bg-civic-on-brand'
    : f === 'weather'
      ? 'bg-storm'
      : f === 'spending'
        ? 'bg-sage-mark'
        : 'bg-civic-mark';
  return `${shape} ${fill}`;
}
