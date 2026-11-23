import { Badge } from './badge';
import { CoverageNoticeLine } from './coverage-notice';
import { ButtonLink } from './button';
import { timeAgo } from './format';
import { FamilyDot } from './page-header';
import { kindFamily, sourceLabel } from './signal-meta';
import { distanceFrom, groupItems, placeLine, safeUrl, type CheckItem } from '@/lib/check/group';
import { CHECK_RADIUS_LABEL, CHECK_WINDOW_DAYS } from '@/lib/check/scope';
import { FROM_MONTHLY, FROM_YEARLY, TRIAL_DAYS, TRIAL_PHRASE } from '@/lib/plan/price-copy';
import { lowerFirst, t, type Lang } from '@/lib/i18n';
import type { CoverageState } from '@/lib/check/cells';

const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
import { localizeTitle } from '@/lib/signals/title-i18n';

function Cta({ citySlug, children, lang }: { citySlug: string | null; children?: React.ReactNode; lang: Lang }) {
  // Round 23: a Spanish visitor goes to the Spanish sign-up. The old line built '/signup?city=' for both languages, so every /es
  // conversion landed on the English page.
  const base = lang === 'en' ? '/signup' : `/${lang}/signup`;
  const href = citySlug ? `${base}?city=${encodeURIComponent(citySlug)}` : base;
  return (
    <div className="on-brand mt-10 rounded-card bg-brand px-6 py-8 md:px-8">
      {children}
      <ButtonLink href={href} variant="signal" size="lg" className="max-w-full whitespace-normal! py-3 text-center">
        {/* The line under this button names the yearly price, so the trial is in its precise form here, never the 2-month headline. */}
        {lang === 'en' ? `Get these by email. ${upperFirst(TRIAL_PHRASE)}, no card` : t(lang, 'chk.cta.btn', { trial: upperFirst(t(lang, 'land.trial_precise', { days: TRIAL_DAYS })) })}
      </ButtonLink>
      <p className="mt-3 text-sm text-on-brand-muted">
        {lang === 'en' ? `Then from ${FROM_MONTHLY} a month or ${FROM_YEARLY} a year. Holler never posts for you.` : t(lang, 'chk.cta.then', { monthly: FROM_MONTHLY, yearly: FROM_YEARLY })}
      </p>
    </div>
  );
}

export type CheckMode = 'results' | 'unreadable' | 'limited' | 'uncovered';

export function CheckResults({
  items,
  mode,
  checkedAt,
  placeLabel,
  tradeLabel,
  citySlug,
  watches,
  now,
  origin,
  coverage = null,
  coverageKnown = true,
  coverageState = 'live',
  measured = true,
  storm = false,
  lang = 'en',
}: {
  items: CheckItem[];
  mode: CheckMode;
  checkedAt: string;
  placeLabel: string;
  trade: string;
  tradeLabel: string;
  citySlug: string | null;
  /** Record types Holler really watches for this trade in this area (see lib/check/watch.ts). */
  watches: string[];
  now: number;
  /** The ZIP's own position, used to order records by distance and to show how far each one is. */
  origin?: { lat: number; lon: number };
  /** One line when a source covering this place and trade is delayed, degraded or unavailable (lib/check/coverage-notice.ts). Never shown as full coverage. */
  coverage?: string | null;
  /** false when the source states could not be read: an empty result is then worded as "what Holler has read so far", never as full coverage. */
  coverageKnown?: boolean;
  /**
   * How much Holler really has for THIS trade in THIS area (lib/check/cells.ts). 'live': the trial CTA, as before. 'limited': the CTA
   * with a line saying there are few records for this trade here yet. 'waitlist': no trial CTA at all and no "Holler is watching near X"
   * block, because the page already shows the waitlist card. Defaults to 'live' so a caller that does not set it is unchanged.
   */
  coverageState?: CoverageState;
  /**
   * Round 24 (lib/check/cells.ts coverageFor). With 'limited': `measured` false means no measured centre is near, so the line says Holler
   * has not measured this trade here (never "few records", which would be a claim about data nobody counted); `storm` true adds the one
   * sentence about storm alerts.
   */
  measured?: boolean;
  storm?: boolean;
  /** 'es' writes headings, sentences and source labels in Spanish from the dictionary. English (the default) is unchanged. */
  lang?: Lang;
}) {
  const groups = mode === 'results' ? groupItems(items, now, origin, lang) : [];
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  // Round 23. 'waitlist': the waitlist card above IS the answer, so this block shows no "Holler is watching near X" heading and no
  // trial offer. 'limited': sign-up is still offered, under a line that says in plain words how little there is.
  const hideOffer = coverageState === 'waitlist';
  const tradeWord = lang === 'en' ? tradeLabel.toLowerCase() : lowerFirst(tradeLabel);
  const limitedLine =
    coverageState !== 'limited'
      ? null
      : !measured
        ? t(lang, 'chk.unmeasured', { trade: tradeWord, place: placeLabel })
        : lang === 'en'
          ? `Few records for this trade here yet. Holler reads this area, but ${tradeLabel.toLowerCase()} work shows up only now and then. Start free and see for yourself; nothing is charged.`
          : t(lang, 'chk.limited', { trade: lowerFirst(tradeLabel) });
  const stormLine = coverageState === 'limited' && storm ? t(lang, 'chk.storm', { trade: tradeWord }) : null;
  const LimitedNote = limitedLine ? (
    <div className="mt-4 max-w-2xl rounded-card border border-line bg-surface p-4 text-muted">
      <p>{limitedLine}</p>
      {stormLine ? <p className="mt-2">{stormLine}</p> : null}
    </div>
  ) : null;

  if (shown === 0) {
    const trade = lang === 'en' ? tradeLabel.toLowerCase() : lowerFirst(tradeLabel);
    const days = CHECK_WINDOW_DAYS;
    const ago = timeAgo(checkedAt, now, lang);
    const within = t(lang, 'chk.within', { place: placeLabel });
    const intro: Record<CheckMode, string> = lang !== 'en' ? {
      results: coverage || !coverageKnown ? t(lang, 'chk.empty.so_far', { within, trade, days, ago }) : t(lang, 'chk.empty.none', { within, trade, days, ago }),
      unreadable: t(lang, 'chk.empty.unreadable'),
      limited: t(lang, 'chk.empty.limited'),
      uncovered: t(lang, 'chk.empty.uncovered', { place: placeLabel }),
    } : {
      // With a source behind, an empty list is not "nothing happened": say it is nothing in what Holler has read so far.
      results: coverage || !coverageKnown
        ? `In the records Holler has read so far, nothing within ${CHECK_RADIUS_LABEL} of ${placeLabel} matched ${trade} in the last ${CHECK_WINDOW_DAYS} days. Holler checked ${timeAgo(checkedAt, now)}.`
        : `Nothing in the public record within ${CHECK_RADIUS_LABEL} of ${placeLabel} matched ${trade} in the last ${CHECK_WINDOW_DAYS} days. Holler checked ${timeAgo(checkedAt, now)}.`,
      unreadable: 'We could not load recent records just now, so this page shows what Holler watches instead.',
      limited: 'You have run a lot of checks in a short time. Try again in a minute. Until then, this is what Holler watches.',
      uncovered: `Holler does not cover ${placeLabel} yet. We are adding places as public data sources are found.`,
    };
    // Nothing an owner could act on for this trade here. The waitlist card above has already said so and asked for an email; a
    // "Holler is watching near X" list under it would read as coverage, and a trial button would sell an empty week.
    if (hideOffer) return null;
    return (
      <section aria-labelledby="check-heading" className="mt-10">
        <h2 id="check-heading" className="text-3xl text-ink md:text-4xl">
          {mode === 'uncovered'
            ? lang === 'en' ? `Holler does not cover ${placeLabel} yet` : t(lang, 'chk.h.uncovered', { place: placeLabel })
            : lang === 'en' ? `Holler is watching near ${placeLabel} for ${trade} work` : t(lang, 'chk.h.watching', { place: placeLabel, trade })}
        </h2>
        <p className="mt-3 max-w-2xl text-muted">{intro[mode]}</p>
        {LimitedNote}
        {mode === 'results' ? <div className="mt-4 max-w-2xl empty:hidden"><CoverageNoticeLine line={coverage} /></div> : null}
        {mode !== 'uncovered' ? (
          <div className="mt-8">
            <h3 className="text-xl text-ink">{t(lang, 'chk.watch_h')}</h3>
            {watches.length > 0 ? (
              <ul className="mt-3 border-t-2 border-ink">
                {watches.map((w) => (
                  <li key={w} className="border-b border-line py-3 text-ink">
                    {w}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-muted">{t(lang, 'chk.watch_none')}</p>
            )}
            <p className="mt-4 text-muted">{t(lang, 'chk.quiet')}</p>
          </div>
        ) : null}
        {mode !== 'uncovered' ? <Cta citySlug={citySlug} lang={lang} /> : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="check-heading" className="mt-10">
      <h2 id="check-heading" className="text-3xl text-ink md:text-4xl">
        {lang === 'en'
          ? `${tradeLabel} within ${CHECK_RADIUS_LABEL} of ${placeLabel}, last 30 days`
          : t(lang, 'chk.res.h', { trade: tradeLabel, place: placeLabel, days: CHECK_WINDOW_DAYS })}
      </h2>
      <p className="mt-2 text-muted">
        {lang === 'en'
          ? `${shown < items.length ? `Showing ${shown} records: active severe alerts first, then the closest, then the newest. ` : ''}Every record links to its source. Checked ${timeAgo(checkedAt, now)}.`
          : `${shown < items.length ? t(lang, 'chk.res.showing', { shown }) : ''}${t(lang, 'chk.res.links', { ago: timeAgo(checkedAt, now, lang) })}`}
      </p>
      {LimitedNote}
      <div className="mt-4 max-w-2xl empty:hidden">
        <CoverageNoticeLine line={coverage} />
      </div>
      <div className="mt-8 flex flex-col gap-10">
        {groups.map((g) => (
          <div key={g.id}>
            <h3 className="flex items-center gap-2.5 text-xl text-ink">
              <FamilyDot family={kindFamily(g.items[0]?.kind ?? '')} />
              {g.title}
            </h3>
            <ul className="mt-3 border-t-2 border-ink">
              {g.items.map((it) => {
                const href = safeUrl(it.url);
                const miles = distanceFrom(origin, it);
                return (
                  <li key={it.id} className="border-b border-line">
                    <article className="py-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                        <Badge kind={it.kind} lang={lang} />
                        {placeLine(it, lang) ? <span>{placeLine(it, lang)}</span> : null}
                        {miles !== null ? (
                          <span className="font-mono text-xs uppercase text-ink">{lang === 'en' ? (miles < 1 ? 'under 1 mi away' : `${Math.round(miles)} mi away`) : (miles < 1 ? t(lang, 'distance.under_1') : t(lang, 'distance.mi', { n: Math.round(miles) }))}</span>
                        ) : null}
                        <time dateTime={it.occurredAt} className="font-mono text-xs uppercase tabular-nums">
                          {timeAgo(it.occurredAt, now, lang)}
                        </time>
                      </div>
                      <p className="mt-2 text-lg font-semibold leading-snug text-ink">{localizeTitle(it.title, lang, it.source)}</p>
                      <p className="text-sm text-muted">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-brand-text underline decoration-1 underline-offset-4">
                            {lang === 'en' ? `Source: ${sourceLabel(it.source)}` : t(lang, 'chk.source', { label: sourceLabel(it.source, lang) })}
                            <span className="sr-only">{t(lang, 'brief.sr_new_tab')}</span>
                          </a>
                        ) : (
                          <span className="inline-flex min-h-11 items-center">{lang === 'en' ? `Source: ${sourceLabel(it.source)}` : t(lang, 'chk.source', { label: sourceLabel(it.source, lang) })}</span>
                        )}
                      </p>
                    </article>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {hideOffer ? null : (
        <Cta citySlug={citySlug} lang={lang}>
          <p className="mb-5 font-display text-3xl text-on-brand">{t(lang, 'chk.cta.intro')}</p>
        </Cta>
      )}
    </section>
  );
}
