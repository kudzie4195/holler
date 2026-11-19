/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { hasPendingAsk, isFeedAnswer, recordOutcome } from '@/lib/moat/outcome';

const rpc = (res: any) => ({ rpc: async () => res }) as any;

describe('recordOutcome', () => {
  it('maps the database answer and refuses bad input before calling', async () => {
    expect(await recordOutcome(rpc({ data: 'recorded', error: null }), 'u', 1, 'yes')).toBe('recorded');
    expect(await recordOutcome(rpc({ data: 'already', error: null }), 'u', 1, 'no')).toBe('already');
    expect(await recordOutcome(rpc({ data: 'none', error: null }), 'u', 1, 'not_yet')).toBe('none');
    expect(await recordOutcome(rpc({ data: 'weird', error: null }), 'u', 1, 'yes')).toBe('failed');
    for (const [u, s, a] of [['', 1, 'yes'], ['u', 0, 'yes'], ['u', 1.5, 'yes'], ['u', 1, 'maybe']] as const) {
      expect(await recordOutcome({ rpc: () => { throw new Error('should not be called'); } } as any, u, s, a)).toBe('invalid');
    }
  });
  it('never throws', async () => {
    expect(await recordOutcome(rpc({ data: null, error: { message: 'x' } }), 'u', 1, 'yes')).toBe('failed');
    expect(await recordOutcome({ rpc: () => { throw new Error('x'); } } as any, 'u', 1, 'yes')).toBe('failed');
  });
});

describe('hasPendingAsk', () => {
  it('is false on any failure, including a missing table', async () => {
    const mk = (res: any) => ({ from: () => { const q: any = { select: () => q, eq: () => q, is: () => q, limit: async () => res }; return q; } }) as any;
    expect(await hasPendingAsk(mk({ data: [{ id: 1 }], error: null }), 'u', 1)).toBe(true);
    expect(await hasPendingAsk(mk({ data: [], error: null }), 'u', 1)).toBe(false);
    expect(await hasPendingAsk(mk({ data: null, error: { message: 'relation does not exist' } }), 'u', 1)).toBe(false);
    expect(await hasPendingAsk({ from: () => { throw new Error('x'); } } as any, 'u', 1)).toBe(false);
  });
  it('answers are yes, no or not_yet', () => {
    expect(['yes', 'no', 'not_yet', 'maybe', 1, null].map(isFeedAnswer)).toEqual([true, true, true, false, false, false]);
  });
});
