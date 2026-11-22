import type { Metadata } from 'next';
import { connection } from 'next/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/notice';
import { ListSheet } from '@/components/lists/list-sheet';
import { PrintButton } from '@/components/lists/print-button';
import { requireProfile } from '@/lib/auth/session';
import { tradeLabel } from '@/lib/check/trades';
import { langOfProfile, lowerFirst, t } from '@/lib/i18n';
import { AREA_LIST_DAYS } from '@/lib/lists/core';
import { loadAreaList } from '@/lib/lists/load';
import { createClient } from '@/lib/supabase/server';
import { BackLink, isLocked, listProfileOf, LIST_METADATA, LockedLists } from '../shared';

export const metadata: Metadata = { title: 'Neighborhood list', ...LIST_METADATA };

/**
 * /app/lists/area?trade=<trade id>: the permits of the last AREA_LIST_DAYS in the member's own areas that the downstream rules send to that
 * trade. The trade must be one of the member's plan trades with a list (lib/lists/load.ts loadAreaList); the areas come from the member's
 * profile, never from the request, so no other member's area can be asked for. Anything else is a 404.
 */
export default async function AreaListPage(props: PageProps<'/app/lists/area'>) {
  const raw = (await props.searchParams).trade;
  const trade = String(Array.isArray(raw) ? raw[0] : (raw ?? '')).slice(0, 40);
  // Request-time only: the session read and the clock below never run in a prerender (no Date.now() prerender warning).
  await connection();
  const { profile } = await requireProfile();
  const lang = langOfProfile(profile);
  if (isLocked(profile)) {
    return (
      <>
        <h1 className="text-5xl text-ink">{t(lang, 'lists.title')}</h1>
        <LockedLists lang={lang} />
      </>
    );
  }
  let list;
  try {
    list = await loadAreaList(await createClient(), listProfileOf(profile), trade, new Date());
  } catch {
    return <Notice tone="danger" role="alert">{t(lang, 'lists.error')}</Notice>;
  }
  if (!list) notFound();
  const label = tradeLabel(trade, lang);
  return (
    <>
      <BackLink lang={lang} />
      <ListSheet
        lang={lang}
        heading={t(lang, 'lists.area.title', { trade: label })}
        notes={[t(lang, 'lists.area.note', { days: AREA_LIST_DAYS, trade: lowerFirst(label) })]}
        entries={list.entries}
        total={list.total}
        capped={list.capped}
        partial={list.partial}
        hasApprox={list.hasApprox}
        actions={
          <>
            <PrintButton label={t(lang, 'lists.print')} />
            <Link href="/app/lists/door-hanger" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline">
              {t(lang, 'lists.hanger.link')}
            </Link>
          </>
        }
      />
    </>
  );
}
