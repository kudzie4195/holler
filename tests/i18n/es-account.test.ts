/**
 * Round 18, unit ES: Spanish pricing, sign-up, log-in and password pages; signing up from a Spanish page; the signed-in app, Settings and
 * the account emails in Spanish. The English side is proven unchanged in english-identity-r18.test.ts, and the English-word scan of every
 * new Spanish surface is in english-leak.test.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';
import { NOW } from '../signals/brief-fixtures';

vi.mock('server-only', () => ({}));

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.restoreAllMocks();
});

const SPANISH_PAGES = ['/es/pricing', '/es/signup', '/es/login', '/es/forgot', '/es/reset'] as const;
const metaOf = async (p: string): Promise<Metadata> => (await import(`@/app${p}/page`)).metadata as Metadata;

describe('the Spanish pages: titles, canonical, hreflang, robots and sitemap', () => {
  it('each has its own Spanish title and description, its own canonical, and the hreflang pair with x-default English', async () => {
    const { ES_PAIRS } = await import('@/lib/i18n/seo');
    const titles = new Set<string>();
    const descs = new Set<string>();
    const home = (await import('@/app/es/page')).generateMetadata();
    titles.add(String((home.title as { absolute: string }).absolute));
    descs.add(String(home.description));
    for (const p of SPANISH_PAGES) {
      const m = await metaOf(p);
      const title = typeof m.title === 'string' ? m.title : (m.title as { absolute: string }).absolute;
      expect(title, p).toBeTruthy();
      expect(titles.has(title), `${p} title is unique`).toBe(false);
      expect(descs.has(String(m.description)), `${p} description is unique`).toBe(false);
      titles.add(title);
      descs.add(String(m.description));
      expect(String(m.description).length, p).toBeGreaterThan(60);
      const pair = ES_PAIRS.find((x) => x.es === p)!;
      expect(m.alternates, p).toEqual({ canonical: p, languages: { en: pair.en, es: p, 'x-default': pair.en } });
      expect((m.openGraph as { locale?: string }).locale, p).toBe('es_US');
    }
  });

  it('robots: pricing, sign-up, log-in and forgot are indexed; /es/reset (works only from an emailed link) and /es/confirm are not', async () => {
    for (const p of ['/es/pricing', '/es/signup', '/es/login', '/es/forgot']) {
      const r = (await metaOf(p)).robots as { index?: boolean } | undefined;
      expect(r?.index ?? true, p).toBe(true);
    }
    expect(((await metaOf('/es/reset')).robots as { index: boolean }).index).toBe(false);
    expect(((await metaOf('/es/confirm')).robots as { index: boolean }).index).toBe(false);
    // The Spanish layout sets no robots of its own, so nothing under /es is noindexed by accident.
    expect(readFileSync('app/es/layout.tsx', 'utf8')).not.toMatch(/robots|noindex/);
  });

  it('the English twins carry the pair back: /pricing keeps its canonical; the noindex account pages get hreflang only, no new canonical', async () => {
    expect((await import('@/app/pricing/page')).metadata.alternates).toEqual({ canonical: '/pricing', languages: { en: '/pricing', es: '/es/pricing', 'x-default': '/pricing' } });
    for (const p of ['signup', 'login', 'forgot', 'reset']) {
      const m = (await import(`@/app/(auth)/${p}/page`)).metadata as Metadata;
      expect(m.alternates, p).toEqual({ languages: { en: `/${p}`, es: `/es/${p}`, 'x-default': `/${p}` } });
    }
  });

  it('the pricing title is under 60 characters and its description 120 to 160, as the English page', async () => {
    const { PRICING_TITLE_ES, PRICING_DESCRIPTION_ES } = await import('@/lib/plan/pricing-page-es');
    expect(PRICING_TITLE_ES.length).toBeLessThanOrEqual(60);
    expect(PRICING_DESCRIPTION_ES.length).toBeGreaterThanOrEqual(120);
    expect(PRICING_DESCRIPTION_ES.length).toBeLessThanOrEqual(160);
  });

  it('sitemap: /pricing and /es/pricing with the same hreflang set; /es/signup, /es/login, /es/forgot listed; /es/reset and /es/confirm not', async () => {
    const { buildEntries } = await import('@/lib/seo/sitemap-entries');
    const entries = buildEntries({ places: { ok: true, counts: {}, latest: {} } as never, trades: [] });
    const by = (p: string) => entries.find((e) => new URL(e.url).pathname === p);
    expect(by('/pricing')!.alternates).toEqual(by('/es/pricing')!.alternates);
    for (const p of ['/es/signup', '/es/login', '/es/forgot']) {
      expect(by(p), p).toBeDefined();
      expect(new URL(by(p)!.alternates!.languages['x-default']).pathname, p).toBe(p.replace('/es', ''));
    }
    expect(by('/es/reset')).toBeUndefined();
    expect(by('/es/confirm')).toBeUndefined();
  });

  it('the FAQ on /es/pricing is Spanish structured data in Spanish (inLanguage es), with the same six questions as the English page', async () => {
    const es = await import('@/lib/plan/pricing-page-es');
    const en = await import('@/lib/plan/pricing-page');
    expect(es.PRICING_FAQ_ES).toHaveLength(en.PRICING_FAQ.length);
    expect(es.pricingFaqLdEs().inLanguage).toBe('es');
    expect(es.pricingLdEs().inLanguage).toBe('es');
    expect(JSON.stringify(es.pricingLdEs())).toContain('/es/pricing');
  });
});

describe('the /es links: "(en inglés)" only where the page is still English', () => {
  it('/es links pricing and sign-up to the Spanish pages; privacy, terms and the full FAQ keep "(en inglés)"', async () => {
    const html = renderToStaticMarkup((await import('@/app/es/page')).default());
    for (const href of ['/es/pricing', '/es/signup', '/es/login']) expect(html, href).toContain(`href="${href}"`);
    for (const label of ['Privacidad (en inglés)', 'Términos (en inglés)', 'Todas las preguntas (en inglés)']) expect(html, label).toContain(label);
    for (const gone of ['Precios (en inglés)', 'Empezar gratis (en inglés)', 'Iniciar sesión (en inglés)', 'Ver los planes (en inglés)']) expect(html, gone).not.toContain(gone);
  });
  it('the English sign-up, log-in and password pages link to their Spanish twin; other paths get no link', async () => {
    vi.doMock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), usePathname: () => '/signup' }));
    const { AuthLanguageLink } = await import('@/components/auth-language-link');
    const html = renderToStaticMarkup(createElement(AuthLanguageLink));
    expect(html).toBe('<a href="/es/signup" lang="es" hrefLang="es" class="inline-flex min-h-11 min-w-11 items-center underline decoration-1 underline-offset-4 hover:text-ink">Español</a>');
    vi.resetModules();
    vi.doMock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), usePathname: () => '/app' }));
    const again = await import('@/components/auth-language-link');
    expect(renderToStaticMarkup(createElement(again.AuthLanguageLink))).toBe('');
  });
});

describe('prices, plan names and the trial length', () => {
  it('the trial phrase comes from TRIAL_DAYS through the Spanish helper, never a typed number', async () => {
    const { TRIAL_DAYS } = await import('@/lib/plan/price-copy');
    const pc = await import('@/lib/plan/price-copy-es');
    expect(pc.trialPhraseEs()).toBe(`prueba gratis de ${TRIAL_DAYS} días`);
    expect(pc.trialPhraseEs(30)).toBe('prueba gratis de 30 días');
    expect(pc.trialDaysFreeEs(21)).toBe('21 días gratis');
    // no Spanish string of this unit types the trial length
    const { ES_ACCOUNT } = await import('@/lib/i18n/es-account');
    for (const [k, v] of Object.entries(ES_ACCOUNT)) expect(v, k).not.toMatch(new RegExp(`(?<!\\d)${TRIAL_DAYS}(?!\\d)`));
    expect(readFileSync('lib/plan/price-copy-es.ts', 'utf8')).not.toMatch(new RegExp(`(?<![\\d.])${TRIAL_DAYS}(?![\\d.])`));
    // the verify and welcome emails follow a different trial length
    const tpl = await import('@/lib/email/templates');
    expect(tpl.renderVerifyEmail({ verifyUrl: 'https://x.test/v', appUrl: 'https://x.test/app', lang: 'es', trialDays: 30 }).text).toContain('prueba gratis de 30 días');
    expect(tpl.renderWelcome({ businessName: 'X', appUrl: 'https://x.test/app', lang: 'es', trialDays: 30 }).text).toContain('prueba gratis de 30 días');
  });
  it('prices come from the price table; plan names are "Plan Solo" / "Plan Pro", a price after a colon', async () => {
    const { priceLabel } = await import('@/lib/stripe/plans');
    const pc = await import('@/lib/plan/price-copy-es');
    expect(pc.namedPlanPricesEs('starter')).toBe(`Plan Solo: ${priceLabel('starter', 'monthly')} al mes o ${priceLabel('starter', 'annual')} al año`);
    expect(pc.planNameEs('pro')).toBe('Plan Pro');
    const { es } = await import('@/lib/i18n/es');
    expect(es['price.line']).toBe('Plan {starter}: {a} al mes o {b} al año. Plan {pro}: {c} al mes o {d} al año.');
  });
});

// ---- sign-up from a Spanish page ----------------------------------------------------------------------------------------------------
function signupMocks(opts: { limited?: 'limited' | 'error'; taken?: boolean } = {}) {
  vi.resetModules();
  const calls = { create: [] as any[], verify: [] as any[], after: [] as (() => Promise<void>)[] };
  vi.doMock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (cb: () => Promise<void>) => calls.after.push(cb) }));
  vi.doMock('@/lib/auth/ratelimit', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/ratelimit')>()), hit: async () => opts.limited ?? 'allowed' }));
  vi.doMock('@/lib/supabase/admin', () => ({
    createAdminClient: () => ({
      auth: {
        admin: {
          createUser: async (a: any) => {
            calls.create.push(a);
            return opts.taken ? { data: null, error: { code: 'email_exists' } } : { data: { user: { id: 'u-new' } }, error: null };
          },
        },
      },
    }),
  }));
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }) }));
  vi.doMock('@/lib/auth/verification', () => ({ sendVerifyEmail: async (...a: any[]) => void calls.verify.push(a) }));
  return calls;
}
const jsonReq = (url: string, body: unknown, type = 'application/json') => new Request(url, { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) });

describe('POST /api/auth/signup from the Spanish page', () => {
  it('parks the language in app_metadata, answers in Spanish, sends the Spanish welcome + verify email, and goes to /es/onboarding', async () => {
    const calls = signupMocks();
    const { POST } = await import('@/app/api/auth/signup/route');
    const res = await POST(jsonReq('https://x.test/api/auth/signup', { email: 'A@B.com', password: 'longenough', lang: 'es' }));
    expect(await res.json()).toEqual({ ok: true, signedIn: true, next: '/es/onboarding' });
    expect(calls.create[0].app_metadata).toEqual({ products: ['holler'], holler_language: 'es' });
    for (const cb of calls.after) await cb();
    expect(calls.verify).toEqual([['u-new', 'a@b.com', 'es']]);
  });
  it('an English body is exactly as before: no language parked, the English email', async () => {
    const calls = signupMocks();
    const { POST } = await import('@/app/api/auth/signup/route');
    const res = await POST(jsonReq('https://x.test/api/auth/signup', { email: 'a@b.com', password: 'longenough' }));
    expect(await res.json()).toEqual({ ok: true, signedIn: true, next: '/onboarding' });
    expect(calls.create[0].app_metadata).toEqual({ products: ['holler'] });
    for (const cb of calls.after) await cb();
    expect(calls.verify).toEqual([['u-new', 'a@b.com']]);
  });
  it('a language value other than exactly "es" is English', async () => {
    const calls = signupMocks();
    const { POST } = await import('@/app/api/auth/signup/route');
    await POST(jsonReq('https://x.test/api/auth/signup', { email: 'a@b.com', password: 'longenough', lang: 'ES' }));
    expect(calls.create[0].app_metadata).toEqual({ products: ['holler'] });
  });
  it('keeps every protection: the JSON-only CSRF guard (415), the rate limit (429, Spanish), and the generic answer for a taken email', async () => {
    signupMocks();
    let { POST } = await import('@/app/api/auth/signup/route');
    const form = await POST(jsonReq('https://x.test/api/auth/signup', { email: 'a@b.com', password: 'longenough', lang: 'es' }, 'text/plain'));
    expect(form.status).toBe(415);
    signupMocks({ limited: 'limited' });
    ({ POST } = await import('@/app/api/auth/signup/route'));
    const limited = await POST(jsonReq('https://x.test/api/auth/signup', { email: 'a@b.com', password: 'longenough', lang: 'es' }));
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe('Demasiados intentos. Espere un rato e intente de nuevo.');
    const taken = signupMocks({ taken: true });
    ({ POST } = await import('@/app/api/auth/signup/route'));
    const t = await POST(jsonReq('https://x.test/api/auth/signup', { email: 'a@b.com', password: 'longenough', lang: 'es' }));
    expect(await t.json()).toEqual({ ok: true, signedIn: false, next: '/es/login', message: 'Si ya tiene una cuenta, inicie sesión.' });
    expect(taken.verify).toEqual([]);
  });
  it('validation messages are in the language of the form', async () => {
    signupMocks();
    const { POST } = await import('@/app/api/auth/signup/route');
    const es = await POST(jsonReq('https://x.test/api/auth/signup', { email: 'nope', password: 'longenough', lang: 'es' }));
    expect((await es.json()).error).toBe('Escriba un correo electrónico válido.');
    const short = await POST(jsonReq('https://x.test/api/auth/signup', { email: 'a@b.com', password: 'short', lang: 'es' }));
    expect((await short.json()).error).toBe('Use al menos 8 caracteres.');
    const en = await POST(jsonReq('https://x.test/api/auth/signup', { email: 'nope', password: 'longenough' }));
    expect((await en.json()).error).toBe('Enter a valid email address.');
  });
});

// ---- onboarding writes the language to the profile ----------------------------------------------------------------------------------
function onboardingMocks(langResult: { error: { code?: string; message?: string } | null }, appMeta: Record<string, unknown> = { holler_language: 'es' }) {
  vi.resetModules();
  const h = { order: [] as string[], updates: [] as any[], saveOpts: [] as any[] };
  vi.doMock('next/navigation', () => ({ redirect: (to: string) => { h.order.push(`redirect:${to}`); throw new Error('redirect'); } }));
  vi.doMock('@/lib/auth/session', () => ({ getUser: async () => ({ id: 'u1', app_metadata: appMeta }) }));
  vi.doMock('@/lib/auth/profile', () => ({ saveProfile: async (_u: string, _f: FormData, o?: any) => (h.saveOpts.push(o), { ok: true, message: 'Guardado.' }) }));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: async () => ({ from: () => ({ update: (patch: unknown) => ({ eq: async () => (h.updates.push(patch), langResult) }) }) }),
  }));
  // Round 18 integration: partial, so the trial unit's repairShortTrial (used by /app since the merge) stays real for later tests.
  vi.doMock('@/lib/auth/trial', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/trial')>()), applyTrialRules: async () => 'first' }));
  vi.doMock('@/lib/analytics/request', () => ({ recordSignup: async () => {} }));
  vi.doMock('@/lib/analytics/signup', () => ({ priorTrial: async () => 'none', shouldRecordSignup: () => false }));
  vi.doMock('@/lib/signals/backfill-run', () => ({ backfillWithLimit: async () => ({ ran: true }) }));
  vi.doMock('@/lib/auth/verification', () => ({ applyPendingVerification: async () => {} }));
  return h;
}
const form = (entries: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe('onboarding after a Spanish sign-up', () => {
  it('saves language "es" on the new profile and goes on to the Spanish preview; the save answers in Spanish', async () => {
    const h = onboardingMocks({ error: null });
    const { completeOnboarding } = await import('@/app/onboarding/actions');
    await expect(completeOnboarding({}, form({ ui_lang: 'es' }))).rejects.toThrow('redirect');
    expect(h.updates).toEqual([{ language: 'es' }]);
    expect(h.saveOpts).toEqual([{ lang: 'es' }]);
    expect(h.order).toEqual(['redirect:/es/onboarding/preview']);
  });
  it('migration 0024 NOT applied (42703 / PGRST204): sign-up still finishes, nothing errors, and the account stays English', async () => {
    for (const error of [{ code: '42703', message: 'column "language" of relation "holler_profiles" does not exist' }, { code: 'PGRST204', message: "Could not find the 'language' column of 'holler_profiles' in the schema cache" }]) {
      const h = onboardingMocks({ error });
      const { completeOnboarding } = await import('@/app/onboarding/actions');
      await expect(completeOnboarding({}, form({ ui_lang: 'es' }))).rejects.toThrow('redirect');
      expect(h.order).toEqual(['redirect:/onboarding/preview']);
    }
  });
  it('an English onboarding writes no language and goes where it always went', async () => {
    const h = onboardingMocks({ error: null }, { products: ['holler'] });
    const { completeOnboarding } = await import('@/app/onboarding/actions');
    await expect(completeOnboarding({}, form())).rejects.toThrow('redirect');
    expect(h.updates).toEqual([]);
    expect(h.saveOpts).toEqual([undefined]);
    expect(h.order).toEqual(['redirect:/onboarding/preview']);
  });
});

// ---- password reset email language -------------------------------------------------------------------------------------------------
function forgotMocks(profileRead: { data: unknown; error: unknown } | 'throw', appMeta: Record<string, unknown> = {}) {
  vi.resetModules();
  const h = { after: [] as (() => Promise<void>)[], sent: [] as any[] };
  vi.doMock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (cb: () => Promise<void>) => h.after.push(cb) }));
  vi.doMock('@/lib/auth/ratelimit', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/ratelimit')>()), hit: async () => 'allowed' }));
  vi.doMock('@/lib/env', async (orig) => ({ ...(await orig<typeof import('@/lib/env')>()), siteUrl: 'https://localholler.test' }));
  vi.doMock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail: async (m: any) => (h.sent.push(m), { ok: true }) }));
  vi.doMock('@/lib/supabase/admin', () => ({
    createAdminClient: () => ({
      rpc: async () => ({ data: 'u1', error: null }),
      auth: { admin: { generateLink: async () => ({ data: { properties: { hashed_token: 'HASH' }, user: { id: 'u1', app_metadata: appMeta } }, error: null }) } },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (profileRead === 'throw') throw new Error('down');
              return profileRead;
            },
          }),
        }),
      }),
    }),
  }));
  return h;
}

describe('POST /api/auth/forgot: the reset email is in the member\'s language', () => {
  const ask = async (lang?: string) => {
    const { POST } = await import('@/app/api/auth/forgot/route');
    return POST(jsonReq('https://x.test/api/auth/forgot', lang ? { email: 'a@b.com', lang } : { email: 'a@b.com' }));
  };
  it('from the Spanish page, with no profile yet: Spanish email, link to /es/reset', async () => {
    const h = forgotMocks({ data: null, error: null });
    expect((await ask('es')).status).toBe(200);
    for (const cb of h.after) await cb();
    expect(h.sent[0].subject).toBe('Cambie su contraseña de Holler');
    expect(h.sent[0].text).toContain(encodeURIComponent('/es/reset'));
  });
  it("the member's saved language wins over the page: an es member asking on the English page gets Spanish; an en member on the Spanish page gets English", async () => {
    let h = forgotMocks({ data: { language: 'es' }, error: null });
    await ask();
    for (const cb of h.after) await cb();
    expect(h.sent[0].subject).toBe('Cambie su contraseña de Holler');
    h = forgotMocks({ data: { language: 'en' }, error: null });
    await ask('es');
    for (const cb of h.after) await cb();
    expect(h.sent[0].subject).toBe('Reset your Holler password');
    expect(h.sent[0].text).toContain(encodeURIComponent('/reset'));
    expect(h.sent[0].text).not.toContain(encodeURIComponent('/es/reset'));
  });
  it('without migration 0024 (42703) or with the read down: the language parked at sign-up, then the page', async () => {
    let h = forgotMocks({ data: null, error: { code: '42703', message: 'column "language" does not exist' } }, { holler_language: 'es' });
    await ask();
    for (const cb of h.after) await cb();
    expect(h.sent[0].subject).toBe('Cambie su contraseña de Holler');
    h = forgotMocks('throw');
    await ask();
    for (const cb of h.after) await cb();
    expect(h.sent[0].subject).toBe('Reset your Holler password');
  });
});

describe('POST /api/auth/reset keeps the reset-proof rule in Spanish', () => {
  it('a Spanish form without the recovery proof gets 403 and the Spanish "expired" answer; the password is not touched', async () => {
    vi.resetModules();
    const updateUser = vi.fn(async () => ({ error: null }));
    vi.doMock('@/lib/env', () => ({ env: { CRON_SECRET: 's' }, siteUrl: 'https://x.test' }));
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }), getClaims: async () => ({ data: { claims: { sub: 'u1', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] } } }), updateUser } }),
    }));
    const { POST } = await import('@/app/api/auth/reset/route');
    const res = await POST(jsonReq('https://x.test/api/auth/reset', { password: 'longenough', lang: 'es' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Este enlace para cambiar la contraseña venció. Pida uno nuevo.');
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe('the recovery link for a Spanish email stays in Spanish', () => {
  it('GET /auth/confirm sends next=/es/... to /es/confirm and every other link to /auth/confirm/continue; a failed link goes to /es/forgot', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { verifyOtp: async () => ({ data: null, error: { message: 'x' } }) } }) }));
    vi.doMock('@/lib/auth/origin', () => ({ originAllowed: () => true }));
    const { NextRequest } = await import('next/server');
    const { GET, POST } = await import('@/app/auth/confirm/route');
    const es = GET(new NextRequest('https://x.test/auth/confirm?token_hash=h&type=recovery&next=%2Fes%2Freset'));
    expect(new URL(es.headers.get('location')!).pathname).toBe('/es/confirm');
    expect(new URL(es.headers.get('location')!).searchParams.get('token_hash')).toBe('h');
    const en = GET(new NextRequest('https://x.test/auth/confirm?token_hash=h&type=recovery&next=%2Freset'));
    expect(new URL(en.headers.get('location')!).pathname).toBe('/auth/confirm/continue');
    const evil = GET(new NextRequest('https://x.test/auth/confirm?token_hash=h&type=recovery&next=%2F%2Fevil.test%2Fes%2Fx'));
    expect(new URL(evil.headers.get('location')!).pathname).toBe('/auth/confirm/continue');
    const body = new URLSearchParams({ token_hash: 'h', type: 'recovery', next: '/es/reset' });
    const fail = await POST(new NextRequest('https://x.test/auth/confirm', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    expect(new URL(fail.headers.get('location')!).pathname).toBe('/es/forgot');
  });
  it('/es/confirm is a token page: Referrer-Policy no-referrer like /auth/confirm/continue', async () => {
    const { TOKEN_PAGE_PATHS } = await import('@/lib/security-headers');
    expect(TOKEN_PAGE_PATHS).toContain('/es/confirm');
  });
});

// ---- the app shell, Settings and the emails --------------------------------------------------------------------------------------------
describe('the signed-in app for a Spanish member', () => {
  it('the /app layout stays static: the header for the member streams in behind Suspense, with the hinted English header as the fallback', () => {
    const src = readFileSync('app/app/layout.tsx', 'utf8');
    expect(src).not.toMatch(/cookies\(|headers\(|connection\(|getUser|getProfile|createClient/);
    expect(src).toContain('<Suspense fallback={<AppHeaderBar lang="en" hint />}>');
    expect(src).toContain('<Suspense fallback={<AppSkipLink lang="en" hint />}>');
    expect(src).toContain('<AppLangScript />');
  });
  it('header, banners, Settings and billing are Spanish; the page titles too', async () => {
    const { renderSpanish } = await import('./r18-spanish');
    const all = await renderSpanish();
    const txt = (k: string) => all[k].out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // Round 18 integration: the lists unit's link sits between the two (hidden below 375 px by its class, still in the markup).
    expect(txt('app.layout')).toContain('Coincidencias Listas Ajustes Salir');
    expect(all['app.layout'].out).toContain('aria-label="Cerrar sesión"');
    expect(txt('app.trialing')).toContain('Le quedan 5 días de prueba gratis.');
    expect(txt('app.trialing.1day')).toContain('Le queda 1 día de prueba gratis.');
    expect(txt('app.past_due')).toContain('Su último pago no se procesó.');
    expect(txt('app.locked')).toContain('Su prueba gratis terminó');
    expect(txt('app.locked')).toContain('Plan Solo: $7.99 al mes. Plan Pro: $13.99 al mes');
    const { APP_TITLES_ES } = await import('@/components/app-header');
    expect(APP_TITLES_ES).toEqual({ '/app': 'Sus coincidencias | Holler', '/app/settings': 'Configuración | Holler' });
    expect(txt('settings.trialing')).toContain('Prueba gratis: le quedan 5 días.');
    expect(txt('settings.active.solo')).toContain('Cambiar al Plan Pro');
    expect(txt('settings.active.pro')).toContain('Cambiar al Plan Solo');
    expect(txt('settings.store.apple')).toContain('Usted paga Holler a través de la App Store.');
    expect(txt('settings.shadow.google')).toContain('Eliminar su cuenta no cancela su plan en Google Play.');
    expect(txt('settings.trialing.nostripe')).toContain('Los pagos abren pronto.');
    expect(all['settings.trialing'].out).toContain('name="ui_lang" value="es"');
  }, 120_000);
});

describe('the Settings and account answers in Spanish', () => {
  it('the profile save answers in the member\'s language; English answers are the old literals', async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/auth/profile'); // doMock (onboarding tests above) outlives resetModules
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
    const { saveProfile } = await import('@/lib/auth/profile');
    const bad = form({ business_name: 'x', zip: '12' });
    const es = await saveProfile('u1', bad, { lang: 'es', db: {} as never });
    expect(es.error).toBe('Corrija los campos marcados e intente de nuevo.');
    expect(es.fieldErrors?.business_name).toBe('Escriba el nombre de su negocio.');
    expect(es.fieldErrors?.zip).toBe('Escriba un código postal de 5 dígitos.');
    const en = await saveProfile('u1', bad, { db: {} as never });
    expect(en.error).toBe('Fix the highlighted fields and try again.');
    expect(en.fieldErrors?.zip).toBe('Enter a 5-digit ZIP code.');
  });
});

describe('the account emails in Spanish', () => {
  it('subjects are Spanish, html says lang="es", and the English emails are untouched by a missing lang', async () => {
    const tpl = await import('@/lib/email/templates');
    const v = tpl.renderVerifyEmail({ verifyUrl: 'https://x.test/v', appUrl: 'https://x.test/app', lang: 'es' });
    expect(v.subject).toBe('Holler: confirme su correo para empezar');
    expect(v.html).toContain('lang="es"');
    expect(tpl.renderPasswordReset({ resetUrl: 'https://x.test/r', lang: 'es' }).subject).toBe('Cambie su contraseña de Holler');
    expect(tpl.renderWelcome({ businessName: 'X', appUrl: 'https://x.test/app', lang: 'es' }).subject).toBe('Le damos la bienvenida a Holler');
    expect(tpl.renderVerifyEmail({ verifyUrl: 'https://x.test/v', appUrl: 'https://x.test/app', lang: 'en' })).toEqual(tpl.renderVerifyEmail({ verifyUrl: 'https://x.test/v', appUrl: 'https://x.test/app' }));
  });
  it('the lifecycle run uses the member\'s language; a failing language read sends the English email', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { buildMail } = await import('@/lib/lifecycle/run');
    const store: any = { matchesOf: async () => ({ total: 0, capped: false, items: [] }), quietPreview: async () => ({ lines: [{ label: 'building permits', count: 4, key: 'permit' }], total: 4, capped: false, days: 90 }), missedSince: async () => ({ count: 2, capped: false }) };
    const p: any = { user_id: 'u1', business_name: 'Techos Ramírez' };
    const deps = { store, siteUrl: 'https://x.test', secret: 's' };
    const es = await buildMail('trial_ended', p, { ...deps, langFor: async () => 'es' }, NOW);
    expect(es!.subject).toBe('Sus alertas están en pausa');
    const quiet = await buildMail('welcome', p, { ...deps, langFor: async () => 'es' }, NOW);
    expect(quiet!.text).toContain('permisos de construcción (4)');
    const broken = await buildMail('trial_ended', p, { ...deps, langFor: async () => { throw new Error('42703'); } }, NOW);
    expect(broken!.subject).toBe('Your alerts are paused');
    const none = await buildMail('trial_ended', p, deps, NOW);
    expect(none).toEqual(broken);
  });
  it('the outcome question: Spanish subject and answer links that say l=es', async () => {
    const m = await import('@/lib/moat/email');
    const r = m.renderFollowUp({ businessName: 'X', items: [{ title: 'Roof permit in Atlanta', kind: 'permit', source: 'arcgis-atlanta-permits', place: 'Atlanta, GA', occurredAt: NOW.toISOString(), yesUrl: 'https://x.test/y', noUrl: 'https://x.test/n' }], unsubscribeUrl: 'https://x.test/u', now: NOW, lang: 'es' });
    expect(r.subject).toBe('¿Alguna de estas alertas se convirtió en trabajo?');
    expect(r.text).toContain('Permiso de techo en Atlanta');
    expect(readFileSync('lib/moat/run.ts', 'utf8')).toContain("const l = lang === 'en' ? '' : `&l=${lang}`;");
  });
});
