import Link from 'next/link';
import { getProfile } from '@/lib/auth/session';
import { recentPreviewFor, typeLabel, type RecentPreview } from '@/lib/preview/recent';

export const RECENT_NOTE = 'These are past records, so you can see what Holler watches. New alerts show up here as they happen.';
export const RECENT_EMPTY = 'Nothing matched your area and trades in the last 90 days. Try a wider radius or more trades in Settings.';

function fmtDate(iso: string): string {
  const t = Date.parse(`${iso}T12:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : iso;
}

/** The markup, from a finished preview. Every number is a count the query returned; zero lines are never drawn. */
export function RecentActivityView({ preview }: { preview: RecentPreview }) {
  const lines = preview.byType.filter((t) => t.count > 0);
  const empty = preview.total <= 0 || lines.length === 0;
  return (
    <section aria-labelledby="recent-activity-h" className="rounded-card border border-line bg-surface p-5 shadow-soft md:p-6">
      <h2 id="recent-activity-h" className="text-xl font-semibold text-ink">
        Near you in the last 90 days
      </h2>
      {empty ? (
        <>
          <p className="mt-3 text-muted">{RECENT_EMPTY}</p>
          <Link href="/app/settings" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent-text underline md:min-h-9">
            Open Settings
          </Link>
        </>
      ) : (
        <>
          <ul className="mt-3 space-y-1 text-lg text-ink">
            {lines.map((t) => (
              <li key={t.key}>
                {preview.capped ? 'At least ' : ''}
                {t.count.toLocaleString('en-US')} {typeLabel(t.key, t.count)}
              </li>
            ))}
          </ul>
          {preview.examples.length > 0 ? (
            <ul className="mt-4 space-y-2 border-t border-line pt-4 text-sm text-muted">
              {preview.examples.map((e, i) => (
                <li key={`${e.date}-${i}`}>
                  <span className="text-ink">{e.title}</span>
                  {e.city ? `, ${e.city}${e.state ? `, ${e.state}` : ''}` : ''} ({fmtDate(e.date)})
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-4 text-sm text-muted">{RECENT_NOTE}</p>
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
  return <RecentActivityView preview={preview} />;
}
