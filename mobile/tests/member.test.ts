// Review r6: sign-out cleanup on every path, notification taps during loading, the push pre-prompt for
// existing members, and account deletion before onboarding is finished.
import { describe, expect, it, vi } from 'vitest';
import { authEventAction, createOpenQueue, memberScreen, pushIsOn, releaseMember, stackAfterLoad } from '../src/state/member';

describe('sign-out cleanup on every path (review r6 P1)', () => {
  it('a SIGNED_OUT that Supabase fires by itself is a sign-out', () => {
    expect(authEventAction('SIGNED_OUT', false)).toBe('signed-out');
    expect(authEventAction('SIGNED_IN', true)).toBe('enter');
    expect(authEventAction('INITIAL_SESSION', false)).toBe('ignore');
  });

  it('Supabase signing out by itself still logs out of RevenueCat and drops the push token without calling the API', async () => {
    const order: string[] = [];
    const push = {
      attach: vi.fn((api: null) => void order.push(`attach:${api}`)),
      unregister: vi.fn(async () => void order.push('push.unregister')),
    };
    const logOutPurchases = vi.fn(async () => void order.push('logOutPurchases'));
    const signOutSupabase = vi.fn(async () => void order.push('supabase.signOut'));
    await releaseMember({ push, logOutPurchases, signOutSupabase }, { sessionAlive: false });
    expect(order).toEqual(['attach:null', 'push.unregister', 'logOutPurchases']);
    expect(signOutSupabase).not.toHaveBeenCalled();
  });

  it('our own sign-out removes the token while the session still works, then RevenueCat, then Supabase', async () => {
    const order: string[] = [];
    const push = { attach: vi.fn(), unregister: vi.fn(async () => void order.push('push.unregister')) };
    await releaseMember(
      { push, logOutPurchases: async () => void order.push('logOutPurchases'), signOutSupabase: async () => void order.push('supabase.signOut') },
      { sessionAlive: true },
    );
    expect(push.attach).not.toHaveBeenCalled();
    expect(order).toEqual(['push.unregister', 'logOutPurchases', 'supabase.signOut']);
  });

  it('a failing step never stops the rest', async () => {
    const logOutPurchases = vi.fn(async () => undefined);
    await releaseMember({ push: { attach: () => undefined, unregister: async () => Promise.reject(new Error('x')) }, logOutPurchases }, { sessionAlive: false });
    expect(logOutPurchases).toHaveBeenCalled();
  });
});

describe('a notification tap while the member is loading (review r6 P2)', () => {
  it('is queued and opened once /api/m/me answers, not overwritten by the feed', () => {
    const q = createOpenQueue();
    q.offer({ name: 'alert', signalId: 42 }); // arrives during loading-member
    expect(stackAfterLoad({ needsOnboarding: false }, q.take(), false)).toEqual([{ name: 'feed' }, { name: 'alert', signalId: 42 }]);
    expect(q.take()).toBeNull();
  });
  it('a tap opens the alert even when the push pre-prompt is due; the prompt waits for the next sign-in', () => {
    expect(stackAfterLoad({ needsOnboarding: false }, { name: 'alert', signalId: 7 }, true)).toEqual([{ name: 'feed' }, { name: 'alert', signalId: 7 }]);
  });
  it('onboarding still comes first', () => {
    expect(stackAfterLoad({ needsOnboarding: true }, { name: 'alert', signalId: 7 }, true)).toEqual([{ name: 'onboarding' }]);
  });
});

describe('existing members get the push pre-prompt (review r6 P1)', () => {
  it('a member with a profile who has not seen the prompt on this phone is asked', () => {
    expect(stackAfterLoad({ needsOnboarding: false }, null, true)).toEqual([{ name: 'push-prompt' }]);
    expect(stackAfterLoad({ needsOnboarding: false }, null, false)).toEqual([{ name: 'feed' }]);
  });
  it('Settings shows push ON only with the server flag on AND a token registered here', () => {
    expect(pushIsOn(true, false)).toBe(false); // server default true, never asked on this phone
    expect(pushIsOn(true, null)).toBe(false);
    expect(pushIsOn(false, true)).toBe(false);
    expect(pushIsOn(true, true)).toBe(true);
  });
});

describe('account deletion before onboarding is finished (review r6 P2, 5.1.1(v))', () => {
  it('the delete screen is reachable while onboarding is due; nothing else is', () => {
    expect(memberScreen({ name: 'delete' }, true)).toBe('delete');
    expect(memberScreen({ name: 'feed' }, true)).toBe('onboarding');
    expect(memberScreen({ name: 'settings' }, true)).toBe('onboarding');
    expect(memberScreen({ name: 'settings' }, false)).toBe('settings');
  });
});
