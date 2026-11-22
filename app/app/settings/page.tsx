import type { Metadata } from 'next';
import { BillingButton, PlanChangeButton } from '@/components/billing-button';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DeleteAccount } from '@/components/delete-account';
import { Notice } from '@/components/notice';
import { ProfileForm } from '@/components/profile-form';
import { LanguageForm } from '@/components/language-form';
import { WorkProfileForm } from '@/components/work-profile-form';
import { readWorkProfile } from '@/lib/auth/work-profile';
import { createClient } from '@/lib/supabase/server';
import { hasLanguageSetting } from '@/lib/auth/language';
import { langOfProfile, t } from '@/lib/i18n';
import { computeAccess } from '@/lib/auth/access';
import { requireProfile } from '@/lib/auth/session';
import { hasEnv } from '@/lib/env';
import { annualSavingSentence, planChangeNote, priceLabel, renewalNote } from '@/lib/stripe/plans';
import { DOWNGRADE_NOTE, effectiveTier, parseExtraAreas, parseKeywords, planLimitsLine, PLAN_LIMITS, TIER_NAMES, type Tier } from '@/lib/plan';
import { CATEGORIES } from '@/lib/signals/categories';
import { tradeComingSoon } from '@/lib/seo/signal-types';
import { tradeNoLiveSource } from '@/lib/signals/lead-rules';
import { readShadowStore } from '@/lib/storebilling/shadow';
import { storeManaged } from '@/lib/storebilling/web';
import { createAdminClient } from '@/lib/supabase/admin';
import { saveLanguageSetting, saveSettings, saveWorkProfileSetting } from './actions';

export const metadata: Metadata = {
  title: 'Settings',
};

export default async function SettingsPage() {
  const { user, profile } = await requireProfile();
  const access = computeAccess(profile);
  const stripeReady = hasEnv('STRIPE_SECRET_KEY');
  const tier = effectiveTier({
    plan: profile.plan ?? null,
    subscription_status: profile.subscription_status,
    plan_source: profile.plan_source ?? null,
    store_expires_at: profile.store_expires_at ?? null,
  });
  // Paid through the App Store or Google Play (migration 0020): no Stripe checkout, plan switch or portal here.
  const store = storeManaged(profile);
  // A double payer (live plan billed by Stripe) may also have an App Store or Google Play plan running: deleting does not cancel it.
  let shadowStore: 'apple' | 'google' | null = null;
  if (!store) {
    try {
      shadowStore = await readShadowStore(createAdminClient(), user.id);
    } catch {
      shadowStore = null;
    }
  }
  // "What work do you take?" (migration 0027): read with the member's own client. Before 0027 the read fails and the section is hidden.
  let work: Awaited<ReturnType<typeof readWorkProfile>> = { available: false, settings: { property: 'both', minValue: null, workType: 'both' } };
  try {
    work = await readWorkProfile(await createClient(), user.id);
  } catch {
    /* hidden */
  }
  const deleteStoreName = store?.storeName ?? (shadowStore === 'apple' ? 'the App Store' : shadowStore === 'google' ? 'Google Play' : null);

  return (
    <>
      <h1 className="text-5xl text-ink">Settings</h1>
      <p className="mt-2 text-muted">
        Signed in as <span className="font-medium text-ink">{user.email}</span>
      </p>

      <section aria-labelledby="profile-h" className="mt-10">
        <h2 id="profile-h" className="h-plain text-2xl text-ink">What you do and where</h2>
        <Card className="mt-4">
          <ProfileForm
            action={saveSettings}
            categories={CATEGORIES.map((c) => ({ id: c.id, label: c.label, group: (c as unknown as { group?: string }).group, comingSoon: tradeComingSoon(c.id) || tradeNoLiveSource(c.id), noLiveSource: tradeNoLiveSource(c.id) }))}
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

      {/* Only when the database has the language column (migration 0024): without it the control is hidden and everything stays English. */}
      {hasLanguageSetting(profile) ? (
        <section aria-labelledby="language-h" className="mt-12">
          <h2 id="language-h" className="h-plain text-2xl text-ink">{t(langOfProfile(profile), 'settings.language.heading')}</h2>
          <Card className="mt-4">
            <LanguageForm action={saveLanguageSetting} current={langOfProfile(profile)} />
          </Card>
        </section>
      ) : null}

      {/* Only when the database has the work table (migration 0027): without it the section is hidden and matching is as before. */}
      {work.available ? (
        <section aria-labelledby="work-h" className="mt-12">
          <h2 id="work-h" className="h-plain text-2xl text-ink">{t(langOfProfile(profile), 'settings.work.heading')}</h2>
          <Card className="mt-4">
            <WorkProfileForm action={saveWorkProfileSetting} current={work.settings} lang={langOfProfile(profile)} />
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="billing-h" className="mt-12">
        <h2 id="billing-h" className="h-plain scroll-mt-24 text-2xl text-ink">Billing</h2>
        <Card className="mt-4">
          {store ? (
            <div className="flex flex-col gap-3">
              <p>
                Your plan: <strong className="font-semibold">{TIER_NAMES[tier]}</strong>. {planLimitsLine(tier)}.
              </p>
              <p className="text-muted">{store.line}</p>
              <a href={store.manageUrl} className="font-medium text-brand-text underline" rel="noopener" target="_blank">
                Manage it in {store.storeName}
              </a>
            </div>
          ) : (
          <BillingBlock
            status={access.status}
            daysLeft={access.daysLeft}
            trialEnded={access.trialEnded}
            stripeReady={stripeReady}
            tier={tier}
            savedPro={profile.plan === 'pro'}
          />
          )}
        </Card>
      </section>

      <section aria-labelledby="account-h" className="mt-12">
        <h2 id="account-h" className="h-plain text-2xl text-ink">Account</h2>
        <Card className="mt-4 flex flex-col gap-6">
          <form action="/api/auth/signout" method="post">
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
          <div className="border-t border-line pt-6">
            <h3 className="text-lg font-semibold text-ink">Delete account</h3>
            <p className="mb-4 mt-1 text-muted">Deletes your Holler profile, alerts and billing. Your sign-in is shared with other apps we run, so it stays.</p>
            {deleteStoreName ? (
              <p className="mb-4 text-muted">Deleting your account does not cancel your plan in {deleteStoreName}. Cancel it there first.</p>
            ) : null}
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
              <strong className="font-semibold">{TIER_NAMES.pro}</strong> is <PlanLine tier="pro" />. It adds {PLAN_LIMITS.pro.extraAreas} more ZIP codes, up
              to {PLAN_LIMITS.pro.trades} trades and {PLAN_LIMITS.pro.keywords} keyword watches. You keep paying monthly or yearly as you do
              now. Moving up charges your card today for the price difference over the days left in your billing period. If that charge
              fails, nothing changes.
            </p>
            <PlanChangeButton tier="pro" note={planChangeNote('pro')}>
              Move to {TIER_NAMES.pro}
            </PlanChangeButton>
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-t border-line pt-5">
            <p>
              <strong className="font-semibold">{TIER_NAMES.starter}</strong> is <PlanLine tier="starter" />. {DOWNGRADE_NOTE} The unused part of {TIER_NAMES.pro}
              becomes a credit on your next bill.
            </p>
            <PlanChangeButton tier="starter" variant="secondary" note={planChangeNote('starter')}>
              Move to {TIER_NAMES.starter}
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
        {status === 'canceled' ? 'Pick a plan to turn alerts back on.' : `The trial uses ${TIER_NAMES.starter} limits. Pick a plan to keep alerts.`} Cancel
        any time.
      </p>
      {savedPro ? <p className="text-sm text-muted">Your saved Pro settings are still here. Pick Pro to use them again.</p> : null}
      {unavailable}
      <div className="grid gap-4 md:grid-cols-2">
        {(['starter', 'pro'] as const).map((t) => (
          <div key={t} className="flex flex-col gap-3 rounded-card border border-line p-4">
            <h3 className="text-lg font-semibold text-ink">{TIER_NAMES[t]}</h3>
            <p className="text-sm text-muted">
              <PlanLine tier={t} />. {annualSavingSentence(t)} {planLimitsLine(t)}.
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
                  {priceLabel(t, 'annual')} a year
                </BillingButton>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
