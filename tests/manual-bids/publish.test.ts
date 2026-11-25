// Review P2-6a: the write path itself (publishManualBids: the scan's insert, then the shared re-match) run against a database double that
// honours filters, conflicts and column selects (tests/match/fake-table.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildManualBid } from '@/lib/signals/manual-bids/record';
import { publishManualBids } from '@/lib/signals/manual-bids/store';
import { fakeTables } from '@/tests/match/fake-table';
import type { Db } from '@/lib/signals/store';
import type { SignalInput } from '@/lib/signals/types';

const NOW = new Date('2026-11-25T15:00:00Z');

function bid(title: string, n: number): SignalInput {
  const r = buildManualBid({ url: `https://mariettaga.gov/Bids.aspx?bidID=${n}`, title, agency: 'City of Marietta', dueDate: '2026-12-15', place: '30060', solicitationId: `RFP ${n}` }, { now: NOW, served: () => true });
  if (!r.ok) throw new Error(r.problem);
  return r.signal;
}

const profile = (user_id: string, categories: string[]) => ({
  user_id,
  categories,
  lat: 33.884,
  lon: -84.514,
  state: 'GA',
  radius_mi: 10,
  subscription_status: 'trialing',
  trial_ends_at: '2026-12-20T00:00:00Z',
  plan: 'starter',
  extra_areas: [],
  keywords: [],
});

function db() {
  return fakeTables(
    { holler_signals: [], holler_matches: [], holler_alert_log: [], holler_work_profiles: [], holler_profiles: [profile('roofer', ['roofing']), profile('plumber', ['plumbing'])] },
    { conflict: { holler_signals: ['source', 'external_id'], holler_matches: ['user_id', 'signal_id'], holler_alert_log: ['user_id', 'signal_id'] } },
  );
}

beforeEach(() => vi.stubEnv('HOLLER_BIDS_ENABLED', '1'));
afterEach(() => vi.unstubAllEnvs());

describe('publishManualBids', () => {
  it('stores a normal bid row and matches it to the member of that trade only, as a new alert (not yet emailed or pushed)', async () => {
    const d = db();
    const res = await publishManualBids(d as unknown as Db, [bid('Roof replacement at Fire Station 3', 1)], NOW);
    expect(res).toEqual({ inserted: 1, matched: 1 });
    expect(d.tables.holler_signals).toHaveLength(1);
    expect(d.tables.holler_signals[0]).toMatchObject({ source: 'bids-manual', kind: 'contract', categories: ['roofing'], place_slug: null, url: 'https://mariettaga.gov/Bids.aspx?bidID=1', data: { subtype: 'bid', loc: 'approx', buyer: 'City of Marietta' } });
    expect(d.tables.holler_matches).toHaveLength(1);
    expect(d.tables.holler_matches[0]).toMatchObject({ user_id: 'roofer', signal_id: d.tables.holler_signals[0].id, notified: false, pushed_at: null });
    const writes = [...new Set(d.log.filter((l: string) => /:(upsert|insert|update|delete)/.test(l)).map((l: string) => l.split(':')[0]))].sort();
    expect(writes).toEqual(['holler_alert_log', 'holler_matches', 'holler_signals']);
  });

  it('the same record again inserts and matches nothing', async () => {
    const d = db();
    await publishManualBids(d as unknown as Db, [bid('Roof replacement at Fire Station 3', 1)], NOW);
    expect(await publishManualBids(d as unknown as Db, [bid('Roof replacement at Fire Station 3', 1)], NOW)).toEqual({ inserted: 0, matched: 0 });
    expect(d.tables.holler_signals).toHaveLength(1);
    expect(d.tables.holler_matches).toHaveLength(1);
  });

  it('with HOLLER_BIDS_ENABLED off nobody is matched (the service refuses to publish then anyway)', async () => {
    vi.stubEnv('HOLLER_BIDS_ENABLED', '');
    const d = db();
    expect(await publishManualBids(d as unknown as Db, [bid('Plumbing upgrades at City Hall', 2)], NOW)).toEqual({ inserted: 1, matched: 0 });
  });
});
