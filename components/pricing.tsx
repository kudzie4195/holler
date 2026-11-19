import Link from 'next/link';
import { PLAN_FEATURES } from '@/lib/plan/copy';
import { PLAN_LIMITS, TIER_NAMES, type Tier } from '@/lib/plan/limits';
import { annualSavingLabel, priceLabel } from '@/lib/stripe/plans';
import { TRIAL_DAYS } from '@/lib/auth/membership';

/** One line of limits for the short cards: "1 area · 5 trades · email alerts", "3 areas · 15 trades · 5 keyword watches". */
export function planShortLine(tier: Tier): string {
  const l = PLAN_LIMITS[tier];
  const areas = `${l.areas} ${l.areas === 1 ? 'area' : 'areas'}`;
  const trades = `${l.trades} trades`;
  return l.keywords ? `${areas} · ${trades} · ${l.keywords} keyword watches` : `${areas} · ${trades} · email alerts`;
}

/** The app is not released: both cards say push comes with it (alerts go by email today). */
export const PUSH_NOTE = 'Push arrives with the app.';

const CARD: Record<Tier, { card: string; tag: string; muted: string; button: string; check: string }> = {
  // Solo on field green: on-brand text 11.3:1, on-brand-muted 8.2:1, signal tag 9.7:1. Signal button with ink text (13.2:1).
  starter: {
    card: 'on-brand bg-brand text-on-brand',
    tag: 'text-signal',
    muted: 'text-on-brand-muted',
    button: 'bg-signal text-ink hover:brightness-105',
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
 *   - variant "short" (the home page): price, yearly price, one line of limits, the push note and a "Start free" button.
 *   - variant "full" (the default, the /pricing page): the trial line, the yearly saving, every feature in PLAN_FEATURES, buttons
 *     that name the trial, and the note on trial limits.
 * Every price and the yearly saving phrase come from lib/stripe/plans.ts (PRICES_CENTS), every name and limit from
 * lib/plan/limits.ts, the trial length from lib/auth/membership.ts. Nothing is typed.
 * The price row wraps at narrow widths, so the longer prices ($13.99) never push the card wider than a 320 px phone.
 */
export function Pricing({ variant = 'full' }: { variant?: 'short' | 'full' } = {}) {
  const full = variant === 'full';
  return (
    <div className="flex flex-col gap-4">
      {full ? (
        <p className="font-semibold text-brand-text">
          Every plan starts with a {TRIAL_DAYS}-day free trial. No card needed.
        </p>
      ) : null}
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-4" aria-label="Plans">
        {(['starter', 'pro'] as const).map((tier) => {
          const c = CARD[tier];
          return (
            <li key={tier} className={`flex flex-col gap-2.5 rounded-card p-[30px] ${c.card}`}>
              <h3 className={`font-mono text-[13px] font-medium uppercase leading-5 tracking-normal ${c.tag}`}>{TIER_NAMES[tier]}</h3>
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                {/* Display face, not monospace: the "." keeps its own narrow width, so 13.99 never reads as "13 . 99". */}
                <span data-price className="font-display text-[72px] leading-[0.9]">
                  {priceLabel(tier, 'monthly')}
                </span>
                <span className={`text-[15px] font-medium ${c.muted}`}>/ month</span>
              </p>
              <p className={`text-[15px] ${c.muted}`}>
                or <span data-price>{priceLabel(tier, 'annual')}</span> a year{full ? `, ${annualSavingLabel(tier)}` : ''}
              </p>
              {full ? (
                <ul className="mt-2 flex flex-col gap-2.5">
                  {PLAN_FEATURES[tier].map((li) => (
                    <li key={li} className="flex gap-3">
                      <svg className={`mt-1 shrink-0 ${c.check}`} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <path d="m4 9.5 3.2 3.2L14 5.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>{li}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[17px]">{planShortLine(tier)}</p>
              )}
              <p className={`text-[15px] ${c.muted}`}>{PUSH_NOTE}</p>
              <Link
                href="/signup"
                className={`mt-auto flex min-h-[52px] items-center justify-center whitespace-normal! rounded-control px-4 text-center font-semibold transition-[filter,background-color] duration-150 active:translate-y-px ${c.button}`}
              >
                {full ? (tier === 'starter' ? `Start free for ${TRIAL_DAYS} days` : `Start free, pick ${TIER_NAMES.pro} later`) : 'Start free'}
              </Link>
            </li>
          );
        })}
      </ul>
      {full ? (
        <p className="text-sm text-muted">
          The trial uses {TIER_NAMES.starter} limits. Move to {TIER_NAMES.pro} in Settings, or cancel, any time.
        </p>
      ) : null}
    </div>
  );
}
