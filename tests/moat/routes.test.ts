/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  rpcCalls: [] as any[],
  rpcResult: 'recorded' as string,
  pending: true,
  runArgs: null as any,
}));

vi.mock('@/lib/env', () => ({ env: { CRON_SECRET: 'cron-secret-test' }, siteUrl: 'https://example.test' }));
vi.mock('@/lib/auth/session', () => ({ getUser: async () => h.user }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: any) => {
      h.rpcCalls.push({ fn, args });
      return { data: h.rpcResult, error: null };
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const q: any = { select: () => q, eq: () => q, is: () => q, limit: async () => ({ data: h.pending ? [{ id: 1 }] : [], error: null }) };
      return q;
    },
  }),
}));
vi.mock('@/lib/email', async (orig) => ({ ...((await orig()) as any), sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/moat/run', () => ({
  runMoat: async (a: any) => {
    h.runArgs = a;
    return { dry: a.dry, candidates: 0 };
  },
}));

import * as outcome from '@/app/api/feedback/outcome/route';
import * as feed from '@/app/api/feedback/outcome/feed/route';
import * as cron from '@/app/api/cron/moat/route';
import { signOutcomeToken } from '@/lib/moat/token';

const S = 'cron-secret-test';
const tok = (u = 'u1', s = 7, a: 'yes' | 'no' = 'yes') => signOutcomeToken(u, s, a, S);
const url = (t: string) => `https://example.test/api/feedback/outcome?t=${encodeURIComponent(t)}`;
const post = (t: string) => new Request('https://example.test/api/feedback/outcome', { method: 'POST', body: new URLSearchParams({ t }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

beforeEach(() => {
  h.user = { id: 'u1' };
  h.rpcCalls = [];
  h.rpcResult = 'recorded';
  h.pending = true;
  h.runArgs = null;
});

describe('outcome link page', () => {
  it('GET shows a confirm page and changes nothing (mail scanners open every link)', async () => {
    const res = outcome.GET(new Request(url(tok())));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Yes, it led to work');
    expect(h.rpcCalls).toHaveLength(0);
  });
  it('a bad, tampered or expired link is refused on GET and POST', async () => {
    expect(outcome.GET(new Request(url('nope'))).status).toBe(400);
    expect((await outcome.POST(post('nope'))).status).toBe(400);
    expect((await outcome.POST(post(tok() + 'x'))).status).toBe(400);
    expect(h.rpcCalls).toHaveLength(0);
  });
  it('POST records exactly the member, alert and answer inside the token, with no login', async () => {
    const res = await outcome.POST(post(tok('u1', 7, 'yes')));
    expect(res.status).toBe(200);
    expect(h.rpcCalls).toEqual([{ fn: 'holler_record_outcome', args: { p_user: 'u1', p_signal: 7, p_answer: 'yes' } }]);
    await outcome.POST(post(tok('u2', 9, 'no')));
    expect(h.rpcCalls[1].args).toEqual({ p_user: 'u2', p_signal: 9, p_answer: 'no' });
  });
  it('a replay is told it was already answered and nothing else changes', async () => {
    h.rpcResult = 'already';
    const res = await outcome.POST(post(tok()));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Already answered');
  });
  it('a token for an alert that was never asked is refused', async () => {
    h.rpcResult = 'none';
    expect((await outcome.POST(post(tok()))).status).toBe(400);
  });
});

describe('feed route', () => {
  const j = (body: unknown, type = 'application/json') => new Request('https://example.test/api/feedback/outcome/feed', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': type } });
  it('GET reports a pending ask only for the signed-in member', async () => {
    expect(await (await feed.GET(new Request('https://example.test/x?signal=7'))).json()).toEqual({ pending: true });
    h.user = null;
    expect(await (await feed.GET(new Request('https://example.test/x?signal=7'))).json()).toEqual({ pending: false });
    expect(await (await feed.GET(new Request('https://example.test/x?signal=abc'))).json()).toEqual({ pending: false });
  });
  it('POST answers for the session member, never one named in the body', async () => {
    const res = await feed.POST(j({ signalId: 7, answer: 'not_yet', userId: 'u2' }));
    expect(res.status).toBe(200);
    expect(h.rpcCalls[0].args).toEqual({ p_user: 'u1', p_signal: 7, p_answer: 'not_yet' });
  });
  it('POST refuses signed out, bad input and non-JSON bodies', async () => {
    h.user = null;
    expect((await feed.POST(j({ signalId: 7, answer: 'yes' }))).status).toBe(401);
    h.user = { id: 'u1' };
    expect((await feed.POST(j({ signalId: 7, answer: 'maybe' }))).status).toBe(400);
    expect((await feed.POST(j({ signalId: '7', answer: 'yes' }))).status).toBe(400);
    expect((await feed.POST(j({ signalId: 7, answer: 'yes' }, 'application/x-www-form-urlencoded'))).status).toBe(415);
    expect(h.rpcCalls).toHaveLength(0);
  });
  it('POST for an alert with no ask answers 404', async () => {
    h.rpcResult = 'none';
    expect((await feed.POST(j({ signalId: 7, answer: 'yes' }))).status).toBe(404);
  });
});

describe('cron route', () => {
  it('is protected like the other cron routes', async () => {
    expect((await cron.GET(new Request('https://example.test/api/cron/moat'))).status).toBe(401);
    expect((await cron.GET(new Request('https://example.test/api/cron/moat', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
  });
  it('?dry=1 passes dry to the run and swaps the sender for one that sends nothing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const res = await cron.GET(new Request('https://example.test/api/cron/moat?dry=1', { headers: { authorization: 'Bearer cron-secret-test' } }));
    expect(res.status).toBe(200);
    expect(h.runArgs.dry).toBe(true);
    expect(await h.runArgs.send({})).toEqual({ skipped: true, reason: 'dry' });
    await cron.GET(new Request('https://example.test/api/cron/moat?key=cron-secret-test'));
    expect(h.runArgs.dry).toBe(false);
  });
});
