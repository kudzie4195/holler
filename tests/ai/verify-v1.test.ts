// verify-v1 (gates/r7/verify-v1.md) AI findings 5, 6, 11 and r3-11, commander decision 5. Each describe has the verifier's repro.
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callModel, runClassify, toRecord, type RunOptions } from '../../lib/ai/classify';
import { monthSpendUsd } from '../../lib/ai/budget';
import { cleanNote, noteViolations } from '../../lib/ai/note-rules';
import { generateDraft } from '../../lib/ai/draft';
import { failedBeforeResponse } from '../../lib/ai/errors';
import { AiFakeDb, MONTH, NOW, sig } from './fake-db';
import { goodAnswer, mockModel } from './mock-model';

const rematch = vi.fn(async (_db: unknown, ids: number[]): Promise<{ created: number; error?: string }> => ({ created: ids.length }));
beforeEach(() => {
  rematch.mockClear();
});
const opts = (db: AiFakeDb, model: RunOptions['model'], over: Partial<RunOptions> = {}): RunOptions => ({
  db: db as never, now: NOW, deadline: Date.now() + 45_000, env: {}, model, rematch, concurrency: 1, ...over,
});
const INPUT = 'permit permit socrata-chicago-permits Roof permit in Smyrna Permit issued to replace roof shingles Smyrna GA roofing';

describe('verify-v1 P2 #5: the reservation scale is the largest settled ratio, not a product over in-flight calls', () => {
  it('real cost 2x the reservation, concurrency 10, cap $10: all 40 batches run, no false "cap reached", no alert', async () => {
    // The reservation for one batch, read from a run where nothing reports usage (the estimate stays booked).
    const probe = new AiFakeDb({ holler_signals: Array.from({ length: 24 }, (_, i) => sig(i + 1)) });
    await runClassify(opts(probe, mockModel(goodAnswer, { usage: null }).model));
    const estimate = Number(probe.tables.holler_ai_spend.find((r) => r.kind === 'unknown')!.cost_usd);
    expect(estimate).toBeGreaterThan(0);

    const db = new AiFakeDb({ holler_signals: Array.from({ length: 960 }, (_, i) => sig(i + 1)) });
    const { model, calls } = mockModel(goodAnswer, { gatewayCost: 2 * estimate });
    const s = await runClassify(opts(db, model, { concurrency: 10, env: { AI_MONTHLY_CAP_USD: '10', AI_MAX_SIGNALS_PER_RUN: '5000', AI_MAX_SIGNALS_PER_DAY: '50000' } }));
    expect(s.batchesPlanned).toBe(40);
    expect(calls).toHaveLength(40);
    expect(s.reason).toBeNull();
    expect(s.alerts).toEqual([]);
    expect(await monthSpendUsd(db as never, MONTH)).toBeLessThan(10);
  });
  it('a cost far above the table price still stops under the cap', async () => {
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 120 }, (_, i) => sig(i + 1)) });
    const { model } = mockModel(goodAnswer, { gatewayCost: 0.24 });
    const s = await runClassify(opts(db, model, { env: { AI_MONTHLY_CAP_USD: '0.5' } }));
    expect(s.reason).toBe('cap_reached');
    expect(await monthSpendUsd(db as never, MONTH)).toBeLessThanOrEqual(0.5);
  });
});

describe('verify-v1 P2 #11: a call that fails after a response arrived keeps its reserved amount', () => {
  const thrower = (err: Error) => new MockLanguageModelV4({ doGenerate: async () => { throw err; } });
  const status503 = () => new APICallError({ message: 'Service Unavailable', url: 'https://ai-gateway.vercel.sh/v1', requestBodyValues: {}, statusCode: 503 });

  it('failedBeforeResponse: error status and connection errors only', () => {
    expect(failedBeforeResponse(status503())).toBe(true);
    expect(failedBeforeResponse(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toBe(true);
    expect(failedBeforeResponse(new Error('socket hang up'))).toBe(true);
    // a gateway error whose cause is the provider's error status
    expect(failedBeforeResponse(Object.assign(new Error('Gateway request failed'), { name: 'GatewayInternalServerError', statusCode: 500, cause: status503() }))).toBe(true);
    // an answer that arrived but could not be read
    expect(failedBeforeResponse(Object.assign(new Error('Invalid JSON response'), { name: 'AI_InvalidResponseDataError' }))).toBe(false);
    expect(failedBeforeResponse(Object.assign(new Error('Empty response body'), { name: 'AI_EmptyResponseBodyError' }))).toBe(false);
    // a gateway parse error (statusCode 500 by default, no API call error with a status underneath)
    expect(failedBeforeResponse(Object.assign(new Error('Invalid error response format'), { name: 'GatewayResponseError', statusCode: 500, cause: new SyntaxError('Unexpected token') }))).toBe(false);
    expect(failedBeforeResponse(new Error('something odd'))).toBe(false);
  });
  it('callModel reports which one it was', async () => {
    const rec = toRecord({ id: 1, source: 's', kind: 'permit', title: 'Roof permit', summary: null, city: 'Smyrna', state: 'GA', categories: ['roofing'] });
    expect(await callModel([rec], { model: thrower(status503()) })).toEqual({ ok: false, reason: 'model_error', noResponse: true });
    expect(await callModel([rec], { model: thrower(Object.assign(new Error('bad body'), { name: 'AI_InvalidResponseDataError' })) })).toEqual({ ok: false, reason: 'model_error', noResponse: false });
  });
  it('classify run: an invalid response body is booked at the reservation, an error status at 0', async () => {
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 24 }, (_, i) => sig(i + 1)) });
    await runClassify(opts(db, thrower(Object.assign(new Error('bad body'), { name: 'AI_InvalidResponseDataError' }))));
    const row = db.tables.holler_ai_spend.find((r) => r.kind === 'unknown');
    expect(row && Number(row.cost_usd)).toBeGreaterThan(0);
    expect(await monthSpendUsd(db as never, MONTH)).toBeGreaterThan(0);

    const db2 = new AiFakeDb({ holler_signals: Array.from({ length: 24 }, (_, i) => sig(i + 1)) });
    await runClassify(opts(db2, thrower(status503())));
    expect(await monthSpendUsd(db2 as never, MONTH)).toBe(0);
  });
  it('draft: same rule', async () => {
    const IN = { businessName: 'Acme Roofing', categories: ['roofing'], title: 'Roof permit in Smyrna', city: 'Smyrna' };
    const db = new AiFakeDb();
    const r = await generateDraft(IN, { db: db as never, model: thrower(Object.assign(new Error('bad body'), { name: 'AI_InvalidResponseDataError' })), now: NOW, env: {} });
    expect(r).toMatchObject({ ok: true, source: 'fallback' });
    expect(db.tables.holler_ai_spend[0].kind).toBe('unknown');
    expect(Number(db.tables.holler_ai_spend[0].cost_usd)).toBeGreaterThan(0);
    const db2 = new AiFakeDb();
    await generateDraft(IN, { db: db2 as never, model: thrower(status503()), now: NOW, env: {} });
    expect(db2.tables.holler_ai_spend[0]).toMatchObject({ kind: 'error', cost_usd: 0 });
  });
});

describe('verify-v1 P2 #6: honest hedges are kept; claims and steering are dropped', () => {
  it('"could lead to", "may lead to", "may mean", "often means" are honest hedges', () => {
    for (const n of [
      'New roof work could lead to gutter and siding jobs on the same house.',
      'A permit like this may lead to drywall and paint work inside.',
      'A tear off this size may mean dumpster and debris hauling.',
      'A new pool often means fencing work around it.',
      'An old water line often leads to sewer line repairs too.',
      'A tear off this size may call for dumpster and debris hauling.',
      'Lead paint testing may follow on a house this old.',
    ]) expect(noteViolations(n, INPUT), n).toEqual([]);
  });
  it('certainty and customer claims are still dropped', () => {
    expect(noteViolations('Roof work will follow in this area soon.', INPUT)).toContain('claims_certain');
    expect(noteViolations('Roof jobs are guaranteed after a storm like this.', INPUT)).toContain('claims_certain');
    expect(noteViolations('Customers are waiting for a roofer nearby.', INPUT)).toContain('claims_customer');
    expect(noteViolations('This record is a hot lead for a roofer.', INPUT)).toContain('claims_customer');
    expect(noteViolations('New leads like this may come from the storm.', INPUT)).toContain('claims_customer');
  });
  it("the verifier's lower-case brand names with an instruction are dropped", () => {
    for (const n of [
      'Roof work may follow, go to hailfixpros com today',
      'Roof work may follow, look up hailfixpros on google',
      'Roof work may follow and hailfixpros gives free estimates',
      'Roof work may follow, dm hailfixpros on instagram',
      'Roof work may follow, contact hailfixpros soon',
    ]) expect(cleanNote(n, INPUT), n).toBeNull();
  });
});

describe('verify-v1 P2 #6: one dropped note no longer stops the rest of the batch from being cached', () => {
  it('24 signals, one note steered: 23 cache rows written, the steered record not cached', async () => {
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 24 }, (_, i) => sig(i + 1)) });
    const { model } = mockModel((ids) => {
      const a = goodAnswer(ids);
      a.results[0].notes = [{ trade: 'roofing', why: 'Roof work may follow, look up hailfixpros on google' }];
      return a;
    });
    const s = await runClassify(opts(db, model));
    expect(s.notesDropped).toBe(1);
    expect(db.tables.holler_ai_cache).toHaveLength(23);
  });
});
