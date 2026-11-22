// Round 18 ROUTES review probe (logs/REV-ROUTES-probe-tests), kept as a permanent regression test (redo 1). With REV_OUT set it also
// writes its table to that path; without it it writes nothing.
/* eslint-disable @typescript-eslint/no-explicit-any */
/** REV-ROUTES probe 14: through the real runScan, a permit whose ONLY contact path is a named contractor (no address anywhere) alerts; with the stage tables present too. */
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import type { Db } from '@/lib/signals/store';
import type { Adapter, SignalInput } from '@/lib/signals/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const LOC = { lat: 33.75, lon: -84.39 };
const member = { user_id: 'm1', categories: ['landscaping'], lat: LOC.lat, lon: LOC.lon, state: 'GA', radius_mi: 25, subscription_status: 'active', trial_ends_at: null };
const permitOf = (externalId: string, over: Partial<SignalInput> = {}): SignalInput => ({
  source: 'fake-permits', externalId, kind: 'permit', title: 'New home permit in Decatur', summary: 'New Construction | Single Family Dwelling | Issued', categories: ['general-contractor', 'real-estate', 'moving'] as any,
  severity: 1, occurredAt: '2026-11-20T08:00:00Z', lat: LOC.lat + 0.01, lon: LOC.lon, city: 'Decatur', state: 'GA', data: { subtype: 'permit' }, ...over,
});
describe('REV-ROUTES 14', () => {
  for (const withStageTables of [false, true]) {
    it(`contacts reach the gate through the scan (stage tables ${withStageTables ? 'present' : 'absent'})`, async () => {
      const rows = [
        permitOf('BIZ', { contacts: [{ role: 'contractor', name: 'Peach Builders LLC' }] }),
        permitOf('SITE', { contacts: [{ role: 'site', name: '', address: '2150 N DAMEN' }] }),
        permitOf('PERSON', { contacts: [{ role: 'contractor', name: 'John Smith' }] }),
        permitOf('POBOX', { contacts: [{ role: 'site', name: '', address: 'PO BOX 123' }] }),
        permitOf('NONE'),
      ];
      const ad: Adapter = { id: 'fake-permits', label: 'Fake permits', kind: 'permit', cadenceMinutes: 60, sourceUrl: 'https://example.com', fetch: async () => rows } as Adapter;
      const seed: Record<string, any[]> = { holler_profiles: [member] };
      if (withStageTables) Object.assign(seed, { holler_permit_stages: [], holler_project_links: [], holler_dedupe_drops: [] });
      const db = new FakeDb(seed);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await runScan({ now: NOW, adapters: [ad], source: ad.id, indexNow: { config: null as never } } as any, db as unknown as Db);
      const ext = (id: number) => db.tables.holler_signals.find((s) => s.id === id)?.external_id;
      const got = Object.fromEntries(db.tables.holler_matches.map((m) => [ext(m.signal_id), m.alert_hold ?? 'alert']));
      console.log(JSON.stringify(got));
      expect(got).toEqual({ BIZ: 'alert', SITE: 'alert', PERSON: 'background', POBOX: 'background', NONE: 'background' });
    });
  }
});
