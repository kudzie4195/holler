/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { archiveAndPrune } from '@/lib/moat/prune';

const A = new Date('2026-07-01T00:00:00Z');
const B = new Date('2027-01-01T00:00:00Z');
const rpc = (res: any) => ({ rpc: async () => res }) as any;

describe('archiveAndPrune', () => {
  it('returns the counts', async () => {
    expect(await archiveAndPrune(rpc({ data: [{ archived: 3, deleted_old: 3, deleted_future: 1 }], error: null }), A, B)).toEqual({ archived: 3, deletedOld: 3, deletedFuture: 1 });
  });
  it('returns null when the function is not installed yet, so the caller keeps its old delete', async () => {
    expect(await archiveAndPrune(rpc({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.holler_prune_signals' } }), A, B)).toBeNull();
    expect(await archiveAndPrune(rpc({ data: null, error: { code: '42883', message: 'function public.holler_prune_signals(timestamp with time zone, timestamp with time zone) does not exist' } }), A, B)).toBeNull();
  });
  // Changed in round 7 (review r4): the fallback used to match any "does not exist" message, so an error raised INSIDE the function
  // turned into the old plain delete (signals deleted with no archive copy).
  it('an error raised inside the function never falls back to the plain delete (review r4 repro)', async () => {
    for (const error of [
      { code: '42P01', message: 'relation "public.holler_signal_archive" does not exist' },
      { code: '42703', message: 'column s.zip does not exist' },
      { code: '42883', message: 'function public.holler_plain_place(text) does not exist' },
      { code: '42883', message: 'function does not exist' },
      { code: undefined, message: 'something does not exist' },
    ]) {
      await expect(archiveAndPrune(rpc({ data: null, error }), A, B), JSON.stringify(error)).rejects.toThrow(/prune failed/);
    }
  });
  it('returns null for a client without rpc (test doubles, old clients)', async () => {
    expect(await archiveAndPrune({} as any, A, B)).toBeNull();
  });
  it('throws on any other failure, so a failed archive is never followed by a plain delete', async () => {
    await expect(archiveAndPrune(rpc({ data: null, error: { code: '23514', message: 'check violation' } }), A, B)).rejects.toThrow(/prune failed/);
  });
});
