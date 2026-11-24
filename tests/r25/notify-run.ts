// Round 25: the REAL notify route (app/api/cron/notify/route.ts) run over one member's matches through a fake admin client, as in
// tests/r24/check-delivery.test.ts: the scan's matchSignals makes the matches, the route sends one digest, and the match ids it marks
// notified after the send are the records it emailed. Used to prove the /check count is the emailed count.
import { expect, vi } from 'vitest';
import { lookupZip } from '@/lib/geo';
import { matchSignals, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import { contactPathOf } from '@/lib/signals/alert-gate';
import { isPermitRecord } from '@/lib/signals/permit-routing';
import type { ExportRow } from './export-reads';

const OFFSET = 10_000_000;

export function scanMatches(zip: string, trades: string[], recs: readonly ExportRow[], now: Date) {
  const place = lookupZip(zip)!;
  const member: MatchProfile = { user_id: 'u1', categories: trades, lat: place.lat, lon: place.lon, state: place.state, radius_mi: 25, plan: null, subscription_status: 'trialing' };
  const out: Array<{ id: number; user_id: string; created_at: string; alert_hold: string | null; signal: Record<string, unknown> }> = [];
  for (const r of recs) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const sub = typeof d.subtype === 'string' ? d.subtype : null;
    const sig: MatchSignal = { ...(r as unknown as MatchSignal), subtype: sub, data: d as MatchSignal['data'] };
    if (isPermitRecord({ source: r.source, kind: r.kind, subtype: sub })) sig.contactPath = contactPathOf([], r.summary);
    const m = matchSignals([sig], [member], undefined, now, false)[0];
    if (!m) continue;
    out.push({
      id: OFFSET + r.id,
      user_id: 'u1',
      created_at: new Date(now.getTime() - 60_000).toISOString(),
      alert_hold: m.alert_hold ?? null,
      signal: {
        ...r,
        subtype: sub,
        approxLocation: d.approxLocation == null ? null : String(d.approxLocation),
        loc: d.loc ?? null,
        alertId: d.alertId ?? null,
        deadline: d.deadline ?? null,
        fixBy: d.fixBy ?? null,
        responseDeadline: d.responseDeadline ?? null,
        dueDate: d.dueDate ?? null,
        permitStage: d.permitStage ?? null,
      },
    });
  }
  return out;
}

let marked: Array<{ ids: number[]; afterSend: boolean }> = [];
let sends = 0;
/**
 * R25 check fix (review R25CHECK P1-3): what each digest the route rendered really shows: the cards listed (the items passed to
 * renderDigest), the matches it stands for (totalCount) and its plain text, so a test can assert against the email, not only the ids.
 */
export const digests: Array<{ cards: number[]; total: number; text: string }> = [];
function adminFake(matches: unknown[], trades: string[]) {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      let patch: unknown = null;
      for (const m of ['select', 'eq', 'order', 'is', 'gte', 'lte', 'not', 'limit']) q[m] = () => q;
      q.range = (a: number, b: number) => Promise.resolve({ data: table === 'holler_matches' ? matches.slice(a, b + 1) : [], error: null });
      q.update = (p: unknown) => ((patch = p), q);
      q.insert = () => Promise.resolve({ error: null });
      q.upsert = () => Promise.resolve({ error: null });
      q.in = (_col: unknown, ids: unknown) =>
        patch
          ? (table === 'holler_matches' && marked.push({ ids: ids as number[], afterSend: sends > 0 }), Promise.resolve({ error: null }))
          : Promise.resolve({
              data:
                table === 'holler_profiles'
                  ? [{ user_id: 'u1', business_name: 'Acme', categories: trades, plan: null, alert_email: true, subscription_status: 'trialing', trial_ends_at: '2026-12-20T00:00:00Z', last_notified_at: null, email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z', language: 'en' }]
                  : [],
              error: null,
            });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return q;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@acme.test' } }, error: null }) } },
  };
}

/** Runs the real notify GET over the member's matches and returns the record ids it emailed (marked notified after the send). */
export async function emailedByNotify(matches: ReturnType<typeof scanMatches>, trades: string[]): Promise<Set<number>> {
  marked = [];
  sends = 0;
  digests.length = 0;
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake(matches, trades) }));
  vi.doMock('@/lib/outreach/loader', async (orig) => {
    const real = await orig<typeof import('@/lib/outreach/loader')>();
    return { ...real, loadMemberContacts: async () => new Map() };
  });
  vi.doMock('@/lib/push/notify', () => ({ pushNewMatches: async () => ({}) }));
  vi.doMock('@/lib/email', async (orig) => {
    const real = await orig<typeof import('@/lib/email')>();
    return {
      ...real,
      renderDigest: (opts: Parameters<typeof real.renderDigest>[0]) => {
        const mail = real.renderDigest(opts);
        digests.push({ cards: opts.items.map((i) => (typeof i.matchId === 'number' ? i.matchId - OFFSET : -1)), total: opts.totalCount ?? opts.items.length, text: mail.text });
        return mail;
      },
      sendEmail: async () => (sends++, { ok: true, id: 'x' }),
    };
  });
  const GET = (await import('@/app/api/cron/notify/route')).GET;
  const res = await GET(new Request('http://localhost/api/cron/notify', { headers: { authorization: 'Bearer s3cret' } }));
  expect(res.status).toBe(200);
  vi.unstubAllEnvs();
  return new Set(marked.filter((m) => m.afterSend).flatMap((m) => m.ids).map((id) => id - OFFSET));
}
