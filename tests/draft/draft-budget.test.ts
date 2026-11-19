// Review r3 P1 (reply drafts outside the cap): lib/ai/draft.ts books every draft against the same monthly holler_ai_spend total as the
// cron step (reserve, call, settle, kind 'draft'), refuses at the cap, and runs on the hourly limit alone only while 0014 is missing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_MAX_OUTPUT_TOKENS, DRAFT_MODEL, generateDraft } from '../../lib/ai/draft';
import { monthSpendUsd, priceFor } from '../../lib/ai/budget';
import { AiFakeDb, MONTH, NOW } from '../ai/fake-db';
import { MockLanguageModelV4 } from 'ai/test';
import { APICallError } from 'ai';

const INPUT = { businessName: 'Acme Roofing', categories: ['roofing'], title: 'Anyone know a roofer?', summary: 'Leak after the storm', city: 'Atlanta' };
const TEXT = 'Hi, sorry to hear about the leak. Acme Roofing can take a look this week if you still need a hand.';

function model(o: { usage?: { input: number; output: number } | null; throwError?: Error; text?: string } = {}) {
  const calls: unknown[] = [];
  const m = new MockLanguageModelV4({
    doGenerate: async (opts) => {
      calls.push(opts);
      if (o.throwError) throw o.throwError;
      const u = o.usage === null ? null : (o.usage ?? { input: 400, output: 60 });
      return {
        content: [{ type: 'text', text: o.text ?? TEXT }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: u?.input, noCache: u?.input, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: u?.output, text: u?.output, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { m, calls };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('reply drafts share the monthly AI cap', () => {
  it('the draft model has a price, and a draft is reserved, called and settled as kind draft', async () => {
    expect(priceFor(DRAFT_MODEL)).not.toBeNull();
    const db = new AiFakeDb();
    const { m, calls } = model();
    const r = await generateDraft(INPUT, { db: db as never, model: m, now: NOW, env: {} });
    expect(r).toEqual({ ok: true, draft: TEXT, source: 'ai' });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { maxOutputTokens?: number }).maxOutputTokens).toBe(DRAFT_MAX_OUTPUT_TOKENS);
    expect(db.tables.holler_ai_spend).toEqual([expect.objectContaining({ month: MONTH, kind: 'draft', input_tokens: 400, output_tokens: 60 })]);
    expect(await monthSpendUsd(db as never, MONTH)).toBeGreaterThan(0);
  });

  it('at the cap: refused, no model call, the refused row costs 0', async () => {
    const db = new AiFakeDb({ holler_ai_spend: [{ id: 900, month: MONTH, kind: 'classify', cost_usd: 10 }] });
    const { m, calls } = model();
    const r = await generateDraft(INPUT, { db: db as never, model: m, now: NOW, env: {} });
    expect(r).toEqual({ ok: false, reason: 'cap_reached' });
    expect(calls).toHaveLength(0);
    expect(await monthSpendUsd(db as never, MONTH)).toBe(10);
  });

  it('spend that cannot be read: refused (fails closed), no model call', async () => {
    const db = new AiFakeDb();
    db.failOn['holler_ai_spend.select'] = 'boom';
    db.failOn['rpc.holler_ai_month_spend'] = 'boom';
    const { m, calls } = model();
    expect(await generateDraft(INPUT, { db: db as never, model: m, now: NOW, env: {} })).toEqual({ ok: false, reason: 'spend_unavailable' });
    expect(calls).toHaveLength(0);
  });

  it('migration 0014 missing: the draft still runs (the hourly per-user limit is the only bound)', async () => {
    const db = new AiFakeDb();
    db.failOn['holler_ai_spend.insert'] = 'relation "public.holler_ai_spend" does not exist';
    const { m, calls } = model();
    expect(await generateDraft(INPUT, { db: db as never, model: m, now: NOW, env: {} })).toEqual({ ok: true, draft: TEXT, source: 'ai' });
    expect(calls).toHaveLength(1);
  });

  it('a response with no usage numbers keeps the worst case in the books', async () => {
    const db = new AiFakeDb();
    const { m } = model({ usage: null });
    await generateDraft(INPUT, { db: db as never, model: m, now: NOW, env: {} });
    const row = db.tables.holler_ai_spend[0];
    expect(row.kind).toBe('unknown');
    expect(row.cost_usd).toBeGreaterThan(0);
  });

  it('a call that fails before any response gives the template and books 0', async () => {
    const db = new AiFakeDb();
    // An error status (the gateway answered 503): nothing billed. An unknown error keeps its reservation (verify-v1 decision 5).
    const { m } = model({ throwError: new APICallError({ message: '503 upstream unavailable', url: 'https://ai-gateway.vercel.sh/v1', requestBodyValues: {}, statusCode: 503 }) });
    const r = await generateDraft(INPUT, { db: db as never, model: m, now: NOW, env: {} });
    expect(r).toMatchObject({ ok: true, source: 'fallback' });
    expect(db.tables.holler_ai_spend[0]).toMatchObject({ kind: 'error', cost_usd: 0 });
  });

  it('no gateway auth: the template, no spend row, no call', async () => {
    const db = new AiFakeDb();
    const r = await generateDraft(INPUT, { db: db as never, now: NOW, env: {} });
    expect(r).toMatchObject({ ok: true, source: 'fallback' });
    expect(db.tables.holler_ai_spend).toHaveLength(0);
  });
});
