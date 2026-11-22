/**
 * Test helper (round 18, ES): renders every Spanish surface this unit added, for the English-leak test and the Spanish account tests.
 * Each entry is the rendered output (page HTML, email subject + html + text, token page HTML) and the data a source or the member wrote
 * that may stay as it is (business name, place, email address). Uses the shared harness (r18-harness.ts) for the session and profile.
 */
import { createElement } from 'react';
import { vi } from 'vitest';
import { renderResolved } from './render-tree';
import { appMocks, baseMocks, lockedRow, member } from './r18-harness';
import { NOW, iso } from '../signals/brief-fixtures';

export interface SpanishSurface {
  out: string;
  data: string[];
}

const BIZ = 'Techos Ramírez';
const DATA = [BIZ, 'Atlanta, GA', 'Atlanta', 'Fulton, GA', 'Fulton', 'owner@example.test', 'help@localholler.test', 'Marietta, GA', 'Marietta'];
const SP = (sp: Record<string, string> = {}) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(sp) }) as never;

/** A Spanish member: the profile language column says 'es' (migration 0024 applied). */
export const esMember = (extra: Record<string, unknown> = {}) => member({ business_name: BIZ, language: 'es', ...extra });

export async function renderSpanish(): Promise<Record<string, SpanishSurface>> {
  const out: Record<string, SpanishSurface> = {};
  const add = (k: string, s: string, data: string[] = DATA) => (out[k] = { out: s, data });

  // ---- public pages, signed out -----------------------------------------------------------------------------------------------
  baseMocks({ user: null });
  {
    add('es.pricing', await renderResolved(createElement((await import('@/app/es/pricing/page')).default)));
    const signup = (await import('@/app/es/signup/page')).default;
    add('es.signup', await renderResolved(signup(SP())));
    add('es.signup.city', await renderResolved(signup(SP({ city: 'atlanta-ga' }))));
    const login = (await import('@/app/es/login/page')).default;
    add('es.login', await renderResolved(login(SP())));
    add('es.login.expired', await renderResolved(login(SP({ error: 'link', next: '/app/settings' }))));
    const forgot = (await import('@/app/es/forgot/page')).default;
    add('es.forgot', await renderResolved(forgot(SP())));
    add('es.forgot.expired', await renderResolved(forgot(SP({ error: 'link' }))));
    add('es.reset.nouser', await renderResolved(createElement((await import('@/app/es/reset/page')).default)));
    const confirm = (await import('@/app/es/confirm/page')).default;
    add('es.confirm', await renderResolved(confirm(SP({ token_hash: 'abc', type: 'recovery', next: '/es/reset' }))));
    add('es.confirm.invalid', await renderResolved(confirm(SP({ token_hash: 'abc', type: 'magiclink' }))));
  }
  // ---- signed in, before the profile exists: reset, onboarding --------------------------------------------------------------------
  baseMocks({ user: { id: 'u1', email: 'owner@example.test', app_metadata: { products: ['holler'], holler_language: 'es' } } });
  {
    add('es.reset.user', await renderResolved(createElement((await import('@/app/es/reset/page')).default)));
    const onb = (await import('@/app/es/onboarding/page')).default;
    add('es.onboarding', await renderResolved(onb(SP())));
    add('es.onboarding.city', await renderResolved(onb(SP({ city: 'atlanta-ga' }))));
  }
  baseMocks({ profile: esMember() });
  vi.doMock('@/components/feed/recent-activity', () => ({ RecentActivity: () => null, RecentActivityView: () => null }));
  add('es.onboarding.preview', await renderResolved(createElement((await import('@/app/es/onboarding/preview/page')).default)));

  // ---- the signed-in app for a Spanish member --------------------------------------------------------------------------------------
  baseMocks({ profile: esMember() });
  {
    const layout = await import('@/app/app/layout');
    add('app.layout', await renderResolved(layout.default({ children: createElement('p', null, 'x') })));
    const del = await import('@/components/delete-account');
    add('app.delete', await renderResolved(createElement(del.DeleteAccount, { lang: 'es' })));
    const vn = await import('@/app/app/verify-notice');
    add('app.verify', await renderResolved(createElement(vn.VerifyNotice, { lang: 'es' })));
  }
  const appStates: Record<string, { profile: Record<string, unknown>; rows?: unknown[]; upgraded?: boolean }> = {
    trialing: { profile: esMember() },
    'trialing.unverified': { profile: esMember({ email_verified_at: null }) },
    'trialing.1day': { profile: esMember({ trial_ends_at: iso(3_600_000) }) },
    past_due: { profile: esMember({ subscription_status: 'past_due' }) },
    active: { profile: esMember({ subscription_status: 'active' }), upgraded: true },
    locked: { profile: esMember({ trial_ends_at: iso(-86_400_000) }), rows: [lockedRow] },
    'locked.many': { profile: esMember({ subscription_status: 'canceled', trial_ends_at: iso(-86_400_000) }), rows: [lockedRow, { ...lockedRow, id: 2 }] },
  };
  for (const [name, s] of Object.entries(appStates)) {
    baseMocks({ profile: s.profile });
    appMocks(s.rows ?? []);
    const page = await import('@/app/app/page');
    add(`app.${name}`, await renderResolved(page.default({ params: Promise.resolve({}), searchParams: Promise.resolve(s.upgraded ? { upgraded: '1' } : {}) } as never)));
    if (name === 'trialing') add('app.meta', JSON.stringify(await page.generateMetadata()));
  }
  const future = iso(20 * 86_400_000);
  const settingsStates: Record<string, { profile: Record<string, unknown>; stripe?: boolean; shadow?: string | null }> = {
    trialing: { profile: esMember() },
    'trialing.nostripe': { profile: esMember(), stripe: false },
    'trial-ended': { profile: esMember({ trial_ends_at: iso(-86_400_000) }) },
    canceled: { profile: esMember({ subscription_status: 'canceled', trial_ends_at: iso(-86_400_000), plan: 'pro' }) },
    'active.solo': { profile: esMember({ subscription_status: 'active' }) },
    'active.pro': { profile: esMember({ subscription_status: 'active', plan: 'pro', keywords: ['retiro de árboles'], extra_areas: [{ zip: '30060', city: 'Marietta', state: 'GA', lat: 33.95, lon: -84.55 }] }) },
    'pro.downgraded': { profile: esMember({ subscription_status: 'active', plan: 'starter', categories: ['roofing', 'hvac', 'plumbing', 'electrical', 'painting', 'landscaping'] }) },
    past_due: { profile: esMember({ subscription_status: 'past_due' }) },
    'store.apple': { profile: esMember({ subscription_status: 'active', plan: 'pro', plan_source: 'apple', store_expires_at: future }) },
    'shadow.google': { profile: esMember({ subscription_status: 'active' }), shadow: 'google' },
  };
  for (const [name, s] of Object.entries(settingsStates)) {
    baseMocks({ profile: s.profile, stripe: s.stripe, shadow: s.shadow, pathname: '/app/settings' });
    appMocks();
    const page = await import('@/app/app/settings/page');
    add(`settings.${name}`, await renderResolved(createElement(page.default as never)), [...DATA, 'retiro de árboles']);
    if (name === 'trialing') add('settings.meta', JSON.stringify(await page.generateMetadata()));
  }

  // ---- emails ----------------------------------------------------------------------------------------------------------------------
  baseMocks({});
  {
    const j = (r: { subject: string; html: string; text: string }) => `${r.subject}\n${r.html}\n${r.text}`;
    const tpl = await import('@/lib/email/templates');
    add('mail.verify', j(tpl.renderVerifyEmail({ verifyUrl: 'https://localholler.test/api/auth/verify?t=abc&l=es', appUrl: 'https://localholler.test/app', lang: 'es' })));
    add('mail.reset', j(tpl.renderPasswordReset({ resetUrl: 'https://localholler.test/auth/confirm?token_hash=x&type=recovery&next=%2Fes%2Freset', lang: 'es' })));
    add('mail.welcome', j(tpl.renderWelcome({ businessName: BIZ, appUrl: 'https://localholler.test/app', lang: 'es' })));
    const confirm = await import('@/lib/mobile/verify-email');
    add('mail.confirm', j(confirm.renderConfirmEmailOnly({ verifyUrl: 'https://localholler.test/api/auth/verify?t=abc&l=es', appUrl: 'https://localholler.test/app' }, 'es')));
    const l = await import('@/lib/lifecycle/templates');
    const common = { businessName: BIZ, feedUrl: 'https://localholler.test/app', plansUrl: 'https://localholler.test/app/settings#billing-h', unsubscribeUrl: 'https://localholler.test/u', lang: 'es' as const };
    const items = [
      { title: 'Roof permit in Atlanta', city: 'Atlanta', state: 'GA', occurredAt: iso(-86_400_000), kind: 'permit', source: 'arcgis-atlanta-permits' },
      { title: 'Severe Thunderstorm Warning: Fulton, GA', city: 'Atlanta', state: 'GA', occurredAt: iso(-2 * 86_400_000), kind: 'alert', source: 'nws' },
      { title: '1.50 inch hail reported near 2 ESE Atlanta, GA', city: 'Atlanta', state: 'GA', occurredAt: iso(-3 * 86_400_000), kind: 'report', source: 'spc' },
    ];
    const data = [...DATA, '2 ESE Atlanta, GA'];
    add('mail.welcome-matches', j(l.renderWelcomeMatches({ ...common, total: 12, capped: true, items })), data);
    add('mail.welcome-matches.one', j(l.renderWelcomeMatches({ ...common, total: 1, items: items.slice(0, 1) })), data);
    add('mail.welcome-quiet', j(l.renderWelcomeQuiet({ ...common, lines: [{ label: 'building permits', count: 40, key: 'permit' }, { label: 'weather alerts', count: 3, key: 'weather-alert' }], total: 43, days: 90 })));
    add('mail.welcome-quiet.one', j(l.renderWelcomeQuiet({ ...common, lines: [{ label: 'inspection', count: 1, key: 'inspection' }], total: 1, days: 90 })));
    add('mail.trial-ending', j(l.renderTrialEnding({ ...common, items })), data);
    add('mail.trial-ending.one', j(l.renderTrialEnding({ ...common, items: items.slice(0, 1) })), data);
    add('mail.trial-ending.none', j(l.renderTrialEnding({ ...common, items: [] })));
    add('mail.trial-ended', j(l.renderTrialEnded({ ...common, missed: 7, capped: true })));
    add('mail.trial-ended.one', j(l.renderTrialEnded({ ...common, missed: 1 })));
    add('mail.trial-ended.zero', j(l.renderTrialEnded({ ...common, missed: 0 })));
    const m = await import('@/lib/moat/email');
    add(
      'mail.outcome',
      j(
        m.renderFollowUp({
          businessName: BIZ,
          items: [
            { title: 'Roof permit in Atlanta', kind: 'permit', source: 'arcgis-atlanta-permits', place: 'Atlanta, GA', occurredAt: iso(-8 * 86_400_000), yesUrl: 'https://localholler.test/y', noUrl: 'https://localholler.test/n' },
            { title: 'Severe Thunderstorm Warning: Fulton, GA', kind: 'alert', source: 'nws', place: 'Atlanta, GA', occurredAt: iso(-9 * 86_400_000), yesUrl: 'https://localholler.test/y2', noUrl: 'https://localholler.test/n2' },
          ],
          unsubscribeUrl: 'https://localholler.test/u',
          now: NOW,
          lang: 'es',
        }),
      ),
    );
  }

  // ---- token pages (confirm email, outcome answer) -------------------------------------------------------------------------------
  baseMocks({});
  {
    const v = await import('@/app/api/auth/verify/route');
    const { signVerifyToken } = await import('@/lib/email/token');
    const good = signVerifyToken('u1', 'test-secret', NOW.getTime());
    add('page.verify.get', await v.GET(new Request(`https://localholler.test/api/auth/verify?t=${encodeURIComponent(good)}&l=es`)).text());
    add('page.verify.invalid', await v.GET(new Request('https://localholler.test/api/auth/verify?t=bad&l=es')).text());
    const o = await import('@/app/api/feedback/outcome/route');
    const { signOutcomeToken } = await import('@/lib/moat/token');
    const yes = signOutcomeToken('u1', 9, 'yes', 'test-secret', NOW.getTime());
    add('page.outcome.get', await o.GET(new Request(`https://localholler.test/api/feedback/outcome?t=${encodeURIComponent(yes)}&l=es`)).text());
    add('page.outcome.invalid', await o.GET(new Request('https://localholler.test/api/feedback/outcome?t=bad&l=es')).text());
  }
  return out;
}
