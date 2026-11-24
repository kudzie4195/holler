import { CATEGORIES, CATEGORY_GROUPS } from '@/lib/signals/categories';
import { hasKey, lowerFirst, t, type Lang } from '@/lib/i18n';
import { PRESSURE_WASHING_ID } from '@/lib/plan/composite-trades';

export interface TradeOption {
  id: string;
  label: string;
}
export interface TradeGroup {
  label: string | null;
  options: TradeOption[];
}

const GROUP_LABELS: Record<string, string> = Object.fromEntries(CATEGORY_GROUPS.map((g) => [g.id, g.label]));
const GROUP_ORDER: string[] = CATEGORY_GROUPS.map((g) => g.id);

/** Reads CATEGORIES at runtime. Grouped by `group` when entries have it, otherwise one flat list. */
export function tradeGroups(lang: Lang = 'en'): TradeGroup[] {
  if (lang !== 'en') return tradeGroupsLang(lang);
  const cats = CATEGORIES as unknown as { id: string; label: string; group?: string }[];
  if (!cats.some((c) => typeof c.group === 'string')) {
    return [{ label: null, options: cats.map((c) => ({ id: c.id, label: c.label })) }];
  }
  const byGroup = new Map<string, TradeOption[]>();
  for (const c of cats) {
    const g = c.group ?? 'other';
    const list = byGroup.get(g) ?? [];
    list.push({ id: c.id, label: c.label });
    byGroup.set(g, list);
  }
  const ids = [...GROUP_ORDER.filter((g) => byGroup.has(g)), ...[...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g))];
  return ids.map((g) => ({ label: GROUP_LABELS[g] ?? g, options: byGroup.get(g)! }));
}

export function tradeLabel(id: string, lang: Lang = 'en'): string {
  // Round 25: the composite "Pressure washing" chip (lib/plan/composite-trades.ts) is not a category; its label is in the dictionary.
  if (id === PRESSURE_WASHING_ID) return t(lang, 'chk.trade.pressure_washing');
  if (lang !== 'en' && hasKey(`trade.${id}`)) return t(lang, `trade.${id}` as 'trade.roofing');
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/**
 * A trade label inside a sentence: first letter lower case, the rest as it is, so an acronym keeps its capitals ("heating and air (HVAC)",
 * "bookkeeping, payroll and IT setup"); a label that starts with an acronym is left whole. R25 check fix (review R25CHECK P3-4): the
 * English /check sentences used toLowerCase() and printed "(hvac)". Same rule as the emails (lib/email/templates.ts tradeWords).
 */
export function tradeInSentence(label: string): string {
  return /^\p{Lu}{2}/u.test(label) ? label : lowerFirst(label);
}

/** Spanish trade and group labels from the dictionary. An id with no Spanish label keeps its English one (tests/i18n checks every id has one). */
function tradeGroupsLang(lang: Lang): TradeGroup[] {
  const base = tradeGroups('en');
  const groupKey = Object.fromEntries(CATEGORY_GROUPS.map((g) => [g.label, g.id]));
  return base.map((g) => ({
    label: g.label === null ? null : (hasKey(`group.${groupKey[g.label] ?? g.label}`) ? t(lang, `group.${groupKey[g.label] ?? g.label}` as 'group.home') : g.label),
    options: g.options.map((o) => ({ id: o.id, label: tradeLabel(o.id, lang) })),
  }));
}
