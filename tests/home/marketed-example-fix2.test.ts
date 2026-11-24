// Round 24 FIX2 (review P3-8): the home page's permit example is a permit a marketed trade gets (new home, new construction, re-roof).
import { describe, expect, it } from 'vitest';
import { featuredRecord, ledgerExamples } from '@/components/home/select';
import type { HomeMap, MapRecord } from '@/lib/seo/home-map';

const rec = (id: string, title: string, family: MapRecord['family'], at: string): MapRecord =>
  ({ id, family, title, phrase: title.slice(0, 16), label: title.slice(0, 16).toUpperCase(), mi: 1, occurredAt: at, url: null }) as MapRecord;
const map = (records: MapRecord[]): HomeMap => ({ live: true, zip: '60614', city: 'Chicago', records }) as unknown as HomeMap;

describe('home permit example', () => {
  it('skips a newer electrical permit for a new-home or re-roof permit', () => {
    const m = map([rec('1', 'Electrical permit in Chicago', 'permit', '2026-11-22T10:00:00Z'), rec('2', 'New construction permit in Chicago', 'permit', '2026-11-21T10:00:00Z')]);
    expect(featuredRecord(m).title).toBe('New construction permit in Chicago');
    expect(ledgerExamples(m, null).permit?.title).toBe('New construction permit in Chicago');
  });
  it('with no marketed permit the ledger shows no permit example (never an electrical one)', () => {
    const m = map([rec('1', 'Electrical permit in Chicago', 'permit', '2026-11-22T10:00:00Z')]);
    expect(ledgerExamples(m, null).permit).toBeNull();
  });
});
