// Round 18 (NAMES): an owner company on a code violation (role 'owner') is not sent to the app, which has no "Owner on the public
// record" wording or source link yet; other contacts are sent as before. Driven through the real /api/m/feed handler with fakes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { profileRow, req, tok, UA } from './fakes';
import { install, world } from './harness';

const TA = tok('a');

function sig(id: number, over: Record<string, unknown> = {}) {
  return {
    id, source: 'socrata-chicago-violations', kind: 'civic', title: `Code violation in Chicago: brick ${id}`, summary: 'EXTERIOR WALLS DEFECTIVE',
    url: 'https://data.cityofchicago.org/d/22u3-xenr', city: 'Chicago', state: 'IL', county: 'Cook', zip: '60609', severity: 1,
    occurred_at: '2026-11-18T10:00:00Z', expires_at: null, subtype: 'violation', ...over,
  };
}

beforeEach(() => {
  const w = world({
    users: { [TA]: { id: UA, email: 'a@x.test', app_metadata: { products: ['holler'] } } },
    profiles: { [UA]: profileRow(UA) },
    matches: [
      { id: 1, user_id: UA, created_at: '2026-11-18T10:00:00+00:00', signal: sig(101) },
      { id: 2, user_id: UA, created_at: '2026-11-18T11:00:00+00:00', signal: sig(102, { source: 'socrata-chicago-permits', kind: 'permit', subtype: 'permit', title: 'Roof permit' }) },
    ],
  });
  install(w);
  vi.doMock('@/lib/outreach/loader', () => ({
    loadMemberContacts: async (o: { signalIds: number[] }) =>
      new Map(o.signalIds.map((id) => [id, id === 101 ? [{ signalId: id, role: 'owner', name: 'ACME HOLDINGS LLC' }] : [{ signalId: id, role: 'contractor', name: 'Acme Builders LLC' }]])),
  }));
  vi.doMock('@/lib/requests/details', () => ({ requestTextForMember: async () => ({}) }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('mobile feed: owner companies are not sent', () => {
  it('the violation carries no contact, the permit keeps its contractor', async () => {
    const { GET } = await import('../../app/api/m/feed/route');
    const b = await (await GET(req('/api/m/feed', { token: TA }))).json();
    const byId = new Map(b.items.map((i: { signalId: number }) => [i.signalId, i]));
    expect((byId.get(101) as { contacts: unknown[] }).contacts).toEqual([]);
    expect((byId.get(102) as { contacts: unknown[] }).contacts).toEqual([{ role: 'contractor', name: 'Acme Builders LLC' }]);
    expect(JSON.stringify(b)).not.toContain('ACME HOLDINGS');
  });
});
