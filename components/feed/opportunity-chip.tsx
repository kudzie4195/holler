import type { OpportunityLabel } from '@/lib/signals/lead-rules';
import { chipLabel, deadlineLineLang } from '@/lib/signals/lead-i18n';
import { t, type Lang } from '@/lib/i18n';
import type { AlertHold } from '@/lib/signals/alert-gate';

const CHIP_CLASS: Record<OpportunityLabel, string> = {
  act_now: 'border-brand bg-brand text-on-brand',
  coming_soon: 'border-line-strong bg-surface text-ink',
  market_insight: 'border-line bg-sand text-muted',
  context: 'border-line bg-sand text-muted',
};

/**
 * The opportunity label chip ("Act now", "Coming soon", "Market insight") and, for Act Now, the deadline line: the date the record
 * publishes, or "No deadline published". Context is never shown as an alert, so it renders nothing. Pure view of lib/signals/lead-rules.
 */
export function OpportunityChip({ label, deadline, lang = 'en', hold, isLicense = false }: { label?: OpportunityLabel | null; deadline?: string | null; lang?: Lang; hold?: AlertHold | null; isLicense?: boolean }) {
  if (!label || label === 'context') return null;
  // A feed-only card (round 18): it was not sent as an alert, so it carries no alert chip. The chip and one line say why.
  if (hold) {
    return (
      <div className="mt-3 flex flex-col gap-1">
        <span
          data-testid="hold-chip"
          className={`inline-flex w-fit items-center rounded-control border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${CHIP_CLASS.market_insight}`}
        >
          {t(lang, hold === 'below_min' ? 'hold.below_min.chip' : 'hold.background.chip')}
        </span>
        <span data-testid="hold-note" className="text-sm text-muted">
          {t(lang, hold === 'background' && isLicense ? 'hold.background.license.note' : `hold.${hold}.note`)}
        </span>
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span
        data-testid="opportunity-chip"
        className={`inline-flex items-center rounded-control border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${CHIP_CLASS[label]}`}
      >
        {chipLabel(label, lang)}
      </span>
      {label === 'act_now' ? (
        <span data-testid="deadline-line" className="text-sm font-medium text-ink">
          {deadlineLineLang(deadline, lang)}
        </span>
      ) : null}
    </div>
  );
}
