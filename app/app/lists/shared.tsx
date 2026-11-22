import 'server-only';
import Link from 'next/link';
import { Card } from '@/components/card';
import { computeAccess } from '@/lib/auth/access';
import type { Profile } from '@/lib/auth/session';
import { t, type Lang } from '@/lib/i18n';
import type { ListProfile } from '@/lib/lists/load';

/**
 * Shared bits of the /app/lists pages. Gating follows the feed (app/app/page.tsx): a locked account (trial over, not paid) gets the
 * upgrade card and no list is read at all; otherwise the plan decides the areas and trades through matchScope (Solo: the main area and the
 * first 5 trades; Pro: up to 3 areas and 15 trades), exactly what the member's alerts use.
 */
export const LIST_METADATA = { robots: { index: false, follow: false } } as const;

export function listProfileOf(profile: Profile): ListProfile {
  return {
    user_id: profile.user_id,
    categories: profile.categories,
    lat: profile.lat,
    lon: profile.lon,
    state: profile.state,
    radius_mi: profile.radius_mi,
    plan: profile.plan ?? null,
    subscription_status: profile.subscription_status,
    plan_source: profile.plan_source ?? null,
    store_expires_at: profile.store_expires_at ?? null,
    extra_areas: profile.extra_areas,
    keywords: profile.keywords ?? null,
  };
}

export function isLocked(profile: Profile, now: number = Date.now()): boolean {
  return computeAccess(profile, now).locked;
}

export function LockedLists({ lang }: { lang: Lang }) {
  return (
    <Card className="mt-6 text-center">
      <p className="text-ink">{t(lang, 'lists.locked')}</p>
      <Link href="/app/settings#billing-h" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline">
        {t(lang, 'lists.locked_cta')}
      </Link>
    </Card>
  );
}

export function BackLink({ lang }: { lang: Lang }) {
  return (
    <Link href="/app/lists" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-text underline print:hidden">
      {t(lang, 'lists.back')}
    </Link>
  );
}

export function countText(n: number, lang: Lang): string {
  return n === 1 ? t(lang, 'lists.count.one') : t(lang, 'lists.count.many', { n: n.toLocaleString('en-US') });
}
