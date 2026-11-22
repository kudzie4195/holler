'use client';

import { useEffect, useSyncExternalStore } from 'react';

const noop = () => () => {};
const SPANISH_HINT = /(?:^|;\s*)holler_lang=es(?:;|$)/;

/**
 * True in the browser when the holler_lang hint cookie says Spanish (lib/auth/lang-cookie.ts). Always false on the server and during
 * hydration (the server snapshot), so server markup never depends on the cookie. Used by the static /app header fallback so that a CLIENT
 * navigation into /app (where the inline script does not run) also shows the Spanish words at once (review 2 P3-1).
 */
export function useSpanishHint(): boolean {
  return useSyncExternalStore(noop, () => SPANISH_HINT.test(document.cookie), () => false);
}

/** `en` on the server; `es` in a browser whose hint says Spanish. The parent element carries suppressHydrationWarning. */
export function HintText({ en, es }: { en: string; es: string }) {
  return useSpanishHint() ? es : en;
}

/**
 * In the static /app header fallback: on a client navigation into /app (where the inline script does not run), sets <html lang="es"> at
 * once when the hint says Spanish, instead of waiting for the member's header to stream in. Renders nothing.
 */
export function HintDocLang() {
  const spanish = useSpanishHint();
  useEffect(() => {
    if (spanish) document.documentElement.lang = 'es';
  }, [spanish]);
  return null;
}
