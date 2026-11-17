import type { Metadata } from 'next';
import { BillingButton, PlanChangeButton } from '@/components/billing-button';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DeleteAccount } from '@/components/delete-account';
import { Notice } from '@/components/notice';
import { ProfileForm } from '@/components/profile-form';
import { computeAccess } from '@/lib/auth/access';
import { requireProfile } from '@/lib/auth/session';
import { hasEnv } from '@/lib/env';
import { annualSavingsPercent, planChangeNote, priceLabel, renewalNote } from '@/lib/stripe/plans';
import { DOWNGRADE_NOTE, effectiveTier, parseExtraAreas, parseKeywords, planLimitsLine, PLAN_LIMITS, TIER_NAMES, type Tier } from '@/lib/plan';
import { CATEGORIES } from '@/lib/signals/categories';
import { tradeComingSoon } from '@/lib/seo/signal-types';
import { saveSettings } from './actions';

export const metadata: Metadata = {
  title: 'Settings',
};

export default async function SettingsPage() {
  const { user, profile } = await requireProfile();
  const access = computeAccess(profile);
  const stripeReady = hasEnv('STRIPE_SECRET_KEY');
  const tier = effectiveTier({ plan: profile.plan ?? null, subscription_status: profile.subscription_status });

  return (
    <>
      <h1 className="text-4xl text-ink">Settings</h1>
      <p className="mt-2 text-muted">
        Signed in as <span className="font-medium text-ink">{user.email}</span>
      </p>

      <section aria-labelledby="profile-h" className="mt-10">
        <h2 id="profile-h" className="text-2xl text-ink">What you do and where</h2>
        <Card className="mt-4">
          <ProfileForm
            action={saveSettings}
            categories={CATEGORIES.map((c) => ({ id: c.id, label: c.label, group: (c as unknown as { group?: string }).group, comingSoon: tradeComingSoon(c.id) }))}
            defaults={{
              business_name: profile.business_name,
              categories: profile.categories,
              zip: profile.zip ?? '',
              radius: profile.radius_mi,
              alert_email: profile.alert_email,
              extra_zips: parseExtraAreas(profile.extra_areas).map((a) => a.zip),
              keywords: parseKeywords(profile.keywords),
            }}
            submitLabel="Save changes"
            showAlertToggle
            tier={tier}
            upgradeHref="#billing-h"
          />
        </Card>
      </section>

      <section aria-labelledby="billing-h" className="mt-12">
        <h2 id="billing-h" className="scroll-mt-24 text-2xl text-ink">Billing</h2>
        <Card className="mt-4">
          <BillingBlock
            status={access.status}
            daysLeft={access.daysLeft}
            trialEnded={access.trialEnded}
            stripeReady={stripeReady}
            tier={tier}
            savedPro={profile.plan === 'pro'}
          />
        </Card>
      </section>

      <section aria-labelledby="account-h" className="mt-12">
        <h2 id="account-h" className="text-2xl text-ink">Account</h2>
        <Card className="mt-4 flex flex-col gap-6">
          <form action="/api/auth/signout" method="post">
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
          <div className="border-t border-line pt-6">
            <h3 className="text-lg font-semibold text-ink">Delete account</h3>
            <p className="mb-4 mt-1 text-muted">Deletes your Holler profile, alerts and billing. Your sign-in is shared with other apps we run, so it stays.</p>
            <DeleteAccount />
          </div>
        </Card>
      </section>
    </>
  );
}

function PlanLine({ tier }: { tier: Tier }) {
  return (
    <>
      <span className="font-mono tabular-nums">{priceLabel(tier, 'monthly')}</span> a month or{' '}
      <span className="font-mono tabular-nums">{priceLabel(tier, 'annual')}</span> a year
    </>
  );
}

function BillingBlock({
  status,
  daysLeft,
  trialEnded,
  stripeReady,
  tier,
  savedPro,
}: {
  status: string;
  daysLeft: number;
  trialEnded: boolean;
  stripeReady: boolean;
  tier: Tier;
  savedPro: boolean;
}) {
  const unavailable = stripeReady ? null : (
    <Notice tone="info">Billing opens soon, you&apos;re on the free trial.</Notice>
  );
  const current = (
    <p>
      Your plan: <strong className="font-semibold">{TIER_NAMES[tier]}</strong>. {planLimitsLine(tier)}.
    </p>
  );

  if (status === 'active') {
    return (
      <div className="flex flex-col gap-5">
        {current}
        {tier === 'starter' ? (
          <div className="flex flex-col gap-3 border-t border-line pt-5">
            <p>
              <strong className="font-semibold">Pro</strong> is <PlanLine tier="pro" />. It adds {PLAN_LIMITS.pro.extraAreas} more ZIP codes, up
              to {PLAN_LIMITS.pro.trades} trades and {PLAN_LIMITS.pro.keywords} keyword watches. You keep paying monthly or yearly as you do
              now. Moving up charges your card today for the price difference over the days left in your billing period. If that charge
              fails, nothing changes.
            </p>
            <PlanChangeButton tier="pro" note={planChangeNote('pro')}>
              Move to Pro
            </PlanChangeButton>
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-t border-line pt-5">
            <p>
              <strong className="font-semibold">Starter</strong> is <PlanLine tier="starter" />. {DOWNGRADE_NOTE} The unused part of Pro
              becomes a credit on your next bill.
            </p>
            <PlanChangeButton tier="starter" variant="secondary" note={planChangeNote('starter')}>
              Move to Starter
            </PlanChangeButton>
          </div>
        )}
        <div className="flex flex-col gap-3 border-t border-line pt-5">
          <p>Change your card or cancel any time.</p>
          <BillingButton endpoint="/api/stripe/portal" variant="secondary">
            Manage billing
          </BillingButton>
        </div>
      </div>
    );
  }

  if (status === 'past_due') {
    return (
      <div className="flex flex-col gap-4">
        {current}
        <Notice tone="warn">Your last payment didn&apos;t go through. Update your card to keep alerts on.</Notice>
        <BillingButton endpoint="/api/stripe/portal">Update payment method</BillingButton>
      </div>
    );
  }

  const headline =
    status === 'canceled'
      ? 'Your subscription is canceled.'
      : trialEnded
        ? 'Your free trial has ended.'
        : `Free trial: ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left.`;

  return (
    <div className="flex flex-col gap-5">
      <p>
        <strong className="font-semibold">{headline}</strong>{' '}
        {status === 'canceled' ? 'Pick a plan to turn alerts back on.' : 'The trial uses Starter limits. Pick a plan to keep alerts.'} Cancel
        any time.
      </p>
      {savedPro ? <p className="text-sm text-muted">Your saved Pro settings are still here. Pick Pro to use them again.</p> : null}
      {unavailable}
      <div className="grid gap-4 md:grid-cols-2">
        {(['starter', 'pro'] as const).map((t) => (
          <div key={t} className="flex flex-col gap-3 rounded-card border border-line p-4">
            <h3 className="text-lg font-semibold text-ink">{TIER_NAMES[t]}</h3>
            <p className="text-sm text-muted">
              <PlanLine tier={t} />. {planLimitsLine(t)}.
            </p>
            {stripeReady ? (
              <div className="flex flex-col gap-2">
                <BillingButton endpoint="/api/stripe/checkout" tier={t} plan="monthly" note={renewalNote(t, 'monthly', { inTrial: !trialEnded })}>
                  {priceLabel(t, 'monthly')} a month
                </BillingButton>
                <BillingButton
                  endpoint="/api/stripe/checkout"
                  tier={t}
                  plan="annual"
                  variant="secondary"
                  note={renewalNote(t, 'annual', { inTrial: !trialEnded })}
                >
                  {priceLabel(t, 'annual')} a year, save {annualSavingsPercent(t)}%
                </BillingButton>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
