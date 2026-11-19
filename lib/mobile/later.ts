import 'server-only';
import { after } from 'next/server';

/** Runs `fn` after the response (next/server after). Outside a request scope (tests, scripts) it runs at once, unawaited. Never throws. */
export function later(fn: () => Promise<unknown>): void {
  const safe = () => fn().catch((e) => console.error('[mobile] after-response task failed', e instanceof Error ? e.message : e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}
