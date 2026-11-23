// Round 18 integration, Part B item 4: a health-email line and a quality-dashboard line for any source where more than 80% of permit cards
// in the last 7 days were held as Background by the contact gate. Silent when the gate is off (0027 missing) and under 10 permit cards.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { buildHeldPermitReport, heldLine, loadHeldPermitReport, sourcePermitName } from '@/lib/admin/held-permits';
import { heldPermitsBlock } from '@/lib/admin/quality-html';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-22T13:03:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const DEKALB = 'arcgis-dekalb-permits';
const CHICAGO = 'socrata-chicago-permits';

/** `held` of `cards` permit records of `source` held as background; the rest alerted. Ids from `start`. */
function world(specs: { source: string; cards: number; held: number; start: number; kind?: string }[], extra: Record<string, Record<string, unknown>[]> = {}) {
  const signals: Record<string, unknown>[] = [];
  const matches: Record<string, unknown>[] = [];
  const log: Record<string, unknown>[] = [];
  let mid = 1;
  for (const s of specs) {
    for (let i = 0; i < s.cards; i++) {
      const id = s.start + i;
      signals.push({ id, source: s.source, kind: s.kind ?? 'permit', data: { subtype: s.kind === 'civic' ? 'violation' : 'permit' }, subtype: s.kind === 'civic' ? 'violation' : 'permit' });
      // two members per record: the hold belongs to the record, so it is counted once
      for (const u of ['u1', 'u2']) {
        if (i < s.held) matches.push({ id: mid++, user_id: u, signal_id: id, alert_hold: 'background', created_at: ago(2) });
        else {
          matches.push({ id: mid++, user_id: u, signal_id: id, alert_hold: null, created_at: ago(2) });
          log.push({ id: mid++, user_id: u, signal_id: id, source: s.source, kind: s.kind ?? 'permit', subtype: s.kind === 'civic' ? 'violation' : 'permit', created_at: ago(2) });
        }
      }
    }
  }
  return new FakeDb({ holler_signals: signals, holler_matches: matches, holler_alert_log: log, ...extra });
}

describe('held permit cards per source', () => {
  it('flags a source over 80% with at least 10 permit cards, in the owner wording', async () => {
    const db = world([
      { source: DEKALB, cards: 12, held: 11, start: 100 }, // 92%
      { source: CHICAGO, cards: 20, held: 4, start: 200 }, // 20%
    ]);
    const r = await loadHeldPermitReport(db as never, NOW);
    expect(r.status).toBe('ok');
    expect(r.lines).toEqual(['DeKalb County permits: 92% held for no contact path, check the site-address field']);
    expect(r.sources.find((x) => x.source === DEKALB)).toMatchObject({ cards: 12, held: 11 });
    expect(r.sources.find((x) => x.source === CHICAGO)).toMatchObject({ cards: 20, held: 4 });
  });

  it('silent under 10 permit cards, at exactly 80%, for non-permit records, and for cards older than 7 days', () => {
    const sig = (id: number, source: string, kind = 'permit', subtype: string | null = 'permit') => ({ id, source, kind, subtype });
    const nine = Array.from({ length: 9 }, (_, i) => sig(i + 1, DEKALB));
    expect(buildHeldPermitReport({ now: NOW, heldSignalIds: nine.map((s) => s.id), alertedSignalIds: [], signals: nine }).lines).toEqual([]);
    const ten = Array.from({ length: 10 }, (_, i) => sig(i + 1, DEKALB));
    expect(buildHeldPermitReport({ now: NOW, heldSignalIds: [1, 2, 3, 4, 5, 6, 7, 8], alertedSignalIds: [9, 10], signals: ten }).lines).toEqual([]); // 80%: not more
    expect(buildHeldPermitReport({ now: NOW, heldSignalIds: [1, 2, 3, 4, 5, 6, 7, 8, 9], alertedSignalIds: [10], signals: ten }).lines).toHaveLength(1); // 90%
    const civic = Array.from({ length: 20 }, (_, i) => sig(i + 1, 'arcgis-dekalb-violations', 'civic', 'violation'));
    expect(buildHeldPermitReport({ now: NOW, heldSignalIds: civic.map((s) => s.id), alertedSignalIds: [], signals: civic }).sources).toEqual([]);
  });

  it('cards held before the 7-day window are not counted', async () => {
    const db = world([{ source: DEKALB, cards: 12, held: 12, start: 100 }]);
    for (const m of db.tables.holler_matches) m.created_at = ago(8);
    expect((await loadHeldPermitReport(db as never, NOW)).lines).toEqual([]);
  });

  it('silent when the gate is off: migration 0027 missing (PGRST204, 42703, PGRST205, 42P01)', async () => {
    for (const [code, message] of [
      ['PGRST204', "Could not find the 'alert_hold' column of 'holler_matches' in the schema cache"],
      ['42703', 'column holler_matches.alert_hold does not exist'],
      ['PGRST205', "Could not find the table 'public.holler_matches' in the schema cache"],
      ['42P01', 'relation "public.holler_matches" does not exist'],
    ]) {
      const db = world([{ source: DEKALB, cards: 12, held: 0, start: 100 }]);
      const from = db.from.bind(db);
      (db as unknown as { from: unknown }).from = (t: string) => {
        if (t !== 'holler_matches') return from(t);
        const chain: Record<string, unknown> = {};
        for (const k of ['select', 'eq', 'gte', 'order', 'range', 'limit']) chain[k] = () => chain;
        chain.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: { code, message } });
        return chain;
      };
      const r = await loadHeldPermitReport(db as never, NOW);
      expect(r.status, code).toBe('off');
      expect(r.lines, code).toEqual([]);
      expect(heldPermitsBlock(r), code).toBe('');
    }
  });

  it('the source name: from the source list, else the id', () => {
    expect(sourcePermitName(DEKALB)).toBe('DeKalb County permits');
    expect(sourcePermitName(CHICAGO)).toBe('Chicago permits');
    expect(sourcePermitName('no-such-source')).toBe('no-such-source');
    expect(heldLine({ source: DEKALB, cards: 25, held: 23, share: 0.92 })).toBe('DeKalb County permits: 92% held for no contact path, check the site-address field');
  });
});

describe('the health email and the quality dashboard carry the line', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/signals/registry');
    vi.doUnmock('@/lib/email');
  });

  it('GET /api/cron/health puts the line in Watch and the email; GET /api/admin/quality shows it in HTML and JSON', async () => {
    const db = world([{ source: DEKALB, cards: 12, held: 11, start: 100 }], { holler_scan_runs: [] });
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const sendEmail = vi.fn(async () => ({ ok: true, id: 'em' }));
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.stubEnv('ADMIN_EMAIL', 'owner@x.test');
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
    vi.doMock('@/lib/signals/registry', () => ({ ALL_ADAPTERS: [] }));
    vi.doMock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail }));
    const LINE = 'DeKalb County permits: 92% held for no contact path, check the site-address field';
    const { GET } = await import('@/app/api/cron/health/route');
    const body = (await (await GET(new Request('http://x.test/api/cron/health', { headers: { authorization: 'Bearer s3cret' } }))).json()) as { watch: string[] };
    expect(body.watch).toContain(LINE);
    expect((sendEmail.mock.calls[0] as unknown as [{ text: string }])[0].text).toContain(LINE);
    const q = await import('@/app/api/admin/quality/route');
    const html = await (await q.GET(new Request('http://x.test/api/admin/quality?format=html', { headers: { authorization: 'Bearer s3cret' } }))).text();
    expect(html).toContain(LINE);
    const json = (await (await q.GET(new Request('http://x.test/api/admin/quality', { headers: { authorization: 'Bearer s3cret' } }))).json()) as { heldPermits: { lines: string[] } };
    expect(json.heldPermits.lines).toEqual([LINE]);
  });
});
