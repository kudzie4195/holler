import { Badge } from './badge';
import { CoverageNoticeLine } from './coverage-notice';
import { ButtonLink } from './button';
import { timeAgo } from './format';
import { FamilyDot } from './page-header';
import { kindFamily, sourceLabel } from './signal-meta';
import { distanceFrom, groupItems, placeLine, safeUrl, type CheckItem } from '@/lib/check/group';
import { CHECK_LIST_RADIUS_LABEL, CHECK_WINDOW_DAYS } from '@/lib/check/scope';
import { FROM_MONTHLY, FROM_YEARLY, TRIAL_DAYS, TRIAL_PHRASE } from '@/lib/plan/price-copy';
import { lowerFirst, t, type Lang } from '@/lib/i18n';
import type { CoverageState } from '@/lib/check/cells';
import type { CheckVerdict } from '@/lib/check/verdict';

const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
import { localizeTitle } from '@/lib/signals/title-i18n';
import { withoutZeroCity } from '@/lib/email/templates';

/**
 * Round 24 FIX2 (review D1): the button promises email only when what it sits under is emailed. 'email': "Get alerts by email" (an empty
 * list, or a list with at least one record marked "Emailed as an alert"). 'trial': the trial alone, for a list where no record would be
 * emailed (the records are on the matches page only).
 */
function Cta({ citySlug, children, lang, promise = 'email', cityLink = null }: { citySlug: string | null; children?: React.ReactNode; lang: Lang; promise?: 'email' | 'trial'; cityLink?: CityLink | null }) {
  // Round 23: a Spanish visitor goes to the Spanish sign-up. The old line built '/signup?city=' for both languages, so every /es
  // conversion landed on the English page.
  const base = lang === 'en' ? '/signup' : `/${lang}/signup`;
  const href = citySlug ? `${base}?city=${encodeURIComponent(citySlug)}` : base;
  const trialEs = t(lang, 'land.trial_precise', { days: TRIAL_DAYS });
  const label =
    promise === 'email'
      ? lang === 'en' ? `Get alerts by email. ${upperFirst(TRIAL_PHRASE)}, no card` : t(lang, 'chk.cta.btn', { trial: upperFirst(trialEs) })
      : lang === 'en' ? `Start your ${TRIAL_PHRASE}, no card` : t(lang, 'chk.cta.btn_trial', { trial: trialEs });
  return (
    <div className="on-brand mt-10 rounded-card bg-brand px-6 py-8 md:px-8">
      {children}
      <ButtonLink href={href} variant="signal" size="lg" className="max-w-full whitespace-normal! py-3 text-center">
        {/* The line under this button names the yearly price, so the trial is in its precise form here, never the 2-month headline. */}
        {label}
      </ButtonLink>
      <p className="mt-3 text-sm text-on-brand-muted">
        {lang === 'en' ? `Then from ${FROM_MONTHLY} a month or ${FROM_YEARLY} a year. Holler never posts for you.` : t(lang, 'chk.cta.then', { monthly: FROM_MONTHLY, yearly: FROM_YEARLY })}
      </p>
      {/* Round 25: on a limited cell, the free city records page sits next to the trial offer, so a visitor can look before signing up. */}
      {cityLink ? (
        <p className="mt-4">
          <a href={cityLink.href} className="inline-flex min-h-11 items-center font-semibold text-on-brand underline decoration-1 underline-offset-4" data-testid="check-city-link">
            {cityLink.label}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/** Round 25: the free city records page (/local/<state>/<city>), offered next to the trial on a limited cell. */
export interface CityLink {
  href: string;
  label: string;
}

/** Round 25: the verdict and the counted sentence, above the results (lib/check/verdict.ts). */
function VerdictBlock({ verdict }: { verdict: CheckVerdict | null }) {
  if (!verdict) return null;
  return (
    <div className="mb-8 max-w-2xl rounded-card border-2 border-ink bg-surface p-5" data-testid="check-verdict" data-verdict={verdict.state}>
      <p className="font-display text-3xl text-ink">{verdict.head}</p>
      {verdict.count ? <p className="mt-2 text-lg text-ink" data-testid="check-verdict-count">{verdict.count}</p> : null}
    </div>
  );
}

/** Round 25: "What Holler reads near you", the local feeds near the ZIP (lib/check/coverage.ts localSourcesNear), shown whenever there are results. */
function ReadsNear({ reads, lang }: { reads: { labels: string[]; note: string } | null; lang: Lang }) {
  if (!reads || reads.labels.length === 0) return null;
  return (
    <div className="mt-10" data-testid="check-reads">
      <h3 className="text-xl text-ink">{t(lang, 'chk.reads_h')}</h3>
      <ul className="mt-3 border-t-2 border-ink">
        {reads.labels.map((l) => (
          <li key={l} className="border-b border-line py-3 text-ink">
            {l}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-muted">{reads.note}</p>
    </div>
  );
}

/**
 * The counted sentence above the list: from the listed rows only (each row's delivery), never an estimate. R25 check fix (review R25CHECK
 * P1-1): it says so ("Of the 8 shown here, ..."), so it can never read as a second answer next to the verdict's count of every record.
 */
export function deliveryCountLine(listed: readonly CheckItem[], lang: Lang): string | null {
  const marked = listed.filter((i) => i.delivery === 'email' || i.delivery === 'feed');
  if (marked.length === 0 || marked.length !== listed.length) return null;
  const n = marked.filter((i) => i.delivery === 'email').length;
  const total = marked.length;
  if (total === 1) return t(lang, n === 1 ? 'chk.shown.one_email' : 'chk.shown.one_feed');
  if (n === 0) return t(lang, 'chk.shown.none', { total });
  if (n === total) return t(lang, 'chk.shown.all', { total });
  return t(lang, n === 1 ? 'chk.shown.some_one' : 'chk.shown.some', { n, total });
}

/** The plain mark under each listed record: emailed as an alert, or on the matches page (no email). */
function DeliveryMark({ delivery, lang }: { delivery?: 'email' | 'feed'; lang: Lang }) {
  if (delivery !== 'email' && delivery !== 'feed') return null;
  return (
    <p className={`mt-1 text-sm font-semibold ${delivery === 'email' ? 'text-brand-text' : 'text-muted'}`} data-delivery={delivery}>
      {t(lang, delivery === 'email' ? 'chk.mark.email' : 'chk.mark.feed')}
    </p>
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
  verdict = null,
  cityLink = null,
  reads = null,
  emailedTotal = null,
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
  /** Round 25: the verdict and counted sentence above the results (lib/check/verdict.ts). Null: no block (waitlist, or no count known). */
  verdict?: CheckVerdict | null;
  /** Round 25: the free city records page, shown next to the trial offer on a limited cell only. */
  cityLink?: CityLink | null;
  /** Round 25: the local feeds Holler reads near the ZIP, with the line under them. Shown whenever the page has an answer. */
  reads?: { labels: string[]; note: string } | null;
  /**
   * R25 check fix (review R25CHECK P1-1): the verdict's count of every record a member here would be emailed (lib/check/delivery.ts
   * alertTotals). When given, the offer promises email from this count, not from the listed rows. Null: the listed rows decide, as before.
   */
  emailedTotal?: number | null;
}) {
  const groups = mode === 'results' ? groupItems(items, now, origin, lang) : [];
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const listed = groups.flatMap((g) => g.items);
  const countLine = deliveryCountLine(listed, lang);
  // The sentence above the button and the button promise email only when a record would be emailed (review D1). R25 check fix (review
  // R25CHECK P1-1): with the verdict's count given, that count decides, so the offer can never say "no email" under "15 alerts".
  const anyEmailed = typeof emailedTotal === 'number' ? emailedTotal > 0 : listed.some((i) => i.delivery === 'email');
  const promise: 'email' | 'trial' = listed.length > 0 && listed.every((i) => i.delivery === 'email' || i.delivery === 'feed') && !anyEmailed ? 'trial' : 'email';
  // Round 23. 'waitlist': the waitlist card above IS the answer, so this block shows no "Holler is watching near X" heading and no
  // trial offer. 'limited': sign-up is still offered, under a line that says in plain words how little there is.
  const hideOffer = coverageState === 'waitlist';
  const limitedCityLink = coverageState === 'limited' ? cityLink : null;
  const tradeWord = lang === 'en' ? tradeLabel.toLowerCase() : lowerFirst(tradeLabel);
  const limitedLine =
    coverageState !== 'limited'
      ? null
      : !measured
        ? t(lang, 'chk.unmeasured', { trade: tradeWord, place: placeLabel })
        : lang === 'en'
          ? `Few ${tradeLabel.toLowerCase()} records near here so far, and some weeks bring none. The trial is free and needs no card, so you can judge it before you pay.`
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
        ? `In the records Holler has read so far, nothing within ${CHECK_LIST_RADIUS_LABEL} of ${placeLabel} matched ${trade} in the last ${CHECK_WINDOW_DAYS} days. Holler checked ${timeAgo(checkedAt, now)}.`
        : `Nothing in the public record within ${CHECK_LIST_RADIUS_LABEL} of ${placeLabel} matched ${trade} in the last ${CHECK_WINDOW_DAYS} days. Holler checked ${timeAgo(checkedAt, now)}.`,
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
        {mode === 'results' ? <div className="mt-6"><VerdictBlock verdict={verdict} /></div> : null}
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
        {mode === 'results' ? <ReadsNear reads={reads} lang={lang} /> : null}
        {mode !== 'uncovered' ? <Cta citySlug={citySlug} lang={lang} cityLink={limitedCityLink} /> : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="check-heading" className="mt-10">
      <VerdictBlock verdict={hideOffer ? null : verdict} />
      <h2 id="check-heading" className="text-3xl text-ink md:text-4xl">
        {lang === 'en'
          ? `${tradeLabel} within ${CHECK_LIST_RADIUS_LABEL} of ${placeLabel}, last ${CHECK_WINDOW_DAYS} days`
          : t(lang, 'chk.res.h', { trade: tradeLabel, place: placeLabel, days: CHECK_WINDOW_DAYS })}
      </h2>
      <p className="mt-2 text-muted">
        {lang === 'en'
          ? `${shown < items.length ? `Showing ${shown} records: active severe alerts first, then the closest, then the newest. ` : ''}Every record links to its public source. Checked ${timeAgo(checkedAt, now)}.`
          : `${shown < items.length ? t(lang, 'chk.res.showing', { shown }) : ''}${t(lang, 'chk.res.links', { ago: timeAgo(checkedAt, now, lang) })}`}
      </p>
      {countLine ? (
        <p className="mt-3 max-w-2xl font-semibold text-ink" data-testid="delivery-count">
          {countLine}
        </p>
      ) : null}
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
                      <p className="mt-2 text-lg font-semibold leading-snug text-ink">{withoutZeroCity(localizeTitle(it.title, lang, it.source))}</p>
                      <DeliveryMark delivery={it.delivery} lang={lang} />
                      <p className="text-sm text-muted">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-brand-text underline decoration-1 underline-offset-4">
                            {lang === 'en' ? `Public source: ${sourceLabel(it.source)}` : t(lang, 'chk.source', { label: sourceLabel(it.source, lang) })}
                            <span className="sr-only">{t(lang, 'brief.sr_new_tab')}</span>
                          </a>
                        ) : (
                          <span className="inline-flex min-h-11 items-center">{lang === 'en' ? `Public source: ${sourceLabel(it.source)}` : t(lang, 'chk.source', { label: sourceLabel(it.source, lang) })}</span>
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
      {hideOffer ? null : <ReadsNear reads={reads} lang={lang} />}
      {hideOffer ? null : (
        <Cta citySlug={citySlug} lang={lang} promise={promise} cityLink={limitedCityLink}>
          <p className="mb-5 font-display text-3xl text-on-brand">{t(lang, promise === 'trial' ? 'chk.cta.intro_feed' : 'chk.cta.intro')}</p>
        </Cta>
      )}
    </section>
  );
}
