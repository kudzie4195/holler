import { intentLabel, intentLine } from '@/lib/signals/intent';
import type { OpportunityLabel } from '@/lib/signals/lead-rules';
import { OpportunityChip } from './opportunity-chip';

/**
 * The opportunity chip with its deadline line (Act Now), then the intent label and the one plain line under it: what is confirmed and
 * what is not.
 */
export function IntentNote({ item }: { item: { kind: string; source: string; subtype?: string | null; label?: OpportunityLabel | null; deadline?: string | null } }) {
  const sig = { kind: item.kind, subtype: item.subtype, source: item.source };
  return (
    <>
      <OpportunityChip label={item.label} deadline={item.deadline} />
      <div className="mt-3">
        <p className="text-sm font-semibold text-ink">{intentLabel(sig)}</p>
        <p className="text-sm text-muted">{intentLine(sig)}</p>
      </div>
    </>
  );
}
