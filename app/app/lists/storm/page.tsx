import type { Metadata } from 'next';
import { connection } from 'next/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/notice';
import { ListSheet, listDate } from '@/components/lists/list-sheet';
import { PrintButton } from '@/components/lists/print-button';
import { requireProfile } from '@/lib/auth/session';
import { langOfProfile, t } from '@/lib/i18n';
import { DAMAGE_LINE, STORM_RADIUS_MI } from '@/lib/lists/core';
import { loadStormList, loadStormReport } from '@/lib/lists/load';
import { localizeTitle } from '@/lib/signals/title-i18n';
import { createClient } from '@/lib/supabase/server';
import { RETENTION_DAYS } from '@/lib/signals/store';
import { BackLink, isLocked, listProfileOf, LIST_METADATA, LockedLists } from '../shared';

export const metadata: Metadata = { title: 'Storm list', ...LIST_METADATA };

/**
 * /app/lists/storm?id=<signal id>: the permitted addresses near one SPC hail or wind-damage report. The report must be one of THIS member's
 * own matches (holler_matches under RLS, filtered by user_id too) and qualify (lib/lists/core.ts stormListLabel); anything else is a 404.
 * The page is its own print view (print CSS hides the app header and the controls).
 */
export default async function StormListPage(props: PageProps<'/app/lists/storm'>) {
  const raw = (await props.searchParams).id;
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
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
  const db = await createClient();
  const now = new Date();
  let report;
  try {
    report = await loadStormReport(db, listProfileOf(profile), id, now);
  } catch {
    return <Notice tone="danger" role="alert">{t(lang, 'lists.error')}</Notice>;
  }
  if (!report) notFound();
  let list;
  try {
    list = await loadStormList(db, report, now);
  } catch {
    return <Notice tone="danger" role="alert">{t(lang, 'lists.error')}</Notice>;
  }
  const kind = t(lang, report.kind === 'hail' ? 'lists.storm.kind.hail' : 'lists.storm.kind.wind');
  return (
    <>
      <BackLink lang={lang} />
      <ListSheet
        lang={lang}
        heading={t(lang, 'lists.storm.title', { kind })}
        damageLines={DAMAGE_LINE}
        notes={[
          t(lang, 'lists.storm.report', { title: localizeTitle(report.title, lang, 'spc'), date: listDate(report.occurredAt, lang) }),
          t(lang, 'lists.storm.radius', { radius: STORM_RADIUS_MI, days: RETENTION_DAYS }),
          t(lang, 'lists.storm.approx'),
        ]}
        entries={list.entries}
        total={list.total}
        capped={list.capped}
        partial={list.partial}
        showDistance
        actions={
          <>
            <PrintButton label={t(lang, 'lists.print')} />
            <Link href="/app/lists/door-hanger?storm=1" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline">
              {t(lang, 'lists.hanger.link')}
            </Link>
          </>
        }
      />
    </>
  );
}
