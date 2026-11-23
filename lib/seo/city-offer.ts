import { coverageFor, placeCoverage, type CoverageState } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { tradeLabel } from '@/lib/check/trades';
import { cityCtaLabel } from '@/lib/plan/price-copy';
import { t } from '@/lib/i18n';

/**
 * Round 24: what a city page (and its week pages) offers, from the one coverage answer (lib/check/cells.ts). The ZIP check asks
 * coverageFor for a ZIP's point; the city page asks it for the city's own point, so the two give the same answer for the same place.
 *   live      the trial offer, as before;
 *   limited   no price in the hero: it points to the free check, with a line that says how little Holler has (or that it has not
 *             measured this place yet);
 *   waitlist  no price, no trial, no link to sign-up anywhere on the page (the header button is hidden too).
 */
export interface CityPlace {
  slug: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export interface CityOffer {
  state: CoverageState;
  /** False when no measured centre is within 25 miles of the city. */
  measured: boolean;
  served: boolean;
  ctaHref: string;
  ctaLabel: string;
  sub: string;
  asideLine: string;
  asideButton: string;
  /** The header "Start free" button. False on a waitlist page. */
  showStart: boolean;
  /** Round 24 INT2: the trades that are live at the city's point (placeCoverage), for the city FAQ's "ready for" answer. */
  live: string[];
}

export function cityServed(city: Pick<CityPlace, 'lat' | 'lon' | 'state'>): boolean {
  return isServedZip({ lat: city.lat, lon: city.lon, state: city.state });
}

export function cityOffer(city: CityPlace, served: boolean = cityServed(city)): CityOffer {
  const answer = placeCoverage(city, served);
  const c = { city: city.name };
  if (answer.state === 'live') {
    return {
      state: 'live',
      measured: answer.measured,
      served,
      ctaHref: `/signup?city=${encodeURIComponent(city.slug)}`,
      ctaLabel: cityCtaLabel(city.name),
      sub: 'No card to start. Holler never posts anything for you.',
      asideLine: t('en', 'city.aside.live', c),
      asideButton: t('en', 'city.btn.live', c),
      showStart: true,
      live: answer.live,
    };
  }
  if (answer.state === 'limited') {
    return {
      state: 'limited',
      measured: answer.measured,
      served,
      ctaHref: '/check',
      ctaLabel: t('en', 'city.cta.check', c),
      sub: t('en', answer.measured ? 'city.sub.limited' : 'city.sub.unmeasured', c),
      asideLine: t('en', 'city.aside.limited', c),
      asideButton: t('en', 'city.btn.limited'),
      showStart: true,
      live: answer.live,
    };
  }
  return {
    state: 'waitlist',
    measured: answer.measured,
    served,
    ctaHref: '/check',
    ctaLabel: t('en', 'city.cta.check', c),
    sub: t('en', served ? 'city.sub.waitlist' : 'city.sub.uncovered', c),
    asideLine: t('en', 'city.aside.waitlist', c),
    asideButton: t('en', 'city.btn.waitlist', c),
    showStart: false,
    live: answer.live,
  };
}

/** The trades the launch markets, in the order the owner set (footer and home page use the same order). */
export const CITY_PAGE_TRADES: readonly string[] = ['landscaping', 'lawn-care', 'siding-gutters', 'cleaning', 'fencing', 'painting'];

export interface CityTradeRow {
  id: string;
  label: string;
  state: CoverageState;
  measured: boolean;
  storm: boolean;
  /** The short line shown for this trade. */
  phrase: string;
}

/** One row per launch trade: exactly what /check answers for that trade at the city's own point. */
export function cityTradeRows(city: Pick<CityPlace, 'lat' | 'lon'>, served: boolean): CityTradeRow[] {
  return CITY_PAGE_TRADES.map((id) => {
    const a = coverageFor(city, id, served);
    const key =
      a.state === 'live'
        ? 'city.trade.live'
        : a.state === 'waitlist'
          ? 'city.trade.waitlist'
          : a.storm
            ? 'city.trade.storm'
            : a.measured
              ? 'city.trade.limited'
              : 'city.trade.unmeasured';
    return { id, label: tradeLabel(id), state: a.state, measured: a.measured, storm: a.storm, phrase: t('en', key) };
  });
}
