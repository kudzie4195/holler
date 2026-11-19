import type { AlertItem } from './templates';

export type Ranker = <T extends AlertItem & { id?: number }>(items: T[]) => T[];

export const BEST_COUNT = 3;

const ts = (iso: string) => {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
};

/** Highest severity first, then newest. Ties keep their input order (the sort is stable). */
export function defaultRank<T extends AlertItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (b.severity ?? 1) - (a.severity ?? 1) || ts(b.occurredAt) - ts(a.occurredAt));
}

/**
 * The member's best alerts. `rank` is the hook for integration to pass the AI ranking (lib/ai rankSignals): it receives the list
 * already in default order and returns the same items in the order to use. It may never add or invent items: anything it returns that
 * was not in the input is dropped, and items it leaves out are appended in default order. If it throws, the default order stands.
 */
export function bestAlerts<T extends AlertItem>(items: readonly T[], rank?: (items: T[]) => T[], n: number = BEST_COUNT): T[] {
  const base = defaultRank(items);
  if (!rank) return base.slice(0, n);
  try {
    const ranked = rank([...base]);
    if (!Array.isArray(ranked)) return base.slice(0, n);
    const allowed = new Set(base);
    const seen = new Set<T>();
    const out: T[] = [];
    for (const r of ranked) {
      if (allowed.has(r) && !seen.has(r)) {
        seen.add(r);
        out.push(r);
      }
    }
    for (const b of base) if (!seen.has(b)) out.push(b);
    return out.slice(0, n);
  } catch {
    return base.slice(0, n);
  }
}
