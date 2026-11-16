/** "4 min ago", "3 hr ago", "2 days ago", or a short date for anything older than two weeks. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day} ${day === 1 ? 'day' : 'days'} ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDistance(mi: number | null | undefined): string | null {
  if (mi == null || !Number.isFinite(mi)) return null;
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
