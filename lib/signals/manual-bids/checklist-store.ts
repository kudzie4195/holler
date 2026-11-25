/**
 * Browser-only memory of the owner's weekly check list (round 33). Client-safe; every storage call is wrapped in try/catch (private
 * windows, blocked or full storage), so a failure only means the ticks do not persist. `store` is injectable for tests.
 */
export const CHECKLIST_PREFIX = 'holler.manualBids.checked.';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The key for the week holding `d`: the local Monday as YYYY-MM-DD. */
export function checklistKey(d: Date): string {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (day.getDay() + 6) % 7; // Monday = 0
  day.setDate(day.getDate() - back);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${CHECKLIST_PREFIX}${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`;
}

/** The stored text for a week, or null (nothing stored, or storage blocked). */
export function readCheckedRaw(key: string, store: Store | null = defaultStore()): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Only `true` entries of a stored object survive; anything unreadable is an empty list. */
export function parseChecked(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x === true).map(([k]) => [k, true]));
  } catch {
    return {};
  }
}

export function readChecked(key: string, store: Store | null = defaultStore()): Record<string, boolean> {
  return parseChecked(readCheckedRaw(key, store));
}

export function writeChecked(key: string, checked: Record<string, boolean>, store: Store | null = defaultStore()): boolean {
  try {
    if (!store) return false;
    const only = Object.fromEntries(Object.entries(checked).filter(([, x]) => x));
    store.setItem(key, JSON.stringify(only));
    return true;
  } catch {
    return false;
  }
}
