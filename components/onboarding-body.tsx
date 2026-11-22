import { redirect } from 'next/navigation';
import { Card } from '@/components/card';
import { ProfileForm } from '@/components/profile-form';
import { getProfile, getUser, requireUser } from '@/lib/auth/session';
import { cleanCitySlug } from '@/lib/auth/redirect';
import { signupLang } from '@/lib/auth/signup-lang';
import { cityBySlug } from '@/lib/geo';
import { t, type Lang } from '@/lib/i18n';
import { profileCategories } from '@/lib/plan/profile-categories';
import { completeOnboarding } from '@/app/onboarding/actions';

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * The onboarding form, shared by /onboarding (English) and /es/onboarding (Spanish, round 18 ES). One copy of the logic: signed out goes
 * to log in, a member who already has a profile goes to the feed, and a city slug only changes the ZIP hint (F-19: never guess a ZIP).
 * A person who signed up on a Spanish page and opens the English /onboarding is sent to the Spanish one.
 */
export async function OnboardingForm({ searchParams, lang = 'en' }: { searchParams: SP; lang?: Lang }) {
  let user;
  if (lang === 'en') {
    user = await requireUser('/onboarding');
  } else {
    user = await getUser();
    if (!user) redirect(`/es/login?next=${encodeURIComponent('/es/onboarding')}`);
  }
  // Already set up: editing lives in Settings.
  if (await getProfile(user.id)) redirect('/app');

  const sp = await searchParams;
  const slug = cleanCitySlug(typeof sp.city === 'string' ? sp.city : null);
  const city = slug ? cityBySlug(slug) : null;
  if (lang === 'en' && signupLang(user.app_metadata) === 'es') redirect(`/es/onboarding${slug ? `?city=${encodeURIComponent(slug)}` : ''}`);
  // F-19: lib/geo only maps ZIP to place (lookupZip), never city to ZIP, and a city has many ZIPs. So the city only changes
  // the hint text and the ZIP field stays empty. Never guess a ZIP.

  return (
    <Card className="mt-8">
      <ProfileForm
        action={completeOnboarding}
        categories={profileCategories(lang)}
        defaults={{ business_name: '', categories: [], zip: '', radius: 25, alert_email: true }}
        submitLabel={lang === 'en' ? 'Start my free trial' : t(lang, 'onb.submit')}
        // The free trial uses Solo (`starter`) limits; the Pro fields show locked with a link to the plans.
        tier="starter"
        upgradeHref={lang === 'en' ? '/pricing' : '/es/pricing'}
        lang={lang}
        zipHint={
          lang === 'en'
            ? city
              ? `You came from the ${city.name}, ${city.state} page. Enter the ZIP you work out of.`
              : 'The center of where you work.'
            : city
              ? t(lang, 'onb.zip_city', { city: `${city.name}, ${city.state}` })
              : t(lang, 'pf.zip_hint')
        }
      />
    </Card>
  );
}

/** Placeholder while the form loads. */
export function FormSkeleton() {
  return (
    <div aria-hidden="true" className="mt-8 rounded-card border border-line bg-surface p-6">
      <div className="skeleton h-11 w-full" />
      <div className="mt-7 flex flex-wrap gap-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="skeleton h-11 w-24 !rounded-control" />
        ))}
      </div>
      <div className="skeleton mt-7 h-11 w-full" />
    </div>
  );
}
