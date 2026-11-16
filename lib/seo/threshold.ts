/** A city page is indexable only when it has at least this many signals in the window. */
export const INDEX_MIN_SIGNALS = 5;
/** Days of history shown on public pages and counted for the index threshold. */
export const WINDOW_DAYS = 60;

export function isIndexable(signalCount: number): boolean {
  return Number.isFinite(signalCount) && signalCount >= INDEX_MIN_SIGNALS;
}
