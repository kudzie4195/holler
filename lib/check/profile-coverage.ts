import { coverageFor, type Coverage } from './cells';
import { isServedZip } from './coverage';
import { tradeLabel } from './trades';
import { lookupZip } from '@/lib/geo';
import { lowerFirst, t, type Lang } from '@/lib/i18n';

/**
 * Round 24 FIX2 (review D2): the /check answer for each trade a member picks, at the member's ZIP, for onboarding and Settings. The same
 * function the ZIP check asks (coverageFor with isServedZip), and the same one-line answers it prints. Nothing is refused here or on the
 * server: when every picked trade is waitlist the form shows a calm notice with "Join the list" first and "Continue anyway" second.
 * Warn and allow (not refuse) is an OWNER decision recorded in the round 24 FIX2 report.
 */
export type TradeAnswer = 'live' | 'limited' | 'unmeasured' | 'storm' | 'waitlist';

export interface TradeCoverageLine {
  trade: string;
  answer: TradeAnswer;
  /** Short status word ("Live", "Waitlist"). */
  tag: string;
  /** The one-line answer, as /check words it. */
  text: string;
}

export interface ProfileCoverage {
  zip: string;
  /** "City, ST" of the ZIP. */
  place: string;
  lines: TradeCoverageLine[];
  /** Every picked trade is waitlist at this ZIP. */
  allWaitlist: boolean;
  /** The ZIP check for the first waitlist trade, where the waitlist card is (EN /check, ES /es/check). Null when nothing is waitlist. */
  joinHref: string | null;
}

/** The kind of answer, from the one coverage answer. */
export function tradeAnswerOf(c: Coverage): TradeAnswer {
  if (c.state === 'live') return 'live';
  if (c.state === 'waitlist') return 'waitlist';
  if (c.storm) return 'storm';
  return c.measured ? 'limited' : 'unmeasured';
}

const TRADE_RE = /^[a-z0-9-]{1,40}$/;

/** The coverage lines for a ZIP and the picked trades, or null when the ZIP is unknown or nothing is picked. */
export function profileCoverage(zip: string, trades: readonly string[], lang: Lang = 'en'): ProfileCoverage | null {
  const place = /^\d{5}$/.test(zip) ? lookupZip(zip) : null;
  const picked = [...new Set(trades.filter((x) => typeof x === 'string' && TRADE_RE.test(x)))].slice(0, 12);
  if (!place || picked.length === 0) return null;
  const placeLabel = `${place.city}, ${place.state}`;
  const served = isServedZip(place);
  const lines = picked.map((trade): TradeCoverageLine => {
    const c = coverageFor(place, trade, served);
    const answer = tradeAnswerOf(c);
    const word = lang === 'en' ? tradeLabel(trade).toLowerCase() : lowerFirst(tradeLabel(trade, lang));
    const text =
      answer === 'live'
        ? t(lang, 'pf.cov.live', { trade: word, place: placeLabel })
        : answer === 'limited'
          ? t(lang, 'chk.limited', { trade: word })
          : answer === 'unmeasured'
            ? t(lang, 'chk.unmeasured', { trade: word, place: placeLabel })
            : answer === 'storm'
              ? t(lang, 'chk.storm', { trade: word })
              : served
                ? `${t(lang, 'chk.h.trade_wait', { trade: word, place: placeLabel })}.`
                : t(lang, 'wl.card.heading', { place: placeLabel });
    return { trade, answer, tag: t(lang, `pf.cov.tag.${answer}`), text };
  });
  const firstWait = lines.find((l) => l.answer === 'waitlist');
  const base = lang === 'en' ? '/check' : `/${lang}/check`;
  return {
    zip,
    place: placeLabel,
    lines,
    allWaitlist: lines.every((l) => l.answer === 'waitlist'),
    joinHref: firstWait ? `${base}?zip=${encodeURIComponent(zip)}&trade=${encodeURIComponent(firstWait.trade)}` : null,
  };
}
