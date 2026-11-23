import { relativeTime } from '@/lib/time';
import { t, type Lang } from '@/lib/i18n';

/** "4 min ago", "3 hr ago", "2 days ago", "in 3 days" for an event that has not started, or a short date from two weeks out either way. */
export function timeAgo(iso: string, now: number = Date.now(), lang: Lang = 'en'): string {
  return relativeTime(iso, now, 'app', lang);
}

export function formatDistance(mi: number | null | undefined, lang: Lang = 'en'): string | null {
  if (mi == null || !Number.isFinite(mi)) return null;
  if (lang !== 'en') return mi < 1 ? t(lang, 'distance.under_1') : t(lang, 'distance.mi', { n: mi < 10 ? mi.toFixed(1).replace(/\.0$/, '') : Math.round(mi) });
  if (mi < 1) return 'under 1 mi away';
  return `${mi < 10 ? mi.toFixed(1).replace(/\.0$/, '') : Math.round(mi)} mi away`;
}

/** Replaces letters and digits with x so a locked feed ships no real text to the browser. */
export function maskText(text: string): string {
  return text.replace(/[A-Za-z0-9]/g, 'x');
}

/** Full page load to a same-site path. Used after auth changes so the new session cookie is picked up everywhere. */
export function hardNavigate(path: string) {
  window.location.href = new URL(path, window.location.origin).href;
}
