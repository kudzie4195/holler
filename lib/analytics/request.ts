import 'server-only';
import { cookies, headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { looksAutomated, parseSid, parseSrc, privacyHeaderOn, SID_COOKIE, SRC_COOKIE, type Attribution } from './attr';
import { track } from './server';

export interface EventContext {
  /** Global Privacy Control or Do Not Track is on for this request. Visitor-level events must not be recorded. */
  optedOut: boolean;
  /** Obvious automation by user agent. Inspected only, never stored. */
  automated: boolean;
  sessionId: string | undefined;
  attribution: Attribution | null;
}

/**
 * What the request's cookies and privacy headers say. Reads request data, so call it only from a render that is already dynamic
 * (inside Suspense after connection()) or from a server action or route handler. Never from a layout or a static page.
 * When a privacy signal is on, the cookies are ignored: no session id and no attribution.
 */
export async function eventContext(): Promise<EventContext> {
  const h = await headers();
  const optedOut = privacyHeaderOn((n) => h.get(n));
  const automated = looksAutomated(h.get('user-agent'), h.get('sec-ch-ua'));
  if (optedOut) return { optedOut, automated, sessionId: undefined, attribution: null };
  const jar = await cookies();
  return {
    optedOut,
    automated,
    sessionId: parseSid(jar.get(SID_COOKIE)?.value)?.sid,
    attribution: parseSrc(jar.get(SRC_COOKIE)?.value),
  };
}

/**
 * A visitor-level step from a server render (area_check). Skipped for privacy signals and automation. Never throws.
 * Pass the context you already read, so the request's cookies are read once.
 */
export async function trackVisitorStep(name: 'area_check', ctx: EventContext, path: string): Promise<void> {
  if (ctx.optedOut || ctx.automated) return;
  await track(name, {
    sessionId: ctx.sessionId,
    source: ctx.attribution?.source,
    medium: ctx.attribution?.medium ?? undefined,
    campaign: ctx.attribution?.campaign ?? undefined,
    path,
  });
}

/**
 * The member's profile was just created: store their first-touch attribution (once, never overwritten) and record signup and
 * trial_start. Account records, not visitor tracking, so they are written even when a privacy signal is on; in that case the
 * cookies are ignored and the rows carry no session id and no source. Never throws.
 */
export async function recordSignup(userId: string): Promise<void> {
  try {
    const ctx = await eventContext();
    const a = ctx.attribution;
    if (a) {
      try {
        const { error } = await createAdminClient()
          .from('holler_attribution')
          .upsert({ user_id: userId, source: a.source, medium: a.medium, campaign: a.campaign }, { onConflict: 'user_id', ignoreDuplicates: true });
        if (error && error.code !== '42P01') console.error('[analytics] attribution failed', error.code ?? 'unknown');
      } catch {
        // not configured
      }
    }
    const props = {
      userId,
      sessionId: ctx.sessionId,
      source: a?.source,
      medium: a?.medium ?? undefined,
      campaign: a?.campaign ?? undefined,
    };
    await track('signup', props);
    await track('trial_start', props);
  } catch {
    // never throws
  }
}
