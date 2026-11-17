// Integration round 3, item 2a: when a request ends (closed, removed, or simply past its 14 days), the scan cron's housekeeping deletes
// its public holler_signals row, and the holler_matches rows go with it (ON DELETE CASCADE, migration 0001 line 104), so nothing is
// left for city, weekly and trade pages, /check, /data, digests or feeds to show. Idempotent and bounded.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeRequest, confirmRequest, createRequest, purgeEndedRequests, PURGE_BATCH } from '@/lib/requests/service';
import { linkToken } from '@/lib/requests/tokens';
import { SECRET, T0, VALID, harness, tokenIn, type Harness } from './helpers';

const DAY = 86_400_000;

beforeEach(() => {
  for (const m of ['log', 'error', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function published(h: Harness): Promise<{ id: string; publicId: string }> {
  expect(await createRequest(h.deps, VALID, '203.0.113.9')).toEqual({ status: 'accepted' });
  const token = tokenIn(h.sent[h.sent.length - 1].text, '/request/confirm');
  expect((await confirmRequest(h.deps, token)).state).toBe('confirmed');
  const row = h.db.rows('holler_requests').at(-1)!;
  return { id: row.id, publicId: row.public_id };
}

const signalsOf = (h: Harness, publicId: string) =>
  h.db.rows('holler_signals').filter((s) => s.source === 'holler-request' && s.external_id === publicId);

describe('purgeEndedRequests deletes the public record of ended requests', () => {
  it('an open, unexpired request keeps its record and matches', async () => {
    const h = harness();
    const { publicId } = await published(h);
    expect(signalsOf(h, publicId)).toHaveLength(1);
    const matchesBefore = h.db.rows('holler_matches').length;
    expect(matchesBefore).toBeGreaterThan(0);
    const r = await purgeEndedRequests(h.db as never, new Date(T0.getTime() + 13 * DAY));
    expect(r.signalsDeleted).toBe(0);
    expect(signalsOf(h, publicId)).toHaveLength(1);
    expect(h.db.rows('holler_matches')).toHaveLength(matchesBefore);
  });

  it('a request that runs out after 14 days: its signal and its matches are deleted on the next run, and a re-run is a no-op', async () => {
    const h = harness();
    const { id, publicId } = await published(h);
    const signalId = signalsOf(h, publicId)[0].id;
    expect(h.db.rows('holler_matches').some((m) => m.signal_id === signalId)).toBe(true);
    const later = new Date(T0.getTime() + 14 * DAY + 60_000);
    const r = await purgeEndedRequests(h.db as never, later);
    expect(r).toMatchObject({ signalsDeleted: 1, error: null });
    expect(signalsOf(h, publicId)).toHaveLength(0);
    expect(h.db.rows('holler_matches').some((m) => m.signal_id === signalId)).toBe(false);
    expect(h.db.rows('holler_requests').find((x) => x.id === id)!.signal_id).toBeNull();
    // The private row stays until the 30-day wipe; only the public record goes now.
    expect(h.db.rows('holler_requests').find((x) => x.id === id)!.status).toBe('open');
    expect((await purgeEndedRequests(h.db as never, later)).signalsDeleted).toBe(0);
  });

  it('a closed request: the record goes on the next run (close sets expires_at to now)', async () => {
    const h = harness();
    const { id, publicId } = await published(h);
    const closeToken = linkToken('close', id, SECRET);
    expect((await closeRequest(h.deps, closeToken)).state).toBe('closed');
    const r = await purgeEndedRequests(h.db as never, new Date(T0.getTime() + 60_000));
    expect(r.signalsDeleted).toBe(1);
    expect(signalsOf(h, publicId)).toHaveLength(0);
    expect(h.db.rows('holler_matches')).toHaveLength(0);
  });

  it('a removed request whose public row was never expired (the update failed) is still found through holler_requests', async () => {
    const h = harness();
    const { id, publicId } = await published(h);
    h.db.failOn['holler_signals.update'] = 'update failed';
    expect((await closeRequest(h.deps, linkToken('remove', id, SECRET))).state).toBe('removed');
    delete h.db.failOn['holler_signals.update'];
    // The public row still says it is live: only the second sweep (ended request still linked to a signal) can catch it.
    expect(Date.parse(signalsOf(h, publicId)[0].expires_at)).toBeGreaterThan(T0.getTime());
    const r = await purgeEndedRequests(h.db as never, new Date(T0.getTime() + 60_000));
    expect(r.signalsDeleted).toBe(1);
    expect(signalsOf(h, publicId)).toHaveLength(0);
  });

  it('never touches other sources, even expired ones', async () => {
    const h = harness({
      holler_signals: [
        { id: 900, source: 'nws', external_id: 'x', kind: 'alert', expires_at: new Date(T0.getTime() - DAY).toISOString() },
      ],
    });
    await purgeEndedRequests(h.db as never, T0);
    expect(h.db.rows('holler_signals').map((s) => s.id)).toContain(900);
  });

  it('is bounded: one run deletes at most PURGE_BATCH expired records per sweep', async () => {
    const old = new Date(T0.getTime() - DAY).toISOString();
    const rows = Array.from({ length: PURGE_BATCH + 5 }, (_, i) => ({
      id: i + 1, source: 'holler-request', external_id: `req_${i}`, kind: 'ask', expires_at: old,
    }));
    const h = harness({ holler_signals: rows });
    expect((await purgeEndedRequests(h.db as never, T0)).signalsDeleted).toBe(PURGE_BATCH);
    expect((await purgeEndedRequests(h.db as never, T0)).signalsDeleted).toBe(5);
    expect(h.db.rows('holler_signals')).toHaveLength(0);
  });

  it('a failing delete is reported, not thrown, and the other housekeeping still runs', async () => {
    const h = harness({
      holler_requests: [
        { id: 'p', public_id: 'p', status: 'pending', email: 'p@x.org', created_at: new Date(T0.getTime() - 8 * DAY).toISOString() },
      ],
      holler_signals: [{ id: 1, source: 'holler-request', external_id: 'gone', kind: 'ask', expires_at: T0.toISOString() }],
    });
    h.db.failOn['holler_signals.delete'] = 'delete denied';
    const r = await purgeEndedRequests(h.db as never, T0);
    expect(r.error).toContain('delete denied');
    expect(r.deletedPending).toBe(1);
  });
});
