/** Trade chips grouped by category `group`. Pure, so it is tested without React. */
export interface ChipCategory {
  id: string;
  label: string;
  /** From CATEGORIES. Missing or unknown values land in 'other'; when no category has one, everything is one untitled group. */
  group?: string;
}

export interface ChipGroup {
  key: string;
  /** null when there is only one group, so no heading is shown. */
  label: string | null;
  items: ChipCategory[];
}

/** Display order and heading for each known group. */
export const GROUP_ORDER: { key: string; label: string }[] = [
  { key: 'home', label: 'Home and property' },
  { key: 'storm', label: 'Storm and damage' },
  { key: 'auto', label: 'Auto' },
  { key: 'business', label: 'Business' },
  { key: 'food-events', label: 'Food and events' },
  { key: 'other', label: 'Other' },
];

const KNOWN = new Set(GROUP_ORDER.map((g) => g.key));

export function groupCategories(categories: ChipCategory[]): ChipGroup[] {
  if (!categories.some((c) => typeof c.group === 'string' && c.group)) {
    return [{ key: 'all', label: null, items: categories }];
  }
  const buckets = new Map<string, ChipCategory[]>();
  for (const c of categories) {
    const key = c.group && KNOWN.has(c.group) ? c.group : 'other';
    const list = buckets.get(key);
    if (list) list.push(c);
    else buckets.set(key, [c]);
  }
  const out: ChipGroup[] = [];
  for (const g of GROUP_ORDER) {
    const items = buckets.get(g.key);
    if (items?.length) out.push({ key: g.key, label: g.label, items });
  }
  // One group after bucketing (for example everything is 'other'): no heading needed.
  if (out.length === 1) out[0] = { ...out[0], label: null };
  return out;
}
