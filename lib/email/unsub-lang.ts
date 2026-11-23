import { parseLang, type Lang } from '@/lib/i18n';

/**
 * The language of an unsubscribe page (round 24): chosen the way the rest of the site chooses it.
 *  1. `l=es` on the link or in the confirm form, as on the other token pages (app/api/auth/verify/route.ts): it picks the words only.
 *  2. Otherwise the member's own saved language (holler_profiles.language, migration 0024), the setting every signed-in page and every
 *     email already reads (lib/i18n langOfProfile). The token names the member, so no session is needed.
 * Anything else, a missing column, a failed read or an invalid token, is English: the page is then byte for byte what it was before.
 * Never throws.
 */
export async function unsubscribeLang(
  req: Request,
  userId: string | null,
  readLanguage: (userId: string) => PromiseLike<unknown>,
  form?: FormData | null,
): Promise<Lang> {
  const hint = form?.get('l') ?? new URL(req.url).searchParams.get('l');
  if (hint === 'es') return 'es';
  if (!userId) return 'en';
  try {
    return parseLang(await readLanguage(userId));
  } catch {
    return 'en';
  }
}

/** Reads holler_profiles.language for one member with the given client. Null on any error (a missing column is error 42703 / PGRST204). */
export function profileLanguageReader(db: { from: (table: string) => unknown }): (userId: string) => Promise<unknown> {
  return async (userId: string) => {
    type Q = { select: (c: string) => Q; eq: (c: string, v: string) => Q; limit: (n: number) => PromiseLike<{ data: Array<{ language?: unknown }> | null; error: unknown }> };
    const q = db.from('holler_profiles') as Q;
    const { data, error } = await q.select('language').eq('user_id', userId).limit(1);
    return error ? null : (data?.[0]?.language ?? null);
  };
}
