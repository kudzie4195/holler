import type { Metadata } from 'next';
import { connection } from 'next/server';
import { DoorHanger } from '@/components/lists/door-hanger';
import { requireProfile } from '@/lib/auth/session';
import { langOfProfile, t } from '@/lib/i18n';
import { BackLink, isLocked, LIST_METADATA, LockedLists } from '../shared';

export const metadata: Metadata = { title: 'Door hanger', ...LIST_METADATA };

/**
 * /app/lists/door-hanger: a printable leave-behind with the member's business name and phone typed in on the page (components/lists/
 * door-hanger.tsx). Nothing typed is stored or sent. The business name starts as the profile's own business name; the phone is typed.
 */
export default async function DoorHangerPage(props: PageProps<'/app/lists/door-hanger'>) {
  const storm = (await props.searchParams).storm === '1';
  // Request-time only: the session read and the clock below never run in a prerender (no Date.now() prerender warning).
  await connection();
  const { profile } = await requireProfile();
  const lang = langOfProfile(profile);
  // Lists are a paid feature; the hanger is gated the same way (review P3-16).
  if (isLocked(profile)) {
    return (
      <>
        <h1 className="text-5xl text-ink">{t(lang, 'hanger.title')}</h1>
        <LockedLists lang={lang} />
      </>
    );
  }
  return (
    <>
      <BackLink lang={lang} />
      <h1 className="text-4xl text-ink print:hidden">{t(lang, 'hanger.title')}</h1>
      <p className="mt-2 text-muted print:hidden">{t(lang, 'hanger.intro')}</p>
      <div className="mt-6">
        <DoorHanger lang={lang} initialBusiness={profile.business_name ?? ''} storm={storm} />
      </div>
    </>
  );
}
