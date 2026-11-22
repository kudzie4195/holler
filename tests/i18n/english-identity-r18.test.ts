/**
 * Round 18, unit ES: English output is byte-identical. Every English surface this unit gave a Spanish twin (the pricing page, the four
 * auth pages and their forms, the auth layout, onboarding, the /app layout and feed chrome, Settings in every billing state, account
 * deletion, the verify notice, and the welcome, verify, password reset, trial lifecycle and outcome-question emails) is rendered here
 * for an English member or visitor and compared with tests/i18n/fixtures/english-r18.json.
 *
 * That file was written by this test at the base commit (8bee203, before any r18 ES change) with WRITE_ENGLISH_BASELINE=1, and is not
 * edited by hand. The only intended English differences are listed in INTENDED below and checked on their own.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderResolved } from './render-tree';
import { appMocks, baseMocks, lockedRow, member } from './r18-harness';
import { NOW, iso } from '../signals/brief-fixtures';

const FIXTURE = 'tests/i18n/fixtures/english-r18.json';
const WRITE = process.env.WRITE_ENGLISH_BASELINE === '1';

/** Metadata keys this unit adds on purpose to English pages: the hreflang set. Removed before the comparison, checked on their own. */
const INTENDED_METADATA_KEYS = ['alternates'];

/**
 * The intended changes to English markup, applied to the base render before the comparison. Each must occur exactly once in the base,
 * so a change cannot slip in elsewhere under cover of one of these.
 *  - /pricing: the footer's "Español" link goes to /es/pricing (the Spanish twin of the page) instead of /es.
 * (The other intended change, the "Español" link in the footer of /signup, /login, /forgot and /reset, depends on the path and is tested in
 * tests/i18n/es-account.test.ts; here the path is /app, where that link renders nothing.)
 */
const INTENDED: Record<string, [string, string][]> = {
  'pricing.html': [['href="/es">Español</a>', 'href="/es/pricing">Español</a>']],
};

function stripMeta(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...m };
  for (const k of INTENDED_METADATA_KEYS) delete out[k];
  return out;
}

/** Every English surface, keyed by a stable name. */
async function renderEnglish(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const meta = (m: unknown) => JSON.stringify(stripMeta((m ?? {}) as Record<string, unknown>));

  // ---- public: pricing, auth pages, auth layout -------------------------------------------------------------------------------
  baseMocks({ user: null });
  {
    const pricing = await import('@/app/pricing/page');
    out['pricing.html'] = await renderResolved(createElement(pricing.default));
    out['pricing.meta'] = meta(pricing.metadata);
    const signup = await import('@/app/(auth)/signup/page');
    out['signup.html'] = await renderResolved(signup.default({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
    out['signup.city.html'] = await renderResolved(signup.default({ params: Promise.resolve({}), searchParams: Promise.resolve({ city: 'atlanta-ga' }) } as never));
    out['signup.meta'] = meta(signup.metadata);
    const login = await import('@/app/(auth)/login/page');
    out['login.html'] = await renderResolved(login.default({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
    out['login.expired.html'] = await renderResolved(login.default({ params: Promise.resolve({}), searchParams: Promise.resolve({ error: 'link', next: '/app/settings' }) } as never));
    out['login.meta'] = meta(login.metadata);
    const forgot = await import('@/app/(auth)/forgot/page');
    out['forgot.html'] = await renderResolved(forgot.default({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
    out['forgot.expired.html'] = await renderResolved(forgot.default({ params: Promise.resolve({}), searchParams: Promise.resolve({ error: 'link' }) } as never));
    out['forgot.meta'] = meta(forgot.metadata);
    const reset = await import('@/app/(auth)/reset/page');
    out['reset.nouser.html'] = await renderResolved(createElement(reset.default));
    out['reset.meta'] = meta(reset.metadata);
    const layout = await import('@/app/(auth)/layout');
    out['auth-layout.html'] = await renderResolved(layout.default({ children: createElement('p', null, 'CHILD') }));
    out['auth-layout.meta'] = meta(layout.metadata);
  }
  baseMocks({});
  {
    const reset = await import('@/app/(auth)/reset/page');
    out['reset.user.html'] = await renderResolved(createElement(reset.default));
    const onboarding = await import('@/app/onboarding/page');
    out['onboarding.html'] = await renderResolved(onboarding.default({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never));
    out['onboarding.city.html'] = await renderResolved(onboarding.default({ params: Promise.resolve({}), searchParams: Promise.resolve({ city: 'atlanta-ga' }) } as never));
    out['onboarding.meta'] = meta(onboarding.metadata);
  }

  // ---- the /app layout -------------------------------------------------------------------------------------------------------
  baseMocks({ profile: member() });
  {
    const layout = await import('@/app/app/layout');
    out['app-layout.html'] = await renderResolved(layout.default({ children: createElement('p', null, 'CHILD') }));
    out['app-layout.meta'] = meta(layout.metadata);
    const vn = await import('@/app/app/verify-notice');
    out['verify-notice.html'] = await renderResolved(createElement(vn.VerifyNotice));
    const del = await import('@/components/delete-account');
    out['delete-account.html'] = await renderResolved(createElement(del.DeleteAccount));
  }

  // ---- /app in each state ------------------------------------------------------------------------------------------------------
  const appStates: Record<string, { profile: Record<string, unknown>; rows?: unknown[]; upgraded?: boolean }> = {
    trialing: { profile: member() },
    'trialing.unverified': { profile: member({ email_verified_at: null }) },
    'trialing.1day': { profile: member({ trial_ends_at: iso(3_600_000) }) },
    past_due: { profile: member({ subscription_status: 'past_due' }) },
    active: { profile: member({ subscription_status: 'active' }), upgraded: true },
    locked: { profile: member({ trial_ends_at: iso(-86_400_000) }), rows: [lockedRow] },
    'locked.none': { profile: member({ subscription_status: 'canceled', trial_ends_at: iso(-86_400_000) }), rows: [lockedRow, { ...lockedRow, id: 2 }] },
  };
  for (const [name, s] of Object.entries(appStates)) {
    baseMocks({ profile: s.profile });
    appMocks(s.rows ?? []);
    const page = await import('@/app/app/page');
    if (name === 'trialing') {
      // No title of its own for an English member, before and after: the layout's default ("Your matches").
      const mod = page as { metadata?: unknown; generateMetadata?: () => Promise<unknown> };
      out['app.meta'] = meta(mod.generateMetadata ? await mod.generateMetadata() : mod.metadata);
    }
    out[`app.${name}.html`] = await renderResolved(page.default({ params: Promise.resolve({}), searchParams: Promise.resolve(s.upgraded ? { upgraded: '1' } : {}) } as never));
  }

  // ---- Settings in each billing state ------------------------------------------------------------------------------------------
  const future = iso(20 * 86_400_000);
  const settingsStates: Record<string, { profile: Record<string, unknown>; stripe?: boolean; shadow?: string | null }> = {
    trialing: { profile: member() },
    'trialing.nostripe': { profile: member(), stripe: false },
    'trial-ended': { profile: member({ trial_ends_at: iso(-86_400_000) }) },
    canceled: { profile: member({ subscription_status: 'canceled', trial_ends_at: iso(-86_400_000), plan: 'pro' }) },
    'active.solo': { profile: member({ subscription_status: 'active' }) },
    'active.pro': { profile: member({ subscription_status: 'active', plan: 'pro', keywords: ['tree removal'], extra_areas: [{ zip: '30060', city: 'Marietta', state: 'GA', lat: 33.95, lon: -84.55 }] }) },
    past_due: { profile: member({ subscription_status: 'past_due' }) },
    'store.apple': { profile: member({ subscription_status: 'active', plan: 'pro', plan_source: 'apple', store_expires_at: future }) },
    'shadow.google': { profile: member({ subscription_status: 'active' }), shadow: 'google' },
    'with-language': { profile: member({ language: 'en' }) },
  };
  for (const [name, s] of Object.entries(settingsStates)) {
    baseMocks({ profile: s.profile, stripe: s.stripe, shadow: s.shadow });
    appMocks();
    const page = await import('@/app/app/settings/page');
    out[`settings.${name}.html`] = await renderResolved(createElement(page.default as never));
    if (name === 'trialing') {
      // The page now builds its title per member (generateMetadata); for an English member it must be what the static metadata was.
      const mod = page as { metadata?: unknown; generateMetadata?: () => Promise<unknown> };
      out['settings.meta'] = meta(mod.generateMetadata ? await mod.generateMetadata() : mod.metadata);
    }
  }

  // ---- emails --------------------------------------------------------------------------------------------------------------------
  baseMocks({});
  {
    const t = await import('@/lib/email/templates');
    const j = (r: { subject: string; html: string; text: string }) => JSON.stringify(r);
    out['email.verify'] = j(t.renderVerifyEmail({ verifyUrl: 'https://localholler.test/api/auth/verify?t=abc', appUrl: 'https://localholler.test/app' }));
    out['email.reset'] = j(t.renderPasswordReset({ resetUrl: 'https://localholler.test/auth/confirm?token_hash=x&type=recovery&next=%2Freset' }));
    out['email.welcome'] = j(t.renderWelcome({ businessName: 'Dale Roofing', appUrl: 'https://localholler.test/app' }));
    const l = await import('@/lib/lifecycle/templates');
    const common = { businessName: 'Dale Roofing', feedUrl: 'https://localholler.test/app', plansUrl: 'https://localholler.test/app/settings#billing-h', unsubscribeUrl: 'https://localholler.test/u' };
    const items = [
      { title: 'Roof permit in Atlanta', city: 'Atlanta', state: 'GA', occurredAt: iso(-86_400_000), kind: 'permit', source: 'arcgis-atlanta-permits' },
      { title: 'Severe Thunderstorm Warning (Fulton)', city: 'Atlanta', state: 'GA', occurredAt: iso(-2 * 86_400_000), kind: 'alert', source: 'nws' },
    ];
    out['email.welcome-matches'] = j(l.renderWelcomeMatches({ ...common, total: 12, capped: true, items }));
    out['email.welcome-matches.one'] = j(l.renderWelcomeMatches({ ...common, total: 1, items: items.slice(0, 1) }));
    out['email.welcome-quiet'] = j(l.renderWelcomeQuiet({ ...common, lines: [{ label: 'building permits', count: 40 }, { label: 'weather alerts', count: 3 }], total: 43, days: 90 }));
    out['email.welcome-quiet.one'] = j(l.renderWelcomeQuiet({ ...common, lines: [{ label: 'inspection', count: 1 }], total: 1, days: 90 }));
    out['email.trial-ending'] = j(l.renderTrialEnding({ ...common, items }));
    out['email.trial-ending.none'] = j(l.renderTrialEnding({ ...common, items: [] }));
    out['email.trial-ended'] = j(l.renderTrialEnded({ ...common, missed: 7, capped: false }));
    out['email.trial-ended.zero'] = j(l.renderTrialEnded({ ...common, missed: 0 }));
    const m = await import('@/lib/moat/email');
    out['email.outcome'] = j(
      m.renderFollowUp({
        businessName: 'Dale Roofing',
        items: [{ title: 'Roof permit in Atlanta', kind: 'permit', place: 'Atlanta, GA', occurredAt: iso(-8 * 86_400_000), yesUrl: 'https://localholler.test/y', noUrl: 'https://localholler.test/n' }],
        unsubscribeUrl: 'https://localholler.test/u',
        now: NOW,
      }),
    );
  }
  return out;
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe('English output is unchanged (round 18 ES)', () => {
  it('every English surface matches the base-commit render byte for byte', async () => {
    const now = await renderEnglish();
    if (process.env.DUMP_ENGLISH) writeFileSync(process.env.DUMP_ENGLISH, JSON.stringify(now));
    if (WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 1)}\n`);
      return;
    }
    expect(existsSync(FIXTURE), FIXTURE).toBe(true);
    const base = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(base).sort());
    for (const [k, swaps] of Object.entries(INTENDED)) {
      for (const [from, to] of swaps) {
        expect(base[k].split(from).length - 1, `${k}: ${from}`).toBe(1);
        base[k] = base[k].replace(from, to);
      }
    }
    for (const k of Object.keys(base)) expect(now[k], k).toBe(base[k]);
  }, 60_000);
});
