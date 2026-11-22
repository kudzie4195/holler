import type { ActiveBuilder } from '@/lib/builders/active';

const RELATION_LABEL: Partial<Record<ActiveBuilder['relation'], string>> = {
  'same-trade': 'Works in your trade',
  builder: 'Builder: may hire subs',
};

/** "Who's building near you": companies with permits in the last 30 days. Hidden entirely when there are none. Server-rendered. */
export function ActiveBuilders({ builders }: { builders: ActiveBuilder[] }) {
  if (builders.length === 0) return null;
  return (
    <section aria-labelledby="builders-h" className="mt-6 rounded-card border border-line bg-surface p-5 md:p-6">
      <h2 id="builders-h" className="h-plain text-2xl text-ink">Who&apos;s building near you</h2>
      <p className="mt-1 text-sm text-muted">From public permit records. Companies only.</p>
      <ul className="mt-4 divide-y divide-line">
        {builders.map((b) => {
          const label = RELATION_LABEL[b.relation];
          return (
            <li key={b.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">{b.name}</p>
                <p className="text-sm text-muted">
                  <span className="tabular-nums">{b.permits}</span> {b.permits === 1 ? 'permit' : 'permits'} in 30 days
                  {b.kinds.length > 0 ? `: ${b.kinds.join(', ')}` : ''}
                </p>
                {label ? <p className="mt-1 text-xs font-medium text-brand-text">{label}</p> : null}
              </div>
              {b.phone ? (
                <a href={`tel:${b.phone.replace(/[^\d+]/g, '')}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline md:min-h-9">
                  {b.phone}
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
