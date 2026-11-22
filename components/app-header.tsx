import { Logo } from '@/components/logo';
import { Button } from '@/components/button';
import { AppNavLinks } from '@/components/app-nav';
import { memberLang } from '@/lib/auth/member-lang';
import { t, type Lang } from '@/lib/i18n';

/**
 * The /app header in the member's language (round 18 ES). app/app/layout.tsx stays static: it renders the English header as the
 * Suspense fallback (the same markup it always had), and the version for the signed-in member streams in behind the boundary, read
 * from the profile (lib/auth/member-lang.ts). For an English member the streamed header is the same markup as the fallback.
 */
export function AppSkipLink({ lang }: { lang: Lang }) {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-signal focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink"
    >
      {lang === 'en' ? 'Skip to content' : t(lang, 'nav.skip')}
    </a>
  );
}

export function AppHeaderBar({ lang }: { lang: Lang }) {
  const en = lang === 'en';
  return (
    <>
      {/* Under 480 px the wordmark hides (the link keeps its "Holler home" name) so the logo, two links and Sign out fit in one row at 320 px. */}
      {en ? <Logo href="/app" className="max-[479px]:[&>span]:hidden" /> : <Logo href="/app" ariaLabel={t(lang, 'nav.home')} className="max-[479px]:[&>span]:hidden" />}
      <nav aria-label={en ? 'App' : t(lang, 'app.nav.aria')} className="flex items-center gap-0.5 sm:gap-1">
        {en ? <AppNavLinks /> : <AppNavLinks labels={[t(lang, 'app.nav.matches'), t(lang, 'app.nav.settings')]} />}
        <form action="/api/auth/signout" method="post">
          <Button type="submit" variant="ghost" size="sm" className="text-muted max-[399px]:px-2.5">
            {en ? 'Sign out' : t(lang, 'app.signout')}
          </Button>
        </form>
      </nav>
    </>
  );
}

/** The skip link for the signed-in member. Streams in behind Suspense (reads the session). */
export async function MemberSkipLink() {
  return <AppSkipLink lang={await memberLang()} />;
}

/** The header bar for the signed-in member. Streams in behind Suspense (reads the session). */
export async function MemberHeaderBar() {
  return <AppHeaderBar lang={await memberLang()} />;
}
