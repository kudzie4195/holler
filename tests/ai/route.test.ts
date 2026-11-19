import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiFakeDb, MONTH, sig } from './fake-db';

const h = vi.hoisted(() => ({
  db: null as unknown,
  adminThrows: false,
  send: vi.fn(async (m: { to: string; subject: string }) => ({ ok: true as const, id: m.to ? "e1" : "e0" })),
  rematch: vi.fn(async () => ({ created: 0 })),
  envObj: { CRON_SECRET: 'sekret', ADMIN_EMAIL: 'owner@holler.test' } as Record<string, string | undefined>,
  summary: null as unknown,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: h.envObj, siteUrl: 'https://x.test' }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    if (h.adminThrows) throw new Error('Supabase admin is not configured');
    return h.db;
  },
}));
vi.mock('@/lib/email', () => ({ sendEmail: h.send }));
vi.mock('@/lib/ai/rematch-link', () => ({ rematchSignals: h.rematch }));
vi.mock('@/lib/ai/classify', async (orig) => {
  const real = await orig<typeof import('@/lib/ai/classify')>();
  return { ...real, runClassify: vi.fn(async (o: Parameters<typeof real.runClassify>[0]) => (h.summary ? h.summary : real.runClassify(o))) };
});

import { GET } from '../../app/api/cron/ai/route';

const req = (q = '', headers: Record<string, string> = {}) => new Request('https://x.test/api/cron/ai' + q, { headers });
const auth = { authorization: 'Bearer sekret' };

beforeEach(() => {
  h.db = new AiFakeDb({ holler_signals: [sig(1), sig(2)] });
  h.adminThrows = false;
  h.summary = null;
  h.send.mockClear();
  h.rematch.mockClear();
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.VERCEL;
  delete process.env.AI_CLASSIFY_MODEL;
});

describe('GET /api/cron/ai', () => {
  it('401 without the secret (header or ?key=), and nothing runs', async () => {
    for (const r of [req(), req('', { authorization: 'Bearer nope' }), req('?key=nope'), req('?dry=1')]) expect((await GET(r)).status).toBe(401);
    expect((h.db as AiFakeDb).calls).toEqual([]);
  });

  it('accepts ?key= too', async () => {
    expect((await GET(req('?key=sekret&dry=1'))).status).toBe(200);
  });

  it('no gateway auth: 200 with the reason, nothing spent or written', async () => {
    const res = await GET(req('', auth));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const j = await res.json();
    expect(j.reason).toBe('no_gateway_auth');
    expect((h.db as AiFakeDb).tables.holler_ai_spend).toHaveLength(0);
  });

  it('?dry=1: plan only, no spend, no write, no email', async () => {
    const res = await GET(req('?dry=1', auth));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j).toMatchObject({ dry: true, candidates: 2, batchesPlanned: 1, reason: null, alertEmails: {}, skipped: 0, cacheHits: 0, cacheMisses: 2, sentToModel: 2 });
    expect(j.worstCaseUsd).toBeGreaterThan(0);
    // the read-only SQL month total is a read too
    expect((h.db as AiFakeDb).calls.filter((c) => !c.endsWith('.select') && c !== 'rpc.holler_ai_month_spend')).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('database not configured: 200 not_configured', async () => {
    h.adminThrows = true;
    const res = await GET(req('', auth));
    expect(res.status).toBe(200);
    expect((await res.json()).reason).toBe('not_configured');
  });

  it('a thrown error still answers 200 with a reason', async () => {
    h.summary = Promise.reject(new Error('boom'));
    (h.summary as Promise<unknown>).catch(() => {});
    const res = await GET(req('', auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'error' });
  });

  it('80% and cap alerts are emailed once per month per threshold', async () => {
    const base = { ok: true, dry: false, month: MONTH, capUsd: 10, monthSpentUsd: 8.2, alerts: ['alert_80'], reason: null };
    h.summary = base;
    await GET(req('', auth));
    await GET(req('', auth));
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toMatchObject({ to: 'owner@holler.test', subject: 'Holler AI spend is at 82% of the monthly cap' });
    h.summary = { ...base, monthSpentUsd: 10, alerts: ['alert_80', 'alert_100'], reason: 'cap_reached' };
    const j = await (await GET(req('', auth))).json();
    expect(j.alertEmails).toEqual({ alert_100: 'sent' });
    await GET(req('', auth));
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls[1][0].subject).toBe('Holler AI step paused: monthly cap reached');
  });

  it('cap hit first: the cap alert is sent and the 80% alert is not sent afterwards', async () => {
    h.summary = { ok: true, dry: false, month: MONTH, capUsd: 10, monthSpentUsd: 10, alerts: ['alert_80', 'alert_100'], reason: 'cap_reached' };
    await GET(req('', auth));
    h.summary = { ok: true, dry: false, month: MONTH, capUsd: 10, monthSpentUsd: 10, alerts: ['alert_80'], reason: null };
    await GET(req('', auth));
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('a failed send gives the claim back, so the next run retries', async () => {
    h.summary = { ok: true, dry: false, month: MONTH, capUsd: 10, monthSpentUsd: 8.5, alerts: ['alert_80'], reason: null };
    h.send.mockResolvedValueOnce({ ok: false, error: 'resend down' } as never);
    const j = await (await GET(req('', auth))).json();
    expect(j.alertEmails).toEqual({ alert_80: 'failed' });
    const j2 = await (await GET(req('', auth))).json();
    expect(j2.alertEmails).toEqual({ alert_80: 'sent' });
  });

  it('no recipient: nothing claimed, nothing sent', async () => {
    const saved = h.envObj.ADMIN_EMAIL;
    delete h.envObj.ADMIN_EMAIL;
    h.summary = { ok: true, dry: false, month: MONTH, capUsd: 10, monthSpentUsd: 8.5, alerts: ['alert_80'], reason: null };
    const j = await (await GET(req('', auth))).json();
    h.envObj.ADMIN_EMAIL = saved;
    expect(j.alertEmails).toEqual({ alert_80: 'no_recipient' });
    expect((h.db as AiFakeDb).tables.holler_ai_spend).toHaveLength(0);
  });

  it('a dry run never emails, even with alert flags', async () => {
    h.summary = { ok: true, dry: true, month: MONTH, capUsd: 10, monthSpentUsd: 9, alerts: ['alert_80'], reason: null };
    await GET(req('?dry=1', auth));
    expect(h.send).not.toHaveBeenCalled();
  });

  // Review r3 P1 (model price): a model id with no price never runs, and the operator hears about it once a day.
  it('a model with no price: 200 unknown_model_price, no call, one operator email a day', async () => {
    process.env.AI_CLASSIFY_MODEL = 'openai/gpt-5';
    process.env.AI_GATEWAY_API_KEY = 'k';
    const j = await (await GET(req('', auth))).json();
    expect(j).toMatchObject({ reason: 'unknown_model_price', ok: false, alertEmails: { alert_price: 'sent' } });
    const j2 = await (await GET(req('', auth))).json();
    expect(j2.alertEmails).toEqual({ alert_price: 'already_sent' });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0].subject).toBe('Holler AI step is off: the model has no price');
    const db = h.db as AiFakeDb;
    expect(db.tables.holler_ai_spend.map((r) => r.kind)).toEqual(['alert_price']);
    expect(db.tables.holler_signal_ai).toHaveLength(0);
    // the next day it is sent again
    db.tables.holler_ai_spend[0].day = '2000-01-01';
    expect((await (await GET(req('', auth))).json()).alertEmails).toEqual({ alert_price: 'sent' });
  });
});
