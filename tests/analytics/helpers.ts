import type { ClientEnv } from '@/lib/analytics/client';

/** A tiny cookie jar plus the browser object, enough for runAnalytics. */
export function fakeBrowser(over: Partial<ClientEnv> & { jar?: Record<string, string>; refuseCookies?: boolean } = {}) {
  const jar: Record<string, string> = { ...(over.jar ?? {}) };
  const writes: string[] = [];
  const beacons: { url: string; body: string }[] = [];
  const fetches: { url: string; init: RequestInit }[] = [];
  const env: ClientEnv = {
    getCookie: () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
    setCookie: (raw) => {
      writes.push(raw);
      if (over.refuseCookies) return;
      const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (attrs.some((a) => a === 'Max-Age=0')) delete jar[k];
      else jar[k] = v;
    },
    navigator: {
      sendBeacon: (url: string, data: Blob) => {
        // Blob text is async; the tests read the size and rely on `lastBody` below.
        beacons.push({ url, body: (data as unknown as { __t?: string }).__t ?? '' });
        return true;
      },
      ...(over.navigator ?? {}),
    },
    win: over.win ?? null,
    search: over.search ?? '',
    pathname: over.pathname ?? '/',
    secure: over.secure ?? true,
    now: over.now ?? (() => Date.UTC(2026, 10, 19, 12)),
    randomBytes: over.randomBytes ?? (() => Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 1)),
    native: over.native ?? false,
    fetchFn: over.fetchFn ?? (async (url, init) => void fetches.push({ url, init })),
  };
  return { env, jar, writes, beacons, fetches };
}
