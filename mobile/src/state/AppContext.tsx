import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiCallError } from '../api/client';
import { readSession } from '../auth/session';
import { isSupabaseConfigured, sessionGuard, supabase } from '../auth/supabase';
import { finishAuthCallback } from '../auth/social';
import type { ConfigResponse, EntitlementId, MeResponse } from '../contract';
import { isNative } from '../lib/platform';
import { effectiveAccess, entitlementFor, type EffectiveAccess, type TaggedEntitlement } from '../purchases/plan';
import { configurePurchases, currentStoreState, logOutPurchases, onStoreChange, purchasesUserId } from '../purchases/purchases';
import { api, push, setUnauthorizedHandler } from '../services';
import { authEventAction, createOpenQueue, pollMeUntilPaid, releaseMember, stackAfterLoad } from './member';
import type { Route } from './routes';

/** 'offline': a session may be stored but could not be read or refreshed without the network. Not signed out. */
type Phase = 'starting' | 'offline' | 'signed-out' | 'loading-member' | 'member-error' | 'ready';

interface AppState {
  phase: Phase;
  session: Session | null;
  config: ConfigResponse | null;
  configError: string | null;
  me: MeResponse | null;
  memberError: string | null;
  storeEntitlement: EntitlementId | null;
  access: EffectiveAccess;
  route: Route;
  canGoBack: boolean;
  notice: string | null;
  navigate: (route: Route, opts?: { replace?: boolean; reset?: boolean }) => void;
  back: () => void;
  setNotice: (text: string | null) => void;
  reloadConfig: () => Promise<void>;
  reloadMe: () => Promise<MeResponse | null>;
  setMe: (me: MeResponse) => void;
  setStoreEntitlement: (e: EntitlementId | null) => void;
  signOut: () => Promise<void>;
  /** After a purchase or a restore: poll /api/m/me until the webhook has landed (1, 2, 4, 8 s). */
  pollUntilPaid: () => Promise<void>;
  /** The offline start screen's Try again: read the stored session again. */
  retrySession: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [session, setSession] = useState<Session | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [me, setMeState] = useState<MeResponse | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  // Tagged with the member it was read for: a value read for another account never unlocks this one.
  const [taggedEntitlement, setTaggedEntitlement] = useState<TaggedEntitlement | null>(null);
  const [stack, setStack] = useState<Route[]>([{ name: 'welcome' }]);
  const [notice, setNotice] = useState<string | null>(null);
  const [storeReady, setStoreReady] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const openQueue = useRef(createOpenQueue()).current;
  /** True once the member's first screen is set; a notification tap before that waits in openQueue. */
  const memberReady = useRef(false);
  const needsOnboardingRef = useRef(false);

  const setStoreEntitlement = useCallback((e: EntitlementId | null) => {
    const uid = userIdRef.current;
    setTaggedEntitlement(uid ? { userId: uid, entitlement: e } : null);
  }, []);

  const route = stack[stack.length - 1];

  const navigate = useCallback((next: Route, opts?: { replace?: boolean; reset?: boolean }) => {
    setStack((s) => (opts?.reset ? [next] : opts?.replace ? [...s.slice(0, -1), next] : [...s, next]));
  }, []);

  const back = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const reloadConfig = useCallback(async () => {
    try {
      const c = await api.config();
      setConfig(c);
      setConfigError(null);
    } catch (e) {
      setConfigError(e instanceof ApiCallError ? e.message : "We couldn't reach Holler.");
    }
  }, []);

  const setMe = useCallback((next: MeResponse) => {
    setMeState(next);
    needsOnboardingRef.current = next.needsOnboarding;
    setMemberError(null);
  }, []);

  const loadMember = useCallback(async (): Promise<MeResponse | null> => {
    try {
      const m = await api.me();
      setMe(m);
      setPhase('ready');
      return m;
    } catch (e) {
      if (e instanceof ApiCallError && e.code === 'unauthorized') return null; // signOut already running
      setMemberError(e instanceof ApiCallError ? e.message : "We couldn't reach Holler.");
      setPhase((p) => (p === 'ready' ? p : 'member-error'));
      return null;
    }
  }, [setMe]);

  /** Reset everything this phone knows about the member. Part of every sign-out path. */
  const resetToSignedOut = useCallback(() => {
    userIdRef.current = null;
    memberReady.current = false;
    needsOnboardingRef.current = false;
    openQueue.clear();
    setSession(null);
    setMeState(null);
    setTaggedEntitlement(null);
    setStoreReady(false);
    setPhase('signed-out');
    setStack([{ name: 'welcome' }]);
  }, [openQueue]);

  const signingOut = useRef(false);
  const signOut = useCallback(async () => {
    // One sign-out at a time: the token removal below can itself answer 401, which calls signOut again.
    if (signingOut.current) return;
    signingOut.current = true;
    // Our own sign-out (also the end of account deletion): the session backup goes first.
    const guard = sessionGuard();
    await guard.beginSignOut().catch(() => undefined);
    try {
      // Remove this phone's push token while the session can still prove who we are.
      await releaseMember({ push, logOutPurchases, signOutSupabase: async () => void (await supabase().auth.signOut({ scope: 'local' })) }, { sessionAlive: true });
      resetToSignedOut();
    } finally {
      await guard.endSignOut().catch(() => undefined);
      signingOut.current = false;
    }
  }, [resetToSignedOut]);

  /** Supabase signed out by itself (refresh token revoked, for example): the same cleanup, minus the API calls. */
  const signedOutBySupabase = useCallback(async () => {
    if (signingOut.current) return; // our own signOut fired this event; it cleans up itself
    // A 429, a 5xx or a portal page during a refresh: the guard put the session back. Stay signed in;
    // the call that hit it shows its own "try again" state, and a cold start shows the offline screen.
    if ((await sessionGuard().outcome().catch(() => 'signed-out' as const)) === 'kept') return;
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      resetToSignedOut();
      await releaseMember({ push, logOutPurchases }, { sessionAlive: false });
    } finally {
      signingOut.current = false;
    }
  }, [resetToSignedOut]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut();
    });
  }, [signOut]);

  // A signed-in member: purchases, push, then /api/m/me decides onboarding or feed.
  const enterMember = useCallback(
    async (s: Session) => {
      if (userIdRef.current === s.user.id) return;
      userIdRef.current = s.user.id;
      memberReady.current = false;
      setTaggedEntitlement(null); // never carry a store answer over from another account
      setStoreReady(false);
      setSession(s);
      setPhase('loading-member');
      push.attach(api, s.user.id);
      void (async () => {
        if (await configurePurchases(s.user.id)) {
          if (userIdRef.current !== s.user.id) return;
          setStoreReady(true);
          const st = await currentStoreState(s.user.id);
          if (userIdRef.current === s.user.id) setTaggedEntitlement({ userId: s.user.id, entitlement: st?.entitlement ?? null });
        }
      })();
      const m = await loadMember();
      if (!m || userIdRef.current !== s.user.id) return;
      let askPush = false;
      if (!m.needsOnboarding) {
        // Re-register only for an account that agreed on this phone before (push.ts keeps consent per account).
        if (m.profile?.pushAlerts) void push.refreshIfGranted();
        askPush = push.available() && !(await push.promptSeen());
      }
      if (userIdRef.current !== s.user.id) return;
      setStack(stackAfterLoad(m, openQueue.take(), askPush));
      memberReady.current = true;
    },
    [loadMember, openQueue],
  );

  /** Try again after a failed first load: also sets the first screen (and opens a queued tap) if that never happened. */
  const reloadMe = useCallback(async (): Promise<MeResponse | null> => {
    const m = await loadMember();
    if (m && userIdRef.current && !memberReady.current) {
      setStack(stackAfterLoad(m, openQueue.take(), false));
      memberReady.current = true;
    }
    return m;
  }, [loadMember, openQueue]);

  const applySessionRead = useCallback(async () => {
    const r = await readSession(supabase().auth);
    if (r.kind === 'session') void enterMember(r.session);
    else if (r.kind === 'none') setPhase((p) => (p === 'starting' || p === 'offline' ? 'signed-out' : p));
    else setPhase((p) => (p === 'starting' || p === 'offline' ? 'offline' : p));
  }, [enterMember]);

  // Startup: config, session, URL listeners, tap listener.
  useEffect(() => {
    let alive = true;
    void reloadConfig();

    // A tap always goes through the queue; it opens now only when the member's screens are ready.
    // Taps open in-app routes only (push/route.ts); no URL from a notification is ever opened.
    void push.listen((target) => {
      openQueue.offer(target);
      if (!memberReady.current) return;
      const r = openQueue.take();
      if (!r || needsOnboardingRef.current) return;
      setStack(r.name === 'alert' ? [{ name: 'feed' }, r] : [{ name: 'feed' }]);
    });

    const sb = supabase();
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      if (!alive) return;
      const action = authEventAction(event, Boolean(s));
      if (action === 'enter' && s) {
        setSession(s);
        // Defer: never await Supabase calls inside its own auth callback.
        setTimeout(() => void enterMember(s), 0);
      } else if (action === 'signed-out' && !signingOut.current) {
        // Not our own sign-out (that one cleans up itself): Supabase dropped the session on its own.
        setTimeout(() => void signedOutBySupabase(), 0);
      }
    });

    void (async () => {
      if (!isSupabaseConfigured()) {
        setPhase('signed-out');
        return;
      }
      if (!alive) return;
      // Offline with an expired session: stay signed in and show the offline screen with Try again.
      await applySessionRead();
    })();

    const cleanups: Array<() => void> = [() => sub.subscription.unsubscribe()];
    if (isNative()) {
      void (async () => {
        const { App } = await import('@capacitor/app');
        const handleUrl = async (url: string | undefined) => {
          if (!url) return;
          const out = await finishAuthCallback(url);
          if (out.kind === 'error') setNotice(out.message);
        };
        const launch = await App.getLaunchUrl();
        await handleUrl(launch?.url);
        const h1 = await App.addListener('appUrlOpen', (e) => void handleUrl(e.url));
        const h2 = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            sb.auth.startAutoRefresh();
            if (userIdRef.current) void reloadMe();
            else void applySessionRead(); // back online after the offline start screen
          } else sb.auth.stopAutoRefresh();
        });
        cleanups.push(() => void h1.remove(), () => void h2.remove());
      })();
    }
    return () => {
      alive = false;
      cleanups.forEach((fn) => fn());
    };
  }, [applySessionRead, enterMember, openQueue, reloadConfig, reloadMe, signedOutBySupabase]);

  // Store-pushed changes (a renewal, a cancel from iOS Settings) while the app is open.
  useEffect(() => {
    if (!storeReady) return;
    let off: (() => void) | null = null;
    let cancelled = false;
    void onStoreChange((st) => {
      const uid = userIdRef.current;
      // Only for the member RevenueCat is pointed at right now.
      if (uid && purchasesUserId() === uid) setTaggedEntitlement({ userId: uid, entitlement: st.entitlement });
    }).then((fn) => {
      if (cancelled) fn?.();
      else off = fn;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [storeReady]);

  const pollUntilPaid = useCallback(async () => {
    // Unconfirmed when polling ends (the webhook is late, or a restore moved the purchase between
    // accounts): the store entitlement keeps the UI unlocked, and nothing alarming is shown.
    await pollMeUntilPaid(() => api.me(), setMe);
  }, [setMe]);

  const storeEntitlement = entitlementFor(taggedEntitlement, session?.user.id ?? null);
  const access = useMemo(() => effectiveAccess(me?.access ?? null, storeEntitlement), [me, storeEntitlement]);

  const value: AppState = {
    phase,
    session,
    config,
    configError,
    me,
    memberError,
    storeEntitlement,
    access,
    route,
    canGoBack: stack.length > 1,
    notice,
    navigate,
    back,
    setNotice,
    reloadConfig,
    reloadMe,
    setMe,
    setStoreEntitlement,
    signOut,
    pollUntilPaid,
    retrySession: applySessionRead,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
