import { CATEGORIES, CATEGORY_GROUPS } from '@/lib/signals/categories';

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
export function tradeGroups(): TradeGroup[] {
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

export function tradeLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}
