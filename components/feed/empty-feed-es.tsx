import Link from 'next/link';
import { t, type Lang } from '@/lib/i18n';

/**
 * Empty feed for a member who chose Spanish: one short card from the dictionary, with a link to the free Spanish area check for the
 * member's ZIP and first trade. The English empty feed (empty-feed.tsx) lists live counts in English, so it is not shown to them.
 */
export function EmptyFeedShort({ lang, zip, trade }: { lang: Lang; zip: string | null; trade: string | null }) {
  const checkHref = zip && /^\d{5}$/.test(zip) ? `/es/check?zip=${encodeURIComponent(zip)}${trade ? `&trade=${encodeURIComponent(trade)}` : ''}` : '/es/check';
  return (
    <section aria-labelledby="empty-feed-h" className="rounded-card border border-line bg-surface p-5 shadow-soft md:p-6" data-testid="empty-feed">
      <h2 id="empty-feed-h" className="h-plain text-2xl text-ink">
        {t(lang, 'emptyfeed.title')}
      </h2>
      <p className="mt-2 text-muted">{t(lang, 'emptyfeed.body')}</p>
      <div className="mt-3 flex flex-col gap-1">
        <Link href={checkHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline md:min-h-9">
          {t(lang, 'emptyfeed.check_link')}
        </Link>
        <Link href="/app/settings" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline md:min-h-9">
          {t(lang, 'emptyfeed.settings_link')}
        </Link>
      </div>
    </section>
  );
}
