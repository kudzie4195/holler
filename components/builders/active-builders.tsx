import { telHref, type ActiveBuilder } from '@/lib/builders/active';
import { t, type Lang } from '@/lib/i18n';
import { permitLabelLang } from '@/lib/signals/title-i18n';

/** The permit kinds of one company, in the member's language ("roof, HVAC"). A kind this base cannot name in the language is left out. */
export function builderKindsText(kinds: readonly string[], lang: Lang): string {
  return kinds.map((k) => permitLabelLang(k, lang)).filter((x): x is string => !!x).join(', ');
}

/** "3 permits in the last 30 days: roof, HVAC" in the member's language. */
export function builderCountLine(b: Pick<ActiveBuilder, 'permits' | 'kinds'>, windowDays: number, lang: Lang): string {
  const count = t(lang, b.permits === 1 ? 'builders.permit_one' : 'builders.permit_many', { n: b.permits });
  const window = windowDays === 1 ? t(lang, 'builders.window_day') : t(lang, 'builders.window_days', { n: windowDays });
  const kinds = builderKindsText(b.kinds, lang);
  return `${count} ${window}${kinds ? `: ${kinds}` : ''}`;
}

/**
 * "Who's building near you" (round 19, ported from origin/r10-integrate and adapted): companies with permits in the window the loader
 * read (windowDays). Businesses only, from public permit records; no address and no person. Hidden entirely when there are none.
 * Server-rendered, English and Spanish through lib/i18n. A read-only panel: it is not a card and sends nothing.
 */
export function ActiveBuilders({ builders, windowDays, lang = 'en' }: { builders: ActiveBuilder[]; windowDays: number; lang?: Lang }) {
  if (builders.length === 0) return null;
  return (
    <section aria-labelledby="builders-h" className="mt-6 rounded-card border border-line bg-surface p-5 md:p-6">
      <h2 id="builders-h" className="h-plain text-2xl text-ink">{t(lang, 'builders.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t(lang, 'builders.note')}</p>
      <ul className="mt-4 divide-y divide-line">
        {builders.map((b) => {
          const tel = telHref(b.phone);
          return (
            <li key={b.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
              <div className="min-w-0">
                <p className="break-words font-medium text-ink">{b.name}</p>
                <p className="text-sm text-muted">{builderCountLine(b, windowDays, lang)}</p>
                {b.relation === 'same-trade' ? <p className="mt-1 text-xs font-medium text-brand-text">{t(lang, 'builders.same_trade')}</p> : null}
              </div>
              {b.phone && tel ? (
                <a href={`tel:${tel}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline md:min-h-9">
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
