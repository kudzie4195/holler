import type { Metadata } from 'next';
import { connection } from 'next/server';
import Link from 'next/link';
import { Card } from '@/components/card';
import { Notice } from '@/components/notice';
import { listDate } from '@/components/lists/list-sheet';
import { requireProfile } from '@/lib/auth/session';
import { tradeLabel } from '@/lib/check/trades';
import { langOfProfile, t } from '@/lib/i18n';
import { AREA_LIST_DAYS, STORM_LIST_DAYS } from '@/lib/lists/core';
import { loadAreaCounts, loadStormList, loadStormReports, type StormReportItem } from '@/lib/lists/load';
import { createClient } from '@/lib/supabase/server';
import { localizeTitle } from '@/lib/signals/title-i18n';
import { countText, isLocked, listProfileOf, LIST_METADATA, LockedLists } from './shared';

export const metadata: Metadata = { title: 'Lists', ...LIST_METADATA };

/**
 * /app/lists (round 18, unit LISTS): the member's storm-path lists and neighborhood lists, with address counts. Signed-in members only
 * (requireProfile), behind the /app layout's Suspense boundary; every read is a request-time read with the member's own session client.
 */
async function loadIndex() {
  // Request-time only: the session read and the clock below never run in a prerender (no Date.now() prerender warning).
  await connection();
  const { profile } = await requireProfile();
  const lang = langOfProfile(profile);
  if (isLocked(profile)) return { lang, locked: true as const };
  const db = await createClient();
  const lp = listProfileOf(profile);
  const now = new Date();
  try {
    const [reports, areas] = await Promise.all([loadStormReports(db, lp, now), loadAreaCounts(db, lp, now)]);
    const stormCounts = await Promise.all(reports.map((r) => loadStormList(db, r, now).then((l) => l.total).catch(() => null)));
    return { lang, locked: false as const, failed: false, storms: reports.map((r, i) => ({ r, count: stormCounts[i] })), areas };
  } catch {
    return { lang, locked: false as const, failed: true, storms: [] as { r: StormReportItem; count: number | null }[], areas: [] as { trade: string; total: number; partial: boolean }[] };
  }
}

export default async function ListsPage() {
  const data = await loadIndex();
  const { lang } = data;
  return (
    <>
      <h1 className="text-5xl text-ink">{t(lang, 'lists.title')}</h1>
      <p className="mt-2 text-muted">{t(lang, 'lists.intro')}</p>
      {data.locked ? (
        <LockedLists lang={lang} />
      ) : (
        <>
          {data.failed ? (
            <div className="mt-6">
              <Notice tone="danger" role="alert">{t(lang, 'lists.error')}</Notice>
            </div>
          ) : null}

          <section aria-labelledby="storm-lists-h" className="mt-8">
            <h2 id="storm-lists-h" className="h-plain text-2xl text-ink">{t(lang, 'lists.storm.h')}</h2>
            <p className="mt-1 text-sm text-muted">{t(lang, 'lists.storm.sub', { days: STORM_LIST_DAYS })}</p>
            {data.storms.length === 0 ? (
              <p className="mt-3 text-muted" data-testid="storm-lists-empty">{t(lang, 'lists.storm.none', { days: STORM_LIST_DAYS })}</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {data.storms.map(({ r, count }) => {
                  // The report's own title ("1.75 inch hail reported near 2 ESE Smyrna, GA"): size or speed and SPC's place tell two storms in
                  // one town apart (review P3-17).
                  return (
                    <li key={r.id}>
                      <Card className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words font-semibold text-ink">{localizeTitle(r.title, lang, 'spc')}</p>
                          <p className="text-sm text-muted">
                            {listDate(r.occurredAt, lang)}
                            {count === null ? '' : ` · ${countText(count, lang)}`}
                          </p>
                        </div>
                        <Link href={`/app/lists/storm?id=${r.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline">
                          {t(lang, 'lists.open')}
                        </Link>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="area-lists-h" className="mt-10">
            <h2 id="area-lists-h" className="h-plain text-2xl text-ink">{t(lang, 'lists.area.h')}</h2>
            <p className="mt-1 text-sm text-muted">{t(lang, 'lists.area.sub', { days: AREA_LIST_DAYS })}</p>
            {data.areas.length === 0 ? (
              <p className="mt-3 text-muted" data-testid="area-lists-empty">{t(lang, 'lists.area.none')}</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {data.areas.map((a) => (
                  <li key={a.trade}>
                    <Card className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">{tradeLabel(a.trade, lang)}</p>
                        <p className="text-sm text-muted">{a.partial ? t(lang, 'lists.count.plus', { n: a.total.toLocaleString('en-US') }) : countText(a.total, lang)}</p>
                      </div>
                      <Link href={`/app/lists/area?trade=${encodeURIComponent(a.trade)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline">
                        {t(lang, 'lists.open')}
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="mt-10">
            <Link href="/app/lists/door-hanger" className="inline-flex min-h-11 items-center font-semibold text-brand-text underline">
              {t(lang, 'lists.hanger.link')}
            </Link>
          </p>
        </>
      )}
    </>
  );
}
