import Link from 'next/link';
import { PLAN_FEATURES } from '@/lib/plan/copy';
import { PLAN_LIMITS, TIER_NAMES, type Tier } from '@/lib/plan/limits';
import { annualSavingLabel, priceLabel } from '@/lib/stripe/plans';
import { TRIAL_PHRASE } from '@/lib/plan/price-copy';
import { TRIAL_DAYS } from '@/lib/auth/membership';
import { t, type Lang } from '@/lib/i18n';
import { annualSavingLabelEs, planFeaturesEs, planNameEs, trialPhraseEs } from '@/lib/plan/price-copy-es';

/** No-break space: a number never sits on a different line from its noun ("5" and "keyword watches"). */
const NB = '\u00a0';

/**
 * The limits on a short card, as separate pieces: ["1 area", "5 trades", "email alerts"], ["3 areas", "15 trades", "5 keyword watches"].
 * The card draws them as a wrapping row with a gap and no separator dot, so a line never ends on a hanging "·". Each piece moves to
 * the next line whole; only a piece wider than the card (a very large browser text size) breaks inside, and never between the number
 * and its noun.
 */
export function planShortParts(tier: Tier): string[] {
  const l = PLAN_LIMITS[tier];
  const areas = `${l.areas}${NB}${l.areas === 1 ? 'area' : 'areas'}`;
  const trades = `${l.trades}${NB}trades`;
  return [areas, trades, l.keywords ? `${l.keywords}${NB}keyword watches` : 'email alerts'];
}

/** The short-card limits in Spanish: ["1 zona", "5 oficios", "alertas por correo"]. Same pieces and no-break spaces as planShortParts. */
export function planShortPartsEs(tier: Tier): string[] {
  const l = PLAN_LIMITS[tier];
  const areas = `${l.areas}${NB}${l.areas === 1 ? 'zona' : 'zonas'}`;
  const trades = `${l.trades}${NB}oficios`;
  return [areas, trades, l.keywords ? `${l.keywords}${NB}palabras clave` : 'alertas por correo'];
}

/** Who each plan is for: shown under the plan name on /pricing (the full cards). */
export const PLAN_BLURB: Record<Tier, string> = {
  starter: 'For one shop in one town.',
  pro: 'For a crew that covers more ground or more kinds of work.',
};

/**
 * Round 23 (website-only launch): both notes say what is true today. Holler is a website; alerts go by email and to the feed, and no
 * app, store listing or push notification exists. These replaced PUSH_NOTE / PUSH_NOTE_FULL, which promised push "with the app".
 */
export const ALERTS_NOTE = 'Alerts come by email.';
/** /pricing says it once, under both cards: the full cards already list email alerts among the features. */
export const ALERTS_NOTE_FULL = 'Holler is a website, so alerts come by email and to your feed here, and there is no app to install.';

const CARD: Record<Tier, { card: string; tag: string; muted: string; button: string; check: string }> = {
  // Solo on field green: on-brand text 11.3:1, on-brand-muted 8.2:1, signal tag 9.7:1. Signal button with ink text (13.2:1).
  starter: {
    card: 'on-brand bg-brand text-on-brand',
    tag: 'text-signal',
    muted: 'text-on-brand-muted',
    button: 'bg-signal text-ink hover:bg-signal-hover',
    check: 'text-signal',
  },
  // Pro on white: brand-text tag 7.4:1, muted 6.2:1. Ink button with on-brand text.
  pro: {
    card: 'border border-line bg-surface text-ink',
    tag: 'text-brand-text',
    muted: 'text-muted',
    button: 'bg-ink text-on-brand hover:bg-brand',
    check: 'text-sage-mark',
  },
};

/**
 * The two plan cards: Solo on green, Pro on white. Server component.
 *   - variant "short" (the home page): price, yearly price, the limits (planShortParts), the push note and a "Start free" button.
 *   - variant "full" (the default, the /pricing page): the trial line, who the plan is for (PLAN_BLURB), the yearly saving, every
 *     feature in PLAN_FEATURES, buttons that name the trial, and one note under both cards on trial limits and on push.
 * Every price and the yearly saving phrase come from lib/stripe/plans.ts (PRICES_CENTS), every name and limit from
 * lib/plan/limits.ts, the trial length from lib/auth/membership.ts. Nothing is typed.
 * The price row wraps at narrow widths, so a longer price never pushes the card wider than a 320 px phone, and the price size
 * steps down between 56 and 72 px so both cards wrap the same way at 1024 px.
 */
export function Pricing({ variant = 'full', lang = 'en' }: { variant?: 'short' | 'full'; lang?: Lang } = {}) {
  const full = variant === 'full';
  // Spanish (/es/pricing): the same cards and the same numbers, with the words from the dictionary and lib/plan/price-copy-es.ts.
  // English keeps its JSX exactly as it was, so its markup does not change by a byte.
  const es = lang === 'es';
  return (
    <div className="flex flex-col gap-4">
      {full ? (
        es ? (
          <p className="font-semibold text-brand-text">{t(lang, 'pricing.trial_line', { trial: trialPhraseEs() })}</p>
        ) : (
        <p className="font-semibold text-brand-text">
          Every plan starts with a {TRIAL_PHRASE}. No card needed.
        </p>
        )
      ) : null}
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-4" aria-label={es ? t(lang, 'pricing.plans_aria') : 'Plans'}>
        {(['starter', 'pro'] as const).map((tier) => {
          const c = CARD[tier];
          return (
            <li key={tier} className={`flex flex-col gap-2.5 rounded-card p-[30px] ${c.card}`}>
              <h3 className={`font-mono text-[0.8125rem] font-medium uppercase leading-5 tracking-normal ${c.tag}`}>{es ? planNameEs(tier) : TIER_NAMES[tier]}</h3>
              {full ? <p className={`text-[0.9375rem] ${c.muted}`}>{es ? t(lang, `pricing.blurb.${tier}`) : PLAN_BLURB[tier]}</p> : null}
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                {/* Display face, not monospace: the "." keeps its own narrow width, so 13.99 never reads as "13 . 99". */}
                <span data-price className="font-display text-[clamp(56px,6vw,72px)] leading-[0.9]">
                  {priceLabel(tier, 'monthly')}
                </span>
                <span className={`text-[0.9375rem] font-medium ${c.muted}`}>{es ? t(lang, full ? 'pricing.per_month' : 'pricing.per_month_short') : full ? 'a month' : '/ month'}</span>
              </p>
              {es ? (
                <p className={`text-[0.9375rem] ${c.muted}`}>
                  {t(lang, 'pricing.or')} <span data-price>{priceLabel(tier, 'annual')}</span> {t(lang, 'pricing.per_year')}
                  {full && annualSavingLabelEs(tier) ? `, ${annualSavingLabelEs(tier)}` : ''}
                </p>
              ) : (
              <p className={`text-[0.9375rem] ${c.muted}`}>
                or <span data-price>{priceLabel(tier, 'annual')}</span> a year{full && annualSavingLabel(tier) ? `, ${annualSavingLabel(tier)}` : ''}
              </p>
              )}
              {full ? (
                <ul className="mt-2 flex flex-col gap-2.5">
                  {(es ? planFeaturesEs(tier) : PLAN_FEATURES[tier]).map((li) => (
                    <li key={li} className="flex gap-3">
                      <svg className={`mt-1 shrink-0 ${c.check}`} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <path d="m4 9.5 3.2 3.2L14 5.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>{li}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex flex-wrap gap-x-4 text-[1.0625rem]">
                  {(es ? planShortPartsEs(tier) : planShortParts(tier)).map((part) => (
                    <span key={part} className="max-w-full">
                      {part}
                    </span>
                  ))}
                </p>
              )}
              {full ? null : <p className={`text-[0.9375rem] ${c.muted}`}>{es ? t(lang, 'pricing.alerts_short') : ALERTS_NOTE}</p>}
              <Link
                href={es ? '/es/signup' : '/signup'}
                className={`mt-auto flex min-h-[52px] items-center justify-center whitespace-normal! rounded-control px-4 text-center font-semibold transition-[filter,background-color] duration-150 active:translate-y-px ${c.button}`}
              >
                {es
                  ? full
                    ? tier === 'starter'
                      ? t(lang, 'pricing.cta.starter', { days: TRIAL_DAYS })
                      : t(lang, 'pricing.cta.pro', { pro: planNameEs('pro') })
                    : t(lang, 'pricing.cta.short')
                  : full ? (tier === 'starter' ? `Start your ${TRIAL_PHRASE}` : `Start free, pick ${TIER_NAMES.pro} later`) : 'Start free'}
              </Link>
            </li>
          );
        })}
      </ul>
      {full && es ? (
        <p className="text-sm text-muted">
          {t(lang, 'pricing.trial_note', { solo: planNameEs('starter'), pro: planNameEs('pro') })} {t(lang, 'pricing.alerts_full')}
        </p>
      ) : full ? (
        <p className="text-sm text-muted">
          The trial uses {TIER_NAMES.starter} limits. Move to {TIER_NAMES.pro} in Settings, or cancel, any time. {ALERTS_NOTE_FULL}
        </p>
      ) : null}
    </div>
  );
}
