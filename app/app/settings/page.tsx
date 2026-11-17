import type { Metadata } from 'next';
import { BillingButton } from '@/components/billing-button';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DeleteAccount } from '@/components/delete-account';
import { Notice } from '@/components/notice';
import { ProfileForm } from '@/components/profile-form';
import { computeAccess } from '@/lib/auth/access';
import { requireProfile } from '@/lib/auth/session';
import { hasEnv } from '@/lib/env';
import { ANNUAL_SAVINGS_PERCENT } from '@/lib/stripe/plans';
import { CATEGORIES } from '@/lib/signals/categories';
import { saveSettings } from './actions';

export const metadata: Metadata = {
  title: 'Settings',
};

export default async function SettingsPage() {
  const { user, profile } = await requireProfile();
  const access = computeAccess(profile);
  const stripeReady = hasEnv('STRIPE_SECRET_KEY');

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
            categories={CATEGORIES.map((c) => ({ id: c.id, label: c.label, group: (c as unknown as { group?: string }).group }))}
            defaults={{
              business_name: profile.business_name,
              categories: profile.categories,
              zip: profile.zip ?? '',
              radius: profile.radius_mi,
              alert_email: profile.alert_email,
            }}
            submitLabel="Save changes"
            showAlertToggle
          />
        </Card>
      </section>

      <section aria-labelledby="billing-h" className="mt-12">
        <h2 id="billing-h" className="text-2xl text-ink">Billing</h2>
        <Card className="mt-4">
          <BillingBlock status={access.status} daysLeft={access.daysLeft} trialEnded={access.trialEnded} stripeReady={stripeReady} />
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

function BillingBlock({
  status,
  daysLeft,
  trialEnded,
  stripeReady,
}: {
  status: string;
  daysLeft: number;
  trialEnded: boolean;
  stripeReady: boolean;
}) {
  const unavailable = stripeReady ? null : (
    <Notice tone="info">Billing opens soon, you&apos;re on the free trial.</Notice>
  );

  if (status === 'active') {
    return (
      <div className="flex flex-col gap-4">
        <p>
          <strong className="font-semibold">Active.</strong> Change your card or cancel any time.
        </p>
        <BillingButton endpoint="/api/stripe/portal" variant="secondary">
          Manage billing
        </BillingButton>
      </div>
    );
  }

  if (status === 'past_due') {
    return (
      <div className="flex flex-col gap-4">
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
    <div className="flex flex-col gap-4">
      <p>
        <strong className="font-semibold">{headline}</strong> Keep alerts for <span className="font-mono tabular-nums">$5</span> a month,
        or <span className="font-mono tabular-nums">$48</span> a year (save {ANNUAL_SAVINGS_PERCENT}%). Cancel any time.
      </p>
      {unavailable}
      {stripeReady ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <BillingButton endpoint="/api/stripe/checkout" plan="monthly">
            Subscribe for $5/mo
          </BillingButton>
          <BillingButton endpoint="/api/stripe/checkout" plan="annual" variant="secondary">
            Pay $48/year, save {ANNUAL_SAVINGS_PERCENT}%
          </BillingButton>
        </div>
      ) : null}
    </div>
  );
}
