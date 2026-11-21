import { useEffect, useState } from 'react';
import type { EntitlementId } from '../contract';
import { config, siteUrl } from '../lib/env';
import { platform } from '../lib/platform';
import { paywallView, periodLabel, type PlanOffer } from '../purchases/paywall';
import type { Period } from '../purchases/plan';
import {
  ensurePurchases,
  getPackages,
  IDENTITY_MESSAGE,
  purchase,
  PurchaseError,
  PurchasePendingError,
  restoreMessage,
  restorePurchases,
  storeAvailable,
  storefrontCountry,
  type StorePackage,
} from '../purchases/purchases';
import { useApp } from '../state/AppContext';
import { Button, Loading, Notice, Screen, openInApp } from '../ui/kit';

function storeName(): string {
  return platform() === 'android' ? 'Google Play' : 'the App Store';
}

function accountName(): string {
  return platform() === 'android' ? 'Google Play account' : 'Apple ID';
}

export function Paywall() {
  const app = useApp();
  const [packages, setPackages] = useState<StorePackage[] | null>(null);
  const [period, setPeriod] = useState<Period>('yearly');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [usStore, setUsStore] = useState(false);
  // RevenueCat is not pointed at this member (logIn failed or the ids differ): nothing is sold or restored.
  const [identityBlocked, setIdentityBlocked] = useState(false);
  const available = storeAvailable();

  const userId = app.session?.user.id ?? null;

  async function loadPackages() {
    setPackages(null);
    setIdentityBlocked(false);
    if (!(await ensurePurchases(userId))) {
      setIdentityBlocked(true);
      setPackages([]);
      return;
    }
    setPackages(await getPackages(userId));
  }

  useEffect(() => {
    if (!available) return;
    void loadPackages();
    if (config.flags.iosExternalPurchaseLink && platform() === 'ios') {
      void ensurePurchases(userId).then((ok) => (ok ? storefrontCountry() : null)).then((c) => setUsStore(c === 'USA'));
    }
  }, [available, userId]);

  const view = paywallView({
    me: app.me,
    plans: app.config?.plans ?? null,
    storeAvailable: available,
    packages,
    storeEntitlement: app.storeEntitlement,
  });

  async function buy(pkg: StorePackage) {
    setError(null);
    setInfo(null);
    setBusy(pkg.id);
    try {
      const state = await purchase(pkg.id, userId);
      if (!state) return; // cancelled: say nothing
      app.setStoreEntitlement(state.entitlement);
      if (state.entitlement) {
        const name = app.config?.plans?.[state.entitlement as EntitlementId]?.name ?? 'your plan';
        app.setNotice(`You're on ${name}. Thanks for subscribing.`);
        void app.pollUntilPaid();
        app.back();
      } else {
        setInfo('The store took the purchase. It can take a minute to show here.');
        void app.pollUntilPaid();
      }
    } catch (e) {
      // Pending (Ask to Buy, a slow payment): the store may still charge, so never say "not charged".
      if (e instanceof PurchasePendingError) {
        setInfo(e.message);
        void app.pollUntilPaid();
      } else setError(e instanceof PurchaseError ? e.message : 'The purchase did not go through. Try again.');
      if (e instanceof PurchaseError && e.message === IDENTITY_MESSAGE) setIdentityBlocked(true);
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    setError(null);
    setInfo(null);
    setBusy('restore');
    try {
      const result = await restorePurchases(userId);
      if (result.kind === 'restored') {
        // The UI unlocks from the store at once; the server catches up while we poll.
        app.setStoreEntitlement(result.entitlement);
        void app.pollUntilPaid();
      } else if (result.kind === 'none') app.setStoreEntitlement(null);
      setInfo(restoreMessage(result).text);
    } catch (e) {
      setError(e instanceof PurchaseError ? e.message : 'We could not restore right now. Try again.');
      if (e instanceof PurchaseError && e.message === IDENTITY_MESSAGE) setIdentityBlocked(true);
    } finally {
      setBusy(null);
    }
  }

  const restoreButton = available ? (
    <Button variant="secondary" full disabled={busy !== null} onClick={() => void restore()}>
      {busy === 'restore' ? 'Restoring...' : 'Restore purchases'}
    </Button>
  ) : null;

  const legal = (
    <div className="stack small muted">
      <p>
        Subscriptions renew automatically at the price shown until you cancel. Payment is charged to your {accountName()} when you confirm. Cancel at least 24 hours before
        the end of a period to avoid the next charge. Manage or cancel in your {accountName()} settings.
      </p>
      <p>
        <button type="button" className="link-btn" onClick={() => void openInApp(app.config?.links.terms ?? siteUrl('/terms'))}>Terms of Use</button>
        {' '}and{' '}
        <button type="button" className="link-btn" onClick={() => void openInApp(app.config?.links.privacy ?? siteUrl('/privacy'))}>Privacy Policy</button>
      </p>
    </div>
  );

  return (
    <Screen title="Plans" tabs>
      <div className="stack-lg">
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {info ? <Notice tone="success" role="status">{info}</Notice> : null}

        {identityBlocked ? (
          <div className="card stack" role="alert">
            <h3>The store is not ready</h3>
            <p className="muted">{IDENTITY_MESSAGE}</p>
            <Button variant="secondary" onClick={() => void loadPackages()}>Try again</Button>
          </div>
        ) : null}

        {view.kind === 'loading' ? <Loading label={`Loading prices from ${storeName()}`} /> : null}

        {view.kind === 'managed-on-web' ? (
          <div className="card stack">
            <h3>You're on {view.tierName}</h3>
            <p className="muted">Your plan is billed through the Holler website. To change or cancel it, log in at localholler.com and open Settings.</p>
          </div>
        ) : null}

        {view.kind === 'subscribed' ? (
          <div className="card stack">
            <h3>You're on {view.tierName}</h3>
            <p className="muted">
              {view.fromStore ? 'Your subscription is active. It can take a minute for every screen to catch up.' : 'Your subscription is active.'}
            </p>
          </div>
        ) : null}

        {view.kind === 'subscribed' && view.upgrade && !identityBlocked ? (
          <div className="stack">
            <p className="section-label">Upgrade</p>
            <PlanCard offer={view.upgrade} period={period} setPeriod={setPeriod} busy={busy} onBuy={buy} />
          </div>
        ) : null}

        {view.kind === 'unavailable' ? (
          <div className="card stack">
            {/* No store key in this build: say so plainly and point nowhere else (App Store guideline 3.1.1). */}
            <h3>Plans are not open in this build</h3>
            <p className="muted">Your free trial keeps working. Plans will appear here in a later update.</p>
          </div>
        ) : null}

        {view.kind === 'error' && !identityBlocked ? (
          <div className="card stack" role="alert">
            <h3>Prices did not load</h3>
            <p className="muted">We couldn't get prices from {storeName()}. Check your connection and try again.</p>
            <Button variant="secondary" onClick={() => void loadPackages()}>Try again</Button>
          </div>
        ) : null}

        {view.kind === 'offer' && !identityBlocked ? (
          <div className="stack">
            <p className="muted">Pick the plan that fits your work. You can change it later.</p>
            <div className="segmented" role="group" aria-label="Billing period">
              <button type="button" aria-pressed={period === 'monthly'} onClick={() => setPeriod('monthly')}>Monthly</button>
              <button type="button" aria-pressed={period === 'yearly'} onClick={() => setPeriod('yearly')}>Yearly</button>
            </div>
            {view.plans.map((p) => (
              <PlanCard key={p.entitlement} offer={p} period={period} setPeriod={setPeriod} busy={busy} onBuy={buy} />
            ))}
          </div>
        ) : null}

        {view.kind !== 'managed-on-web' ? restoreButton : null}
        {usStore && (view.kind === 'offer' || view.kind === 'error') ? (
          <p className="small muted" style={{ textAlign: 'center' }}>
            <button type="button" className="link-btn" onClick={() => void openInApp(siteUrl('/pricing'))}>Subscribe on the web</button>
          </p>
        ) : null}
        {view.kind === 'offer' || (view.kind === 'subscribed' && view.upgrade) ? legal : null}
      </div>
    </Screen>
  );
}

function PlanCard({
  offer,
  period,
  setPeriod,
  busy,
  onBuy,
}: {
  offer: PlanOffer;
  period: Period;
  setPeriod: (p: Period) => void;
  busy: string | null;
  onBuy: (pkg: StorePackage) => void;
}) {
  const pkg = (period === 'yearly' ? offer.yearly : offer.monthly) ?? offer.monthly ?? offer.yearly;
  if (!pkg) return null;
  const l = offer.limits;
  return (
    <div className="plan stack">
      <div className="spread">
        <h3>{offer.name}</h3>
        {pkg.period !== period ? (
          <button type="button" className="link-btn small" onClick={() => setPeriod(pkg.period)}>
            {pkg.period === 'yearly' ? 'Yearly only' : 'Monthly only'}
          </button>
        ) : null}
      </div>
      <p className="price">{periodLabel(pkg)}</p>
      {l ? (
        <ul className="list small">
          <li>{l.serviceAreas === 1 ? '1 service area' : `${l.serviceAreas} service areas`}</li>
          <li>Up to {l.trades} trades</li>
          {l.keywordWatches > 0 ? <li>{l.keywordWatches} keyword watches</li> : null}
        </ul>
      ) : null}
      {offer.trialDays && pkg.trial ? <p className="small" style={{ fontWeight: 600 }}>{pkg.trial.days}-day free trial, then {periodLabel(pkg)}.</p> : null}
      <Button full disabled={busy !== null} onClick={() => onBuy(pkg)}>
        {busy === pkg.id ? 'Opening the store...' : pkg.trial ? 'Start free trial' : `Subscribe to ${offer.name}`}
      </Button>
    </div>
  );
}
