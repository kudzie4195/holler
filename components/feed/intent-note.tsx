import { INTENT_LABEL, intentLine, intentOf } from '@/lib/signals/intent';

/** Intent label and the one plain line under it: what is confirmed and what is not. */
export function IntentNote({ item }: { item: { kind: string; source: string; subtype?: string | null } }) {
  const sig = { kind: item.kind, subtype: item.subtype, source: item.source };
  const intent = intentOf(sig);
  return (
    <div className="mt-3">
      <p className="text-sm font-semibold text-ink">{INTENT_LABEL[intent]}</p>
      <p className="text-sm text-muted">{intentLine(sig)}</p>
    </div>
  );
}
