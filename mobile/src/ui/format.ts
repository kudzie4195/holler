// Dates and small text helpers. en-US throughout (the product is US only).

const DAY = 86_400_000;

export function shortDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Today", "Yesterday", "3 days ago", then a date. */
export function relativeDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(new Date(t))) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return shortDate(iso, now);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function cleanZip(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 5);
}

/**
 * The short label beside the record tag. The server sends `intent.label` from lib/signals/intent.ts ("Demand sign", "Spending activity");
 * the app shows plainer words, chosen by the intent key, so trade users read what the record means for them. Unknown keys keep the
 * server's label.
 */
const INTENT_LABEL_BY_KEY: Record<string, string> = {
  demand: 'Might need work',
  spending: 'Money being spent',
  'open-bid': 'Money being spent',
  'new-business': 'Money being spent',
};

export function intentLabel(intent: { key: string; label: string }): string {
  return INTENT_LABEL_BY_KEY[intent.key] ?? intent.label;
}
