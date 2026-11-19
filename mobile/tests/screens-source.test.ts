// Review r6 P2 (UI-only fixes). There is no DOM renderer in this test setup, so these check the source.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f: string) => readFileSync(path.join(here, '..', 'src', f), 'utf8');

describe('360 px and notices', () => {
  it('the saved draft wraps long URLs instead of overflowing the card', () => {
    const line = src('screens/AlertDetail.tsx').split('\n').find((l) => l.includes('{item.draft}'));
    expect(line).toMatch(/overflowWrap: 'anywhere'/);
  });
  it('the Feed shows the app notice once and clears it', () => {
    const feed = src('screens/Feed.tsx');
    expect(feed).toMatch(/useState\(app\.notice\)/);
    expect(feed).toMatch(/app\.setNotice\(null\)/);
    expect(feed).not.toMatch(/\{app\.notice\}/);
  });
  it('Sign out in Settings is never disabled by a store call', () => {
    const settings = src('screens/Settings.tsx');
    const signOut = settings.split('\n').find((l) => l.includes('app.signOut()'));
    expect(signOut).toBeDefined();
    expect(signOut).not.toMatch(/disabled/);
  });
  it('the onboarding screen links to the delete flow', () => {
    expect(src('screens/Onboarding.tsx')).toMatch(/navigate\(\{ name: 'delete' \}\)/);
  });
});

describe('restore wording on both screens (review v2 B1)', () => {
  for (const f of ['screens/Paywall.tsx', 'screens/Settings.tsx']) {
    it(`${f} takes its restore message from restoreMessage() and polls only after a real restore`, () => {
      const code = src(f);
      expect(code).toMatch(/restoreMessage\(result\)/);
      expect(code).not.toMatch(/'Your subscription is restored\.'/);
      const restoredBranch = code.slice(code.indexOf("result.kind === 'restored'"), code.indexOf("result.kind === 'none'"));
      expect(restoredBranch).toMatch(/app\.pollUntilPaid\(\)/);
    });
  }
});


describe('session backup wiring in AppContext (review v3 P1)', () => {
  const ctx = src('state/AppContext.tsx');
  it('our own sign-out deletes the backup before signing out and clears the session after', () => {
    const body = ctx.slice(ctx.indexOf('const signOut = useCallback'), ctx.indexOf('const signedOutBySupabase'));
    expect(body.indexOf('beginSignOut()')).toBeGreaterThan(-1);
    expect(body.indexOf('beginSignOut()')).toBeLessThan(body.indexOf('releaseMember('));
    expect(body).toMatch(/finally \{\s*await guard\.endSignOut\(\)/);
  });
  it('a SIGNED_OUT from supabase-js asks the guard first and keeps the member when the session was put back', () => {
    const start = ctx.indexOf('const signedOutBySupabase');
    const body = ctx.slice(start, ctx.indexOf('setUnauthorizedHandler(', start));
    expect(body.indexOf("outcome()")).toBeGreaterThan(-1);
    expect(body.indexOf("=== 'kept') return")).toBeLessThan(body.indexOf('resetToSignedOut()'));
  });
});
