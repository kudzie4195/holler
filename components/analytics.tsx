'use client';

import { useEffect } from 'react';
import { runAnalytics } from '@/lib/analytics/client';

/**
 * First-party funnel tracking, mounted once in app/layout.tsx. Renders nothing and reads no request data on the server, so no page
 * becomes dynamic because of it: everything happens in the browser after mount. See lib/analytics/client.ts for the rules.
 */
export function Analytics() {
  useEffect(() => {
    try {
      const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
      runAnalytics({
        getCookie: () => document.cookie,
        setCookie: (v) => {
          document.cookie = v;
        },
        navigator: navigator as unknown as Parameters<typeof runAnalytics>[0]['navigator'],
        win: window as unknown as { doNotTrack?: unknown },
        search: window.location.search,
        pathname: window.location.pathname,
        secure: window.location.protocol === 'https:',
        now: () => Date.now(),
        randomBytes: () => crypto.getRandomValues(new Uint8Array(16)),
        native: !!w.Capacitor?.isNativePlatform?.(),
        fetchFn: (url, init) => fetch(url, init),
      });
    } catch {
      // Analytics must never break the page.
    }
  }, []);
  return null;
}
