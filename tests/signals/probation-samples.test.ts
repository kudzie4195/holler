// Source probation: a probation adapter's rows go to holler_source_samples (service role only), never to holler_signals,
// holler_signal_contacts, matching, notification or IndexNow. Rows and fakes are hand-written; the in-memory db is tests/ops/fakedb.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import { runScan } from '@/lib/signals/run';
import { SAMPLE_CAP, SAMPLES_MISSING } from '@/lib/signals/samples';
import type { Db } from '@/lib/signals/store';
import type { Adapter, SignalInput } from '@/lib/signals/types';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-17T12:00:00Z');
const asDb = (f: FakeDb) => f as unknown as Db;
const profile = { user_id: 'u000001', categories: ['roofing'], lat: 33.75, lon: -84.39, state: 'GA', radius_mi: 25, subscription_status: 'active', trial_ends_at: '2026-11-10T00:00:00Z' };

const sig = (over: Partial<SignalInput> = {}): SignalInput => ({
  source: 'fake',
  externalId: 'a',
  kind: 'alert',
  title: 'Hail warning: First',
  summary: null,
  url: 'https://example.com/a',
  categories: ['roofing'],
  severity: 3,
  occurredAt: '2026-11-17T11:00:00Z',
  lat: 33.953,
  lon: -84.55,
  state: 'GA',
  city: 'Marietta',
  ...over,
});
const withContacts = sig({ externalId: 'b', title: 'Permit: Second', data: { subtype: 'permit' }, contacts: [{ role: 'contractor', name: 'Acme Roofing LLC' }] });
const adapter = (over: Partial<Adapter> = {}): Adapter => ({
  id: 'fake',
  label: 'Fake',
  kind: 'alert',
  cadenceMinutes: 15,
  sourceUrl: 'https://example.com',
  fetch: async () => [sig(), withContacts],
  ...over,
});
const seed = () => new FakeDb({ holler_profiles: [profile] });

describe('runScan with a probation adapter', () => {
  it('writes the full rows (contacts included) to holler_source_samples and nothing to holler_signals or holler_signal_contacts', async () => {
    const f = seed();
    const r = await runScan({ now: NOW, adapters: [adapter({ probation: true })] }, asDb(f));
    expect(f.tables.holler_signals ?? []).toEqual([]);
    expect(f.tables.holler_signal_contacts ?? []).toEqual([]);
    const samples = f.tables.holler_source_samples;
    expect(samples.map((s) => [s.source, s.external_id])).toEqual([['fake', 'a'], ['fake', 'b']]);
    expect(samples[1].row).toMatchObject({ title: 'Permit: Second', data: { subtype: 'permit' }, contacts: [{ role: 'contractor', name: 'Acme Roofing LLC' }] });
    expect(r.sources[0]).toMatchObject({ id: 'fake', status: 'ok', fetched: 2, inserted: 2, matched: 0 });
    expect(f.tables.holler_scan_runs?.[0] ?? f.tables.scan_runs?.[0]).toBeDefined();
  });

  it('never calls matching, notification, the alert log or IndexNow', async () => {
    const f = seed();
    const r = await runScan({ now: NOW, adapters: [adapter({ probation: true })] }, asDb(f));
    expect(r.indexNow).toBeUndefined();
    expect(r.totals.inserted).toBe(2);
    expect(f.calls.filter((c) => /holler_matches|holler_alert|holler_profiles|holler_signals\.(upsert|insert|update)|holler_signal_contacts/.test(c))).toEqual([]);
    expect(f.tables.holler_matches ?? []).toEqual([]);
  });

  it('keeps at most 300 rows per run, ignores duplicates on (source, external_id) and drops samples older than 14 days', async () => {
    const f = seed();
    f.tables.holler_source_samples = [
      { id: 1, source: 'fake', external_id: 'old', fetched_at: '2026-11-01T00:00:00Z', row: {} },
      { id: 2, source: 'other', external_id: 'old', fetched_at: '2026-11-01T00:00:00Z', row: {} },
      { id: 3, source: 'fake', external_id: 'x0', fetched_at: '2026-11-16T00:00:00Z', row: { kept: true } },
    ];
    const many = Array.from({ length: 450 }, (_, i) => sig({ externalId: `x${i}`, title: `T${i}` }));
    const r = await runScan({ now: NOW, adapters: [adapter({ probation: true, fetch: async () => many })] }, asDb(f));
    const rows = f.tables.holler_source_samples;
    expect(rows.filter((s) => s.source === 'fake' && s.external_id !== 'old').length).toBe(SAMPLE_CAP);
    expect(rows.find((s) => s.external_id === 'x0')?.row).toEqual({ kept: true }); // duplicate ignored, not overwritten
    expect(rows.some((s) => s.source === 'fake' && s.external_id === 'old')).toBe(false);
    expect(rows.some((s) => s.source === 'other')).toBe(false); // retention is global: another source's old sample expires too
    expect(r.sources[0].inserted).toBe(SAMPLE_CAP - 1);
  });

  it('logs "holler_source_samples missing: apply 0022" when the table is not there and writes nothing to holler_signals', async () => {
    const f = seed();
    f.failOn['holler_source_samples.upsert'] = 'relation "public.holler_source_samples" does not exist';
    const r = await runScan({ now: NOW, adapters: [adapter({ probation: true })] }, asDb(f));
    expect(r.sources[0].status).toBe('error');
    expect(r.sources[0].error).toBe(SAMPLES_MISSING);
    expect(f.tables.holler_signals ?? []).toEqual([]);
    expect(f.tables.holler_signal_contacts ?? []).toEqual([]);
    const logged = Object.entries(f.tables).flatMap(([t, rows]) => (/scan_runs/.test(t) ? rows : []));
    expect(logged.some((l) => l.source === 'fake' && l.error === SAMPLES_MISSING)).toBe(true);
  });

  it('a non-probation adapter is unchanged: rows go to holler_signals and contacts, nothing to samples', async () => {
    const f = seed();
    const r = await runScan({ now: NOW, adapters: [adapter()] }, asDb(f));
    expect(f.tables.holler_signals.map((s) => s.external_id)).toEqual(['a', 'b']);
    expect(f.tables.holler_source_samples ?? []).toEqual([]);
    expect(r.sources[0]).toMatchObject({ status: 'ok', inserted: 2 });
  });

  it('flipping live (removing the flag) writes to holler_signals on the next scan', async () => {
    const f = seed();
    await runScan({ now: NOW, adapters: [adapter({ probation: true })] }, asDb(f));
    await runScan({ now: NOW, adapters: [adapter()], source: 'fake' }, asDb(f));
    expect(f.tables.holler_signals.map((s) => s.external_id)).toEqual(['a', 'b']);
  });
});

describe('probation review fixes (redo 2)', () => {
  it('F1: a matching failure marks the live source failed but not the probation source', async () => {
    const f = seed();
    f.failOn['holler_profiles.select'] = 'boom';
    const live = adapter({ id: 'live', fetch: async () => [sig({ source: 'live', externalId: 'l1' })] });
    const prob = adapter({ id: 'prob', probation: true });
    const r = await runScan({ now: NOW, adapters: [live, prob] }, asDb(f));
    expect(r.error).toMatch(/matching failed: .*boom/);
    expect(r.sources.find((x) => x.id === 'live')).toMatchObject({ status: 'error', error: expect.stringMatching(/matching failed/) });
    expect(r.sources.find((x) => x.id === 'prob')).toMatchObject({ status: 'ok', inserted: 2 });
    const runs = f.tables.holler_scan_runs;
    expect(runs.find((x) => x.source === 'prob')!.error).toBeNull();
    expect(runs.find((x) => x.source === 'live')!.error).toMatch(/matching failed/);
  });

  it('F2: every scan deletes samples older than 14 days for all sources, even with no probation source or no rows', async () => {
    const f = seed();
    f.tables.holler_source_samples = [
      { id: 1, source: 'quiet', external_id: 'a', fetched_at: '2026-10-01T00:00:00Z', row: {} },
      { id: 2, source: 'promoted', external_id: 'b', fetched_at: '2026-11-01T00:00:00Z', row: {} },
      { id: 3, source: 'quiet', external_id: 'c', fetched_at: '2026-11-10T00:00:00Z', row: {} },
    ];
    await runScan({ now: NOW, adapters: [adapter({ probation: true, fetch: async () => [] }), adapter({ id: 'live2', fetch: async () => [] })] }, asDb(f));
    expect(f.tables.holler_source_samples.map((x) => x.id)).toEqual([3]);
    expect(f.calls.filter((c: string) => c === 'holler_source_samples.delete').length).toBe(1);
  });

  it('F2: a missing samples table is logged once per scan, not once per source', async () => {
    const f = seed();
    f.failOn['holler_source_samples.delete'] = 'relation "public.holler_source_samples" does not exist';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const many = ['p1', 'p2', 'p3'].map((id) => adapter({ id, fetch: async () => [] }));
    await runScan({ now: NOW, adapters: many }, asDb(f));
    expect(warn.mock.calls.filter((c) => String(c[0]) === SAMPLES_MISSING).length).toBe(1);
    warn.mockRestore();
  });

  it('F3: samples get the live path contact clean-up (sanitizeContacts, no contacts on 311/violation)', async () => {
    const f = seed();
    const rows = [
      sig({ externalId: 'v', city: 'Atlanta', data: { subtype: '311' }, contacts: [{ role: 'site', name: 'Jane Doe', phone: '404-555-0123' }] }),
      sig({ externalId: 'w', city: 'Atlanta', data: { subtype: ' Violation ' }, contacts: [{ role: 'contractor', name: 'Acme Roofing LLC' }] }),
      sig({ externalId: 'p', city: 'Atlanta', data: { subtype: 'permit' }, contacts: [{ role: 'contractor', name: 'Acme Roofing LLC', phone: 'not a phone' }, { role: 'contractor', name: 'Jane Q Doe' }] }),
    ];
    await runScan({ now: NOW, adapters: [adapter({ probation: true, fetch: async () => rows })] }, asDb(f));
    const by = Object.fromEntries(f.tables.holler_source_samples.map((s) => [s.external_id, s.row as SignalInput]));
    expect(by.v.contacts).toEqual([]);
    expect(by.w.contacts).toEqual([]);
    expect(by.p.contacts?.map((c: { name: string }) => c.name)).toEqual(['Acme Roofing LLC']);
    expect(by.p.contacts?.[0].phone ?? null).toBeNull();
    expect(JSON.stringify(f.tables.holler_source_samples)).not.toMatch(/Jane Doe|404-555-0123/);
  });
});

describe('migration 0022_holler_source_samples.sql', () => {
  const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0022_holler_source_samples.sql'), 'utf8');
  it('enables RLS with no policies and revokes anon and authenticated', () => {
    expect(sql).toMatch(/alter table public\.holler_source_samples enable row level security/i);
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(sql).toMatch(/revoke all on table public\.holler_source_samples from public, anon, authenticated/i);
  });
  it('is idempotent, holler_-prefixed and shaped as specified', () => {
    expect(sql).toMatch(/create table if not exists public\.holler_source_samples/i);
    expect(sql).toMatch(/create index if not exists holler_source_samples_\w+\s+on public\.holler_source_samples \(source, fetched_at desc\)/i);
    expect(sql).toMatch(/unique \(source, external_id\)/i);
    expect(sql).toMatch(/id bigserial primary key/i);
    expect(sql).toMatch(/"row" jsonb not null/i);
    expect(sql).toMatch(/never in holler_signals/i);
  });
});
