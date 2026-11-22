import { Logo } from '@/components/logo';
import { Button } from '@/components/button';
import { AppNavLinks } from '@/components/app-nav';
import { InlineScript } from '@/components/inline-script';
import { MemberDocument } from '@/components/member-document';
import { HintDocLang, HintText } from '@/components/hint-text';
import { cookies } from 'next/headers';
import { memberLang } from '@/lib/auth/member-lang';
import { t, type Lang } from '@/lib/i18n';
import { LANG_COOKIE } from '@/lib/auth/lang-cookie';

/**
 * The /app header in the member's language (round 18 ES).
 *
 * app/app/layout.tsx stays static. Its static shell holds the English header (the Suspense fallback, `hint`), with the Spanish words in
 * data-es attributes, then APP_LANG_SCRIPT: on a full page load the script reads the holler_lang hint cookie (lib/auth/lang-cookie.ts)
 * and, for "es", puts the Spanish words, <html lang="es"> and the Spanish tab title in place before the first paint
 * (node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md). The member's own header then streams in behind the
 * boundary, read from the profile (lib/auth/member-lang.ts); for an English member it is the same markup as the fallback without the
 * hints.
 *
 * Spanish labels are short on purpose (review P1-1): "Ajustes" and "Salir" keep the bar on one row from 320 px, with room for a fifth
 * short link; the full words stay on the Settings page and in the sign-out button's accessible name.
 */
const ES = 'es' as const;

/** The Spanish tab titles of the /app pages, the same shape as the English ones ("Your matches | Holler", "Settings | Holler"). */
export const APP_TITLES_ES: Record<string, string> = {
  '/app': `${t(ES, 'app.title')} | Holler`,
  '/app/settings': `${t(ES, 'set.h1')} | Holler`,
};

/** The static English titles of the same pages (app/app/layout.tsx and app/app/settings/page.tsx metadata), for putting them back. */
export const APP_TITLES_EN: Record<string, string> = { '/app': 'Your matches | Holler', '/app/settings': 'Settings | Holler' };

/**
 * Runs once while the static shell is parsed. Reads only the hint cookie; touches only the header placeholders, <html lang> and the tab
 * title. React's hydration of the head writes the static English title back, so for 15 s (or until the member leaves the page) a
 * MutationObserver on <head> puts the Spanish title back; after that MemberDocument keeps it.
 */
export const APP_LANG_SCRIPT = `(function(){try{var r=/(?:^|;\\s*)${LANG_COOKIE}=es(?:;|$)/,d=document;if(!r.test(d.cookie))return;d.documentElement.lang="es";d.querySelectorAll("[data-es]").forEach(function(e){e.textContent=e.getAttribute("data-es")});d.querySelectorAll("[data-es-label]").forEach(function(e){e.setAttribute("aria-label",e.getAttribute("data-es-label"))});var l=d.querySelector('header a[aria-label="Holler home"]');if(l)l.setAttribute("aria-label",${JSON.stringify(t(ES, 'nav.home'))});var m=${JSON.stringify(APP_TITLES_ES)},p=location.pathname,w=m[p];if(w){d.title=w;var o=new MutationObserver(function(){if(!r.test(d.cookie)){o.disconnect();return}if(location.pathname===p&&d.title!==w)d.title=w});o.observe(d.head,{childList:true,characterData:true,subtree:true});setTimeout(function(){o.disconnect()},15000)}}catch(e){}})()`;

export function AppSkipLink({ lang, hint = false }: { lang: Lang; hint?: boolean }) {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-signal focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
      {...(hint ? { 'data-es': t(ES, 'nav.skip'), suppressHydrationWarning: true } : {})}
    >
      {lang !== 'en' ? t(lang, 'nav.skip') : hint ? <HintText en="Skip to content" es={t(ES, 'nav.skip')} /> : 'Skip to content'}
    </a>
  );
}

/** `hint`: the static fallback, which carries the Spanish words for APP_LANG_SCRIPT. */
export function AppHeaderBar({ lang, hint = false }: { lang: Lang; hint?: boolean }) {
  const en = lang === 'en';
  return (
    <>
      {/* Under 480 px the wordmark hides (the link keeps its "Holler home" name) so the logo, two links and Sign out fit in one row at 320 px. */}
      {en ? <Logo href="/app" className="max-[479px]:[&>span]:hidden" /> : <Logo href="/app" ariaLabel={t(lang, 'nav.home')} className="max-[479px]:[&>span]:hidden" />}
      <nav aria-label={en ? 'App' : t(lang, 'app.nav.aria')} className="flex items-center gap-0.5 sm:gap-1" {...(hint ? { 'data-es-label': t(ES, 'app.nav.aria') } : {})}>
        {en ? (
          <AppNavLinks {...(hint ? { hints: { '/app': t(ES, 'app.nav.matches'), '/app/settings': t(ES, 'app.nav.settings_short') } } : {})} />
        ) : (
          <AppNavLinks labels={{ '/app': t(lang, 'app.nav.matches'), '/app/settings': t(lang, 'app.nav.settings_short') }} />
        )}
        <form action="/api/auth/signout" method="post">
          {en ? (
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-muted max-[399px]:px-2.5"
              {...(hint ? { 'data-es': t(ES, 'app.signout_short'), 'data-es-label': t(ES, 'app.signout'), suppressHydrationWarning: true } : {})}
            >
              {hint ? <HintText en="Sign out" es={t(ES, 'app.signout_short')} /> : 'Sign out'}
            </Button>
          ) : (
            <Button type="submit" variant="ghost" size="sm" className="text-muted max-[399px]:px-2.5" aria-label={t(lang, 'app.signout')}>
              {t(lang, 'app.signout_short')}
            </Button>
          )}
        </form>
      </nav>
      {hint ? <HintDocLang /> : null}
    </>
  );
}

/** The script right after the static header: see APP_LANG_SCRIPT. */
export function AppLangScript() {
  return <InlineScript html={APP_LANG_SCRIPT} />;
}

/** The skip link for the signed-in member. Streams in behind Suspense (reads the session). */
export async function MemberSkipLink() {
  return <AppSkipLink lang={await memberLang()} />;
}

/**
 * The header bar for the signed-in member. Streams in behind Suspense (reads the session). A Spanish member also gets MemberDocument
 * (<html lang="es"> and the Spanish tab title after hydration and on client navigation); an English member's markup is unchanged.
 */
export async function MemberHeaderBar() {
  const lang = await memberLang();
  // An English member's markup is unchanged, unless this browser's hint wrongly says Spanish (changed language elsewhere, a forged
  // cookie): then MemberDocument puts <html lang>, the title and the hint back to English.
  if (lang === 'en' && (await cookies()).get(LANG_COOKIE)?.value !== 'es') return <AppHeaderBar lang={lang} />;
  return (
    <>
      <AppHeaderBar lang={lang} />
      <MemberDocument lang={lang} es={APP_TITLES_ES} en={APP_TITLES_EN} />
    </>
  );
}
