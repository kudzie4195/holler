import { Suspense } from 'react';
import { ComingNext } from './coming-next';
import { getProfile, getUser } from '@/lib/auth/session';
import { loadMemberPicks } from '@/lib/interest/deps';
import { langOfProfile } from '@/lib/i18n';

async function MemberList() {
  const user = await getUser();
  const picks = user ? await loadMemberPicks(user.id) : [];
  // The member's language (profile, migration 0024). The page has already read the profile this request (cached); any failure is English.
  const lang = user ? langOfProfile(await getProfile(user.id).catch(() => null)) : 'en';
  return <ComingNext page="app" initialPicked={picks} className="mt-12 pt-2" lang={lang} />;
}

/**
 * The signed-in feed's "Coming next" list, with the member's own earlier picks passed in. It sits in its own Suspense boundary, below
 * the feed, so reading the picks never holds the feed back. Any failure shows all buttons unpicked.
 */
export function ComingNextForMember() {
  return (
    <Suspense fallback={null}>
      <MemberList />
    </Suspense>
  );
}
