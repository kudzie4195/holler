import { ButtonLink } from './button';
import { Card } from './card';
import { PLAN_FEATURES } from '@/lib/plan/copy';
import { TIER_NAMES, type Tier } from '@/lib/plan/limits';
import { annualSavingsPercent, priceLabel } from '@/lib/stripe/plans';
import { TRIAL_DAYS } from '@/lib/auth/membership';

const BLURB: Record<Tier, string> = {
  starter: 'For one shop in one town.',
  pro: 'For a crew that covers more ground or more kinds of work.',
};

/**
 * The two plan cards. Server component, no props: rendered on the home page and on /pricing.
 * Every price comes from lib/stripe/plans.ts (PRICES_CENTS), every limit from lib/plan/limits.ts.
 */
export function Pricing() {
  return (
    <div className="flex flex-col gap-4">
      <p className="font-semibold text-accent-text">
        {TRIAL_DAYS}-day free trial. No card to start.
      </p>
      <ul className="grid gap-5 md:grid-cols-2" aria-label="Plans">
        {(['starter', 'pro'] as const).map((tier) => (
          <li key={tier} className="flex">
            <Card className="flex w-full flex-col !p-6 md:!p-7">
              <h3 className="text-2xl text-ink">{TIER_NAMES[tier]}</h3>
              <p className="mt-1 text-muted">{BLURB[tier]}</p>
              <p className="mt-5 flex items-baseline gap-2">
                {/* Body font, normal spacing: a monospace face gave the "." a full digit-wide cell, so $9.99 read as "$9 . 99". */}
                <span data-price className="text-5xl font-semibold tracking-tight text-ink">
                  {priceLabel(tier, 'monthly')}
                </span>
                <span className="text-lg text-muted">a month</span>
              </p>
              <p className="mt-1 text-muted">
                or <span data-price>{priceLabel(tier, 'annual')}</span> a year, which saves {annualSavingsPercent(tier)}%
              </p>
              <ul className="mt-6 flex flex-1 flex-col gap-3 text-ink">
                {PLAN_FEATURES[tier].map((li) => (
                  <li key={li} className="flex gap-3">
                    <svg className="mt-1 shrink-0 text-success" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                      <path d="m4 9.5 3.2 3.2L14 5.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>{li}</span>
                  </li>
                ))}
              </ul>
              <ButtonLink href="/signup" size="lg" full variant={tier === 'starter' ? 'primary' : 'secondary'} className="mt-7">
                {tier === 'starter' ? `Start free for ${TRIAL_DAYS} days` : 'Start free, pick Pro later'}
              </ButtonLink>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        The trial uses Starter limits. Move to Pro from Settings whenever you like. Cancel any time.
      </p>
    </div>
  );
}
