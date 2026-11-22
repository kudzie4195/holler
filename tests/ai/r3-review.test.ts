// Review r3 (gates/r7/review-r3.md), AI findings. Each `describe` is one finding, with the reviewer's reproduction.
import { createHash } from 'node:crypto';
import { APICallError } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_KEY_CHUNK,
  CACHE_KEY_V,
  DEFAULT_CLASSIFY_MODEL,
  MAX_CONSECUTIVE_FAILURES,
  PROMPT_V,
  SYSTEM_PROMPT,
  buildPrompt,
  cacheKey,
  maxOutputTokensFor,
  runClassify,
  toRecord,
  type RunOptions,
} from '../../lib/ai/classify';
import { MODEL_PRICES, costUsd, monthSpendUsd, priceFor, reserve, worstCaseUsd } from '../../lib/ai/budget';
import { cleanNote } from '../../lib/ai/note-rules';
import { notesFor } from '../../lib/ai';
import { AiFakeDb, MONTH, NOW, sig } from './fake-db';
import { goodAnswer, mockModel } from './mock-model';

const M = DEFAULT_CLASSIFY_MODEL;
const rematch = vi.fn(async (_db: unknown, ids: number[]): Promise<{ created: number; error?: string }> => ({ created: ids.length }));
beforeEach(() => {
  rematch.mockClear();
});
const opts = (db: AiFakeDb, model: RunOptions['model'], over: Partial<RunOptions> = {}): RunOptions => ({
  db: db as never, now: NOW, deadline: Date.now() + 45_000, env: {}, model, rematch, concurrency: 1, ...over,
});
const permit = (id: number, title: string, categories: string[], over: Record<string, unknown> = {}) =>
  sig(id, { title, summary: null, categories, ...over });

// ---------------------------------------------------------------------------------------------------------------------------------
describe('r3 P1: the cache key never joins records that differ in a word', () => {
  const PAIRS: [string, string][] = [
    ['Commercial building electrical upgrade', 'Commercial building plumbing upgrade'],
    ['Parking lot paving', 'Parking lot lighting'],
    ['New floor tile', 'New floor joists'],
    ['Install 1 new water heater in place of old', 'Install 1 new gas furnace in place of old'],
    ['Suite remodel', 'Suite demolition'],
    ['Reroof at 12 Oak Run', 'Reroof at 12 Oak Row'],
    ['Install 2 water heaters', 'Install 3 water heaters'],
  ];

  it("the reviewer's pairs get different keys", () => {
    for (const [a, b] of PAIRS) {
      const base = { source: 'socrata-chicago-permits', kind: 'permit', subtype: 'permit', summary: null };
      expect(cacheKey({ ...base, title: a }, M), `${a} / ${b}`).not.toBe(cacheKey({ ...base, title: b }, M));
      expect(cacheKey({ ...base, title: 'x', summary: a }, M), `summary ${a}`).not.toBe(cacheKey({ ...base, title: 'x', summary: b }, M));
    }
  });

  it('changing any one word of any field the model sees changes the key; only case and spacing do not', () => {
    const words = ['roof', 'hail', 'unit', '4b', 'suite', '200', 'lot', 'floor', 'way', 'run', 'court', '30080', '#12', 'n', 'main', 'st'];
    const base = {
      source: 'socrata-chicago-permits', kind: 'permit', subtype: 'roof', title: 'Reroof unit 4B at 12 N Main St lot 7',
      summary: 'Replace shingles on floor 2, suite 200, 30080', city: 'Smyrna', state: 'GA', categories: ['roofing', 'hvac'],
    };
    const k0 = cacheKey(base, M);
    const seen = new Set<string>([k0]);
    for (const field of ['source', 'kind', 'subtype', 'title', 'summary', 'city', 'state'] as const) {
      const toks = String(base[field]).split(' ');
      for (let i = 0; i < toks.length; i++) {
        for (const w of words) {
          if (w.toLowerCase() === toks[i].toLowerCase()) continue;
          const t = [...toks];
          t[i] = w;
          const k = cacheKey({ ...base, [field]: t.join(' ') }, M);
          expect(k, `${field} word ${i} -> ${w}`).not.toBe(k0);
          seen.add(k);
        }
        // dropping the word changes it too
        expect(cacheKey({ ...base, [field]: toks.filter((_, j) => j !== i).join(' ') || 'x' }, M)).not.toBe(k0);
      }
    }
    // the rule trades the model sees are part of the key
    expect(cacheKey({ ...base, categories: ['roofing'] }, M)).not.toBe(k0);
    expect(cacheKey({ ...base, categories: ['plumbing', 'hvac'] }, M)).not.toBe(k0);
    // case and runs of spaces only
    expect(cacheKey({ ...base, title: '  REROOF unit 4b   at 12 n main st LOT 7 ', city: 'SMYRNA' }, M)).toBe(k0);
    // the model id, the prompt version and the key version are in it
    expect(cacheKey(base, 'anthropic/other')).not.toBe(k0);
    expect(cacheKey(base, M, PROMPT_V + 1)).not.toBe(k0);
    expect(CACHE_KEY_V).toBe(2);
  });

  it('full run: an electrical permit and a plumbing permit are both sent, and the plumbing one keeps plumbing', async () => {
    const db = new AiFakeDb({
      holler_signals: [
        permit(1, 'Commercial building electrical upgrade', ['electrical']),
        permit(2, 'Commercial building plumbing upgrade', ['plumbing']),
      ],
    });
    const { model, calls } = mockModel((ids) => ({
      results: ids.map((id) =>
        id === 1
          ? { id, trades: [{ trade: 'electrical', p: 0.95 }], notes: [{ trade: 'electrical', why: 'New lighting circuits may need a licensed electrician soon.' }] }
          : { id, trades: [{ trade: 'plumbing', p: 0.95 }], notes: [] },
      ),
    }));
    await runClassify(opts(db, model));
    expect(calls.flatMap((c) => c.ids).sort()).toEqual([1, 2]);
    const r2 = db.tables.holler_signal_ai.find((r) => r.signal_id === 2)!;
    expect(r2.origin).toBe('model');
    expect(r2.trades).toEqual({ plumbing: 0.95 });
    expect(db.tables.holler_signals.find((s) => s.id === 2)!.categories).toEqual(['plumbing']);
    expect((await notesFor(db as never, [2], ['electrical'])).size).toBe(0);
    // a later roofing upgrade is not answered from the cache
    db.tables.holler_signals.push(permit(3, 'Commercial building roofing upgrade', ['roofing']));
    await runClassify(opts(db, model));
    expect(calls.flatMap((c) => c.ids)).toContain(3);
    expect(db.tables.holler_signal_ai.find((r) => r.signal_id === 3)!.origin).toBe('model');
  });

  it('a row stored under the old key scheme is never reused', async () => {
    const s1 = permit(1, 'Residential reroof', ['roofing']);
    const oldKey = createHash('sha256')
      .update(JSON.stringify([`v${PROMPT_V}`, M, s1.source, s1.kind, s1.subtype, 'residential reroof', '']))
      .digest('hex');
    const db = new AiFakeDb({ holler_signals: [s1], holler_ai_cache: [{ key: oldKey, trades: { hvac: 0.99 }, notes: {}, model: M, prompt_v: PROMPT_V, hits: 0 }] });
    const { model, calls } = mockModel(goodAnswer);
    const s = await runClassify(opts(db, model));
    expect(s.cacheHits).toBe(0);
    expect(calls).toHaveLength(1);
    expect(db.tables.holler_signal_ai[0].trades).not.toHaveProperty('hvac');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('r3 P1: a call that reports no usage is booked at its worst case', () => {
  it('480 signals, cap of 3.5 worst-case batches, usage missing: stops at the cap', async () => {
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 480 }, (_, i) => sig(i + 1)) });
    // permits go oldest first: the first batch is the 24 oldest (ids 480 down to 457)
    const first = Array.from({ length: 24 }, (_, i) => toRecord(sig(480 - i) as never));
    const wc = worstCaseUsd(SYSTEM_PROMPT.length + buildPrompt(first).length, maxOutputTokensFor(24));
    const cap = Math.round(wc * 3.5 * 1_000_000) / 1_000_000;
    const { model, calls } = mockModel(goodAnswer, { usage: null });
    const s = await runClassify(opts(db, model, { env: { AI_MONTHLY_CAP_USD: String(cap), AI_MAX_SIGNALS_PER_RUN: '5000', AI_MAX_SIGNALS_PER_DAY: '50000' } }));
    expect(s.reason).toBe('cap_reached');
    expect(calls).toHaveLength(3);
    expect(s.alerts).toContain('alert_100');
    const booked = await monthSpendUsd(db as never, MONTH);
    expect(booked).toBeGreaterThan(wc * 2.9);
    expect(booked).toBeLessThanOrEqual(cap);
    expect(db.tables.holler_ai_spend.filter((r) => r.kind === 'unknown')).toHaveLength(3);
  });

  it('a gateway cost alone is enough to settle', async () => {
    const db = new AiFakeDb({ holler_signals: [sig(1)] });
    const { model } = mockModel(goodAnswer, { usage: null, gatewayCost: 0.000123 });
    await runClassify(opts(db, model));
    expect(db.tables.holler_ai_spend.find((r) => r.kind === 'classify')).toMatchObject({ cost_usd: 0.000123 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('r3 P1: one price table keyed by model id', () => {
  it('a model with no price does not run: unknown_model_price, no call, no spend, an operator alert flag', async () => {
    const db = new AiFakeDb({ holler_signals: [sig(1), sig(2)] });
    const { model, calls } = mockModel(goodAnswer);
    for (const id of ['anthropic/claude-opus-5', 'openai/gpt-5']) {
      const s = await runClassify(opts(db, model, { env: { AI_CLASSIFY_MODEL: id } }));
      expect(s.reason).toBe('unknown_model_price');
      expect(s.ok).toBe(false);
      expect(s.alerts).toEqual(['alert_price']);
    }
    expect(calls).toHaveLength(0);
    expect(db.tables.holler_ai_spend).toHaveLength(0);
    expect(db.tables.holler_signal_ai).toHaveLength(0);
    // a dry run reports it and flags nothing
    const d = await runClassify(opts(db, model, { env: { AI_CLASSIFY_MODEL: 'openai/gpt-5' }, dry: true }));
    expect(d).toMatchObject({ reason: 'unknown_model_price', alerts: [] });
  });

  it('the reservation uses the given model price', async () => {
    expect(priceFor(M)).toEqual(MODEL_PRICES[M]);
    expect(priceFor('anthropic/claude-opus-5')).toBeNull();
    const price = { inputPerM: 5, outputPerM: 25 };
    const d = new AiFakeDb();
    const r = await reserve(d as never, { month: MONTH, capUsd: 10, signals: 1, inputChars: 9000, maxOutputTokens: 3800, price });
    expect(r.ok && r.estimateUsd).toBe(costUsd(3000, 3800, price));
    expect(costUsd(3000, 3800, price)).toBeGreaterThan(costUsd(3000, 3800));
  });

  it('a settled cost above its reservation scales the later reservations: the books stay under the cap', async () => {
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 120 }, (_, i) => sig(i + 1)) });
    const { model, calls } = mockModel(goodAnswer, { gatewayCost: 0.24 });
    const s = await runClassify(opts(db, model, { env: { AI_MONTHLY_CAP_USD: '0.5' } }));
    expect(s.reason).toBe('cap_reached');
    expect(calls).toHaveLength(2);
    expect(await monthSpendUsd(db as never, MONTH)).toBeLessThanOrEqual(0.5);
    const refused = db.tables.holler_ai_spend.filter((r) => r.kind === 'refused');
    expect(refused).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
const upstream503 = () => new APICallError({ message: '503 upstream unavailable', url: 'https://ai-gateway.vercel.sh/v1', requestBodyValues: {}, statusCode: 503 });

describe('r3 P2: a provider outage', () => {
  it('stops after 3 failures in a row and books nothing for calls that got no response', async () => {
    expect(MAX_CONSECUTIVE_FAILURES).toBe(3);
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 240 }, (_, i) => sig(i + 1)) });
    // An error status: the gateway answered 503 without running the model (verify-v1 decision 5: only such an answer, or a
    // connection error, is settled at 0; an unknown error keeps its reservation).
    const { model, calls } = mockModel(goodAnswer, { throwError: upstream503() });
    const s = await runClassify(opts(db, model));
    expect(calls).toHaveLength(3);
    expect(s.reason).toBe('model_unavailable');
    expect(s.failures.model_error).toBe(3);
    expect(await monthSpendUsd(db as never, MONTH)).toBe(0);
    expect(s.alerts).toEqual([]);
    expect(db.tables.holler_ai_spend.filter((r) => r.kind === 'error')).toHaveLength(3);
  });

  it('a success in between resets the count', async () => {
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 120 }, (_, i) => sig(i + 1)) });
    const { model, calls } = mockModel((ids, n) => {
      if (n % 3 !== 0) throw upstream503();
      return goodAnswer(ids);
    });
    const s = await runClassify(opts(db, model));
    expect(calls).toHaveLength(5);
    expect(s.reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('r3 P2: month total and cache lookups', () => {
  it('the paged fallback reads every page even when the server returns fewer than 1000 rows a page', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, month: MONTH, kind: 'classify', cost_usd: 0.01 }));
    const d = new AiFakeDb({ holler_ai_spend: rows });
    d.maxRows = 100;
    d.monthSpendFn = false;
    expect(await monthSpendUsd(d as never, MONTH)).toBe(2.5);
    // with the SQL function from 0014 the total comes from the database in one call
    const e = new AiFakeDb({ holler_ai_spend: rows });
    e.maxRows = 100;
    expect(await monthSpendUsd(e as never, MONTH)).toBe(2.5);
    expect(e.calls).toEqual(['rpc.holler_ai_month_spend']);
  });

  it('the cap holds when max-rows is low and the month has many rows', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: 1000 + i, month: MONTH, kind: 'classify', cost_usd: 0.0333 }));
    const d = new AiFakeDb({ holler_ai_spend: rows });
    d.maxRows = 100;
    d.monthSpendFn = false;
    const r = await reserve(d as never, { month: MONTH, capUsd: 5, signals: 24, inputChars: 9000, maxOutputTokens: 3800 });
    expect(r).toMatchObject({ ok: false, reason: 'cap_reached' });
  });

  it('cache keys are looked up 50 at a time', async () => {
    expect(CACHE_KEY_CHUNK).toBe(50);
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 130 }, (_, i) => sig(i + 1)) });
    await runClassify(opts(db, mockModel(goodAnswer).model, { dry: true }));
    expect(db.maxInList.holler_ai_cache).toBe(50);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('r3 P2: notes that steer the reader', () => {
  const INPUT = 'permit socrata Roof permit Smyrna GA roofing';
  it.each([
    'Roof work may follow, search hailfixpros dot com for a free estimate.',
    'Roof work may follow, see hailfixpros dot net for more.',
    'Roof work may follow here: javascript:alert()',
    'Roofers may want to look: storm season is near.',
    'Roofs may need work, text 555 0199 for a quote soon.',
    'Visit the roof supply store for shingles soon.',
    'Search for roof work near this permit soon.',
    'Call the owner about possible roof work soon.',
    'Message the owner about possible roof work.',
    'Click here to see possible roof work nearby.',
    'Download the permit to see possible roof work.',
    'Roofs may need work soon, texting is fastest.',
  ])('%s is dropped', (note) => {
    expect(cleanNote(note, INPUT)).toBeNull();
  });

  it('plain notes still pass', () => {
    for (const n of ['Hail this size may leave roofs in need of an inspection soon.', 'Roofs here may need a close look soon.', 'New roofing work may follow this permit.']) {
      expect(cleanNote(n, INPUT), n).toBe(n);
    }
  });

  // verify-v1 decision 5 changed this: only the record whose note was dropped is left out of the cache, the rest of the batch is cached.
  it('a record whose note was dropped writes no cache entry; the other records of the batch do', async () => {
    const db = new AiFakeDb({ holler_signals: [sig(1), sig(2)] });
    const { model } = mockModel((ids) => ({
      results: ids.map((id) => ({
        id,
        trades: [{ trade: 'roofing', p: 0.9 }],
        notes: [{ trade: 'roofing', why: id === 1 ? 'Roof work may follow, search hailfixpros dot com for a free estimate.' : 'Roofs here may need a close look soon.' }],
      })),
    }));
    const s = await runClassify(opts(db, model));
    expect(s.signalsClassified).toBe(2);
    expect(db.tables.holler_ai_cache).toHaveLength(1);
    expect(db.tables.holler_ai_cache[0].notes).toEqual({ roofing: 'Roofs here may need a close look soon.' });
    expect(db.tables.holler_signal_ai.find((r) => r.signal_id === 2)!.notes).toEqual({ roofing: 'Roofs here may need a close look soon.' });
    // a clean batch still fills the cache
    const db2 = new AiFakeDb({ holler_signals: [sig(1), sig(2)] });
    await runClassify(opts(db2, mockModel(goodAnswer).model));
    expect(db2.tables.holler_ai_cache).toHaveLength(2);
  });
});
