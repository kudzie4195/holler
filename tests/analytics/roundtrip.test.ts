// The browser module and the server module agree: what runAnalytics writes and sends is accepted by ingestBeacon and stored as expected.
import { afterEach, describe, expect, it } from 'vitest';
import { runAnalytics } from '@/lib/analytics/client';
import { ingestBeacon, type IngestDeps } from '@/lib/analytics/ingest';
import type { EventRow } from '@/lib/analytics/events';
import { fakeBrowser } from './helpers';

const RealBlob = globalThis.Blob;
afterEach(() => {
  globalThis.Blob = RealBlob;
});
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function deps(rows: EventRow[]): IngestDeps {
  return { hit: async () => 'allowed', insert: async (r) => void rows.push(r), siteUrl: 'https://holler.test', ip: () => '203.0.113.7' };
}

describe('client to server', () => {
  it('a first visit with a campaign is stored with the session and the first-touch source', async () => {
    class B extends RealBlob {
      __t: string;
      constructor(parts: BlobPart[], o?: BlobPropertyBag) {
        super(parts, o);
        this.__t = parts.join('');
      }
    }
    globalThis.Blob = B as unknown as typeof Blob;
    const b = fakeBrowser({ search: '?utm_source=Instagram&utm_medium=Social&utm_campaign=Fall%20Storm', pathname: '/local/austin-tx' });
    expect(runAnalytics(b.env)).toBe('counted');
    const req = new Request('https://holler.test/api/e', {
      method: 'POST',
      headers: { origin: 'https://holler.test', host: 'holler.test', 'user-agent': CHROME, cookie: b.env.getCookie(), 'content-type': 'application/json' },
      body: b.beacons[0].body,
    });
    const rows: EventRow[] = [];
    expect(await ingestBeacon(req, deps(rows))).toBe('stored');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'visit', user_id: null, source: 'instagram', medium: 'social', campaign: 'fall-storm', path: '/local/austin-tx' });
    expect(rows[0].session_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
