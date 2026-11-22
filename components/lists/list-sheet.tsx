import { localizeDate, t, type Lang } from '@/lib/i18n';
import { groupEntries, MAX_LIST_ADDRESSES, type ListEntry } from '@/lib/lists/core';
import { permitLabelLang } from '@/lib/signals/title-i18n';

/**
 * One address list, as a clean printable sheet (round 18, unit LISTS). The same markup is the screen view and the print view: the app header
 * and every control carry print:hidden, so a printed page is the heading, the notes and the table. Renders only the fields of ListEntry
 * (address, ZIP, city, permit type, date, source link, miles): there is no other field to render. Server-safe (no hooks).
 */

/** "2026-11-20" gives "Nov 20, 2026" (English) or "20 nov 2026" (Spanish). */
export function listDate(iso: string, lang: Lang): string {
  const ms = Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(ms)) return iso;
  const en = new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return localizeDate(en, lang) ?? en;
}

/** The permit type for the table: Holler's own label in the member's language, "Permit" when the title names none. */
export function permitTypeText(type: string | null, lang: Lang): string {
  if (!type) return t(lang, 'lists.permit_plain');
  const out = lang === 'en' ? type : (permitLabelLang(type, lang) ?? type);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export interface ListSheetProps {
  lang: Lang;
  heading: string;
  /** Plain notes under the heading (radius, approximate points, what a permit does not mean). */
  notes: string[];
  /** Storm lists: the damage line in English and Spanish, always both. */
  damageLines?: { en: string; es: string } | null;
  entries: ListEntry[];
  total: number;
  capped: boolean;
  partial?: boolean;
  hasApprox?: boolean;
  showDistance?: boolean;
  /** Buttons and links above the table (print, door hanger); hidden in print. */
  actions?: React.ReactNode;
}

export function ListSheet({ lang, heading, notes, damageLines, entries, total, capped, partial, hasApprox, showDistance, actions }: ListSheetProps) {
  const groups = groupEntries(entries);
  return (
    <article className="text-ink" data-testid="list-sheet">
      <h1 className="text-4xl text-ink print:text-2xl">{heading}</h1>
      {damageLines ? (
        <div className="mt-3 rounded-control border border-line-strong px-4 py-3 text-sm font-semibold" data-testid="damage-lines">
          <p lang="en">{damageLines.en}</p>
          <p lang="es">{damageLines.es}</p>
        </div>
      ) : null}
      {notes.length > 0 ? (
        <div className="mt-3 space-y-1 text-sm text-muted">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      ) : null}
      {actions ? <div className="mt-4 flex flex-wrap items-center gap-3 print:hidden">{actions}</div> : null}
      {capped ? <p className="mt-3 text-sm text-muted">{t(lang, 'lists.capped', { max: MAX_LIST_ADDRESSES, total })}</p> : null}
      {partial ? <p className="mt-1 text-sm text-muted">{t(lang, 'lists.partial')}</p> : null}
      {hasApprox ? <p className="mt-1 text-sm text-muted">{t(lang, 'lists.approx_note')}</p> : null}

      {entries.length === 0 ? (
        <p className="mt-6 rounded-card border border-dashed border-line bg-surface px-6 py-8 text-center text-muted" data-testid="list-empty">
          {t(lang, 'lists.empty')}
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((g) => (
            // No break-inside-avoid on the group: a long ZIP group starts on page 1 and continues (review redo 1, defect 3).
            <section key={`${g.kind}:${g.key}`}>
              <h2 className="h-plain break-after-avoid text-lg text-ink">
                {g.kind === 'zip' ? t(lang, 'lists.group.zip', { zip: g.key }) : t(lang, 'lists.group.nozip')}
              </h2>
              {/* Below 640 px each row stacks (address on its own line, then type, date, miles, link), so a phone never scrolls sideways. */}
              <table className="mt-2 w-full border-collapse text-left text-sm max-sm:block">
                <thead className="max-sm:hidden print:table-header-group">
                  {damageLines ? (
                    // Print only: the browser repeats the table header on every printed page, so every page with addresses carries the line.
                    <tr className="hidden print:table-row" data-testid="print-damage-row">
                      <th colSpan={showDistance ? 4 : 3} className="pb-1 text-left text-xs font-semibold">
                        <span lang="en">{damageLines.en}</span> <span lang="es">{damageLines.es}</span>
                      </th>
                    </tr>
                  ) : null}
                  <tr className="border-b border-line-strong">
                    <th scope="col" className="py-1.5 pr-3 font-semibold">{t(lang, 'lists.col.address')}</th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">{t(lang, 'lists.col.permit')}</th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">{t(lang, 'lists.col.date')}</th>
                    {showDistance ? <th scope="col" className="py-1.5 pr-3 font-semibold">{t(lang, 'lists.col.distance')}</th> : null}
                    <th scope="col" className="py-1.5 font-semibold print:hidden">{t(lang, 'lists.col.source')}</th>
                  </tr>
                </thead>
                <tbody className="max-sm:block">
                  {g.entries.map((e) => (
                    <tr
                      key={`${e.address}|${e.zip ?? e.city ?? ''}`}
                      className="break-inside-avoid border-b border-line align-top max-sm:flex max-sm:flex-wrap max-sm:items-baseline max-sm:gap-x-3 max-sm:py-2"
                    >
                      <td className="py-1.5 pr-3 font-medium max-sm:w-full max-sm:p-0 max-sm:break-words">
                        {e.address}
                        {e.city ? <span className="text-muted">{`, ${e.city}${e.state ? `, ${e.state}` : ''}`}</span> : null}
                      </td>
                      <td className="py-1.5 pr-3 max-sm:p-0">{permitTypeText(e.permitType, lang)}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs tabular-nums max-sm:p-0">{listDate(e.date, lang)}</td>
                      {showDistance ? (
                        <td className="py-1.5 pr-3 font-mono text-xs tabular-nums max-sm:p-0">
                          {e.distanceMi === null ? '' : e.distanceMi.toFixed(1)}
                          {e.distanceMi === null ? null : <span className="sm:hidden"> mi</span>}
                        </td>
                      ) : null}
                      <td className="py-1.5 max-sm:p-0 print:hidden">
                        {e.url ? (
                          <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-brand-text underline">
                            {t(lang, 'lists.public_source')}
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
      <p className="mt-6 text-xs text-muted">{t(lang, 'lists.footer')}</p>
    </article>
  );
}
