import { describe, expect, it } from 'vitest';
import { notesFor, rankSignals, scoresFor } from '../../lib/ai';
import { AiFakeDb } from './fake-db';

const db = () =>
  new AiFakeDb({
    holler_signal_ai: [
      { signal_id: 1, trades: { roofing: 0.9, 'siding-gutters': 0.7 }, notes: { roofing: 'Roofs may need a look.', 'siding-gutters': 'Gutters may fill up.' } },
      { signal_id: 2, trades: { hvac: 0.95 }, notes: { hvac: 'Units may need service.' } },
      { signal_id: 3, trades: {}, notes: {} },
      { signal_id: 4, trades: { roofing: 0.6 }, notes: { roofing: 'Visit https://evil.example now.' } },
      { signal_id: 5, trades: { roofing: 0.4, 'siding-gutters': 0.8 }, notes: { roofing: 'Roofs may need a look.', 'siding-gutters': 'Gutters may fill up.' } },
    ],
  });

describe('notesFor', () => {
  it("picks the note for the member's most confident trade, skips unsafe or missing notes", async () => {
    const m = await notesFor(db() as never, [1, 2, 3, 4, 5, 99], ['siding-gutters', 'roofing']);
    expect(m.get(1)).toBe('Roofs may need a look.');
    expect(m.get(5)).toBe('Gutters may fill up.');
    expect(m.has(2)).toBe(false);
    expect(m.has(3)).toBe(false);
    expect(m.has(4)).toBe(false);
    expect(m.has(99)).toBe(false);
  });
  it('empty map on any error or empty input', async () => {
    const d = db();
    d.failOn['holler_signal_ai.select'] = 'relation does not exist';
    expect((await notesFor(d as never, [1], ['roofing'])).size).toBe(0);
    expect((await notesFor(db() as never, [], ['roofing'])).size).toBe(0);
    expect((await notesFor(db() as never, [1], [])).size).toBe(0);
  });
});

describe('scoresFor', () => {
  it("best confidence among the member's trades; 0 when classified without them; absent when unknown or empty", async () => {
    const m = await scoresFor(db() as never, [1, 2, 3, 5, 99], ['roofing', 'siding-gutters']);
    expect(m.get(1)).toBe(0.9);
    expect(m.get(2)).toBe(0);
    expect(m.has(3)).toBe(false);
    expect(m.get(5)).toBe(0.8);
    expect(m.has(99)).toBe(false);
    const d = db();
    d.failOn['holler_signal_ai.select'] = 'x';
    expect((await scoresFor(d as never, [1], ['roofing'])).size).toBe(0);
  });
});

describe('rankSignals', () => {
  const t0 = Date.parse('2026-11-19T12:00:00Z');
  const at = (h: number) => new Date(t0 - h * 3_600_000).toISOString();
  it('confidence 0.6, severity 0.25, recency 0.15; unknown confidence is 0.5', () => {
    const items = [
      { id: 1, severity: 1, occurred_at: at(0) }, // 0.6*0.5 + 0 + 0.15*1 = 0.45
      { id: 2, severity: 3, occurred_at: at(0) }, // 0.6*0.2 + 0.25 + 0.15 = 0.52
      { id: 3, severity: 1, occurred_at: at(24 * 7) }, // 0.6*0.9 + 0 + 0.15*0.5 = 0.615
      { id: 4, severity: null, occurred_at: 'nonsense' }, // 0.6*0.5 = 0.3
    ];
    const r = rankSignals(items, new Map([[2, 0.2], [3, 0.9]]));
    expect(r.map((x) => x.id)).toEqual([3, 2, 1, 4]);
  });
  it('deterministic, does not mutate, ties keep the old order', () => {
    const items = [5, 4, 3, 2, 1].map((id) => ({ id, severity: 2, occurred_at: at(1), extra: 'kept' }));
    const copy = JSON.parse(JSON.stringify(items));
    const r = rankSignals(items, new Map());
    expect(r.map((x) => x.id)).toEqual([5, 4, 3, 2, 1]);
    expect(items).toEqual(copy);
    expect(rankSignals(items, new Map())).toEqual(r);
    expect(r[0].extra).toBe('kept');
    expect(rankSignals([], new Map())).toEqual([]);
  });
});
