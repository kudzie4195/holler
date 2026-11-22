import { INTENT_LABEL, intentLine, intentOf } from '@/lib/signals/intent';
import type { OpportunityDto } from '@/lib/signals/member-opportunity';

/** Chip colors per label: Act now stands out (signal), Coming soon is the sage tone, Market insight is quiet. */
const CHIP: Record<OpportunityDto['label'], string> = {
  act: 'border-ink bg-signal text-ink',
  soon: 'border-sage-mark bg-sage text-sage-ink',
  intel: 'border-line-strong bg-surface text-ink',
  context: 'border-line bg-surface text-muted',
};

/**
 * The record's opportunity for this member (lib/signals/member-opportunity.ts): the label as a chip, why it matters to their trade,
 * one next step and what is not known. A card without an opportunity (an older caller) falls back to the intent label and line.
 */
export function IntentNote({ item }: { item: { kind: string; source: string; subtype?: string | null; opportunity?: OpportunityDto | null } }) {
  const o = item.opportunity;
  if (o) {
    return (
      <div className="mt-3" data-testid="opportunity-note" data-opportunity={o.label}>
        <span className={`inline-flex items-center rounded-control border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${CHIP[o.label]}`}>
          {o.labelText}
        </span>
        <p className="mt-2 text-sm text-ink">{o.why}</p>
        <p className="mt-1 text-sm text-ink">
          <span className="font-semibold">Next step: </span>
          {o.next}
        </p>
        <p className="mt-1 text-sm text-muted">
          <span className="font-semibold">Not known: </span>
          {o.uncertain}
        </p>
      </div>
    );
  }
  const sig = { kind: item.kind, subtype: item.subtype, source: item.source };
  const intent = intentOf(sig);
  return (
    <div className="mt-3">
      <p className="text-sm font-semibold text-ink">{INTENT_LABEL[intent]}</p>
      <p className="text-sm text-muted">{intentLine(sig)}</p>
    </div>
  );
}

/** Same component under the name the opportunity work uses. */
export const OpportunityNote = IntentNote;
