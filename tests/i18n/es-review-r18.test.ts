/**
 * Round 18 ES, redo 1: regression tests for the review (/home/claude/gates/r18/review/review-ES.md).
 *  P1-1 header labels; P2-1 proxy gate on the Spanish account pages; P2-2 static /app head (english-identity-r18.test.ts);
 *  P2-3 and P2-4 the holler_lang hint cookie, the inline script and <html lang>; P3-3 sign-out and expired session keep the language.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---- P2-1: the proxy gate --------------------------------------------------------------------------------------------------------
async function proxyFor(signedIn: boolean) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.doMock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getClaims: async () => ({ data: signedIn ? { claims: { sub: 'u1' } } : null }) } }) }));
  const { NextRequest } = await import('next/server');
  const { updateSession } = await import('@/lib/supabase/proxy');
  return async (path: string, cookie?: string) => {
    const res = await updateSession(new NextRequest(`https://x.test${path}`, cookie ? { headers: { cookie } } : {}));
    const loc = res.headers.get('location');
    return { status: res.status, to: loc ? new URL(loc).pathname + new URL(loc).search : null };
  };
}

describe('P2-1: the Spanish account pages go through the same gate as the English ones', () => {
  it('the matcher covers /es/login, /es/signup, /es/forgot and /es/onboarding (with /preview)', () => {
    const src = readFileSync('proxy.ts', 'utf8');
    for (const p of ["'/es/login'", "'/es/signup'", "'/es/forgot'", "'/es/onboarding/:path*'"]) expect(src, p).toContain(p);
  });
  it('signed in: /es/login, /es/signup and /es/forgot send to /app, as /login does', async () => {
    const go = await proxyFor(true);
    for (const p of ['/login', '/signup', '/forgot', '/es/login', '/es/signup', '/es/forgot']) expect(await go(p), p).toEqual({ status: 307, to: '/app' });
    expect((await go('/es/onboarding')).to).toBeNull();
  });
  it('signed out: /es/onboarding and its preview go to /es/login with next; /app goes to /es/login only with the Spanish hint', async () => {
    const go = await proxyFor(false);
    expect(await go('/es/onboarding')).toEqual({ status: 307, to: '/es/login?next=%2Fes%2Fonboarding' });
    expect(await go('/es/onboarding/preview')).toEqual({ status: 307, to: '/es/login?next=%2Fes%2Fonboarding%2Fpreview' });
    expect(await go('/app')).toEqual({ status: 307, to: '/login?next=%2Fapp' });
    expect(await go('/app/settings', 'holler_lang=es')).toEqual({ status: 307, to: '/es/login?next=%2Fapp%2Fsettings' });
    expect(await go('/app', 'holler_lang=en')).toEqual({ status: 307, to: '/login?next=%2Fapp' });
    expect(await go('/onboarding')).toEqual({ status: 307, to: '/login?next=%2Fonboarding' });
    expect((await go('/es/login')).to).toBeNull();
  });
});

// ---- P2-4: the hint cookie ----------------------------------------------------------------------------------------------------------
describe('P2-4: the holler_lang hint cookie', () => {
  it('holds only "en" or "es": not HttpOnly (the inline script reads it), Secure, SameSite=Lax, Path=/', async () => {
    const { langCookieOptions, setLangCookie, clearLangCookie, langFromCookieValue } = await import('@/lib/auth/lang-cookie');
    expect(langCookieOptions()).toEqual({ path: '/', sameSite: 'lax', secure: true, httpOnly: false, maxAge: 31_536_000 });
    const set: any[] = [];
    const res = { cookies: { set: (...a: any[]) => set.push(a) } };
    setLangCookie(res, 'es');
    clearLangCookie(res);
    expect(set).toEqual([
      ['holler_lang', 'es', langCookieOptions()],
      ['holler_lang', '', { ...langCookieOptions(), maxAge: 0, expires: new Date(0) }],
    ]);
    for (const v of ['es']) expect(langFromCookieValue(v)).toBe('es');
    for (const v of ['ES', 'fr', '', null, undefined, 'es;x=1']) expect(langFromCookieValue(v as string)).toBe('en');
  });

  async function login(profileLanguage: unknown, appMeta: Record<string, unknown> = {}) {
    vi.resetModules();
    vi.doMock('@/lib/auth/ratelimit', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/ratelimit')>()), hit: async () => 'allowed' }));
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { signInWithPassword: async () => ({ data: { user: { id: 'u1', app_metadata: { products: ['holler'], ...appMeta } } }, error: null }) } }) }));
    vi.doMock('@/lib/supabase/admin', () => ({
      // select('*'): a row with the column, a row without it (migration 0024 not applied), no row yet, or a failed read
      createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (profileLanguage === 'no-column' ? { data: { user_id: 'u1' }, error: null } : profileLanguage === 'no-row' ? { data: null, error: null } : profileLanguage === 'error' ? { data: null, error: { code: '500' } } : { data: { user_id: 'u1', language: profileLanguage }, error: null }) }) }) }) }),
    }));
    const { POST } = await import('@/app/api/auth/login/route');
    return POST(new Request('https://x.test/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com', password: 'pw' }) }));
  }
  // Review 2 P2-1: the hint follows the same rule as the pages (lib/auth/member-lang.ts memberLang). A profile row decides, and a row
  // without the language column (migration 0024 not applied) is English even for a Spanish-page sign-up; the parked sign-up language
  // counts only while there is no row; a failed read is English.
  it('sign-in sets it exactly as the pages read the language; the answer body is unchanged', async () => {
    const es = await login('es');
    expect(await es.json()).toEqual({ ok: true });
    expect(es.headers.get('set-cookie')).toMatch(/^holler_lang=es; Path=\/; Expires=[^;]+; Max-Age=31536000; Secure; SameSite=lax$/i);
    expect((await login('en', { holler_language: 'es' })).headers.get('set-cookie')).toMatch(/^holler_lang=en;/);
    expect((await login('no-column', { holler_language: 'es' })).headers.get('set-cookie')).toMatch(/^holler_lang=en;/);
    expect((await login('no-row', { holler_language: 'es' })).headers.get('set-cookie')).toMatch(/^holler_lang=es;/);
    expect((await login('no-row')).headers.get('set-cookie')).toMatch(/^holler_lang=en;/);
    expect((await login('error', { holler_language: 'es' })).headers.get('set-cookie')).toMatch(/^holler_lang=en;/);
    expect((await login('es')).headers.get('set-cookie')).not.toMatch(/HttpOnly/i);
  });

  it('sign-out really deletes it, also when Next merges the Set-Cookie headers of a handler that set a cookie through next/headers', async () => {
    // What Next does (next/dist/server/web/spec-extension/adapters/request-cookies.js appendMutableCookies): re-parse every Set-Cookie
    // of the returned response and write it again. A bare Max-Age=0 does not survive that; the expired date does.
    const { ResponseCookies } = (await import('next/dist/compiled/@edge-runtime/cookies')) as { ResponseCookies: new (h: Headers) => any };
    const { clearLangCookie } = await import('@/lib/auth/lang-cookie');
    const h = new Headers();
    clearLangCookie({ cookies: new ResponseCookies(h) });
    const rc = new ResponseCookies(h);
    const returned = rc.getAll();
    rc.set({ name: 'sb-x-auth-token', value: '', path: '/', maxAge: 0 });
    for (const c of returned) rc.set(c);
    const after = h.getSetCookie().find((x) => x.startsWith('holler_lang='))!;
    expect(after).toMatch(/^holler_lang=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT;/);
  });

  it('account deletion deletes it too', () => {
    const src = readFileSync('app/app/settings/actions.ts', 'utf8');
    expect(src).toMatch(/await clearLangCookieFromAction\(\);\s*redirect\(lang === 'en' \? '\/' : '\/es'\);/);
  });

  it('sign-out clears it, and a Spanish member lands on /es (P3-3)', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { signOut: async () => ({}) } }) }));
    const { NextRequest } = await import('next/server');
    const { POST } = await import('@/app/api/auth/signout/route');
    const es = await POST(new NextRequest('https://x.test/api/auth/signout', { method: 'POST', headers: { cookie: 'holler_lang=es' } }));
    expect(new URL(es.headers.get('location')!).pathname).toBe('/es');
    expect(es.headers.get("set-cookie")).toMatch(/^holler_lang=; Path=\/;(?: Expires=[^;]+;)? Max-Age=0; Secure; SameSite=lax$/i);
    const en = await POST(new NextRequest('https://x.test/api/auth/signout', { method: 'POST' }));
    expect(new URL(en.headers.get('location')!).pathname).toBe('/');
  });

  it('onboarding and the language save set it (server actions, through next/headers)', () => {
    expect(readFileSync('app/onboarding/actions.ts', 'utf8')).toContain("await setLangCookieFromAction(spanish ? 'es' : 'en');");
    expect(readFileSync('app/app/settings/actions.ts', 'utf8')).toContain("await setLangCookieFromAction(parseLang(formData.get('language')));");
    expect(readFileSync('app/api/auth/signup/route.ts', 'utf8')).toContain('setLangCookie(res, lang);');
  });
});

// ---- P2-3 and P2-4: the inline script ------------------------------------------------------------------------------------------------
type El = { textContent: string; attrs: Record<string, string>; getAttribute: (n: string) => string | null; setAttribute: (n: string, v: string) => void };
const el = (text: string, attrs: Record<string, string>): El => {
  const e: El = { textContent: text, attrs: { ...attrs }, getAttribute: (n) => e.attrs[n] ?? null, setAttribute: (n, v) => void (e.attrs[n] = v) };
  return e;
};
function fakeDom(cookie: string, path: string) {
  const skip = el('Skip to content', { 'data-es': 'Saltar al contenido' });
  const nav1 = el('Matches', { 'data-es': 'Coincidencias' });
  const nav2 = el('Settings', { 'data-es': 'Ajustes' });
  const out = el('Sign out', { 'data-es': 'Salir', 'data-es-label': 'Cerrar sesión' });
  const navEl = el('', { 'aria-label': 'App', 'data-es-label': 'Aplicación' });
  const logo = el('Holler', { 'aria-label': 'Holler home' });
  const document = {
    head: {},
    cookie,
    title: path === '/app' ? 'Your matches' : 'Settings | Holler',
    documentElement: { lang: 'en' },
    querySelectorAll: (q: string) => (q === '[data-es]' ? [skip, nav1, nav2, out] : q === '[data-es-label]' ? [navEl, out] : []),
    querySelector: (q: string) => (q.includes('Holler home') ? logo : null),
  };
  return { document, location: { pathname: path }, skip, nav1, nav2, out, navEl, logo };
}

describe('P2-3 and P2-4: the script in the static /app header', () => {
  it('with holler_lang=es it shows the Spanish words, labels, <html lang="es"> and the Spanish title before the first paint', async () => {
    const { APP_LANG_SCRIPT } = await import('@/components/app-header');
    const d = fakeDom('a=1; holler_lang=es', '/app/settings');
    const observed: unknown[] = [];
    const MutationObserver = class {
      constructor(public cb: () => void) {}
      observe(target: unknown) {
        observed.push(target);
      }
      disconnect() {}
    };
    runInNewContext(APP_LANG_SCRIPT, { document: d.document, location: d.location, MutationObserver, setTimeout: () => 0 });
    expect(observed).toEqual([d.document.head]);
    expect([d.skip, d.nav1, d.nav2, d.out].map((e) => e.textContent)).toEqual(['Saltar al contenido', 'Coincidencias', 'Ajustes', 'Salir']);
    expect(d.out.attrs['aria-label']).toBe('Cerrar sesión');
    expect(d.navEl.attrs['aria-label']).toBe('Aplicación');
    expect(d.logo.attrs['aria-label']).toBe('Holler, inicio');
    expect(d.document.documentElement.lang).toBe('es');
    expect(d.document.title).toBe('Configuración | Holler');
  });
  it('with no hint, "en", a look-alike name or a look-alike value it changes nothing', async () => {
    const { APP_LANG_SCRIPT } = await import('@/components/app-header');
    for (const cookie of ['', 'holler_lang=en', 'xholler_lang=es', 'holler_lang=esx', 'holler_lang=ES']) {
      const d = fakeDom(cookie, '/app');
      runInNewContext(APP_LANG_SCRIPT, { document: d.document, location: d.location });
      expect(d.nav1.textContent, cookie).toBe('Matches');
      expect(d.document.documentElement.lang, cookie).toBe('en');
      expect(d.document.title, cookie).toBe('Your matches');
    }
  });
  it('the CSP is unchanged and has no script-src, so the inline script needs no nonce or hash', async () => {
    const { CONTENT_SECURITY_POLICY } = await import('@/lib/security-headers');
    expect(CONTENT_SECURITY_POLICY).toBe("frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
  });
  it('a Spanish member\'s streamed header also sets <html lang> and the title after hydration (MemberDocument); an English one does not', async () => {
    const src = readFileSync('components/app-header.tsx', 'utf8');
    expect(src).toContain('<MemberDocument lang={lang} es={APP_TITLES_ES} en={APP_TITLES_EN} />');
    expect(src).toMatch(/if \(lang === 'en' && \(await cookies\(\)\)\.get\(LANG_COOKIE\)\?\.value !== 'es'\) return <AppHeaderBar lang=\{lang\} \/>;/);
  });
});

// ---- P1-1: the header labels ---------------------------------------------------------------------------------------------------------
describe('P1-1: the Spanish header labels are short', () => {
  it('"Ajustes" and "Salir" in the bar, with the full "Cerrar sesión" as the button name; Settings keeps "Configuración"', async () => {
    const { es } = await import('@/lib/i18n/es');
    expect(es['app.nav.settings_short']).toBe('Ajustes');
    expect(es['app.signout_short']).toBe('Salir');
    expect(es['app.nav.settings']).toBe('Configuración');
    expect(es['set.h1']).toBe('Configuración');
    // Measured in Chrome (gates/r18/logs/ES2-header-widths.log): these words fit from 320 px, with a fifth "Listas" link from 375 px.
    // A longer word here must be measured again; this budget is the one measured.
    const words = [es['app.nav.matches'], es['app.nav.settings_short'], es['app.signout_short']];
    expect(words.join('').length).toBeLessThanOrEqual(25);
  });
});

// ---- review 2 P2-1: the page brings the hint back in line with the saved language ------------------------------------------------
describe('review 2 P2-1: a wrong hint lasts one page load', () => {
  async function effectOf(props: { lang: 'en' | 'es' }, doc: { cookie: string; title: string; lang: string }, path = '/app/settings') {
    vi.resetModules();
    let effect: (() => void | (() => void)) | undefined;
    vi.doMock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), useEffect: (fn: () => void | (() => void)) => void (effect = fn) }));
    vi.doMock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), usePathname: () => path }));
    const writes: string[] = [];
    const document = {
      get cookie() {
        return doc.cookie;
      },
      set cookie(v: string) {
        writes.push(v);
        doc.cookie = v.split(';')[0];
      },
      get title() {
        return doc.title;
      },
      set title(v: string) {
        doc.title = v;
      },
      documentElement: {
        get lang() {
          return doc.lang;
        },
        set lang(v: string) {
          doc.lang = v;
        },
      },
    };
    vi.stubGlobal('document', document);
    const { MemberDocument } = await import('@/components/member-document');
    const { APP_TITLES_ES, APP_TITLES_EN } = { APP_TITLES_ES: { '/app': 'Sus coincidencias | Holler', '/app/settings': 'Configuración | Holler' }, APP_TITLES_EN: { '/app': 'Your matches | Holler', '/app/settings': 'Settings | Holler' } };
    MemberDocument({ lang: props.lang, es: APP_TITLES_ES, en: APP_TITLES_EN });
    const cleanup = effect!() as () => void;
    vi.doUnmock('react');
    vi.doUnmock('next/navigation');
    return { writes, doc, cleanup };
  }
  it('an English account whose browser says "es": the hint is rewritten to "en", lang and title go back to English', async () => {
    const r = await effectOf({ lang: 'en' }, { cookie: 'holler_lang=es', title: 'Configuración | Holler', lang: 'es' });
    expect(r.writes).toEqual(['holler_lang=en; Path=/; Max-Age=31536000; Secure; SameSite=Lax']);
    expect(r.doc).toEqual({ cookie: 'holler_lang=en', title: 'Settings | Holler', lang: 'en' });
  });
  it('a Spanish account with no hint gets "es" written; a right hint is left alone', async () => {
    const r = await effectOf({ lang: 'es' }, { cookie: '', title: 'Settings | Holler', lang: 'en' });
    expect(r.writes).toEqual(['holler_lang=es; Path=/; Max-Age=31536000; Secure; SameSite=Lax']);
    expect(r.doc).toEqual({ cookie: 'holler_lang=es', title: 'Configuración | Holler', lang: 'es' });
    const ok = await effectOf({ lang: 'es' }, { cookie: 'holler_lang=es', title: 'Configuración | Holler', lang: 'es' });
    expect(ok.writes).toEqual([]);
  });
  it('switching to English in Settings: leaving the Spanish document puts lang and the title back to English', async () => {
    const r = await effectOf({ lang: 'es' }, { cookie: 'holler_lang=es', title: 'Configuración | Holler', lang: 'es' });
    r.cleanup();
    expect(r.doc.lang).toBe('en');
    expect(r.doc.title).toBe('Settings | Holler');
  });
  it('MemberHeaderBar: an English member gets MemberDocument only when the request\'s hint wrongly says Spanish', async () => {
    const { baseMocks, member } = await import('./r18-harness');
    for (const [hint, extra] of [[undefined, false], ['en', false], ['es', true]] as const) {
      baseMocks({ profile: member(), hint });
      const { MemberHeaderBar } = await import('@/components/app-header');
      const out = (await MemberHeaderBar()) as { props: { children?: unknown } };
      expect(Array.isArray(out.props.children), String(hint)).toBe(extra);
    }
    vi.useRealTimers();
  });
});
