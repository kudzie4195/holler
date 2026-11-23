/**
 * Round 18, unit ES: English output is byte-identical. Every English surface this unit gave a Spanish twin (the pricing page, the four
 * auth pages and their forms, the auth layout, onboarding, the /app layout and feed chrome, Settings in every billing state, account
 * deletion, the verify notice, and the welcome, verify, password reset, trial lifecycle and outcome-question emails) is rendered here
 * for an English member or visitor and compared with tests/i18n/fixtures/english-r18.json.
 *
 * That file was written by this test at the base commit with WRITE_ENGLISH_BASELINE=1, and is not edited by hand. Base: first 8bee203;
 * at the round 18 integration it was rewritten at 765687f (the five other round 18 units merged, before this unit), with this harness, so
 * the trial wording, the Lists link, the print classes and the work-profile section are in the base and only this unit's changes differ. The only intended English differences are listed in INTENDED below and checked on their own.
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
 *  - /privacy (redo 2): one new sentence on the holler_lang cookie, and the "Last updated" date.
 *  - /app layout (redo 1, review P2-4): the language-hint script after the header (components/app-header.tsx APP_LANG_SCRIPT). The static
 *    fallback header also carries data-es attributes; that is checked in "the static /app header" below.
 * (The other intended change, the "Español" link in the footer of /signup, /login, /forgot and /reset, depends on the path and is tested in
 * tests/i18n/es-account.test.ts; here the path is /app, where that link renders nothing.)
 */
const INTENDED: Record<string, [string, string][]> = {
  'pricing.html': [['href="/es">Español</a>', 'href="/es/pricing">Español</a>']],
  // Redo 2 (review 2 P2-2): the privacy page names the holler_lang cookie. NEEDS KUDZI. (Its date, November 22, 2026, is already in the
  // round 18 integration base: the trial unit moved it first, so it is no ES difference here.)
  'privacy.html': [
    [
      'Our city, trade and storm pages never read cookies on our servers.</p>',
      'Our city, trade and storm pages never read cookies on our servers.</p><p>Your browser also gets a cookie, holler_lang, that holds only en or es and remembers the language of your account pages in this browser for one year; it is not used for tracking, and logging out or deleting your account removes it.</p>',
    ],
  ],
};

/**
 * Round 19 integration (r19-metros merged with round 18): the English changes r19-metros made on purpose to these same surfaces, applied
 * to the round 18 base like INTENDED above (each must occur exactly once in the base):
 *  - the fifth Coming-next feature "More ZIP codes" (lib/interest/features.ts) on /pricing and every /app state; on /app the list's
 *    React id moves by one because the extra item is rendered before the section's heading id is taken;
 *  - /privacy: the waitlist paragraph now says sign-ups are double opt-in (round 19 review defect 1).
 * The "Who's building near you" panel is not here: it is off by default (HOLLER_BUILDERS_PANEL_ENABLED), so /app is otherwise unchanged.
 */
const MORE_AREAS_LI = "<li class=\"flex flex-col gap-3 border-b border-line py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-5\"><div class=\"min-w-0\"><h3 class=\"text-lg font-semibold text-ink\">More ZIP codes</h3><p class=\"mt-1 text-muted\">Permits and city requests in more places. Check your ZIP code to get one email when we reach it.</p></div><button type=\"button\" class=\"inline-flex max-w-full items-center justify-center gap-2 rounded-control text-center font-semibold whitespace-normal min-[22.5rem]:whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,filter] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 border border-line-strong bg-surface text-ink hover:border-ink hover:bg-sand min-h-11 px-5 text-base  w-full shrink-0 sm:w-36\" aria-label=\"I want this: More ZIP codes\">I want this</button></li>";
const R19_PRIVACY_FROM = "We save your email, that ZIP code, the trade you picked and the page you were on, with no account and no name. We use the email only to tell you when we cover that area. We do not set a cookie for it, and we do not share the email or use it for ads. Pressing the button again with the same email and ZIP saves nothing new.";
const R19_PRIVACY_TO = "We save your email, that ZIP code, the rough center of that ZIP code, the trade you picked and which version of the card&#x27;s wording you saw, with no account and no name. We send one email with a link to confirm the address; you are on the list only once you press it. We use the email only to confirm it and to tell you when we cover that area. We do not set a cookie for it, and we do not share the email or use it for ads. Pressing the button again with the same email and ZIP saves nothing new, and once the address is confirmed it sends nothing new either.";
const R19_COMING_NEXT_KEYS = ['pricing.html', 'app.trialing.html', 'app.trialing.unverified.html', 'app.trialing.1day.html', 'app.past_due.html', 'app.active.html', 'app.locked.html', 'app.locked.none.html'];
const R19_INTENDED: Record<string, [string, string][]> = {
  ...Object.fromEntries(
    R19_COMING_NEXT_KEYS.map((k) => [
      k,
      [
        ['Free weekly city email">I want this</button></li></ul>', `Free weekly city email">I want this</button></li>${MORE_AREAS_LI}</ul>`],
        ...(k.startsWith('app.') ? ([['aria-labelledby="_R_6_" class="mt-12 pt-2"><h2 id="_R_6_"', 'aria-labelledby="_R_7_" class="mt-12 pt-2"><h2 id="_R_7_"']] as [string, string][]) : []),
      ] as [string, string][],
    ]),
  ),
  'privacy.html': [[R19_PRIVACY_FROM, R19_PRIVACY_TO]],
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
  // The privacy page (redo 2: the holler_lang sentence and the date are its only intended changes).
  baseMocks({ user: null });
  {
    const privacy = await import('@/app/privacy/page');
    out['privacy.html'] = await renderResolved(createElement(privacy.default as never));
    out['privacy.meta'] = meta((privacy as { metadata?: unknown }).metadata);
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
    const { APP_LANG_SCRIPT } = await import('@/components/app-header');
    INTENDED['app-layout.html'] = [['</header><main', `</header><script type="text/javascript">${APP_LANG_SCRIPT}</script><main`]];
    for (const [k, swaps] of Object.entries(INTENDED)) {
      for (const [from, to] of swaps) {
        expect(base[k].split(from).length - 1, `${k}: ${from}`).toBe(1);
        base[k] = base[k].replace(from, to);
      }
    }
    for (const [k, swaps] of Object.entries(R19_INTENDED)) {
      for (const [from, to] of swaps) {
        expect(base[k].split(from).length - 1, `round 19 ${k}: ${from.slice(0, 60)}`).toBe(1);
        base[k] = base[k].replace(from, to);
      }
    }
    expect(MORE_AREAS_LI).toMatch(/^<li [^]*More ZIP codes[^]*Check your ZIP code to get one email when we reach it\.[^]*<\/li>$/);
    expect(MORE_AREAS_LI.split('<li').length - 1).toBe(1);
    for (const k of Object.keys(base)) expect(now[k], k).toBe(base[k]);
  }, 60_000);
});

describe('the /app head and static header (redo 1, review P2-2 and P2-4)', () => {
  it('/app and /app/settings keep static metadata, as on the base: no generateMetadata, the same titles, noindex from the layout', async () => {
    baseMocks({ profile: member() });
    const layout = await import('@/app/app/layout');
    expect(layout.metadata).toEqual({ title: { default: 'Your matches', template: '%s | Holler' }, robots: { index: false, follow: false } });
    const page = (await import('@/app/app/page')) as Record<string, unknown>;
    expect(page.generateMetadata).toBeUndefined();
    expect(page.metadata).toBeUndefined();
    const settings = (await import('@/app/app/settings/page')) as Record<string, unknown>;
    expect(settings.generateMetadata).toBeUndefined();
    expect(settings.metadata).toEqual({ title: 'Settings' });
    // the same as the base fixture's metadata of both pages
    const base = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
    expect(base['settings.meta']).toBe('{"title":"Settings"}');
    expect(base['app.meta']).toBe('{}');
  });

  it('the static fallback header is the base header plus data-es hints only', async () => {
    baseMocks({ profile: member() });
    const { AppHeaderBar, AppSkipLink } = await import('@/components/app-header');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const shell = renderToStaticMarkup(createElement('div', null, createElement(AppSkipLink, { lang: 'en', hint: true }), createElement(AppHeaderBar, { lang: 'en', hint: true })));
    expect(shell).toContain('data-es="Ajustes"');
    expect(shell).toContain('data-es="Salir"');
    expect(shell).toContain('data-es-label="Cerrar sesión"');
    const stripped = shell.replace(/ data-es(?:-label)?="[^"]*"/g, '');
    const base = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
    const baseHeader = base['app-layout.html'];
    // skip link, then the header's inner bar: every element of the fallback is in the base, in the same order
    const skip = baseHeader.slice(0, baseHeader.indexOf('<header'));
    const bar = baseHeader.slice(baseHeader.indexOf('<a class="inline-flex shrink-0'), baseHeader.indexOf('</nav>') + '</nav>'.length);
    expect(stripped).toBe(`<div>${skip}${bar}</div>`);
  });
});
