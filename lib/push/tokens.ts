import type { SupabaseClient } from '@supabase/supabase-js';
import type { DevicePlatform } from '@/lib/mobile/types';

/**
 * Device tokens (holler_push_tokens, migration 0020; service role only). Written by POST/DELETE /api/m/push/register for the signed-in
 * member, read by lib/push/notify.ts. Every function takes the service-role client and never throws.
 */
type Db = Pick<SupabaseClient, 'from'>;

/** Devices kept per member. Registering an eleventh deletes the one seen longest ago. */
export const MAX_DEVICES = 10;
/** Members (or ids) per .in() filter, like the other chunked reads. */
const CHUNK = 200;
/** Rows per page (PostgREST answers at most 1000) and the most pages one run reads. */
const PAGE = 1000;
const MAX_PAGES = 20;

const chunks = <T>(list: T[], n: number): T[][] => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

export type TokenWrite = 'ok' | 'not_configured' | 'failed';

export function validToken(t: unknown): t is string {
  return typeof t === 'string' && t.length >= 20 && t.length <= 4096 && /^[A-Za-z0-9_:\-.]+$/.test(t);
}

export function validPlatform(p: unknown): p is DevicePlatform {
  return p === 'ios' || p === 'android';
}

export function cleanAppVersion(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9A-Za-z.+-]{1,32}$/.test(v) ? v : null;
}

export function isMissingTable(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || /does not exist|schema cache/i.test(e.message ?? '');
}

/**
 * Stores the token for this member (upsert on the token). A token that was registered by another account on the same device moves to
 * this member: the device now belongs to whoever is signed in on it. A disabled token is enabled again.
 * At most MAX_DEVICES rows are kept per member, active or disabled: beyond that the rows seen longest ago are deleted (disabled rows
 * go first), so repeated registrations cannot grow the table.
 */
export async function registerToken(
  db: Db,
  userId: string,
  input: { token: string; platform: DevicePlatform; appVersion: string | null },
  now: Date = new Date(),
): Promise<TokenWrite> {
  try {
    const { error } = await db.from('holler_push_tokens').upsert(
      {
        user_id: userId,
        token: input.token,
        platform: input.platform,
        app_version: input.appVersion,
        last_seen_at: now.toISOString(),
        disabled_at: null,
      },
      { onConflict: 'token' },
    );
    if (error) return isMissingTable(error) ? 'not_configured' : 'failed';
    const { data, error: lErr } = await db
      .from('holler_push_tokens')
      .select('id, last_seen_at, disabled_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false });
    if (!lErr && Array.isArray(data) && data.length > MAX_DEVICES) {
      const rows = data as { id: string; last_seen_at: string | null; disabled_at: string | null }[];
      // Active rows first (newest first), then disabled ones; keep the first MAX_DEVICES.
      const ordered = [...rows.filter((r) => !r.disabled_at), ...rows.filter((r) => !!r.disabled_at)];
      const extra = ordered.slice(MAX_DEVICES).map((r) => r.id);
      for (const ids of chunks(extra, CHUNK)) await db.from('holler_push_tokens').delete().in('id', ids).eq('user_id', userId);
    }
    return 'ok';
  } catch {
    return 'failed';
  }
}

/** Removes the token, only if it is this member's. */
export async function unregisterToken(db: Db, userId: string, token: string): Promise<TokenWrite> {
  try {
    const { error } = await db.from('holler_push_tokens').delete().eq('token', token).eq('user_id', userId);
    if (error) return isMissingTable(error) ? 'not_configured' : 'failed';
    return 'ok';
  } catch {
    return 'failed';
  }
}

export interface ActiveToken {
  id: string;
  user_id: string;
  token: string;
  platform: DevicePlatform;
}

export interface ActiveTokenRead {
  tokens: ActiveToken[];
  /** not_ready: the table is not there yet (migration 0020). failed: a read failed (tokens read so far are kept). */
  error: 'not_ready' | 'failed' | null;
}

/**
 * Every active device, read in pages of PAGE rows by id (keyset, so rows added during the read cannot shift a page), at most
 * MAX_PAGES pages. Never throws.
 */
export async function allActiveTokens(db: Db): Promise<ActiveTokenRead> {
  const out: ActiveToken[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      let q = db.from('holler_push_tokens').select('id, user_id, token, platform').is('disabled_at', null);
      if (after) q = q.gt('id', after);
      const { data, error } = await q.order('id', { ascending: true }).limit(PAGE);
      if (error) return { tokens: out, error: isMissingTable(error) ? 'not_ready' : 'failed' };
      const rows = (Array.isArray(data) ? data : []) as ActiveToken[];
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
      if (rows.length < PAGE) break;
      after = rows[rows.length - 1].id;
    }
    return { tokens: out, error: null };
  } catch {
    return { tokens: out, error: 'failed' };
  }
}

/** Active tokens for these members, read in chunks of CHUNK members. Never throws. */
export async function activeTokens(db: Db, userIds: string[]): Promise<ActiveTokenRead> {
  const out: ActiveToken[] = [];
  try {
    for (const ids of chunks(userIds, CHUNK)) {
      const { data, error } = await db.from('holler_push_tokens').select('id, user_id, token, platform').in('user_id', ids).is('disabled_at', null);
      if (error) return { tokens: out, error: isMissingTable(error) ? 'not_ready' : 'failed' };
      if (Array.isArray(data)) out.push(...(data as ActiveToken[]));
    }
    return { tokens: out, error: null };
  } catch {
    return { tokens: out, error: 'failed' };
  }
}

/** Marks tokens the push service says are gone (lib/push/fcm.ts deadToken). Never throws. */
export async function disableTokens(db: Db, ids: string[], now: Date = new Date()): Promise<void> {
  for (const part of chunks(ids, CHUNK)) {
    try {
      await db.from('holler_push_tokens').update({ disabled_at: now.toISOString() }).in('id', part);
    } catch {
      // best effort
    }
  }
}
