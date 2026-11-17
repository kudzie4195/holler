import { CATEGORIES } from '@/lib/signals/categories';

/**
 * Display labels come from CATEGORIES (lib/signals/categories.ts), read at call time.
 * There is no private list here. Unknown ids (rows tagged by a retired category) fall back to a prettified id.
 */
export function tradeLabel(id: string): string {
  const hit = CATEGORIES.find((c) => c.id === id);
  if (hit) return hit.label;
  const s = id.replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
