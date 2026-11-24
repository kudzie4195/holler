import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { ForgotForm, LoginForm, ResetForm, SignupForm } from '@/components/auth-forms';
import { Button, ButtonLink } from '@/components/button';
import { isConfirmType } from '@/lib/auth/otp';
import { cleanCitySlug, safeNext } from '@/lib/auth/redirect';
import { getUser } from '@/lib/auth/session';
import { cityBySlug } from '@/lib/geo';
import { cityOffer } from '@/lib/seo/city-offer';
import { t, type DictKey, type Lang } from '@/lib/i18n';
import { TRIAL_HEADLINE_KEY, TRIAL_MONTHS, TRIAL_PHRASE } from '@/lib/plan/price-copy';

/**
 * The bodies of the sign-up, log-in and password pages, shared by the English pages (app/(auth)/...) and their Spanish twins (/es/...).
 * One copy of the logic: which city a sign-up came from, where log-in goes next, whether a reset link was spent, whether the reset session
 * exists. `lang` 'en' prints the words and links the English pages always had; 'es' prints the dictionary's words and links to /es pages.
 */
type SP = Promise<Record<string, string | string[] | undefined>>;

const words = (lang: Lang) => (key: DictKey, en: string) => (lang === 'en' ? en : t(lang, key));
const path = (lang: Lang, p: string) => (lang === 'en' ? p : `/es${p}`);
const switchLink = 'inline-flex min-h-11 min-w-11 items-center font-semibold text-brand-text underline';

/** The sign-up city is a waitlist city for every trade (lib/seo/city-offer.ts cityOffer, the city page's own answer). */
export function signupCityWaitlist(city: NonNullable<ReturnType<typeof cityBySlug>>): boolean {
  return cityOffer(city).state === 'waitlist';
}

/** The sign-up page title and description for a ?city= value: the waitlist wording for a waitlist city, otherwise null (the defaults). */
export function signupWaitMeta(rawCity: unknown, lang: Lang): { title: string; description: string } | null {
  const slug = cleanCitySlug(typeof rawCity === 'string' ? rawCity : null);
  const city = slug ? cityBySlug(slug) : null;
  if (!city || !signupCityWaitlist(city)) return null;
  const name = `${city.name}, ${city.state}`;
  return { title: t(lang, 'auth.signup.wait_h', { city: name }), description: t(lang, 'auth.signup.wait_sub', { city: name }) };
}

export async function SignupBody({ searchParams, lang = 'en' }: { searchParams: SP; lang?: Lang }) {
  const w = words(lang);
  const sp = await searchParams;
  const citySlug = cleanCitySlug(typeof sp.city === 'string' ? sp.city : null);
  const city = citySlug ? cityBySlug(citySlug) : null;
  const haveAccount = (
    <>
      {w('auth.signup.have', 'Already have an account?')}{' '}
      <Link href={path(lang, '/login')} className={switchLink}>
        {w('auth.login', 'Log in')}
      </Link>
    </>
  );
  // Round 24 FIX2 (review D2): a city the ZIP check calls waitlist gets no trial pitch. Old shared and indexed links still open (200): the
  // page says Holler is not ready there and links to the ZIP check. The account form stays, for an owner who works somewhere else.
  if (city && signupCityWaitlist(city)) {
    const name = `${city.name}, ${city.state}`;
    return (
      <AuthCard
        title={t(lang, 'auth.signup.wait_h', { city: name })}
        subtitle={t(lang, 'auth.signup.wait_sub', { city: name })}
        note={
          <Link href={path(lang, '/check')} className={switchLink}>
            {t(lang, 'auth.signup.wait_link')}
          </Link>
        }
        footer={haveAccount}
      >
        <SignupForm city={null} lang={lang} />
      </AuthCard>
    );
  }
  const subtitle =
    lang === 'en'
      ? city
        ? `Alerts for ${city.name}, ${city.state} and the towns around it. No card needed.`
        : `${TRIAL_PHRASE.charAt(0).toUpperCase() + TRIAL_PHRASE.slice(1)}, no card. Takes about a minute.`
      : city
        ? t(lang, 'auth.signup.sub_city', { city: `${city.name}, ${city.state}` })
        : // Round 18 integration: the same headline as in English (r18 trial), from the 'land.trial' templates and TRIAL_MONTHS.
          // Round 23: one month, so the key is the singular one (lib/plan/price-copy.ts TRIAL_HEADLINE_KEY).
          t(lang, 'auth.signup.sub', { free: t(lang, TRIAL_HEADLINE_KEY, { months: TRIAL_MONTHS }) });
  return (
    <AuthCard
      title={w('auth.signup.h', 'Start your free trial')}
      subtitle={subtitle}
      footer={haveAccount}
    >
      <SignupForm city={city ? citySlug : null} lang={lang} />
    </AuthCard>
  );
}

export async function LoginBody({ searchParams, lang = 'en' }: { searchParams: SP; lang?: Lang }) {
  const w = words(lang);
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null, '/app');
  return (
    <AuthCard
      title={w('auth.login.h', 'Welcome back')}
      subtitle={w('auth.login.sub', "Log in to see what's nearby.")}
      footer={
        <>
          {w('auth.login.new', 'New here?')}{' '}
          <Link href={path(lang, '/signup')} className={switchLink}>
            {w('auth.signup.h', 'Start your free trial')}
          </Link>
        </>
      }
    >
      <LoginForm next={next} linkExpired={sp.error === 'link'} lang={lang} />
    </AuthCard>
  );
}

export async function ForgotBody({ searchParams, lang = 'en' }: { searchParams: SP; lang?: Lang }) {
  const w = words(lang);
  const sp = await searchParams;
  return (
    <AuthCard
      title={w('auth.forgot.h', 'Reset your password')}
      subtitle={w('auth.forgot.sub', "Enter your email and we'll send you a link.")}
      footer={
        <Link href={path(lang, '/login')} className={switchLink}>
          {w('auth.back_login', 'Back to log in')}
        </Link>
      }
    >
      <ForgotForm linkExpired={sp.error === 'link'} lang={lang} />
    </AuthCard>
  );
}

export async function ResetBody({ lang = 'en' }: { lang?: Lang }) {
  const w = words(lang);
  // /auth/confirm (type=recovery) signs the user in; without that session there is nothing to reset.
  const user = await getUser();
  if (!user) {
    return (
      <AuthCard title={w('auth.reset.expired_h', 'That link has expired')} subtitle={w('auth.reset.expired_sub', "Reset links work once and don't last long. Ask for a fresh one.")}>
        <ButtonLink href={path(lang, '/forgot')} full size="lg">
          {w('auth.reset.new_link', 'Get a new link')}
        </ButtonLink>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={w('auth.reset.h', 'Choose a new password')} subtitle={w('auth.reset.sub', 'Use at least 8 characters.')}>
      <ResetForm lang={lang} />
    </AuthCard>
  );
}

/**
 * Step one of the two-step link: nothing is verified here. The button POSTs the token to /auth/confirm, so email link scanners that only
 * GET the link cannot use up the single-use token. English at /auth/confirm/continue; Spanish at /es/confirm (a link whose next is an /es
 * page lands there, app/auth/confirm/route.ts).
 */
export async function ConfirmBody({ searchParams, lang = 'en' }: { searchParams: SP; lang?: Lang }) {
  const w = words(lang);
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === 'string' ? v : undefined;
  };
  const tokenHash = one('token_hash');
  const type = one('type');
  const next = safeNext(one('next'), '/app');

  if (!tokenHash || !isConfirmType(type)) {
    return (
      <AuthCard title={w('auth.confirm.invalid_h', "That link isn't valid")} subtitle={w('auth.reset.expired_sub', "Reset links work once and don't last long. Ask for a fresh one.")}>
        <ButtonLink href={path(lang, '/forgot')} full size="lg">
          {w('auth.reset.new_link', 'Get a new link')}
        </ButtonLink>
      </AuthCard>
    );
  }

  const recovery = type === 'recovery';
  return (
    <AuthCard
      title={recovery ? w('auth.forgot.h', 'Reset your password') : w('auth.confirm.h', 'Confirm to continue')}
      subtitle={recovery ? w('auth.confirm.sub_recovery', 'Press the button to choose a new password.') : w('auth.confirm.sub', 'Press the button to finish signing in.')}
    >
      <form method="POST" action="/auth/confirm">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <Button type="submit" full size="lg">
          {recovery ? w('auth.forgot.h', 'Reset your password') : w('auth.confirm.button', 'Continue')}
        </Button>
      </form>
    </AuthCard>
  );
}
