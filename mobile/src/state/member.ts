// Pure pieces of the member lifecycle, kept out of AppContext so they can be tested without React.
import type { MeResponse } from '../contract';
import type { PushTarget } from '../push/route';
import type { Route } from './routes';

/** Which screen the router shows for a signed-in member. Onboarding wins, except the delete flow (5.1.1(v)). */
export function memberScreen(route: Route, needsOnboarding: boolean): Route['name'] {
  if (needsOnboarding) return route.name === 'delete' ? 'delete' : 'onboarding';
  return route.name;
}

function routeOf(target: PushTarget): Route {
  return target.name === 'alert' ? { name: 'alert', signalId: target.signalId } : { name: 'feed' };
}

/**
 * A notification tap waits here until the member is loaded. A tap that arrives while /api/m/me is
 * still loading is kept and used once the member is ready, instead of being overwritten.
 */
export function createOpenQueue() {
  let pending: Route | null = null;
  return {
    offer(target: PushTarget): void {
      pending = routeOf(target);
    },
    take(): Route | null {
      const r = pending;
      pending = null;
      return r;
    },
    clear(): void {
      pending = null;
    },
  };
}

/** The screen stack once /api/m/me has answered. */
export function stackAfterLoad(me: Pick<MeResponse, 'needsOnboarding'>, pending: Route | null, askPush: boolean): Route[] {
  if (me.needsOnboarding) return [{ name: 'onboarding' }];
  if (pending?.name === 'alert') return [{ name: 'feed' }, pending];
  if (pending?.name === 'feed') return [{ name: 'feed' }];
  if (askPush) return [{ name: 'push-prompt' }];
  return [{ name: 'feed' }];
}

/** What a Supabase auth event means for the app. */
export type AuthAction = 'enter' | 'signed-out' | 'ignore';

export function authEventAction(event: string, hasSession: boolean): AuthAction {
  if (hasSession && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) return 'enter';
  if (event === 'SIGNED_OUT') return 'signed-out';
  return 'ignore';
}

export interface ReleaseDeps {
  push: { attach(api: null): void; unregister(): Promise<void> };
  logOutPurchases(): Promise<void>;
  /** Our own sign-out only: drop the Supabase session on this phone. */
  signOutSupabase?: () => Promise<void>;
}

/**
 * Everything a sign-out must undo on this phone, on EVERY path. When Supabase signed out by itself
 * (the refresh token was revoked), the session cannot prove who we are any more, so the push token is
 * removed from FCM only (the server drops it when FCM reports it dead). RevenueCat is always logged out.
 */
export async function releaseMember(deps: ReleaseDeps, opts: { sessionAlive: boolean }): Promise<void> {
  if (!opts.sessionAlive) deps.push.attach(null);
  await deps.push.unregister().catch(() => undefined);
  await deps.logOutPurchases().catch(() => undefined);
  if (opts.sessionAlive && deps.signOutSupabase) {
    try {
      await deps.signOutSupabase();
    } catch {
      /* the local session is dropped either way */
    }
  }
}

/** The Settings push switch is ON only when the server flag is on AND this phone has a token registered for this account. */
export function pushIsOn(serverFlag: boolean | undefined, registeredHere: boolean | null): boolean {
  return Boolean(serverFlag) && registeredHere === true;
}

/** The waits between /api/m/me polls after a purchase or a restore. */
export const PAID_POLL_WAITS_MS = [1000, 2000, 4000, 8000];

/**
 * After a purchase or a restore: poll /api/m/me until the server says paid. 'unconfirmed' when it
 * never did; the caller keeps the UI unlocked from the store entitlement and shows nothing more.
 * Never throws.
 */
export async function pollMeUntilPaid(
  me: () => Promise<MeResponse>,
  onMe: (m: MeResponse) => void,
  waits: number[] = PAID_POLL_WAITS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<'confirmed' | 'unconfirmed'> {
  for (const wait of waits) {
    await sleep(wait);
    try {
      const m = await me();
      onMe(m);
      if (m.access?.state === 'paid') return 'confirmed';
    } catch {
      /* keep the store's word until the server catches up */
    }
  }
  return 'unconfirmed';
}
