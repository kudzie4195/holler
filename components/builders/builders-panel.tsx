import { ActiveBuilders } from './active-builders';
import { cachedActiveBuilders, type BuilderScope } from '@/lib/builders/cached';
import type { Lang } from '@/lib/i18n';

/**
 * Server component for /app: reads the cached builders list (lib/builders/cached.ts) and renders the panel. The page wraps it in its own
 * Suspense below the feed (round 19 review, defect 4), so the feed never waits for it. Any failure renders nothing.
 */
export async function BuildersPanel({ userId, scope, lang }: { userId: string; scope: BuilderScope; lang: Lang }) {
  let res: Awaited<ReturnType<typeof cachedActiveBuilders>>;
  try {
    res = await cachedActiveBuilders(userId, scope);
  } catch {
    return null;
  }
  return <ActiveBuilders builders={res.builders} windowDays={res.windowDays} lang={lang} />;
}
