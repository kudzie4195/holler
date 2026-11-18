import { Suspense } from 'react';
import { ComingNext } from './coming-next';
import { getUser } from '@/lib/auth/session';
import { loadMemberPicks } from '@/lib/interest/deps';

async function MemberList() {
  const user = await getUser();
  const picks = user ? await loadMemberPicks(user.id) : [];
  return <ComingNext page="app" initialPicked={picks} className="mt-12 border-t border-line pt-10" />;
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
