import { useEffect, useRef } from 'react';
import { isNative } from './lib/platform';
import { NETWORK_MESSAGE } from './api/client';
import { AppProvider, useApp } from './state/AppContext';
import { memberScreen } from './state/member';
import type { Route } from './state/routes';
import { AlertDetail } from './screens/AlertDetail';
import { Auth } from './screens/Auth';
import { Check } from './screens/Check';
import { DeleteAccount } from './screens/DeleteAccount';
import { Feed } from './screens/Feed';
import { Onboarding } from './screens/Onboarding';
import { Paywall } from './screens/Paywall';
import { Profile } from './screens/Profile';
import { PushPrompt } from './screens/PushPrompt';
import { Settings } from './screens/Settings';
import { Welcome } from './screens/Welcome';
import { Button, Mark, Notice } from './ui/kit';

const SIGNED_OUT_ROUTES = new Set<Route['name']>(['welcome', 'auth', 'check']);

function Splash() {
  return (
    <div className="app">
      <div className="center-screen" role="status" aria-live="polite" style={{ alignItems: 'center' }}>
        <Mark size={56} />
        <p className="muted" style={{ marginTop: 16 }}>Loading Holler</p>
      </div>
    </div>
  );
}

function MemberError() {
  const app = useApp();
  return (
    <div className="app">
      <div className="center-screen stack-lg">
        <Mark size={40} />
        <Notice tone="danger">{app.memberError ?? "We couldn't reach Holler."}</Notice>
        <Button full onClick={() => void app.reloadMe()}>Try again</Button>
        <Button variant="secondary" full onClick={() => void app.signOut()}>Sign out</Button>
      </div>
    </div>
  );
}

/** Offline at start with a stored session: still signed in, nothing is wiped. */
function Offline() {
  const app = useApp();
  return (
    <div className="app">
      <div className="center-screen stack-lg">
        <Mark size={40} />
        <Notice tone="warn" role="status">{NETWORK_MESSAGE}</Notice>
        <Button full onClick={() => void app.retrySession()}>Try again</Button>
        <Button variant="secondary" full onClick={() => void app.signOut()}>Sign out</Button>
      </div>
    </div>
  );
}

function Router() {
  const app = useApp();
  const { route, phase } = app;
  const backRef = useRef(app.back);
  const canGoBackRef = useRef(app.canGoBack);
  backRef.current = app.back;
  canGoBackRef.current = app.canGoBack;

  // Android hardware back: go back a screen, or leave the app from a root screen.
  useEffect(() => {
    if (!isNative()) return;
    let remove: (() => void) | null = null;
    void (async () => {
      const { App } = await import('@capacitor/app');
      const h = await App.addListener('backButton', () => {
        if (canGoBackRef.current) backRef.current();
        else void App.exitApp();
      });
      remove = () => void h.remove();
    })();
    return () => remove?.();
  }, []);

  if (phase === 'starting' || phase === 'loading-member') return <Splash />;
  if (phase === 'member-error') return <MemberError />;
  if (phase === 'offline') return <Offline />;

  if (phase === 'signed-out' || !app.me) {
    const r = SIGNED_OUT_ROUTES.has(route.name) ? route : { name: 'welcome' as const };
    if (r.name === 'auth') return <Auth mode={r.mode} />;
    if (r.name === 'check') return <Check />;
    return <Welcome />;
  }

  // While onboarding is due, only the delete flow can replace it (App Store 5.1.1(v)).
  switch (memberScreen(route, app.me.needsOnboarding)) {
    case 'onboarding':
      return <Onboarding />;
    case 'push-prompt':
      return <PushPrompt />;
    case 'alert':
      return route.name === 'alert' ? <AlertDetail key={route.signalId} signalId={route.signalId} /> : <Feed />;
    case 'check':
      return <Check />;
    case 'settings':
      return <Settings />;
    case 'profile':
      return <Profile />;
    case 'paywall':
      return <Paywall />;
    case 'delete':
      return <DeleteAccount />;
    case 'feed':
    default:
      return <Feed />;
  }
}

export function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
