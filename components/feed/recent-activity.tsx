import Link from 'next/link';
import { getProfile } from '@/lib/auth/session';
import { recentPreviewFor, typeLabel, type RecentPreview } from '@/lib/preview/recent';
import { langOfProfile, t, type Lang } from '@/lib/i18n';
import { localizeTitle } from '@/lib/signals/title-i18n';

export const RECENT_NOTE = 'These are past records, so you can see what Holler watches. New alerts show up here as they happen.';
export const RECENT_EMPTY = 'Nothing matched your area and trades in the last 90 days. Try a wider radius or more trades in Settings.';

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function fmtDate(iso: string, lang: Lang = 'en'): string {
  const ms = Date.parse(`${iso}T12:00:00Z`);
  if (!Number.isFinite(ms)) return iso;
  // Spanish: "5 nov". English is the date it always was.
  if (lang !== 'en') {
    const d = new Date(ms);
    return `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}`;
  }
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The markup, from a finished preview. Every number is a count the query returned; zero lines are never drawn. */
/** `lang` 'es' writes the heading, counts, notes and example titles in Spanish (titles Holler composed are rebuilt; a title a source wrote stays). English is the default and unchanged. */
export function RecentActivityView({ preview, lang = 'en' }: { preview: RecentPreview; lang?: Lang }) {
  const lines = preview.byType.filter((ty) => ty.count > 0);
  const empty = preview.total <= 0 || lines.length === 0;
  return (
    <section aria-labelledby="recent-activity-h" className="rounded-card border border-line bg-surface p-5 shadow-soft md:p-6">
      <h2 id="recent-activity-h" className="h-plain text-xl text-ink">
        {lang === 'en' ? 'Near you in the last 90 days' : t(lang, 'recent.h')}
      </h2>
      {empty ? (
        <>
          <p className="mt-3 text-muted">{lang === 'en' ? RECENT_EMPTY : t(lang, 'recent.empty')}</p>
          <Link href="/app/settings" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline md:min-h-9">
            {lang === 'en' ? 'Open Settings' : t(lang, 'recent.settings')}
          </Link>
        </>
      ) : (
        <>
          <ul className="mt-3 space-y-1 text-lg text-ink">
            {lines.map((ty) => (
              <li key={ty.key}>
                {preview.capped ? (lang === 'en' ? 'At least ' : t(lang, 'recent.at_least')) : ''}
                {ty.count.toLocaleString('en-US')} {typeLabel(ty.key, ty.count, lang)}
              </li>
            ))}
          </ul>
          {preview.examples.length > 0 ? (
            <ul className="mt-4 space-y-2 border-t border-line pt-4 text-sm text-muted">
              {preview.examples.map((e, i) => (
                <li key={`${e.date}-${i}`}>
                  <span className="text-ink">{lang === 'en' ? e.title : localizeTitle(e.title, lang)}</span>
                  {e.city ? `, ${e.city}${e.state ? `, ${e.state}` : ''}` : ''} ({fmtDate(e.date, lang)})
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-4 text-sm text-muted">{lang === 'en' ? RECENT_NOTE : t(lang, 'recent.note')}</p>
        </>
      )}
    </section>
  );
}

/**
 * What Holler watches near this member, from real past records. Renders nothing when the member has no saved area or trades, or the
 * records cannot be read. Reads the member's own profile and one service-role read of public signal columns (lib/preview/recent.ts).
 * Reads cookies, so render it inside Suspense.
 */
export async function RecentActivity({ userId }: { userId: string }) {
  const profile = await getProfile(userId);
  if (!profile) return null;
  const preview = await recentPreviewFor(profile);
  if (!preview) return null;
  return <RecentActivityView preview={preview} lang={langOfProfile(profile)} />;
}
