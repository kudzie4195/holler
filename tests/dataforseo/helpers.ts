import { vi } from 'vitest';
import { FakeDb } from '../ops/fakedb';
import type { DfsDeps } from '../../lib/dataforseo/client';

export const NOW = new Date('2026-11-18T12:00:00Z');
export const MONTH = '2026-11-01';
export const ENV = { DATAFORSEO_LOGIN: 'user@example.test', DATAFORSEO_PASSWORD: 'p4ss-w0rd-secret' };

export type FetchMock = ReturnType<typeof vi.fn>;

export function okBody(result: unknown, cost: number) {
  return { version: '0.1', status_code: 20000, status_message: 'Ok.', cost, tasks_count: 1, tasks_error: 0, tasks: [{ id: 't', status_code: 20000, status_message: 'Ok.', cost, result_count: 1, result }] };
}

export function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function deps(over: Omit<Partial<DfsDeps>, 'fetch'> & { fetch?: FetchMock } = {}): { d: DfsDeps; db: FakeDb; fetch: FetchMock } {
  const db = new FakeDb({ holler_dataforseo_spend: [], holler_keyword_volume: [], holler_llm_mentions: [] });
  const fetch = over.fetch ?? vi.fn(async () => jsonRes(okBody([], 0.075)));
  const d: DfsDeps = { db: db as never, env: ENV, now: () => NOW, sleep: async () => {}, ...(over as Partial<DfsDeps>) };
  d.fetch = fetch as unknown as typeof globalThis.fetch;
  return { d, db, fetch };
}
