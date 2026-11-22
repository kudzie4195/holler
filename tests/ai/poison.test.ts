import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runClassify, type RunOptions } from '../../lib/ai/classify';
import { attemptKey, MAX_ATTEMPTS, readAttempts } from '../../lib/ai/poison';
import { aiCoverageLine, loadAiCoverage } from '../../lib/admin/ai-coverage';
import { notesFor } from '../../lib/ai/rank';
import { AiFakeDb, NOW, sig } from './fake-db';
import { mockModel } from './mock-model';

// Bounded retries for a record the model cannot answer (lib/ai/poison.ts). Fake model, fake database.

const rematch = vi.fn(async (_db: unknown, ids: number[]): Promise<{ created: number; error?: string }> => ({ created: ids.length }));
beforeEach(() => {
  rematch.mockClear();
});

const permit = (id: number, over: Record<string, unknown> = {}) =>
  sig(id, { title: `Re-roof permit ${id}`, summary: 'Permit issued to replace roof shingles.', categories: ['roofing'], ...over });

/** The model's answer. A batch with the poison record in it comes back with an unknown trade (the structured output is refused). */
const answerWith = (poison: Set<number>) => (ids: number[]) =>
  ids.some((id) => poison.has(id))
    ? { results: ids.map((id) => ({ id, trades: [{ trade: 'admin', p: 1 }], notes: [] })) }
    : { results: ids.map((id) => ({ id, trades: [{ trade: 'roofing', p: 0.9 }], notes: [{ trade: 'roofing', why: 'A re-roof permit may mean gutter work could follow.' }] })) };

const opts = (db: AiFakeDb, model: RunOptions['model'], over: Partial<RunOptions> = {}): RunOptions => ({
  db: db as never,
  now: NOW,
  deadline: Date.now() + 45_000,
  env: { AI_MAX_SIGNALS_PER_RUN: '200', AI_MAX_SIGNALS_PER_DAY: '5000' },
  model,
  rematch,
  concurrency: 2,
  ...over,
});
/** The real table fills created_at itself; the fake does not. */
const stamp = (db: AiFakeDb) => {
  for (const r of db.tables.holler_ai_spend) r.created_at ??= NOW.toISOString();
};

describe('one bad record among good ones', () => {
  it('good records are classified, the bad one is sent at most twice across runs and then skipped, the queue moves on', async () => {
    // id 10 is the oldest (permits go oldest first): the poison record is at the head of the queue.
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 10 }, (_, i) => permit(i + 1)) });
    const POISON = new Set([10]);
    const sentWithPoison: number[] = [];
    const seen: number[][] = [];
    const total = (calls: { ids: number[] }[]) => calls.filter((c) => c.ids.includes(10)).length;

    // run 1: one batch of 10, refused. Every record in it has one attempt. Nothing written to holler_signal_ai.
    const m1 = mockModel(answerWith(POISON));
    const s1 = await runClassify(opts(db, m1.model));
    stamp(db);
    expect(s1.failures.bad_output).toBe(1);
    expect(db.tables.holler_signal_ai).toHaveLength(0);
    expect((await readAttempts(db as never, [1, 10])).get(10)).toBe(1);
    sentWithPoison.push(total(m1.calls));
    seen.push(...m1.calls.map((c) => c.ids));

    // run 2: records with an attempt go alone. The nine good ones succeed, the poison one fails alone: second attempt, skipped.
    const m2 = mockModel(answerWith(POISON));
    const s2 = await runClassify(opts(db, m2.model));
    stamp(db);
    sentWithPoison.push(total(m2.calls));
    seen.push(...m2.calls.map((c) => c.ids));
    expect(m2.calls.every((c) => c.ids.length === 1)).toBe(true);
    expect(s2.poisonSkipped).toBe(1);
    const rows = db.tables.holler_signal_ai;
    expect(rows.filter((r) => r.origin === 'model')).toHaveLength(9);
    expect(rows.find((r) => r.signal_id === 10)).toMatchObject({ origin: 'skip', model: 'poison', trades: {}, notes: {} });
    // the rule-based categories of the skipped record are untouched, and the app reads "no note" for it
    expect(db.tables.holler_signals.find((x) => x.id === 10)!.categories).toEqual(['roofing']);
    expect((await notesFor(db as never, [10, 1], ['roofing'])).has(10)).toBe(false);

    // run 3 and 4: nothing left, the poison record is never sent again
    for (let i = 0; i < 2; i++) {
      const m = mockModel(answerWith(POISON));
      const s = await runClassify(opts(db, m.model));
      stamp(db);
      sentWithPoison.push(total(m.calls));
      expect(m.calls).toHaveLength(0);
      expect(s.poisonSkipped).toBe(0);
    }
    expect(sentWithPoison.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(seen.flat().filter((id) => id === 10)).toHaveLength(2);
  });

  it('with a small run limit the queue still moves past the bad record at the head', async () => {
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 30 }, (_, i) => permit(i + 1)) });
    const POISON = new Set([30]); // the oldest
    const env = { AI_MAX_SIGNALS_PER_RUN: '5', AI_MAX_SIGNALS_PER_DAY: '5000' };
    const all: number[][] = [];
    for (let run = 1; run <= 8; run++) {
      const m = mockModel(answerWith(POISON));
      await runClassify(opts(db, m.model, { env }));
      stamp(db);
      all.push(...m.calls.map((c) => c.ids));
    }
    // all 30 records are settled (29 classified, the poison one skipped) and the poison record was sent exactly twice
    expect(db.tables.holler_signal_ai).toHaveLength(30);
    expect(db.tables.holler_signal_ai.filter((r) => r.model === 'poison').map((r) => r.signal_id)).toEqual([30]);
    expect(all.filter((ids) => ids.includes(30))).toHaveLength(2);
  });

  it('records with the same text as the skipped one are skipped with it (not paid for one by one)', async () => {
    const same = { title: 'Same poison text', summary: 'x' };
    const db = new AiFakeDb({ holler_signals: [permit(1, same), permit(2, same), permit(3, same), permit(4)] });
    const POISON = new Set([1, 2, 3]);
    for (let run = 1; run <= 3; run++) {
      const m = mockModel(answerWith(POISON));
      await runClassify(opts(db, m.model));
      stamp(db);
    }
    expect(db.tables.holler_signal_ai.filter((r) => r.model === 'poison').map((r) => r.signal_id).sort()).toEqual([1, 2, 3]);
    expect(db.tables.holler_signal_ai.find((r) => r.signal_id === 4)!.origin).toBe('model');
  });

  it('a marker that could not be written is retried next run without a model call, and the count survives', async () => {
    const db = new AiFakeDb({ holler_signals: [permit(1)] });
    db.tables.holler_ai_cache.push({ key: attemptKey(1), trades: {}, notes: {}, model: 'poison-attempts', prompt_v: 2, hits: 2, created_at: NOW.toISOString() });
    const m = mockModel(answerWith(new Set()));
    const s = await runClassify(opts(db, m.model));
    expect(m.calls).toHaveLength(0);
    expect(s.poisonSkipped).toBe(1);
    expect(db.tables.holler_signal_ai[0]).toMatchObject({ signal_id: 1, origin: 'skip', model: 'poison' });
  });

  it('the attempt store unreadable: nothing breaks, and a failed record is not re-sent within the run', async () => {
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 3 }, (_, i) => permit(i + 1)) });
    db.failOn['holler_ai_cache.select'] = 'boom';
    db.failOn['holler_ai_cache.insert'] = 'boom';
    db.failOn['holler_ai_cache.update'] = 'boom';
    const m = mockModel(answerWith(new Set([1])));
    const s = await runClassify(opts(db, m.model));
    expect(m.calls).toHaveLength(1);
    expect(s.failures.bad_output).toBe(1);
    expect(s.poisonSkipped).toBe(0);
  });

  it('coverage: skipped records are not counted as classified, and are counted on their own', async () => {
    const db = new AiFakeDb({
      holler_signals: [permit(1, { created_at: NOW.toISOString() }), permit(2, { created_at: NOW.toISOString() })],
      holler_signal_ai: [
        { signal_id: 1, origin: 'model', notes: {}, model: 'x' },
        { signal_id: 2, origin: 'skip', notes: {}, model: 'poison' },
      ],
    });
    const c = await loadAiCoverage(db as never, NOW);
    expect(c).toMatchObject({ total: 2, classified: 1, poisonSkipped: 1 });
    expect(aiCoverageLine(c)).toContain('1 skipped after repeated bad model output');
  });
});

describe('a gateway outage is not an attempt', () => {
  it('connection errors (cost 0, kind error) leave no attempt, and the records are classified when the gateway is back', async () => {
    const db = new AiFakeDb({ holler_signals: Array.from({ length: 6 }, (_, i) => permit(i + 1)) });
    const down = Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    for (let run = 1; run <= 4; run++) {
      const m = mockModel(() => ({ results: [] }), { throwError: down });
      const s = await runClassify(opts(db, m.model));
      stamp(db);
      expect(m.calls.length).toBeGreaterThan(0);
      expect(s.failures.model_error).toBe(1);
      expect(s.poisonSkipped).toBe(0);
    }
    expect(db.tables.holler_ai_spend.every((r) => r.kind === 'error' && Number(r.cost_usd) === 0)).toBe(true);
    expect([...(await readAttempts(db as never, [1, 2, 3, 4, 5, 6])).keys()]).toEqual([]);
    expect(db.tables.holler_ai_cache.filter((r) => r.model === 'poison-attempts')).toHaveLength(0);
    expect(db.tables.holler_signal_ai).toHaveLength(0);
    // the gateway is back: everything is classified in one batch, nothing was skipped
    const ok = mockModel(answerWith(new Set()));
    const s = await runClassify(opts(db, ok.model));
    expect(s.poisonSkipped).toBe(0);
    expect(ok.calls.flatMap((c) => c.ids).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(db.tables.holler_signal_ai.filter((r) => r.origin === 'model')).toHaveLength(6);
  });

  it('a timeout (billed worst case) is not an attempt either: only an answer with bad output is', async () => {
    const db = new AiFakeDb({ holler_signals: [permit(1)] });
    const m = mockModel(() => ({ results: [] }), { delayMs: 5_000 });
    const s = await runClassify(opts(db, m.model, { callTimeoutMs: 30 }));
    expect(s.failures.timeout).toBe(1);
    expect(db.tables.holler_ai_cache.filter((r) => r.model === 'poison-attempts')).toHaveLength(0);
  });

  it('an outage after a bad answer keeps the count at 1 (the outage adds nothing)', async () => {
    const db = new AiFakeDb({ holler_signals: [permit(1), permit(2)] });
    const bad = mockModel(answerWith(new Set([1])));
    await runClassify(opts(db, bad.model));
    stamp(db);
    expect((await readAttempts(db as never, [1, 2])).get(1)).toBe(1);
    const down = Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    await runClassify(opts(db, mockModel(() => ({ results: [] }), { throwError: down }).model));
    stamp(db);
    expect((await readAttempts(db as never, [1, 2])).get(1)).toBe(1);
  });
});
