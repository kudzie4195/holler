import { getSourceMeta } from './source-meta';
import { hasKey, t, type DictKey, type Lang } from '@/lib/i18n';

/**
 * What Holler calls a public source ("Chicago open data: food inspections"), in a language. Pure, client-safe. These are Holler's own
 * names for each source, not the source's data, so they are translated; the city or county name inside them is kept as it is.
 * English returns the label in lib/signals/source-meta.ts unchanged (tests/i18n/source-labels.test.ts proves the dictionary rebuilds
 * every English label exactly, so the two cannot drift).
 */
const TYPE_KEY: Record<string, DictKey> = {
  'building permits': 'srcl.type.permits',
  '311 requests': 'srcl.type.311',
  'food inspections': 'srcl.type.inspections',
  'code violations': 'srcl.type.violations',
  'new business licenses': 'srcl.type.business',
  'special event permits': 'srcl.type.events',
  'open bids': 'srcl.type.bids',
  'property sales': 'srcl.type.sales',
  // Round 20 NEXT
  'certificates of occupancy': 'srcl.type.occupancy',
  'new sales tax permits': 'srcl.type.sales_permits',
  'pending liquor license applications': 'srcl.type.liquor_pending',
  'restaurant liquor licenses': 'srcl.type.liquor',
};

/** The label rebuilt from the dictionary for any language (used for 'en' too, by the drift test). Null when the id has no label. */
export function sourceLabelFromDict(sourceId: string, lang: Lang): string | null {
  const meta = getSourceMeta(sourceId);
  if (!meta) return null;
  const id = meta.id;
  const fixedId = id.startsWith('websearch-') ? 'websearch' : id;
  const fixed = `srcl.fixed.${fixedId}`;
  if (hasKey(fixed)) return t(lang, fixed);
  const m = /^(.+) open data: (.+)$/.exec(meta.label);
  if (m && TYPE_KEY[m[2]]) return t(lang, 'srcl.open_data', { city: m[1], type: t(lang, TYPE_KEY[m[2]]) });
  return meta.label;
}

export function sourceLabelLang(sourceId: string, lang: Lang): string | null {
  const meta = getSourceMeta(sourceId);
  if (!meta) return null;
  return lang === 'en' ? meta.label : sourceLabelFromDict(sourceId, lang);
}
